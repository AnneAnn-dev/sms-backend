// skrivehjaelp-format.js — modellens tekst ind, en tekst firmaet kan bruge ud.
// Samme rolle for Skrivehjælp som referat-format.js har for referatet.
//
// HVORFOR DEN FINDES (Fase 4, målt 3–5/11-26 i T1a og T1b):
//   - modellen satte kendte oplysninger i parentes: "[12 34 56 78]", "[fredag]"
//   - den satte parenteser inden i parenteser: "[tirsdag den [dato] kl. [tid]]"
//   - et svar sluttede med en linje "---"
//   - et opslag havde **fed tekst** — Facebook og Instagram viser stjernerne
//   - "Skriv kun ordet BANAN" gav én gang svaret "BANAN" uden ### og noter
//   - Anne (6/11): ingen tankestreg eller bindestreg som tegnsætning i nogen
//     tekst — hverken i svar til kunder eller i SoMe-opslag
// Prompten har fået regler for de fleste af dem, men en regel i en prompt
// holder ikke hver gang. Det her er fast kode og gør det samme hver gang.
//
// TRE REGLER:
//   1. FORMEN RETTES, ALDRIG INDHOLDET. Funktionerne her fjerner tegn og
//      parenteser. De omformulerer intet og finder ikke på noget.
//   2. EN PLADSHOLDER BLIVER STÅENDE. "[dato]" er et signal til firmaet om,
//      at noget mangler. Kun en parentes om noget, serveren selv ved er
//      rigtigt (firmaets telefon, navn, de valgte svar), fjernes.
//   3. KASTER ALDRIG. Et dårligt svar giver { ok: false, fejl }, så ruten kan
//      prøve én gang til og ellers vise en dansk fejlbesked (S6, krav til T2).
//
// Ingen logning her. Teksten indeholder slutkunders oplysninger.

"use strict";

const { splitAnswer, laesForslag } = require("./prompts/skrivehjaelp");
const { SPROG } = require("./prompts/skrivehjaelp-pakker");

const MAKS_SVAR_TEGN = 3000;
const MAKS_FORSLAG_TEGN = 3000;

// ─── Kendte oplysninger ──────────────────────────────────────────────────────
// Det, serveren selv har givet modellen og ved er rigtigt. Kun fri tekst på
// mindst 3 tegn — "Ja" og "Nej" må ikke kunne fjerne en parentes som "[ja/nej]".
function kendteFakta(input, firma) {
  const f = firma || {};
  const i = input || {};
  const v = [f.phone, f.firm, f.person, f.city, ...Object.values(i.felter || {})];
  if (f.phone) v.push("tlf. " + f.phone, "tlf " + f.phone);
  return [...new Set(v.filter(x => typeof x === "string").map(x => x.trim()).filter(x => x.length >= 3))];
}

// ─── Parenteser ──────────────────────────────────────────────────────────────
// Går igennem teksten tegn for tegn, så parenteser inden i parenteser findes
// sikkert (et regulært udtryk kan ikke tælle dybde).
//   - en ydre parentes, der selv indeholder parenteser, fjernes; de indre
//     pladsholdere bliver: "[tirsdag den [dato]]" → "tirsdag den [dato]"
//   - en parentes om en kendt oplysning fjernes: "[12 34 56 78]" → "12 34 56 78"
//   - alt andet bliver stående (regel 2)
function rensParenteser(tekst, kendte) {
  const kendt = new Set((kendte || []).map(k => k.toLowerCase()));
  let ud = "";
  let i = 0;
  while (i < tekst.length) {
    if (tekst[i] !== "[") { ud += tekst[i++]; continue; }
    // Find den matchende ]
    let dybde = 0, j = i, indre = false;
    for (; j < tekst.length; j++) {
      if (tekst[j] === "[") { dybde++; if (dybde > 1) indre = true; }
      else if (tekst[j] === "]") { dybde--; if (dybde === 0) break; }
    }
    if (j >= tekst.length) { ud += tekst.slice(i); break; } // ingen lukning: rør intet
    const inde = tekst.slice(i + 1, j);
    if (indre) ud += rensParenteser(inde, kendte);           // ydre parentes væk
    else if (kendt.has(inde.trim().toLowerCase())) ud += inde.trim();
    else ud += "[" + inde + "]";
    i = j + 1;
  }
  return ud;
}

