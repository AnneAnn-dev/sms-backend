// ejerskab.js — ingen rute skal kunne skrive paa en fremmed raekke ved at
// glemme noget.
//
// HVORFOR DEN FINDES
//
// RLS beskytter LAESNING. Skrivning sker server-side med service-rollen og gaar
// altsaa uden om RLS — det er bevidst og samme moenster som `messages`, men det
// betyder, at det eneste, der staar mellem en forespoergsel og et fremmed
// firmas data, er at RUTEN husker at spoerge.
//
// To maader at glemme paa, og begge er sket i rigtige kodebaser:
//
//   1. Et id fra klienten bruges uden at tjekke, hvem det tilhoerer:
//        POST /api/tilbud/referater  { lead_id: "<en andens opgave>" }
//      Tokenet er aegte hele vejen. Raekken er bare ikke hans.
//
//   2. `firm_id` glemmes ved oprettelse. Det er det ENESTE felt, der ikke
//      kommer fra `req.body` — alle de andre staar i det, klienten sendte, og
//      `firm_id` kommer fra tokenet. Derfor falder netop den ud, naar nogen
//      bygger objektet ud fra formularens felter eller kopierer et insert fra
//      et sted, hvor kolonnen ikke fandtes. Og kolonnen er nullable, saa
//      databasen siger ja. Resultatet: en raekke, ingen politik kan se
//      (migration 20261007060000 forklarer hvorfor).
//
// Begge fejl handler om at HUSKE noget. Derfor goeres de to ting strukturelle
// her: en rute, der bruger hjaelperne, kan ikke lave fejlen, og en rute, der
// gaar uden om dem, kan ses i en diff.
//
// Den staerkere loesning — skriv med brugerens eget token, saa databasen
// haandhaever det — kraever INSERT/UPDATE/DELETE-politikker paa hver tabel og
// en klient pr. forespoergsel. Den hoerer til, naar modulets skriveflade er
// faerdig, og FOER den foerste betalende kunde. Ikke nu: man kan ikke skrive
// politikker for ruter, der ikke findes endnu.

"use strict";

function ejerskabsfejl(besked, kode) {
  const f = new Error("Ejerskab: " + besked);
  f.kode = kode;
  return f;
}

// ─── Oprettelse ──────────────────────────────────────────────────────────────
// Laeg ALTID felterne gennem denne. Den tilfoejer `firm_id`, og den kaster, hvis
// firmaet mangler — i stedet for at skrive en raekke, ingen kan se.
//
//   await supabase.from("leads").insert(medFirma(firmId, { name, address, task }));
//
// Den afviser ogsaa et `firm_id` i indholdet. Kommer der et felt af det navn
// ind, er det enten kopieret fra `req.body` — og saa bestemmer klienten, hvilket
// firma raekken havner i — eller det er sat to steder, og saa ved ingen hvilket
// der vinder. Begge dele skal fanges her og ikke opdages senere.
function medFirma(firmId, felter) {
  if (!firmId) {
    throw ejerskabsfejl(
      "firm_id mangler. Raekken ville blive skrevet og derefter vaere usynlig " +
      "for enhver klient — se migration 20261007060000.",
      "ejerskab_firma_mangler"
    );
  }
  if (felter && Object.prototype.hasOwnProperty.call(felter, "firm_id")) {
    throw ejerskabsfejl(
      "firm_id staar allerede i felterne. Det skal komme fra tokenet, aldrig " +
      "fra forespoergslen — ellers bestemmer klienten, hvis data det bliver.",
      "ejerskab_firma_dobbelt"
    );
  }
  return { ...(felter || {}), firm_id: firmId };
}

// ─── Laesning foer skrivning ─────────────────────────────────────────────────
// Henter raekken MED firmafilteret paa, eller kaster. Der findes ingen vej til
// en raekke, der ikke tilhoerer firmaet, fordi filteret er en del af
// hentningen — ikke et tjek bagefter, man kan komme til at springe over.
//
//   const opgave = await hentEgenRaekke(supabase, "leads", lead_id, firmId);
//
// `maybeSingle()` og ikke `single()`: `single()` kaster paa nul raekker med en
// Postgres-fejl, der ligner en driftsfejl. Nul raekker er ikke en driftsfejl —
// det er svaret "den er ikke din, eller den findes ikke", og de to maa ikke
// kunne skelnes udefra. Ville de det, kunne man taelle sig frem til, hvilke
// id'er der findes hos andre firmaer. (Primeren: aldrig `.single()` uden
// fallback.)
async function hentEgenRaekke(supabase, tabel, id, firmId, kolonner = "*") {
  if (!firmId) throw ejerskabsfejl("firm_id mangler", "ejerskab_firma_mangler");
  if (!id) throw ejerskabsfejl(`id mangler for '${tabel}'`, "ejerskab_id_mangler");

  const { data, error } = await supabase
    .from(tabel)
    .select(kolonner)
    .eq("id", id)
    .eq("firm_id", firmId)
    .maybeSingle();

  // En databasefejl er noget andet end en raekke, der ikke er din. Hold dem
  // adskilt — ellers bliver en nede database til "ikke fundet", og saa leder
  // man efter et forkert id i stedet for efter databasen.
  if (error) {
    throw ejerskabsfejl(
      `kunne ikke laese '${tabel}': ${error.message}`,
      "ejerskab_laesning"
    );
  }
  if (!data) {
    throw ejerskabsfejl(
      `ingen raekke i '${tabel}' med det id for dette firma`,
      "ejerskab_ikke_fundet"
    );
  }
  return data;
}

// ─── Opdatering ──────────────────────────────────────────────────────────────
// Samme tanke som ovenfor: filteret er en del af kaldet. Og `firm_id` kan ikke
// aendres med — en opdatering maa aldrig kunne flytte en raekke til et andet
// firma, heller ikke ved et uheld.
async function opdaterEgenRaekke(supabase, tabel, id, firmId, aendringer) {
  if (!firmId) throw ejerskabsfejl("firm_id mangler", "ejerskab_firma_mangler");
  if (!id) throw ejerskabsfejl(`id mangler for '${tabel}'`, "ejerskab_id_mangler");
  if (aendringer && Object.prototype.hasOwnProperty.call(aendringer, "firm_id")) {
    throw ejerskabsfejl(
      "en opdatering maa ikke aendre firm_id — det ville flytte raekken til et " +
      "andet firma",
      "ejerskab_firma_flyttes"
    );
  }

  const { data, error } = await supabase
    .from(tabel)
    .update(aendringer)
    .eq("id", id)
    .eq("firm_id", firmId)
    .select()
    .maybeSingle();

  if (error) {
    throw ejerskabsfejl(
      `kunne ikke opdatere '${tabel}': ${error.message}`,
      "ejerskab_skrivning"
    );
  }
  if (!data) {
    throw ejerskabsfejl(
      `ingen raekke i '${tabel}' med det id for dette firma`,
      "ejerskab_ikke_fundet"
    );
  }
  return data;
}

module.exports = { medFirma, hentEgenRaekke, opdaterEgenRaekke };
