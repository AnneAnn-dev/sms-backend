# Udviklingsplan: fra telefonpasser til modulær app

> **Kopi til repoet.** Masteren er Claude Doc-udgaven: https://claude.ai/code/artifact/2ff8f1a7-b1d0-42ce-bfeb-8da2b8bbdaea
> Denne fil er eksporteret derfra 19/10-26 (rev 62) og opdateres kun ved en ny eksport. Ret i Claude Doc-udgaven, ikke her.
> Fotovejen (Trin 3b) fortsætter i projektets `claude/overdragelse-fotovejen.md`.

19/10-26 · Ann

## Kort fortalt

Planen har otte faser, og hver fase slutter med en **port**: en måling, der skal være grøn, før du går videre. Der er ingen datoer; rækkefølgen er det, der betyder noget, og størrelserne (S, M, L) er skøn, ikke løfter.

> **Status 18/10:** Fase 0 og Fase 1 er færdige, og Port 0 og Port 1 er grønne. I Fase 2 er Referat-fanen bygget og målt på iPhone i staging: optag → tekst, han kan rette eller indtale mere i → referat med teknik B-markeringer → gem, ret og markér som færdigt. Annes QA er godkendt (16 af 16 test OK 17/10), prod-domænet er målt, og 15 prøver kører i CI ved hvert push. Tilbage før Port 2 er beslutningerne under Port 2 nedenfor.

