// mail.js
// -----------------------------------------------------------------------------
// Delt mail-modul. Bruges af frisbii-webhook.js (velkomst + adminalarm) og
// onboarding-link.js (login-link-mail), saa hver mailtype kun vedligeholdes ét sted.
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
  //
  // FAIL-CLOSED (tilfoejet 3/7-26): uden for production UDEN override sendes
  // der INGENTING — en glemt/slettet MAIL_OVERRIDE_TO maa aldrig betyde, at
  // staging mailer rigtige modtagere med prod-creds. Blokeringen logges
  // hoejlydt, saa den er synlig i Railway-loggen og AppSignal-breadcrumbs.
  const isProd = process.env.APPSIGNAL_APP_ENV === "production";
  if (!isProd && !process.env.MAIL_OVERRIDE_TO) {
    console.error(
      `✋ Mail BLOKERET (ikke-production uden MAIL_OVERRIDE_TO): "${subject}" → ${to}. ` +
      "Saet MAIL_OVERRIDE_TO i miljoeet for at modtage staging-mails."
    );
    return { blocked: true };
  }
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
// Returnerer resultatet fra sendViaScaleway — herunder { blocked: true } hvis
// mailen blev stoppet af staging-gaten. Kaldsteder kan (og boer) logge derefter.
async function sendWelcomeMail({ to, firmName, loginUrl, phoneNumber }) {
  return await sendViaScaleway({
    to,
    fromEmail: process.env.SMTP_FROM,
    fromName:  process.env.APP_NAME || "Dit Digitale Kontor",
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

// ─── Send login-link-mail (rescue) ──────────────────────────────────────────
// Bruges af "Send mig et login-link"-endpointet (onboarding-link.js) til en
// EKSISTERENDE kunde, der er laast ude. Bevidst adskilt fra velkomstmailen:
// intet "velkommen"/"konto klar", ingen opsaetningsinstruks, ingen nummer-boks
// — og en tryghedslinje i bunden, hvis mailen skulle komme uopfordret.
// Gaar gennem samme sendViaScaleway-chokepoint, saa staging-gate/fail-closed
// gaelder automatisk. Returnerer ligeledes { blocked: true } ved blokering.
async function sendLoginLinkMail({ to, loginUrl, otpCode }) {
  // otpCode (6 cifre, valgfri) er samme engangstoken som linket, bare i
  // tastbar form. Den er vejen ind i den INSTALLEREDE app, hvor linket ellers
  // aabner i Safari (delt-lager-faelden — kodeopgave 1 i runbook). Mangler
  // koden, sendes mailen som foer, blot uden kode-afsnittet.
  // 4/10-26: med en kode er KODEN hovedsagen og linket en fodnote.
  // Foer stod en stor "Log ind"-knap oeverst. Trykker kunden paa den fra
  // Gmail, aabner linket i Chrome eller Gmails egen browser — uden hendes
  // session — og onboardingen starter forfra eller gaar i ring. Koden tastes
  // paa siden, hun allerede staar paa. Linket bliver staaende for den, der
  // laeser mailen paa en computer. Uden kode: mailen som foer.
  // Koden vises i to grupper (4+4 ved otte cifre, 3+3 ved seks), saa den kan
  // huskes som to smaa tal frem for ét langt. Grupperne er to spans med
  // luft imellem — IKKE et mellemrum i teksten — saa en kopi giver de rene
  // cifre. Kodefeltet fjerner i oevrigt selv mellemrum. Mail-programmer
  // koerer ikke JavaScript, saa en "Kopiér"-knap kan ikke laves i selve
  // mailen; et langt tryk paa koden er telefonens egen kopi-vej.
  const halv = otpCode && otpCode.length % 2 === 0 && otpCode.length >= 6 ? otpCode.length / 2 : 0;
  const kodeHtml = halv
    ? `<span style="margin-right:0.8em">${otpCode.slice(0, halv)}</span><span>${otpCode.slice(halv)}</span>`
    : (otpCode || "");
  const indhold = otpCode ? `
        <p style="color:#555;margin-bottom:16px">
          Her er din kode til Dit Digitale Kontor. Skriv den i feltet på skærmen, hvor du bad om den:
        </p>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px 24px;font-size:30px;
                    font-weight:700;letter-spacing:0.35em;text-align:center;margin-bottom:20px">
          ${kodeHtml}
        </div>
        <p style="color:#555;font-size:14px;margin-bottom:16px;text-align:center">
          Hold fingeren på koden for at kopiere den.
        </p>
        <p style="color:#555;font-size:14px;margin-bottom:8px">
          Tryk ikke på linket herunder, hvis du er i gang på din telefon. Det kan åbne en anden
          browser, hvor du ikke er logget ind, og så starter du forfra.
        </p>
        <p style="color:#555;font-size:14px">
          Sidder du ved en computer, kan du i stedet <a href="${loginUrl}" style="color:#2563eb">logge ind her</a>.
        </p>` : `
        <p style="color:#555;margin-bottom:24px">
          Du har bedt om et nyt login-link. Klik på knappen for at logge ind:
        </p>
        <a href="${loginUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;
                  border-radius:8px;text-decoration:none;font-weight:500;font-size:16px">
          Log ind
        </a>`;

  return await sendViaScaleway({
    to,
    fromEmail: process.env.SMTP_FROM,
    fromName:  process.env.APP_NAME || "Dit Digitale Kontor",
    // Koden i emnet, naar der ER en kode. To grunde, og den anden er den
    // vigtige:
    //   1. Kunden kan laese koden i notifikationen uden at aabne mailen.
    //   2. Emnet bliver UNIKT pr. bestilling. Med et fast emne folder
    //      mailklienten bestillingerne sammen i én traad, og bestilling nr. 2
    //      lander inde i en traad, kunden allerede har aabnet — usynlig.
    //      Praecis det skete 10/9-26: Scaleway sagde Delivered paa alle tre,
    //      og mail nr. 2 blev alligevel meldt savnet.
    subject:   otpCode
      ? `${halv ? otpCode.slice(0, halv) + " " + otpCode.slice(halv) : otpCode} er din kode til Dit Digitale Kontor`
      : "Dit login-link til Dit Digitale Kontor",
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
        <h1 style="font-size:22px;margin-bottom:8px">Hej</h1>
        ${indhold}
        <p style="color:#555;font-size:14px;margin-top:24px">
          Kode og link er gyldige i 24 timer og kan bruges én gang — bruger du
          den ene, gælder den anden ikke længere.
        </p>
        <p style="color:#aaa;font-size:13px;margin-top:32px">
          Har du ikke selv bedt om det, kan du roligt ignorere denne mail —
          der er ikke ændret noget på din konto.
        </p>
      </div>
    `,
  });
}

// ─── Send intern alarm til admin ────────────────────────────────────────────
// Bruges fx naar nummerpuljen er ved at loebe toer. Sendes til ADMIN_EMAIL
// (falder tilbage til SMTP_FROM, saa den virker selvom ADMIN_EMAIL ikke er sat).
// Returnerer resultatet fra sendViaScaleway ({ blocked: true } ved staging-gate).
async function sendAdminAlert({ subject, text }) {
  const to = process.env.ADMIN_EMAIL || process.env.SMTP_FROM;
  if (!to) {
    console.error("⚠️  Ingen ADMIN_EMAIL/SMTP_FROM sat — kan ikke sende alarm:", subject);
    return { blocked: true };
  }
  return await sendViaScaleway({
    to,
    fromEmail: process.env.SMTP_FROM,
    fromName:  `${process.env.APP_NAME || "Dit Digitale Kontor"} (system)`,
    subject:   `[Dit Digitale Kontor] ${subject}`,
    text,
  });
}

module.exports = { sendWelcomeMail, sendLoginLinkMail, sendAdminAlert };
