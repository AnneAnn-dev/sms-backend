// test-mail.js
// -----------------------------------------------------------------------------
// Lille lokal test: sender ÉN mail via Scaleway TEM HTTP-API og printer
// et klart svar. Koer den naar DNS i Scaleway er groen, for at bekraefte at
// dine noegler + verificering virker — UDEN at skulle trigge en Frisbii-tilmelding.
//
// Brug (PowerShell):
//   node test-mail.js                 -> sender til ADMIN_EMAIL (eller SMTP_FROM)
//   node test-mail.js dig@firma.dk    -> sender til den adresse du angiver
//
// Laeser samme env vars som mail.js fra din lokale .env:
//   SCW_SECRET_KEY, SCW_PROJECT_ID, SCW_REGION, SMTP_FROM, APP_NAME
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });

const SCW_REGION     = process.env.SCW_REGION || "fr-par";
const SCW_SECRET_KEY = process.env.SCW_SECRET_KEY;
const SCW_PROJECT_ID = process.env.SCW_PROJECT_ID;
const FROM_EMAIL     = process.env.SMTP_FROM;
const FROM_NAME      = process.env.APP_NAME || "LommeKontor";

const TO = process.argv[2] || process.env.ADMIN_EMAIL || FROM_EMAIL;

const TEM_URL =
  `https://api.scaleway.com/transactional-email/v1alpha1/regions/${SCW_REGION}/emails`;

async function main() {
  // 1) Tjek at alt det noedvendige er sat, foer vi overhovedet kalder ud.
  const mangler = [];
  if (!SCW_SECRET_KEY) mangler.push("SCW_SECRET_KEY");
  if (!SCW_PROJECT_ID) mangler.push("SCW_PROJECT_ID");
  if (!FROM_EMAIL)     mangler.push("SMTP_FROM");
  if (!TO)             mangler.push("modtager (ADMIN_EMAIL eller argument)");

  if (mangler.length) {
    console.error("❌ Mangler foer test kan koere:", mangler.join(", "));
    console.error("   Tjek din .env — eller giv en modtager med: node test-mail.js dig@firma.dk");
    process.exit(1);
  }

  console.log("→ Region:     ", SCW_REGION);
  console.log("→ Afsender:   ", `${FROM_NAME} <${FROM_EMAIL}>`);
  console.log("→ Modtager:   ", TO);
  console.log("→ Sender...\n");

  // 2) Send.
  let res;
  try {
    res = await fetch(TEM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": SCW_SECRET_KEY,
      },
      body: JSON.stringify({
        from: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: TO }],
        subject: "LommeKontor — testmail via Scaleway TEM",
        text: "Hvis du laeser denne mail, virker Scaleway-noeglerne og DNS-verificeringen. 🎉",
        html: `<div style="font-family:system-ui,sans-serif;padding:24px">
                 <h2>Det virker 🎉</h2>
                 <p>Scaleway TEM-noeglerne og DNS-verificeringen er paa plads.
                 Din velkomstmail kan nu sendes i produktion.</p>
               </div>`,
        project_id: SCW_PROJECT_ID,
      }),
    });
  } catch (err) {
    console.error("❌ Netvaerksfejl — kunne slet ikke naa Scaleway:", err.message);
    process.exit(1);
  }

  // 3) Fortolk svaret med konkrete hints paa de typiske fejl.
  const tekst = await res.text();
  if (res.ok) {
    console.log("✅ Sendt! Scaleway accepterede mailen.");
    console.log("   Tjek modtagerens indbakke (og spam de foerste gange).");
    console.log("   Svar:", tekst);
    return;
  }

  console.error(`❌ Scaleway afviste (HTTP ${res.status}):`);
  console.error("   ", tekst);
  if (res.status === 401 || res.status === 403)
    console.error("   → Hint: forkert/ugyldig SCW_SECRET_KEY, eller noeglen mangler rettigheder.");
  if (res.status === 400 && /domain/i.test(tekst))
    console.error("   → Hint: afsenderdomaenet er ikke verificeret endnu (DNS ikke groen), " +
                  "eller SMTP_FROM ligger ikke paa lommekontor.dk.");
  if (res.status === 404)
    console.error("   → Hint: tjek SCW_REGION (skal typisk vaere fr-par).");
  process.exit(1);
}

main();
