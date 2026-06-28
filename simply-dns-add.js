// simply-dns-add.js
// -----------------------------------------------------------------------------
// Tilfoejer en DNS-record til Simply via deres API. Bruges naar web-panelet
// afviser lange vaerdier (fx DKIM-noegler over 255 tegn) — API'et deler selv.
//
// Brug:
//   1. Opret en API-noegle i Simply kontrolpanel: Account → API keys.
//   2. Saet SIMPLY_ACCOUNT (dit kontonr., fx S123456) og SIMPLY_API_KEY
//      i din .env (eller direkte nedenfor).
//   3. node simply-dns-add.js
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });

const ACCOUNT = process.env.SIMPLY_ACCOUNT;  // fx "S123456"
const API_KEY = process.env.SIMPLY_API_KEY;  // fra kontrolpanelet
const DOMAIN  = "ditdigitalekontor.dk";

// ── Record der skal tilfoejes (DKIM fra Scaleway, ditdigitalekontor.dk) ──────
// VIGTIGT: name er RELATIVT (uden .ditdigitalekontor.dk) — ellers bliver det
// til ...domainkey.ditdigitalekontor.dk.ditdigitalekontor.dk (faelden fra sidst).
// Selectoren er den samme som paa lommekontor.dk (delt Scaleway-projektnoegle),
// men selve noeglen (p=...) er en ANDEN — kopieret fra Scaleway DNS Records-fanen
// for ditdigitalekontor.dk.
const RECORD = {
  type: "TXT",
  name: "be25bfdf-bf2d-4a09-9d5b-fedab3e03e05._domainkey", // UDEN .ditdigitalekontor.dk
  data: "v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1R03bJMVSdEPKVI8ONjlz0TvwyL48L3XsXMUeAtdj/YuE1QXqydubi/50BFiaOPnYazXei/s5bPVpYIQgO1ia2GqMw7sGZxoUvowjy+mb97bZIcHQcMs2YnTiYQcKycPKySlloK1hPNZ3WJRE6j8InLyeF4fN5iku5IgCDbXTuN4beNCzUab25FMmWNYa7o6xDX+4y0chL5N+880prf8n3ZJyw7Z9tAVglfA6W3RqXjNBEv1EpHmTGvScpE5EPDE46mbB2EtYIlVaF+S1de1R8jATpngKMW8VJ+MyPAutYt/Hlq6rkrBjWflWg13pP34q/J7+tMveqZIFBXJ5duPLwIDAQAB",
  ttl: 3600,
};

(async () => {
  if (!ACCOUNT || !API_KEY) {
    console.error("❌ Saet SIMPLY_ACCOUNT (Sxxxxxx) og SIMPLY_API_KEY i .env foerst");
    process.exit(1);
  }

  const auth = Buffer.from(`${ACCOUNT}:${API_KEY}`).toString("base64");
  const url  = `https://api.simply.com/2/my/products/${DOMAIN}/dns/records/`;

  console.log(`Tilfoejer ${RECORD.type}-record "${RECORD.name}" til ${DOMAIN} ...`);
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body:    JSON.stringify(RECORD),
    });
    const text = await res.text();
    if (res.ok) {
      console.log("✅ Record tilfoejet:", text);
    } else {
      console.error(`❌ Fejl ${res.status}:`, text);
      if (res.status === 401) console.error("   → tjek SIMPLY_ACCOUNT og SIMPLY_API_KEY");
    }
  } catch (err) {
    console.error("❌ Kunne ikke kontakte Simply API:", err.message);
  }
})();
