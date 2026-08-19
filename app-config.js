// app-config.js
// -----------------------------------------------------------------------------
// Serverer miljoe-afhaengig frontend-konfiguration som /config.js.
//
// HVORFOR: de statiske sider (onboarding.html, dashboard.html) havde Supabase-
// URL'en HARDCODET — saa staging-siderne talte med PROD-projektet fra browseren,
// og magic links udstedt af staging blev afvist som "udloebet" (opdaget 10/7-26).
// Princip: filer maa ikke kende miljoer; kun miljoet (env vars) ejer adresser.
//
// Indlaeses fra server.js med:  require("./app-config")(app);
//
// Frontenden bruger det saadan (FOER den inline-script-blok der bruger vaerdierne):
//   <script src="/config.js"></script>
//   ...
//   const SUPABASE_URL      = window.APP_CONFIG.SUPABASE_URL;
//   const SUPABASE_ANON_KEY = window.APP_CONFIG.SUPABASE_ANON_KEY;
//
// Anon-noeglen er designet til at vaere offentlig (RLS er adgangskontrollen),
// saa den maa gerne udstilles her — den skal bare vaere MILJOETS egen.
//
// Kraever i miljoeet: SUPABASE_URL (findes allerede), SUPABASE_ANON_KEY (ny —
// skal tilfoejes i BAADE staging- og prod-Railway samt lokale .env-filer).
// -----------------------------------------------------------------------------

module.exports = (app) => {
  app.get("/config.js", (req, res) => {
    const cfg = {
      SUPABASE_URL:      process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      // Offentlig VAPID-nøgle til push-abonnementer (D34). Ikke hemmelig —
      // den private nøgle rører aldrig klienten, kun serveren (server.js).
      VAPID_PUBLIC_KEY:  process.env.VAPID_PUBLIC_KEY,
    };

    // Fail-closed: hellere en tydelig fejl end en side, der taler med ingenting
    // (eller — vaerre — falder tilbage til noget hardcodet).
    const missing = Object.entries(cfg).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      console.error("❌ /config.js: mangler env vars:", missing.join(", "));
      return res
        .status(500)
        .type("application/javascript")
        .send(`console.error("APP_CONFIG utilgaengelig: serveren mangler ${missing.join(", ")}");`);
    }

    // no-store: config skal aldrig ligge i browser- eller SW-cache — den er
    // billig at hente og maa aldrig overleve et miljoe- eller noegleskift.
    res
      .type("application/javascript")
      .set("Cache-Control", "no-store")
      .send(`window.APP_CONFIG = ${JSON.stringify(cfg)};`);
  });

  console.log("⚙️  Frontend-config-rute registreret paa /config.js");
};
