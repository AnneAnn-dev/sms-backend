// kunde-sms.js -- kunde-SMS'ens skabelon og tegnregnskab, ét sted.
//
// Flyttet uaendret fra onboarding.js 2/11-26 (D2, T2), saa reglerne kan
// proeves direkte (proev-kunde-sms.js) i stedet for kun gennem /opkald.
// Rene funktioner: ingen database, intet netvaerk, ingen miljoevariabler.
// Formular-domaenet (FORM_BASE) gives med som argument - det bygges stadig
// ét sted, i onboarding.js, af BASE_URL.
//
// Kaldes fra onboarding.js: /opkald (kunde- og demo-SMS), /api/firma/
// opdater-navn og /api/firma/opdater-sms-navn.
"use strict";

const { SLUG_MAKS } = require("./slug");

// Tokenet i formularlinket har 12 tegn (token.js, generateToken(size = 12)).
const TOKEN_TEGN = 12;

// ── Kunde-SMS-skabelonen (ét sted, saa demo og aegte ALTID er identiske) ──
// HOLDES UNDER 160 GSM-TEGN inkl. link (laert 11/7-26: efter rebrandingen
// blev domaenet 8 tegn laengere, alle kunde-SMS'er gled over 160 og blev
// delt i 2 segmenter — MIDT i linket, saa modtagerens telefon kun gjorde
// foerste halvdel klikbar -> "Cannot GET"). Budget: fast tekst+link-basen
// koster ~114 tegn -> firmanavn + slug maa TILSAMMEN fylde maks. 46 tegn.
// AEndres ordlyden: koer tegn-regnskabet igen (gsmSegments nedenfor vogter).
function kundeSmsBody(firmName, url) {
  return `Du har ringet til ${firmName}. Beskriv din opgave her, så kontakter vi dig:\n${url}`;
}

// GSM 03.38-segmentvagt: taeller som telefonnettet goer (basis=1, udvidelse=2,
// alt udenfor alfabetet tvinger UCS-2 hvor graensen er 70/67!). Logger hoejt
// hvis en SMS ikke laengere er ett segment — saa opdages regression i loggen,
// ikke hos kunden.
const GSM_BASIS = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
const GSM_UDVIDELSE = new Set("^{}\\[~]|€");
function gsmSegments(body) {
  let n = 0;
  for (const c of body) {
    if (GSM_BASIS.has(c)) n += 1;
    else if (GSM_UDVIDELSE.has(c)) n += 2;
    else return { segments: Math.ceil(body.length / 67), ucs2: true };
  }
  return { segments: n <= 160 ? 1 : Math.ceil(n / 153), ucs2: false, tegn: n };
}

// Hvor mange tegn er der plads til i firmanavnet? Tallet UDREGNES af den
// aegte skabelon frem for at staa som en konstant — ellers ville en aendret
// ordlyd eller et nyt domaene lade graensen blive staaende paa et tal, der
// ikke passer laengere. Tokenet regnes med sine 12.
//
// ⚠️ D67 (4/10-26): sluggen regnes med FIRMAETS EGEN slug, ikke loftet.
// Foer stod her altid SLUG_MAKS (12) — men en slug kan vaere laengere:
// uniqueSlug() saetter -2, -3 paa EFTER klipningen, og slugs fra backfill
// og fra foer loftet er slet ikke klippet. Maalt paa staging 4/10:
// `dortes-droemme`, 14 tegn. Saa viste skaermen 22, mens serveren afviste
// 21 — samme regel skal give samme tal, og navnPasserISms() bruger den
// aegte slug. Mangler sluggen, falder vi tilbage paa loftet som foer.
function maksNavnLaengde(slug, formBase) {
  const s = slug || "x".repeat(SLUG_MAKS);
  const proeveUrl = `${formBase}/${s}/${"x".repeat(TOKEN_TEGN)}`;
  const fast = gsmSegments(kundeSmsBody("", proeveUrl));
  if (fast.ucs2 || typeof fast.tegn !== "number") return 0;   // fail-closed
  return Math.max(0, 160 - fast.tegn);
}

// Passer navnet i én SMS? Proever den AEGTE besked med det AEGTE navn, saa
// baade laengde og tegnsaet dommes af samme regel som afsendelsen.
function navnPasserISms(navn, slug, formBase) {
  const url = `${formBase}/${slug}/${"x".repeat(TOKEN_TEGN)}`;
  const r = gsmSegments(kundeSmsBody(navn, url));
  return { ok: !r.ucs2 && r.segments === 1, ucs2: !!r.ucs2 };
}

module.exports = { kundeSmsBody, gsmSegments, maksNavnLaengde, navnPasserISms, TOKEN_TEGN };
