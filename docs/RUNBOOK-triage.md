# RUNBOOK — triage: når en kunde ringer og siger "det virker ikke"

Lukker **D11** og årsagen **Å7** i `RISIKOREGISTER.md`. De andre runbøger
beskriver det, Ann gør. Denne runbog starter i den anden ende: med en
håndværker i røret, der kun kan beskrive det, han ser.

Sidst opdateret: 2/10-2026 (ny — udkast, skal prøves af Anne). Sagskortet går til `support@ditdigitalekontor.dk`.

---

## 0. Sådan bruges den

**To lag, to personer.**

- **Lag 1 — Anne tager opkaldet.** Hun har ingen konsoller og skal ikke bruge
  nogen. Hun stiller spørgsmålene i afsnit 2, finder symptomet og giver kunden
  det svar, der står. Står der "→ Ann", udfylder hun sagskortet (afsnit 1) og
  sender det videre.
- **Lag 2 — Ann får en sag, der allerede er indsnævret.** Hun læser afsnit 3
  for netop den familie og kigger de nævnte steder, i den nævnte rækkefølge.

**Hvorfor to lag:** support må ikke afbryde byggedagene (**O3**). Løftet til
kunden er svar inden for én arbejdsdag, og support hører til på de små dage.
De fleste opkald bør kunne lukkes i lag 1.

**Led efter symptomet, ikke efter mekanismen.** Kunden siger "jeg får ingen
opgaver", ikke "push-abonnementet mangler". Afsnit 2 er derfor ordnet efter
det, kunden siger.

**Gæt ikke. Mål.** Et opkald, Anne selv foretager, eller en kode, kunden
bestiller, mens hun er i røret, er bedre end ti minutters ræsonnement.

---

## 1. Sagskortet — det, Anne sender videre

**Sagskortet er en mail til `support@ditdigitalekontor.dk`** (Simply, ligesom
resten af vores mail). Én mail pr. sag. Felterne nedenfor står i mailens
brødtekst. Gem dem som en skabelon i mailprogrammet, så de ikke skal huskes.

**Emnelinjen har fast form:** `[FARVE] <firmanavn> – <familie>: <kort symptom>`,
fx `[GUL] <firmanavn> – A: ingen opgaver`. Så kan indbakken sorteres uden at
åbne mails.

Felterne er dem, Ann skal bruge for at finde det rigtige sted i loggene:

| Felt | Eksempel |
|---|---|
| Firma (navnet i appen) | `<firmanavn>` |
| Hvornår skete det — så præcist kunden kan | "i går ca. 14:30" |
| Symptomfamilie (afsnit 2) | B — telefonsvareren svarer, men ingen SMS |
| Kundens egne ord, kort | "kunden siger, han ringede to gange" |
| Hvad Anne selv har prøvet, og hvad der skete | "ringede selv kl. 10:05, hørte hilsenen, fik ingen SMS" |
| Telefon: iPhone/Android, og bruges appen fra hjemmeskærmen? | iPhone, app på hjemmeskærmen |
| Haster: rød / gul / grøn (afsnit 4) | gul |

⚠️ **Ingen persondata i sagskortet, i chat eller i registret.** Firmanavnet
må gerne stå der — det er en virksomhed. Men ingen telefonnumre, ingen
e-mailadresser og ingen navne på håndværkerens kunder. Ann finder dem selv i
databasen ud fra firmanavn og tidspunkt.

**Sådan lukkes en sag.** Ann svarer på mailen med én linje og flytter den til
mappen **Lukket**:

- `Lukket i røret` — Anne løste den selv (så sender hun selv svaret)
- `Lukket — <ID>` — et kendt punkt i registret, fx `Lukket — D55`
- `Ført til registret som <ID>` — en ny fejl. Selve punktet skrives i
  `RISIKOREGISTER.md`, ikke i mailen

**Indbakken er ikke en liste over åbne fejl.** En mail har kun to tilstande:
ulæst/åben og Lukket. Alt, der skal huskes ud over sagen, hører til i registret
(**Å2**, **O7**).

**Rød går aldrig kun på mail.** Anne ringer til Ann først, og mailen kommer
bagefter som dokumentation.

**Tallet til driftsvinduet:** antallet af mails i Lukket i den forgangne uge er
supportbelastningen (**O3**).

---

## 2. Lag 1 — Anne: spørgsmål og svar

Start altid med de tre første spørgsmål. De sorterer det meste:

