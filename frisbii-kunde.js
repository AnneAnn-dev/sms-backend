// frisbii-kunde.js
// -----------------------------------------------------------------------------
// Fase 3, T8a (31/10-26): samme firma hele vejen (D91, loesning B).
// Et nyt Frisbii-abonnement maa aldrig blive et nyt firma ved siden af et
// firma, kunden allerede har. Bruges af provisionFirm i frisbii-webhook.js,
// kun bag FASE3_SYNK.
//
//   kundeBeslutning  - ren regel: hvad goer vi med dette abonnement?
//   sikrLogin        - kunden har ET login, og det er koblet til firmaet
//                      (D91-roden: firm_users manglede, naar e-mailen fandtes)
//   genoplivFirma    - et udloebet firma vaagner med det nye abonnement:
//                      samme login, opgaver og kunder - og det gamle nummer,
//                      hvis det stadig er ledigt (karantaenens formaal)
//   alarmTekst       - det, Ann faar at vide, naar vi IKKE opretter noget
//
// Anns beslutninger 31/10:
//   1. Abonnement koerer stadig (ogsaa opsagt, men ikke udloebet): intet nyt
//      firma, alarm til Ann. (Checkout siger nej foer, T8b.)
//   2. Udloebet, ikke slettet: genoplives. Eget nummer tilbage -> aktiv med
//      det samme; nyt nummer -> onboardingen igen (viderestillingen).
//   3. Login findes, intet firma: nyt firma paa det login, der findes.
// Pilot uden abonnement, der koeber: intet nyt firma, alarm - overtagelsen
// bygges, naar den foerste pilot skal betale (nummeret ville ellers kunne
// frigives af et koeb uden Telefonpasser).
//
// Klienter og funktioner sendes ind som argumenter (kan proeves i CI).
// -----------------------------------------------------------------------------
"use strict";

const kort = (id) => String(id || "").slice(0, 8);

// firmaer: firms-raekker med samme e-mail (id, status, frisbii_subscription).
// Returnerer { handling, firma?, firmaer? }:
//   "behandlet" - abonnementet har allerede et firma (gensendelse, invoice_settled)
//   "ny"        - ingen firmaer: opret som foer (men med sikrLogin)
//   "genopliv"  - et udloebet firma (status inactive)
//   "koerer"    - et firma med et andet abonnement, der ikke er udloebet
//   "pilot"     - et aktivt firma uden Frisbii-abonnement
//   "flere"     - flere firmaer paa samme e-mail: Ann afgoer det
function kundeBeslutning({ firmaer, abonnement }) {
  const liste = Array.isArray(firmaer) ? firmaer : [];
  if (liste.some((f) => f.frisbii_subscription === abonnement)) return { handling: "behandlet" };
  if (liste.length === 0) return { handling: "ny" };
  if (liste.length > 1) return { handling: "flere", firmaer: liste };
  const firma = liste[0];
  if (firma.status === "inactive") return { handling: "genopliv", firma };
  if (!firma.frisbii_subscription) return { handling: "pilot", firma };
  return { handling: "koerer", firma };
}

// Firmaer med samme e-mail. ilike, saa store/smaa bogstaver ikke skiller dem;
// % og _ escapes, saa e-mailen ikke bliver et moenster.
async function firmaerMedEmail(supabase, email) {
  const moenster = String(email).replace(/[\\%_]/g, (c) => "\\" + c);
  const { data, error } = await supabase
    .from("firms")
    .select("id, name, status, billing_status, frisbii_subscription, phone_number, nummer_verificeret_at")
    .ilike("email", moenster);
  if (error) throw new Error(`firms (e-mail): ${error.message}`);
  return data || [];
}

