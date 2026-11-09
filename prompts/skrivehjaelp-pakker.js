// prompts/skrivehjaelp-pakker.js — branchepakkerne til Svar (Fase 4).
//
// ORDRET fra Annes servermodul (svarhjaelp-server.js, overleveret 1/11-26).
// Kun dette hoved og eksporten nederst er tilføjet. Anne ejer indholdet:
// fag, regler, situationer, felter og eksempler. Ann committer.
//
// ⚠️ Retter du en tekst her, er T1-målingen ikke længere om denne udgave.
// Hæv SKRIVEHJAELP_PROMPT_VERSION i prompts/skrivehjaelp.js og kør målingen om.
//
// Afventer: den fjerde, generelle pakke (Ann 3/11). Indtil den findes, falder
// ukendte brancher tilbage til Håndværk (sectorOf nedenfor).

"use strict";

// ===== BRANCHEPAKKER (kopieret fra prototypen) =====
// Anne retter indholdet her. Ny branche = ny pakke, ingen ny kode.
const F = {
  review: {id:"review", label:"Vil du bede om en anmeldelse?", type:"select", options:["Ja, på Google","Ja, på Trustpilot","Nej, bare sig tak"]},
  link: {id:"link", label:"Link til anmeldelse", type:"text", placeholder:"Tomt = linket fra firmaoplysningerne"},
  comp: {id:"comp", label:"Pris og kompensation", type:"select", options:["Nævn ikke prisen, men tag kontakt om det","Ingen ekstra regning for forsinkelsen","Vi giver et nedslag (skriv beløb under 'Andet')","Afvis venligt at give nedslag"]},
};
const ros = ex => ({group:"andet", label:"Tak og ros", example:ex, fields:[F.review, F.link]});
const andet = ex => ({group:"andet", label:"Andet", example:ex, fields:[]});