1. **Hvad forventede du skulle ske, og hvad skete der i stedet?**
2. **Hvornår skete det sidst?** Er det sket én gang eller hver gang?
3. **Er det kun dig, eller ved du om andre?** Hører Anne det samme fra to
   kunder samme dag: det er **rødt**. Ring til Ann nu (afsnit 4).

### A. "Mine kunder ringer, men jeg får ingen opgaver"

Det er produktets løfte, der svigter. Gå kæden igennem forfra. Hvert spørgsmål
udelukker et led:

| Spørg | Svar | Betyder | Gør |
|---|---|---|---|
| Når en kunde ringer, og du ikke tager den — hvad hører kunden? | **Det ringer bare ud**, eller din egen telefonsvarer | Viderestillingen virker ikke | **Mål:** Anne ringer selv til håndværkerens mobil og lader den ringe ud. Ringer den ud, eller svarer hans egen telefonsvarer, er viderestillingen væk. Bed ham sætte den igen. Koden står i appen under profilen → **Din viderestilling**. Ring derefter igen. Virker det stadig ikke → Ann, familie A1 |
| | **Firmaets hilsen** fra os | Opkaldet når frem til os | Videre til næste spørgsmål |
| Har kunden fået en SMS med et link? | **Nej** | SMS'en er ikke sendt eller ikke kommet frem | Spørg, om kundens nummer står under profilen → **Numre uden SMS**. Numre på den liste springer hele leadflowet over med vilje. Står det ikke der → Ann, familie A2 |
| | **Ja** | SMS-delen virker | Videre |
| Har kunden udfyldt formularen bag linket? | **Nej / ved ikke** | Opgaven oprettes først, når formularen er udfyldt (**D21**) | Forklar det. Det er ikke en fejl. Anne kan bede håndværkeren ringe kunden op |
| | **Ja** | Opgaven burde findes | Videre |
| Åbn appen nu. Ligger opgaven der? | **Ja, men jeg fik ingen besked** | Notifikationer er ikke slået til (**D55**). Push er den ENESTE kanal. Der kommer ingen SMS eller mail i stedet | Åbn appen fra hjemmeskærmen → profilen → **Beskeder** → slå til. Kun den installerede app kan få tilladelsen, ikke Safari. Har han tidligere sagt nej, skal det slås til under iPhonens Indstillinger → Notifikationer. Ring derefter selv som kunde, og se om beskeden kommer |
| | **Nej** | Opgaven er tabt mellem formular og app | → Ann, familie A3. **Rødt**, hvis det er sket mere end én gang |

### B. "Telefonsvareren siger noget forkert"

| Kunden siger | Sandsynligvis | Gør |
|---|---|---|
| Den siger **mit eget navn** i stedet for firmaets | Firmanavnet manglede ved tilmeldingen (**D33**) | Profilen → **Din telefonbesked**: ret teksten, og gem. Lyden bliver lavet igen. Ring selv og lyt. Hjælper det ikke → Ann |
| Det er **en anden stemme** end den, jeg valgte | Stemmeprøven og den rigtige hilsen kommer ikke fra samme kilde (**D29**) | Kendt fejl. → Ann (grøn), så hun kan se, hvilken fil der afspilles |
| Mine kunder hører **et andet firmas besked** | Nummeret har tilhørt en tidligere kunde, hvis viderestilling stadig peger herhen (**D37**) | **Rødt.** Der er persondata hos den forkerte. → Ann med det samme |
| Stemmen lyder **robotagtig** eller anderledes end i går | Den indspillede hilsen kunne ikke hentes, så systemet læser teksten op direkte | → Ann (gul) |

### C. "Jeg kan ikke logge ind"

Den mest almindelige henvendelse, og næsten altid løselig i røret. Lad kunden
gøre tingene, mens I taler.