Planen bygger på [beslutningsgrundlaget](https://claude.ai/code/artifact/373567cf-fbe6-4202-890f-801a90e93d04) fra 13. oktober og på runbookens Trin 3.

**Fem regler, du arbejder efter hele vejen** (fra `CLAUDE.md`):

1. **Én ting ad gangen.** Vokser en opgave undervejs: stop, skriv det ned, udvid ikke.
2. **Staging før prod, altid.** Migration på staging → røgtest → samme migration på prod.
3. **Byg målingen før funktionen.** Koster et modul penge pr. kald, findes loftet før første kald.
4. **Bevis med et tjek, der ville fejle uden ændringen.** Et grønt deploy beviser ikke, at din ændring er med.
5. **Nyt modul bag flaget.** Intet modul må kunne mærkes i prod, før dets port er grøn.

## Vejen i én tegning

*(Tegningen "vejen gennem modulerne · 8 faser, 4 porte" findes kun i Claude Doc-udgaven.)*

De fire første faser følger efter hinanden, og hver port skal være grøn, før næste fase starter. Fra Fase 4 bygges ét modul ad gangen i den viste rækkefølge.

## Hvad hver del består af

Appen består af ét fundament og syv moduler. Her står, hvad hver del giver håndværkeren, hvad den er bygget af, og hvad der mangler. Faserne nedenfor beskriver rækkefølgen.

### Fundamentet · Fase 1 · altid med

Det, alle moduler står på. Et modul må bruge et andet, men aldrig kræve det.

- **Firma og login:** findes.
- **Kunder:** kundekartotek med navn, adresse og telefon (telefon er unik pr. firma). Kunder-fanen ligger inde i dashboardet i staging, med adresseforslag (1d).
- **Opgaver:** `leads` med forløbet ny → i gang → lukket, *Sig nej* og *Genåbn*, og automatisk lukning efter 3 måneder (funktionen findes, natjobbet mangler). Ejerskab via `leads.firm_id`, fail-closed, også i prod (1a, 1e).
- **Moduler pr. firma:** tabellen `firma_moduler`, én fælles spærre i serveren og `GET /api/moduler`, i staging (1b).
- **Kvote og loft:** dags- og månedsloft for Referathjælperen findes. Andre moduler får deres, når de bygges.
- **Betaling:** Frisbii, ét tillæg pr. modul og en plan for Hele pakken (Fase 3).
- **De fire faner:** Nye, I gang, Kunder og Skrivehjælp, med Profil øverst til højre, i staging bag `tilbudAktiv` (1c).

### Telefonpasser · i drift · 500 kr./md.

Et ubesvaret opkald bliver til en SMS til kunden og en ny opgave.

- **Består af:** opkaldsflowet i serveren, `/send-sms`, `/lead-telefon` og opgavelisten i `dashboard.html`.
- **Status:** punkt 2 (ejerskab via `firm_id`) er i prod 13/10. Opgavelisten deles i Nye og I gang, når `TILBUD_AKTIV` tændes i prod.

### Referathjælper · Fase 2 · 400 kr./md.

Håndværkeren indtaler en besigtigelse og får et referat, han kan rette.

- **Består af:** optageren (`tilbud/optager.js`, højst 20 minutter), transskription, udkast med teknik B-markéringer, og gem med `transskript` og `ai_udkast`.
- **Indtal ny opgave:** i "+ Ny opgave" bliver den indtalte tekst opgavens beskrivelse; kunden vælges i hånden (Ann 16/10). Bygges i dashboardet.
- **Loft:** dags- og månedsgrænse.
- **Mangler:** J8-teksterne i ny ordlyd, måling af prod-domænet og en test udefra. Referat-fanen og mikrofonteksterne er bygget og målt i staging 16/10.

### Svar på henvendelser · Fase 4 · 200 kr./md.

Håndværkeren sætter en besked ind og får et svarudkast, han selv kopierer videre.

- **Består af:** et tekstfelt i Skrivehjælp, en prompt, loft og genbrug af tekstmodellen.
- **Bevidst ikke med:** adgang til mail.

### Facebook-opslag · Fase 4 · 200 kr./md.

Udkast til et opslag om en udført opgave.

- **Består af:** et udkast i Skrivehjælp, mulighed for billeder fra opgaven og en påmindelse om at spørge kunden først.
- **Bevidst ikke med:** adgang til Facebook. Intet udgives automatisk.

### Tilbud · Fase 5 · 400 kr./md.

Et tilbud på opgaven, med eller uden referat.

- **Består af:** firmaprofil med faste priser, tilbudslinjer og et tilbud, der ikke kan ændres efter afsendelse (append-only).
- **Regel:** et tal bliver aldrig til en pris uden håndværkerens godkendelse.
- **Mangler:** `loadTilbud` og firmaprofilen er ikke bygget.

### Booking · Fase 6 · 400 kr./md.

Kunden booker selv en tid og bliver til en ny opgave.

- **Består af:** en offentlig side, ledige tider som håndværkeren selv udgiver (længde, transporttid og antal pr. dag) og spamværn.
- **Kræver først:** privatlivspolitik. Den offentlige side er en ny angrebsflade.

### Faktura · Fase 7 · 400 kr./md.

En faktura på opgaven, som kan bygge på tilbuddet.

- **Består af:** fortløbende numre og en faktura, der ikke kan ændres efter udstedelse.
- **Venter på:** advokatens svar om opbevaring og digitale bogføringssystemer (D22). Bygges sidst.

**Hele pakken** koster 1.500 kr./md. Alle priser er ekskl. moms.

## Fase 0: luk det, der er i gang ✅

Før noget nyt startes, skal det halvfærdige lukkes og skrives ned. Ellers bygger fase 1 på noget, ingen husker. Størrelse: S, et par dage.

- [x] **Registret og runbooken:** punkt 2, PWA-siden trin 1 og beslutningsgrundlaget (D80) skrevet ind 13/10 (`fcd6b5a`).
- [x] **`commit-opgave.ps1` tjekker `$LASTEXITCODE`:** rettet og bevist 4/0 13/10, D81 mitigeret (`453d624`).
- [x] **D24 skridt 1 og 2:** skrivelåsen på `leads` bevist 46/0 (`d42c916`); de gamle opkaldspolitikker fjernes i Fase 1 med en krydset række som bevis (`b2352bc`).
- [x] **`Claude outputs\supabase\.temp\`:** fandtes ikke længere. Opgavemapperne arkiveret, efter at hver fil var fundet i git-historikken på sit indhold.
- [x] **Mapperne i `_til-repo`:** slettet, efter at `telefonfelt-a` var bekræftet landet ved hash.

**Port 0:** `git status` er tom på `staging`, `status.ps1` viser ingen uafleverede opgaver, og registret har en post for hver beslutning fra 9.–13. oktober. ✅ **Grøn 13/10.**

## Fase 1: fundamentet ✅

Fundamentet er det, alle moduler står på, og det dyreste at lave om senere. Byg det før næste modul, i fem skridt. Størrelse: L.

**1a. Opgavens forløb (datamodel).** Størrelse M. ✅ **I staging 13/10** (`b0c73e4`), prod mangler.

- [x] **Sættet besluttet (Ann 13/10):** Nye = `open` og ikke startet · I gang = `open` og startet · Lukkede = `completed`, `rejected` eller den nye `inactive`. `status` beholder sine tre betydninger, så dashboardet i prod virker uændret. Badgen og "Ny"-mærket bygger fortsat på `seen_at` (ulæst), et andet begreb end Nye-fanen (ikke startet).
- [x] **Kolonnerne** `startet_at` og `sidst_roert` på `leads`, kun tilføjelser. Udfyldt: åbnede opgaver starter i I gang, uåbnede i Nye. `status` låst til fire værdier.
- [x] **Reglen i databasen**, ét sted (`opgave_handling()`). Handling = note, referat, tilbud, SMS fra opgaven, *Flyt til i gang*. Ikke handling = at åbne opgaven eller rette navn, telefon og adresse.
- [ ] **Natjobbet**, der kalder `luk_inaktive()`. Funktionen findes; jobbet (Railway-cron, som `vagt.js`) er ikke bygget. ⚠️ Før det kører i prod, skal dashboardets *Afsluttede*-filter vise alt, der ikke er `open`.
- [ ] **Prod:** migrationen FØR `onboarding.js`, ellers rapporterer `/send-sms` en fejl ved hver SMS.
- [x] **Bevis:** `proev-forloeb.js` 13/0 mod staging. Udfyldningen målt (10 åbnede startet, 1 uåbnet ny, 2 afviste startet). SMS-vejen målt i den deployede app: `startet_at` sat i samme sekund, som SMS'en gik.

**1b. Moduler pr. firma.** Størrelse M. ✅ **I staging 13/10** (`657f882`), prod mangler.

- [x] **Tabellen `firma_moduler`:** én række pr. firma og modul med `fra` og `til`. Hele pakken = syv rækker. RLS slået til uden politikker: kun serveren læser og skriver, så et firma kan ikke give sig selv et modul.
- [x] **Én fælles spærre** (`moduler.js`, `kraevModul`) foran Referathjælperens ruter. Fail-closed: uden række 403, kan rækkerne ikke læses 503. Kunder og opgaver er fundamentet og spærres ikke. Et afmeldt firma kan stadig læse sine gemte referater.
- [x] **`GET /api/moduler`** svarer med firmaets moduler og `tilbudAktiv`.
- [x] **Alle eksisterende firmaer har Telefonpasser**, og nye får det af en trigger, indtil Frisbii overtager i Fase 3.
- [ ] **Prod:** migrationen FØR koden, ellers svarer `/api/moduler` 503.
- [x] **Bevis:** `proev-moduler.js` 15/0 mod den deployede staging-server. Samme prøve gav 8/7 minutter forinden, mens Railway endnu kørte den gamle kode, så den fejler beviseligt uden ændringen.

**1c. De fire faner i dashboardet.** Størrelse L. Rører den prod-vendte fil. ✅ **I staging 13/10** (`86a37c6`).

- [x] **Profil i topbaren, Tips i Profil.**
- [x] **Nye og I gang erstatter listen.** Nye er sorteret med de nyeste først. I gang er sorteret efter sidst rørt, med *Lukkede (n)* sammenklappet øverst. Ulæst vises som en prik.
- [x] **Kunder og Skrivehjælp vises efter `/api/moduler`.** Fanerne vises kun med `tilbudAktiv:true`, ellers ser alt ud som i dag. Skrivehjælp er skjult uden `svar` eller `facebook`.
- [x] **Hver fane er en ø.** Kunder åbner endnu `/tilbud/` som en side for sig; at bygge den ind er 1d.
- [x] *Flyt til i gang* i opgavevinduet, og *Afsluttede* viser også `inactive` (natjob-fælden fra 1a er lukket).
- [x] **Bevis:** browsertest 26/0, hvor det gamle dashboard fejlede alle faneprøverne. På iPhone i den installerede app, staging: de rigtige opgaver i hver fane, prikken forsvinder ved åbning, en note flytter opgaven til I gang, og med flaget slukket ser appen ud som i dag.

**1d. Kunder-fanen.** Størrelse M. ✅ **I staging 13/10** (`fefed66`). Kunder-siden vises nu inde i dashboardet, i en ramme mellem topbaren og bundbaren, uden tilbudssidens egen topbar og referat-faner. Adressevælgeren ligger i sin egen fil (`adressevaelger.js`), som Ny opgave og Kunder deler. Kan filen ikke hentes, falder Ny opgave tilbage til postnr- og by-felterne. **Bevis:** browsertest 16/0, og på iPhone: Kunder bliver i appen, adresseforslag virker begge steder, og en opgave oprettet fra Kunder ligger i Nye.

**1e. Prod-forudsætningerne fra runbooken.** Punkt 2 (dashboardets læsesteder og `/send-sms`, `/lead-telefon` på `firm_id`) til prod. ✅ **I prod 13/10** via hotfix-PR #83 (`7ac95a8`, cherry-pick af `d88c773`, uden migration). Inden merge blev der målt `uden_firma = 0` af 5 i prod. Efter merge viste prod `dashboard-v32`, røgtesten gav 13/13, og appen var uforandret på telefonen. `main` er flettet ind i `staging` igen uden at ændre en byte (`8ac9cce`).

**Port 1:** alle prøver grønne i staging, faneskiftet set i den installerede app, og prod uden synlig ændring. ✅ **Grøn 13/10.** Prøverne: RLS 46/0, forløb 13/0, moduler 15/0 og browsertest 26/0 og 16/0. Fanerne er set på iPhone med flaget både til og fra, og prod er uforandret efter 1e.

## Fase 2: Referathjælperen færdig og i prod

Serversiden er grøn i staging; det, der mangler, er klientsiden og det, der kun kan måles på en telefon. Størrelse: L.

1. **Flyt optageren ind:** ✅ **I staging 14/10** (`67a830c`, `9646c8c`). `tilbud/optager.js` er genskabt fra spike-udgaven (`02a1171`). Grænsen på **20 minutter** gælder samlet på tværs af dele: optageren stopper selv og leverer en hel optagelse. Et spor, der er muted fra start (fx under et telefonopkald), afvises, før der optages. Bevis: `proev-optager.js` 32/0.
2. **J8, de tre tekster:** *rettet 13/10.* Der skal ikke bruges en samtykkeskærm. Referat-fanen er til håndværkerens egne noter, og værnet er tre tekster: advarslen ved optage- og kameraknappen, uddybningen i onboarding og linjen i vilkårene. Tekst 1 står ved optageknappen med 26/8-ordlyden. *16/10:* 9/9-ordlyden blev skrevet igen (Ann). 18/10: den er fundet og står i `docs/tilbud-primer.md`. Tekst 2 (uddybningen i onboarding) er droppet (Ann 18/10). Tekst 3 (vilkårene) mangler stadig; se beslutning 1 under Port 2.
3. **Referatet på opgaven:** optag → transskription, han kan rette → udkast med teknik B-markeringer → gem. ✅ **I staging 15–16/10** (skive 1 `02c5b85`, skive 2 `45cf440`, skive 3 `9122a9f` og rettelser 16/10). Udkastet sættes én gang; "Kladde" kan rettes, "Færdig" er låst på serveren. Under 10 ord laves intet referat, og serveren afviser lyd over 20 minutter (målt med leverandørens lydsekunder, 2 minutters margin). En del, han kasserer, tæller ikke mod de 20 minutter. Alt målt på iPhone 16/10.
4. **Indtal ny opgave:** *flyttet til dashboardet 16/10.* Ann besluttede: mikrofonen sidder i "+ Ny opgave", teksten bliver opgavens beskrivelse (ikke et referat), og kunden vælges i hånden. Bygges i dashboard-chatten (`claude/overdragelse-indtal-ny-opgave.md`).
5. **Mål mikrofon-tilladelsen i dashboardets egen app:** ✅ **Målt 14/10** på to iPhones (iOS 26.6.2). Kunder-rammen får mikrofonen uden `allow="microphone"`. Med standardindstillingen spørger iOS én gang pr. sideindlæsning, og igen efter log ud. Dialogen viser domænet. Ann besluttede tre korte tekster 14/10; 16/10 blev den første droppet som onboardingtrin, og de to andre er i koden og målt på iPhone.
   - **Onboarding:** *droppet 16/10.* En advarsel i onboardingen kommer dage før iOS' dialog og er glemt, når han trykker optag. Sætningen "Tryk Tillad, når opgave.ditdigitalekontor.dk beder om tilladelse til at bruge din mikrofon." står i stedet forrest i pop-up'en.
   - **Pop-up én gang pr. telefon**, når han optager første gang i en ny session og har optaget før: "Tryk Tillad, når opgave.ditdigitalekontor.dk beder om tilladelse til at bruge din mikrofon. Er du træt af at give tilladelse hver gang, så gå i Indstillinger → Apps → Safari → Mikrofon og vælg Tillad." ✅ **I staging og målt 16/10:** kommer før iOS' dialog, og aldrig igen på samme telefon.
   - **Efter Annuller:** "Tryk Tillad, når opgave.ditdigitalekontor.dk beder om tilladelse til at bruge din mikrofon, ellers kan du ikke bruge Referathjælperen." ✅ I staging 15/10.
   - Domænet sættes ind automatisk fra sidens adresse, så det altid passer i både staging og prod.
6. **Anne QA** i den installerede app med et testfirma på staging: ✅ alle 16 test OK 17/10. Mikrofonen spørger ikke altid lige ofte; det er iOS' egen adfærd.
7. **Før første betalende kunde:** delete-politikker og den stærke RLS-løsning (runbooken).
8. **Prøverne i CI:** ✅ 18/10 (4320cd7). Jobbet "Proever" kører 15 prøver ved hvert push til staging og hver PR. Seks prøver er bevidst udeladt, fordi de kræver staging, et token, `.env` eller prøvebænken; begrundelsen står i `kor-proever.js`.

**Port 2 – før `TILBUD_AKTIV` tændes i prod:** de fem porte fra Fase 1-planen (Ø2, S6, J8, J9, D36) er lukket, Anne har godkendt QA, og Referathjælper er slået til som modul på et pilotfirma, ikke på alle.

### Beslutninger før Port 2

Seksten punkter skal afgøres, før `TILBUD_AKTIV` tændes i prod (opgjort 18/10 ud fra registrets Port 2-rækker og de åbne ender). Tag gruppe A først, fordi den kræver Anne. Punkt 3 (stopkriteriet) afgør derefter, hvor mange af resten der skal være klar før prod.

**A. Indhold og jura (Ann og Anne)**

- [ ] **1. J13 og J8 tekst 3:** Afgjort af Ann 18/10: tekst 3 udvides til al indtaling, og "Kun dine egne noter" virker også i opgavevinduet. Tilbage: Annes ordlyd af den udvidede vilkårslinje, før `TILBUD_AKTIV` tændes.
- [ ] **2. J9, leverandør og overførselsgrundlag:** Er leverandørerne til tale og tekst i prod dem, der er målt på, og er der en databehandleraftale? Opfølgningen hos Syvai står som "ikke bekræftet sendt".

**B. Hvornår er det godt nok (Ann)**

- [x] **3. D36, stopkriteriet:** ✅ Skrevet og godkendt af Ann 18/10: diktafonvejen (bygget), fotovejen (beslutninger → måling af vision-model → samme JSON → penge først → bevis → Annes QA), fælles krav før TILBUD\_AKTIV, og hvad der bevidst ikke er krav. Under 150 ord er afskriften selv referatet. Åbent: værnet på fotovejen og roterede fotos. Fuld tekst i projektets claude/overdragelse-fotovejen.md; skal i D36 ved næste docs-levering.
- [ ] **4. D36, hullet i teknik B:** Teknik B ser ikke et almindeligt ord, som modellen har byttet ud ("tåret" → "torvet"). Boksens tekst blev ændret 16/10, men værnet er ikke rettet. Accepteres hullet i prod?
- [x] **5. Kamera og notefoto:** ✅ Ja, kamera og notefoto er med i første prod-udgave (Ann 18/10, fastholder D36 og S6). Fotoknappen skal derfor bygges og måles før Port 2. Anne har afklaret 18/10: hun har ikke testet et kamera, men taget fotos af referater, som Ann bad om. De er testmateriale til fotoknappen. S6 regner `notefoto` med til Fase 1.
- [ ] **6. Et færdigt referat kan ikke åbnes igen:** Acceptabelt i første udgave?

**C. Drift og økonomi (Ann)**

- [ ] **7. Ø2, lofterne i prod:** Gælder de samme tal som på staging (firma-månedsloft og dagsloft)? Ø2 og S6 står stadig som "Åben" med "Før første linje kode", selv om `kvote.js` og den server-side prompt findes og er målt 18/10. Skal de to rækker lukkes eller opdateres?
- [x] **8. D86:** ✅ Ja (Ann 18/10), bygget og bevist. En fejlet bogføring sender nu Bogfoeringsfejl til AppSignal (3682bc9, proev-kvote.js 50/0, 47/3 mod gammel kode). Bevist i staging-containeren via railway ssh 18/10 kl. 11.27: Bogfoeringsfejl #76 i AppSignal. Lokalt på Windows kan AppSignal ikke starte.
- [ ] **9. Natjobbet `luk_inaktive()`:** Ikke bygget. Skal det være klar før prod, eller kan det vente?
- [ ] **10. Sletteregler og stærk RLS:** Skal være på plads før den første betalende kunde. Tæller pilotfirmaet som betalende?

**D. Pilot og tænding (Ann)**

- [ ] **11. Pilotfirma:** Hvilket firma får modulet `referat` først, og hvem følger op med det?
- [ ] **12. `TILBUD_AKTIV` i prod:** Hvornår, og hvem tænder den?
- [ ] **13. Login:** Målingen fjernes omkring 20/10 som planlagt. Skal login-omvejen blive?

**E. Mindre ting**

- [ ] **14. "Proever" som påkrævet tjek i main:** Hvis ja, først når jobbet har kørt grønt et stykke tid, og runbookens C3 skal rettes samme dag.
- [ ] **15. Gråt udseende på deaktiverede hvide knapper:** Kræver Anns designvalg.
- [ ] **16. D14:** Kør `node proev-tekst-adapter.js --modeller` lige før prod, så modelnavnene er tjekket mod leverandørens liste den dag.

**Rækkefølgen ved udrulning ligger fast.** Den er ikke en beslutning, men den er en fælde:

- **D87:** `main` mangler tre migrationer, som prod allerede har.
- Et push fra `staging` sender alt med. Migrationerne 1a og 1b skal i prod før koden.
- Kør `migration list` før `push-prod.ps1`.

## Fase 3: betaling og pakker i Frisbii

Først når betalingen virker, kan et modul sælges for sig. Indtil da tændes moduler i hånden for pilotfirmaer. Størrelse: M–L.

- [ ] **Produkter i Frisbii:** et tillæg pr. modul og en plan for Hele pakken (1.500 kr./md. ekskl. moms), samme priser som i beslutningsgrundlaget.
- [ ] **Prøveperiode:** beslut længden, og hvad der sker, når den udløber uden kort.
- [ ] **Webhook → moduler pr. firma:** et køb åbner et modul, en opsigelse sætter slutdato. Genbrug mønsteret i `frisbii-webhook.js`.
- [ ] **Afstemning:** et script i driftsvinduet, der sammenligner Frisbii med moduler pr. firma og melder uenighed (D15-mønsteret).
- [ ] **Din pakke i Profil:** til- og fravalg, gyldigt fra næste måned.
- [ ] **Afmeldt modul:** håndværkeren kan stadig læse sit eget, men ikke lave nyt.

**Port 3:** køb, opgradering til Hele pakken og opsigelse er prøvet i Frisbiis testmiljø, og afstemningen er grøn.

## Fase 4–7: de øvrige moduler

Hvert modul følger samme opskrift: beslutninger og risici i registret → loft og kvote først → serverside med prøve → klientside bag modulspærren → pilotfirma → salg.

| Fase | Modul | Størrelse | Det, der skal på plads først | Port |
| --- | --- | --- | --- | --- |
| 4 | Svar på henvendelser | S | Prompt og loft; genbruger tekstmodellen | Udkast på 10 rigtige beskeder, læst af Anne |
| 4 | Facebook-opslag | S | Påmindelse om at spørge kunden før billeder bruges | Udgives aldrig uden et klik |
| 5 | Tilbud | L | Faste priser i firmaprofilen; tal bliver aldrig til en pris uden håndværkerens godkendelse; tilbud er append-only | Et tilbud kan laves både med og uden referat |
| 6 | Booking | L | Spamværn, privatlivspolitik, ledige tider med længde, transporttid og antal pr. dag | Offentlig side tåler misbrug; en booking bliver en ny opgave |
| 7 | Faktura | L | Advokatens svar på opbevaring og digitale bogføringssystemer (D22) | Fortløbende numre, kan ikke ændres efter udstedelse |

Fase 4 er bevidst små moduler først: de giver salg tidligt og prøver modulspærren og betalingen af på noget, der ikke er farligt.

## Sådan arbejder du dig gennem én opgave

Samme rækkefølge hver gang, også for små opgaver. Hvert trin lukker en fejl, der er sket i virkeligheden.

1. **Start:** `git pull`, `git branch --show-current` (staging), `git status` tom. Kør `sync-docs.ps1`.
2. **Afgræns:** skriv stopkriteriet ned, før du starter: hvad er færdigt, og hvilket tjek beviser det.
3. **Hent filerne friskt** til `_fra-repo`, og byg aldrig på en kopi fra tidligere.
4. **Levering** i `Claude outputs\<dato-opgave>\repo\`, med base og resultat i bytes.
5. **Aflever:** `aflever.ps1 <opgave>` og tjek størrelserne.
6. **Prøv lokalt** mod staging: prøvescript, røgtest.
7. **Commit og push:** `commit-opgave.ps1 <opgave> -Udfoer`, tjek `git log -2`, push.
8. **Bevis i staging:** et tjek, der ville fejle uden ændringen. Frontend: i den installerede app.
9. **Skriv det ned:** registret og runbooken, committet med det samme.
10. **Arkivér** opgavemappen.

Hver uge i driftsvinduet: mål timer brugt på uplanlagt arbejde. Er det over en tredjedel, så stop nyt arbejde og fjern en årsag først.

## Hvad der kan gå galt, og hvad der kan køre side om side

### De største risici

| Risiko | Hvad sker der | Værn |
| --- | --- | --- |
| Flere chats i samme fil | To chats retter `dashboard.html` eller registret samtidig, og den ene overskriver den anden | Én chat pr. fil. Sig det højt, før der skrives. Hent friskt før hver levering |
| `staging` og `main` glider fra hinanden | Et hotfix fra `main` mangler en migration eller retter noget, staging ikke har | Hotfix kun fra `main`, migrationer altid fra staging først. Aldrig `migration repair` |
| Ucommitteret dokumentarbejde | Et `git checkout` sletter dages arbejde (sket 1/10) | Commit hører til skrivningen |
| Formodninger i stedet for målinger | Noget erklæres løst, fordi AppSignal er stille | Bevis med et tjek, der ville fejle uden ændringen |
| Frisbii og databasen er uenige | En kunde betaler for et modul, han ikke har, eller omvendt | Daglig afstemning fra Fase 3. Databasen følger Frisbii, aldrig omvendt |
| Én udvikler | Uplanlagt arbejde æder planen | Ugentlig måling i driftsvinduet. Over en tredjedel: stop og fjern en årsag |

### Hvad kan køre side om side

**Anne kan arbejde parallelt med Fase 1:**

- 9/9-ordlyden af J8-tekst 2 og 3 (teksterne er godkendt, ikke nye). Fundet af Ann 18/10; tekst 2 er droppet, og tekst 3 mangler i vilkårene.
- Advokatkontakt om faktura og opbevaringstid.
- Privatlivspolitik opdateret til modulerne.
- QA i staging, når en port nærmer sig.

**Ann kan ikke køre parallelt med sig selv.** Ét modul ad gangen i produktion.

**To chats side om side (fra 18/10):** dashboard-chatten og Referat-chatten (Fase 2) må arbejde samtidig, fordi de rører hver sine filer.

| Chat | Ejer | Rører ikke |
| --- | --- | --- |
| Dashboard | `static/dashboard.html` og dashboardets ruter | `tilbud/` og `routes/tilbud/` |
| Referat (Fase 2) | `tilbud/`, `routes/tilbud/`, `kvote.js`, `kor-proever.js` | `static/dashboard.html` |

- **`static/sw.js` er fælles.** Begge bumper `CACHE_NAME`. Tjek `git show HEAD:static/sw.js | Select-String "CACHE_NAME ="` lige før hvert bump, og vælg et nummer over det højeste, der har været brugt (næste: v52; dashboard-chatten brugte v50 og v51 18/10).
- **Registret og runbooken:** én chat ad gangen. Sig det højt, før der skrives.
- **Push:** aldrig når `git status -sb` siger "ahead" for andet end ens egen commit.

**Afhængigheder at holde øje med:**

- Fase 4 (Svar og Facebook) kræver Fase 1b (moduler pr. firma).
- Fase 3 (betaling) kræver Port 2. Ingen tager betaling for noget, der ikke kører i prod.
- Faktura venter på advokaten og kommer sidst, uanset hvor hurtigt resten går.
