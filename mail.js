// mail.js
// -----------------------------------------------------------------------------
// Delt mail-modul. Bruges af baade onboarding.js (Shopify) og frisbii-webhook.js,
// saa velkomstmailen kun vedligeholdes ét sted.
//
// Transport: Scaleway Transactional Email (TEM) HTTP-API over port 443.
// (Skiftet fra nodemailer/SMTP fordi Railway blokerer udgaaende SMTP-porte.)
//
// Paakraevede env vars paa Railway:
//   SCW_SECRET_KEY   Scaleway API secret key  (sendes som X-Auth-Token)
//   SCW_PROJECT_ID   Scaleway project ID
//   SCW_REGION       fx "fr-par"  (default hvis ikke sat)
//   SMTP_FROM        afsenderadresse, fx "noreply@ditdigitalekontor.dk"  (genbrugt)
//   APP_NAME         afsendernavn  (valgfri)
//   ADMIN_EMAIL      modtager for systemalarmer  (falder tilbage til SMTP_FROM)
//
// Bemaerk: bruger den indbyggede global fetch (Node 18+).
// -----------------------------------------------------------------------------

const SCW_REGION     = process.env.SCW_REGION || "fr-par";
const SCW_SECRET_KEY = process.env.SCW_SECRET_KEY;
const SCW_PROJECT_ID = process.env.SCW_PROJECT_ID;

const TEM_URL =
  `https://api.scaleway.com/transactional-email/v1alpha1/regions/${SCW_REGION}/emails`;

// ─── Delt lavniveau-send via Scaleway TEM ───────────────────────────────────
// fromName/fromEmail holdes som argumenter, saa de to mails kan beholde deres
// egne afsendernavne praecis som i den gamle SMTP-version.
async function sendViaScaleway({ to, subject, html, text, fromName, fromEmail }) {
  if (!SCW_SECRET_KEY || !SCW_PROJECT_ID || !fromEmail) {
    throw new Error(
      "Mail-config mangler: SCW_SECRET_KEY, SCW_PROJECT_ID og SMTP_FROM skal vaere sat."
    );
  }

  // --- Staging-sikkerhed: omdiriger ALT udgaaende mail til egen adresse ---
  // MAIL_OVERRIDE_TO bruges KUN uden for production. Selv hvis variablen ved en
  // fejl saettes i prod, IGNORERES den her (prod er gated paa
  // APPSIGNAL_APP_ENV === "production") — saa du behoever ikke at HUSKE reglen,
  // koden haandhaever den. Den oprindelige modtager laegges i emnet.
  const isProd = process.env.APPSIGNAL_APP_ENV === "production";
  if (process.env.MAIL_OVERRIDE_TO && !isProd) {
    subject = `[STAGING -> ${to}] ${subject}`;
    to = process.env.MAIL_OVERRIDE_TO;
  } else if (process.env.MAIL_OVERRIDE_TO && isProd) {
    // Fejlkonfiguration: override sat i prod. Send normalt til kunden, men raab op.
    console.error(
      "⚠️  MAIL_OVERRIDE_TO er sat i PRODUCTION og blev IGNORERET. Fjern den fra prod-miljoeet."
    );
  }

  const body = {
    from: { email: fromEmail, name: fromName },
    to: [{ email: to }],
    subject,
    project_id: SCW_PROJECT_ID,
  };
  if (html) body.html = html;
  // Scaleway kraever mindst ét af html/text; sikr altid en text-del.
  body.text = text || (html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");

  const res = await fetch(TEM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": SCW_SECRET_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Scaleway TEM ${res.status}: ${detail}`);
  }
  return res.json();
}

// ─── Send velkomstmail (magic link) ─────────────────────────────────────────
async function sendWelcomeMail({ to, firmName, loginUrl, phoneNumber }) {
  await sendViaScaleway({
    to,
    fromEmail: process.env.SMTP_FROM,
    fromName:  process.env.APP_NAME || "Håndværkerservice",
    subject:   `Velkommen, ${firmName} — din konto er klar`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
        <h1 style="font-size:22px;margin-bottom:8px">Velkommen, ${firmName}!</h1>
        <p style="color:#555;margin-bottom:24px">
          Din konto er oprettet og klar til brug. Dit dedikerede telefonnummer er:
        </p>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px 24px;font-size:22px;
                    font-weight:700;letter-spacing:0.05em;text-align:center;margin-bottom:24px">
          ${phoneNumber}
        </div>
        <p style="color:#555;margin-bottom:24px">
          Næste skridt: Log ind og færdiggør din opsætning — vælg stemme, skriv
          din velkomstbesked, og sæt viderestilling op på din telefon.
        </p>
        <a href="${loginUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;
                  border-radius:8px;text-decoration:none;font-weight:500;font-size:16px">
          Log ind og kom i gang
        </a>
        <p style="color:#aaa;font-size:13px;margin-top:32px">
          Linket er gyldigt i 24 timer. Har du spørgsmål? Svar på denne mail.
        </p>
      </div>
    `,
  });
}

// ─── Send intern alarm til admin ────────────────────────────────────────────
// Bruges fx naar nummerpuljen er ved at loebe toer. Sendes til ADMIN_EMAIL
// (falder tilbage til SMTP_FROM, saa den virker selvom ADMIN_EMAIL ikke er sat).
async function sendAdminAlert({ subject, text }) {
  const to = process.env.ADMIN_EMAIL || process.env.SMTP_FROM;
  if (!to) {
    console.error("⚠️  Ingen ADMIN_EMAIL/SMTP_FROM sat — kan ikke sende alarm:", subject);
    return;
  }
  await sendViaScaleway({
    to,
    fromEmail: process.env.SMTP_FROM,
    fromName:  `${process.env.APP_NAME || "Dit Digitale Kontor"} (system)`,
    subject:   `[Dit Digitale Kontor] ${subject}`,
    text,
  });
}

module.exports = { sendWelcomeMail, sendAdminAlert };
