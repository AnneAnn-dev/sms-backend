// proev-velkomstmail.js -- proever velkomstmailen uden nummer (mail.js,
// velkomstUdenNummer) for de to Skrivehjaelp-udgaver og Referat, og at
// firmanavnet escapes. Sender intet (ren funktion). Ingen netvaerk.
//
//   node proev-velkomstmail.js
//
// Fase 4 salg T5, 18/11-26. Ren ASCII (danske bogstaver som \u-koder).
"use strict";

const { velkomstUdenNummer, tilHtml } = require("./mail");

let bestaaet = 0, fejlet = 0;
const ok = (n) => (bestaaet++, console.log(`  OK    ${n}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const har = (n, html, tekst) => (html.includes(tekst) ? ok(n) : nej(n, `mangler "${tekst}"`));
const harIkke = (n, html, tekst) => (!html.toLowerCase().includes(tekst.toLowerCase()) ? ok(n) : nej(n, `indeholder "${tekst}"`));
const lig = (n, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? ok(n) : nej(n, `fik ${JSON.stringify(a)}, forventede ${JSON.stringify(b)}`));

const URL = "https://eksempel.invalid/login";
const mail = (moduler, ekstra = {}) => velkomstUdenNummer({ firmName: "Frisoer Frederikke", loginUrl: URL, moduler, variant: "A", ...ekstra });
const KUNDER = "kunder og opgaver \u00e9t sted";
const REFERAT = "Med Referat indtaler du";
const TELEFON = "nummer, der tager imod opkald";

console.log("1. Skrivehjaelp og SoMe uden kunder (svar + facebook)");
let m = mail(["svar", "facebook"]);
har("pakkens navn", m.html, "Skrivehj\u00e6lp og SoMe uden kunder er klar til brug");
har("Skrivehjaelp-afsnittet", m.html, "svare dine kunder, skrive opslag til Facebook");
harIkke("ingen kunder og opgaver", m.html, KUNDER);
har("tilkoeb: Referat", m.html, REFERAT);
harIkke("intet telefonnummer (Ann 17/11)", m.html, TELEFON);
lig("emnet", m.subject, "Velkommen, Frisoer Frederikke \u2014 din konto er klar");

console.log("\n2. Skrivehjaelp og SoMe med kunder (svar + facebook + kunder)");
m = mail(["svar", "facebook", "kunder"]);
har("pakkens navn", m.html, "Skrivehj\u00e6lp og SoMe med kunder er klar til brug");
har("kunder og opgaver", m.html, KUNDER);
har("tilkoeb: Referat", m.html, REFERAT);
har("tilkoeb: telefonnummer, efter Referat ('ogsaa')", m.html, "Det kan ogs\u00e5 tilf\u00f8jes under Din pakke.");

console.log("\n3. Referat uden telefon (som foer Fase 4)");
m = mail(["referat"]);
har("modulets navn", m.html, "Referat er klar til brug");
harIkke("intet Skrivehjaelp-afsnit", m.html, "skrive opslag til Facebook");
harIkke("intet tilbud om Referat, han har det", m.html, REFERAT);
har("telefonnummer uden 'ogsaa'", m.html, "Det kan du tilf\u00f8je n\u00e5r som helst under Profil");

console.log("\n4. Uden kunder + Referat (koebt sammen)");
m = mail(["facebook", "referat", "svar"]);
har("begge navne", m.html, "Skrivehj\u00e6lp og SoMe uden kunder, Referat er klar til brug");
har("Referat giver kunder og opgaver", m.html, KUNDER);
harIkke("intet tilbud om Referat", m.html, REFERAT);

console.log("\n5. J8: Referat-teksten maa aldrig antyde optagelse af moeder eller samtaler");
for (const mods of [["svar", "facebook"], ["svar", "facebook", "kunder"], ["referat"]]) {
  const h = mail(mods).html;
  harIkke(`${mods.join("+")}: intet "optag"`, h, "optag");
  harIkke(`${mods.join("+")}: intet "moedereferat"`, h, "m\u00f8dereferat");
  harIkke(`${mods.join("+")}: intet "telefonaftale"`, h, "telefonaftale");
}
har("'dine egne noter' staar der", mail(["svar", "facebook"]).html, "dine egne noter efter et m\u00f8de eller en telefonsamtale");

console.log("\n6. Firmanavnet escapes i HTML (det kommer fra bestillingen)");
const ONDT = "<b>Bo & S\u00f8n</b><script>x()</script>";
m = mail(["svar", "facebook"], { firmName: ONDT });
harIkke("ingen <script> i HTML", m.html, "<script>");
har("navnet staar escapet", m.html, tilHtml(ONDT));
lig("emnet er ren tekst (escapes ikke)", m.subject, `Velkommen, ${ONDT} \u2014 din konto er klar`);
m = velkomstUdenNummer({ firmName: ONDT, loginUrl: URL, moduler: ["telefon"], variant: "B" });
harIkke("variant B: ingen <script>", m.html, "<script>");
har("variant B: nummeret er paa vej", m.html, "Dit eget telefonnummer er p\u00e5 vej");
lig("tilHtml", tilHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");

console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
process.exit(fejlet ? 1 : 0);