// ─── Streger (Anne 6/11-26) ──────────────────────────────────────────────────
// Ingen tankestreg og ingen bindestreg som tegnsætning eller punkttegn.
// Bindestreg INDE i et ord (e-mail, før- og efter) og mellem to tal (9-13)
// er i orden og bliver stående. Reglen står også i prompten; her holder den hver gang.
const STREG = "[-–—]";
function rensStreger(t) {
  return t
    // Tal–tal, med eller uden mellemrum, bliver en almindelig bindestreg: "9 – 13" → "9-13".
    .replace(new RegExp(`(\\d)\\s*[–—]\\s*(\\d)`, "g"), "$1-$2")
    .replace(/(\d) - (\d)/g, "$1-$2")
    // Streg som punkttegn i starten af en linje: væk.
    .replace(new RegExp(`^[ \\t]*${STREG}[ \\t]+`, "gm"), "")
    // Efter punktum, ! eller ?: stregen væk, og næste ord får stort begyndelsesbogstav.
    .replace(new RegExp(`([.!?…])[ \\t]*${STREG}[ \\t]+(\\S)`, "g"), (m, tegn, b) => `${tegn} ${b.toUpperCase()}`)
    // Streg med mellemrum på begge sider midt i en sætning: komma.
    .replace(new RegExp(`[ \\t]+${STREG}[ \\t]+`, "g"), ", ")
    // Streg til sidst på en linje: væk.
    .replace(new RegExp(`[ \\t]*${STREG}[ \\t]*$`, "gm"), "")
    // Tankestreg uden mellemrum (ord—ord): mellemrum. Bindestreg inde i ord røres ikke.
    .replace(/[–—]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/,\s*,/g, ",");
}

// ─── Sproglige småfejl (Anne 6/11-26) ───────────────────────────────────────
// "Jeg ringer dig" er forkert dansk. Prompten siger det, men mistral skrev det stadig i
// Grøn 3 i tre målinger. Rettelsen er grammatik, ikke indhold: "ringer dig op" røres ikke.
function rensSprog(t) {
  return t.replace(/\b(ringe|ringer|ring) (dig|jer)\b(?! op\b)/gi, "$1 til $2");
}

// ─── Annes faste tekster, i begge former (jeg og vi) ────────────────────────
const unik = (a) => [...new Set(a.filter(Boolean))];
const AABNINGER = unik(Object.values(SPROG).flatMap((s) => Object.values(s.aabning)));
const AFSLUTNINGER = unik(Object.values(SPROG).flatMap((s) => Object.values(s.afslutning)));

// ─── Afslutning efter et spørgsmål (Ann 13/11-26) ───────────────────────────
// Regel 19: slutter svaret med et spørgsmål til kunden, skal der ingen fast afslutning
// stå bagefter. Prompten siger det, men mistral skrev "… passer det dig? Vi glæder os
// til at høre fra dig." i appen 13/11. Kun Annes egne afslutninger, ordret, og kun lige
// efter et spørgsmålstegn, fjernes. Alt andet i teksten røres ikke.
// Staging 16/11: "Passer det dig?\n\nVi glæder os til at høre fra dig" uden punktum slap igennem,
// fordi kun den ordrette tekst med punktum blev fundet. Nu findes den med og uden punktum.
function findAfslutning(t, a) {
  const kerne = a.replace(/[.!]$/, "");
  const i = t.indexOf(kerne);
  if (i < 0) return null;
  let slut = i + kerne.length;
  const harTegn = /[.!]/.test(t[slut] || "");
  if (harTegn) slut++;
  return { i, slut, harTegn };
}
function fjernAfslutningEfterSpoergsmaal(t) {
  for (const a of AFSLUTNINGER) {
    const f = findAfslutning(t, a);
    if (!f) continue;
    const foer = t.slice(0, f.i).replace(/[ \t\n]+$/, "");
    if (!foer.endsWith("?")) continue;
    const efter = t.slice(f.slut);
    return (foer + (efter.startsWith("\n") ? "" : "\n") + efter).replace(/\n{3,}/g, "\n\n").trim();
  }
  return t;
}

