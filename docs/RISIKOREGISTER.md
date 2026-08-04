# Risikoregister — Dit Digitale Kontor

**Ejer:** Ann
**Oprettet:** 2026-08-01
**Sidst gennemgået:** 2026-08-01
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
- Fundamentsporet, dag 1 af 10 — sandheden om produktion (se planen nedenfor)

**BESLUTTET, VENTER PÅ MIG — små dage**
- GDPR-sporet i `gdpr.xlsx`: roller, manglende aktiviteter, retsgrundlag, slettefrister
- `HAENDELSESLOG.md`: de to poster udfyldes (≈40 min) → lukker J10
- Pilotopkald i off-peak-vinduerne
- Fast ugentligt møde med Anne aftales
- Varemærketjek (domænet er bekræftet Anns)

**VENTER PÅ ANDRE — koster ingenting at bære**
- Bankkonto → derefter Frisbii og MobilePay samme uge

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

| ID | Risiko | S | K | Status | Næste skridt |
|---|---|---|---|---|---|
| D1 | Gendannelsesøvelsen er bestået 3/7-26 for `public` + auth. **Storage er ikke dækket** — hverken filerne (uden for Postgres) eller metadata i `storage.objects`/`storage.buckets` (dumpes ikke med `--schema=public`). Lead-billeder kan ikke genskabes | M | M | I gang | Se `TILLAEG-gendannelse-storage.md`. Gentag øvelsen med det nye beståelseskriterie |
| D17 | **PITR ikke slået til** — RPO er op til 24 timer ved datatab, og Storage er slet ikke dækket af backups | L | M | Accepteret | Bekræftet i dashboardet 2/8-26. Genovervejes ved første betalende kunde. Kræver Small compute-add-on, og er ikke omfattet af Spend Cap. Begrundelse i runbogens Del 0.E |
| D18 | **Koden læser 46 miljøvariabelnavne; prod-Railway og `.env.prod` har tilsammen 29.** Mindst 17 navne findes ingen af stederne. Nogle har formentlig en standardværdi i koden, men det er ikke verificeret — resten er tavse fejl, ingen har set | M | M | Åben | Kør `process.env`-optællingen mod begge kilder, og afgør pr. navn: har den en default i koden, eller mangler den? Fundet 2/8-26 under D16 |
| D19 | **Railway staging og Railway production er ikke ens indbyrdes** (26 mod 24 variabler). Forskellene er opstået, ikke besluttet — så staging tester ikke nødvendigvis det samme som prod kører | M | M | Åben | Tredje sammenligning: Railway staging ↔ Railway production. Hver forskel skal enten fjernes eller skrives ned som bevidst. Fundet 2/8-26 |
| D20 | **To uafhængige miljøkontakter på maskinen:** `skift-*.ps1` styrer hvad `.env` beskriver, Railway CLI's link styrer hvad `railway`-kommandoer rammer. De kender ikke hinanden. 2/8-26 pegede `.env` på staging mens CLI-linket pegede på **production** | M | H | **Mitigeret** | `afstem-railway-env.js` kræver `--environment` eksplicit og arver aldrig linket. Regel skrevet i runbogen: tjek `railway status` før enhver `railway`-kommando |
| D2 | Ingen automatiske tests — regressioner opdages først af kunder (jf. SMS-segmenteringsfejlen) | H | M | Åben | Tynd stribe integrationstests på de dyre veje |
| D3 | Ingen alarm på tavshed — hvis Twilio-webhooken stopper, sker der bare ingenting | M | H | Åben | Dødmandsknap: alarm ved 0 opkald i X timer i arbejdstiden + delivery-failure-rate |
| D4 | Rollback-vejen er ikke øvet — utryghed under pres | M | M | Åben | Øv rollback på staging **to gange** — første gang med hjælp, anden gang alene efter runbogen. Gentages hvert kvartal |
| D5 | `server.js` vokser og bliver svær at overskue; tilbudsmodulet fordobler den | H | M | Åben | Modulopdel ruterne — efter testene er på plads |
| D6 | Alle deploys er manuelle og kan kun udføres af Ann | H | M | Accepteret | Se O1/O2 |
| D7 | Twilio er single point of failure for produktets kernefunktion | L | H | Accepteret | Sinch/46elks evalueret; ingen handling nu |
| D8 | **Et opkald under deploy er et tabt lead** — rammer direkte produktets løfte, og der kommer ingen fejlmeddelelse | M | H | Åben | Verificér zero-downtime på Railway; afklar hvad Twilio gør ved 5xx vs. timeout |
| D9 | Twilio-saldo kan løbe tør — SMS holder bare op, ingen exception | M | H | Åben | Saldoalarm hos Twilio + auto-refill |
| D10 | Migrationer kan muligvis ikke rulles tilbage — rollback-vejen er kun halvt så lang som antaget | M | M | **Mitigeret** | **Afklaret 2/8-26: alle seks migrationer er tilføjende → rollback-vejen er HEL.** Regel "tilføj først, fjern senere" står i runbogens rollback-afsnit. ⚠️ Genåbnes ved første indsnævrende migration — `firm_id not null` er allerede planlagt i en kommentar i `20260727065655_kunder_og_opgavelag.sql` |
| D11 | **Ingen triage-runbog** — runbøgerne dækker det Ann gør, ikke "en kunde siger det ikke virker" | H | M | Åben | Hvor kigger man først: Twilio-log, Railway-log, AppSignal, database. En side |
| D12 | Tidszoner og sommertid — opkaldstidsstempler, off-peak-vinduer, slettefrister i døgn | M | L | Åben | Alt i UTC i databasen, konvertér kun ved visning. Test omkring 25. oktober |
| D16 | **Produktionsvariabler tastes manuelt både i Railway og i `.env.prod`** — to kilder, ingen afstemning. Forældet `.env.prod` betyder, at lokale scripts kan ramme forkert konto eller projekt | H | H | **Delvist mitigeret** | **2/8-26: `afstem-railway-env.js` bygget (read-only, viser kun navne) og kørt. Fandt 9 afvigelser i staging, 8 i prod, heraf én reel defekt (`admin_email` vs. `ADMIN_EMAIL` — versalfølsomt, fejler tavst lokalt).** Oprydning står i `docs/D16-variabeloprydning.md` og er IKKE gennemført. Derefter: `.env.prod` genereres fra Railway, tastes aldrig. Se Å2 |
| D15 | **Frisbii-abonnementsstatus kan drive fra firmastatus i Supabase.** Aktiv hos Frisbii + opsagt i databasen = betalende kunde spærret ude. Omvendt = gratis adgang. Ingen af delene giver en fejlmeddelelse | M | H | Åben | Afstemningsscript, read-only, køres i driftsvinduet. Samme mønster som `afstem-numre.js`. Se Å2 |
| D14 | **Kommende:** modelversionen ændrer sig under dig — Anthropic opdaterer eller udfaser, og adfærden skifter uden at noget går i stykker | H | M | Åben | Lås modelstreng eksplicit. Regressionstjek på et fast sæt eksempler før hvert modelskift |
| D13 | **Kommende:** intet audit-spor. Rart for leads, nødvendigt for tilbud hvis kunde og håndværker er uenige om en pris | M | M | Åben | Append-only historik på tilbud fra første migration |

