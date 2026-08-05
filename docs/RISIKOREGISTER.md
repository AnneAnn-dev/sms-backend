# Risikoregister — Dit Digitale Kontor

**Ejer:** Ann
**Oprettet:** 2026-08-01
**Sidst gennemgået:** 2026-08-04 — fuld omvurdering af S og K
**Kadence:** gennemgås i det ugentlige driftsvindue (15 min). Fuld gennemgang hvert kvartal.

**Måling i driftsvinduet — ét tal:** hvor mange timer gik til uplanlagt arbejde i sidste uge?
Over en tredjedel betyder, at nye features ikke er problemet — årsagerne er. Så stopper du og fjerner en årsag i stedet for at rydde op igen næste gang. Noter tallet i ændringsloggen nederst.

---

## Årsager til uplanlagt arbejde

Udledt af det uplanlagte arbejde, der faktisk er forekommet. Når målingen ovenfor overskrider en tredjedel, vælges en årsag herfra og fjernes — der ryddes ikke bare op.

| # | Årsag | Hvad den har kostet | Fjernes med |
|---|---|---|---|
| Å1 | **Intet kontrollerer automatisk, at det der virkede i går stadig virker** | SMS-segmentering · billedupload aldrig koblet til storage · stemmefiler ude af sync · "Lomme Kontor" i TwiML | D2 — invarianttests |
| Å2 | **Samme sandhed står flere steder** og skal holdes i sync manuelt | Stemme-ID'er i kode og hos ElevenLabs · firmanavn hårdkodet flere steder | To mønstre: **udled frem for at kopiér** når muligt · **afstem automatisk** når ikke. Ét afstemningsscript pr. ekstern tjeneste, kørt i driftsvinduet. Har: Twilio. Mangler: ElevenLabs, Frisbii↔Supabase (**D15**), Railway↔`.env.prod` (**D16**) |
| Å3 | **Farlige operationer uden spærrer** | Twilio-masseindkøb og kontospærring | Fail-closed som standardmønster for alt der koster penge eller rører produktion — ikke kun numre |
| Å4 | **Hemmeligheder håndteres manuelt** | To nøglerotationer | S2 — secret scanning i CI |
| Å5 | **Kun den tiltænkte vej afprøves** — Ann og Anne kender begge den rigtige rute | Første-start-fælde · OTP-felt på udløbet link · iOS isoleret storage | P1 — se en fremmed bruge produktet |
| Å6 | **Fejl opdages af mennesker frem for systemer** — meta-årsagen bag alle ovenstående | Alt fundet sent, hvor oprydning er dyrest | D3 — dødmandsknap og alarmer |
| Å7 | **Ingen triage-vej** — afklaring tager længere end nødvendigt | Løbende | D11 — triage-runbog |

**Fire af syv fjernes på dag 1-3 i planen.** Fundamentsporet er ikke en omvej før tilbudsmodulet — det er behandlingen af det, der har spist de sidste måneder.

### Nye årsager, tilbudsmodulet tilføjer

| # | Årsag | Hvorfor den er ny | Fjernes med |
|---|---|---|---|
| Å8 | **Uventet regning** — variabel omkostning koblet til brugeradfærd | Fejlen kommer ikke som exception, men som et beløb | Ø2 — kvoter og budgetlofter |
| Å9 | **Juridisk henvendelse** — tredjeparter hvis data behandles uden at være brugere | Ny kategori af registrerede | J8 — samtykkeflow |
| Å10 | **Ikke-deterministisk adfærd** — modellen svarer ikke ens hver gang | Almindelige tests fanger det ikke: fejlen er ikke "forkert output", men "output der er lidt anderledes" | P5 og D14 |

---

## Sådan bruges registret

1. **Ét sted.** Alt der bekymrer dig, står her. Ikke i hovedet, ikke i en chat, ikke i en note.
2. **Status, ikke perfektion.** En risiko må gerne stå som `Accepteret` i månedsvis. Pointen er, at det er et valg og ikke en forglemmelse.
3. **Én linje pr. risiko.** Skal der skrives mere, hører det hjemme i en runbook eller et primer-dokument — læg et link i stedet.

**Status:** `Åben` (ingen mitigering) · `I gang` · `Mitigeret` (håndteret, overvåges) · `Accepteret` (kendt, bevidst ikke handlet) · `Venter på andre`

**S** = sandsynlighed, **K** = konsekvens. L / M / H.

### Hvordan S læses (omdefineret 4/8)

Registret indeholder to slags punkter, og de kan ikke bruge samme sandsynlighed:

- **Hændelser** — noget *kan* ske. `S` = chancen for at det sker. (D3, D9, S7, S10)
- **Tilstande** — noget *er* allerede sandt: "der findes ingen tests", "der er ingen betalende kunder". Her er `S` altid 100 %, og tallet bærer nul information.

**For tilstande betyder `S` derfor: sandsynligheden for at konsekvensen indtræffer inden for de næste tre måneder.** Før den rettelse stod 28 af 58 punkter som høj sandsynlighed og 15 som H/H — et register med 15 topprioriteter prioriterer ikke, og så falder valget af arbejde tilbage på det, der føles mest kontrollerbart.

### Udløser og indsats

To kolonner gør registret sorterbart:

- **Udløser** — hvornår punktet bliver farligt: `NU` · `Pilot` · `Betalende` · `Tilbud` · `Venter` (på andre) · `Vilkår` (accepteret eller permanent)
- **Indsats** — `min` (<30 min) · `timer` · `dag` · `dage` · `penge` (kan købes frem for bygges)

**Sorteringsregel: udløser → K → indsats.** Tabellerne nedenfor står i den rækkefølge, så de kan læses ovenfra og stoppes, når tiden er brugt.

---

## Principper

Fire regler, der gælder alt arbejde. De står her, fordi de skal læses igen, når det hele føles for stort.

**1. Gør fejl billige frem for usandsynlige.**
Omhu er en energiskat, du betaler pr. beslutning, for evigt — og den svigter, når du er træt. Tests, øvet rollback, små deploys og et brugt staging-miljø betales én gang og virker derefter af sig selv. Hver gang en fejl bliver billig, må du være *mindre* omhyggelig på det område uden at risikere mere. Det er sådan der kommer luft.

**2. Skeln skarpt mellem beslutninger, der kan rulles tilbage, og dem der ikke kan.**
Datamodel, hvor data ligger, faktureringsmodel, leverandør af telefoni — brug en dag, hvis det er nødvendigt. Navngivning, mappestruktur, farver, hvilket bibliotek — fem minutter, vælg, videre. Beslutningstræthed kommer af at bruge lige meget krudt på begge kategorier. Spørg altid først: *kan jeg fortryde det her?*

**3. Byg målingen før funktionen.**
Ikke overvågning bagefter. Hvis en funktion koster penge, findes kvoten og loftet, før første kald går igennem. Hvis en funktion kan fejle stille, findes alarmen, før funktionen går i produktion. En funktion uden måling er en funktion, du ikke ved noget om.

**4. Én ting i gang.**
Resten står synligt og stille på listen nedenfor. Halvfærdige spor koster opmærksomhed hver dag, også når der ikke arbejdes på dem.

> **De tidligere O5 og O6 er flyttet herop (4/8).** "Ingen færdig-kriterier" og "omhu er eneste værn" er arbejdsform, ikke risici — de kan ikke lukkes, og de optog to H/H-pladser i tabellen. De står allerede som Princip 1 og som tjeklisten nedenfor. Svigter de, viser det sig i målingen af uplanlagt arbejde øverst.

---

## "Færdig"-tjeklisten

Læses igennem før hver commit til `main`. Den er kort med vilje — den skal kunne bruges træt.

- [ ] **Test på det, der kan gå galt.** Ikke dækning. Den ene vej hvor fejlen er dyr
- [ ] **RLS på nye tabeller**, verificeret med `pg_policies` — ikke antaget
- [ ] **Kvote og budgetloft**, hvis funktionen koster penge pr. brug
- [ ] **Ingen persondata i logs** — telefonnumre, adresser, navne, transskriptioner
- [ ] **Ingen ny dublet.** Skrev jeg en værdi ned, som allerede findes et andet sted? Så hent den — eller byg en afstemning
- [ ] **Rollback-vejen kendt**, inklusive om migrationen kan rulles tilbage
- [ ] **Fem linjers begrundelse i repoet**: hvad valgte jeg, hvad var alternativet, hvorfor
- [ ] **Stopkriteriet var skrevet ned, før jeg begyndte** — og jeg holdt mig til det

> Kopiér listen til `CLAUDE.md`, så den gælder automatisk i Claude Code-sessioner i stedet for at skulle huskes.

---

## Aktuel status — én ting i gang

Opdateres i driftsvinduet. Formålet er, at det tredje afsnit ikke koster opmærksomhed.

**I GANG — præcis én**
- NU-listen, punkt 5 og 9 (dag 1 af fundamentsporet fortsætter, når listen er ryddet)

**NU-LISTEN — ca. seks timer, gøres før dag 1 fortsætter**