const PACKS = {
  haandvaerk: {
    label: "Håndværk",
    trades: ["VVS","Elektriker","Tømrer","Murer","Maler","Kloak","Andet håndværk"],
    rules: "Kunden er typisk privatperson, og opgaven foregår i kundens hjem. Ekstraarbejde bør altid aftales, før det udføres.",
    extraPlaceholder: "Fx: Vi kommer i morgen kl. 7 og er færdige torsdag. Ekstra arbejde aftales skriftligt før vi går i gang.",
    situations: {
      nyopgave: {group:"andet", label:"Ny opgave",
        example:"Hej. Kan I sige hvornår I har tid til at kigge på vores tag? Det drypper lidt i stuen når det regner kraftigt. Vi bor i Hillerød.\nMvh Peter",
        fields:[
          {id:"take", label:"Vil du tage opgaven?", type:"select", options:["Ja, jeg vil gerne se den først","Ja, send gerne billeder, så giver jeg en pris","Nej, det er ikke vores fag (henvis venligt)","Nej, vi har for travlt lige nu"]},
          {id:"visit", label:"Forslag til tid", type:"text", placeholder:"Fx tirsdag kl. 16 eller torsdag kl. 8"}]},
      pris: {group:"andet", label:"Hvad koster det?",
        example:"Hej. Hvad koster det cirka at få skiftet et toilet? Vi har selv købt det nye.\nVh Maria",
        fields:[
          {id:"pricetype", label:"Hvad kan du sige om prisen?", type:"select", options:["Fast pris","Et overslag (cirka-pris)","Det kræver, at jeg ser opgaven","Vi arbejder efter timepris"]},
          {id:"amount", label:"Beløb eller timepris", type:"text", placeholder:"Fx 2.800 kr. inkl. moms og bortskaffelse"}]},
      flyt: {group:"andet", label:"Flytte en aftale",
        example:"Hej Mikkel. Vi kan desværre ikke være hjemme på torsdag alligevel. Kan I komme en anden dag i næste uge?\nMvh Jens",
        fields:[
          {id:"can", label:"Kan det lade sig gøre?", type:"select", options:["Ja, her er en ny tid","Ja, men først senere end ønsket","Kunden må vælge mellem nogle tider","Nej, vi skal holde den aftalte tid"]},
          {id:"newslot", label:"Ny tid eller valgmuligheder", type:"text", placeholder:"Fx mandag kl. 7 eller onsdag kl. 12"}]},
      tilbud: {group:"andet", label:"Spørgsmål til tilbud",
        example:"Hej. Tak for tilbuddet. Er materialerne med i prisen, og hvor lang tid tager det? Vi vil gerne have det lavet inden jul.\nMvh Camilla",
        fields:[
          {id:"answer", label:"Dit svar på kundens spørgsmål", type:"text", placeholder:"Fx Materialer er med. Det tager 3 dage."},
          {id:"when", label:"Hvornår kan I starte?", type:"text", placeholder:"Fx uge 48"}]},
      undervejs: {group:"andet", label:"Spørgsmål under opgaven",
        example:"Hej. Skal vi rydde køkkenet helt inden I kommer mandag? Og skal vi være hjemme hele dagen?\nHilsen Line",
        fields:[
          {id:"prep", label:"Hvad skal kunden gøre?", type:"text", placeholder:"Fx Tøm skabene under vasken. I behøver ikke være hjemme."},
          {id:"arrive", label:"Hvornår kommer I?", type:"text", placeholder:"Fx mandag kl. 7"}]},
      ros: ros("Hej. Vil bare sige tak for et rigtig flot stykke arbejde. Drengene var søde og ryddede pænt op efter sig.\nMange hilsner Birgit"),
      andet: andet("Hej. Har I mulighed for at sende fakturaen igen? Jeg kan ikke finde den.\nMvh Ole"),
      overtid: {group:"klage", label:"Gået over tid",
        example:"Hej. I sagde at badeværelset ville være færdigt fredag, og nu er vi på tredje dag over. Vi har ingen bad, og ingen har ringet til os. Det er simpelthen ikke i orden, og jeg forventer at det bliver afspejlet i prisen.\nMvh Lene",
        fields:[
          {id:"reason", label:"Hvorfor gik I over tid?", type:"select", options:["Vi fandt ekstra arbejde undervejs (fx råd, skjulte rør)","Materialer blev forsinket fra leverandør","Vejret","Sygdom i firmaet","Vi planlagde for stramt","Kunden ændrede i opgaven"]},
          {id:"newdate", label:"Hvornår bliver I færdige?", type:"text", placeholder:"Fx onsdag d. 14. kl. 15"}, F.comp]},
      kvalitet: {group:"klage", label:"Klage over arbejdet",
        example:"Hej. Fliserne ved bruseren sidder skævt og der er allerede en revne i fugen. Det ser ikke professionelt ud for de penge vi har betalt. Hvad har I tænkt jer at gøre?\nVenlig hilsen Thomas",
        fields:[
          {id:"assess", label:"Hvad er din vurdering?", type:"select", options:["Jeg har ikke set det endnu","Kunden har ret, vi udbedrer","Det er inden for normal tolerance","Skyldes noget uden for vores arbejde"]},
          {id:"next", label:"Næste skridt", type:"text", placeholder:"Fx Vi kigger forbi fredag kl. 8"}]},
      pris_klage: {group:"klage", label:"Regningen er højere",
        example:"Hej. Tilbuddet lød på 18.500 kr., men regningen er på 24.200 kr. Det har ingen sagt noget om. Jeg betaler ikke mere end det aftalte.\nMvh Sanne",
        fields:[
          {id:"why", label:"Hvorfor er prisen højere?", type:"select", options:["Ekstraarbejde kunden godkendte mundtligt","Ekstraarbejde der var nødvendigt, ikke godkendt","Opgaven var på regning, tilbuddet var et overslag","Fejl på regningen"]},
          {id:"offer", label:"Hvad vil du tilbyde?", type:"text", placeholder:"Fx Gennemgå regningen sammen i telefonen"}]},
      udeblevet: {group:"klage", label:"Vi kom ikke som aftalt",
        example:"Jeg har taget fri fra arbejde i dag fordi I skulle komme kl. 8. Klokken er nu 11 og ingen er kommet, og ingen tager telefonen. Hvad sker der??",
        fields:[
          {id:"cause", label:"Hvad skete der?", type:"select", options:["Forrige opgave trak ud","Sygdom","Fejl i vores kalender","Bilproblemer","Værktøj gik i stykker"]},
          {id:"newtime", label:"Ny tid", type:"text", placeholder:"Fx i morgen kl. 7.30"}]},
    }
  },

  groen: {
    label: "Grøn sektor",
    trades: ["Anlægsgartner","Brolægger","Haveservice"],
    rules: "Arbejdet foregår udendørs og afhænger af vejr og årstid. Lov aldrig, at planter, græs eller beplantning vil lykkes eller overleve, da det afhænger af vejr og vanding. Har håndværkeren oplyst plejeråd, så tag dem med kort.",
    extraPlaceholder: "Fx: Vi kommer igen mandag, hvis det er tørvejr. Husk at vande den nye græsplæne morgen og aften de første 3 uger.",
    situations: {
      nyopgave: {group:"andet", label:"Ny opgave",
        example:"Hej. Vi vil gerne have lagt en ny terrasse på ca. 30 m2 og plantet en bøgehæk langs skellet. Kan I komme og se på det og give et tilbud?\nMvh Anders",
        fields:[
          {id:"take", label:"Vil du tage opgaven?", type:"select", options:["Ja, jeg vil gerne se haven først","Ja, send gerne billeder og mål, så giver jeg en pris","Nej, det laver vi ikke (henvis venligt)","Ja, men vi kan tidligst starte senere på sæsonen"]},
          {id:"visit", label:"Forslag til tid for besigtigelse", type:"text", placeholder:"Fx onsdag kl. 15 eller lørdag kl. 9"}]},
      pris: {group:"andet", label:"Hvad koster det?",
        example:"Hej. Hvad koster det at få slået græs og klippet hæk hver 14. dag hen over sommeren? Grunden er ca. 900 m2.\nVh Hanne",
        fields:[
          {id:"pricetype", label:"Hvad kan du sige om prisen?", type:"select", options:["Fast pris pr. besøg","Sæsonaftale med fast månedspris","Et overslag (cirka-pris)","Det kræver, at jeg ser haven","Vi arbejder efter timepris"]},
          {id:"amount", label:"Beløb", type:"text", placeholder:"Fx 650 kr. pr. besøg inkl. moms og bortkørsel af haveaffald"}]},
      flyt: {group:"andet", label:"Vejr og flytning af aftale",
        example:"Hej. Det har regnet hele ugen, og haven er en mudderpøl. Kommer I stadig og lægger fliser på fredag?\nMvh Kristian",
        fields:[
          {id:"can", label:"Hvad gør I?", type:"select", options:["Vi kommer som aftalt","Vi udskyder, til jorden er tør nok","Vi kommer, men laver noget andet først","Kunden må vælge mellem nogle nye tider"]},
          {id:"newslot", label:"Ny tid eller valgmuligheder", type:"text", placeholder:"Fx næste tirsdag, hvis vejrudsigten holder"}]},
      tilbud: {group:"andet", label:"Spørgsmål til tilbud",
        example:"Hej. Tak for tilbuddet på terrassen. Er bortkørsel af jord med i prisen, og kan I nå det inden vores havefest i juni?\nMvh Louise",
        fields:[
          {id:"answer", label:"Dit svar på kundens spørgsmål", type:"text", placeholder:"Fx Bortkørsel af jord er med. Selve arbejdet tager ca. 5 dage."},
          {id:"when", label:"Hvornår kan I starte?", type:"text", placeholder:"Fx uge 18"}]},
      fastaftale: {group:"andet", label:"Fast aftale",
        example:"Hej. Vi skal ud at rejse i 3 uger i juli. Kan vi sætte græsslåningen på pause imens?\nMvh Bente",
        fields:[
          {id:"wish", label:"Hvad ønsker kunden?", type:"select", options:["Holde pause","Ændre hvor ofte I kommer","Opsige aftalen","Tilføje en opgave"]},
          {id:"reply", label:"Dit svar", type:"select", options:["Ja, det ordner vi","Ja, med det varsel der står i aftalen","Vi foreslår et alternativ (skriv under Andet)","Vi kan desværre ikke"]},
          {id:"from", label:"Fra hvornår?", type:"text", placeholder:"Fx fra uge 28 til uge 31"}]},
      ros: ros("Hej. Haven er blevet så flot, og naboerne spørger allerede, hvem der har lavet terrassen. Tak for godt arbejde!\nMvh Gitte"),
      andet: andet("Hej. Tager I også haveaffald med, hvis vi selv har klippet hækken?\nMvh Niels"),
      overtid: {group:"klage", label:"Gået over tid",
        example:"Hej. Terrassen skulle have været færdig for en uge siden. Nu ligger der en bunke sand i indkørslen, og vi kan ikke bruge haven. Hvornår bliver I færdige?\nMvh Rasmus",
        fields:[
          {id:"reason", label:"Hvorfor gik I over tid?", type:"select", options:["Vejret (regn eller frost)","Jorden var anderledes end ventet (sten, rødder, ler)","Materialer eller planter blev forsinket","Sygdom i firmaet","Vi planlagde for stramt","Kunden ændrede i opgaven"]},
          {id:"newdate", label:"Hvornår bliver I færdige?", type:"text", placeholder:"Fx fredag, hvis det holder tørt"}, F.comp]},
      kvalitet: {group:"klage", label:"Klage over arbejdet",
        example:"Hej. Den nye græsplæne er gul i store pletter, og tre af de nye buske er gået ud. Det var ikke det, vi betalte for.\nMvh Jette",
        fields:[
          {id:"assess", label:"Hvad er din vurdering?", type:"select", options:["Jeg har ikke set det endnu","Kunden har ret, vi udbedrer","Planterne er dækket af vores plantegaranti","Skyldes sandsynligvis manglende vanding eller pleje","Det er normalt for årstiden og retter sig"]},
          {id:"next", label:"Næste skridt", type:"text", placeholder:"Fx Vi kigger på det torsdag og udskifter buskene"}]},
      pris_klage: {group:"klage", label:"Regningen er højere",
        example:"Hej. Tilbuddet lød på 42.000 kr., men regningen er på 51.000 kr. Hvad er de 9.000 kr. for?\nMvh Morten",
        fields:[
          {id:"why", label:"Hvorfor er prisen højere?", type:"select", options:["Mere jord eller sten skulle køres væk","Ekstraarbejde kunden godkendte mundtligt","Ekstraarbejde der var nødvendigt, ikke godkendt","Tilbuddet var et overslag","Fejl på regningen"]},
          {id:"offer", label:"Hvad vil du tilbyde?", type:"text", placeholder:"Fx Gennemgå regningen sammen i telefonen"}]},
      udeblevet: {group:"klage", label:"Vi kom ikke som aftalt",
        example:"Hej. Græsset er ikke blevet slået i tre uger nu, selvom vi har en aftale om hver 14. dag. Det ligner en mark.\nMvh Poul",
        fields:[
          {id:"cause", label:"Hvad skete der?", type:"select", options:["Vejret","Sygdom","Fejl i vores plan","Bilproblemer","Maskinen var i stykker"]},
          {id:"newtime", label:"Hvornår kommer I?", type:"text", placeholder:"Fx i morgen formiddag"}]},
    }
  },

  service: {
    label: "Service",
    trades: ["Rengøring","Skadedyrsbekæmpelse","Flytteservice","Låsesmed","Skorstensfejer"],
    rules: "Firmaet kommer ofte i kundens hjem, og kunden er tit ikke selv til stede. Ved skader på kundens ting: indrøm aldrig ansvar, men sig at I tager det alvorligt og undersøger det, og nævn forsikring kun hvis det står i fakta. Ved spørgsmål om sikkerhed (fx kemikalier, kæledyr, børn) må du kun gengive det, håndværkeren har skrevet, og ellers skrive en pladsholder.",
    extraPlaceholder: "Fx: Vi kommer torsdag mellem 8 og 10. Nøglen kan ligge i nøgleboksen.",
    situations: {
      nyopgave: {group:"andet", label:"Ny opgave",
        example:"Hej. Vi søger fast rengøring hver anden uge i et hus på ca. 140 m2 i Hillerød. Har I plads til en ny kunde?\nMvh Sofie",
        fields:[
          {id:"take", label:"Vil du tage opgaven?", type:"select", options:["Ja, jeg vil gerne se stedet først","Ja, her er en pris","Nej, vi har ikke plads lige nu","Nej, det ligger uden for vores område"]},
          {id:"visit", label:"Forslag til tid", type:"text", placeholder:"Fx mandag kl. 16 til et kort besøg"}]},
      pris: {group:"andet", label:"Hvad koster det?",
        example:"Hej. Hvad koster en flytterengøring af en lejlighed på 85 m2? Vi skal aflevere d. 1. december.\nVh Emil",
        fields:[
          {id:"pricetype", label:"Hvad kan du sige om prisen?", type:"select", options:["Fast pris","Pris pr. time","Pris pr. m2","Det kræver, at jeg ser stedet"]},
          {id:"amount", label:"Beløb", type:"text", placeholder:"Fx 3.400 kr. inkl. moms og rengøringsmidler"}]},
      flyt: {group:"andet", label:"Flytte en aftale",
        example:"Hej. Kan vi rykke rengøringen fra torsdag til fredag i denne uge? Vi har gæster torsdag.\nMvh Karen",
        fields:[
          {id:"can", label:"Kan det lade sig gøre?", type:"select", options:["Ja, her er en ny tid","Ja, men først senere end ønsket","Kunden må vælge mellem nogle tider","Nej, vi skal holde den aftalte tid"]},
          {id:"newslot", label:"Ny tid eller valgmuligheder", type:"text", placeholder:"Fx fredag kl. 9-12"}]},
      tilbud: {group:"andet", label:"Spørgsmål til tilbud",
        example:"Hej. Tak for tilbuddet på flytningen. Er kørsel med i prisen, og hvad sker der, hvis det tager længere tid end 6 timer?\nMvh Jonas",
        fields:[
          {id:"answer", label:"Dit svar på kundens spørgsmål", type:"text", placeholder:"Fx Kørsel er med. Ekstra tid koster 595 kr. pr. time."},
          {id:"when", label:"Hvornår kan I?", type:"text", placeholder:"Fx lørdag d. 30. fra kl. 8"}]},
      undervejs: {group:"andet", label:"Spørgsmål før besøget",
        example:"Hej. Skal vi være hjemme, når I kommer og ser på musene? Og er det farligt for vores kat?\nMvh Tina",
        fields:[
          {id:"prep", label:"Hvad skal kunden vide eller gøre?", type:"text", placeholder:"Fx I behøver ikke være hjemme. Katten skal holdes ude af kælderen i 2 døgn."},
          {id:"arrive", label:"Hvornår kommer I?", type:"text", placeholder:"Fx tirsdag mellem 8 og 10"}]},
      fastaftale: {group:"andet", label:"Fast aftale",
        example:"Hej. Vi vil gerne gå fra rengøring hver uge til hver anden uge fra næste måned. Kan det lade sig gøre?\nMvh Lars",
        fields:[
          {id:"wish", label:"Hvad ønsker kunden?", type:"select", options:["Ændre hvor ofte I kommer","Holde pause","Ændre dag eller tidspunkt","Opsige aftalen"]},
          {id:"reply", label:"Dit svar", type:"select", options:["Ja, det ordner vi","Ja, med det varsel der står i aftalen","Vi foreslår et alternativ (skriv under Andet)","Vi kan desværre ikke"]},
          {id:"from", label:"Fra hvornår?", type:"text", placeholder:"Fx fra 1. november"}]},
      ros: ros("Hej. Huset har aldrig været så rent. Tusind tak til Maja, hun er bare så grundig!\nKh Annette"),
      andet: andet("Hej. Har I mulighed for at sende fakturaen igen? Jeg kan ikke finde den.\nMvh Ole"),
      kvalitet: {group:"klage", label:"Ikke tilfreds med arbejdet",
        example:"Hej. Der var stadig støv på alle lister, og badeværelset var ikke gjort ordentligt. Det er anden gang. Vi betaler for en ordentlig rengøring.\nMvh Helle",
        fields:[
          {id:"assess", label:"Hvad er din vurdering?", type:"select", options:["Jeg har ikke tjekket det endnu","Kunden har ret, vi kommer igen uden beregning","Kunden har ret, vi taler med medarbejderen","Det var ikke en del af aftalen"]},
          {id:"next", label:"Næste skridt", type:"text", placeholder:"Fx Vi kommer igen i morgen kl. 10"}]},
      skade: {group:"klage", label:"Skade på kundens ting",
        example:"Hej. Jeres flyttefolk har lavet en dyb ridse i vores nye parketgulv og knækket et ben på en kommode. Hvem betaler for det?\nMvh Martin",
        fields:[
          {id:"action", label:"Hvad vil du gøre?", type:"select", options:["Vi undersøger sagen og vender tilbage","Vi kommer og ser skaden","Vi anmelder det til vores forsikring","Bed kunden sende billeder af skaden"]},
          {id:"when", label:"Hvornår vender I tilbage?", type:"text", placeholder:"Fx senest fredag"}]},
      overtid: {group:"klage", label:"Tog længere tid",
        example:"Hej. I sagde, at flytningen ville tage 5 timer, og nu står der 8 timer på regningen. Det er 1.800 kr. mere, end vi regnede med.\nMvh Ida",
        fields:[
          {id:"reason", label:"Hvorfor tog det længere tid?", type:"select", options:["Der var mere end oplyst","Svære adgangsforhold (trapper, langt at bære)","Stedet var mere beskidt end ventet","Trafik eller ventetid","Vi planlagde for stramt"]},
          {id:"newdate", label:"Hvad gælder nu?", type:"text", placeholder:"Fx Regningen gælder, men vi gennemgår den gerne"}, F.comp]},
      udeblevet: {group:"klage", label:"Vi kom ikke som aftalt",
        example:"Hej. Rengøringen kom ikke i dag, og ingen har sagt noget. Vi har gæster i weekenden.\nMvh Susanne",
        fields:[
          {id:"cause", label:"Hvad skete der?", type:"select", options:["Sygdom","Fejl i vores plan","Forrige opgave trak ud","Bilproblemer","Vi kunne ikke komme ind"]},
          {id:"newtime", label:"Ny tid", type:"text", placeholder:"Fx fredag kl. 9"}]},
    }
  }
};
function sectorOf(trade){
  for (const [k, p] of Object.entries(PACKS)) if (p.trades.includes(trade)) return k;
  return "haandvaerk";
}

module.exports = { PACKS, sectorOf };