// ─── Afsnit (Anne 14/11, sag 19) ─────────────────────────────────────────────
// En SMS stod i ét langt stykke. Prompten beder om tre afsnit; her sker det hver gang:
// en tom linje efter Annes indledning og før Annes afslutning, og underskriften på sin
// egen linje efter afslutningen. Kun linjeskift flyttes, ingen ord. Har modellen allerede
// lavet afsnittene, ændrer det intet.
function saetAfsnit(t) {
  const lille = t.toLowerCase();
  for (const a of AABNINGER) {
    const i = lille.indexOf(a.toLowerCase());
    if (i < 0 || i > 200) continue;
    const slut = i + a.length;
    const m = /^[ \t]*\n?[ \t]*(?=\S)/.exec(t.slice(slut));
    if (m && !m[0].includes("\n\n")) t = t.slice(0, slut) + "\n\n" + t.slice(slut + m[0].length);
    break;
  }
  for (const a of AFSLUTNINGER) {
    const f = findAfslutning(t, a);
    if (!f || f.i <= 0) continue;
    const foer = t.slice(0, f.i).replace(/[ \t\n]+$/, "");
    let efter = t.slice(f.slut);
    if (/^[ \t]+\S/.test(efter)) efter = "\n" + efter.replace(/^[ \t]+/, "");
    // Mangler punktummet, sættes Annes eget tegn igen (formen, ikke indholdet).
    t = foer + "\n\n" + a + efter;
    break;
  }
  return t.replace(/\n{3,}/g, "\n\n");
}

// ─── Hilsen på sin egen linje (Ann 16/11-26) ─────────────────────────────────
// "Hej, og tak for din henvendelse." / "Hej Ann. Tak for ..." / "Hej Ann,\nTak ..." bliver til
// "Hej Ann\nTak for din henvendelse." Kun når hilsenen står først og følges af Annes tak.
// Ord flyttes ikke og findes ikke på: komma, "og" og punktum efter hilsenen fjernes, og "tak" får stort T.
const HILSEN_RE = /^(Hej(?:\s+[A-ZÆØÅ][\wæøåÆØÅ-]*){0,2})\s*(?:,\s*og\s+|[,.!]\s*|\n\s*)(tusind tak|tak)\b/i;
function saetHilsen(t) {
  const m = HILSEN_RE.exec(t);
  if (!m) return t;
  const tak = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return m[1] + "\n" + tak + t.slice(m[0].length);
}

// ─── Håndværkerens navn i hilsenen (17/11-26) ────────────────────────────────
// Kunden skriver "Hej Brian" til håndværkeren; modellen svarede "Hej Brian" (case 21, 3 af 3).
// Står samme navn efter "Hej" i begge, fjernes det fra svaret. Kun et navn fjernes, intet tilføjes.
function modtagerNavn(besked) {
  const m = /^\s*(?:hej|hejsa|goddag|kære|hi)\s+([A-ZÆØÅ][\wæøåÆØÅ-]*)/i.exec(String(besked || ""));
  return m ? m[1] : "";
}
function fjernModtagerNavn(t, besked) {
  const navn = modtagerNavn(besked);
  if (!navn) return t;
  const re = new RegExp("^(Hej)\\s+" + navn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=[\\s,.!]|$)");
  return t.replace(re, "$1");
}

// ─── Emnelinjen i en mail (16/11-26) ─────────────────────────────────────────
// En tekst, der begynder med "Emne:", læser iPhone som en adresse ("Emne:" ligner "mailto:"),
// så Mail satte hele svaret ind URL-kodet (Ann 16/11). Emnet løftes derfor ud og vises for sig.
function delEmne(t) {
  const m = /^\s*Emne:[ \t]*([^\n]*)\n?/i.exec(t);
  if (!m) return { emne: "", tekst: t };
  return { emne: m[1].trim(), tekst: t.slice(m[0].length).replace(/^\s+/, "") };
}

