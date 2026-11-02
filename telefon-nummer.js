// telefon-nummer.js
// -----------------------------------------------------------------------------
// Fase 3, T7a (30/10-26): telefonnummerets egne funktioner. Telefonpasser
// bliver et tilkoeb som de andre moduler (D25), saa nummeret skal kunne
// tildeles og frigives for sig - ikke kun ved oprettelse og udloeb.
//
//   sikrTelefonModul  - giver et nyt firma telefon-raekken (kilde 'auto'), som
//                       triggeren firma_faar_telefon gjorde. Triggeren fjernes
//                       i samme udgivelse (migrationen t7a).
//   tildelNummer      - giver et firma et nummer fra puljen. Idempotent: har
//                       firmaet et, sker intet. Tom pulje -> { status: "tom" },
//                       aldrig en undtagelse (kalderen beslutter, T7b).
//   frigivNummer      - laegger firmaets nummer tilbage i puljen, med karantaene
//                       hvis nummeret har vaeret VERIFICERET (Ann 30/10, D95).
//   karantaeneTil     - ren regel: hvornaar maa nummeret genbruges.
//   opkaldsGate       - T7c (bag FASE3_SYNK): maa et opkald til firmaets nummer
//                       blive til et lead? Med flaget afgoer TELEFONMODULET det
//                       (respit og opsigelse til periodens slut virker); uden
//                       flaget billing_status, som foer.
//   telefonTilstand   - T7d (bag FASE3_SYNK): hvad onboardingen skal vise -
//                       telefon aktiv? nummer? paa vej? Og maa firmaet blive
//                       "active" uden verifikation (ingen telefon / venter)?
//   nummerEfterSynk   - T7b (bag FASE3_SYNK): bringer nummeret i trit med det
//                       modulsaet, synk lige har skrevet. Telefon koebt og
//                       aktiv + intet nummer -> tildel. Telefon IKKE koebt +
//                       nummer -> frigiv. Telefon koebt, men respitten er gaaet
//                       (rykkerforloeb) -> BEHOLD nummeret (beslutning 2, 28/10:
//                       omstillingen stopper, nummeret beholdes til udloeb, og
//                       udloebet frigiver det via deprovisionFirm).
//
// KARANTAENE (D95, Ann 30/10): har nummeret vaeret verificeret, har det vaeret
// kundens - det staar paa bilen og i kundernes telefoner - og det faar
// karantaene, uanset hvad kunden har betalt. Foer afgjordes det af, om Frisbii
// havde en betalt faktura, og en 0-kr.-pris (DB Toemrer) blev dermed doemt
// "proevekunde" og nummeret frigivet straks. firms.nummer_verificeret_at saettes
// ved foerste verifikation og ryddes aldrig (verification_status gaar tilbage
// til "pending" ved hvert nyt testopkald, saa den kan ikke bruges til det).
//
// Ingen afhaengigheder ud over phone.js. Klienterne sendes ind som argumenter.
// -----------------------------------------------------------------------------
"use strict";

const { vaelgLedigtNummer, hentEjedeNumre, normalizePhone } = require("./phone");

const KARANTAENE_DAGE = () => Number(process.env.QUARANTINE_DAYS_PAID) || 30;

// Ren regel. firma: { nummer_verificeret_at }. Returnerer ISO-tid eller null
// (null = maa genbruges straks).
function karantaeneTil(firma, nu = new Date().toISOString(), dage = KARANTAENE_DAGE()) {
  if (!firma || !firma.nummer_verificeret_at) return null;
  if (!(dage > 0)) return null;
  return new Date(new Date(nu).getTime() + dage * 24 * 60 * 60 * 1000).toISOString();
}

async function sikrTelefonModul(supabase, firmId) {
  const { error } = await supabase
    .from("firma_moduler")
    .upsert({ firm_id: firmId, modul: "telefon", kilde: "auto" }, { onConflict: "firm_id,modul", ignoreDuplicates: true });
  if (error) throw new Error(`sikrTelefonModul: ${error.message}`);
}

async function hentFirma(supabase, firmId) {
  const { data, error } = await supabase
    .from("firms").select("id, phone_number, nummer_verificeret_at").eq("id", firmId).maybeSingle();
  if (error) throw new Error(`firms: ${error.message}`);
  if (!data) throw new Error(`firma ${String(firmId).slice(0, 8)} findes ikke`);
  return data;
}