| Kunden siger | Sandsynligvis | Gør |
|---|---|---|
| Koden fra mailen **virker ikke** | Han har bestilt to koder. Kun den **nyeste** virker; den nye dræber den gamle (**D47**) | Slet de gamle mails. Bestil én ny kode, og brug kun den |
| **Der kommer ingen mail** | Tastefejl i adressen (**D46**), eller spamfilteret | Bed ham læse adressen højt bogstav for bogstav. Tjek spam/uønsket. Mailen er normalt fremme på få sekunder |
| Der står, **jeg skal vente**, men jeg har ikke bestilt noget | Nogen på samme net har lige bestilt en kode (**D59**) | Vent ét minut, og prøv igen. Det er en bremse, ikke en fejl |
| "**Det passer ikke sammen**", men koden er rigtig | Efter for mange forsøg spærres der midlertidigt, og beskeden siger det samme som ved en forkert kode (**D54**) | Hold pause i nogle minutter. Brug derefter engangskoden i stedet for adgangskoden, og sæt en ny kode bagefter |
| Jeg er logget ind i **Safari**, men **appen** beder mig logge ind | Appen og Safari deler ikke login på iPhone. Det er sådan, iOS virker | Log ind i selve appen (ikonet på hjemmeskærmen) med engangskoden |
| Jeg sidder fast på "**tryk på kompasset**", og der er intet kompas | Den indbyggede browser i mailappen viser ikke altid knappen (**D62**) | Kopiér linket og åbn det i Safari selv. Eller log ind direkte på dashboardet og følg kortet der |

Virker intet af det → Ann, familie C. Skriv på sagskortet, hvilke trin I nåede.

### D. "Opsætningen siger, at testopkaldet ikke gik igennem"

| Spørg | Gør |
|---|---|
| **Tog du telefonen**, da den ringede? | Testen virker kun, hvis han **ikke** tager den. Bed ham prøve igen og lade den ringe ud |
| Har du sat viderestillingen med koden fra skærmen? | Bed ham taste den igen og vente på teleselskabets bekræftelse på skærmen |
| Ringede telefonen overhovedet? | **Nej** → Ann, familie D |

### E. "Jeg har betalt, men …"

| Kunden siger | Gør |
|---|---|
| Jeg har **ingen velkomstmail** fået | Tjek spam. Er den ikke der → Ann, familie E (gul — han har betalt) |
| Betalingen gik igennem, men **intet skete** | → Ann, familie E (gul) |
| Jeg betaler, men **kan ikke bruge appen**, eller mine opkald bliver ikke taget | → Ann, familie E. **Rødt**, hvis opkaldene ikke bliver taget: så mister han leads |

### F. "Referater / tilbud virker ikke"

Der findes bevidste bremser (kvoter), der ligner fejl. Beskeden på skærmen siger
som regel hvilken: nævner den **måneden** eller **i dag**, er det et loft. →
Ann, familie F. Forklar kunden, at det ikke er hans data, der er væk.

### G. Alt andet

Skriv kundens egne ord på sagskortet, og send det til Ann. Hvis to kunder
melder det samme, er det **rødt**.

---

## 3. Lag 2 — Ann: hvor du kigger, i rækkefølge

**Før du kigger, to regler, der begge har kostet tid:**

- **AppSignal er flere minutter bagud.** At der ikke er en fejl, er ikke et
  resultat. Og en fejlgruppes oversigt viser ét gammelt eksempel, ikke den
  nyeste forekomst. Åbn selve forekomsterne, og sammenhold dem med tidspunktet
  på sagskortet.
- **Er det overhovedet i stykker?** Løb først **Del 3b — Bremserne** i
  `ditdigitalekontor-drift-runbook.md` igennem. Flere ting, der ligner et
  nedbrud, er bremser, vi selv har bygget. Kom en klage i tidsrummet 7-17 lige
  efter en deploy: tænk på **D8** (et opkald under deploy er et tabt lead).

**Første blik, uanset familie:** `GET /health` på prod. Svarer den ikke, er
det Del 3 (incident) og ikke triage.

### A1 — opkaldet når ikke frem til os

1. **Twilio Call Log** (prod-kontoen) for firmaets DDK-nummer omkring
   tidspunktet. Kom der et indgående kald overhovedet?
   - **Intet kald:** viderestillingen hos teleselskabet er problemet, ikke os.
     `**61*` dækker kun ubesvaret. Optaget og uden dækning kræver `**004*`
     (**P6**). Operatørtesten er ikke gennemført, så hvert nyt teleselskab
     er ukendt land.
   - **Kald med en fejl eller 403:** signaturkontrollen (`OPKALD_SIGNATUR`).
     Se Del 3b. Rul ikke bare tilbage til `log`.
2. **Kaldet kom, men `From` er håndværkerens eget nummer:** kaldernummeret
   overlevede ikke viderestillingen (**P6**, H/H). Så går SMS'en til ham selv,
   uden at noget fejler.

### A2 — hilsenen afspilles, men der kommer ingen SMS

1. **Twilio Messaging Log:** blev SMS'en sendt, og hvad er dens status?
   Udeblivende SMS uden fejl: tjek saldoen på **hovedkontoen** (**D9**).
   Subkontoens $0.00 er normal.
