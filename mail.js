// mail.js
// -----------------------------------------------------------------------------
// Delt mail-modul. Bruges af baade onboarding.js (Shopify) og frisbii-webhook.js.
// Saa velkomstmailen kun vedligeholdes ét sted.
// -----------------------------------------------------------------------------

const nodemailer = require("nodemailer");

// ─── Send velkomstmail (magic link) ─────────────────────────────────────────
async function sendWelcomeMail({ to, firmName, loginUrl, phoneNumber }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from:    `"${process.env.APP_NAME || 'Håndværkerservice'}" <${process.env.SMTP_FROM}>`,
    to,
    subject: `Velkommen, ${firmName} — din konto er klar`,
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

module.exports = { sendWelcomeMail };