// Auth-brugerens id ud fra e-mailen. Supabase har intet opslag pr. e-mail i
// admin-API'et, saa listen gennemgaas side for side (faa brugere hos os).
async function findAuthBrugerId(supabase, email, { perSide = 200, maksSider = 50 } = {}) {
  const maal = String(email).toLowerCase();
  for (let side = 1; side <= maksSider; side++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: side, perPage: perSide });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const brugere = (data && data.users) || [];
    const hit = brugere.find((u) => String(u.email || "").toLowerCase() === maal);
    if (hit) return hit.id;
    if (brugere.length < perSide) return null;
  }
  throw new Error(`findAuthBrugerId: mere end ${perSide * maksSider} brugere - opslaget skal laves om`);
}

// Kunden har ET login, og det er koblet til firmaet. Kaster ved fejl; kalderen
// beslutter, om det skal vaelte noget (provisionFirm: alarm, ikke dead-letter).
// Returnerer { userId, nyBruger, nyKobling }.
async function sikrLogin({ supabase, firmId, email, firmName }) {
  let userId = null, nyBruger = false;
  const { data, error } = await supabase.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { firm_id: firmId, firm_name: firmName },
  });
  if (!error && data && data.user) {
    userId = data.user.id; nyBruger = true;
  } else if (error && (error.code === "email_exists" || /already.*regist/i.test(error.message || ""))) {
    userId = await findAuthBrugerId(supabase, email);
    if (!userId) throw new Error("sikrLogin: e-mailen findes som login, men brugeren kunne ikke findes ved opslag");
  } else {
    throw new Error(`sikrLogin: createUser: ${(error && error.message) || "intet svar"}`);
  }

  const { data: findes, error: fErr } = await supabase
    .from("firm_users").select("firm_id").eq("firm_id", firmId).eq("user_id", userId).maybeSingle();
  if (fErr) throw new Error(`firm_users: ${fErr.message}`);
  if (findes) return { userId, nyBruger, nyKobling: false };
  const { error: iErr } = await supabase.from("firm_users").insert({ firm_id: firmId, user_id: userId, role: "owner" });
  if (iErr) throw new Error(`firm_users: ${iErr.message}`);
  return { userId, nyBruger, nyKobling: true };
}

// Et udloebet firma vaagner med det nye abonnement.
// deps: { supabase, twilioClient, hent, synkFirma, nummerEfterSynk, log, nu }
// Returnerer { status: "genoplivet" | "race", moduler, nummer, egetNummer, aktiv, synk }.
async function genoplivFirma(deps, { firma, abonnement, kundeHandle }) {
  const { supabase, twilioClient, hent, synkFirma, nummerEfterSynk, log = console } = deps;
  const nu = deps.nu || new Date().toISOString();

  // 1) Kobl abonnementet paa firmaet - kun hvis det stadig er udloebet.
  //    status "onboarding", indtil vi ved, om nummeret er hans gamle.
  const { data: rows, error } = await supabase
    .from("firms")
    .update({
      frisbii_subscription: abonnement,
      frisbii_customer: kundeHandle || null,
      billing_status: "active",
      billing_status_updated_at: nu,
      status: "onboarding",
    })
    .eq("id", firma.id).eq("status", "inactive")
    .select("id, name, nummer_verificeret_at");
  if (error) {
    if (error.code === "23505" && /frisbii_subscription/i.test(error.message || "")) return { status: "race" };
    throw new Error(`firms (genopliv): ${error.message}`);
  }
  if (!rows || !rows.length) return { status: "race" }; // et parallelt event naaede det foerst

  // 2) Frisbii afgoer modulerne; nummeret foelger dem (eget nummer foerst).
  const r = await synkFirma({ supabase, hent, abonnement, skriv: true });
  const moduler = r.status === "skrevet" ? r.saet.moduler : [];
  let n = { status: "intet", nummer: null };
  if (r.status === "skrevet") n = await nummerEfterSynk({ supabase, twilioClient, firmId: firma.id, saet: r.saet });
  const nummer = n.status === "tildelt" || n.status === "har" ? n.nummer : null;
  const egetNummer = !!n.egetNummer;

  // 3) Aktiv med det samme, hvis der ikke er en viderestilling at saette op:
  //    ingen Telefonpasser, eller hans gamle (verificerede) nummer er tilbage.
  const telefon = moduler.includes("telefon");
  const aktiv = r.status === "skrevet" && (!telefon || (egetNummer && !!rows[0].nummer_verificeret_at));
  const { error: sErr } = await supabase
    .from("firms")
    .update(aktiv ? { status: "active" } : { verification_status: "pending" })
    .eq("id", firma.id);
  if (sErr) throw new Error(`firms (status): ${sErr.message}`);

  log.log(`♻️  Firma genoplivet: ${kort(firma.id)} -> ${abonnement} [${moduler.join(", ")}]` +
    ` nummer: ${nummer ? (egetNummer ? "det gamle" : "nyt") : n.status} - ${aktiv ? "aktiv" : "onboarding"}`);
  return { status: "genoplivet", moduler, nummer, egetNummer, venter: n.status === "tom", aktiv, synk: r.status, nummerStatus: n.status };
}