## Sikkerhed

| ID | Risiko | S | K | Status | Næste skridt |
|---|---|---|---|---|---|
| S1 | Nøgler har ligget i git-historikken; historikken består selv efter rotation | — | M | Mitigeret | Alle nøgler roteret. Vurdér om historikken skal renses |
| S2 | Ingen secret scanning i CI — samme hændelseskategori kan gentage sig | M | H | Åben | gitleaks eller GitHub push protection (10 min) |
| S3 | Ingen rate limiting på OTP-/auth-endpoints | M | M | Åben | Rate limiting pr. IP og pr. telefonnummer |
| S4 | Telefonnumre og andre persondata kan havne i logs | M | M | Åben | Gennemgå logkald; maskér før udskrivning |
| S5 | RLS kan glemmes på nye tabeller — fejlen er usynlig når man er eneste bruger | M | H | Åben | RLS ind i "færdig"-tjeklisten; verificér med `pg_policies` |
| S6 | **Kommende:** AI-proxy uden serverside prompt = åbent endpoint for fremmede | M | H | Åben | Prompten bor på serveren. Klienten sender intention + data, aldrig rå prompt |
| S7 | **Krydslækage mellem firmaer** — firma A ser firma B's kunder. Den ene fejl der ikke kan repareres bagefter. RLS findes, men intet beviser den | L | H | Åben | Én test: log ind som A, hent B's leads, forvent tomt svar |
| S8 | `service_role`-nøglen omgår al RLS — hvor bruges den, og kunne kaldene bruge brugerkontekst i stedet? | M | H | Åben | Kortlæg alle anvendelser én gang, skriv det ned |
| S9 | Auth-overfladen er magic link + OTP og intet andet — hele sikkerheden hviler på ét flow | M | H | Åben | Kan OTP bruteforces? Kan magic link genbruges? Udløber det? Logout på anden enhed? |
| S10 | Kontoovertagelse — særligt domæneregistratoren, som styrer e-mail og dermed magic links | L | H | Åben | MFA overalt. Og: kan Ann komme ind igen ved tab af telefon og Bitwarden-adgang? |
| S11 | Forsyningskæde — hundredvis af transitive npm-afhængigheder, ingen overvågning | M | M | Åben | `npm audit` i CI, Dependabot, låst Node-version med opgraderingsplan |

