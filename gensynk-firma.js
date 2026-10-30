// gensynk-firma.js
// -----------------------------------------------------------------------------
// Fase 3, T5 (29/10-26): synk et firmas moduler fra Frisbii i haanden.
// Afloeser haandskrevet SQL, naar et webhook er gaaet tabt eller er bogfoert
// som behandlet uden at goere noget (D42, D92).
//
//   node gensynk-firma.js <abonnement>                     -> toerkoersel
//   node gensynk-firma.js <abonnement> --skriv             -> skriver
//   node gensynk-firma.js <abonnement> --skriv --ignorer-ukendte
//        skriver de moduler, kataloget KENDER, selv om Frisbii ogsaa har et
//        ukendt produkt. Kun et menneske bruger dette flag - aldrig webhooken.
//
// T7b (30/10): med --skriv foelger NUMMERET bagefter modulerne (frisbii-nummer.js):
// Telefonpasser koebt + intet nummer -> tildel og send "Dit nummer er klar";
// ikke koebt + nummer -> frigiv (karantaene efter verifikation, D95). Toerkoerslen
// viser, hvad der ville ske. Kraever TWILIO_ACCOUNT_SID og TWILIO_AUTH_TOKEN,
// naar et nummer skal tildeles (puljen verificeres hos Twilio).
//
// Supabase og Frisbii skal hoere til samme miljoe (frisbii-miljoe.js).
// I PROD skal abonnementets handle skrives igen, foer der skrives.
// Bagefter: node afstem-frisbii.js.
//
// Ingen persondata: kun firma-id (8 tegn), handles, moduler og datoer.
// -----------------------------------------------------------------------------
"use strict";

require("dotenv").config({ quiet: true });
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");
const { lavFrisbiiGet, bestemMiljoe } = require("./frisbii-miljoe");
const { synkFirma } = require("./frisbii-synk");
const { nummerPlan } = require("./telefon-nummer");
const { nummerOgBesked } = require("./frisbii-nummer");

const abonnement = process.argv[2];
const skriv = process.argv.includes("--skriv");
const ignorerUkendte = process.argv.includes("--ignorer-ukendte");
if (!abonnement || abonnement.startsWith("--")) {
  console.log("Brug: node gensynk-firma.js <abonnement> [--skriv] [--ignorer-ukendte]");
  process.exit(2);
}
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FRISBII_PRIVATE_KEY"]) {
  if (!process.env[k]) { console.error(`Mangler ${k} i miljoeet. Intet er laest.`); process.exit(1); }
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const hent = lavFrisbiiGet(process.env.FRISBII_PRIVATE_KEY);

const kort = (id) => String(id).slice(0, 8);
const visRaekker = (rs) => (rs && rs.length
  ? rs.slice().sort((x, y) => x.modul.localeCompare(y.modul)).map((r) => `   ${r.modul.padEnd(9)} kilde=${r.kilde.padEnd(9)} til=${r.til || "(ingen)"}`).join("\n")
  : "   (ingen raekker)");
function spoerg(tekst) {
  return new Promise((ok) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(tekst, (svar) => { rl.close(); ok(svar.trim()); }); });
}