// Alarmen, naar intet oprettes. Returnerer { subject, text }. Ingen persondata
// ud over firmanavn og maskeret e-mail.
function alarmTekst(handling, { abonnement, firma, firmaer, mailMaskeret }) {
  if (handling === "koerer") {
    return {
      subject: `To abonnementer paa samme kunde - ${firma.name || kort(firma.id)}`,
      text:
        `Kunden ${mailMaskeret} har koebt igen (${abonnement}), men har allerede et\n` +
        `abonnement, der ikke er udloebet: ${firma.frisbii_subscription} paa firma ${firma.name || ""} (${kort(firma.id)}).\n\n` +
        `Der er IKKE oprettet et nyt firma (D91, Ann 31/10).\n\n` +
        `Saadan:\n` +
        `1. Var det gamle opsagt, og vil kunden bare fortsaette: genindfoer det i Frisbii.\n` +
        `2. Luk det nye abonnement (${abonnement}) i Frisbii ("Luk" = expire now).\n` +
        `   Er det i proeveperioden, er der intet at refundere.`,
    };
  }
  if (handling === "pilot") {
    return {
      subject: `Pilot har koebt et abonnement - ${firma.name || kort(firma.id)}`,
      text:
        `Kunden ${mailMaskeret} har koebt et abonnement (${abonnement}). Kundens firma\n` +
        `${firma.name || ""} (${kort(firma.id)}) er en pilot uden Frisbii-abonnement.\n\n` +
        `Der er IKKE oprettet et nyt firma, og abonnementet er IKKE koblet paa piloten:\n` +
        `et koeb uden Telefonpasser ville frigive pilotens nummer. Kobl det i haanden\n` +
        `(saet frisbii_subscription og koer gensynk-firma.js ${abonnement}), naar du har\n` +
        `set, hvad der er koebt.`,
    };
  }
  // flere
  const linjer = (firmaer || []).map((f) => `  ${kort(f.id)}  ${f.status}/${f.billing_status || "-"}  ${f.frisbii_subscription || "(intet abonnement)"}  ${f.name || ""}`);
  return {
    subject: `Flere firmaer paa samme e-mail - nyt abonnement ${abonnement} venter`,
    text:
      `Kunden ${mailMaskeret} har koebt et abonnement (${abonnement}), men der findes\n` +
      `${linjer.length} firmaer med samme e-mail:\n${linjer.join("\n")}\n\n` +
      `Der er IKKE oprettet et nyt firma, og eventet staar i dead-letter.\n` +
      `Ryd op (delete-firma.js, RUNBOOK-kundeafvikling afsnit 0b), og gensend derefter\n` +
      `eventet i Frisbii (Webhooks) - saa genkendes kunden.`,
  };
}

module.exports = { kundeBeslutning, firmaerMedEmail, findAuthBrugerId, sikrLogin, genoplivFirma, alarmTekst };
