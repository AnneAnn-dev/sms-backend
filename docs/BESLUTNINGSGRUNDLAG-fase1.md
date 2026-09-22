# Beslutningsgrundlag — må Fase 1 frigives?

**Skrevet:** 13-09-2026 · **Grundlag:** syv indtalinger à ca. 2½ min., `whisper-large-v3`
→ `mistral-medium-3.5-128b` hos Scaleway. Rå data i `transskriptioner\` og `referater\`.

---

## 1. Hvad der er målt

| | Resultat |
|---|---|
| **Tal og mål** | **100 % korrekte** i alle syv. 70 mm · 60×30 · 30×30 · 15 cm · 2 cm · 40 cm · 100/200 mm · 8 mm · 60×60 · korn 120 · fem kredse · 5 mm · 1,5 m · 4 mm |
| **Forløb og aftaler** | Intakte. Hvem, hvad, hvornår, næste møde — alt gengivet |
| **Fagsprog** | Knækker i alle syv, også i de to uden baggrundsstøj |
| **Hastighed** | ~10 sek. transskription + 12–17 sek. referat = ca. **½ minut fra stop til udkast** |
| **Pris** | ca. 1.054 tokens ind + 835 ud pr. referat |
| **Formvalidering (P5)** | 6 af 7 bestod. Den syvende faldt på **vores egen grænse**, ikke på en modelfejl |

---

## 2. Eksempler — hvad modellen gjorde

### 2a. Gode rettelser (den fangede fejlen og rettede den rigtigt)

| Transskription | Referat |
|---|---|
| "montere regler med **mineral ud** imellem" | "70 mm regler med **mineraluld**" |
| "Damspærren skal **tabes om hyggeligt**" | "Dampspærren skal **tættes omhyggeligt**" |
| "kontrollere **undertallet**" (2×) | "kontrollere **undertaget**" |
| "**stillagelse** bliver stående" | "**Stilladset** forbliver" |
| "I køkkenet skal der lægges. **Klik menu**." | "I køkkenet lægges **klikvinyl**" |
| "I stuen bliver der lagt **egetræskul**" | "I stuen lægges **egetræsgulv**" |
| "**Gullelag**… **guldarbejdet**… **guldlæggerne**" (gennemgående) | "**gulv**… **gulvarbejdet**… **gulvlæggerne**" |
| "udendørs stikkontakt med passende **kærpslingsgrader**" | "udendørs stikkontakt med passende **IP-grad**" |
| "inden **vådrums med barn** påføres" | "inden **vådrumsbehandling**" |
| "**første seng**" / "**På første plads**" | "**første sal**" |

Bemærk især **IP-grad**. Modellen oversatte et ødelagt dansk fagudtryk til den korrekte
branchebetegnelse — et ord, der **aldrig blev sagt i optagelsen**. Det er en god rettelse
og samtidig et eksempel på, hvor langt den er villig til at gå.

### 2b. Fejl, der overlevede begge trin

| Blev sagt | Står i referatet |
|---|---|
| OSB-plader | **USB-plader** (3 gange, også i punkterne) |
| Lecablokke | **ligablækker** |
| mørtel | **mørkel** |
| vådrum / vådrumsmembran | **rødrum** / **rådrumsmembran** |
| skridsikre | **skidsikre** |
| vandmåler | **valgmåner** |
| bruseniche | **brugseniche** |
| VVS-arbejdet | **IVS-arbejdet** |
| slibning / slibestøv | **slip** / **slipsstøv** |
| gerigter | **direkter** |
| fliseklæb / tandspartel | **liseklæb** / **tandsparkel** |
| underlaget skal være **plant** | underlaget skal være **blankt** |

**Mønstret er skarpt: den rettede alt, der ikke er et ord. Den rørte intet, der ER et ord.**
USB findes. Slips findes. En direkte findes. Blank findes. Modellen havde ingen grund til
at tvivle — og den kan ikke tvivle på noget, den ikke kan se er forkert.

### 2c. Den gjorde det værre ét sted

| Transskription | Referat |
|---|---|
| "peksrørene til **bosvand**" | "peksrør til **bsvand**" |
| "Samlingen bliver **skildret**" | "samling **skiltret**" |

Begge var forkerte i forvejen (brugsvand, skilt ad), men referatet flyttede dem længere
væk fra det rigtige ord — ikke tættere på.

### 2d. Den fandt på noget — og det er den farlige kategori

**Personer.** Transskriptionen: *"På møde var murerne fra **Murerhalsens VVS** til stede."*
Referatet: *"**Murerne og VVS fra Murerhalsen** til stede."* Modellen læste ét firma med et
ødelagt navn som **to parter** og skrev det som en konstatering. Deltagerlisten er en
oplysning om mennesker, og den blev opfundet.

**Materialer.** Transskriptionen: *"**Bulve** og køkken elementer skal afdækkes"* (= gulve).
Referatet: *"kraftig plast til **møbler**/elementer."* Hverken optagelsen eller
transskriptionen nævner møbler.

**Rekonstruktioner, som var rigtige — men stadig gæt.** Transskriptionen:
*"højdesforskel på ca. 8 mm **og en afstand på** ca. 4 meter."* Referatet: *"8 mm
højdeforskel **over** 4 m."* Den rigtige læsning. Men det er modellen, der afgjorde det.

Tilsvarende: *"der skal prøves at sprege mig over. Selv nivolerende spartelmasse"* blev til
*"Underlaget skal afrettes med selvnivellerende spartelmasse"* — en velformuleret
instruktion bygget på en sætning, der var i stykker.

### 2e. Den fjernede noget — uden at sige det

El-transskriptionen begynder med ren opdigt fra tale-til-tekst:
*"Eller det er vores regering, for det er det, jeg nærmer mig."*

Referatet nævner det ikke. **Det er den rigtige beslutning, truffet usynligt.** Samme
mekanisme, der fjerner støj, kan fjerne indhold — og man kan ikke se forskel bagfra.

---

## 3. Det centrale problem

Referatet er **velskrevet**. Den rå transskription ser rodet ud, og man læser den med
skepsis. Referatet ser rigtigt ud, og det sænker paraderne — samtidig med at netop de
fejl, der er sværest at få øje på, står tilbage i det.

**Poleringen fjerner de synlige fejl og bevarer de usynlige.** Det er ikke en forbedring
af sikkerheden; isoleret set er det en forringelse.

---

## 4. Kan modellens valg markeres? — fire teknikker

### A. Modellen markerer selv sine valg ⛔ Virker ikke

Idéen: bed modellen returnere et ekstra felt, `tolkninger`, med de steder den ændrede
eller gættede.

**Den fanger præcis den ufarlige halvdel.** Modellen kan rapportere, at den rettede
"undertallet" til "undertag" — den *vidste*, den valgte noget. Den kan ikke rapportere
"USB-plader", for den så aldrig et problem. Selvrapportering kræver tvivl, og tvivlen
mangler netop dér, hvor faren er.

Værre: en liste over tolkninger giver indtryk af, at **det var alle af dem**. Den ville
gøre referatet mere troværdigt, ikke mindre — stik imod hensigten.

### B. Maskinel sammenligning af transskription og referat ✅ Anbefales

Sammenlign de to tekster ord for ord i koden. Alt i referatet, der **ikke** findes i
transskriptionen, markeres.

Det er deterministisk, gratis, og det kræver ingen tillid til modellen. Det ville have
fanget **møbler**, **Murerne og VVS fra Murerhalsen**, **IP-grad**, **afrettes** og
**over 4 m** — altså både 2a og 2d.

**Det fanger ikke 2b** (USB-plader står i begge tekster). Men det fanger hele den
kategori, hvor modellen har tilføjet noget — og det er den, der handler om mennesker,
aftaler og beløb.

I praksis bliver det til nogle få markerede steder pr. referat. Det forvandler *"læs det
hele med skepsis"* til *"kig på de her fem steder"* — og det er forskellen på et råd og
et værktøj.

### C. Whisper-konfidens ⛔ MÅLT 14/9 — forkastet

Whisper kan levere konfidens pr. segment. **"USB-plader" er formentlig et sted, hvor
modellen akustisk var usikker, selvom teksten ser fin ud.** Er den information
tilgængelig gennem Scaleways endpoint, kan usikre passager markeres, før de overhovedet
bliver til et referat.

**Den blev målt, og den duer ikke.** `05-konfidens.ps1`, 189 segmenter, 23 kendte fejl
delt i volapyk (2a) og rigtigt-ord-forkert-plads (2b):

| | `avg_logprob`, median |
|---|---|
| Segmenter uden kendt fejl | −0,158 |
| Alle segmenter | −0,160 |
| 2a — volapyk, synligt for øjet | −0,182 |
| 2b — rigtigt ord, forkert plads | −0,172 |

De fire tal ligger oven i hinanden. **Konfidensen ser ikke engang volapyk.**

Man behøver ikke statistik for at afgøre det. Segmentet med **"USB-plader"** har
`avg_logprob` = **−0,103**; medianen for alle segmenter er **−0,160**. For at fange den
fejl skal tærsklen sættes *højere end medianen* — altså markere over halvdelen af
referatet. Og **"finpusses"** har **−0,075**, den højeste konfidens blandt alle tretten
fejlsegmenter: whisper var mest sikker dér, hvor den tog fejl.

**Hvorfor:** whisper var ikke i tvivl. Den hørte en sekvens og skrev et rigtigt dansk ord
— bare det forkerte. Fejlen opstod i sprogmodellen, ikke i lytningen, så konfidensen er
normal. Det er ikke en mangel ved API'et; det er en egenskab ved fejlklassen.

Fuld måling: `docs/RESULTAT-03-teknik-c.md`.

### E. To modellers uenighed ⛔ MÅLT 19/9 — forkastet

Idéen kom fra Ann: whisper er fuldstændig men rammer forkert på fagsprog; Hviske rammer
fagsproget men taber indhold. Kan de to holdes op mod hinanden, så uenighed bliver
markeringen?

**Den er principielt stærkere end C**, fordi den ikke spørger en model om den selv. To
modeller med forskellig arkitektur hører den samme lyd; uenighed er bevis udefra.

Målt i to omgange på det materiale, der allerede lå — ingen API-kald, ingen udgift:

| | 06 (ordsammenligning) | 07 (aligneret) |
|---|---|---|
| Markerede ord pr. optagelse | 76 | **47** |
| Fanget af de 18 fejl, der faktisk stod i teksten | 17 | **15** |

47 markeringer på en optagelse med ca. 375 ord er **hvert ottende ord.** Det er ikke en
markering, det er "læs det hele" med gult på.

**Og prisen for at skære støjen ned var rigtige fejl.** 07 strammede tre ting — ingen
længdegrænse (06 sorterede "USB" fra, fordi det er tre tegn), korrekt beregnet tæthed, og
kun ord hvor Hviske har *et andet ord på samme plads*. Støjen faldt en tredjedel. Men
træfsikkerheden faldt med.

**Den vigtigste erkendelse ligger i, hvad der forsvandt.** "fliseklip" røg ud, fordi
murer-optagelsens vindue blev sprunget over — Hviske havde tabt indholdet dér. Filtret
gjorde det rigtige. Men:

> **De to fejltyper overlapper. Hviske kan ikke være vidne i de vinduer, hvor Hviske selv
> er gået i sort** — og murer-optagelsen er netop den, hvor fugeinstruktionen vendte om.

Der, hvor vi mest har brug for et vidne, er vidnet blindt. Det kan intet filter rette.

**Sætningsniveau er også lukket**, og det behøver ikke prøves: 328 markeringer fordelt på
158 vinduer er godt to pr. vindue. Næsten hver sætning ville blive markeret.

Støjen kan skæres yderligere ved at normalisere tal og forkortelser — "2 styks" mod "to
styks", "ca." mod "cirka" ligger i toppen af listen. Det ville nok give 25-30. **Det
ændrer ikke svaret:** 25 er ikke 10, og træfsikkerheden er begrænset af Hviskes
indholdstab, ikke af hvordan vi tæller.

**Sidegevinst, der skal bruges:** 10 steder hvor whisper har ord og Hviske intet har,
plus 30 vinduer for tynde til at bruge — på syv optagelser. Det er første gang, Hviskes
indholdstab er et tal pr. optagelse i stedet for "9-49 % færre tegn". Det hører i
opfølgningen til syv.ai.

Fuld måling: `docs/RESULTAT-04-uenighed.md`.

### F. Kildevisning ✅ Billig, men kun sammen med B

Håndværkeren kan slå op i den rå tekst. Alene er det uden effekt — ingen læser en
rodet transskription frivilligt. Koblet til B er det stærkt: markeret sted → vis, hvad
der stod i transskriptionen.

**Lyd-afspilning** ville være endnu stærkere, men strider mod reglen om, at lyd aldrig
gemmes. Vil I den vej, er det en selvstændig beslutning med opbevaringsfrist — og den
hører tidligst i Fase 2.

---

### Mønsteret på tværs af A, C og E

Tre veje er prøvet til at markere 2b maskinelt. Alle tre faldt, og de faldt af samme
grund:

| | Spørgsmålet | Hvorfor den faldt |
|---|---|---|
| **A** | Hvad valgte du? | Kræver tvivl. Modellen havde ingen. |
| **C** | Hvor sikker var du? | Sikkerheden var normal eller høj ved fejlene. |
| **E** | Er I to enige? | Enige nok — og uenige overalt ellers. |

> **Et ord, der lyder rigtigt og står på den forkerte plads, efterlader ingen maskinelt
> læsbare spor.** Målt tre gange, på tre forskellige måder.

Det er ikke tre uheld, og det er grunden til, at bundgrænsen i D36 accepterer
fagtermfejl i stedet for at love et værn mod dem. **Teknik B er ikke det bedste, vi har —
det er det eneste, der virker.**

## 5. Strukturen, der fjerner problemet i Fase 2

Faren ved et forkert fagudtryk er ikke, at det står i en note. Det er, at det bliver til
en **linje i et tilbud med en pris på**.

Den binding kan brydes: **et ord fra referatet må aldrig automatisk blive til en
tilbudslinje.** Håndværkeren vælger fra sin egen prisliste; referatet er anledningen,
ikke kilden. Så dør hele fejlklassen dér, hvor den koster penge — uanset hvor god
modellen er.

Det er samme princip som P5's "mennesket bekræfter altid tallet", anvendt på ordene.

---

## 6. Anbefaling

**Fase 1 kan frigives**, på fire betingelser:

1. **Referatet hedder "udkast"** og præsenteres aldrig som færdigt. Gem forudsætter
   gennemlæsning.
2. **Teknik B bygges med** — maskinel markering af det, modellen har tilføjet. En halv
   dags arbejde, og værnet mod den eneste fejlklasse, der handler om mennesker og
   aftaler.
3. **ASR-adapteren bygges efter kravene i 6d fra første linje** — især at den
   returnerer segmenter og ikke kun tekst. Det er det eneste krav på listen, der ikke
   kan eftermonteres billigt. Grænsefladen er skrevet ud i `docs/asr-adapter.md`.
4. ~~**Teknik C afprøves**~~ — **UDFØRT 14/9. Udfaldet var nr. 2 af de tre forudsete:
   konfidensen ligner resten.** Scaleway returnerer `avg_logprob`, `compression_ratio`
   og `no_speech_prob` pr. segment, så målingen kunne laves — men tallene skiller ikke
   fejl fra ikke-fejl. Betingelsen bortfalder derfor som krav. **Det, der skal bygges,
   er teknik B (punkt 2), og den er release-blokerende.**

**Begrundelsen for at acceptere fejlene i 2b:** referatet er håndværkerens egen note om
noget, han selv lige har sagt. Han ved, det hedder OSB. Fejlen står i hans eget
dokument, ikke i noget, der er sendt til en kunde. **Og den er synlig** — hvilket er
hele grunden til, at whisper vælges frem for Hviske, der er bedre til ordene og
dårligere til at lade være med at tabe dem.

**Det bliver en gate for Fase 2:** før et referat bliver til et tilbud, skal
terminologien være rigtig — eller bindingen i afsnit 5 skal være på plads.

---

## 6b. Hvad koster et referat?

**Scaleways listepriser** (hentet 13/9): `whisper-large-v3` €0,003 pr. lydminut ·
`mistral-medium-3.5-128b` €1,50/M input og €7,50/M output ·
`llama-3.3-70b-instruct` €0,90/M begge veje. Omregnet ved 7,46 kr./€.

Regnet på **de faktisk målte tal**: 2,4 minutters lyd, 1.054 tokens ind, 835 ud.

| | Transskription | Referat | **I alt pr. referat** | 100 sessioner/md |
|---|---|---|---|---|
| **mistral-medium** | 5,4 øre | 5,9 øre | **11,2 øre** | **11,22 kr./firma/md** |
| **llama-3.3-70b** | 5,4 øre | 1,3 øre | **6,6 øre** | **6,64 kr./firma/md** |

**Tre ting at læse ud af tabellen.**

**Ø2's tal holder med god margin.** Beregneren forudsagde 17,56 kr./firma/md. Målt ligger
det på 11,22 kr. med den dyreste af de to modeller — og firma-månedsloftet på 70 kr. er
dermed cirka seks gange det forventede forbrug.

**Transskriptionen er halvdelen af regningen** med mistral, og **81 %** med llama. Skifter
I til llama, bliver lyden den dominerende post, og så er det dér, en optimering skal
sætte ind — ikke i referatmodellen.

**Og hvad det kostede at bruge det forkerte værktøj:** ét qwen-kald brændte 4.000
output-tokens og leverede intet. Prissat som mistral er det **23,6 øre** — dobbelt så
meget som et helt, vellykket referat. Hele dagens syv referater kostede til sammenligning
**79 øre**.

⚠ **Ét forbehold ved whisper-prisen.** Prissiden angiver €0,003 pr. lydminut, men
markerer samtidig transskription som gratis. Det kan være en kampagnepris. **Tjek dit
eget forbrug i konsollen** — du har netop kørt 14 rigtige kald i dag, så tallet står der.
Er transskriptionen reelt gratis lige nu, skal budgettet stadig regnes med 0,003, for en
kampagne er ikke et prisgrundlag.

### syv.ai — kan ikke sammenlignes på samme måde

syv.ai offentliggør **ingen priser** for hverken Hviske (tale-til-tekst) eller DanskGPT.
Hviske er gratis under CC BY-NC 4.0 til ikke-kommerciel brug; **kommerciel brug kræver en
separat licens**, som skal aftales direkte med dem.

Vigtigere: **begge produkter er bygget til at køre på jeres egen infrastruktur** — åbne
vægte, on-prem eller i jeres egen cloud. Det er en anden omkostningsmodel, ikke et andet
tal i samme tabel:

| | Scaleway | syv.ai |
|---|---|---|
| Betaling | pr. kald | licens + egen GPU-drift |
| Skalerer med | antal referater | ingenting (fast kapacitet) |
| Ved nul kunder | 0 kr. | fuld pris |
| Ved mange kunder | stiger lineært | uændret, til kapaciteten er brugt |
| Lyden forlader huset | ja (Paris) | nej |

**Sammenligningen på "pris pr. referat" er derfor ikke meningsfuld mod syv.ai.** Ved
jeres nuværende volumen — nul betalende kunder på tilbudsmodulet — vinder en model, hvor
man betaler pr. kald, altid over en fast kapacitetsomkostning. Krydsningspunktet ligger
et sted ude i fremtiden og afhænger af licensprisen, som vi ikke kender.

**Det, syv.ai til gengæld ville give, er en GDPR-egenskab, penge ikke kan købe hos
Scaleway:** lyden forlader aldrig huset. Det ville fjerne forbeholdet om, at Scaleway ved
en HTTP 500-fejl kan gemme hele requestens indhold — altså en lydfil med tredjeparter —
i op til fjorten dage.

**Anbefaling: fasthold Scaleway til Fase 1** og notér syv.ai som re-trigger, hvis
volumen stiger markant, eller hvis lydens rejse ud af huset bliver et problem i en
kundeaftale. **Bed dem om et licenstilbud alligevel**, så tallet står i registret i
stedet for at skulle findes igen om et år.

### Priserne fra syv.ai — og hvad de faktisk viser

Ann har fået disse priser (tallene her er **ekskl. moms**, som de øvrige):

| | Pr. lydtime | Pr. lydminut | Mod Scaleway |
|---|---|---|---|
| **Scaleway `whisper-large-v3`** | 1,34 kr. | 2,24 øre | — |
| **Hviske v5.3** | 2,80 kr. | 4,67 øre | **2,1×** |
| **Hviske premium** | 8,64 kr. | 14,40 øre | **6,4×** |

Hele kæden pr. referat, med `mistral-medium` som referatmodel i alle tre:

| Transskription | Pr. referat | 100 sessioner/md |
|---|---|---|
| Scaleway | **11,2 øre** | **11,22 kr.** |
| Hviske v5.3 | 17,1 øre | 17,05 kr. |
| Hviske premium | 40,4 øre | 40,41 kr. |

**Ø2's begrundelse holder: Scaleway ER billigst.** Beslutningen fra 28/8 er dermed
bekræftet af tal, ikke kun af hukommelse.

**Men forskellen er lille nok til ikke at burde være udslagsgivende.** Scaleway mod
Hviske v5.3 er **5,83 kr. pr. firma pr. måned**. Målt mod firma-loftet på 70 kr. er det
støj — og målt mod, hvad et abonnement på produktet koster håndværkeren, er det ingenting.

**Prisen var altså udslagsgivende i en sammenligning, hvor begge tal var ubetydelige.**
Det er værd at skrive ned, fordi det ændrer, hvad der bør afgøre valget.

### ⚠ Og det, der gør dette til mere end en prisdiskussion

**Vi ved nu, hvad der faktisk fejler: dansk fagsprog.** Ikke lyd, ikke tal, ikke struktur.
`whisper-large-v3` er en international model, og den falder over mineraluld, Lecablokke,
gerigter, dampspærre og OSB.

**Hviske er trænet specifikt på dansk.** Det er nøjagtig den akse, en dansk model ville
forventes at vinde på — og den akse kendte vi ikke, da syv.ai blev testet og fravalgt.
Ø2 noterer, at syv.ai var *"bedre på nogle områder, dårligere på andre"*, men uden at
sige hvilke, fordi kriteriet ikke fandtes endnu.

**Sammenligningen blev altså afgjort, før det afgørende kriterium var kendt.**

Det behøver ikke betyde, at Scaleway er det forkerte valg. Men det betyder, at
sammenligningen bør køres om på den ene akse, der viste sig at være vigtig — og det
koster ingenting:

- **De syv filer ligger der allerede**, med facit-lister og en færdig scoring at måle mod.
- **Hviske v5.3 er gratis under CC BY-NC 4.0 til ikke-kommerciel brug.** En prøvebænk er
  ikke kommerciel brug. Testen kan køres uden at aftale en licens først.

Falder Hviske markant bedre ud på fagtermerne, køber 5,83 kr. pr. firma pr. måned en
løsning på det eneste problem, vi har fundet. Falder den ikke bedre ud, står Scaleway
fast — og denne gang på det rigtige grundlag.

### ✅ Bekræftet af syv.ai 13/9 — enheden og ordlisten

Forbeholdet om prisenheden er afklaret. **syv.ai bekræfter: priserne er pr. lydtime.**
Tabellerne ovenfor gælder som de står, og tallene kan bruges til en beslutning. Det var
den ene ubekendte, der kunne have vendt regnestykket om — den er væk.

På ordlisten svarer de, at **den øger sandsynligheden for at ramme fagtermen korrekt.**

**Læg mærke til, hvad det svar gør ved sammenligningen.** Hviske slog whisper på
fagtermerne **uden** ordliste — OSB, brugsvand, vandmåler, stillads, fliseklæb, alle
rigtige, hvor whisper fejlede. Ordlisten løfter den akse yderligere. Den akse er
samtidig den eneste, hvor vi har fundet en reel svaghed i Fase 1.

**Men de svarer ikke på det, der afgjorde valget.** Spørgsmålet var stillet i to dele —
hjælper ordlisten på termerne, *og ændrer den noget ved ovenstående*, altså ved de
lavdensitets-segmenter, hvor 47 sekunders tale bliver til 136 tegn. Der kom svar på
første del. Ikke på anden.

Det er ikke nødvendigvis en undvigelse; det kan lige så godt være to adskilte ting i
deres hoved. Men **forskellen er afgørende for os**, og den skal derfor stilles igen som
ét spørgsmål: *er tabet af indhold inde i segmenterne en kendt fejl, og arbejder I på
den?* En ordliste, der gør de overlevende ord rigtigere, hjælper ikke på de ord, der
aldrig når frem — og en omvendt fugeinstruktion bliver ikke mindre farlig af at være
stavet korrekt.

**Konsekvens for valget: uændret.** whisper til Fase 1, fordi fuldstændighed slår
terminologi, når håndværkeren selv læser og retter. Se bundgrænsen i D36.

**Konsekvens for gentestningen: skarpere.** Betingelsen for at skifte er nu præcis nok
til at kunne afgøres:

1. **Tabet inde i segmenterne er lukket** — målt med `04-tidslinje.ps1` på de samme syv
   filer. Tegn pr. sekund skal ligge på 14–17 gennem hele optagelsen, ikke 2,7.
2. **Derefter** køres ordlisten på, og fagtermerne scores mod facitlisterne.

Rækkefølgen er ikke til forhandling. Kører man ordlisten først, måler man en forbedring
på den akse, der ikke var problemet, mens den akse, der var, står uændret — og så ser
Hviske bedre ud, uden at være blevet det. Det er den samme fejl som i august, hvor
sammenligningen blev afgjort, før kriteriet fandtes.

**Prisen for et skifte, når betingelsen er opfyldt: 5,83 kr. pr. firma pr. måned.** Det
er afklaret og uændret. Beslutningen ligger ikke længere i økonomien.

---

## 6c. Hviske er testet — resultatet og hvad det betyder

Fuld gennemgang i `RESULTAT-02-hviske-mod-scaleway.md`. Kort:

**Hviske er markant bedre til dansk fagsprog.** Samme syv filer, ingen ordliste hos
nogen af dem. OSB-plader, brugsvand, vandmåler, slibning, stillads, gulvlæggerne,
VVS, tætningsbånd, nedløbsrør, fliseklæb — alle korrekte hos Hviske, alle forkerte hos
whisper. Og 2,5× hurtigere.

**Men den taber 9–49 % af indholdet, og den gør det lydløst.** Tidsstempel-analysen
viste hvorfor: modellen markerer et tidsrum som transskriberet, sætter
`no_speech_prob` til 0.0 — og udelader alligevel indholdet. To segmenter i murer-filen
dækker 47 sekunders tale og afleverer 136 tegn, hvor normal taletæthed er 14–17 tegn
i sekundet.

**Og det producerer nye, forkerte sætninger.** *"…skal der ikke anvendes almindelig
cementfuge. Her skal anvendes elastisk silikonefuge"* blev til *"der skal ikke anvendes
elastisk silikonefuge."* Midten forsvandt, resterne blev svejset sammen, og negationen
flyttede med. Sætningen læser fejlfrit.

**Beslutning: Scaleway til Fase 1.** Ikke fordi den er bedst, men fordi dens fejl er
synlige. Et forkert ord kan håndværkeren se; et forsvundet afsnit kan han ikke.

**Men Hviske er den rigtige model på længere sigt**, hvis omissionsfejlen bliver
rettet. Fejlrapport sendt til syv.ai 13/9 (`fejlrapport-syvai.md`).

---

## 6d. ⚠ Krav til backenden: modellen SKAL kunne skiftes

Det er den vigtigste konsekvens af hele prøvebænken. **Vi ved nu, at vi kommer til at
skifte model** — enten når syv.ai retter fejlen, eller når en tredje bliver bedre.
Ø2 krævede allerede en adapter; testen her gør kravene konkrete.

**Den gode nyhed: skiftet er næsten gratis, hvis det bygges rigtigt fra starten.**
Begge leverandører bruger samme OpenAI-kompatible form —
`POST /v1/audio/transcriptions`, multipart, felterne `model`, `language`,
`response_format`. I prøvebænken var forskellen **én parameter**: samme script, samme
filer, kun adressen skiftede. Det er beviset på, at adapteren er tynd.

**Fem krav, hver med en grund fra målingerne:**

**1. Adapteren returnerer segmenter, ikke kun tekst.** Det er det krav, der er lettest
at overse og dyrest at rette. **⚠ Begrundelsen skiftede 14/9 — og kravet står stadig.**
Før hed det: segmenter skal med, så teknik C kan bygges. Teknik C er død. Nu er det et
**målbarhedskrav**: segmenter skal med, så den næste leverandør kan måles med
`04-tidslinje.ps1`, `05-konfidens.ps1` og `07-uenighed-alignet.ps1` uden at rive
adapteren op — og så tæthedsværnet kan bygges den dag, Hviske bliver aktuel igen. Den,
der læser 6d om et år, skal ikke bygge et værn på et tal, vi har målt ubrugeligt.
**`konfidens` gemmes, men vises aldrig for brugeren.** `verbose_json` giver
`segments` med `start`, `end`, `text` og `no_speech_prob` — **lad det være
adapterens returtype fra dag ét**, også selvom Fase 1 kun bruger teksten.

**2. Leverandør, adresse, model og nøgle vælges via miljøvariabler** — ikke i koden.
`TILBUD_ASR_LEVERANDOER`, `TILBUD_ASR_URL`, `TILBUD_ASR_MODEL`, plus nøglen under
leverandørens eget navn. Et skifte skal være en variabel i Railway, ikke en deploy.

**3. Modelstrengen låses eksplicit pr. leverandør** (D14). Aldrig et alias.

**4. Prisen er per leverandør og per enhed, ikke én konstant.** Scaleway afregner pr.
lydminut, syv.ai i credits pr. kald. `kvote.js` skal kunne regne begge dele, ellers
er budgettet forkert, dagen modellen skiftes.

**5. Leverandørspecifikke ekstrafelter må ikke sive ud i resten af koden.** syv.ai har
en `Vocabulary`-parameter; Scaleway har den ikke. Adapteren tager imod en valgfri
ordliste og kaster den væk, hvis leverandøren ikke kan bruge den — så resten af
systemet ikke skal vide, hvem der er i den anden ende.

**Og en sjette, der gælder referatmodellen:** den er et **selvstændigt** valg.
Transskription og referat skal kunne skiftes hver for sig. Vi har allerede set, at den
bedste transskription og den bedste referatmodel kan komme fra to forskellige huse —
og at en ræsonnerende model er ubrugelig til referatet, uanset hvor god den er ellers.

**Regressionssættet er det, der gør skiftet forsvarligt.** Uden det er et
leverandørskifte et spring i mørke; med det er det en kørsel på en eftermiddag og en
tabel at sammenligne. De syv filer og facit-listerne er dermed ikke testmateriale —
**de er infrastruktur.**

---

## 7. Det, der stadig ikke er afgjort

- ~~**Bundgrænsen er ikke formelt sat.**~~ **Godkendt af Ann og Anne 19/9.** Se afsnit 8.
- **Sættet har kun Anns stemme.** Det kan afgøre, hvilken model der er bedst, men ikke
  om kvaliteten er god nok til en fremmed bruger. Lukkes med to-tre andre stemmer.
- **`llama-3.3-70b-instruct` er ikke målt** som alternativ referatmodel.
- **Hviske med ordliste er ikke målt.** Ordliste-funktionen findes; den blev bevidst
  ikke brugt, for ikke at ændre to ting på én gang. **Rækkefølgen er bindende** (se J9):
  tætheden måles først, ordlisten prøves bagefter — ellers måles en forbedring på den
  akse, der ikke var problemet.
- **Markering af fagtermfejl er opgivet for Fase 1.** Tre teknikker målt og forkastet
  (A, C, E). Det er ikke en mangel på listen, det er en afgjort sag — se mønsteret i
  afsnit 4.
- **Tæthedsværnet er ikke bygget.** Om Scaleway returnerer segmenter er derimod
  afklaret (14/9): den giver `id, seek, start, end, text, tokens, temperature,
  avg_logprob, compression_ratio, no_speech_prob`. **Og værnet har en fælde, som
  målingen fandt:** fem af seks lavdensitets-fund var det *første* segment i en
  optagelse — tilløbet, før der bliver talt. Regnes tætheden på segmentets varighed
  alene, markerer værnet hver eneste optagelse ved starten. Udenfor tilløbet gav det ét
  fund på 189 segmenter, og dén støjrate kan man leve med.
- **Fotovejen er ikke prøvet.** `pixtral-12b-2409` findes i projektet, men er den mindste
  model på listen, og håndskrift er sværere end tale.
- **P5's grænse på 20 punkter** skal hæves eller erstattes.

---

## 8. Beslutningen

Alt ovenstående er målt. **Der er sagt ja.**

> **Bundgrænse for Fase 1 — ✅ GODKENDT AF ANN OG ANNE 19/9-2026**
>
> Et referat må vises til en pilotkunde, når:
>
> 1. **Tal og mål er korrekte.** *(Målt: 100 % i alle syv.)*
> 2. **Forløb og aftaler er genkendelige.** *(Målt: ja.)*
> 3. **Intet er opfundet om personer, aftaler eller beløb.** *(Målt: én
>    materialefejl — "møbler" for "gulve". Ingen om personer eller aftaler. Teknik B
>    ville have fanget den.)*
> 4. **Forkerte fagtermer accepteres** — fordi håndværkeren selv har dikteret, selv
>    læser og selv retter, før han gemmer.
>
> **Under forudsætning af:** referatet præsenteres som **udkast**, og det maskinelle
> værn mod tilføjelser (teknik B) er bygget.
>
> **Gate for Fase 2:** før et referat bliver til en tilbudslinje med en pris, skal
> terminologien være rigtig — eller et ord fra referatet må aldrig automatisk blive
> til en tilbudslinje (afsnit 5).

**Godkendt af Ann og Anne — 19. september 2026.**

**Hvad godkendelsen ikke dækker.** Skrevet ned her, så ingen senere læser den som et
kvalitetsmål, den ikke er:

- **"Korrekte" og "genkendelige" er bedømt af et menneske.** Ann har læst syv referater
  igennem. Det er en rimelig fremgangsmåde, men der findes ingen automatisk prøve, der
  bagefter kan sige "dette referat er under grænsen".
- **"100 %" er syv optagelser i én stemme** — Anns egen. Det er ikke et statistisk tal,
  det er "der blev ikke fundet fejl i de syv". Sættets hul står i afsnit 9, og den
  billigste ægte håndværkerstemme er pilotkunden selv.
- **Kriterium 4 har ingen øvre grænse.** Et referat kan som formuleret være fuldt af
  forkerte fagtermer og stadig opfylde bundgrænsen. Det er et bevidst valg — han læser
  sin egen note — og der er ikke opfundet et tal, vi ikke har målt.

**Undersøgelsessporet er dermed lukket.** Det løb fra 28/8, hvor manglen på kriterier
blev påpeget, til 19/9.

**Næste skridt, i rækkefølge:**

1. **Spike 0** — mikrofonen i den installerede PWA på en rigtig iPhone. Den er billig og
   den er først, fordi hele Fase 1 falder, hvis optagelse i en hjemmeskærms-app ikke
   virker.
2. **Teknik B** — den maskinelle markering. **Release-blokerende.** Uden den er
   bundgrænsen ikke opfyldt.
3. `TILBUD_AKTIV` og `/api/tilbud/referat` — efter ASR-adapteren i `docs/asr-adapter.md`.

**Det, der ikke længere står i vejen:** ordliste ved transskriptionen og Hviske hører
begge til J9's re-trigger, ikke til Fase 1. De venter på syv.ais svar om det tabte
indhold og blokerer ingenting.

---

## 9. Hvad prøvebænken efterlader

Ikke kun et svar, men noget, der kan bruges igen:

- **Syv optagelser med betingelser og facit-lister** (`SAETTET.md`) — syv fag, varieret
  baggrundsstøj, fagtermer skrevet ned på forhånd.
- **Fire scripts**: tjek · transskribér · referat · tidslinje. Alle med leverandør som
  parameter.
- **To målte leverandører** og en metode til at måle den tredje på en eftermiddag.
- **Tre resultatdokumenter** med tallene bag hver konklusion.

**Det er ikke testmateriale. Det er infrastruktur.** Uden det er et leverandørskifte et
spring i mørke; med det er det en kørsel og en tabel. Det er dét, der gør kravet om
fleksibilitet i 6d til noget reelt i stedet for en hensigt.

**Sættets kendte hul:** alle optagelser har Anns stemme. Det kan afgøre, hvilken model
der er bedst, men ikke om kvaliteten er god nok til en fremmed bruger. Lukkes med
to-tre optagelser mere — og den billigste ægte håndværkerstemme er pilotkunden selv.