Alle punkter har udløser `NU`. Fem af dem stod før på dag 8-9, og tre fandtes slet ikke i registret. Tolv punkter, ca. seks timer.

**Status 5/8:** fire færdige, ét venter på Anne. Punkt 1-4 tog længere end anslået — ikke fordi arbejdet var større, men fordi hvert punkt afslørede noget, ingen ledte efter (S12, D24, P7, PATH-hændelsen, prod-røgtestens manglende dækning). Det er den slags fund, der retfærdiggør listen.

| # | Hvad | ID | Tid | Status |
|---|---|---|---|---|
| 1 | **Montér `frisbii-checkout` i `server.js`** — modulet har aldrig været indlæst | Ø5 | 5 min | ✅ **Færdig 5/8** — boot-linjen set i begge miljøer |
| 2 | `FRISBII_PLAN_HANDLE` + `SIMPLY_BASE_URL` i begge Railway-miljøer | Ø5 | 30 min | ✅ **Færdig 5/8** — `trial-30-dage`, bevist med 400 mod 404 |
| 3 | ≠404-tjek pr. kritisk endpoint i røgtesten | D23 | 20 min | ✅ **Færdig 5/8** — tre tjek i `smoke.js`, grøn 11/11 |
| 4 | `leads.firm_id` sættes i `/formular/:token` og `/opret-opgave` + backfill | D21 | timer | ✅ **Færdig 5/8** — begge veje bevist, `uden_firma = 0` i prod |
| — | *Ø5 trin 3: `/tak`- og `/afbrudt`-siderne* | Ø5 | — | ⏳ **Hos Anne** — tekster og krav afleveret 5/8 |
| 5 | Twilio auto-refill + saldoalarm på begge konti | D9 | 15 min | ⏳ **Venter på betalingskort fra banken** — ikke udskudt, blokeret udefra |
| 9 | GitHub push protection slås til | S2 | 10 min | ✅ **Afklaret 5/8 — men ikke som forventet.** Kræver betalt Advanced Security for private repoer. Testet med tre pushes, ingen afvist. Beslutning: købes ikke nu, gitleaks er forsvaret. Se S2 |
| 6 | Krydslækagetest manuelt: log ind som A, hent B's leads, forvent tomt | S7 | 30 min | ⬜ Åben — **ikke blokeret af D21**, politikken læser `call_id` |
| 7 | Enhedsøkonomi regnet igennem | Ø1 | 2 t | ⬜ Åben — indtægtssiden kendt: 1.875 kr/md, 30 dages trial |
| 8 | `HAENDELSESLOG.md`: de to poster udfyldes | J10 | 40 min | ⬜ Åben — **to nye hændelser 5/8** (PATH, prod-røgtest) |
| 10 | Dependabot + `npm audit` i CI | S11 | 20 min | ⬜ Åben |
| 11 | Aflæs Supabase' indbyggede auth-rate limits — før du bygger noget | S3 | 15 min | ⬜ Åben — se også S12, bygges sammen |
| 12 | MFA på domæneregistrator, Supabase, Railway, GitHub | S10 | 45 min | ⬜ Åben |

**Fundet undervejs 5/8 — nye punkter, ikke på den oprindelige liste**

Ingen af dem er glemt, og ingen af dem er akutte. To er lukket samme dag, tre er skrevet ned med et sted at høre til.

| ID | Hvad | Hvor det kom fra | Status |
|---|---|---|---|
| S12 | `/checkout/start` er offentligt og uden rate limit | Kodegennemgang under punkt 1 | ⬜ **Åben, M/M** — eksponeringen er allerede begyndt (punkt 2 er gjort). Bygges sammen med punkt 11/S3, samme mekanik |
| D24 | `rls-isolation-test.js` dækker mindre, end den ser ud til | `pg_policies`-opslag under punkt 4 | ⬜ **Åben, M/M** — `Pilot · timer`. Tre uafhængige skridt; ingen af dem haster, men en grøn test, der beviser for lidt, er værre end ingen test |
| P7 | `s-expired` bruges til tre situationer med to sæt tekster | Oprydning af velkomstteksten | ⬜ **Åben, L/L** — `Pilot · min`. Kosmetisk, rammer ikke pilotstien. Tages ved næste tur i `onboarding.html` |
| — | PATH på udviklingsmaskinen var overskrevet ned til to poster | Punkt 1's verifikationskald | ✅ **Lukket 5/8** — system-PATH genoprettet, verificeret i ny session. Årsag ikke fundet i egne scripts, formentlig en installer. Fremgangsmåde i runbogens Del 1 |
| — | `npm run smoke:prod` havde aldrig kørt (placeholder i `.env.smoke`) | Punkt 3's første prod-kørsel | ✅ **Lukket 5/8** — `.env.smoke` udfyldt, og `tjekPlaceholder()` bygget, så filen ikke igen kan lyve om at være konfigureret. Prod-røgtest nu grøn 11/11 |
| — | Onboardingens velkomstskærm lovede en kode, knappen lovede et link | Fejlmelding under punkt 4 | ✅ **Lukket 5/8** — tekst og knap rettet, `velkomstTilstand` holder skærmens tilstande adskilt. Ramte hver pilot ved første åbning |

**Bemærk mønsteret:** fem af de seks fund er samme fejltype — *noget så færdigt ud uden at være det.* Et umonteret modul, en placeholder ingen fjernede, en kolonne ingen kode fyldte, en knap der lovede noget andet end teksten. Det er Å6: fejl opdages af mennesker frem for systemer. To af dem er nu forsvaret af `smoke.js`; resten fandtes kun, fordi noget tvang dem frem.



**BESLUTTET, VENTER PÅ MIG — små dage**
- Pilotopkald i off-peak-vinduerne
- DPA'er hos Simply, GitHub, MS365, Bitwarden (J6 — mails, ikke arbejde)
- Varemærketjek (domænet er bekræftet Anns)

**VENTER PÅ ANDRE — koster ingenting at bære**
- **GDPR-sporet: der er søgt om midler til at få det håndteret** — J1, J2, J3, J4, J5, J7. ⚠️ J1 er pilotblokerende; kommer svaret ikke i tide, købes DPA-skabelonen særskilt
- Indløseraftaler via Frisbii (bankkontoen er på plads 4/8) — Ø4
- Operatørtesten af viderestilling ligger hos Anne — P6. Punkt på det ugentlige møde

---

## Dokumenternes rollefordeling

Bindende. Hvert dokument ejer én ting. Er du i tvivl om, hvor noget hører hjemme, hører det hjemme her.

| Dokument | Ejer | Indeholder IKKE |
|---|---|---|
| `ditdigitalekontor-primer.md` | Arkitektur, endpoints, tabeller, kerneflow, lærte faldgruber | Status, todo, prioritering |
| `ditdigitalekontor-drift-runbook.md` | Driftsopskrifter og procedurer — hvordan man gør en ting | Prioritering, udestående-lister |
| **`RISIKOREGISTER.md`** | **Alt der er åbent. Prioritering, plan, kapacitet, principper, tjekliste. Eneste autoritative liste** | Procedurer (henvis til runbogen) |
| `HAENDELSESLOG.md` | Hvad der er sket. Append-only, rettes aldrig | Alt andet |
| `tilbud-primer.md` + `tilbud-runbook.md` | Tilbudsmodulet — beslutninger og rækkefølge. Aktiveres når modulet starter | — |

`gdpr.xlsx` står ved siden af: fortegnelse, leverandører, slettepolitik.

---

## Kapacitet

| | |
|---|---|
| **Byggedage** | 4 × 8 timer — realistisk 5-6 effektive timer pr. dag. Planlæg efter 20-24 timer, ikke 32 |
| **Små dage** | 3 × 1-2 timer. Book maks. 3 af de 5 timer; resten er stødpude |
| **Byggedage bruges kun til** | kode, tests, migrationer |
| **Små dage bruges til** | GDPR og papir · bank/Frisbii/MobilePay · Anne · **pilotopkald** (7-7:30 og 15:30-17) |

Adskillelsen er ikke kosmetisk. Den er grunden til at markedsvalidering (P1-P3) kan køre parallelt med det tekniske fundament uden at koste en eneste byggetime.

---

## Drift

