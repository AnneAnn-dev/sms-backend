// proev-kvote.js — tørkørsel af kvote.js. Ingen database, ingen omkostning.
//
//   node proev-kvote.js
//
// Databasen erstattes af en attrap, så beslutningerne kan prøves med præcis de
// tal, der er svære at ramme i virkeligheden: lige under loftet, lige på, og
// hen over et sommertidsskifte.

"use strict";

const k = require("./kvote");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  —  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  —  ${d}`));
const lig = (n, faktisk, forventet) =>
  String(faktisk) === String(forventet) ? ok(n, faktisk) : nej(n, `fik ${faktisk}, forventede ${forventet}`);

// De FORESLAAEDE drifttal (primeren, OE2-regnearket).
const LOFTER_DRIFT = {
  AI_FIRMA_MAANEDSLOFT_DKK: "70",
  AI_FIRMA_DAGSLOFT_DKK: "10",
  AI_GLOBALT_MAANEDSLOFT_DKK: "500",
  AI_KALD_LOFT_DKK: "5",
};

// Til proeverne af MAANEDSLOFTET haeves dagsloftet, saa det ikke skygger.
// Faelden, som foerste koersel 29/9 gik i: et dagsloft under maanedsloftet
// betyder, at maanedsloftet aldrig kan rammes paa én dag - og en proeve, der
// lægger hele maanedens forbrug paa i dag, maaler saa dagsloftet uden at vide
// det. Dagsloftet proeves for sig med drifttallene.
const LOFTER = { ...LOFTER_DRIFT, AI_FIRMA_DAGSLOFT_DKK: "5000" };

// Attrap: raekker = liste af {firm_id, created_at, pris_oere}
function attrap({ raekker = [], firmaLoft = null, firmaDagsloft = null, fejlPaa = null }) {
  return {
    from(tabel) {
      if (tabel === "firma_profil") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                fejlPaa === "firma_profil"
                  ? { data: null, error: { message: "nede" } }
                  : { data: { ai_maanedsloft_dkk: firmaLoft, ai_dagsloft_dkk: firmaDagsloft }, error: null },
            }),
          }),
        };
      }
      const byg = (filtre) => ({
        gte(_, vaerdi) { return byg([...filtre, (r) => r.created_at >= vaerdi]); },
        eq(_, vaerdi)  { return byg([...filtre, (r) => r.firm_id === vaerdi]); },
        then(res) {
          const svar = fejlPaa === "ai_forbrug"
            ? { data: null, error: { message: "nede" } }
            : { data: raekker.filter((r) => filtre.every((f) => f(r))), error: null };
          res(svar);
        },
      });
      return { select: () => byg([]), insert: async () => ({ error: null }) };
    },
  };
}

const oere = (n, naar, firma = "F1") => ({ firm_id: firma, created_at: naar, pris_oere: n });
const IDAG = new Date().toISOString();
// Et tidspunkt i denne maaned, men (normalt) ikke i dag: maanedsstart + 1 minut.
// Koeres proeven den 1. i maaneden, er de to det samme dag - det er ikke en
// fejl, men proeven "spredt over maaneden" siger saa ikke noget den dag.
const TIDLIGERE = new Date(k._maanedsstart().getTime() + 60000).toISOString();

async function proev(navn, forventetAarsag, opsaetning, ekstra = {}, lofter = LOFTER) {
  try {
    const svar = await k.tjek({ firmId: "F1", ...ekstra }, attrap(opsaetning), lofter);
    const faktisk = svar.tilladt ? "tilladt" : svar.aarsag;
    lig(navn, faktisk, forventetAarsag);
  } catch (e) {
    lig(navn, `kastede ${e.kode}`, forventetAarsag);
  }
}

(async () => {
  console.log("\nKONFIGURATION — fail-closed som flags.js");
  for (const manglende of Object.keys(LOFTER)) {
    const uden = { ...LOFTER, [manglende]: "" };
    try { k._hentLofter(uden); nej(`${manglende} mangler`, "gik igennem"); }
    catch (e) { lig(`${manglende} mangler`, e.kode, "kvote_konfiguration"); }
  }
  try { k._hentLofter({ ...LOFTER, AI_KALD_LOFT_DKK: "nul" }); nej("ikke-tal afvises", "gik igennem"); }
  catch (e) { lig("ikke-tal afvises", e.kode, "kvote_konfiguration"); }
  try { k._hentLofter({ ...LOFTER, AI_KALD_LOFT_DKK: "-5" }); nej("negativt loft afvises", "gik igennem"); }
  catch (e) { lig("negativt loft afvises", e.kode, "kvote_konfiguration"); }
  ok("komma accepteres som decimal", JSON.stringify(k._hentLofter({ ...LOFTER, AI_KALD_LOFT_DKK: "5,50" }).kaldDkk));

  console.log("\nMAANEDSSTART I DANSK TID — ikke UTC");
  // Sommertid: 1. sept. kl. 00:00 dansk = 31. aug. kl. 22:00 UTC (CEST, +2)
  lig("midt i september", k._maanedsstart(new Date("2026-09-15T12:00:00Z")).toISOString(),
      "2026-08-31T22:00:00.000Z");
  // Vintertid: 1. jan. kl. 00:00 dansk = 31. dec. kl. 23:00 UTC (CET, +1)
  lig("midt i januar", k._maanedsstart(new Date("2026-01-15T12:00:00Z")).toISOString(),
      "2025-12-31T23:00:00.000Z");
  // 1. nov. ligger EFTER sommertidens ophør (sidste søndag i oktober)
  lig("1. november, efter skiftet", k._maanedsstart(new Date("2026-11-01T12:00:00Z")).toISOString(),
      "2026-10-31T23:00:00.000Z");
  // Kl. 00:30 dansk den 1. er ALLEREDE i den nye maaned — faelden ved UTC
  lig("kl. 00:30 dansk den 1. sept.", k._maanedsstart(new Date("2026-08-31T22:30:00Z")).toISOString(),
      "2026-08-31T22:00:00.000Z");
  lig("dagsstart, sommertid", k._dagsstart(new Date("2026-09-15T12:00:00Z")).toISOString(),
      "2026-09-14T22:00:00.000Z");

  console.log("\nAFGOERELSEN");
  await proev("tomt forbrug er tilladt", "tilladt", { raekker: [] });
  await proev("lige under loftet er tilladt", "tilladt", { raekker: [oere(6999, IDAG)] });
  await proev("praecis paa loftet spaerrer", "firma_maanedsloft", { raekker: [oere(7000, IDAG)] });
  await proev("over loftet spaerrer", "firma_maanedsloft", { raekker: [oere(7300, IDAG)] });
  await proev("et ANDET firmas forbrug taeller ikke med", "tilladt",
    { raekker: [oere(9000, IDAG, "F2")] });
  await proev("firmaets eget loft slaar standarden", "tilladt",
    { raekker: [oere(9000, IDAG)], firmaLoft: 200 });
  await proev("et SAENKET firmaloft spaerrer tidligere", "firma_maanedsloft",
    { raekker: [oere(1100, IDAG)], firmaLoft: 10 });

  console.log("\nDAGSLOFTET — pr. firma, besluttet 29/9");
  await proev("under dagsloftet er tilladt", "tilladt",
    { raekker: [oere(900, IDAG)] }, {}, LOFTER_DRIFT);
  await proev("paa dagsloftet spaerrer", "firma_dagsloft",
    { raekker: [oere(1000, IDAG)] }, {}, LOFTER_DRIFT);
  await proev("et ANDET firmas daarlige dag rammer os ikke", "tilladt",
    { raekker: [oere(9000, IDAG, "F2")] }, {}, LOFTER_DRIFT);
  await proev("gaar maanedsloftet OGSAA, er det maaneden der meldes",
    "firma_maanedsloft",
    { raekker: [oere(6000, TIDLIGERE), oere(1500, IDAG)] }, {}, LOFTER_DRIFT);
  await proev("firmaets eget dagsloft slaar standarden", "tilladt",
    { raekker: [oere(1500, IDAG)], firmaDagsloft: 30 }, {}, LOFTER_DRIFT);
  await proev("i gaars forbrug taeller ikke i dag", "tilladt",
    { raekker: [oere(900, TIDLIGERE), oere(900, IDAG)] }, {}, LOFTER_DRIFT);
  await proev("det globale maanedsloft er stadig en bremse", "globalt_maanedsloft",
    { raekker: [oere(50000, TIDLIGERE, "F2")] }, {}, LOFTER_DRIFT);

  console.log("\nKALDSLOFTET — regel 2, der holder regel 1");
  await proev("et kald under 5 kr slipper igennem", "tilladt", { raekker: [] }, { maxPrisOere: 33 });
  await proev("et kald over 5 kr afvises FOER databasen", "kald_for_stort",
    { raekker: [], fejlPaa: "ai_forbrug" }, { maxPrisOere: 501 });
  await proev("praecis 5 kr slipper igennem", "tilladt", { raekker: [] }, { maxPrisOere: 500 });

  console.log("\nFAIL-CLOSED — et ukendt forbrug er ikke et lavt forbrug");
  await proev("ai_forbrug utilgaengelig", "kastede kvote_laesning", { fejlPaa: "ai_forbrug" });
  await proev("firma_profil utilgaengelig", "kastede kvote_laesning", { fejlPaa: "firma_profil" });

  console.log("\nSTATUS — det fanen spoerger om, FOER han trykker optag");
  const s1 = await k.status({ firmId: "F1" }, attrap({ raekker: [oere(6600, IDAG)] }), LOFTER);
  lig("naesten opbrugt ved 94 %", s1.naestenOpbrugt, true);
  lig("ikke spaerret endnu", s1.spaerret, false);
  const s2 = await k.status({ firmId: "F1" }, attrap({ raekker: [oere(3000, IDAG)] }), LOFTER);
  lig("halvvejs er ikke 'naesten opbrugt'", s2.naestenOpbrugt, false);
  const s3 = await k.status({ firmId: "F1" }, attrap({ raekker: [oere(9000, IDAG)] }), LOFTER);
  lig("spaerret, og restOere gaar ikke i minus", `${s3.spaerret} ${s3.restOere}`, "true 0");
  const s4 = await k.status({ firmId: "F1" }, attrap({ raekker: [oere(1200, IDAG)] }), LOFTER_DRIFT);
  lig("dagsloftet alene giver ogsaa spaerret", s4.spaerret, true);

  console.log(`\n${bestaaet} bestaaet, ${fejlet} fejlet.`);
  if (fejlet) process.exit(1);
  console.log("\nNAESTE: migrationen paa staging, og saa kobles kvote.js paa");
  console.log("        POST /api/tilbud/transskriber (opgave 4).");
})();