// T8a (31/10-26, D91 loesning B): et firma, der kommer tilbage, faar sit
// GAMLE nummer, hvis det stadig ligger ledigt med last_firm_id = firmaet -
// i karantaene eller ej. Det er karantaenens formaal (nummeret staar paa bilen).
// Twilio skal stadig eje det (samme regel som puljen: intet doedt nummer).
// Returnerer nummeret eller null. Race-sikkert som tildelingen nedenfor.
async function tagEgetNummer({ supabase, twilioClient, firmId }) {
  const { data: egne, error } = await supabase
    .from("phone_numbers").select("id, number")
    .eq("last_firm_id", firmId).is("firm_id", null)
    .order("quarantined_until", { ascending: false }).limit(1);
  if (error) throw new Error(`phone_numbers: ${error.message}`);
  const eget = egne && egne[0];
  if (!eget) return null;
  const ejede = await hentEjedeNumre(twilioClient); // kaster, hvis Twilio ikke kan spoerges
  if (!ejede.has(normalizePhone(eget.number))) return null;

  const { data: taget, error: tErr } = await supabase
    .from("phone_numbers").update({ firm_id: firmId, quarantined_until: null })
    .eq("id", eget.id).is("firm_id", null).select("id");
  if (tErr) throw new Error(`phone_numbers: ${tErr.message}`);
  if (!taget || !taget.length) return null; // en anden naaede det foerst

  const { data: sat, error: sErr } = await supabase
    .from("firms").update({ phone_number: eget.number })
    .eq("id", firmId).is("phone_number", null).select("id");
  if (sErr || !sat || !sat.length) {
    await supabase.from("phone_numbers").update({ firm_id: null }).eq("id", eget.id).eq("firm_id", firmId);
    if (sErr) throw new Error(`firms: ${sErr.message}`);
    return null;
  }
  return eget.number;
}

// Returnerer { status: "har" | "tildelt" | "tom", nummer, spoegelser, ledigeVerificeret[, egetNummer] }.
// Race-sikker: puljeraekken tages kun, hvis den stadig er ledig (firm_id null),
// og firmaet faar kun nummeret, hvis det stadig ikke har et. Taber vi et kaploeb
// om puljeraekken, proeves naeste (hoejst 3 gange).
async function tildelNummer({ supabase, twilioClient, firmId }) {
  const firma = await hentFirma(supabase, firmId);
  if (firma.phone_number) return { status: "har", nummer: firma.phone_number, spoegelser: [], ledigeVerificeret: null };

  // T8a: firmaets eget, tidligere nummer foerst. ledigeVerificeret er
  // undefined (ikke null), saa lav-pulje-alarmen ikke gaar paa et nummer,
  // der aldrig var i den ledige pulje.
  const eget = await tagEgetNummer({ supabase, twilioClient, firmId });
  if (eget) return { status: "tildelt", nummer: eget, egetNummer: true, spoegelser: [], ledigeVerificeret: undefined };

  let spoegelser = [], ledigeVerificeret = 0;
  for (let forsoeg = 1; forsoeg <= 3; forsoeg++) {
    const v = await vaelgLedigtNummer({ supabase, twilioClient }); // kaster, hvis Twilio ikke kan spoerges
    spoegelser = v.spoegelser; ledigeVerificeret = v.ledigeVerificeret;
    if (!v.valgt) return { status: "tom", nummer: null, spoegelser, ledigeVerificeret };

    // 1) Tag puljeraekken - kun hvis den stadig er ledig.
    const { data: taget, error: tErr } = await supabase
      .from("phone_numbers").update({ firm_id: firmId })
      .eq("id", v.valgt.id).is("firm_id", null).select("id");
    if (tErr) throw new Error(`phone_numbers: ${tErr.message}`);
    if (!taget || !taget.length) continue; // en anden naaede det foerst

    // 2) Giv firmaet nummeret - kun hvis det stadig ikke har et.
    const { data: sat, error: sErr } = await supabase
      .from("firms").update({ phone_number: v.valgt.number })
      .eq("id", firmId).is("phone_number", null).select("id");
    if (sErr || !sat || !sat.length) {
      // Laeg puljeraekken tilbage, saa den ikke bliver haengende uden firma-kobling.
      await supabase.from("phone_numbers").update({ firm_id: null }).eq("id", v.valgt.id).eq("firm_id", firmId);
      if (sErr) throw new Error(`firms: ${sErr.message}`);
      const nu = await hentFirma(supabase, firmId);
      return { status: "har", nummer: nu.phone_number, spoegelser, ledigeVerificeret };
    }
    return { status: "tildelt", nummer: v.valgt.number, spoegelser, ledigeVerificeret: ledigeVerificeret - 1 };
  }
  throw new Error("tildelNummer: tabte kaploebet om puljen tre gange - proev igen");
}