| ID | Risiko | S | K | Udløser · indsats | Status | Næste skridt |
|---|---|---|---|---|---|---|
| D21 | **`leads.firm_id` udfyldes ikke af koden** — ⚠️ **rettelse 5/8: det er `/formular/:token` og `/opret-opgave`, IKKE `/opkald`.** `/opkald` opretter kun `calls`-rækken; leadet skabes først, når kunden udfylder formularen. Både denne linje og runbogens punkt 21 stod forkert og sendte læseren det forkerte sted hen | H | H | NU · timer | **Mitigeret** | **✅ LUKKET 5/8-26, bevist i begge miljøer.** Kode rettet begge steder: `/formular/:token` krævede mere end et felt — opslaget hentede kun `id` fra `calls`, så `.select("id")` → `.select("id, firm_id")`; uden det ville `call.firm_id` være `undefined`. `/opret-opgave` var gratis (`firm_id` lå allerede i scope fra `firmIdFromToken()`). Verificeret med `Select-String`, at der kun findes **to** indsættelsessteder (`onboarding.js:685` er et opslag, ikke en indsættelse). **Bevis i data:** tre rækker samme formiddag — `Manuel oprettelse` 07:16 med `firm_id` ✓ · formular 07:14 med `firm_id` ✓ · formular 06:57 med `NULL` fra den gamle kode, altså en ægte kontrolgruppe med samme vej og samme nummer sytten minutter tidligere. Backfill kørt i begge miljøer, `uden_firma = 0`. **Bekræftet ufarligt at have udskudt: ingen af de fire RLS-politikker på `leads` læser `firm_id`** — alle går gennem `call_id`. **Fælde til næste gang: røgtesten kigger ikke på `firm_id`, så en grøn `npm run smoke` beviser intet her.** Rest: `firm_id not null`-migrationen kan nu planlægges |
| D23 | **Et modul kan være umonteret, uden at noget siger fra** — routen findes ikke, kaldet giver 404, intet crasher og intet logges. Anden forekomst: `onboarding-link` (kommenteret i `server.js` linje 78-82) og nu `frisbii-checkout`. Forsvaret er i dag en kommentar i kildekoden, og kommentaren virkede ikke | M | H | NU · min | **Mitigeret** | Røgtesten rammer hvert kritisk endpoint og kræver **≠ 404**. Det er kandidaten til runbogens punkt 25. Å1 anvendt på montering frem for på adfærd **5/8 LEVERET i `smoke.js`, grøn i begge miljøer:** tre tjek — (1) *negativ kontrol*: ukendt rute SKAL give 404, ellers er ≠404-tjekket værdiløst · (2) *monteringstjek*: løber `MONTEREDE_RUTER` igennem og samler alle fund i én kørsel · (3) *rodruten*: kræver 302 og validerer `location`, da en redirect til `undefined` ser rigtig ud i loggen. Listen holdes bevidst kort: kun ruter der skal findes i BEGGE miljøer (flag-styrede ruter giver 404 med vilje) og kun kald der falder på første validering, så intet skrives i prod. **Rest: føj `/opret-opgave` og Frisbii-webhooken til, når deres handlere er læst** |
| D9 | Twilio-saldo kan løbe tør — SMS holder bare op, ingen exception | M | H | NU · min | Åben | Saldoalarm hos Twilio + auto-refill **4/8: flyttet frem fra dag 8 — auto-refill er 15 minutter, ikke et projekt.** |
| D18 | **Koden læser 46 miljøvariabelnavne; prod-Railway og `.env.prod` har tilsammen 29.** Mindst 17 navne findes ingen af stederne. Nogle har formentlig en standardværdi i koden, men det er ikke verificeret — resten er tavse fejl, ingen har set | M | H | NU · timer | Åben | Kør `process.env`-optællingen mod begge kilder, og afgør pr. navn: har den en default i koden, eller mangler den? Fundet 2/8-26 under D16 **4/8: K hævet M→H. Konsekvensen er allerede materialiseret — Ø5 er et af de 17 hjemløse navne.** |
| D3 | Ingen alarm på tavshed — hvis Twilio-webhooken stopper, sker der bare ingenting | M | H | Pilot · timer | Åben | Dødmandsknap: alarm ved 0 opkald i X timer i arbejdstiden + delivery-failure-rate **4/8: flyttet frem fra dag 8. Uden den mistes en pilot uden at det opdages.** |
| D16 | **Produktionsvariabler tastes manuelt både i Railway og i `.env.prod`** — to kilder, ingen afstemning. Forældet `.env.prod` betyder, at lokale scripts kan ramme forkert konto eller projekt | M | H | Pilot · timer | **Delvist mitigeret** | **2/8-26: `afstem-railway-env.js` bygget (read-only, viser kun navne) og kørt. Fandt 9 afvigelser i staging, 8 i prod, heraf én reel defekt (`admin_email` vs. `ADMIN_EMAIL` — versalfølsomt, fejler tavst lokalt).** Oprydning står i `docs/D16-variabeloprydning.md` og er IKKE gennemført. Derefter: `.env.prod` genereres fra Railway, tastes aldrig. Se Å2 **4/8: nedgraderet H/H → M/H efter afstemningsscriptet. Resten er oprydning med kendt indhold.** |
| D8 | **Et opkald under deploy er et tabt lead** — rammer direkte produktets løfte, og der kommer ingen fejlmeddelelse | M | H | Pilot · min + dag | Åben | Verificér zero-downtime på Railway; afklar hvad Twilio gør ved 5xx vs. timeout **4/8: udløser rykket fra Betalende til Pilot, og opgaven splittet — reglen "deploy aldrig 7-17" koster minutter og gælder fra første pilot; verifikationen kan vente.** |
| D2 | Ingen automatiske tests — regressioner opdages først af kunder (jf. SMS-segmenteringsfejlen) | H | M | Pilot · dag | Åben | Tynd stribe integrationstests på de dyre veje **4/8: skåret fra 2 dage til 1 — tre tests på de dyre veje, ikke 5-7.** |
| D11 | **Ingen triage-runbog** — runbøgerne dækker det Ann gør, ikke "en kunde siger det ikke virker" | H | M | Pilot · timer | Åben | Hvor kigger man først: Twilio-log, Railway-log, AppSignal, database. En side **4/8: flyttet frem fra dag 2 — skal findes før nogen ringer.** |
| D1 | Gendannelsesøvelsen er bestået 3/7-26 for `public` + auth. **Storage er ikke dækket** — hverken filerne (uden for Postgres) eller metadata i `storage.objects`/`storage.buckets` (dumpes ikke med `--schema=public`). Lead-billeder kan ikke genskabes | M | M | Pilot · timer | I gang | Se `TILLAEG-gendannelse-storage.md`. Gentag øvelsen med det nye beståelseskriterie |
| D19 | **Railway staging og Railway production er ikke ens indbyrdes** (26 mod 24 variabler). Forskellene er opstået, ikke besluttet — så staging tester ikke nødvendigvis det samme som prod kører | M | M | Pilot · timer | Åben | Tredje sammenligning: Railway staging ↔ Railway production. Hver forskel skal enten fjernes eller skrives ned som bevidst. Fundet 2/8-26 |
| D15 | **Frisbii-abonnementsstatus kan drive fra firmastatus i Supabase.** Aktiv hos Frisbii + opsagt i databasen = betalende kunde spærret ude. Omvendt = gratis adgang. Ingen af delene giver en fejlmeddelelse | L | H | Betalende · timer | Åben | Afstemningsscript, read-only, køres i driftsvinduet. Samme mønster som `afstem-numre.js`. Se Å2 **4/8: S sænket M→L — der er nul abonnementer at drive fra. Flyttet fra dag 8.** |
| D17 | **PITR ikke slået til** — RPO er op til 24 timer ved datatab, og Storage er slet ikke dækket af backups | L | M | Betalende · — | Accepteret | Bekræftet i dashboardet 2/8-26. Genovervejes ved første betalende kunde. Kræver Small compute-add-on, og er ikke omfattet af Spend Cap. Begrundelse i runbogens Del 0.E |
| D24 | **`rls-isolation-test.js` dækker ikke det, den ser ud til at dække.** Tre huller fundet 5/8 ved gennemlæsning af `pg_policies`: **(1)** `leads` testes kun for *læsning* — skrivelåsen prøves på de seks nye tabeller, men ikke på `leads`, selv om det er den tabel, kunderne rent faktisk har data i · **(2)** testen kan ikke opdage, at `leads.firm_id` **ikke læses af nogen politik** — seed'en sætter kolonnen selv, så den grønne test beviser en isolation, der i virkeligheden udelukkende hviler på `call_id` · **(3)** de **dobbelte politikker** er usynlige for testen: `leads_select_eget_firma` (`{public}`) og `leads_select_own` (`{authenticated}`) gør det samme ad hver sin vej, og siden PERMISSIVE-politikker kombineres med ELLER, ville en stramning af den ene ikke ændre noget, så længe den anden siger ja. En sikkerhedsrettelse ville se ud til at virke uden at virke | M | M | Pilot · timer | Åben | Tre skridt, uafhængige: skrivelås-test på `leads` føjes til · testen udvider til at *afvise* redundante politikker, eller den ene fjernes (verificér først at de er ækvivalente — `{public}`-varianten er reelt lukket for anon, fordi `auth.uid()` er NULL) · når `leads`-politikken engang skifter til `firm_id`, skal testen kunne se forskel. ✅ Verificeret 5/8: `user_call_ids()` er korrekt bygget — `SECURITY DEFINER` med låst `search_path=public` og filtrering på `auth.uid()`. Ingen INSERT/DELETE-politik på `leads`, altså skrivning kun server-side som tilsigtet |
| D22 | **Relationen tilbud → faktura er ikke besluttet.** Er fakturaen en *tilstand* på tilbuddet eller en *afledt post* med egen identitet? Vælges der ikke, vælges det første ved et uheld — og et tilbud skal kunne rettes indtil accept, mens en faktura ikke må ændre sig | M | H | Tilbud · dag | Åben | Afklares **før første migration**. Tre bindinger: fortløbende og ubrudt fakturanummerserie · en udstedt faktura må ikke kunne ændres (byg som ét med D13s audit-spor) · bogføringslovens 5 år gælder fakturaer, ikke tilbud — deler de tabel uden et skillefelt, arver alt den længste frist, jf. J4 |
| D14 | **Kommende:** modelversionen ændrer sig under dig — Anthropic opdaterer eller udfaser, og adfærden skifter uden at noget går i stykker | H | M | Tilbud · timer | Åben | Lås modelstreng eksplicit. Regressionstjek på et fast sæt eksempler før hvert modelskift |
| D13 | **Kommende:** intet audit-spor. Rart for leads, nødvendigt for tilbud hvis kunde og håndværker er uenige om en pris | M | M | Tilbud · timer | Åben | Append-only historik på tilbud fra første migration |
| D5 | `server.js` vokser og bliver svær at overskue; tilbudsmodulet fordobler den | H | L | Tilbud · dage | Åben | **4/8: K sænket M→L — konsekvensen i dag er læsetid for én person, ingen ekstern effekt.** Udskudt med defineret udløser: umiddelbart før tilbudsmodulets første migration, hvor testene kan dømme omflytningen. Frigør 3 byggedage nu |
| D12 | Tidszoner og sommertid — opkaldstidsstempler, off-peak-vinduer, slettefrister i døgn | M | L | September · timer | Åben | Alt i UTC i databasen, konvertér kun ved visning. Test omkring 25. oktober |
| D20 | **To uafhængige miljøkontakter på maskinen:** `skift-*.ps1` styrer hvad `.env` beskriver, Railway CLI's link styrer hvad `railway`-kommandoer rammer. De kender ikke hinanden. 2/8-26 pegede `.env` på staging mens CLI-linket pegede på **production** | M | H | Vilkår · — | **Mitigeret** | `afstem-railway-env.js` kræver `--environment` eksplicit og arver aldrig linket. Regel skrevet i runbogen: tjek `railway status` før enhver `railway`-kommando |
| D7 | Twilio er single point of failure for produktets kernefunktion | L | H | Vilkår · — | Accepteret | Sinch/46elks evalueret; ingen handling nu |
| D6 | Alle deploys er manuelle og kan kun udføres af Ann | H | M | Vilkår · — | Accepteret | Se O1/O2 |
| D10 | Migrationer kan muligvis ikke rulles tilbage — rollback-vejen er kun halvt så lang som antaget | M | M | Vilkår · — | **Mitigeret** | **Afklaret 2/8-26: alle seks migrationer er tilføjende → rollback-vejen er HEL.** Regel "tilføj først, fjern senere" står i runbogens rollback-afsnit. ⚠️ Genåbnes ved første indsnævrende migration — `firm_id not null` er allerede planlagt i en kommentar i `20260727065655_kunder_og_opgavelag.sql` |
| D4 | Rollback-vejen er ikke øvet — utryghed under pres | — | — | — · — | **Mitigeret** | **Lukket 4/8.** Øvet på staging 2/8 og gentaget 4/8. Rollback-afsnit med øvelseslog står i runbogen. Gentages hvert kvartal |

