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
const DOMAIN  = "lommekontor.dk";

// ── Record der skal tilfoejes (DKIM fra Scaleway) ───────────────────────────
const RECORD = {
  type: "TXT",
  name: "be25bfdf-bf2d-4a09-9d5b-fedab3e03e05._domainkey", // UDEN .lommekontor.dk
  data: "v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuW3ll8wkrwTsMfv7d20EXSjj6jOvfTgKMEJAOLtmVMAIWrUxTmPUfvgnfi8rM4/I71dKW0mC6RHsinc1iyH8lFiX8n5maC5I4tu7B04VK2jl1HV+eT+q2kd/ZKSlrmxMO8iIgmic1xVPswrO3fN6+GMguF3bsPTtxcEgHhsUIL+y/BSvBeTG5zbbTFx0PYR6pqp571/HAwwPf+NY+H9AgpltJvOiaJbtRIFSHclzIychZqDdJTswpmLtJr523WdVaN0/Y7jEKfmGN/YuGh3JEwIVibUmL5BDvuuC8K8Q3r4i8aWil2hYNxI4eHmz1/JYSt19XQZWqOK3t3ZcjeNbGQIDAQAB",
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
