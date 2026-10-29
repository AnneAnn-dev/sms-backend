// frisbii-webhook-synk.js
// -----------------------------------------------------------------------------
// Fase 3, T6 (29/10-26): hvad webhooken goer EFTER sin egen behandling, naar
// FASE3_SYNK=true. Ren logik uden Express, Supabase eller netvaerk, saa den
// kan proeves i CI (proev-frisbii-webhook-synk.js). frisbii-webhook.js kalder
// den med de rigtige funktioner.
//
// Model A (D25): webhooken er KUN et vaekkesignal. Ethvert event, der naevner
// et abonnement - ogsaa event-typer, vi ikke kender endnu - faar synkFirma til
// selv at hente sandheden fra Frisbii. Indholdet af eventet bruges aldrig.
//
// D92: ukendte event-typer blev bogfoert som behandlet uden et ord. Nu:
//   - ukendt event-type  -> altid en loglinje
//   - ukendt produkt     -> alarm til admin + kast (dead-letter). Synk har
//                           IKKE skrevet noget.
// Frisbii gensender IKKE et event af sig selv (maalt 29/10-26, D92): vi svarer
// 200 foer behandlingen. Alarmteksten siger derfor, hvad et menneske skal goere.
//   - synk fejler        -> alarm til admin + kast (dead-letter)
//
// FLAG SLUKKET: begge funktioner goer INTET. Webhooken opfoerer sig som foer.
// -----------------------------------------------------------------------------
"use strict";

// De event-typer, frisbii-webhook.js har en case for (369b0e74, 29/10-26).
// Bruges KUN til loglinjen: alle events med et abonnement synkes uanset.
const KENDTE_EVENTS = new Set([
  "invoice_settled",
  "subscription_created",
  "invoice_failed",
  "invoice_reactivate",
  "subscription_cancelled",
  "subscription_uncancelled",
  "subscription_expired",
  "subscription_on_hold_dunning",
  "subscription_expired_dunning",
  "subscription_reactivated",
  "invoice_refund",
]);

const kort = (id) => String(id || "").slice(0, 8);

// Sender en alarm, men lader aldrig en fejlet mail skjule den egentlige fejl.
async function sendAlarm(alarm, log, besked) {
  try {
    await alarm(besked);
  } catch (e) {
    log.error("⚠️  Kunne ikke sende alarm:", e && e.message);
  }
}

// Kaldes efter webhookens switch, foer markProcessed.
//   body:  webhookets indhold (kun event_type, id og subscription laeses)
//   aktiv: FASE3_SYNK
//   synk:  async (abonnement) => resultat fra synkFirma({ ..., skriv: true })
//   alarm: async ({ subject, text }) => ...   (sendAdminAlert)
//   log:   console
// Returnerer { handling, ... }. Kaster ved ukendt produkt og ved fejl i synk,
// saa webhooken bogfoerer fejlen (dead-letter) i stedet for "behandlet".
async function efterEvent({ body, aktiv, synk, alarm, log }) {
  if (!aktiv) return { handling: "slukket" };
  const type = body && body.event_type;
  const abonnement = body && body.subscription;

  if (!KENDTE_EVENTS.has(type)) {
    log.log(`ℹ️  Frisbii-event uden egen case: ${type} (id ${body && body.id}, abonnement ${abonnement || "-"}) - synkes, hvis det har et abonnement`);
  }
  if (!abonnement) return { handling: "intet abonnement" };

  const r = await synk(abonnement); // kaster ved fejl i Frisbii eller databasen

  if (r.status === "intet firma") {
    log.log(`ℹ️  Synk ${abonnement}: intet firma i databasen (${type}) - intet skrevet`);
    return { handling: "intet firma" };
  }
  if (r.status === "ukendt") {
    const ukendte = (r.saet && r.saet.ukendte) || [];
    log.error(`❌ Synk ${abonnement}: ukendt produkt hos Frisbii (${ukendte.join(", ")}) - INTET skrevet`);
    await sendAlarm(alarm, log, {
      subject: `Frisbii: ukendt produkt paa ${abonnement} - intet skrevet`,
      text:
        `Event: ${type} (id ${body.id})\nAbonnement: ${abonnement}\nFirma: ${kort(r.firma)}\n` +
        `Ukendt hos Frisbii: ${ukendte.join(", ")}\n\n` +
        `Synk har IKKE aendret firmaets moduler. Eventet staar i dead-letter.\n` +
        `Frisbii proever IKKE igen af sig selv.\n\n` +
        `Saadan:\n` +
        `1. Se paa det:  node gensynk-firma.js ${abonnement}\n` +
        `2. Ret kataloget (frisbii-katalog.js) eller abonnementet i Frisbii.\n` +
        `3. Gensend eventet i Frisbii (Webhooks), eller koer:  node gensynk-firma.js ${abonnement} --skriv`,
    });
    const fejl = new Error(`ukendt produkt paa ${abonnement}: ${ukendte.join(", ")}`);
    fejl.alarmSendt = true;
    throw fejl;
  }
  if (r.status !== "skrevet") {
    // synkFirma kaldes altid med skriv: true her; alt andet er en programfejl.
    throw new Error(`synk ${abonnement}: uventet status ${r.status}`);
  }

  const f = r.funktion || {};
  const dele = ["oprettet", "fornyet", "overtaget", "afsluttet", "slettet"]
    .filter((k) => f[k] && f[k].length)
    .map((k) => `${k} ${f[k].join("+")}`);
  log.log(`🔄 Synk ${abonnement} (${type}): firma ${kort(r.firma)} -> [${r.saet.moduler.join(", ")}] til ${r.saet.til}${dele.length ? " - " + dele.join(", ") : " - ingen aendring"}`);
  return { handling: "skrevet", funktion: f };
}

// Kaldes i webhookens catch. Med flaget taendt giver et fejlet event alarm
// (D92: foer var der ingen). En fejl, efterEvent allerede har alarmeret om,
// alarmeres ikke igen.
async function alarmVedFejl({ body, fejl, aktiv, alarm, log }) {
  if (!aktiv) return false;
  if (fejl && fejl.alarmSendt) return false;
  await sendAlarm(alarm, log, {
    subject: `Frisbii-webhook fejlede: ${body && body.event_type} ${body && body.subscription ? "paa " + body.subscription : ""}`.trim(),
    text:
      `Event: ${body && body.event_type} (id ${body && body.id})\nAbonnement: ${(body && body.subscription) || "-"}\n` +
      `Fejl: ${(fejl && fejl.message) || fejl}\n\n` +
      `Eventet staar i dead-letter (processed_at er tom). Frisbii proever IKKE igen af sig selv.\n\n` +
      `Saadan:\n` +
      `1. Find aarsagen:  select * from frisbii_webhook_events where processed_at is null;\n` +
      `2. Ret den.\n` +
      `3. Gensend eventet i Frisbii (Webhooks), saa koerer hele behandlingen igen.\n` +
      `   (gensynk-firma.js retter kun modulerne - ikke fx et firma, der aldrig blev oprettet.)`,
  });
  return true;
}

module.exports = { KENDTE_EVENTS, efterEvent, alarmVedFejl };
