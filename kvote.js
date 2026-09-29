// kvote.js — må dette firma bruge penge lige nu, og hvad kostede det bagefter.
//
// Ø2's andet lag. `ratelimit.js` fanger loops og bugs FØR noget kaldes; denne
// fil passer på pengene. Begge er nøglet på firm_id, aldrig på IP.
//
// HVORFOR APP-LAGET BÆRER DET HELE (fundet 28/8): ingen leverandør kan
// begrænse ÉT firmas forbrug. Scaleways "billing alert" er en besked, ikke en
// spærre, og rate-limiten deles af hele organisationen. Denne fil er reelt den
// eneste mekanisme, der styrer det enkelte firma.
//
// FIRE REGLER:
//
//   1. LOFTET ER IKKE EN MUR MIDT I ET KALD. Besluttet 29/9 af Ann: et kald,
//      der er sat i gang, køres færdigt; DEREFTER er firmaet spærret. Lyden
//      findes kun i håndværkerens browser, og et afslag midt i en diktering
//      koster ham hans arbejde. Overskridelsen er bundet af ét kalds pris —
//      og den binding holdes af kaldsloftet, regel 2.
//
//   2. INTET ENKELT KALD MÅ KUNNE KOSTE MERE END `AI_KALD_LOFT_DKK`.
//      Det er ikke et skøn: kaldekoden begrænser sit input (filstørrelse,
//      tekstlængde) og regner den DYREST MULIGE pris ud via adapteren. Er den
//      over loftet, afvises kaldet, før der ringes. Uden denne regel er regel 1
//      en blankocheck.
//
//   3. PRISEN SPØRGES, IKKE GANGES. Adapteren kender enheden (lydminut,
//      lydtime, kald). Står der en konstant i denne fil, er budgettet forkert
//      præcis den dag, modellen skiftes.
//
//   4. FAIL-CLOSED. Mangler en loftvariabel, eller kan forbruget ikke læses,
//      afvises kaldet. Et ukendt forbrug er ikke det samme som et lavt forbrug.
//
// Denne fil logger hverken lyd, tekst eller prompter — kun tal (CLAUDE.md).

"use strict";

const TIDSZONE = "Europe/Copenhagen";

// Månedsskiftet følger DANSK tid, ikke UTC (besluttet 29/9). Med UTC ville
// loftet nulstilles kl. 02:00 dansk tid natten mellem den 31. og den 1., og et
// regnskab, der skifter måned klokken to om natten, kan ikke forklares den dag
// nogen spørger hvorfor.

// ─── Lofterne ────────────────────────────────────────────────────────────────
// Alle i kroner, alle i miljøet. Tallene står IKKE i denne fil: de skal kunne
// ændres uden en udrulning, og de skal kunne være forskellige i staging og prod.
//
// Firmaets eget loft slår standarden: `firma_profil.ai_maanedsloft_dkk`.
// Er den NULL, gælder AI_FIRMA_MAANEDSLOFT_DKK. Ét firma hæves altså med én
// linje SQL, alle firmaer med én variabel i Railway.
const LOFTER = [
  ["AI_FIRMA_MAANEDSLOFT_DKK", "firmaMaanedDkk"],
  ["AI_FIRMA_DAGSLOFT_DKK", "firmaDagDkk"],
  ["AI_GLOBALT_MAANEDSLOFT_DKK", "globaltMaanedDkk"],
  ["AI_KALD_LOFT_DKK", "kaldDkk"],
];

// DAGSLOFTET ER PR. FIRMA, ikke globalt (besluttet 29/9 af Ann). Et globalt
// dagsloft ville lukke for ALLE firmaer, fordi ét havde en dårlig dag — og de
// andre havde intet gjort og kunne intet stille op. Pr. firma har loftet også
// et andet formål: det beskytter firmaet mod, at en enkelt dags fejl bruger
// hele månedens budget og spærrer dem i tredive dage.
//
// ⚠️ DET, DER DERMED IKKE LÆNGERE FINDES: en hurtig bremse for hele platformen.
// Går noget galt i FÆLLES kode, rammer det alle firmaer samtidigt, og kun det
// globale månedsloft står tilbage — det kan bruges op på få dage uden at nogen
// opdager det undervejs.
// RE-TRIGGER, målbar og ikke fornemmet: overstiger (antal aktive firmaer ×
// AI_FIRMA_DAGSLOFT_DKK) det globale månedsloft delt med tre, skal et globalt
// dagsloft tilbage. Med 70/10/500 sker det ved 17 firmaer. Tæl dem.

