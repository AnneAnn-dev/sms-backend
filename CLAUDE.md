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

## Miljøer — de vigtigste regler i hele filen

- **Den lokale `.env` peger på STAGING.** Det er normaltilstanden.
- `.env` redigeres ALDRIG direkte. Ret masterfilerne (`.env.staging` / `.env.prod`) og kør `skift-staging.ps1` / `skift-prod.ps1`.
- **Findes filen `.ENV-ER-PROD` i repo-roden, peger miljøet på PROD → STOP.** Kør ingen scripts, foreslå ingen kørsler, før Ann eksplicit har bekræftet eller skiftet tilbage med `skift-staging.ps1`.
- Efter enhver miljø-/env-ændring: verificér med `node check-env.js --live` (staging) eller `node check-env-prod.js --live` (prod). Rød = stop.
- Prod-hemmeligheder bor i Bitwarden + Railway. De må aldrig ende i git, logs eller chatoutput.

## Database & migrationer

- Skemaændringer sker **KUN** som versionerede filer i `supabase/migrations/`. Aldrig håndredigeret SQL mod prod.
- De ENESTE veje til `supabase db push` er `push-staging.ps1` og `push-prod.ps1` (CLI-linket er usynlig tilstand — rå `db push` kan ramme det forkerte projekt).
- Rækkefølge altid: migration på staging → røgtest → samme migration på prod.
- **Levende tabeller (fx `leads`) ændres med expand/contract:** tilføj nyt (nullable) → backfill → skriv begge → flyt læsning → drop gammelt i en SENERE release. Omdøb/drop aldrig en kolonne i samme deploy som koden ændres.
- Antag aldrig at `create table if not exists` har sat alle kolonner — tjek om tabellen findes i forvejen (messages-fælden).
- Nye tabeller får **RLS slået til fra første migration**. Ingen tabel uden en bevidst policy-beslutning (evt. "RLS til, ingen policies" = kun service role, som `onboarding_sidevisninger`).

## Sikkerhed

- RLS er hele tenant-isolationen. Backend-kald med service role omgår RLS → **hvert endpoint, der modtager et id fra klienten, skal selv verificere ejerskab** via tokenets firm-kobling (IDOR). `firm_id` udledes af Bearer-token, aldrig af request-body.
- Nye tabeller med brugerdata: SELECT-policy via `firm_users`-opslag; skrivning helst kun server-side (mønster: `messages`).
- Modtager-numre, beløb o.l. udledes server-side, ikke fra klienten (mønster: `/send-sms`).

## Forbudte handlinger (kræver altid eksplicit OK fra Ann)

- `reset-test-data.js` mod prod: **ALDRIG. Under ingen omstændigheder.** Prod-oprydning er kirurgisk pr. eksplicit firm_id.
- Køb af Twilio-numre (`buy-numbers.js` uden `DRY_RUN=1`) — koster rigtige penge og kræver korrekt `VOICE_URL`.
- Enhver skrivning mod prod-Supabase eller deploy til `main`.
- Sletning af rækker i `phone_numbers` (frigørelse = `firm_id = null`, aldrig delete uden plan for Twilio-siden).
- Systemnummeret (`TWILIO_SYSTEM_NUMBER`) må aldrig i nummerpuljen.

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

## Referencedokumenter

- ## Referencedokumenter (i docs/)

- `ditdigitalekontor-primer.md` — arkitektur, endpoints, tabeller, historik og lærte faldgruber.
- `ditdigitalekontor-drift-runbook.md` — driftsopskrifter, release-regler, udestående-listen (autoritativ).
- `tilbud-primer.md` — arkitekturbeslutninger for tilbudsmodulet (autoritativ for HVAD/HVORFOR).
- `tilbud-runbook.md` — opgaverækkefølge for tilbudsmodulet (autoritativ for rækkefølge).
- Er der konflikt mellem denne fil og dokumenterne: spørg Ann frem for at gætte.