## Jura og GDPR

| ID | Risiko | S | K | Status | Næste skridt |
|---|---|---|---|---|---|
| J1 | Ingen databehandleraftale med kunderne — kan reelt ikke sælge B2B lovligt | H | H | Åben | DPA-skabelon klar før første betalende kunde |
| J2 | Fortegnelsen mangler retsgrundlag og slettefrister på alle aktiviteter | H | M | Åben | Udfyld `gdpr.xlsx` — begge kolonner, alle rækker |
| J3 | Tredjepartsdata (håndværkerens kunder) står slet ikke i fortegnelsen — det er produktets kernedata | H | H | Åben | Tilføj: opkald→lead, formularindsendelse, push, analytics, fejllogs, salgsleads |
| J4 | Ingen slettepolitik — hverken på papir eller i kode | H | M | Åben | Frister pr. datakategori. Husk bogføringslovens 5 år og backup-rotation |
| J5 | Ingen proces for registreredes rettigheder (indsigt, sletning) — særligt for tredjeparter | M | M | Åben | Skriv proceduren; afklar om sletning teknisk kan lade sig gøre |
| J6 | DPA mangler hos Simply, GitHub, Microsoft 365, Bitwarden. Simply huser salgsværktøjets persondata | M | M | Åben | Indhent; ret dashboardets DPA-tal så det tæller virkelighed |
| J7 | Rollefordelingen i `gdpr.xlsx` er flad — dobbeltrollen databehandler/dataansvarlig fremgår ikke | H | M | Åben | Ret leverandørarket: underdatabehandlere vs. databehandlere |
| J8 | **Kommende:** optagelse af møder rammer tredjeparter uden samtykke eller information | H | H | Åben | Tvungen samtykkeskærm i produktet, ikke en linje i vilkårene. Afklar med Anne |
| J9 | **Kommende:** transskriptioner til amerikansk model bryder EU-suverænitetsprincippet | H | M | Åben | Bevidst beslutning + DPA med Anthropic + overførselsgrundlag. Ellers EU-hostet model |
| J10 | De to nøglehændelser er ikke vurderet eller dokumenteret | H | L | Åben | Halv side: dato, hvad skete, vurdering af anmeldelsespligt, begrundelse |
| J11 | Varemærke ikke verificeret. Domænet er bekræftet Anns — afklar om det står i selskabets navn eller privat | L | M | I gang | Tjek varemærkeregister. Overvej overdragelse til selskabet |

> **Note:** GDPR-dokumentation, standardvilkår og databehandleraftale findes som færdige pakker til danske SaaS-virksomheder for få tusinde kroner. At alt hidtil er bygget selv har været rigtigt for produktet. Det er ikke automatisk rigtigt for papirarbejdet.

## Økonomi

| ID | Risiko | S | K | Status | Næste skridt |
|---|---|---|---|---|---|
| Ø1 | Enhedsøkonomi ukendt — omkostning pr. kunde pr. måned er ikke opgjort | H | H | Åben | Regn Twilio + Railway + Supabase + Scaleway ud pr. kunde |
| Ø2 | **Kommende:** transskription og AI er ubegrænsede variable omkostninger koblet til brugeradfærd | H | H | Åben | Kvoter i koden fra første linje + hårdt budgetloft hos Scaleway og Anthropic |
| Ø3 | Ingen betalende kunder — løbende afbrænding uden indtægt | H | H | Accepteret | Se P3 |
| Ø4 | Frisbii og MobilePay blokeret af manglende bankkonto — kan ikke modtage betaling | H | H | Venter på andre | Begge ansøgninger samme uge som kontoen er på plads |

## Produkt og marked