2. **Railway-loggen** for `/opkald` omkring tidspunktet: fandt koden et firma?
   "Intet firma fundet" for et nummer, der burde være tildelt, peger på
   puljen. Kør `afstem-numre.js`.
3. **`firm_whitelist`:** står kalderens nummer der, er udfaldet korrekt.

### A3 — formularen er udfyldt, men der er ingen opgave

1. **`leads`** for firmaet omkring tidspunktet. Findes rækken, med
   `firm_id` sat?
   - **Findes, men ses ikke i appen:** RLS eller `firm_users`-koblingen.
     Tjek, at brugeren hænger på det rigtige firma.
   - **Findes ikke:** Railway-loggen for `/formular/:token` og AppSignal.
2. **Rækken findes, og appen viser den, men der kom ingen besked:** push
   (**D55**). Findes der et abonnement i `push_subscriptions` for firmaets
   bruger(e)?

### B — hilsenen

1. `firms.name`, `greeting_text`, `voice_gender` og `greeting_audio_url`
   for firmaet.
2. Lyt til filen i `greeting_audio_url`. Er den forkert: **D29**. Er feltet
   tomt eller filen væk: `/opkald` falder tilbage til live-TTS. Find ud af
   hvorfor renderingen fejlede.
3. **Et andet firmas besked (D37):** find nummerets historik
   (`phone_numbers.last_firm_id`). Det er persondata hos den forkerte. Skriv
   det i `HAENDELSESLOG.md`, og vurder inden for 72 timer, om det skal
   anmeldes til Datatilsynet.

### C — login

1. **Supabase Auth → Users:** findes brugeren, og hvornår er
   `last_sign_in_at`? Et login efter klagen betyder, at det lykkedes.
2. **Railway-loggen** for `/onboarding/nyt-link`: står der "ukendt email",
   er adressen tastet forkert (**D46**).
3. **Scaleway TEM:** blev mailen leveret, og hvornår? Afsendelse i Railway
   mod levering hos Scaleway.

### D — verifikationsopkaldet

1. Kør `tjek-opkald.ps1` mod prod-kontoen. Tolkningen står øverst i scriptet:
   to ben på 7-9 sekunder = viderestillingen virker. Ét ben på ca. 17 sekunder
   = telefonsvareren tog det. Intet ben 1 = fejlen er i backenden.
2. Ved intet ben 1: AppSignal. `/onboarding/verificer` logger nu sine udgange
   (**S26**), og opkaldets udfald kommer tilbage via `/twilio/opkaldsstatus`
   (**S27**).

### E — betaling og adgang

1. **Frisbii** (den rigtige konto — identificér den på webhooks, ikke på
   planlisten): findes kunden, og er abonnementet aktivt?
2. **`frisbii_webhook_events`:** kom `invoice_settled` ind, og står
   `processed_at` med eller uden `error`? Et event, der er "behandlet" uden
   at have gjort noget, kan ikke gensendes fra Frisbii (**D42**).
3. **`firms.billing_status`:** `/opkald` gater på den. Aktiv hos Frisbii,
   men ikke hos os, er **D15**: en betalende kunde, der er spærret ude.

### F — referater og tilbud

Del 3b i drift-runbooken. Tabellen dér er skrevet til netop det.

---

## 4. Hvor hurtigt

| Farve | Hvornår | Hvem gør hvad |
|---|---|---|
| **Rød** | Flere kunder samme dag · intet virker · en kunde mister leads gentagne gange · persondata hos den forkerte | Anne ringer til Ann **nu**. Byggedagen afbrydes |
| **Gul** | Én kunde mister leads eller kan ikke bruge det, han har betalt for | Ann samme dag |
| **Grøn** | Login, forklaring, kosmetik | Anne løser i røret. Ellers den næste lille dag |

---

## 5. Efter sagen

- **Lukket i lag 1:** intet mere. Men gentager det samme spørgsmål sig, så
  skriv det ind i afsnit 2 som en ny række.
- **Fandt Ann en fejl:** som et punkt i `RISIKOREGISTER.md` (ikke i denne
  fil). Henvis til punktet herfra med ID.
- **Ny bremse eller ny fejlbesked i produktet:** skriv symptomet her
  **samme dag**. Kan du ikke skrive, hvordan den ser ud for den, der ringer,
  er den ikke færdig (samme regel som Del 3b).
- **Sikkerhed eller persondata:** `HAENDELSESLOG.md`.
