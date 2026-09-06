// tjek-frisbii-telefon.js
// -----------------------------------------------------------------------------
// FASE 0.1 i testplanen: returnerer Frisbii et telefonnummer paa kunden?
//
// D49-rettelsen henter haandvaerkerens eget mobilnummer i `provisionFirm()` med
//     const ownerPhone = danskMobil(normalizePhone(customer.phone));
// hvor `customer` kommer fra `frisbiiGet("/customer/<handle>")`.
//
// `/checkout/start` SENDER nummeret ind som `create_customer.phone` — men at et
// felt sendes ind, beviser ikke at det kommer ud igen. Er `phone` tom i svaret,
// er hele rettelsen uvirksom, og saa er der ingen grund til at teste den paa en
// telefon bagefter. Det her script svarer paa det, foer den dyre runde.
//
// Scriptet LAESER kun: firmaernes `frisbii_customer`-handles fra Supabase, og
// derefter kunden hos Frisbii. Ingen skrivninger nogen steder.
//
//   cd C:\Users\Bruger\sms-backend
//   node tjek-frisbii-telefon.js          # de 10 nyeste
//   node tjek-frisbii-telefon.js 25       # flere
//
// Miljoeet kommer fra `.env` — den peger paa STAGING som standard. Vil du maale
// prod, saa gaa gennem skift-prod.ps1 som altid; scriptet vaelger ikke selv.
// -----------------------------------------------------------------------------

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const FRISBII_API = "https://api.frisbii.com/v1";   // samme konstant som frisbii-webhook.js
const ANTAL = Number(process.argv[2]) || 10;

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRISBII_PRIVATE_KEY } = process.env;

for (const [navn, vaerdi] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRISBII_PRIVATE_KEY })) {
  if (!vaerdi) {
    console.error(`❌ ${navn} mangler i .env — kan ikke koere.`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const auth     = Buffer.from(`${FRISBII_PRIVATE_KEY}:`).toString("base64");

// Maskering: numre og mails er personoplysninger, ogsaa i en terminal, der
// bliver til et skaermbillede i en chat. Samme budget som phone.js.
const mask = (v) => (!v ? v : String(v).slice(0, 5) + "*".repeat(Math.max(0, String(v).length - 5)));

async function frisbiiGet(sti) {
  const r = await fetch(`${FRISBII_API}${sti}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

(async () => {
  const { data: firms, error } = await supabase
    .from("firms")
    .select("id, name, frisbii_customer, owner_phone")
    .not("frisbii_customer", "is", null)
    .order("id", { ascending: false })
    .limit(ANTAL);

  if (error) {
    console.error("❌ Kunne ikke laese firms:", error.message);
    process.exit(1);
  }
  if (!firms.length) {
    console.log("Ingen firmaer med frisbii_customer i dette miljoe.");
    console.log("→ Test kan ikke gennemfoeres her. Koer et checkout foerst, eller maal i det miljoe hvor der ER kunder.");
    return;
  }

  console.log(`\nSpoerger Frisbii om ${firms.length} kunde(r) — leder efter feltet 'phone'.\n`);

  let medTelefon = 0, fejlede = 0;
  let feltnavne = new Set();

  for (const f of firms) {
    try {
      const c = await frisbiiGet(`/customer/${encodeURIComponent(f.frisbii_customer)}`);
      Object.keys(c).forEach((k) => feltnavne.add(k));
      const har = !!(c.phone && String(c.phone).trim());
      if (har) medTelefon++;
      console.log(
        `  ${har ? "✅" : "  "} ${String(f.name).slice(0, 22).padEnd(22)} ` +
        `frisbii.phone=${har ? mask(c.phone) : "(tom)"}   ` +
        `firms.owner_phone=${f.owner_phone ? mask(f.owner_phone) : "(null)"}`
      );
    } catch (e) {
      fejlede++;
      console.log(`  ⚠️  ${String(f.name).slice(0, 22).padEnd(22)} opslag fejlede — ${e.message}`);
    }
  }

  console.log(`\n${medTelefon} af ${firms.length} kunder har et 'phone'-felt med indhold.`);
  if (fejlede) console.log(`${fejlede} opslag fejlede — se linjerne ovenfor.`);

  console.log("\n── Dom ──────────────────────────────────────────────────────");
  if (medTelefon > 0) {
    console.log("✅ Frisbii RETURNERER telefonnummeret. D49-rettelsen kan virke.");
    console.log("   Videre til fase 0.2 i testplanen.");
  } else {
    console.log("⚠️  INGEN af kunderne har et udfyldt 'phone'. To vidt forskellige");
    console.log("   forklaringer, og de kan ikke skelnes herfra:");
    console.log("     (a) Frisbii returnerer feltet, men ingen af DE HER kunder");
    console.log("         fik tastet et nummer ind ved tilmeldingen.");
    console.log("     (b) Feltet kommer aldrig med ud — saa er D49 uvirksom.");
    console.log("");
    console.log("   Afgoer det saadan: slaa én af kunderne op i Frisbii-konsollen.");
    console.log("     · Staar der et nummer i konsollen, men ikke her → (b),");
    console.log("       og nummeret skal hentes et andet sted fra. Rul D49 ud.");
    console.log("     · Er konsollen ogsaa tom → (a). Koer ét checkout MED");
    console.log("       telefonnummer og koer scriptet igen.");
    if (feltnavne.size) {
      console.log("");
      console.log("   Felter Frisbii faktisk sendte (leder du efter et andet navn?):");
      console.log("   " + [...feltnavne].sort().join(", "));
    }
  }
  console.log("");
})().catch((e) => {
  console.error("❌ Uventet fejl:", e.message);
  process.exit(1);
});
