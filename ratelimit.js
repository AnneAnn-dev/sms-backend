// ratelimit.js
// -----------------------------------------------------------------------------
// Delt vindueloft ("sliding window") + udledning af klientens IP.
//
// Hvorfor et delt modul frem for en kopi pr. fil:
// `onboarding-link.js` har allerede sin egen indbyggede cooldown, og
// tilbudsmodulet (Ø2) faar brug for kvoter fra foerste linje. Uden et faelles
// sted ville vi have tre naesten-ens implementeringer af samme vaern — praecis
// det moenster, Å2 handler om.
//
// `onboarding-link.js` er BEVIDST ikke lagt om endnu. Den virker og er
// verificeret 13/8; en omlaegning hoerer i sin egen commit med en roegtest
// imellem. Dubletten er altsaa kendt og valgt, ikke overset.
// -----------------------------------------------------------------------------

// ─── Klientens IP ────────────────────────────────────────────────────────────
// VIGTIGT: brug IKKE `req.ip` her. `app.set("trust proxy", ...)` er ikke sat i
// server.js, saa `req.ip` returnerer Railways interne proxy-IP — ens for ALLE
// klienter. Et loft bygget paa den ville vaere en global laas, ikke et loft
// pr. bruger, og det ville fejle tavst: alt ser ud til at virke.
//
// Foerste led i `x-forwarded-for` er derimod korrekt paa Railway. Det er MAALT,
// ikke antaget: se S16 i RISIKOREGISTER.md — `test-s16-ip-loft.ps1` mod staging
// 13/8 viste, at Railway ERSTATTER headeren i stedet for at foeje til, saa
// foerste led er kantens egen observation og ikke klientens paastand.
//
// ⚠️ Det betyder ogsaa, at forsvaret ligger hos Railway og ikke i denne kode.
// Skifter hosting, eller kommer der en CDN/kant foran appen, skal S16 maales
// forfra — og saa er den rigtige rettelse `app.set("trust proxy", 1)` + `req.ip`.
function klientIp(req) {
  const raa = req.headers["x-forwarded-for"];
  if (!raa) return ""; // sker reelt kun i lokal udvikling uden proxy foran
  return raa.toString().split(",")[0].trim();
}

// ─── Vindueloft ──────────────────────────────────────────────────────────────
// Tillader `maks` kald pr. noegle inden for et glidende vindue paa `vinduetMs`.
//
// Forskellen fra en cooldown (1 kald pr. X sek.) er ikke kosmetisk. Paa et
// koebs-endpoint rammer en cooldown den kunde, der taster forkert, gaar tilbage
// og proever igen — altsaa praecis i det oejeblik, hvor han er ved at betale.
// Et vindue paa fx 5 kald pr. 10 min. maerkes aldrig af et menneske, men fanger
// en maskine paa femte forsoeg.
function opretLoft({ navn, maks, vinduetMs }) {
  // Fail-closed: hellere naegte at starte end at koere med et loft, ingen
  // opdagede var forkert. En forkert konfiguration skal braende ved boot,
  // ikke ligge stille i produktion.
  if (typeof navn !== "string" || !navn.trim()) {
    throw new Error("ratelimit: 'navn' mangler — bruges i loglinjer og skal vaere sat");
  }
  if (!Number.isInteger(maks) || maks < 1) {
    throw new Error(`ratelimit[${navn}]: 'maks' skal vaere et heltal >= 1, fik: ${maks}`);
  }
  if (!Number.isInteger(vinduetMs) || vinduetMs < 1000) {
    throw new Error(`ratelimit[${navn}]: 'vinduetMs' skal vaere et heltal >= 1000, fik: ${vinduetMs}`);
  }

  // noegle -> array af tidsstempler (ms). In-memory med vilje: Railway koerer
  // én instans, og mappet nulstilles ved redeploy. Det er acceptabelt for
  // formaalet — et loft, der glemmer alt hvert par dage, er stadig et loft.
  // ⚠️ Skalerer du til flere instanser, holder dette ikke laengere.
  const traef = new Map();
  const MAKS_NOEGLER = 10000;

  function tjek(noegle) {
    const nu = Date.now();
    const graense = nu - vinduetMs;

    const tidligere = (traef.get(noegle) || []).filter((t) => t > graense);

    if (tidligere.length >= maks) {
      // Et BLOKERET kald taelles ikke med. Ellers ville en maskine, der bliver
      // ved, forlaenge sin egen spaerring i det uendelige — og en ægte kunde,
      // der ramte loftet, kunne aldrig komme ind igen.
      traef.set(noegle, tidligere);
      const nulstillerOm = Math.ceil((tidligere[0] + vinduetMs - nu) / 1000);
      return { blokeret: true, brugt: tidligere.length, maks, nulstillerOm };
    }

    tidligere.push(nu);
    traef.set(noegle, tidligere);

    // Ryd op, saa mappet ikke vokser uendeligt ved mange unikke noegler.
    if (traef.size > MAKS_NOEGLER) {
      for (const [k, v] of traef) {
        const levende = v.filter((t) => t > graense);
        if (levende.length === 0) traef.delete(k);
        else traef.set(k, levende);
      }
      if (traef.size > MAKS_NOEGLER) {
        console.warn(`⚠️  ratelimit[${navn}]: ${traef.size} aktive noegler efter oprydning — usaedvanlig trafik?`);
      }
    }

    return { blokeret: false, brugt: tidligere.length, maks, nulstillerOm: 0 };
  }

  return { tjek, navn, maks, vinduetMs, antalNoegler: () => traef.size };
}

module.exports = { opretLoft, klientIp };
