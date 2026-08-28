# CLAUDE.md — sms-backend (Dit Digitale Kontor)

Al kommunikation og alle kommentarer/tekster er på **dansk**.

## Hvad projektet er

B2B SaaS til danske håndværkere: ubesvarede opkald → Twilio `/opkald`-webhook → SMS med maskeret formularlink → lead i dashboardet. Multi-tenant (firms / firm_users / leads / calls / phone_numbers), Supabase Auth + RLS, Frisbii/MobilePay-billing, Scaleway TEM-mail, ElevenLabs TTS. Frontend er en PWA (dashboard.html + onboarding.html), serveret af samme Express-app.

## Ved sessionsstart

Læs `docs/RISIKOREGISTER.md` (aktuel status, principper, seks-linse-tjek), før du foreslår eller udfører noget. Rører opgaven tilbudsmodulet: læs også `docs/tilbud-primer.md` og `docs/tilbud-runbook.md`. Denne fil er konventioner — de tre er autoritative for status og beslutninger.

### Hvor dokumenterne bor (fastlagt 28/8-26)

Der findes to kopier af `docs/`, og kun den ene er sand:

- **Master: `C:\Users\Bruger\sms-backend\docs\`** — versionsstyret i git. Historik, dato og en vej tilbage. Det er sandheden.
- **Arbejdskopi: `C:\Users\Bruger\claude-arbejdstrae\docs\`** — den mappe, Cowork-sessioner får adgang til. Ingen git, ingen historik.

**Ritualet, når en session skal skrive i dokumenterne:**

1. Ann kører `sync-docs.ps1` (visning). Er arbejdstræet bagud: `-Hent` først.
2. Sessionen skriver i arbejdskopien.
3. Ann kører `sync-docs.ps1 -Aflever`, læser `git diff -- docs` og committer.

**Bed om trin 1, hvis det ikke er gjort.** En session, der redigerer en forældet kopi, producerer en fletning, ingen bad om. Det skete 13/8 (to grene af registret, ingen af dem komplet) og igen 27/8 (projektkopien seksten minutter bagud, D37 manglede).

**Der findes ingen kopi af registret i Claude-projekterne** — den blev fjernet 28/8, netop for at ingen kan læse en forældet udgave og tro på den. Kan du ikke nå maskinen, så sig det højt. Arbejd aldrig ud fra hukommelsen eller en ældre udgave.

**`sync-docs.ps1` dækker `*.md` direkte i `docs\` samt `CLAUDE.md` i roden.** Alt andet — undermapper, regneark, pdf'er, kode — hører ikke til i synkroniseringen og kopieres i hånden, hvis det overhovedet skal.

**Før du skriver i `RISIKOREGISTER.md`:** udfyld "Redigeres nu"-linjen øverst med dato, klokkeslæt og en kort markering (fx "S6 skrives ind"), og ryd den igen straks efter skrivning. Står den udfyldt af en anden session, så vent eller spørg Ann.

## Stack & konventioner

- Node.js / Express 5, **CommonJS — ingen ESM**. Flad filstruktur.
- **Node-versionen er låst i `package.json` → `engines.node`** (28/8-26, S11). Feltet læses af BÅDE CI og Railpack på Railway — ét tal, to forbrugere. Ret det aldrig uden at læse næste build-log og bekræfte, at prod byggede med den version.
- Windows / PowerShell 5.1 / VS Code. Scripts køres lokalt, ikke på Railway.
- **`.ps1`-filer skal være REN ASCII** (PS 5.1 fejllæser UTF-8 uden BOM). Ingen æøå, ingen emoji i .ps1.
- Git: `main` (PR-beskyttet, = prod) · `staging` · feature-branches. Arbejd altid på en branch, aldrig direkte på main.
- **CI kører ved push til `staging` og ved PR til `main`** (`.github/workflows/ci.yml`): `npm ci --omit=dev` + `npm audit`. ⚠️ Grænsen er `--audit-level=critical`, ikke `high` — det er et bevidst valg (S22), og prisen er, at et NYT high-fund ikke blokerer. Læs derfor "Fuld rapport"-trinnet, når du rører afhængigheder.
- **Dependabot** åbner PR'er mod `staging` (`.github/dependabot.yml`). Konfigurationsfilen læses fra `main`.
- EU-datasuverænitet er et produktprincip: ingen nye US-tjenester eller tredjeparts-analytics uden eksplicit beslutning fra Ann.

## Arbejdsprincipper

Fire regler, der gælder alt arbejde i dette repo.

1. **Gør fejl billige frem for usandsynlige.** Tests, øvet rollback, små deploys og et brugt staging-miljø slår omhu, fordi omhu svigter når man er træt.
2. **Skeln mellem beslutninger der kan rulles tilbage, og dem der ikke kan.** Datamodel, datalokation, faktureringsmodel og leverandørvalg fortjener tid. Navngivning, mappestruktur og biblioteksvalg gør ikke. Spørg altid: kan det her fortrydes?
3. **Byg målingen før funktionen.** Koster funktionen penge pr. brug, findes kvoten og loftet før første kald. Kan den fejle stille, findes alarmen før produktion.
4. **Én ting ad gangen.** Vokser en opgave undervejs: stop, rapportér til Ann, udvid ikke selv.

## Miljøer — de vigtigste regler i hele filen

- **Den lokale `.env` peger på STAGING.** Det er normaltilstanden.
- `.env` redigeres ALDRIG direkte. Ret masterfilerne (`.env.staging` / `.env.prod`) og kør `skift-staging.ps1` / `skift-prod.ps1`.
- **⚠ `.env.prod` er en kopi af ukendt friskhed.** Sandheden for produktion bor i **Railway**. Produktionsvariabler tastes i dag manuelt begge steder, så filen kan være forældet uden varsel. Brug den aldrig som facit for, hvad der gælder i prod — spørg Ann. (Risiko **D16**; ophæves når afstemningsscriptet er på plads og `.env.prod` genereres fra Railway.)
- **Findes filen `.ENV-ER-PROD` i repo-roden, peger miljøet på PROD → STOP.** Kør ingen scripts, foreslå ingen kørsler, før Ann eksplicit har bekræftet eller skiftet tilbage med `skift-staging.ps1`.
- Efter enhver miljø-/env-ændring: verificér med `node check-env.js --live` (staging) eller `node check-env-prod.js --live` (prod). Rød = stop.
- Prod-hemmeligheder bor i Bitwarden + Railway. De må aldrig ende i git, logs eller chatoutput.
- **Scripts, der sammenligner miljøer, udskriver variabelnavne og match/mismatch — aldrig værdier.**
- ⚠️ **Railway bygger med Railpack, ikke Nixpacks.** `nixpacks.toml` ligger stadig i repoet, men bliver **ikke læst** — den er død konfiguration, der modsiger virkeligheden (**D38**). Brug build-loggen som facit for, hvordan der bygges og startes; aldrig den fil.

## Database & migrationer

- Skemaændringer sker **KUN** som versionerede filer i `supabase/migrations/`. Aldrig håndredigeret SQL mod prod.
- De ENESTE veje til `supabase db push` er `push-staging.ps1` og `push-prod.ps1` (CLI-linket er usynlig tilstand — rå `db push` kan ramme det forkerte projekt).
- Rækkefølge altid: migration på staging → røgtest → samme migration på prod.
- **Levende tabeller (fx `leads`) ændres med expand/contract:** tilføj nyt (nullable) → backfill → skriv begge → flyt læsning → drop gammelt i en SENERE release. Omdøb/drop aldrig en kolonne i samme deploy som koden ændres.
- Antag aldrig at `create table if not exists` har sat alle kolonner — tjek om tabellen findes i forvejen (messages-fælden).
- Nye tabeller får **RLS slået til fra første migration**. Ingen tabel uden en bevidst policy-beslutning (evt. "RLS til, ingen policies" = kun service role, som `onboarding_sidevisninger`).
- **Kan migrationen rulles tilbage?** Er svaret nej, skal det stå eksplicit i migrationsfilens kommentar.

## Sikkerhed

- RLS er hele tenant-isolationen. Backend-kald med service role omgår RLS → **hvert endpoint, der modtager et id fra klienten, skal selv verificere ejerskab** via tokenets firm-kobling (IDOR). `firm_id` udledes af Bearer-token, aldrig af request-body.
- Nye tabeller med brugerdata: SELECT-policy via `firm_users`-opslag; skrivning helst kun server-side (mønster: `messages`).
- Modtager-numre, beløb o.l. udledes server-side, ikke fra klienten (mønster: `/send-sms`).
- **Ingen persondata i logs.** Telefonnumre, adresser, navne, e-mails, lead-indhold og transskriptioner maskeres før udskrivning — også i fejlbeskeder til AppSignal. Hjælperne bor i `phone.js` (`maskerTlf`, `maskerMail`) og skal deles, ikke kopieres.
- **Ingen ny dublet.** Skal en værdi bruges et nyt sted, hentes den fra sin kilde. Kan den ikke hentes, skal der findes et afstemningsscript, der opdager drift. Kopier uden afstemning er forbudt.
- **En ny afhængighed er en ny angrebsflade.** Før du foreslår en pakke: kan opgaven løses med det, der allerede er trukket ind? Og ryd op efter et skifte — `nodemailer` lå ubrugt i `dependencies` i månedsvis efter overgangen til Scaleway TEM (fundet 27/8).

## Forbudte handlinger (kræver altid eksplicit OK fra Ann)

- `reset-test-data.js` mod prod: **ALDRIG. Under ingen omstændigheder.** Prod-oprydning er kirurgisk pr. eksplicit firm_id.
- Køb af Twilio-numre (`buy-numbers.js` uden `DRY_RUN=1`) — koster rigtige penge og kræver korrekt `VOICE_URL`.
- Enhver skrivning mod prod-Supabase eller deploy til `main`.
- Sletning af rækker i `phone_numbers` (frigørelse = `firm_id = null`, aldrig delete uden plan for Twilio-siden).
- Systemnummeret (`TWILIO_SYSTEM_NUMBER`) må aldrig i nummerpuljen.
- **Læsning af `.env*`, `config.php` og andre hemmelighedsfiler.** Har du brug for en variabels værdi: spørg Ann.
- **`railway variables`, `supabase secrets`, `gh secret` og lignende** — de omgår ovenstående ad bagvejen.
- **Enhver adgang til `C:\Users\Bruger\sms-backend` fra en Cowork-session — læsning såvel som skrivning.** Sessionen har adgang til `claude-arbejdstrae` og kun den. Skal du se en fil fra repoet, så bed Ann lægge den i arbejdstræet (`sync-docs.ps1 -Hent`) frem for at bede om adgang eller om at få indholdet indsat. Foreslå ændringer; Ann udfører dem. **Spærringen er bevidst: den er grunden til, at et forkert forslag ikke kan blive til en forkert commit — og at ingen session kan komme til at læse `.env` ad omveje.**

## "Færdig"-tjekliste — gennemgås før hver commit

- [ ] **Test på det, der kan gå galt.** Ikke dækning — den ene vej hvor fejlen er dyr
- [ ] **RLS på nye tabeller**, verificeret med `pg_policies`, ikke antaget
- [ ] **Kvote og budgetloft**, hvis funktionen koster penge pr. brug
- [ ] **Ingen persondata i logs**
- [ ] **Ingen ny dublet** — hentes værdien, eller findes der en afstemning?
- [ ] **Rollback-vejen kendt**, inklusive om migrationen kan rulles tilbage
- [ ] **Fem linjers begrundelse i repoet**: hvad valgte jeg, hvad var alternativet, hvorfor
- [ ] **Stopkriteriet var skrevet ned før start** — og det blev overholdt

## Seks-linse-tjek — beslutninger og kode

Ved en beslutning i `RISIKOREGISTER.md` eller et primer-dokument: gå de seks linser igennem. Kort svar er nok — et blankt svar er selv en advarsel.

- [ ] **Driftbarhed** — kan det driftes med den bemanding, der er i dag? Hvad sker der, når det fejler?
- [ ] **Arkitektur** — genbruger det et mønster, der allerede findes, eller skaber det en ny særting?
- [ ] **Kodekvalitet** — kan det testes og læses af en anden bagefter, uden tavs viden?
- [ ] **Sikkerhed** — hvilken ny angrebsflade eller nyt datafelt følger med, og hvem må se det?
- [ ] **Økonomi** — hvad koster det, engangs og løbende?
- [ ] **Forretning** — kan det forklares og sælges til en kunde i én sætning, og hvem betaler?

Ved kode eller design, der rent faktisk skal bygges/deployes, er en statisk liste ikke nok — spørg Ann om en aktiv seks-linse-gennemgang (én uafhængig vurdering pr. linse). Økonomi og forretning kan kun struktureres her, ikke afgøres — den dom hviler på Anns tal og markedsviden.

## Tilbudsmodulet — invarianter

Gælder al kode i modulet. Er én af dem ikke opfyldt, er opgaven ikke færdig.
(Uddybning i `docs/tilbud-primer.md`, som er autoritativ for HVAD og HVORFOR.)

- **Prompten konstrueres server-side.** Klienten sender intention + data, aldrig rå prompt.
- **Kvotetjek før ethvert betalt kald.** Ingen AI- eller transskriptionskald uden forudgående tjek mod firmaets forbrug.
- **Modeloutput bliver aldrig til et tal uden menneskelig bekræftelse.** Håndværkeren godkender hver pris, hver gang.
- **Ændringer på tilbud er append-only.** Et afsendt tilbud redigeres ikke — det erstattes af en ny version.
- **Modelstrengen låses eksplicit.** Ingen implicit "seneste model".
- **Lyd persisteres ikke.** Transskription opbevares efter besluttet frist, aldrig længere.
- **Tredjeparter informeres før optagelse** — tvungen skærm i produktet, ikke en linje i vilkårene.
- ⚠️ **`tilbud/`-mappen serveres offentligt** (`server.js:108`). Kun det, browseren skal bruge, må ligge der — HTML, CSS, klient-JS, ikoner. Prompter, priser, modelkonfiguration og kvotelogik bor uden for. Reglen står i `tilbud/README.md`, hvor fejlen ville blive begået (**S17**).

## Deploy & frontend

- Deploy = merge til `staging` (Railway auto-deployer) → røgtest → PR til `main`. Små, reversible deploys; adskil deploy fra release (feature flags frem for big bang).
- **Bump service worker-cacheversionen i `sw.js` ved ENHVER frontend-ændring.**
- Frontend-JS skrives defensivt: al DOM-udfyldning gennem `setText`-mønsteret (manglende element må aldrig kaste), permission-API'er (Notification, mikrofon m.fl.) altid feature-detected + i try/catch, nye blokke selvstændige så de ikke kan vælte dashboardet (mønster: app-hilsen).
- QA-regel efter ethvert redesign: fuldt id-tjek (`getElementById` ↔ `id=`). Husk: localhost-demoen skjuler init-fejlklassen — test med rigtigt login på staging.
- iPhone-PWA'en deler ikke lagring med Safari, og standalone-mode har egne fælder — mobilfeatures røgtestes i den **installerede** app på ægte iPhone, ikke kun i Safari.
- **"Deployet virker" og "min ændring er med i deployet" er to forskellige påstande.** Kun den anden kan bevises af et tjek, der ville fejle, hvis ændringen manglede — brug en fejlkode eller et svar, der IKKE fandtes før (lærdom 16/8).

## Kodeleverancer

- **Komplette, kørbare filer — aldrig diffs eller udsnit** når en fil ændres uden for Claude Codes egne edits. ⚠️ Undtagelse: har Ann selv ændret filen, siden du sidst så den, må du ikke levere en komplet fil bygget på din gamle udgave — så ville du rulle hendes arbejde tilbage i stilhed. Bed om den aktuelle fil, eller lever ændringen som en præcis instruktion.
- Konkrete, holdningsstærke anbefalinger + proaktiv risiko-flagging. Forklar *hvorfor* før *hvordan* ved arkitekturvalg.
- Fejlhåndtering: fail-closed på miljø/sikkerhed, fail-open (ikke-fatalt) på analyse/logning — analyse må aldrig genere kunden.
- Går noget galt undervejs — forkert miljø ramt, hemmelighed eksponeret, utilsigtet skrivning: **sig det med det samme**, og noter det i `docs/HAENDELSESLOG.md`.

## Referencedokumenter (i docs/)

- `ditdigitalekontor-primer.md` — arkitektur, endpoints, tabeller, historik og lærte faldgruber.
- `ditdigitalekontor-drift-runbook.md` — driftsopskrifter, release-regler, udestående-listen (autoritativ).
- `RISIKOREGISTER.md` — kendte risici, principper, plan og kapacitet (autoritativ for prioritering). Se "Ved sessionsstart" for hvor filen bor, og for "Redigeres nu"-reglen.
- `HAENDELSESLOG.md` — append-only log over sikkerhedshændelser. Rettes aldrig, kun tilføjes.
- `tilbud-primer.md` — arkitekturbeslutninger for tilbudsmodulet (autoritativ for HVAD/HVORFOR).
- `tilbud-runbook.md` — opgaverækkefølge for tilbudsmodulet (autoritativ for rækkefølge).
- Er der konflikt mellem denne fil og dokumenterne: spørg Ann frem for at gætte.