## Sikkerhed

| ID | Risiko | S | K | Udløser · indsats | Status | Næste skridt |
|---|---|---|---|---|---|---|
| S7 | **Krydslækage mellem firmaer** — firma A ser firma B's kunder. Den ene fejl der ikke kan repareres bagefter. RLS findes, men intet beviser den | M | H | NU · min | Åben | Én test: log ind som A, hent B's leads, forvent tomt svar **4/8: S hævet L→M pga. D21 — krydslækage kan ikke vurderes, når ejerskabskolonnen er tom. Kan køres manuelt i dag: log ind som A, hent B's leads.** |
| S2 | Ingen secret scanning i CI — samme hændelseskategori kan gentage sig | L | H | NU · min | **Delvist mitigeret — resten accepteret** | **Registerfejl rettet 4/8:** gitleaks pre-commit er etableret 31/7 og verificeret i begge retninger (runbogens C2). **5/8 AFKLARET — serverlaget kan ikke købes for 10 minutter:** GitHub Secret Protection (secret scanning + push protection) er **ikke inkluderet for private repoer på gratis-plan**. Knapperne kan slås til i UI'et uden at blokere — bekræftet med **tre pushes**, hvoraf det sidste bar en roteret Supabase service role-nøgle af nøjagtig samme form som alarm #2. Ingen blev afvist, og ingen udløste en ny alarm. ⚠️ **Nuance:** de to eksisterende alarmer stammer fra repoet selv (commit `d6e373b`, *Detected in 1 location*), så GitHub **har** scannet det historisk — mærkaten "Public leak" beskriver mønsterkategorien, ikke offentlig eksponering. Hvorfor testpushene ikke reagerede, er uafklaret; resultatet er uændret: **blokeringen er ubevist.** Begge alarmer lukket som *Revoked* efter notering (dokumenterer S1). **Beslutning: købes ikke nu.** Gitleaks kender de mønstre, projektet faktisk bruger (Supabase, Twilio, Scaleway, Frisbii) — GitHub genkendte fx ikke `TWILIO_AUTH_TOKEN` på linje 5, kun Account SID'en på linje 4. Push protection ville kun dække hullet, hvor hooken springes over, og Ann er eneste committer. **Re-trigger: køb GitHub Advanced Security, når der kommer flere udviklere til, eller hvis `--no-verify` nogensinde bruges i en rigtig commit** |
| S10 | Kontoovertagelse — særligt domæneregistratoren, som styrer e-mail og dermed magic links | L | H | NU · timer | Åben | MFA overalt. Og: kan Ann komme ind igen ved tab af telefon og Bitwarden-adgang? |
| S11 | Forsyningskæde — hundredvis af transitive npm-afhængigheder, ingen overvågning | M | M | NU · min | Åben | `npm audit` i CI, Dependabot, låst Node-version med opgraderingsplan **4/8: konfiguration, ikke et projekt — 20 minutter.** |
| S12 | **`/checkout/start` er offentligt, uautentificeret og uden rate limit** — enhver kan få backenden til at oprette kunder hos Frisbii med din private nøgle. Ingen penge bevæger sig (kunden skal gennemføre betalingen), men resultatet er skraldekunder i Frisbii, støj i loggen og risiko for at Frisbii selv strammer. Ligger stille i dag, fordi routen svarer 404 — **eksponeringen begynder i samme øjeblik Ø5 er gennemført** | M | M | NU · min | Åben | Loft pr. IP på `/checkout/start` — samme mekanik som S3, så byg dem sammen. Fundet 5/8-26 ved kodegennemgang i forbindelse med Ø5 |
| S3 | Ingen rate limiting på OTP-/auth-endpoints | M | H | Pilot · min → timer | Åben | Rate limiting pr. IP og pr. telefonnummer **4/8: K hævet M→H — seks cifre uden loft er kontoovertagelse. Første skridt er at aflæse Supabase' egne auth-rate limits (15 min), ikke at bygge.** |
| S9 | Auth-overfladen er magic link + OTP og intet andet — hele sikkerheden hviler på ét flow | M | H | Pilot · timer | Åben | Kan OTP bruteforces? Kan magic link genbruges? Udløber det? Logout på anden enhed? |
| S4 | Telefonnumre og andre persondata kan havne i logs | L | M | Pilot · timer | **Delvist mitigeret** | **Registerfejl rettet 4/8:** `maskerTlf()` er leveret 31/7 i `onboarding.js` og anvendt seks steder. Rest: gennemgå de resterende logkald |
| S8 | `service_role`-nøglen omgår al RLS — hvor bruges den, og kunne kaldene bruge brugerkontekst i stedet? | M | H | Betalende · timer | Åben | Kortlæg alle anvendelser én gang, skriv det ned |
| S6 | **Kommende:** AI-proxy uden serverside prompt = åbent endpoint for fremmede | M | H | Tilbud · — | Åben | Prompten bor på serveren. Klienten sender intention + data, aldrig rå prompt |
| S5 | RLS kan glemmes på nye tabeller — fejlen er usynlig når man er eneste bruger | M | M | Vilkår · — | Åben | RLS ind i "færdig"-tjeklisten; verificér med `pg_policies` **4/8: K sænket H→M — tjeklisten findes nu.** |
| S1 | Nøgler har ligget i git-historikken; historikken består selv efter rotation | — | M | Vilkår · — | Mitigeret | Alle nøgler roteret. Vurdér om historikken skal renses |

## Jura og GDPR

