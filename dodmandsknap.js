// dodmandsknap.js
// -----------------------------------------------------------------------------
// D3 (foerste del): doedmandsknap paa opkalds-stilhed. Twilio-webhooken kan
// stoppe -- forkert nummer-routing, signaturafvisning der blokerer AEGTE
// opkald (se S13), appen selv nede -- uden at noget nogensinde siger fra:
// ingen exception, ingen roed loglinje, bare stilhed. Dette script tjekker om
// der er kommet mindst ét opkald inden for de sidste DOEDMANDS_TIMER timer,
// og alarmerer admin (sendAdminAlert, mail.js) hvis ikke -- men KUN inden for
// arbejdstiden paa hverdage, saa den ikke larmer om natten eller i weekenden.
//
// BEVIDST UDELADT her: delivery-failure-rate (anden halvdel af D3 i
// risikoregistret). Byg det som en separat opgave, én ting ad gangen.
//
// Koeres IKKE loebende i selve app-processen. Laegges som en separat Railway-
// service med et "Cron Schedule" og startkommando `node dodmandsknap.js` --
// saa fyrer alarmen ogsaa hvis hovedappen selv er nede, ikke kun hvis den
// koerer men webhooken svigter. Se samtalen/runbogen for opsaetningstrin.
//
// Kraever i miljoeet (samme variabler som hovedappen -- brug Railways delte
// miljoevariabler til denne service i stedet for at dobbelttaste dem. Det er
// praecis den faelde D16/AA2 handler om, blot i en ny service):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SCW_SECRET_KEY, SCW_PROJECT_ID, SMTP_FROM     (mail.js's egne krav)
//   ADMIN_EMAIL                                    (ellers falder mail.js tilbage til SMTP_FROM)
//   APPSIGNAL_APP_ENV=production                   (ellers blokerer mail.js's egen staging-gate, se mail.js)
//
// Valgfrit (fornuftige standarder, ingen Railway-opsaetning kraevet for at starte):
//   DOEDMANDS_TIMER=4        sammenhaengende timer uden opkald foer alarm
//   ARBEJDSTID_START=7       time paa dagen (Europe/Copenhagen), inklusiv
//   ARBEJDSTID_SLUT=17       time paa dagen (Europe/Copenhagen), eksklusiv
//
// KENDT AFVEJNING: scriptet husker intet mellem koersler. Saa laenge
// stilheden varer, sender HVER koersel en ny mail (fx hvert 30. min, alt
// efter cronnens interval). Det er med vilje -- en insisterende alarm er
// sikrere end en tavs, og en koeletid er en senere finpudsning, ikke en
// forudsaetning for at goere gavn. Bliver det for meget: saet cronnens
// interval op, eller byg en koeletid i en senere opgave.
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { sendAdminAlert } = require("./mail");

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`Mangler ${k} i miljoeet.`); process.exit(1); }
}

const DOEDMANDS_TIMER  = Number(process.env.DOEDMANDS_TIMER  || 4);
const ARBEJDSTID_START = Number(process.env.ARBEJDSTID_START || 7);
const ARBEJDSTID_SLUT  = Number(process.env.ARBEJDSTID_SLUT  || 17);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Lokal tid i Koebenhavn, uden ekstra afhaengighed ────────────────────────
// D12: alt i UTC i databasen, konvertér KUN ved visning -- dette er den
// visning. Bruger en-US til selve ugedagsteksten (stabilt "Mon".."Sun" paa
// tvaers af Node/ICU-versioner) i stedet for da-DK's forkortelser, som viste
// sig at have et afsluttende punktum ("lør.", "søn.") -- ét ekstra tegn der
// ville have brudt sammenligningen tavst.
function koebenhavnNu() {
  const dele = new Intl.DateTimeFormat("en-US", {
    timeZone:  "Europe/Copenhagen",
    weekday:   "short",
    hour:      "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const ugedag = dele.find((d) => d.type === "weekday").value; // "Mon".."Sun"
  const time   = Number(dele.find((d) => d.type === "hour").value);
  return { ugedag, time };
}

(async () => {
  const { ugedag, time } = koebenhavnNu();
  const weekend = ugedag === "Sat" || ugedag === "Sun";

  if (weekend) {
    console.log(`Weekend (${ugedag}) — intet tjek.`);
    process.exit(0);
  }
  if (time < ARBEJDSTID_START || time >= ARBEJDSTID_SLUT) {
    console.log(`Uden for arbejdstiden (kl. ${time}, vindue ${ARBEJDSTID_START}-${ARBEJDSTID_SLUT}) — intet tjek.`);
    process.exit(0);
  }

  const { data: sidsteOpkald, error } = await supabase
    .from("calls")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Kunne ikke laese calls-tabellen:", error.message);
    process.exit(1);
  }

  const nu         = Date.now();
  const sidsteTid  = sidsteOpkald ? new Date(sidsteOpkald.created_at).getTime() : null;
  const timerSiden = sidsteTid ? (nu - sidsteTid) / 3_600_000 : Infinity;

  if (timerSiden < DOEDMANDS_TIMER) {
    console.log(`✅ Sidste opkald for ${timerSiden.toFixed(1)} time(r) siden — under graensen paa ${DOEDMANDS_TIMER}.`);
    process.exit(0);
  }

  const visning = Number.isFinite(timerSiden) ? `${timerSiden.toFixed(1)} timer` : "aldrig (ingen raekker i calls)";
  console.warn(`⛔ Ingen opkald i ${visning} — over graensen paa ${DOEDMANDS_TIMER} timer, i arbejdstiden (kl. ${time}).`);

  try {
    const resultat = await sendAdminAlert({
      subject: `⛔ Ingen opkald i ${visning} (doedmandsknap)`,
      text:
        `Der er ikke registreret noget opkald i calls-tabellen i ${visning}.\n` +
        `Graense: ${DOEDMANDS_TIMER} timer, tjekket kl. ${time} (Europe/Copenhagen), hverdag.\n\n` +
        `Mulige aarsager: Twilio-webhooken peger forkert, signaturafvisning blokerer aegte opkald (se S13),\n` +
        `appen er nede, eller der reelt bare ingen opkald har vaeret -- kontrollér foer du reagerer.`,
    });
    if (resultat?.blocked) {
      console.warn("Alarmmail BLOKERET af mail.js' egen staging-gate (se mail.js) — ingen mail sendt.");
    } else {
      console.log("Alarmmail sendt.");
    }
  } catch (mailErr) {
    console.error("Kunne ikke sende alarmmail:", mailErr.message);
    process.exit(1);
  }

  process.exit(1);
})().catch((err) => {
  console.error("Doedmandsknap-tjek fejlede uventet:", err.message);
  process.exit(1);
});
