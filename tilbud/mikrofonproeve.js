/* ───────────────────────────────────────────────────────────────────────────
   mikrofonproeve.js — MIDLERTIDIG måling (Fase 2, punkt D og E, 14/10-26).

   Spørgsmålet: får Kunder-rammen i dashboardet (#kunder-ramme, uden
   allow="microphone") lov til at bruge mikrofonen i den installerede app?
   Efter standarden ja (samme oprindelse), men iOS skal måles, ikke formodes.

   Knappen vises KUN, når siden er indlejret (?indlejret=1), og /tilbud
   findes kun i staging (TILBUD_AKTIV). Den beder om mikrofonen, viser
   resultatet på skærmen og lukker sporet med det samme. Den optager
   ikke, gemmer intet og sender intet.

   FJERNES, når målingen er skrevet i registret: slet denne fil og
   <script>-linjen nederst i tilbud/index.html.
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  if (!document.documentElement.classList.contains("indlejret")) return;

  var log = [];
  var knap, boks;

  function linje(t) {
    log.push(t);
    if (boks) boks.textContent = log.join("\n");
  }

  function tid() {
    var d = new Date();
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" +
           ("0" + d.getSeconds()).slice(-2);
  }

  function standalone() {
    try {
      var top = window.top;
      if (top.navigator && top.navigator.standalone === true) return "ja (navigator.standalone)";
      if (top.matchMedia && top.matchMedia("(display-mode: standalone)").matches) return "ja (display-mode)";
      return "NEJ — åbnet i Safari, ikke i den installerede app";
    } catch (e) { return "ukendt (" + e.name + ")"; }
  }

  function politik() {
    try {
      var p = document.permissionsPolicy || document.featurePolicy;
      if (!p || !p.allowsFeature) return "kan ikke aflæses i denne browser";
      return p.allowsFeature("microphone") ? "tilladt" : "BLOKERET";
    } catch (e) { return "ukendt (" + e.name + ")"; }
  }

  function tilstand() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve("kan ikke aflæses");
      return navigator.permissions.query({ name: "microphone" })
        .then(function (s) { return s.state; }, function (e) { return "kan ikke aflæses (" + e.name + ")"; });
    } catch (e) { return Promise.resolve("kan ikke aflæses (" + e.name + ")"); }
  }

  function proev() {
    knap.disabled = true;
    log = [];
    linje("Mikrofonprøve " + tid());
    linje("I ramme: " + (window.self !== window.top ? "ja" : "NEJ — siden er ikke i dashboardets ramme"));
    try {
      var ramme = window.frameElement;
      linje("Rammens allow: " + (ramme ? (ramme.getAttribute("allow") || "(ingen)") : "kan ikke aflæses"));
    } catch (e) { linje("Rammens allow: kan ikke aflæses (" + e.name + ")"); }
    linje("Installeret app: " + standalone());
    linje("Politik for mikrofon: " + politik());

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      linje("RESULTAT: getUserMedia findes ikke her");
      knap.disabled = false;
      return;
    }

    tilstand().then(function (foer) {
      linje("Tilladelse før: " + foer);
      var start = Date.now();
      return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (strom) {
        var ms = Date.now() - start;
        var spor = strom.getAudioTracks()[0];
        linje("RESULTAT: MIKROFON GIVET efter " + ms + " ms");
        linje("Spor: " + (spor ? (spor.readyState + (spor.muted ? ", muted" : "")) : "intet lydspor"));
        strom.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        linje("Sporet er lukket igen.");
      }, function (e) {
        var ms = Date.now() - start;
        linje("RESULTAT: AFVIST efter " + ms + " ms");
        linje("Fejl: " + (e && e.name ? e.name : "ukendt") + (e && e.message ? " — " + e.message : ""));
      }).then(function () {
        return tilstand().then(function (efter) { linje("Tilladelse efter: " + efter); });
      });
    }).then(function () { knap.disabled = false; }, function (e) {
      linje("Prøven fejlede: " + (e && e.name ? e.name : e));
      knap.disabled = false;
    });
  }

  function byg() {
    var ramme = document.createElement("div");
    ramme.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:9000;" +
      "font:14px/1.4 system-ui,sans-serif";
    knap = document.createElement("button");
    knap.type = "button";
    knap.textContent = "Mikrofonprøve";
    knap.style.cssText = "display:block;margin-left:auto;padding:10px 16px;border:0;border-radius:10px;" +
      "background:#991b1b;color:#fff;font:700 16px system-ui,sans-serif";
    knap.addEventListener("click", proev);
    boks = document.createElement("pre");
    boks.style.cssText = "margin:8px 0 0;padding:10px 12px;background:#111;color:#fff;border-radius:10px;" +
      "white-space:pre-wrap;word-break:break-word;font:13px/1.45 ui-monospace,monospace;max-height:50vh;overflow:auto";
    boks.textContent = "Tryk på knappen. Der optages ikke, og intet sendes.";
    ramme.appendChild(knap);
    ramme.appendChild(boks);
    document.body.appendChild(ramme);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", byg);
  else byg();
})();