| ID | Risiko | S | K | Udløser · indsats | Status | Næste skridt |
|---|---|---|---|---|---|---|
| J10 | De to nøglehændelser er ikke vurderet eller dokumenteret | H | L | NU · min | Åben | Halv side: dato, hvad skete, vurdering af anmeldelsespligt, begrundelse **4/8: lav konsekvens, men 40 minutter — billigere at gøre end at bære.** |
| J1 | Ingen databehandleraftale med kunderne — kan reelt ikke sælge B2B lovligt | H | H | Pilot · venter | Venter på andre | DPA-skabelon klar før første betalende kunde **4/8: udløser præciseret — piloter behandler ægte persondata, så DPA'en skal findes før første pilot, ikke før første betalende.** **4/8: der er søgt om midler til GDPR-håndtering. ⚠️ J1 er den ene i pakken, der er pilotblokerende — kommer svaret ikke før første pilot, købes DPA-skabelonen særskilt.** |
| J3 | Tredjepartsdata (håndværkerens kunder) står slet ikke i fortegnelsen — det er produktets kernedata | M | M | Pilot · penge | Venter på andre | Tilføj: opkald→lead, formularindsendelse, push, analytics, fejllogs, salgsleads **4/8: nedgraderet H/H → M/M — en manglende fortegnelsespost giver påbud, ikke bøde, hos et selskab uden kunder og uden klager.** **4/8: indgår i den ansøgte GDPR-pakke.** |
| J4 | Ingen slettepolitik — hverken på papir eller i kode | M | M | Pilot · penge + timer | Venter på andre | Frister pr. datakategori. Husk bogføringslovens 5 år og backup-rotation **4/8: S omvurderet. Papiret kan købes; at koden faktisk kan slette, kan ikke.** **4/8: indgår i den ansøgte GDPR-pakke.** |
| J6 | DPA mangler hos Simply, GitHub, Microsoft 365, Bitwarden. Simply huser salgsværktøjets persondata | M | M | Pilot · timer | Åben | Indhent; ret dashboardets DPA-tal så det tæller virkelighed |
| J7 | Rollefordelingen i `gdpr.xlsx` er flad — dobbeltrollen databehandler/dataansvarlig fremgår ikke | M | M | Betalende · penge | Venter på andre | Ret leverandørarket: underdatabehandlere vs. databehandlere **4/8: S omvurderet H→M.** **4/8: indgår i den ansøgte GDPR-pakke.** |
| J5 | Ingen proces for registreredes rettigheder (indsigt, sletning) — særligt for tredjeparter | M | M | Betalende · penge | Venter på andre | Skriv proceduren; afklar om sletning teknisk kan lade sig gøre **4/8: indgår i den ansøgte GDPR-pakke.** |
| J2 | Fortegnelsen mangler retsgrundlag og slettefrister på alle aktiviteter | L | M | Betalende · penge | Venter på andre | Udfyld `gdpr.xlsx` — begge kolonner, alle rækker **4/8: S omvurderet H→L — læst som "sandsynlighed for at konsekvensen indtræffer", ikke "papiret mangler".** **4/8: indgår i den ansøgte GDPR-pakke.** |
| J11 | Varemærke ikke verificeret. Domænet er bekræftet Anns — afklar om det står i selskabets navn eller privat | L | M | Betalende · timer | I gang | Tjek varemærkeregister. Overvej overdragelse til selskabet |
| J8 | **Kommende:** optagelse af møder rammer tredjeparter uden samtykke eller information | H | H | Tilbud · — | Åben | Tvungen samtykkeskærm i produktet, ikke en linje i vilkårene. Afklar med Anne |
| J9 | **Kommende:** transskriptioner til amerikansk model bryder EU-suverænitetsprincippet | H | M | Tilbud · — | Åben | Bevidst beslutning + DPA med Anthropic + overførselsgrundlag. Ellers EU-hostet model |

> **Note (opdateret 4/8):** der er **søgt om midler til at få GDPR-delen håndteret**, og J1, J2, J3, J4, J5 og J7 står derfor som `Venter på andre`. De koster ingen små timer, før der er svar.
>
> ⚠️ **Undtagelsen er J1.** Databehandleraftalen er pilotblokerende, fordi en pilot behandler ægte persondata om håndværkerens kunder. Kommer bevillingssvaret ikke før første pilot, købes DPA-skabelonen særskilt — det er få tusinde kroner og skal ikke afvente resten af pakken.

## Økonomi

| ID | Risiko | S | K | Udløser · indsats | Status | Næste skridt |
|---|---|---|---|---|---|---|
| Ø5 | **Checkout-endpointet er aldrig monteret.** `frisbii-checkout.js` findes, men `require("./frisbii-checkout")(app)` står ingen steder i kodebasen — kun som en kommentar *i filen selv*, der beskriver, hvordan den skulle indlæses. Endpointet svarer **404, ikke 500**. Dertil mangler `FRISBII_PLAN_HANDLE` og `SIMPLY_BASE_URL` i Railway. Produktet kan ikke købes | H | H | NU · timer | Åben | Tre ting i rækkefølge: **(1)** montér modulet i `server.js` · **(2)** sæt begge variabler i begge Railway-miljøer (prods plan-handle i prod, læst i LIVE-kontoen `test-2-lommekontor` efter F5) · **(3)** `/tak`- og `/afbrudt`-siderne på Simply-sitet + venlig rod-rute (Anne). ⚠️ Verificeret 4/8 med `Select-String`. **Runbogens Frisbii-punkt 7 beskriver fejlen forkert som en kontrolleret 500'er og skal rettes** **5/8: kodegennemgang af begge filer — monteringen er boot-sikker, `requireConfig()` kaldes først inde i handleren, så trin 1 kan trygt køre før trin 2. Signaturen er `(app)` alene. Env-vars fanges i closuren ved montering → Railway-ændringer kræver genstart. Se også S12: eksponeringen af endpointet begynder her.** **5/8: trin 1 og 2 ✅ FÆRDIGE OG VERIFICERET I BEGGE MILJØER.** Trin 1: modulet monteret. Trin 2: `FRISBII_PLAN_HANDLE=trial-30-dage` + `SIMPLY_BASE_URL=https://ditdigitalekontor.dk` sat i begge Railway-miljøer og i masterfilerne. Bevis pr. miljø: `POST /checkout/start` med tomt body svarer **400 `invalid_email`** (staging og prod), mens `POST /checkout/findes-ikke` svarer 404 — negativ kontrol, så testen kan skelne. ⚠️ **Prod var 404 i første måling:** commiten lå kun på `staging`, `main` var bagud. Fundet fordi prod blev målt og ikke antaget. **Ø5 forbliver `Åben` på trin 3** (Annes `/tak`- og `/afbrudt`-sider + venlig rod-rute), og prod kører fortsat på test-nøgler |
| Ø1 | Enhedsøkonomi ukendt — omkostning pr. kunde pr. måned er ikke opgjort | H | H | NU · timer | Åben | Regn Twilio + Railway + Supabase + Scaleway ud pr. kunde **4/8: to timers arbejde. Er tallet negativt, er hele treugersplanen forkert.** **5/8: indtægtssiden har nu et tal — `trial-30-dage` er oprettet i begge Frisbii-konti til 1.875,00 DKK/md med 30 dages prøveperiode. Omkostningssiden mangler stadig.** Bemærk at prøveperioden gik fra 14 til 30 dage (Annes beslutning 5/8) — det fordobler den ubetalte periode pr. kunde og skal med i beregningen |
| Ø2 | **Kommende:** transskription og AI er ubegrænsede variable omkostninger koblet til brugeradfærd | H | H | Tilbud · — | Åben | Kvoter i koden fra første linje + hårdt budgetloft hos Scaleway og Anthropic |
| Ø4 | Frisbii og MobilePay blokeret af manglende bankkonto — kan ikke modtage betaling | H | H | Venter · — | Venter på andre | **Bankkontoen er på plads 4/8. Indløseraftaler sat i gang via Frisbii.** Lukkes først når en betaling er gennemført ende-til-ende — ikke ved underskrift. Bemærk at Ø5 blokerer uafhængigt af dette |
| Ø3 | Ingen betalende kunder — løbende afbrænding uden indtægt | H | H | Vilkår · — | Accepteret | Se P3 |

## Produkt og marked

