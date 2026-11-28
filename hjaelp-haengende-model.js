// hjaelp-haengende-model.js — KUN til `proev-tilbud-ruter.js --haengende-model` (G9, 26/11).
//
//   node -r ./hjaelp-haengende-model.js server.js
//
// Indlæses kun, når nogen skriver -r på kommandolinjen. Ingen produktionskode
// kræver den, og den hedder ikke proev-*.js, så kor-proever.js ser den ikke.
//
// Gør to ting i serverprocessen:
//   1. Kald til .../chat/completions hænger, til de afbrydes — som en
//      leverandør, der ikke svarer. Alle andre kald (Supabase) går uændret igennem.
//   2. Tilbudsforslagets frist sættes til 3 s (routes/tilbud/forslag.js), så
//      prøven ikke venter et minut. Ruten læser fristen fra modulet ved hvert kald.
//
// Nægter at starte, hvis NODE_ENV er production.

"use strict";

if (process.env.NODE_ENV === "production") {
  throw new Error("hjaelp-haengende-model.js maa aldrig indlaeses i produktion");
}

const aegte = globalThis.fetch;
globalThis.fetch = function (url, opt) {
  if (typeof url === "string" && url.endsWith("/chat/completions")) {
    const signal = opt && opt.signal;
    return new Promise((_, afvis) => {
      const afbrudt = () => {
        const e = new Error("This operation was aborted");
        e.name = "AbortError";   // som en rigtig fetch, der afbrydes
        afvis(e);
      };
      if (!signal) return;     // uden signal hænger kaldet for evigt — det er pointen
      if (signal.aborted) return afbrudt();
      signal.addEventListener("abort", afbrudt, { once: true });
    });
  }
  return aegte.apply(this, arguments);
};

const F = require("./routes/tilbud/forslag");
F.FORSLAG_FRIST_MS = 3000;
F.MIN_FORSOEG_MS = 500;

console.warn("⚠️ HJAELP: modelkaldet haenger, og forslagets frist er 3 s (G9-proeven). Brug ikke denne server til andet.");
