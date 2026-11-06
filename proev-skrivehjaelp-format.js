// proev-skrivehjaelp-format.js — tørkørsel af skrivehjaelp-format.js. Ingen
// netværk, ingen nøgler, ingen omkostning. Kører i CI (kor-proever.js, KOERES).
//
//   node proev-skrivehjaelp-format.js
//
// Teksterne nedenfor er dem, modellen faktisk skrev i T1a og T1b (3–5/11-26),
// med testfirmaets opdigtede navn og nummer.

"use strict";

const F = require("./skrivehjaelp-format");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  —  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  —  ${d}`));
const lig = (n, faktisk, forventet) =>
  JSON.stringify(faktisk) === JSON.stringify(forventet) ? ok(n) : nej(n, `fik ${JSON.stringify(faktisk)}, forventede ${JSON.stringify(forventet)}`);

const FIRMA = { person: "Peter Testesen", firm: "Testfirma ApS", phone: "12 34 56 78", city: "Hillerød" };
const KENDTE = F.kendteFakta({ felter: { cause: "Bilproblemer", newtime: "fredag kl. 9", tom: "", kort: "Ja" } }, FIRMA);

(async () => {
  console.log("\nKENDTE OPLYSNINGER");
  lig("telefon, firma, navn, by og valgte svar er kendte",
    ["12 34 56 78", "Testfirma ApS", "Peter Testesen", "Hillerød", "Bilproblemer", "fredag kl. 9"].every(k => KENDTE.includes(k)), true);
  lig("korte svar som 'Ja' er ikke kendte (kan ellers fjerne [ja/nej])", KENDTE.includes("Ja"), false);
  lig("tomme felter tæller ikke", KENDTE.includes(""), false);

  console.log("\nPARENTESER — målt i T1a 5/11");
  lig("telefonnummer i parentes fjernes",
    F.rensTekst("ring på [12 34 56 78], hvis du vil", KENDTE), "ring på 12 34 56 78, hvis du vil");
  lig("'tlf. ' foran nummeret fjernes også",
    F.rensTekst("Jeg er på [tlf. 12 34 56 78].", KENDTE), "Jeg er på tlf. 12 34 56 78.");
  lig("kendt valg i parentes fjernes",
    F.rensTekst("Det skyldtes [Bilproblemer].", KENDTE), "Det skyldtes Bilproblemer.");
  lig("en pladsholder bliver stående (regel 2)",
    F.rensTekst("Vi kommer [dato] kl. [tid].", KENDTE), "Vi kommer [dato] kl. [tid].");
  lig("[ja/nej] bliver stående, selvom 'Ja' er valgt",
    F.rensTekst("Det er [farligt for katten: ja/nej].", KENDTE), "Det er [farligt for katten: ja/nej].");
  lig("parentes i parentes: den ydre fjernes, de indre bliver",
    F.rensTekst("flytte til [tirsdag den [dato] kl. [tid]].", KENDTE), "flytte til tirsdag den [dato] kl. [tid].");
  lig("et halvt ord af en kendt oplysning fjernes ikke",
    F.rensTekst("Vi kommer [fredag].", KENDTE), "Vi kommer [fredag].");
  lig("en [ uden ] røres ikke", F.rensTekst("pris [ca. 500 kr", KENDTE), "pris [ca. 500 kr");

  console.log("\nMARKDOWN OG SKILLELINJER — målt i T1a og T1b");
  lig("**fed** bliver almindelig tekst (A12)",
    F.rensTekst("🔥 **SPAR PENGE I DAG!** 🔥", KENDTE), "🔥 SPAR PENGE I DAG! 🔥");
  lig("hashtags røres ikke",
    F.rensTekst("Tak!\n\n#Hillerød #Tilbud", KENDTE), "Tak!\n\n#Hillerød #Tilbud");
  lig("overskrift med # og mellemrum bliver almindelig tekst",
    F.rensTekst("## Nyt tag\nFlot", KENDTE), "Nyt tag\nFlot");
  lig("'---' til sidst fjernes (BANAN-svaret 5/11)",
    F.rensTekst("Hej. Jeg kan desværre ikke hjælpe med det.\n\n---", KENDTE), "Hej. Jeg kan desværre ikke hjælpe med det.");
  lig("højst én tom linje i træk",
    F.rensTekst("A\n\n\n\nB", KENDTE), "A\n\nB");

  console.log("\nSTREGER — Anne 6/11: ingen tankestreg eller bindestreg som tegnsætning");
  const R = (t) => F.rensTekst(t, KENDTE);
  lig("tankestreg midt i sætning bliver komma (B3)",
    R("Undskyld for forsinkelsen – vi mangler en reservedel."), "Undskyld for forsinkelsen, vi mangler en reservedel.");
  lig("lang tankestreg bliver komma", R("Vi glæder os — og det gør du også"), "Vi glæder os, og det gør du også");
  lig("bindestreg med mellemrum bliver komma", R("Tak - vi ringer"), "Tak, vi ringer");
  lig("efter punktum: stregen væk og stort bogstav", R("Tak! – vi ringer i morgen."), "Tak! Vi ringer i morgen.");
  lig("streg som punkttegn fjernes", R("Vi tilbyder:\n- Professionel montering\n– Holdbart materiale"),
    "Vi tilbyder:\nProfessionel montering\nHoldbart materiale");
  lig("tidsrum med tankestreg bliver bindestreg (B1)", R("Vi har åbent 9–13 lørdag"), "Vi har åbent 9-13 lørdag");
  lig("tidsrum med mellemrum samles", R("fra kl. 9 – 13"), "fra kl. 9-13");
  lig("bindestreg inde i ord bliver stående", R("Skriv en e-mail om før- og efter-billeder"), "Skriv en e-mail om før- og efter-billeder");
  lig("en skillelinje midt i teksten fjernes", R("Første del\n---\nAnden del"), "Første del\n\nAnden del");
  lig("streg til sidst på en linje fjernes", R("Vi ses snart –\nPeter"), "Vi ses snart\nPeter");
  lig("ingen tankestreg tilbage i Annes eksempel (A2)",
    /[–—]/.test(R("🚿 FØR OG EFTER – grønne fliser — og en total transformation")), false);

  console.log("\nSVAR — ### og noter kræves");
  const godt = "Hej Maria. Ring på [12 34 56 78].\n\nPeter Testesen\n###\n- Udfyld [dato]";
  lig("et godt svar renses og godkendes", F.efterbehandlSvar(godt, KENDTE),
    { ok: true, svar: "Hej Maria. Ring på 12 34 56 78.\n\nPeter Testesen", noter: ["Udfyld [dato]"] });
  lig("'BANAN' uden ### afvises", F.efterbehandlSvar("BANAN", KENDTE), { ok: false, fejl: "ingen ### og noter" });
  lig("tomt svar afvises", F.efterbehandlSvar("   ", KENDTE), { ok: false, fejl: "tomt svar" });
  lig("### uden noter afvises", F.efterbehandlSvar("Hej.\n###\n", KENDTE), { ok: false, fejl: "ingen noter efter ###" });
  lig("### uden svar foran afvises", F.efterbehandlSvar("###\n- note", KENDTE).ok, false);
  lig("for langt svar afvises", F.efterbehandlSvar("x".repeat(3001) + "\n###\n- n", KENDTE).ok, false);
  lig("CRLF fra modellen virker", F.efterbehandlSvar("Hej.\r\n###\r\n- Tjek", KENDTE).ok, true);

  console.log("\nFORSLAG — præcis to, renset");
  const json = JSON.stringify({ forslag: [{ tekst: "**Ny bil!**\n#Hillerød" }, { tekst: "Ring [12 34 56 78] 😊" }] });
  lig("to forslag renses", F.efterbehandlForslag(json, KENDTE),
    { ok: true, forslag: ["Ny bil!\n#Hillerød", "Ring 12 34 56 78 😊"] });
  lig("ét forslag afvises", F.efterbehandlForslag(JSON.stringify({ forslag: [{ tekst: "a" }] }), KENDTE).ok, false);
  lig("ikke-JSON afvises", F.efterbehandlForslag("BANAN", KENDTE).ok, false);
  lig("et forslag, der kun var '---', afvises",
    F.efterbehandlForslag(JSON.stringify({ forslag: [{ tekst: "---" }, { tekst: "ok" }] }), KENDTE).ok, false);

  console.log("\nÉT NYT FORSØG — kun ved forkert form");
  let n = 0;
  const r1 = await F.medEtNytForsoeg(async () => (++n === 1 ? "BANAN" : "Hej.\n###\n- Tjek"), r => F.efterbehandlSvar(r, KENDTE));
  lig("forkert form første gang, rigtig anden gang", `${r1.ok} ${r1.forsoeg.join(",")} ${n}`, "true ingen ### og noter,ok 2");
  n = 0;
  const r2 = await F.medEtNytForsoeg(async () => (++n, "BANAN"), r => F.efterbehandlSvar(r, KENDTE));
  lig("to gange forkert: afvist, og IKKE et tredje kald", `${r2.ok} ${n}`, "false 2");
  n = 0;
  const r3 = await F.medEtNytForsoeg(async () => (++n, "Hej.\n###\n- Tjek"), r => F.efterbehandlSvar(r, KENDTE));
  lig("rigtig første gang: ét kald", `${r3.ok} ${n}`, "true 1");
  n = 0;
  let kastet = false;
  try { await F.medEtNytForsoeg(async () => { n++; throw new Error("timeout"); }, r => F.efterbehandlSvar(r, KENDTE)); }
  catch (_) { kastet = true; }
  lig("en leverandørfejl prøves ikke igen (det koster et kald mere)", `${kastet} ${n}`, "true 1");

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  if (fejlet) process.exit(1);
})();
