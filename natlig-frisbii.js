// natlig-frisbii.js
// -----------------------------------------------------------------------------
// D92 del 3b (29/10-26): den natlige Frisbii-kontrol. Koeres af en cron-service
// i Railway kl. 03:00 UTC (Ann 30/10: 04:00 dansk vintertid, 05:00 sommertid)
// og kan koeres i haanden:
//
//   node natlig-frisbii.js            -> koerer og sender mailen
//   node natlig-frisbii.js --ingen-mail  -> koerer og skriver mailen i terminalen
//
// LAESER KUN (Ann 29/10): hverken Frisbii eller databasen aendres.
//   1) Dead-letter: frisbii_webhook_events med tom processed_at. Eventet hentes
//      hos Frisbii for at finde abonnement og tidspunkt (raekken gemmer kun
//      id, event_id og event_type). Yngre end 15 min springes over.
//   2) Afstemning: koerer afstem-frisbii.js som den er (ingen dublet).
//   2b) T7b2: firmaer med Telefonpasser, men uden nummer (tom pulje).
//   3) EN mail til admin HVER nat - ogsaa naar alt er groent. Ellers kan
//      "ingen mail" betyde baade "groent" og "kontrollen koerte ikke".
//
// Supabase og Frisbii skal hoere til samme miljoe (frisbii-miljoe.js).
// Exit 0 = kontrollen koerte og mailen er sendt (uanset groent/roedt).
// Exit 1 = kontrollen kunne ikke koere, eller mailen kunne ikke sendes -
//          saa viser Railway koerslen som fejlet.
// Ingen persondata: kun handles, event-typer, id'er og fejltekster.
// -----------------------------------------------------------------------------
"use strict";

require("dotenv").config({ quiet: true });
const path = require("path");
const { spawnSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");
const { lavFrisbiiGet, bestemMiljoe } = require("./frisbii-miljoe");
const { udvaelgDeadLetter, ventendeNumre, lavRapport } = require("./frisbii-natlig");

const ingenMail = process.argv.includes("--ingen-mail");
const MAKS_EVENTS = 100; // hoejst saa mange Frisbii-opslag pr. nat

async function main() {
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FRISBII_PRIVATE_KEY"]) {
    if (!process.env[k]) throw new Error(`Mangler ${k} i miljoeet`);
  }
  const nu = new Date().toISOString();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hent = lavFrisbiiGet(process.env.FRISBII_PRIVATE_KEY);

  const { miljoe, handle, enig } = await bestemMiljoe(process.env.SUPABASE_URL, hent);
  if (!enig) throw new Error(`Supabase (${miljoe ? miljoe.navn : "ukendt projekt"}) og Frisbii-kontoen (${handle}) hoerer ikke til samme miljoe`);
  console.log(`NATLIG FRISBII-KONTROL  ${miljoe.navn}  ${nu}  (kun laesning)`);

  // 1) Dead-letter
  const { data: rows, error } = await supabase
    .from("frisbii_webhook_events").select("id, event_id, event_type, error")
    .is("processed_at", null);
  if (error) throw new Error(`frisbii_webhook_events: ${error.message}`);
  const events = {};
  for (const r of (rows || []).slice(0, MAKS_EVENTS)) {
    if (!r.event_id || r.event_id in events) continue;
    const e = await hent(`/event/${encodeURIComponent(r.event_id)}`);
    events[r.event_id] = e.ok && e.data ? { subscription: e.data.subscription || null, created: e.data.created || null } : null;
  }
  const deadLetter = udvaelgDeadLetter(rows, events, nu);
  console.log(`  dead-letter: ${deadLetter.length} (af ${(rows || []).length} med tom processed_at)`);

  // 2) Afstemning - samme script som i haanden
  const k = spawnSync(process.execPath, [path.join(__dirname, "afstem-frisbii.js")], {
    env: process.env, encoding: "utf8", timeout: 5 * 60 * 1000,
  });
  const afstem = { kode: k.status === null ? -1 : k.status, tekst: `${k.stdout || ""}${k.stderr || ""}${k.error ? "\n" + k.error.message : ""}` };
  console.log(`  afstemning: exit ${afstem.kode}`);

  // 2b) Venter paa nummer (T7b2)
  const { data: udenNr, error: uErr } = await supabase
    .from("firms").select("id, name, frisbii_subscription")
    .is("phone_number", null).not("frisbii_subscription", "is", null);
  if (uErr) throw new Error(`firms: ${uErr.message}`);
  const ids = (udenNr || []).map((f) => f.id);
  const { data: telRaekker, error: tErr } = ids.length
    ? await supabase.from("firma_moduler").select("firm_id, fra, til").eq("modul", "telefon").in("firm_id", ids)
    : { data: [], error: null };
  if (tErr) throw new Error(`firma_moduler: ${tErr.message}`);
  const venter = ventendeNumre(telRaekker, udenNr, nu);
  console.log(`  venter paa nummer: ${venter.length} (${venter.filter((v) => v.overDoegn).length} over et doegn)`);

  // 3) Rapport
  const rapport = lavRapport({ miljoe: miljoe.navn, deadLetter, afstem, nu, venter });
  console.log(`  ${rapport.subject}`);
  if (ingenMail) {
    console.log("\n--- mail (ikke sendt, --ingen-mail) ---\n" + rapport.text);
    return;
  }
  const { sendAdminAlert } = require("./mail");
  const svar = await sendAdminAlert({ subject: rapport.subject, text: rapport.text });
  if (svar && svar.blocked) throw new Error("mailen blev blokeret - se linjen ovenfor (ADMIN_EMAIL/SMTP_FROM, eller MAIL_OVERRIDE_TO uden for prod)");
  console.log("  mail sendt");
}

main().then(
  () => process.exit(0),
  (e) => { console.error(`❌ Natlig Frisbii-kontrol kunne ikke koere: ${e.message}`); process.exit(1); }
);
