// proev-app-start.js
// -----------------------------------------------------------------------------
// SMAGSPROEVE: respekterer iOS manifestets start_url ved "Foej til hjemmeskaerm"?
//
// Baggrund. Oensket er, at den installerede app aabner direkte paa /dashboard
// UDEN logon. Vejen dertil er et engangstoken i manifestets `start_url`, som
// bages ind i hjemmesk%ermsikonet ved installationen og loeses ind i en session,
// foerste gang appen aabnes. Hele ideen staar og falder med ét spoergsmaal, som
// ingen dokumentation kan besvare paalideligt nok til at bygge paa:
//
//     Baerer den installerede app den query-streng, MANIFESTET angav
//     — eller aabner iOS bare den side, man stod paa, da man installerede?
//
// Dette modul svarer paa det med ét install. Det roerer ingen database, ingen
// auth, ingen hemmeligheder og intet af den rigtige onboarding. Det serverer to
// ting:
//
//   GET /proev                — installationssiden (og samtidig svarsiden)
//   GET /proev-manifest.json  — manifest med et NYT tilfaeldigt maerke i start_url
//
// Sådan laeses den:
//   1. Aabn /proev i Safari paa iPhone. Siden viser et maerke, fx  K7QF2M.
//   2. Foej til hjemmeskaerm. Luk Safari HELT.
//   3. Aabn appen fra ikonet.
//      - Staar der "JA" og SAMME maerke  -> start_url respekteres. Ideen holder.
//      - Staar der "NEJ (ingen maerke)"  -> iOS aabnede bare den side, du stod
//        paa. Engangstoken i start_url er dermed en blindgyde paa iOS.
//
// Siden maaler samtidig `display-mode: standalone` og `navigator.standalone` i
// en AEGTE installeret app — det aabne punkt 1 i docs/2026-09-05-onboarding-flow.md
// ("side 8 i en aegte installeret app", isStandalone()-grenen er aldrig set
// virke). To ubekendte, ét install.
//
// Wiring i server.js — én linje, laeg den ved siden af de andre require-kald:
//
//     require("./proev-app-start")(app);
//
// SIKKERHED: modulet monterer sig KUN naar APPSIGNAL_APP_ENV !== "production",
// samme miljoegate som mail.js bruger. Kaldes det paa prod, logger det en linje
// og goer ingenting. Ruterne er statiske, uden parametre fra klienten der naar
// videre end HTML-escaping, og de laeser intet.
//
// NAAR MAALINGEN ER TAGET: slet filen og require-linjen. Den er et maaleredskab,
// ikke en feature.
// -----------------------------------------------------------------------------

const MAERKE_ALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // uden I,O,0,1 (aflaesning)

function nytMaerke() {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += MAERKE_ALFABET[Math.floor(Math.random() * MAERKE_ALFABET.length)];
  }
  return s;
}