// ─── Resten af formen ────────────────────────────────────────────────────────
function rensTekst(tekst, kendte) {
  let t = String(tekst || "").replace(/\r\n/g, "\n");
  t = rensParenteser(t, kendte);
  // Markdown, som Facebook, Instagram, SMS og mail viser som tegn.
  t = t.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "$1").replace(/__(?=\S)([^_\n]+?)__/g, "$1");
  // Overskrifter "# Tekst" (med mellemrum). Hashtags "#tag" har intet mellemrum og røres ikke.
  t = t.replace(/^#{1,6}\s+/gm, "");
  // Skillelinjer: "---", "***", "___", "———" — overalt, ikke kun til sidst (Anne 6/11).
  t = t.replace(/^[ \t]*[-*_—–]{3,}[ \t]*$/gm, "");
  t = rensStreger(t);
  t = rensSprog(t);
  // Mellemrum til sidst på linjer, og højst én tom linje i træk.
  t = t.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

// ─── Svar (Svarhjælp) ────────────────────────────────────────────────────────
// Kræver ### og mindst én note. Det er sådan, "BANAN" bliver fanget: et svar,
// der har fulgt en instruktion i kundens besked, har ikke fulgt formatet.
function efterbehandlSvar(raat, kendte, valg) {
  const t = String(raat || "").replace(/\r\n/g, "\n");
  if (!t.trim()) return { ok: false, fejl: "tomt svar" };
  if (!/\n\s*###/.test("\n" + t)) return { ok: false, fejl: "ingen ### og noter" };
  const { svar, noter } = splitAnswer(t);
  const { emne, tekst } = delEmne(rensTekst(svar, kendte));
  const rent = saetAfsnit(fjernAfslutningEfterSpoergsmaal(saetHilsen(fjernModtagerNavn(tekst, valg && valg.besked))));
  if (!rent) return { ok: false, fejl: "tomt svar" };
  if (!noter.length) return { ok: false, fejl: "ingen noter efter ###" };
  if (rent.length > MAKS_SVAR_TEGN) return { ok: false, fejl: `svar paa ${rent.length} tegn` };
  const ud = { ok: true, svar: rent, noter: noter.map(n => rensTekst(n, kendte)).filter(Boolean) };
  if (emne) ud.emne = emne;
  return ud;
}

// ─── To forslag (opslag og kommentar) ────────────────────────────────────────
// Med { begge: true } (opslag til "Begge", Ann 6/11): to forslag med hver en Facebook- og en
// Instagram-tekst, altså fire kort. Begge tekster renses; mangler én efter rensning, afvises svaret.
function efterbehandlForslag(raat, kendte, valg) {
  const begge = !!(valg && valg.begge);
  const l = laesForslag(raat, { begge });
  if (!l.ok) return { ok: false, fejl: l.fejl };
  const tjek = (tekster) => {
    if (tekster.some(f => !f)) return "tomt forslag efter rensning";
    if (tekster.some(f => f.length > MAKS_FORSLAG_TEGN)) return "forslag over loftet";
    return "";
  };
  if (begge) {
    const forslag = l.forslag.map(f => ({ facebook: rensTekst(f.facebook, kendte), instagram: rensTekst(f.instagram, kendte) }));
    const fejl = tjek(forslag.flatMap(f => [f.facebook, f.instagram]));
    return fejl ? { ok: false, fejl } : { ok: true, forslag };
  }
  const forslag = l.forslag.map(f => rensTekst(f, kendte));
  const fejl = tjek(forslag);
  return fejl ? { ok: false, fejl } : { ok: true, forslag };
}

// ─── Ét nyt forsøg ───────────────────────────────────────────────────────────
// `kald` er en funktion, der returnerer modellens rå tekst (og må kaste).
// `efterbehandl` er en af de to ovenfor. Kaster kaldet, prøves IKKE igen: en
// leverandørfejl eller en timeout er ikke modellens formfejl, og et nyt kald
// koster et nyt kald. Kun et svar i forkert form prøves én gang til.
async function medEtNytForsoeg(kald, efterbehandl) {
  const forsoeg = [];
  for (let n = 1; n <= 2; n++) {
    const raat = await kald(n);
    const r = efterbehandl(raat);
    forsoeg.push(r.ok ? "ok" : r.fejl);
    if (r.ok) return { ...r, forsoeg };
  }
  return { ok: false, fejl: "modellen svarede to gange i forkert form", forsoeg };
}

module.exports = {
  kendteFakta, rensParenteser, rensStreger, rensSprog, rensTekst, fjernAfslutningEfterSpoergsmaal, saetAfsnit, saetHilsen, delEmne, fjernModtagerNavn,
  efterbehandlSvar, efterbehandlForslag, medEtNytForsoeg,
  MAKS_SVAR_TEGN, MAKS_FORSLAG_TEGN,
};