| ID | Risiko | S | K | Status | Næste skridt |
|---|---|---|---|---|---|
| P1 | Ingen fremmed har brugt produktet — kun Ann og Anne, som begge kender den tiltænkte vej | H | H | Åben | Sid ved siden af første pilotkunde under onboarding. Sig ingenting |
| P2 | Efterspørgslen på tilbudsmodulet er uvalideret — det kræver aktiv indsats midt i en arbejdsdag | H | H | Åben | Spørg tre håndværkere før der bygges |
| P3 | Ingen pilotkunder rekrutteret | H | H | Åben | Ring i off-peak-vinduerne på de små dage. Strategien ligger klar |
| P5 | **Kommende:** modeloutput varierer fra gang til gang. Ingen fejl — bare "den plejede at skrive det bedre". Rammer tilliden, ikke funktionen | H | M | Åben | Validér form og grænser frem for indhold. Mennesket bekræfter altid tallet. Se D14 |
| P4 | Salgsværktøjet er en separat teknologistak (PHP/MySQL) kun Ann kan vedligeholde | M | M | Accepteret | Skal en dag dø eller flytte ind i hovedproduktet |

## Person og organisation

| ID | Risiko | S | K | Status | Næste skridt |
|---|---|---|---|---|---|
| O1 | Ann er eneste operatør — ingen anden kan deploye, rotere nøgler eller læse en migration | H | H | Åben | Se O2 og S10. Kan ikke fjernes, kun dæmpes |
| O2 | Runbøgerne dækker ikke "Ann er væk i to uger" | H | H | I gang | Udbyg løbende — skriv runbook-siden mens opgaven udføres, ikke bagefter |
| O3 | Support vil afbryde udviklingsarbejdet når piloterne starter | H | M | Åben | Løftet om svar inden for én arbejdsdag. Support hører til på de små dage |
| O4 | Ingen fast kadence med Anne — samarbejdet drives af initiativ, og initiativet er Anns | M | M | Åben | Fast ugentligt møde på en lille dag, fast dagsorden |
| O5 | Ingen "færdig"-kriterier — opgaver vokser til den tid de får | H | H | I gang | Tjeklisten findes nu øverst i dette dokument. Skal bruges 7 gange, før den er en vane |
| O7 | **Fem dokumenter beskriver overlappende "hvad er åbent"** — runbogens 25 udestående punkter og primerens statusafsnit dubletterer risikoregistret. Å2 anvendt på dokumentation: bliver forældet med garanti | H | M | Åben | Konsolidering, dag 1½. Rollefordelingen nedenfor er bindende |
| O6 | Omhu er eneste værn mod fejl — skalerer ikke og svigter når Ann er træt | H | H | I gang | Gør fejl billige (D1-D4, S7) frem for usandsynlige |

---

## Plan — næste tre uger

### Byggedage

Til rådighed: 12 (4 pr. uge × 3). Planlagt: 10. Resten er stødpude — en tredjedel af tiden går erfaringsmæssigt til uplanlagt arbejde, så 10 planlagte dage ud af 12 er stramt.

**Claude Code kommer først ind efter dag 1.** Deny-reglerne forhindrer den i at *læse* `.env` og køre `railway variables` — men ikke i at køre et almindeligt script, der læser `.env` som en normal del af sin drift. Er `.env.prod` forældet, taler det script med det forkerte sted. D16 er H/H og skal derfor lukkes, før et nyt værktøj slippes ind i repoet.

**Om Claude Code:** den er bedst, hvor der findes et objektivt facit (testene kører grønt, CI fejler på hemmeligheden, søgningen fandt alle forekomster) og dårligst, hvor pointen er, at Ann selv lærer noget. Kolonnen nedenfor angiver egnethed pr. dag. Grundregel: **den producerer hurtigere, end diffs kan læses.** Sættes tempoet op uden at review-tempoet følger med, opstår kode, ingen har set — det er stik imod læringsvejen.