// Alt fra query-strengen escapes foer det skrives i HTML. Siden er offentlig.
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = (app) => {
  if (process.env.APPSIGNAL_APP_ENV === "production") {
    console.log("🧪 proev-app-start: SPRUNGET OVER (production) — maaleruten monteres ikke");
    return;
  }

  // ─── Manifestet ─────────────────────────────────────────────────────────────
  // start_url baerer maerket. Det er praecis den mekanik, engangstokenet skal
  // bruge — kun med et harmloest maerke i stedet for et token.
  //
  // `id` holdes fast, saa iOS ser samme app ved gen-installation; `scope` skal
  // omslutte start_url, ellers falder browseren tilbage til at aabne i en fane.
  app.get("/proev-manifest.json", (req, res) => {
    const maerke = typeof req.query.m === "string" ? req.query.m.slice(0, 12) : "";
    res.set("Cache-Control", "no-store");        // hvert install skal have sit eget maerke
    res.type("application/manifest+json").send(JSON.stringify({
      id:               "/proev",
      name:             "Start-URL proeve",
      short_name:       "Proeve",
      start_url:        `/proev?m=${encodeURIComponent(maerke)}&fra=manifest`,
      scope:            "/",
      display:          "standalone",
      background_color: "#FFFFFF",
      theme_color:      "#1A3A5C",
      icons: [
        { src: "/icons/icon-192.png",          sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png",          sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }, null, 2));
  });

  // ─── Siden: baade installationsside OG svarside ─────────────────────────────
  // Uden `?m=` er det installationssiden: den finder et nyt maerke og skriver
  // det i manifest-linket. Med `?m=` er det svarsiden — og kommer den fra
  // manifestet, er beviset foert.
  app.get("/proev", (req, res) => {
    const fraManifest = req.query.fra === "manifest";
    const modtaget    = typeof req.query.m === "string" ? req.query.m.slice(0, 12) : "";
    // Installationssiden faar et FRISKT maerke hver gang, saa et gammelt svar
    // ikke kan forveksles med et nyt. Svarsiden genbruger det, den fik.
    const maerke      = modtaget || nytMaerke();

    res.set("Cache-Control", "no-store");
    res.type("html").send(`<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Start-URL proeve</title>
  <!-- DETTE er hele forsoeget: manifestet ligger i head'en ved sideindlaesning,
       ikke injiceret af JS bagefter. Er svaret JA, ved vi ogsaa at den
       server-renderede vej duer — og den er den sikreste af de to. -->
  <link rel="manifest" href="/proev-manifest.json?m=${encodeURIComponent(maerke)}">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">
  <meta name="apple-mobile-web-app-title" content="Proeve">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         color:#16232F;background:#fff;padding:28px 22px;max-width:520px;margin:0 auto}
    h1{font-size:24px;margin-bottom:6px}
    .sub{color:#5B6B7A;margin-bottom:22px}
    .maerke{font-size:44px;font-weight:800;letter-spacing:.16em;text-align:center;
            padding:20px;border-radius:14px;background:#F0F5FA;color:#1A3A5C;margin:18px 0}
    .dom{font-size:30px;font-weight:800;text-align:center;padding:18px;border-radius:14px;margin:18px 0}
    .ja{background:#E7F3EC;color:#2E7D52}
    .nej{background:#FBECEC;color:#C24444}
    ol{margin:0 0 22px 20px}
    li{margin-bottom:10px}
    table{width:100%;border-collapse:collapse;font-size:15px;margin-top:8px}
    td{padding:9px 0;border-bottom:1px solid #E4E9EF}
    td:last-child{text-align:right;font-weight:600}
    .note{color:#5B6B7A;font-size:14px;margin-top:22px;border-top:1px solid #E4E9EF;padding-top:16px}
    code{background:#F0F3F7;padding:2px 6px;border-radius:4px;font-size:14px}
  </style>
</head>
<body>
${fraManifest ? `
  <h1>Svar</h1>
  <p class="sub">Appen blev aabnet fra hjemmeskaermsikonet.</p>
  <div class="dom ja">JA — start_url virker</div>
  <p>Maerket, appen kom ind med:</p>
  <div class="maerke">${esc(modtaget)}</div>
  <p class="sub">Er det <strong>samme</strong> maerke, som stod paa siden da du
  installerede, er beviset foert: iOS bager manifestets <code>start_url</code>
  ind i ikonet, og et engangstoken kan rejse den vej.<br><br>
  Er det et <strong>andet</strong> maerke, har iOS cachet et gammelt manifest —
  saa virker mekanikken, men manifestet skal have en cache-buster.</p>
` : `
  <h1>Start-URL proeve</h1>
  <p class="sub">Ét install afgoer, om appen kan aabne uden logon.</p>
  <p>Maerket for dette forsoeg:</p>
  <div class="maerke">${esc(maerke)}</div>
  <ol>
    <li>Skriv maerket ned (eller tag et skaermbillede).</li>
    <li>Del-ikonet → <strong>Foej til hjemmeskaerm</strong> → Tilfoej.</li>
    <li>Luk Safari <strong>helt</strong> (swipe den vaek).</li>
    <li>Aabn appen fra det nye ikon.</li>
  </ol>
  <p class="sub"><strong>Staar der "JA" med samme maerke</strong> → start_url
  respekteres, og engangstoken-vejen er farbar.<br>
  <strong>Staar der "NEJ"</strong> → iOS aabnede bare den side, du stod paa, og
  ideen er en blindgyde paa iOS. Saa er kodesporet den rigtige vej.</p>
`}

  <h2 style="font-size:17px;margin-top:26px">Maalt lige nu</h2>
  <table>
    <tr><td>Aabnet fra manifestets start_url</td><td id="d-fra">${fraManifest ? "ja" : "nej"}</td></tr>
    <tr><td>display-mode: standalone</td><td id="d-mm">—</td></tr>
    <tr><td>navigator.standalone</td><td id="d-ns">—</td></tr>
    <tr><td>isStandalone() ville sige</td><td id="d-is">—</td></tr>
    <tr><td>Adresse</td><td id="d-url" style="font-weight:400;font-size:12px">—</td></tr>
  </table>

  <p class="note">Denne side roerer hverken database, konti eller mails. Den
  maaler to ting: om <code>start_url</code> baerer igennem, og hvad
  <code>isStandalone()</code> svarer i en <em>aegte</em> installeret app —
  grenen fra 5/9, som aldrig er set virke. Slet ruten, naar svaret er i hus.</p>

<script>
  (function () {
    function svar(id, v) {
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    }
    var mm = false;
    try { mm = window.matchMedia('(display-mode: standalone)').matches; } catch (e) {}
    var ns = navigator.standalone === true;
    var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
              (/Macintosh/.test(navigator.userAgent || '') && 'ontouchend' in document);
    svar('d-mm', mm ? 'sand' : 'falsk');
    svar('d-ns', ns ? 'sand' : 'falsk');
    // Samme regel som isStandalone() i onboarding.html efter 5/9-rettelsen:
    // display-mode er grundsignalet, og paa iOS skal navigator.standalone
    // bekraefte det.
    svar('d-is', (ios ? (mm && ns) : mm) ? 'INSTALLERET APP' : 'browser');
    svar('d-url', location.pathname + location.search);
  })();
</script>
</body>
</html>`);
  });

  console.log("🧪 Start-URL proeve monteret paa /proev (og /proev-manifest.json)");
};