(async () => {
  const nu = new Date().toISOString();
  const { miljoe, handle, enig } = await bestemMiljoe(process.env.SUPABASE_URL, hent);
  console.log("=".repeat(72));
  console.log(`GENSYNK ${abonnement}  ${skriv ? "[SKRIVER]" : "(toerkoersel)"}${ignorerUkendte ? "  [--ignorer-ukendte]" : ""}  ${nu}`);
  console.log(`  Supabase:      ${miljoe ? miljoe.navn + " (" + miljoe.ref + ")" : "UKENDT projekt"}`);
  console.log(`  Frisbii-konto: ${handle}`);
  console.log("=".repeat(72));
  if (!enig) { console.log("STOP: Supabase og Frisbii hoerer ikke til samme miljoe. Intet laest, intet skrevet."); process.exit(1); }

  if (skriv && miljoe.navn === "prod") {
    const svar = await spoerg(`PROD. Skriv abonnementets handle (${abonnement}) for at skrive: `);
    if (svar !== abonnement) { console.log("Afbrudt. Intet skrevet."); process.exit(1); }
  }

  let r;
  try {
    r = await synkFirma({ supabase, hent, abonnement, nu, skriv, ignorerUkendte });
  } catch (e) {
    console.log(`FEJL: ${e.message}\nIntet er skrevet (eller hele kaldet er rullet tilbage).`);
    process.exit(1);
  }
  if (r.status === "intet firma") {
    console.log(`\nIntet firma i databasen har abonnementet ${abonnement}. Se afstem-frisbii.js (D93).`);
    process.exit(1);
  }

  console.log(`\nFirma ${kort(r.firma)}`);
  console.log(`Frisbii siger: ${r.saet.grund}, moduler [${r.saet.moduler.join(", ")}], til ${r.saet.til}`);
  if (r.saet.ukendte.length) console.log(`Ukendt hos Frisbii: ${r.saet.ukendte.join(", ")}`);
  console.log("\nDatabasen foer:\n" + visRaekker(r.foer));
  const { data: firmaNr } = await supabase.from("firms").select("phone_number").eq("id", r.firma).maybeSingle();
  const harNummer = !!(firmaNr && firmaNr.phone_number);
  const plan = nummerPlan({ saet: r.saet, harNummer, nu });
  const PLAN_TEKST = { tildel: "TILDELES et nummer fra puljen", frigiv: "FRIGIVES (karantaene, hvis det har vaeret verificeret)", behold: "beholdes (koebt, men ikke aktiv: respit)", intet: harNummer ? "uaendret (har nummer)" : "uaendret (intet nummer, Telefonpasser ikke koebt)" };
  console.log(`Nummer: ${PLAN_TEKST[plan]}`);
  console.log(r.uenig.length ? "\nUenigt foer:\n" + r.uenig.map((u) => "   ! " + u).join("\n") : "\nEnigt foer.");

  if (r.status === "ukendt") {
    console.log("\nSKREV INTET: Frisbii har et produkt, kataloget ikke kender. Ret kataloget eller abonnementet.");
    console.log("Vil et menneske alligevel skrive de kendte moduler: tilfoej --ignorer-ukendte.");
    process.exit(2);
  }
  if (r.status === "toerkoersel") {
    console.log("\nTOERKOERSEL: intet skrevet. Koer igen med --skriv for at skrive netop dette saet.");
    process.exit(0);
  }
  console.log("\nSKREVET. Funktionen svarede:");
  for (const k of ["oprettet", "fornyet", "overtaget", "afsluttet", "slettet"]) {
    const v = r.funktion && r.funktion[k];
    if (v && v.length) console.log(`   ${k.padEnd(10)} ${v.join(", ")}`);
  }
  console.log("\nDatabasen efter:\n" + visRaekker(r.efter));

  // T7b: nummeret foelger modulerne.
  if (plan === "tildel" || plan === "frigiv") {
    let twilioClient = null;
    if (plan === "tildel") {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        console.log("\nNUMMER IKKE TILDELT: mangler TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN i miljoeet. Modulerne ER skrevet.");
        process.exit(1);
      }
      twilioClient = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
    const { sendAdminAlert, sendNummerKlarMail } = require("./mail");
    const n = await nummerOgBesked({
      supabase, twilioClient, alarm: sendAdminAlert, log: console,
      sendNummerKlar: sendNummerKlarMail, loginUrl: `${process.env.BASE_URL || ""}/dashboard`,
    }, r);
    console.log(`\nNummer: ${n.status}${n.status === "tildelt" ? (n.mailSendt ? " - kunden har faaet 'Dit nummer er klar'" : " - MAILEN BLEV IKKE SENDT, giv kunden besked") : ""}${n.karantaeneTil ? " - karantaene til " + n.karantaeneTil : ""}`);
    if (n.status === "tom") { console.log("Puljen er stadig tom. Laeg numre i phone_numbers og koer igen."); process.exit(2); }
  }
  console.log("\nKoer nu: node afstem-frisbii.js");
})();
