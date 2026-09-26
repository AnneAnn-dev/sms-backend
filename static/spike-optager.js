/* ───────────────────────────────────────────────────────────────────────────
   optager.js — optagelse med de tre værn fra D66.

   Modulet kan én ting: optage lyd og enten levere en fil, vi tør sende til
   transskription, eller nægte at levere den og sige hvorfor.

   Det ved intet om Referat-fanen, om dashboardet eller om serveren. Det er
   med vilje: et modul, der kun kan én ting, kan måles for sig. Fanen kalder
   det med tre linjer.

   DE TRE VÆRN (RISIKOREGISTER D66, målt i Spike 0 den 26/9-26):
     1. Stop og sig det højt. iOS tager mikrofonen, når appen går i
        baggrunden. Sporet mutes, og 4-6 sekunder senere afsluttes det.
        Optageren må ikke køre videre i tavshed.
     2. Wake Lock. Holder skærmen tændt, så den ikke låser af sig selv.
        Dækker ikke app-skift, men fjerner den hyppigste årsag.
     3. Længdetjek som port. Lydens afkodede længde holdes op mod uret.
        Grænse besluttet af Ann og Anne 26/9: tabet må være højst 2 sekunder
        ELLER 2 % af varigheden — det mindste af de to.

   HVORFOR LÆNGDETJEKKET IKKE ER PYNT: i Spike 0 blev 49,9 sekunders optagelse
   til en fil på 40 KB med 1,9 sekunders lyd. Ingen exception. Filen kunne
   afspilles og ville være blevet transskriberet til et pænt, næsten tomt
   referat. Det er samme fejlklasse, som fik teknik A og C forkastet: et
   output uden spor af det, der mangler.

   FÆLDE, MÅLT SAMME DAG: `recorder.mimeType` er TOM STRENG på iOS. Formatet
   findes kun på den færdige blob. Læs det aldrig fra recorderen.

   Lyd persisteres ikke. Modulet giver blobben videre og holder intet selv.
   ─────────────────────────────────────────────────────────────────────────── */