| Dag | Tema | Indhold | Claude Code | Færdig når |
|---|---|---|---|---|
| **1** | Sandheden om produktion | D1 restore · D4 + D10 rollback · **D16 sammenligning Railway ↔ `.env.prod`** | **Nej — gør det selv.** Pointen er, at Ann kan gøre det kl. 22. D16-scriptet rører prodvariabler, som Claude Code ikke må | Gendannelse gentaget **inkl. Storage**, manifest findes, én lydfil og ét billede åbnet · en deploy rullet tilbage · afvigelser mellem Railway og `.env.prod` fundet og ryddet |
| **1½** (1 dag) | Opsætning + dokumentkonsolidering | **O7: runbogens 25 udestående punkter og primerens statusafsnit gennemgås ét ad gangen → bliver til risici i registret eller slettes. Runbogens fire rettelser (Supabase Pro, roller, nye docs, punkt 25b) skrives ind** · derefter `settings.json` ind · genstart · **spærringstest: `.env`, `railway variables`, `config.php` skal alle blokeres** · intro køres · opvarmningsopgave (manifest short_name + SW-bump) | Kun til opsætningsdelen | D16 lukket først. Ingen udestående-lister uden for registret. De to gamle dokumenter indeholder kun det, de ejer. Alle tre spærringer bekræftet blokeret. Én gennemført opgave på feature branch, diff læst |
| 2 | Spærrer i CI | S2 secret scanning · **S11 npm audit + Dependabot** · D11 triage-runbog | **Høj.** Ren konfiguration med entydigt facit | CI fejler på en testhemmelighed. Triage-runbogen findes i udkast |
| 3-4 | Tests | D2 integrationstests · **S7 krydslækage** | **Bevidst lav.** Læringsplads: den skriver første test med forklaring, Ann skriver den anden. Ann definerer, hvad der *skal* være sandt | 5-7 tests grønne lokalt og i CI |
| 5-7 | Struktur | D5 modulopdeling af ruterne | **Højest i planen.** Mekanisk omflytning med testene som dommer. Små commits, kør testene mellem hver | Testene stadig grønne, `server.js` under 300 linjer |
| 8 | Alarmer og afstemninger | D3 dødmandsknap · D9 Twilio-saldo · **D15 Frisbii ↔ Supabase** | **Høj at skrive, Ann kører.** Read-only, miljø-ekko før alt | Alarm affyres i en test · afstemningsscript kører read-only |
| 9 | Sikkerhedsoprydning | S3 rate limiting · S4 log-maskering · S8 service_role · **S9 auth-overflade** | **Middel-høj.** S8 er en søgeopgave på tværs af kodebasen. S9 efterprøver Ann selv | Liste over service_role-anvendelser findes · OTP og magic link efterprøvet |

**Udskudt bevidst — ikke glemt:**

| ID | Hvorfor udskudt | Hvornår |
|---|---|---|
| D8 | Kræver undersøgelse af Railways deploy-adfærd, ikke en dags arbejde | Før første betalende kunde |
| D12 | Lav konsekvens, men **hård frist**: skal være testet før 25. oktober | September |

### Små dage — det egentlige nåleøje

Til rådighed: ca. 9 bookbare timer over tre uger. Det er mindre, end der er arbejde. Rækkefølgen nedenfor er prioriteret, og det nederste når formentlig ikke med.

| Prioritet | Opgave | ID |
|---|---|---|
| 1 | **Pilotopkald i off-peak-vinduerne** — må ikke fortrænges | P2, P3 |
| 2 | GDPR-sporet: roller → manglende aktiviteter → retsgrundlag → slettefrister | J7, J3, J2, J4 |
| 3 | Hændelsesloggen udfyldes (≈40 min) | J10 |
| 4 | MFA overalt + domæneregistrator + recovery uden telefon | S10 |
| 5 | Fast ugentligt møde med Anne aftalt | O4 |
| 6 | DPA-skabelon til kunder | J1 |
| 7 | Enhedsøkonomi regnet igennem | Ø1 |
| 8 | DPA hos Simply, GitHub, MS365, Bitwarden · rettighedsprocedure · varemærke | J6, J5, J11 |

**Flaskehalsen er de små dage, ikke byggedagene.** Hvis noget skal købes frem for bygges — se noten under GDPR — er det her, det giver mest.

### Tilbudsmodulet — samlet oversigt

Alle risici mærket **Kommende:** hører hertil. Listen udbygges, efterhånden som modulet tager form.

| ID | Emne | Skal være afklaret |
|---|---|---|
| Ø2 | Kvoter og budgetlofter | **Før første linje kode** |
| S6 | Prompten bor på serveren | **Før første linje kode** |
| J8 | Samtykke fra tredjeparter | **Før første linje kode** |
| J9 | Modelvalg og overførselsgrundlag | **Før første linje kode** |
| D13 | Audit-spor, append-only | **Før første migration** |
| — | Leads/opgave-grænsen | **Før første migration** |
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
| 2026-08-02 | **Twilio-signaturkontrol på `/opkald` sat til `haandhaev` i produktion** (runbogens punkt 24, trin 2). Ægte opkald observeret virke først. Staging står også på `haandhaev`. Trin 3 — verifikation af 403-afvisning i prod — er UDESTÅENDE. Hullet fra 31/7 er dermed lukket, men lukningen er ikke bevist |
