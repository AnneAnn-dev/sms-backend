# CLAUDE.md — sms-backend (Dit Digitale Kontor)

Al kommunikation og alle kommentarer/tekster er på **dansk**.

## Hvad projektet er

B2B SaaS til danske håndværkere: ubesvarede opkald → Twilio `/opkald`-webhook → SMS med maskeret formularlink → lead i dashboardet. Multi-tenant (firms / firm_users / leads / calls / phone_numbers), Supabase Auth + RLS, Frisbii/MobilePay-billing, Scaleway TEM-mail, ElevenLabs TTS. Frontend er en PWA (dashboard.html + onboarding.html), serveret af samme Express-app.

## Stack & konventioner

- Node.js / Express 5, **CommonJS — ingen ESM**. Flad filstruktur.
- Windows / PowerShell 5.1 / VS Code. Scripts køres lokalt, ikke på Railway.
- **`.ps1`-filer skal være REN ASCII** (PS 5.1 fejllæser UTF-8 uden BOM). Ingen æøå, ingen emoji i .ps1.
- Git: `main` (PR-beskyttet, = prod) · `staging` · feature-branches. Arbejd altid på en branch, aldrig direkte på main.
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
- **Ingen persondata i logs.** Telefonnumre, adresser, navne, e-mails, lead-indhold og transskriptioner maskeres før udskrivning — også i fejlbeskeder til AppSignal.
- **Ingen ny dublet.** Skal en værdi bruges et nyt sted, hentes den fra sin kilde. Kan den ikke hentes, skal der findes et afstemningsscript, der opdager drift. Kopier uden afstemning er forbudt.

## Forbudte handlinger (kræver altid eksplicit OK fra Ann)

- `reset-test-data.js` mod prod: **ALDRIG. Under ingen omstændigheder.** Prod-oprydning er kirurgisk pr. eksplicit firm_id.
- Køb af Twilio-numre (`buy-numbers.js` uden `DRY_RUN=1`) — koster rigtige penge og kræver korrekt `VOICE_URL`.
- Enhver skrivning mod prod-Supabase eller deploy til `main`.
- Sletning af rækker i `phone_numbers` (frigørelse = `firm_id = null`, aldrig delete uden plan for Twilio-siden).
- Systemnummeret (`TWILIO_SYSTEM_NUMBER`) må aldrig i nummerpuljen.
- **Læsning af `.env*`, `config.php` og andre hemmelighedsfiler.** Har du brug for en variabels værdi: spørg Ann.
- **`railway variables`, `supabase secrets`, `gh secret` og lignende** — de omgår ovenstående ad bagvejen.

## "Færdig"-tjekliste — gennemgås før hver commit

- [ ] **Test på det, der kan gå galt.** Ikke dækning — den ene vej hvor fejlen er dyr
- [ ] **RLS på nye tabeller**, verificeret med `pg_policies`, ikke antaget
- [ ] **Kvote og budgetloft**, hvis funktionen koster penge pr. brug
- [ ] **Ingen persondata i logs**
- [ ] **Ingen ny dublet** — hentes værdien, eller findes der en afstemning?
- [ ] **Rollback-vejen kendt**, inklusive om migrationen kan rulles tilbage
- [ ] **Fem linjers begrundelse i repoet**: hvad valgte jeg, hvad var alternativet, hvorfor
- [ ] **Stopkriteriet var skrevet ned før start** — og det blev overholdt

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

## Deploy & frontend

- Deploy = merge til `staging` (Railway auto-deployer) → røgtest → PR til `main`. Små, reversible deploys; adskil deploy fra release (feature flags frem for big bang).
- **Bump service worker-cacheversionen i `sw.js` ved ENHVER frontend-ændring.**
- Frontend-JS skrives defensivt: al DOM-udfyldning gennem `setText`-mønsteret (manglende element må aldrig kaste), permission-API'er (Notification, mikrofon m.fl.) altid feature-detected + i try/catch, nye blokke selvstændige så de ikke kan vælte dashboardet (mønster: app-hilsen).
- QA-regel efter ethvert redesign: fuldt id-tjek (`getElementById` ↔ `id=`). Husk: localhost-demoen skjuler init-fejlklassen — test med rigtigt login på staging.
- iPhone-PWA'en deler ikke lagring med Safari, og standalone-mode har egne fælder — mobilfeatures røgtestes i den **installerede** app på ægte iPhone, ikke kun i Safari.

## Kodeleverancer

- **Komplette, kørbare filer — aldrig diffs eller udsnit** når en fil ændres uden for Claude Codes egne edits.
- Konkrete, holdningsstærke anbefalinger + proaktiv risiko-flagging. Forklar *hvorfor* før *hvordan* ved arkitekturvalg.
- Fejlhåndtering: fail-closed på miljø/sikkerhed, fail-open (ikke-fatalt) på analyse/logning — analyse må aldrig genere kunden.
- Går noget galt undervejs — forkert miljø ramt, hemmelighed eksponeret, utilsigtet skrivning: **sig det med det samme**, og noter det i `docs/HAENDELSESLOG.md`.

## Referencedokumenter (i docs/)

- `ditdigitalekontor-primer.md` — arkitektur, endpoints, tabeller, historik og lærte faldgruber.
- `ditdigitalekontor-drift-runbook.md` — driftsopskrifter, release-regler, udestående-listen (autoritativ).
- `RISIKOREGISTER.md` — kendte risici, principper, plan og kapacitet (autoritativ for prioritering).
- `HAENDELSESLOG.md` — append-only log over sikkerhedshændelser. Rettes aldrig, kun tilføjes.
- `tilbud-primer.md` — arkitekturbeslutninger for tilbudsmodulet (autoritativ for HVAD/HVORFOR).
- `tilbud-runbook.md` — opgaverækkefølge for tilbudsmodulet (autoritativ for rækkefølge).
- Er der konflikt mellem denne fil og dokumenterne: spørg Ann frem for at gætte.