(function (global) {
  "use strict";

  var STANDARD = {
    maxTabSek: 2,        // absolut grænse
    maxTabPct: 2,        // procentgrænse
    tidsskiveMs: 1000,   // ét stykke i sekundet — grundlaget for hul-målingen
    minVarighedSek: 1    // under dette er der ikke en optagelse at vurdere
  };

  function Optager(valg) {
    valg = valg || {};
    this.maxTabSek   = tal(valg.maxTabSek, STANDARD.maxTabSek);
    this.maxTabPct   = tal(valg.maxTabPct, STANDARD.maxTabPct);
    this.tidsskiveMs = tal(valg.tidsskiveMs, STANDARD.tidsskiveMs);
    this.paaHaendelse = typeof valg.paaHaendelse === "function" ? valg.paaHaendelse : function () {};
    this.paaAfbrydelse = typeof valg.paaAfbrydelse === "function" ? valg.paaAfbrydelse : function () {};

    this.tilstand = "klar";   // klar · optager · stopper · faerdig
    this._nulstil();
  }

  function tal(v, standard) {
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : standard;
  }

  Optager.prototype._nulstil = function () {
    this._strom = null;
    this._spor = null;
    this._rec = null;
    this._stykker = [];
    this._startMs = 0;
    this._afbrudt = false;
    this._afbrudtAarsag = "";
    this._wakeLock = null;
    this._loefte = null;
  };

  Optager.prototype._log = function (type, tekst) {
    try { this.paaHaendelse({ type: type, tekst: tekst, tid: new Date() }); } catch (e) {}
  };

  /* ── Grænsen: det mindste af de to ────────────────────────────────────── */
  Optager.prototype.graenseSek = function (vaegurSek) {
    var pct = (this.maxTabPct / 100) * vaegurSek;
    return Math.min(this.maxTabSek, pct);
  };

  /* ── Start ────────────────────────────────────────────────────────────── */
  Optager.prototype.start = function () {
    var mig = this;
    if (mig.tilstand === "optager") return Promise.reject(new Error("optager allerede"));
    mig._nulstil();

    if (!global.navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(fejl("ingen_mikrofon_api", "Enheden kan ikke optage lyd i browseren."));
    }
    if (!global.MediaRecorder) {
      return Promise.reject(fejl("ingen_optager_api", "Enheden kan ikke optage lyd i browseren."));
    }

    var kaldt = Date.now();
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (strom) {
      mig._log("mikrofon", "adgang givet efter " + (Date.now() - kaldt) + " ms");
      mig._strom = strom;
      mig._spor = strom.getAudioTracks()[0] || null;

      // VÆRN 1. Det er her, D66 fanges. `mute` kommer først og er det
      // tidligste varsel, vi kan få; `ended` kommer 4-6 sekunder senere.
      if (mig._spor) {
        mig._spor.onmute  = function () { mig._afbryd("mikrofonen blev taget af systemet"); };
        mig._spor.onended = function () { mig._afbryd("mikrofonen blev lukket af systemet"); };
      }

      try {
        mig._rec = new MediaRecorder(strom);   // ingen mimeType: lad enheden vælge
      } catch (e) {
        mig._ryd();
        throw fejl("optager_kan_ikke_startes", "Optageren kunne ikke startes: " + e.name);
      }

      mig._rec.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) mig._stykker.push(e.data);
      };
      mig._rec.onerror = function (e) {
        mig._afbryd("optageren fejlede: " + (e && e.error ? e.error.name : "ukendt"));
      };

      mig._startMs = Date.now();
      mig._rec.start(mig.tidsskiveMs);
      mig.tilstand = "optager";
      mig._log("start", "optagelse startet");

      mig._tagWakeLock();      // VÆRN 2 — må aldrig kunne vælte optagelsen
      return true;
    });
  };

  /* ── Værn 1: afbrydelse ───────────────────────────────────────────────── */
  Optager.prototype._afbryd = function (aarsag) {
    if (this._afbrudt || this.tilstand !== "optager") return;
    this._afbrudt = true;
    this._afbrudtAarsag = aarsag;
    this._log("afbrudt", aarsag);

    // Sig det til brugerfladen MED DET SAMME. Ventede vi til stop(), ville
    // håndværkeren stå og tale til en optager, der ikke optager.
    try { this.paaAfbrydelse(aarsag); } catch (e) {}

    var mig = this;
    // Stop selv. Vi lader den ikke køre videre: i Spike 0 var det netop den
    // situation, hvor uret løb i 49,9 sekunder og filen fik 1,9 sekunders lyd.
    setTimeout(function () { if (mig.tilstand === "optager") mig.stop(); }, 0);
  };

  /* ── Værn 2: Wake Lock ────────────────────────────────────────────────── */
  Optager.prototype._tagWakeLock = function () {
    var mig = this;
    if (!global.navigator || !navigator.wakeLock || !navigator.wakeLock.request) {
      mig._log("wakelock", "ikke understøttet — skærmen kan låse af sig selv");
      return;
    }
    navigator.wakeLock.request("screen").then(function (l) {
      mig._wakeLock = l;
      mig._log("wakelock", "skærmen holdes tændt");
      l.addEventListener("release", function () { mig._log("wakelock", "sluppet"); });
    }).catch(function (e) {
      // Fail-open: en manglende wake lock er ikke en grund til at afvise en
      // optagelse. Den gør bare den hyppigste årsag mere sandsynlig.
      mig._log("wakelock", "kunne ikke tages: " + e.name);
    });
  };

  Optager.prototype._slipWakeLock = function () {
    if (!this._wakeLock) return;
    try { this._wakeLock.release(); } catch (e) {}
    this._wakeLock = null;
  };

  Optager.prototype._ryd = function () {
    if (this._strom) {
      this._strom.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      this._strom = null;
    }
    this._slipWakeLock();
  };

  /* ── Stop ─────────────────────────────────────────────────────────────── */
  Optager.prototype.stop = function () {
    var mig = this;
    if (mig._loefte) return mig._loefte;                       // stop kaldt to gange
    if (mig.tilstand !== "optager") return Promise.reject(new Error("optager ikke i gang"));

    mig.tilstand = "stopper";
    mig._loefte = new Promise(function (ok) {
      var vaegurSek = (Date.now() - mig._startMs) / 1000;
      mig._rec.onstop = function () {
        mig._ryd();
        mig.tilstand = "faerdig";
        ok(mig._vurder(vaegurSek));
      };
      try { mig._rec.stop(); } catch (e) {
        mig._ryd();
        mig.tilstand = "faerdig";
        ok(mig._vurder(vaegurSek));
      }
    });
    return mig._loefte;
  };

  /* ── Værn 3: længdetjekket ────────────────────────────────────────────── */
  Optager.prototype._vurder = function (vaegurSek) {
    var mig = this;

    // Formatet læses fra blobben. `recorder.mimeType` er tom streng på iOS.
    var fraStykke = mig._stykker.length ? mig._stykker[0].type : "";
    var mime = fraStykke || mig._rec.mimeType || "";
    var blob = new Blob(mig._stykker, { type: mime });
    var svar = {
      ok: false,
      aarsag: "",
      forklaring: "",
      blob: blob,
      mimeType: blob.type || mime,
      filnavn: filnavn(blob.type || mime),
      bytes: blob.size,
      vaegurSek: rund(vaegurSek),
      varighedSek: null,
      tabSek: null,
      graenseSek: rund(mig.graenseSek(vaegurSek)),
      afbrudt: mig._afbrudt,
      afbrudtAarsag: mig._afbrudtAarsag
    };

    if (blob.size === 0) {
      svar.aarsag = "tom_fil";
      svar.forklaring = "Der blev ikke optaget noget.";
      mig._log("afvist", svar.forklaring);
      return Promise.resolve(svar);
    }

    return afkodVarighed(blob).then(function (varighed) {
      svar.varighedSek = rund(varighed);
      svar.tabSek = rund(vaegurSek - varighed);

      if (varighed < STANDARD.minVarighedSek) {
        svar.aarsag = "for_kort";
        svar.forklaring = "Optagelsen er kun " + svar.varighedSek + " sekunder lang.";
      } else if (mig._afbrudt) {
        svar.aarsag = "afbrudt";
        svar.forklaring = "Optagelsen blev afbrudt: " + mig._afbrudtAarsag +
                          ". Der mangler " + svar.tabSek + " sekunder.";
      } else if (svar.tabSek > svar.graenseSek) {
        svar.aarsag = "for_stort_tab";
        svar.forklaring = "Der mangler " + svar.tabSek + " sekunder lyd i forhold til " +
                          "de " + svar.vaegurSek + " sekunder, optagelsen varede. " +
                          "Grænsen er " + svar.graenseSek + ".";
      } else {
        svar.ok = true;
      }

      mig._log(svar.ok ? "godkendt" : "afvist",
               "vægur " + svar.vaegurSek + " s · lyd " + svar.varighedSek + " s · tab " +
               svar.tabSek + " s · grænse " + svar.graenseSek + " s" +
               (svar.ok ? "" : " — " + svar.forklaring));
      return svar;
    }).catch(function (e) {
      // Kan filen ikke afkodes, kan tabet ikke måles — og så ved vi ikke, om
      // der mangler noget. Fail-closed: en umålelig optagelse går ikke videre.
      svar.aarsag = "kan_ikke_afkodes";
      svar.forklaring = "Lydfilen kan ikke læses (" + (e && e.name ? e.name : "ukendt") + ").";
      mig._log("afvist", svar.forklaring);
      return svar;
    });
  };

  /* ── Hjælpere ─────────────────────────────────────────────────────────── */
  function afkodVarighed(blob) {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return Promise.reject(new Error("ingen AudioContext"));
    return blob.arrayBuffer().then(function (buf) {
      var ctx = new AC();
      return new Promise(function (ok, fejl) { ctx.decodeAudioData(buf, ok, fejl); })
        .then(function (lyd) {
          try { ctx.close(); } catch (e) {}
          return lyd.duration;
        }, function (e) {
          try { ctx.close(); } catch (e2) {}
          throw e || new Error("decodeAudioData");
        });
    });
  }

  function filnavn(mime) {
    var e = "bin";
    if (/mp4|aac/.test(mime)) e = "mp4";
    else if (/webm/.test(mime)) e = "webm";
    else if (/ogg/.test(mime)) e = "ogg";
    else if (/wav/.test(mime)) e = "wav";
    return "optagelse-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "." + e;
  }

  function rund(n) { return Math.round(n * 10) / 10; }

  function fejl(kode, tekst) {
    var e = new Error(tekst);
    e.kode = kode;
    return e;
  }

  global.Optager = Optager;
})(window);