// Returnerer { status: "intet" | "frigivet", nummer, karantaeneTil }.
// Rydder BEGGE registreringer: puljeraekkens firm_id og firms.phone_number.
// Idempotent: anden koersel finder intet og returnerer "intet".
async function frigivNummer({ supabase, firmId, nu = new Date().toISOString() }) {
  const firma = await hentFirma(supabase, firmId);
  const til = karantaeneTil(firma, nu);

  const { data: frigivne, error: pErr } = await supabase
    .from("phone_numbers")
    .update({ firm_id: null, quarantined_until: til, last_firm_id: firmId })
    .eq("firm_id", firmId).select("number");
  if (pErr) throw new Error(`phone_numbers: ${pErr.message}`);

  if (firma.phone_number) {
    const { error: fErr } = await supabase.from("firms").update({ phone_number: null }).eq("id", firmId);
    if (fErr) throw new Error(`firms: ${fErr.message}`);
  }
  const nummer = firma.phone_number || (frigivne && frigivne[0] && frigivne[0].number) || null;
  if (!nummer && !(frigivne && frigivne.length)) return { status: "intet", nummer: null, karantaeneTil: null };
  return { status: "frigivet", nummer, karantaeneTil: til };
}

// saet: { moduler, til } fra modulsaet (T2). Returnerer { status, nummer, ... }:
//   "har" | "tildelt" | "tom"  (fra tildelNummer)
//   "frigivet"                 (telefon fravalgt)
//   "ingen telefon"            (ikke koebt, intet nummer - intet at goere)
//   "beholdt"                  (koebt, men ikke aktiv: respit/rykker)
// Ren regel (vises ogsaa af gensynk-firma.js i toerkoersel):
//   "tildel" | "behold" | "frigiv" | "intet"
function nummerPlan({ saet, harNummer, nu = new Date().toISOString() }) {
  const koebt = !!(saet && Array.isArray(saet.moduler) && saet.moduler.includes("telefon"));
  const aktiv = !!(saet && saet.til && new Date(saet.til).toISOString() > new Date(nu).toISOString());
  if (koebt && aktiv) return harNummer ? "intet" : "tildel";
  if (koebt) return "behold";
  return harNummer ? "frigiv" : "intet";
}

async function nummerEfterSynk({ supabase, twilioClient, firmId, saet, nu = new Date().toISOString() }) {
  // Om firmaet HAR et nummer, afgoer tildelNummer/frigivNummer selv (og race-sikkert),
  // saa reglen spoerges her, som om det ikke har.
  const plan = nummerPlan({ saet, harNummer: false, nu });
  if (plan === "tildel") return tildelNummer({ supabase, twilioClient, firmId }); // "har" / "tildelt" / "tom"
  if (plan === "behold") return { status: "beholdt", nummer: null };
  const f = await frigivNummer({ supabase, firmId, nu });
  return f.status === "frigivet" ? f : { status: "ingen telefon", nummer: null };
}

// Ren regel. Returnerer { tilladt, grund }.
//   fase3:     FASE3_SYNK
//   billing:   firms.billing_status
//   moduler:   aktive moduler (moduler.js aktiveModuler) - eller null, hvis de
//              ikke kunne laeses (modulFejl). Saa bruges den gamle regel: et
//              databasehik maa ikke lukke for en betalende kundes opkald, og
//              det maa heller ikke aabne for en, der ikke betaler.
function opkaldsGate({ fase3, billing, moduler }) {
  if (fase3 && Array.isArray(moduler)) {
    return moduler.includes("telefon")
      ? { tilladt: true, grund: "telefonmodul aktivt" }
      : { tilladt: false, grund: "telefonmodul ikke aktivt" };
  }
  if (billing && billing !== "active") return { tilladt: false, grund: `billing ${billing}` };
  return { tilladt: true, grund: fase3 ? "moduler ukendte - billing active" : "billing active" };
}

// Det, den der ringer, hoerer, naar opkaldsGate siger nej (Ann og Anne 31/10).
// Navnet kommer fra firms.name; mangler det, siges saetningen uden navn.
function inaktivBesked(firmanavn) {
  const navn = String(firmanavn || "").trim();
  return navn
    ? `Telefonsvareren for ${navn} er ikke længere i drift. Vi anbefaler, at du ringer til ${navn} igen.`
    : "Telefonsvareren er ikke længere i drift. Vi anbefaler, at du ringer igen.";
}

// Ren regel. Returnerer { aktiv, harNummer, venter, udenVerifikation }.
// Uden flaget (eller ukendte moduler): som foer - telefon antages, og
// onboardingen skal gennem verifikationen.
function telefonTilstand({ fase3, moduler, phoneNumber }) {
  const harNummer = !!phoneNumber;
  if (!fase3 || !Array.isArray(moduler)) return { aktiv: true, harNummer, venter: false, udenVerifikation: false };
  const aktiv = moduler.includes("telefon");
  return { aktiv, harNummer, venter: aktiv && !harNummer, udenVerifikation: !(aktiv && harNummer) };
}

module.exports = { karantaeneTil, sikrTelefonModul, tagEgetNummer, tildelNummer, frigivNummer, nummerPlan, nummerEfterSynk, opkaldsGate, inaktivBesked, telefonTilstand };
