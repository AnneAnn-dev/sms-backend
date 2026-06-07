// test-mail.js
// Isoleret test af SMTP. Sender én velkomstmail via din mail.js — rører
// hverken Frisbii eller databasen.
//
// Brug:  node test-mail.js din@email.dk
//        (udelades adressen, sendes den til SMTP_FROM)

require("dotenv").config({ quiet: true });
const { sendWelcomeMail } = require("./mail");

const to = process.argv[2] || process.env.SMTP_FROM;

(async () => {
  console.log("Sender testmail til:", to, "via", process.env.SMTP_HOST);
  try {
    await sendWelcomeMail({
      to,
      firmName:    "Test Firma ApS",
      loginUrl:    "https://sms-backend-production-5ee1.up.railway.app/dashboard",
      phoneNumber: "+45 12 34 56 78",
    });
    console.log("✅ Mail sendt — tjek indbakken (og spam-mappen).");
  } catch (err) {
    console.error("❌ Mail fejlede:", err.message);
    if (/EAUTH|Invalid login/i.test(err.message)) console.error("   → forkert SMTP_USER eller SMTP_PASS");
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(err.message)) console.error("   → forkert SMTP_HOST eller SMTP_PORT");
  }
})();