function hentLofter(env) {
  const e = env || process.env;
  const ud = {};
  for (const [navn, felt] of LOFTER) {
    const raa = (e[navn] || "").trim();
    if (!raa) throw konfigfejl(`${navn} mangler`);
    const tal = Number(raa.replace(",", "."));
    if (!Number.isFinite(tal) || tal <= 0) {
      throw konfigfejl(`${navn} er ikke et positivt tal ('${raa}')`);
    }
    ud[felt] = tal;
  }
  return ud;
}

function konfigfejl(besked) {
  const f = new Error("Kvote-konfiguration: " + besked);
  f.kode = "kvote_konfiguration";
  return f;
}

// ─── Tidsgrænser i dansk tid ─────────────────────────────────────────────────
// Ingen dato-bibliotek. Node har fuld ICU, så Intl kan svare på, hvad klokken
// er i København på et givet øjeblik — og derfra kan det absolutte tidspunkt
// for "midnat den 1." regnes ud.
//
// Hvorfor et ABSOLUT tidspunkt og ikke en omregning i SQL: en where-klausul med
// `date_trunc(... at time zone ...)` kan ikke bruge indekset på created_at, og
// forespørgslen bliver langsommere, hver gang tabellen vokser.

function lokaleDele(tid) {
  const dele = new Intl.DateTimeFormat("en-US", {
    timeZone: TIDSZONE,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(tid).reduce((a, p) => ((a[p.type] = p.value), a), {});
  return {
    aar: +dele.year, maaned: +dele.month, dag: +dele.day,
    time: +dele.hour, minut: +dele.minute, sekund: +dele.second,
  };
}

function forskydningMs(tid) {
  const d = lokaleDele(tid);
  return Date.UTC(d.aar, d.maaned - 1, d.dag, d.time, d.minut, d.sekund) - tid.getTime();
}

// To gennemløb: første gæt kan ramme ved siden af hen over et sommertidsskifte,
// andet retter det. Midnat er aldrig tvetydigt i EU — skiftet sker kl. 02:00/03:00.
function start(nu, hvad) {
  const d = lokaleDele(nu);
  const somUTC = Date.UTC(d.aar, d.maaned - 1, hvad === "maaned" ? 1 : d.dag, 0, 0, 0);
  let t = new Date(somUTC - forskydningMs(nu));
  t = new Date(somUTC - forskydningMs(t));
  return t;
}

const maanedsstart = (nu) => start(nu || new Date(), "maaned");
const dagsstart = (nu) => start(nu || new Date(), "dag");

// ─── Forbruget ───────────────────────────────────────────────────────────────
// Summeres i Node og ikke i databasen. Ved det forventede omfang (ca. 100
// sessioner pr. firma pr. måned) er det nogle hundrede rækker for ét firma og
// nogle tusinde for hele platformen — billigt.
//
// ⚠️ GRÆNSEN ER MÅLBAR, IKKE FORNEMMET: overstiger ai_forbrug ca. 50.000 rækker
// på en måned, skal summen flyttes til en RPC i databasen. Tæl rækkerne, når
// pilotkunderne er i gang, i stedet for at bygge det nu til et omfang, vi ikke
// har.
async function sumOere(supabase, fra, firmId) {
  let q = supabase.from("ai_forbrug").select("pris_oere").gte("created_at", fra.toISOString());
  if (firmId) q = q.eq("firm_id", firmId);
  const { data, error } = await q;
  // Regel 4: et ukendt forbrug er ikke et lavt forbrug.
  if (error) throw laesefejl(`kunne ikke laese ai_forbrug (${error.message})`);
  return (data || []).reduce((sum, r) => sum + Number(r.pris_oere || 0), 0);
}

async function firmaLofterOere(supabase, firmId, lofter) {
  const { data, error } = await supabase
    .from("firma_profil")
    .select("ai_maanedsloft_dkk, ai_dagsloft_dkk")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) throw laesefejl(`kunne ikke laese firma_profil (${error.message})`);
  // Firmaets egen vaerdi slaar standarden fra miljoeet. NULL, nul og noget, der
  // ikke er et tal, falder alle tilbage paa standarden - en tom kolonne maa
  // aldrig kunne blive til et loft paa nul.
  const eget = (felt, standard) => {
    const v = data && data[felt] != null ? Number(data[felt]) : null;
    return (Number.isFinite(v) && v > 0 ? v : standard) * 100;
  };
  return {
    maanedOere: eget("ai_maanedsloft_dkk", lofter.firmaMaanedDkk),
    dagOere: eget("ai_dagsloft_dkk", lofter.firmaDagDkk),
  };
}

function laesefejl(besked) {
  const f = new Error("Kvote: " + besked);
  f.kode = "kvote_laesning";
  return f;
}

// ─── Afgørelsen ──────────────────────────────────────────────────────────────
// Returnerer ALTID et objekt — kaster kun ved konfigurations- og læsefejl, som
// er vores problem og ikke brugerens.
//
// `maxPrisOere` er kaldekodens egen beregning af, hvad DETTE kald højst kan
// koste, givet det input den har begrænset. Udelades den, springes regel 2
// over — og det må kun ske for kald, der ikke kan variere i pris.
async function tjek({ firmId, maxPrisOere = null }, supabase, env) {
  if (!firmId) throw brugsfejl("firmId mangler");
  const lofter = hentLofter(env);
  const nu = new Date();

  // Regel 2 først: den er gratis, og den er den eneste, der kan afvise et kald,
  // som ellers ville gøre regel 1 til en blankocheck.
  if (maxPrisOere != null) {
    const kaldLoftOere = lofter.kaldDkk * 100;
    if (Number(maxPrisOere) > kaldLoftOere) {
      return nej("kald_for_stort",
        "Optagelsen er for lang til at kunne behandles i ét stykke. " +
        "Del den op, eller kontakt os.",
        { maxPrisOere: Number(maxPrisOere), loftOere: kaldLoftOere });
    }
  }

  const maaned = maanedsstart(nu);
  const dag = dagsstart(nu);

  const [firmaMaanedOere, firmaDagOere, firmaLoft, globaltMaanedOere] = await Promise.all([
    sumOere(supabase, maaned, firmId),
    sumOere(supabase, dag, firmId),
    firmaLofterOere(supabase, firmId, lofter),
    sumOere(supabase, maaned, null),
  ]);

  // Måneden først: den er den mere varige tilstand, og beskeden er den mest
  // brugbare. Rammer han begge, er det måneden, han skal vide noget om.
  if (firmaMaanedOere >= firmaLoft.maanedOere) {
    return nej("firma_maanedsloft",
      "Månedens forbrug er brugt op. Din optagelse er gemt her på telefonen — " +
      "skriv til os, hvis du har brug for mere denne måned.",
      { forbrugtOere: firmaMaanedOere, loftOere: firmaLoft.maanedOere,
        naesteNulstilling: naesteMaaned(nu) });
  }

  if (firmaDagOere >= firmaLoft.dagOere) {
    return nej("firma_dagsloft",
      "Du har lavet usædvanligt mange referater i dag, så vi holder pause til i " +
      "morgen. Din optagelse er gemt her på telefonen — skriv til os, hvis det " +
      "haster.",
      { forbrugtOere: firmaDagOere, loftOere: firmaLoft.dagOere });
  }

  // Det globale månedsloft er platformens egen nødbremse, ikke en besked til
  // kunden. Han har ikke gjort noget forkert og kan ikke gøre noget ved det.
  if (globaltMaanedOere >= lofter.globaltMaanedDkk * 100) {
    return nej("globalt_maanedsloft",
      "Vi kan ikke behandle optagelser lige nu. Din optagelse er gemt her på " +
      "telefonen — vi er på sagen.",
      { forbrugtOere: globaltMaanedOere, loftOere: lofter.globaltMaanedDkk * 100 });
  }

  return {
    tilladt: true,
    forbrugtOere: firmaMaanedOere,
    loftOere: firmaLoft.maanedOere,
    restOere: firmaLoft.maanedOere - firmaMaanedOere,
    forbrugtIDagOere: firmaDagOere,
    dagsloftOere: firmaLoft.dagOere,
  };
}

function nej(aarsag, besked, tal) {
  return Object.assign({ tilladt: false, aarsag, besked }, tal);
}

function naesteMaaned(nu) {
  const d = lokaleDele(nu);
  const enMaanedFrem = new Date(Date.UTC(d.aar, d.maaned, 1, 12));
  return maanedsstart(enMaanedFrem).toISOString();
}

// ─── Status — til fanen, FØR han trykker optag ───────────────────────────────
// Besluttet 29/9: han skal have besked, INDEN han har talt i to et halvt minut.
// En databaseforespørgsel er gratis; en tabt optagelse er ikke.
async function status({ firmId }, supabase, env) {
  if (!firmId) throw brugsfejl("firmId mangler");
  const lofter = hentLofter(env);
  const [forbrugtOere, forbrugtIDagOere, loft] = await Promise.all([
    sumOere(supabase, maanedsstart(), firmId),
    sumOere(supabase, dagsstart(), firmId),
    firmaLofterOere(supabase, firmId, lofter),
  ]);
  const loftOere = loft.maanedOere;
  const restOere = Math.max(0, loftOere - forbrugtOere);
  return {
    forbrugtOere, loftOere, restOere,
    forbrugtIDagOere, dagsloftOere: loft.dagOere,
    spaerret: forbrugtOere >= loftOere || forbrugtIDagOere >= loft.dagOere,
    // "Næsten opbrugt" er en ANDEL, ikke et antal kald. Et antal ville kræve et
    // gæt på, hvor lang en typisk diktering er — og det gæt ville stå i koden
    // som en sandhed, uden at nogen havde målt det.
    naestenOpbrugt: restOere > 0 && restOere < loftOere * 0.1,
    naesteNulstilling: naesteMaaned(new Date()),
  };
}

// ─── Bogføringen ─────────────────────────────────────────────────────────────
// Kaldes EFTER et vellykket kald, med den faktiske pris fra adapteren.
//
// ⚠️ KENDT HUL: rammer et kald adapterens timeout, kan leverandøren have udført
// arbejdet og afregnet det, uden at vi får et svar at bogføre. Forbruget
// undertælles. Hullet er lille og dokumenteret med vilje — en GÆTTET pris i en
// forbrugstabel er værre end en kendt mangel, fordi den ser rigtig ud.
async function bogfoer({ firmId, formaal, leverandoer, model, enhed, maengde, prisOere }, supabase) {
  for (const [navn, v] of Object.entries({ firmId, formaal, leverandoer, model, enhed })) {
    if (!v) throw brugsfejl(`${navn} mangler ved bogfoering`);
  }
  const { error } = await supabase.from("ai_forbrug").insert({
    firm_id: firmId, formaal, leverandoer, model, enhed,
    maengde: Number(maengde) || 0,
    pris_oere: Number(prisOere) || 0,
  });
  // En fejlet bogføring må ALDRIG vælte svaret til håndværkeren — han har fået
  // sit referat, og pengene er brugt. Men den skal være larmende i loggen, for
  // et forbrug, der ikke bogføres, er et loft, der ikke virker.
  if (error) {
    console.error("❌ ai_forbrug kunne ikke skrives:", error.message, { firmId, formaal });
    return { bogfoert: false };
  }
  return { bogfoert: true };
}

function brugsfejl(besked) {
  const f = new Error("Kvote: " + besked);
  f.kode = "kvote_brug";
  return f;
}

module.exports = {
  tjek, status, bogfoer,
  _hentLofter: hentLofter,
  _maanedsstart: maanedsstart,
  _dagsstart: dagsstart,
};