| ID | Risiko | S | K | Udløser · indsats | Status | Næste skridt |
|---|---|---|---|---|---|---|
| P3 | Ingen pilotkunder rekrutteret | H | H | NU · timer | Åben | Ring i off-peak-vinduerne på de små dage. Strategien ligger klar |
| P1 | Ingen fremmed har brugt produktet — kun Ann og Anne, som begge kender den tiltænkte vej | H | H | Pilot · timer | Åben | Sid ved siden af første pilotkunde under onboarding. Sig ingenting |
| P7 | **Piloterne ser halvdelen af det, der blev efterspurgt** — samtalepartnerne nævnte indtalte tilbud *og* fakturering. Tilbudsdelen kommer først, faktureringsdelen bagefter | M | M | Pilot · — | Åben | Skriv forventningen ned før første pilot, så lunken feedback ikke fejllæses som at produktet ikke holder |
| P5 | **Kommende:** modeloutput varierer fra gang til gang. Ingen fejl — bare "den plejede at skrive det bedre". Rammer tilliden, ikke funktionen | H | M | Tilbud · — | Åben | Validér form og grænser frem for indhold. Mennesket bekræfter altid tallet. Se D14 |
| P6 | **Viderestilling hos TDC, Telenor, Telia og 3 er ikke efterprøvet.** Tre delspørgsmål med hver sin konsekvens: registrering på erhvervsabonnementer (M/M) · `61` alene dækker ikke optaget eller uden dækning, `**004*` gør (M/H) · **overlever kaldernummeret viderestillingen?** (H/H — hvert lead ville få håndværkerens eget nummer, og SMS'en gå til ham selv, uden fejlmeddelelse) | ? | H | Venter · — | Venter på andre | Test ligger hos Anne. Én SIM pr. operatør, registrér `**004*`, ring udefra uden at tage den, aflæs `From` i Twilios Call Log. Resultatet skrives i primerens viderestillings-afsnit uanset udfald |
| P7 | **`s-expired` bruges til tre situationer med kun to sæt tekster.** Skærmen dækker (1) første åbning i den installerede app, (2) udløbet link i Safari, (3) login virkede, men kontoen kunne ikke findes. Situation 3 får overskriften "Linket er udløbet", hvilket er faktuelt forkert — linket virkede. Underteksten forklarer det rigtigt, så det er kosmetisk, og det rammer ikke pilotstien | L | L | Pilot · min | Åben | Overskriften i de to `!res.ok \|\| !mig?.firm`-grene sættes til noget i retning af "Vi mangler din konto". Fundet 5/8 under oprydningen af velkomstteksten. **Bemærk mønsteret:** samme markup i flere tilstande er en gentagen fejlkilde her — knapteksten faldt tilbage til "Send nyt link" af samme grund og krævede `velkomstTilstand` for at holde tilstandene adskilt |
| P2 | Efterspørgslen på tilbudsmodulet er uvalideret — det kræver aktiv indsats midt i en arbejdsdag | — | — | — · — | **Mitigeret** | **Lukket 4/8.** Efterspørgslen blev valideret i samtaler forud for hele projektet: indtalte tilbud **og** fakturering nævnt uopfordret som det attraktive. Rækkefølge besluttet: tilbudsdelen først, faktureringsdelen når den er klar → se D22 |

## Person og organisation

| ID | Risiko | S | K | Udløser · indsats | Status | Næste skridt |
|---|---|---|---|---|---|---|
| O4 | Ingen fast kadence med Anne — samarbejdet drives af initiativ, og initiativet er Anns | H | M | — · — | **Mitigeret** | Fast ugentligt møde på en lille dag, fast dagsorden **4/8: S hævet M→H — Anne har rejst bekymringen om balancen mellem konsolidering og fremdrift. Det er beviset. Fem minutter i kalenderen.** **Lukket 4/8 — fast ugentligt møde med Anne er etableret.** |
| O3 | Support vil afbryde udviklingsarbejdet når piloterne starter | H | M | Pilot · timer | Åben | Løftet om svar inden for én arbejdsdag. Support hører til på de små dage |
| O7 | **Fem dokumenter beskriver overlappende "hvad er åbent"** — runbogens 25 udestående punkter og primerens statusafsnit dubletterer risikoregistret. Å2 anvendt på dokumentation: bliver forældet med garanti | M | M | Pilot · timer | Åben | Konsolidering, dag 1½. Rollefordelingen nedenfor er bindende **4/8: nedgraderet H/M → M/M, og dag 1½ skåret fra 1 dag til 2 timer. Snævert mål: slet runbogens udestående-liste, flyt kun de reelle risici herind.** |
| O1 | Ann er eneste operatør — ingen anden kan deploye, rotere nøgler eller læse en migration | M | M | Betalende · — | Åben | Se O2 og S10. Kan ikke fjernes, kun dæmpes **4/8: nedgraderet H/H → M/M — med nul kunder er konsekvensen af Anns fravær forsinkelse, ikke tab. H/H igen fra første betalende kunde.** |
| O2 | Runbøgerne dækker ikke "Ann er væk i to uger" | M | M | Betalende · timer | I gang | Udbyg løbende — skriv runbook-siden mens opgaven udføres, ikke bagefter **4/8: nedgraderet H/H → M/M, samme begrundelse som O1.** |

---

## Plan — næste tre uger

### Byggedage

Til rådighed: 12 (4 pr. uge × 3). Planlagt efter omvurderingen 4/8: **6,5**. Resten er stødpude — en tredjedel af tiden går erfaringsmæssigt til uplanlagt arbejde, så 10 planlagte dage ud af 12 er stramt.

**Claude Code kommer først ind efter dag 1.** Deny-reglerne forhindrer den i at *læse* `.env` og køre `railway variables` — men ikke i at køre et almindeligt script, der læser `.env` som en normal del af sin drift. Er `.env.prod` forældet, taler det script med det forkerte sted. D16 er H/H og skal derfor lukkes, før et nyt værktøj slippes ind i repoet.

**Om Claude Code:** den er bedst, hvor der findes et objektivt facit (testene kører grønt, CI fejler på hemmeligheden, søgningen fandt alle forekomster) og dårligst, hvor pointen er, at Ann selv lærer noget. Kolonnen nedenfor angiver egnethed pr. dag. Grundregel: **den producerer hurtigere, end diffs kan læses.** Sættes tempoet op uden at review-tempoet følger med, opstår kode, ingen har set — det er stik imod læringsvejen.

| Dag | Status | Tema | Indhold | Claude Code | Færdig når |
|---|---|---|---|---|---|
| **1** | 🔵 I gang | Sandheden om produktion | D1 restore · D4 + D10 rollback · **D16 sammenligning Railway ↔ `.env.prod`** | **Nej — gør det selv.** Pointen er, at Ann kan gøre det kl. 22. D16-scriptet rører prodvariabler, som Claude Code ikke må | Gendannelse gentaget **inkl. Storage**, manifest findes, én lydfil og ét billede åbnet · en deploy rullet tilbage · afvigelser mellem Railway og `.env.prod` fundet og ryddet |
| **1½** (1 dag) | ⚪ Ikke begyndt | Opsætning + dokumentkonsolidering | **O7: runbogens 25 udestående punkter og primerens statusafsnit gennemgås ét ad gangen → bliver til risici i registret eller slettes. Runbogens fire rettelser (Supabase Pro, roller, nye docs, punkt 25b) skrives ind** · derefter `settings.json` ind · genstart · **spærringstest: `.env`, `railway variables`, `config.php` skal alle blokeres** · intro køres · opvarmningsopgave (manifest short_name + SW-bump) | Kun til opsætningsdelen | D16 lukket først. Ingen udestående-lister uden for registret. De to gamle dokumenter indeholder kun det, de ejer. Alle tre spærringer bekræftet blokeret. Én gennemført opgave på feature branch, diff læst |
| 2 | ⚪ Ikke begyndt | Spærrer i CI | S2-rest · S11 · **D11 triage-runbog (flyttet frem)** | **Høj.** Ren konfiguration med entydigt facit | CI fejler på en testhemmelighed. Triage-runbogen findes i udkast |
| 3 | ⚪ Ikke begyndt | Tests | D2 integrationstests — **tre, ikke 5-7** · S7 automatiseret | **Bevidst lav.** Læringsplads: den skriver første test med forklaring, Ann skriver den anden. Ann definerer, hvad der *skal* være sandt | 3 tests grønne lokalt og i CI, på de dyre veje |
| 4 | ⚪ Ikke begyndt | Alarmer | D3 dødmandsknap · D1 Storage-gendannelse · D8-reglen skrevet ned | **Høj at skrive, Ann kører.** Read-only, miljø-ekko før alt | Alarm affyres i en test · gendannelse gentaget inkl. Storage |
| 5 | ⚪ Ikke begyndt | Sikkerhedsoprydning | S9 auth-overflade · S3 rate limiting · S4-rest · S8 service_role | **Middel-høj.** S8 er en søgeopgave på tværs af kodebasen. S9 efterprøver Ann selv | Liste over service_role-anvendelser findes · OTP og magic link efterprøvet |

**Status opdateres her, ikke to steder.** ⚪ Ikke begyndt · 🔵 I gang · ✅ Færdig (dato) · ⏸️ Sat på pause (hvorfor). Kun én dag må stå 🔵 ad gangen, jf. Princip 4. Er en dag ✅, skal "Færdig når"-kolonnen faktisk være opfyldt — ikke "næsten".

**Frigjort 4/8: ca. 3,5 byggedage.** D5 (3 dage) er flyttet ind i tilbudsmodulet med defineret udløser, dag 1½ er skåret fra 1 dag til 2 timer, og D15 er flyttet til udløser `Betalende`.

De frigjorte dage fyldes **ikke** med mere kode. De går til det, der i dag ikke kan være i ni små timer: GDPR-sporet, pilotrekruttering, og de fem afklaringer der skal ligge færdige før første linje tilbudskode.

> Det bryder reglen om, at byggedage kun bruges til kode. Reglen blev lavet, for at markedsarbejdet kunne køre parallelt uden at koste byggetimer. Nu peger den den anden vej: de små dage er flaskehalsen, og byggedagene har overskud. Reglen skal tjene fordelingen, ikke omvendt.

**Udskudt bevidst — ikke glemt:**

| ID | Hvorfor udskudt | Hvornår |
|---|---|---|
| D8 | Verifikationen kræver undersøgelse af Railways deploy-adfærd. **Reglen** ("deploy aldrig 7-17") koster minutter og gælder allerede fra første pilot | Reglen: nu. Verifikationen: før første betalende kunde |
| D12 | Lav konsekvens, men **hård frist**: skal være testet før 25. oktober | September |
| D5 | Konsekvensen i dag er læsetid for én person. Opdelingen er billigst, når testene kan dømme omflytningen | Umiddelbart før tilbudsmodulets første migration |
| D15 | Nul abonnementer at drive fra endnu | Første betalende kunde |

### Små dage — det egentlige nåleøje

Til rådighed: ca. 9 bookbare timer over tre uger. Det er mindre, end der er arbejde. Rækkefølgen nedenfor er prioriteret, og det nederste når formentlig ikke med.

| Prioritet | Opgave | ID |
|---|---|---|
| 1 | **Pilotopkald i off-peak-vinduerne** — må ikke fortrænges | P1, P3 |
| 2 | Hændelsesloggen udfyldes (≈40 min) | J10 |
| 3 | Enhedsøkonomi regnet igennem | Ø1 |
| 4 | MFA overalt + domæneregistrator + recovery uden telefon | S10 |
| 5 | DPA hos Simply, GitHub, MS365, Bitwarden — mails, ikke arbejde | J6 |
| 6 | Varemærketjek | J11 |
| 7 | *Kun hvis bevillingssvaret trækker ud:* køb DPA-skabelonen særskilt | J1 |

**Flaskehalsen var de små dage.** Efter 4/8 er den lettet mærkbart: GDPR-sporet er sendt videre til en ansøgning, og den faste kadence med Anne er etableret. Det, der er tilbage på listen, er ca. fire timers arbejde plus pilotopkaldene — og pilotopkaldene er nu det eneste, der reelt konkurrerer om vinduerne.

Det er værd at bemærke, hvad der skete: to af de otte punkter forsvandt ikke ved at blive løst, men ved at blive lagt et andet sted. Det er den samme bevægelse som "gør fejl billige frem for usandsynlige" — anvendt på tid i stedet for på fejl.

### Tilbudsmodulet — samlet oversigt

Alle risici mærket **Kommende:** hører hertil. Listen udbygges, efterhånden som modulet tager form.

| ID | Emne | Skal være afklaret |
|---|---|---|
| Ø2 | Kvoter og budgetlofter | **Før første linje kode** |
| S6 | Prompten bor på serveren | **Før første linje kode** |
| J8 | Samtykke fra tredjeparter | **Før første linje kode** |
| J9 | Modelvalg og overførselsgrundlag | **Før første linje kode** |
| D13 | Audit-spor, append-only | **Før første migration** |
| **D22** | **Relationen tilbud → faktura** — tilstand eller afledt post? Fakturanummerserie, uforanderlighed, opbevaringsfrist | **Før første migration** |
| — | Leads/opgave-grænsen | **Før første migration** |
| D5 | Modulopdeling af ruterne — udføres som del af modulet, ikke som forarbejde | **Før første migration** |
| — | Skriftligt stopkriterie for den tynde skive | **Før første linje kode** |
| D14 | Modelversion låses, regressionstjek | Før produktion |
| P5 | Varierende output, menneskelig bekræftelse | Før produktion |

Desuden gælder tjeklisten øverst uændret, plus modulets egne invarianter: kvotetjek før ethvert betalt kald, og modeloutput bliver aldrig til et tal uden menneskelig bekræftelse.

---

## Bevidst accepteret

| ID | Hvorfor |
|---|---|
| D6 | Manuelle deploys er acceptable ved én operatør og lav frekvens |
| D7 | Twilio er evalueret mod Sinch og 46elks; skiftet koster mere end risikoen lige nu |
| Ø3 | Afbrænding er præmissen indtil pilotfasen er gennemført |
| P4 | Salgsværktøjet leverer værdi nu; teknisk gæld tages senere |
| D17 | Daglige backups (7 dage) dækker testdata og nul betalende kunder. Re-trigger: første betalende kunde |
| O5, O6 | Flyttet til Principper 4/8 — arbejdsform, ikke risici. Kan ikke lukkes, måles i stedet via uplanlagt arbejde |

---

## Ændringslog

| Dato | Ændring |
|---|---|
| 2026-08-01 | Register oprettet |
| 2026-08-01 | Tilføjet D8-D13, S7-S11. Kapacitet og plan tilføjet. Top 5 erstattet af dagsplan |
| 2026-08-01 | Principper, "færdig"-tjekliste og statusliste tilføjet. Måling af uplanlagt arbejde indført. J11 delvist afklaret: domænet er Anns |
| 2026-08-01 | Årsagsliste Å1-Å10 tilføjet — årsager til uplanlagt arbejde, inkl. de tre nye som tilbudsmodulet medfører |
| 2026-08-01 | D15 oprettet: Frisbii↔Supabase statusdrift |
| 2026-08-01 | D16 oprettet: produktionsvariabler dobbelttastes i Railway og `.env.prod` |
| 2026-08-01 | Claude Code-opsætning tilføjet (½ dag) med spærringstest. Egnethedskolonne pr. dag. Stødpude 3 → 2,5 dage |
| 2026-08-01 | O7 oprettet: dokumentdrift. Rollefordeling mellem de fem dokumenter fastlagt som bindende. Dag 1½ udvidet fra ½ til 1 dag med konsolidering. Plan 9,5 → 10 dage, stødpude 2,5 → 2 |
| 2026-08-01 | Supabase Pro bekræftet gennemført. Roller afklaret: Ann = backend, Anne = kundevendt. Tillæg om Storage i gendannelsesøvelsen skrevet |
| 2026-08-01 | **D1 rettet — fejl i registret.** Gendannelsesøvelsen var bestået 3/7-26; det stod i drift-runbogen. Reelt hul er Storage-filer + at øvelsen ikke er gentaget. Dag 1 justeret |
| 2026-08-01 | **Rækkefølge rettet på Anns initiativ:** opsætningen flyttet fra dag 0 til dag 1½. D16 lukkes før et nyt værktøj får adgang til repoet |
| 2026-08-01 | Plan opdateret: 7 → 9 byggedage. D15, D16, S9, S10, S11 indarbejdet. D8 og D12 udskudt eksplicit. Små dage prioriteret og erkendt som flaskehals |
| 2026-08-01 | D14 og P5 oprettet (Å10 gjort til rigtige risici). Å2 fik konkret mitigering: afstemningsscripts. Tjeklisten udvidet med dublet-tjek. Tilbudsmodul-oversigt tilføjet |
| 2026-08-02 | **PITR-status bekræftet i dashboardet: ikke slået til.** D17 oprettet som bevidst accepteret med re-trigger (første betalende kunde). Runbogens Del 0.E rettet fra Free-plan til Pro |
| 2026-08-02 | **D4: rollback øvet på staging.** Rollback-afsnit skrevet i runbogen med øvelseslog. D10 afklaret for i dag: nyeste migration er 27/7, deploys 1/8 — ingen migration i spil, så øvelsen besvarer ikke D10. Skrivebordsafklaring udestår |
| 2026-08-02 | Dagens rækkefølge byttet på Anns initiativ (mulighed C): rollback før gendannelse, så staging bevarer et rent måleinstrument til rollback-øvelsen |
| 2026-08-02 | **D10 lukket som mitigeret.** Gennemgang af alle seks migrationer: ingen drop/rename/alter column, alle `not null` har default eller står på nye tabeller. Rollback-vejen er hel. Regel skrevet i runbogen. Genåbnes ved første indsnævrende migration |
| 2026-08-02 | **D16 delvist mitigeret: `afstem-railway-env.js` bygget og kørt mod begge miljøer.** 9 afvigelser i staging, 8 i prod. Reel defekt fundet: `admin_email` vs. `ADMIN_EMAIL`. Fire variabler koden læser mangler helt i Railway. Oprydning planlagt i `docs/D16-variabeloprydning.md`, ikke gennemført |
| 2026-08-02 | **D18, D19 og D20 oprettet** som følge af D16-arbejdet: 17 navne uden hjem, uens miljøer, og to uafhængige miljøkontakter |
| 2026-08-02 | Gendannelsesøvelsen inkl. Storage (D1) **ikke påbegyndt** — flyttet til næste arbejdsdag med frisk formiddag |
| 2026-08-04 | **Statuskolonne tilføjet til byggedagene.** Planen sagde hvornår en dag er færdig, men havde intet sted at notere at den *er* det — status skulle læses i et andet afsnit. Nu er planen selvbærende |
| 2026-08-04 | **Ø5 omskrevet efter verifikation i kodebasen: modulet er aldrig monteret.** `require("./frisbii-checkout")(app)` findes ingen steder — endpointet svarer 404, ikke 500. Variablerne alene ville ikke have ændret noget. Runbogens Frisbii-punkt 7 er faktuelt forkert og skal rettes |
| 2026-08-04 | **D23 oprettet:** umonterede moduler fejler tavst med 404. Anden forekomst af samme fejlmåde. Fjernes med et ≠404-tjek i røgtesten — runbogens punkt 25 |
| 2026-08-04 | **O4 lukket:** fast ugentligt møde med Anne er etableret |
| 2026-08-04 | **GDPR-sporet flyttet til `Venter på andre`** — der er søgt om midler til at få det håndteret. J1, J2, J3, J4, J5, J7. Undtagelse noteret: J1 er pilotblokerende og købes særskilt, hvis svaret trækker ud. Små-dage-listen gik fra 8 til 7 punkter og fra ca. 9 til ca. 4 timers arbejde plus pilotopkald |
| 2026-08-04 | **Fuld omvurdering af S og K på alle punkter.** `S` omdefineret for tilstande: sandsynlighed for at konsekvensen indtræffer inden for tre måneder. Før: 28 af 58 stod H, heraf 15 H/H |
| 2026-08-04 | Kolonnen **Udløser · indsats** tilføjet. Alle seks tabeller sorteret NU → Pilot → Betalende → Tilbud → Venter → Vilkår |
| 2026-08-04 | **Ø5 oprettet, H/H:** checkout-endpointet er en kontrolleret 500'er i begge miljøer — `FRISBII_PLAN_HANDLE` og `SIMPLY_BASE_URL` har aldrig været sat. Produktet kan ikke købes. Fundet i runbogen, manglede i registret |
| 2026-08-04 | **D21 oprettet, H/H:** `leads.firm_id` udfyldes ikke af koden. Hæver S7 fra L til M |
| 2026-08-04 | **D22 oprettet:** relationen tilbud → faktura skal besluttes før første migration. Følger af beslutningen om rækkefølge |
| 2026-08-04 | **P6 oprettet:** viderestilling hos de fire danske operatører, `Venter på andre`. Test hos Anne. **P7 oprettet:** piloterne ser halvdelen af det efterspurgte |
| 2026-08-04 | **Tre registerfejl rettet — arbejde der var udført, men stod som åbent:** D4 (rollback øvet), S2 (gitleaks pre-commit 31/7), S4 (`maskerTlf()` 31/7) |
| 2026-08-04 | **P2 lukket som mitigeret.** Efterspørgslen valideret i samtaler forud for projektet: indtalte tilbud og fakturering. Rækkefølge besluttet: tilbud først |
| 2026-08-04 | **Ø4: bankkontoen på plads,** indløseraftaler i gang via Frisbii → `Venter på andre`. Lukkes først ved gennemført betaling ende-til-ende |
| 2026-08-04 | **D5 nedgraderet H/M → H/L og flyttet ind i tilbudsmodulet.** D15 flyttet til `Betalende`. Dag 1½ skåret til 2 timer. Planen 10 → 6,5 byggedage |
| 2026-08-04 | Nedgraderet: J3, J2, J4, J7, O1, O2, O7, D16, S5. Hævet: D18 (K), S3 (K), S7 (S), O4 (S) |
| 2026-08-04 | **O5 og O6 flyttet til Principper** — arbejdsform, ikke risici. Optog to H/H-pladser uden at kunne lukkes |
| 2026-08-04 | NU-listen indført i statusafsnittet: elleve punkter, ca. fem timer. Fem af dem stod før på dag 8-9 |
| 2026-08-05 | **Ø5 trin 1 + 2 færdige og verificeret i begge miljøer.** Trin 1: `require("./frisbii-checkout")(app);` monteret i `server.js` lige efter `frisbii-webhook`. Trin 2: `FRISBII_PLAN_HANDLE=trial-30-dage` + `SIMPLY_BASE_URL=https://ditdigitalekontor.dk` i begge Railway-miljøer og masterfiler. Bevis: `POST /checkout/start` → 400 `invalid_email` i staging og prod, negativ kontrol → 404. **Prod var 404 i første måling** — commiten lå kun på `staging`. Trin 3 (Annes sider) udestår, og prod kører på test-nøgler |
| 2026-08-05 | **D24 oprettet, M/M:** `rls-isolation-test.js` har tre huller — ingen skrivelås-test på `leads`, kan ikke opdage at `leads.firm_id` ikke læses af nogen politik, og er blind for de dobbelte PERMISSIVE-politikker (`leads_select_eget_firma` + `leads_select_own`), der kombineres med ELLER. En grøn test beviser mindre, end den ser ud til |
| 2026-08-05 | **S2 afklaret: push protection kan ikke købes for 10 minutter.** GitHub Secret Protection er ikke inkluderet for private repoer på gratis-plan — knapperne kan slås til uden effekt. Bevist med tre pushes; det sidste bar en roteret Supabase service role-nøgle af samme form som alarm #2 fra 15/5, og hverken blokering eller alarm reagerede. De to eksisterende alarmer er "Public leak", altså fundet i offentlige kilder og ikke i repoet — dokumenteret og lukket som *Revoked*, hvilket samtidig besvarer S1's spørgsmål om historikkens indhold. **Beslutning: købes ikke nu**, gitleaks pre-commit dækker de mønstre, projektet bruger, og Ann er eneste committer. Re-trigger noteret. **Lærdom: en knap, der lader sig slå til, er ikke et forsvar — tre tests var nødvendige for at se det** |
| 2026-08-05 | **D21 LUKKET, bevist i begge miljøer.** Kode rettet i `/formular/:token` (krævede `.select("id, firm_id")`) og `/opret-opgave`. Kun to indsættelsessteder findes. Bevis i data: kontrolgruppe med samme vej og nummer 17 min før ændringen havde NULL, de to efter har `firm_id`. Backfill kørt i staging og prod → `uden_firma = 0` begge steder. Røgtest grøn 11/11 i prod. **Registerfejl rettet: det er `/formular/:token`, ikke `/opkald`.** Bekræftet at ingen RLS-politik læser `leads.firm_id`, så ændringen var forebyggende |
| 2026-08-05 | **Onboardingens velkomstskærm rettet — hullet ramte hver pilot ved første åbning.** Skærmen lovede en engangskode, mens knappen hed "Send nyt link"; brugeren ventede på en mail, ingen havde bestilt. Ny tekst: *"Skriv din e-mail, så sender vi dig en engangskode, du skriver her i appen"* + knappen "Send mig en kode". **Skjult fælde:** `requestNewLink()` nulstillede knapteksten efter hvert tryk, så en ændring i boot-koden alene ville være rullet tilbage i det øjeblik brugeren trykkede — løst med `velkomstTilstand`, der holder skærmens tre tilstande adskilt. Statusteksten sætter nu også forventningen til leveringstiden ("kan være et par minutter undervejs"), efter at en mail blev opfattet som udeblevet, da den blot var langsom |
| 2026-08-05 | **P7 oprettet, L/L:** `s-expired` dækker tre situationer med to sæt tekster — "login virkede, men kontoen mangler" får forkert overskrift |
| 2026-08-05 | **D23 mitigeret:** ≠404-tjek leveret i `smoke.js` med negativ kontrol, monteringsliste og rodrute-tjek. Grøn 11/11 i begge miljøer. Runbogens punkt 25 kan lukkes |
| 2026-08-05 | **Hændelse — prod-røgtesten havde aldrig kørt.** `.env.smoke` havde `SMOKE_PROD_SUPABASE_URL=yyyyyyyy` (placeholder, aldrig udfyldt) og `SMOKE_PROD_URL` pegende på Simply-sitet i stedet for backenden. Deploy-tjeklistens `npm run smoke:prod` har dermed været uden dækning. Symptomet var otte røde tjek, der lignede et nedbrud i prod. **Fix:** `tjekPlaceholder()` afviser placeholder-værdier ved opstart, ledvis på URL'er (`https://yyyyyyyy.supabase.co` matcher ikke som hel streng, men `yyyyyyyy` gør). Testet mod 12 tilfælde, ingen falske positiver. **Samme familie som Ø5: noget så færdigt ud uden at være det — Å6** |
| 2026-08-05 | **Prøveperioden ændret 14 → 30 dage** (Annes beslutning). Ny plan `trial-30-dage` oprettet i både staging- og prod-kontoen: 1.875,00 DKK/md, månedlig frekvens. Erstatter det tidligere prod-handle `test-2-lommekontor`, som ikke længere bruges. Den gamle staging-plan `test-abonement` havde TOM prøveperiode-kolonne — samme fælde som `sub-0013` |
| 2026-08-05 | **S12 oprettet, M/M:** `/checkout/start` er offentligt og uden rate limit. Fundet ved kodegennemgang under Ø5. Eksponeringen begynder først, når Ø5 trin 2 er gennemført — bygges sammen med S3 |
| 2026-08-02 | **Twilio-signaturkontrol på `/opkald` sat til `haandhaev` i produktion** (runbogens punkt 24, trin 2). Ægte opkald observeret virke først. Staging står også på `haandhaev`. Trin 3 — verifikation af 403-afvisning i prod — er UDESTÅENDE. Hullet fra 31/7 er dermed lukket, men lukningen er ikke bevist |
