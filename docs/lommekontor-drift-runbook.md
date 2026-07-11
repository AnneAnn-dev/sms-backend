# LommeKontor — runbook: drift & udvikling

*Opsætning og opskrift for et team på højst tre personer. Princippet: **én kodebase, to verdener.** Alt kan testes i staging. Kun det, der er testet, slipper gennem "muren" til kunderne.*

De tre steder hvor noget kan gå i stykker — og som derfor skal være adskilt mellem staging og prod:

1. **Kode** — Railway-appen
2. **Database/skema** — Supabase
3. **Eksterne tjenester** — Twilio, Frisbii, Scaleway, ElevenLabs

---

## Master-rækkefølge — sådan hænger det sammen

*Overvågnings-/Frisbii-rækkefølgen og denne runbooks Del 0 er ikke to projekter — de overlapper. "Trin 0" (AppSignal + uptime) **er** Del 0, punkt F. Princip: **fundament før features** — Frisbii bygges og testes i staging, og hvis migrationerne er på plads først, bliver Frisbiis skemaændringer (webhook_events-tabel, billing-felter) rene migrationsfiler fra start i stedet for noget, der retrofittes.*

**Fundament (Del 0 — gør først):**
1. Git: `main` + `staging` *(Del 0.A)*
2. Railway: staging-miljø + egne env-vars *(Del 0.B)*
3. Supabase: staging-projekt + versionerede migrationer — vigtigst, og **før** Frisbii *(Del 0.C)*
4. Eksterne tjenester i test-mode, især Frisbii sandbox *(Del 0.D)*
5. AppSignal (fejl) + uptime på `/health`, på staging og prod — **din "trin 0"** *(Del 0.F)*

**Byg ovenpå fundamentet:**
6. Frisbii-livscyklus — bygget og testet i staging, med migrationer + sandbox *(din trin 1)*
7. Drifts-/funnel-overvågning *(din trin 2)*

**Lige før go-live:**
8. **Opgradér Supabase til Pro + slå PITR til** *(Del 0.E — gendannelses-øvelsen er ✅ bestået 3/7-26; tilbage står selve plan-opgraderingen, som trygt kan vente hertil, fordi den kun beskytter ægte kundedata. Indtil da: manuel pg_dump-rutine er eneste backup — Free-planen tager ingen automatiske!)*

**Efter launch:**
9. Brugs-/engagement-analytics *(din trin 3)*

Du er ikke blokeret af at lave *hele* runbooken først: punkt 1-5 skal være på plads før Frisbii (punkt 6), og punkt 8 kan vente til lige før du tænder for rigtige kunder.

---

## Del 0 — Engangsopsætning

Gør hvert punkt én gang. Når det står, er resten daglig rutine.

### A. Git-branches
- `main` = production. Er altid deploybar.
- `staging` = staging. Alt mødes her før prod.
- Feature-arbejde på korte branches: `feat/...`, `fix/...` → merges ind i `staging`.

### B. Railway — to miljøer i ét projekt
1. I Railway: **New Environment → Duplicate Environment** (det tidligere "Fork" er udfaset), navngiv det `staging`.
2. Sæt `staging`-miljøet til **auto-deploy fra `staging`-branchen** (Service → Settings → Source); lad `production` deploye fra `main`.
3. Giv hvert miljø **sine egne env-vars**. Det er her separationen bliver ægte:
   - `BASE_URL` (staging-URL i staging — aldrig en ngrok-tunnel, aldrig trailing slash)
   - Supabase URL + nøgler (peg på **staging-projektet**, se C)
   - Twilio-, Frisbii-, Scaleway-creds (**test-creds i staging**, se D)
   - ⚠️ **Kritisk fælde:** Duplicate kopierer prod's env-vars **ordret** → staging peger på **prod-Supabase**, indtil du manuelt skifter Supabase-variablerne til staging-projektet. Railways "frisk DB pr. miljø" gælder ikke os, fordi DB'en er ekstern Supabase. **Staging er ikke ægte, før Supabase-varene er skiftet.**
4. ⏸️ **UDSKUDT (besluttet 2/7-26):** Restrikt `production`-miljøet (RBAC): partner kan trigge deploys, men ikke se/redigere prod-secrets. Kræver Railway team-plan-features — ikke launch-blokerende med to personer, der begge er founders. **Tag den op igen:** senest når tredje person får adgang (jf. Roller), eller hvis I opgraderer Railway-planen af anden grund.
   ⏸️ **UDSKUDT (besluttet 3/7-26):** Migration fra Supabases legacy JWT-nøgler (`anon` + `service_role`) til de nye nøgletyper (Publishable/Secret keys). Koden bruger legacy-nøglerne i dag — begge miljøer er sat op med dem, og de virker. **Tag den op igen:** når Supabase varsler en deadline for udfasning af legacy-nøglerne, eller ved næste større refaktorering af Supabase-klient-koden. Migrationen omfatter: nye nøgler i begge Railway-miljøer + evt. kodeændringer i supabase-js-initialiseringen.
5. Find **rollback-knappen** i Railway nu, så du ved hvor den er, før du får brug for den.

### C. Supabase — staging-projekt + versionerede migrationer
Dette er det vigtigste skifte. **Stop med at køre SQL i hånden i dashboard-editoren mod prod.**

1. Opret et **separat Supabase-projekt** til staging (samme region som prod: **eu-west-1, West EU Irland** — verificeret i dashboardet 3/7-26; tidligere stod her fejlagtigt Frankfurt). Total isolation — testfirmaer rører aldrig prod. ✅ *Oprettet: `ditdigitalekontor-staging`.*
2. Indfør CLI-migrationer (Windows/PowerShell). ⚠️ **Docker-forbehold:** `supabase db pull` (og `db dump`) kræver Docker. **Docker-fri vej (den vi brugte):** dump prod-skemaet med `pg_dump`, opret en tom migration med `npx supabase migration new baseline`, kopiér skemaet ind i den, og markér den som allerede kørt i begge projekter med `npx supabase migration repair --status applied <timestamp>`. Commit filen. Det er jeres nul-punkt. ✅ *Baseline etableret 3/7-26.*
   ✅ **`.env`-parse-fejlen LØST 5/7-26:** synderen var en linje med variabelnavn uden `=` (`SCW_REGION`-torso fra en tidligere redigering — Go-parseren i Supabase CLI nægter, Node's dotenv ignorerer). Omdøbnings-dansen er pensioneret.
   ⚠️ **LINK-FÆLDEN (bidt 6/7-26):** Supabase CLI'en læser HVERKEN `.env` eller Railway — dens mål er usynlig tilstand i `supabase\.temp\project-ref` fra sidste `supabase link`. Et `db push` rammer lydløst det linkede projekt, uanset hvad du tror. (Bed-eksempel: migration nr. 2 landede i PROD, fordi linket aldrig var skiftet efter baseline-arbejdet — harmløst dén dag, additive nullable kolonner, men mønstret er farligt ved destruktive migrationer.) **Værn:** brug `.\push-staging.ps1` (nægter at pushe, hvis linket ≠ staging) til dagligt arbejde og `.\push-prod.ps1` (kræver at man skriver PROD, linker selv, og skifter ALTID tilbage til staging bagefter) til releases. **CLI'ens faste hviletilstand er staging.** Manuel kontrol: `Get-Content supabase\.temp\project-ref` før enhver push.
   ⚠️ **TOM-FIL-FÆLDEN:** `db push` "applier" gladeligt en tom/ugemt migrationsfil, melder Finished og bogfører den som kørt — kolonnerne opstår aldrig, og et nyt push gør intet. **Verificér ALTID med kolonne-forespørgsel i SQL-editoren efter push** (og tjek projekt-ref i browserens URL — to identiske dashboards!). Fortryd en fejl-bogført migration: `npx supabase migration repair --status reverted <timestamp>` → ret filen → push igen.
   📌 **Lokal `.env`-arkitektur (besluttet 5/7-26):** Den lokale `.env` peger på **STAGING** (Supabase, Twilio-subkonto, Frisbii-testkonto, staging-BASE_URL) + `MAIL_OVERRIDE_TO` sat — lokale scripts kan dermed ikke ramme prod eller maile kunder ved et uheld. **Prod-værdier bor KUN i Bitwarden + Railway**; skal et script undtagelsesvis køre mod prod, sættes vars eksplicit i PowerShell-sessionen (`$env:...`) for den ene kørsel — friktionen er en feature. **Verifikation efter enhver `.env`-redigering:** `node check-env.js --live` — dømmer alle nøgler statisk (JWT role/ref, formater) OG spørger Supabase/Twilio/Frisbii "hvem er du?" (friendly name/handle skal svare staging). Fangede en Twilio-401 i første kørsel.
3. Fra nu af: **hver skemaændring = en ny migrationsfil.**
   ```powershell
   npx supabase migration new tilfoej_kolonne_xyz
   # skriv din ALTER/CREATE i filen
   ```
   Kør den på staging først, så prod (se Del 1). `messages-patch.sql`-mønsteret bliver nu bare en almindelig migration — og `if not exists`-fælden forsvinder, fordi historikken styres af migrationsrækkefølgen.
4. (Senere, valgfrit) Supabase **branching** kan give en DB-preview pr. pull request. Lad det ligge til I har behov; det persistente staging-projekt er arbejdshesten.

### D. Eksterne tjenester i test-tilstand
Mekanismen er env-vars pr. miljø. Staging må aldrig kunne ramme en kunde:

⚠️ **Placeholder-lærdom (3/7-26):** Appen crasher ved boot, hvis env-vars er *formugyldige* — Twilio-SDK'en validerer allerede i konstruktøren (`onboarding.js` linje ~24), at SID'en starter med `AC`. Rå placeholders som `SKIFT-MIG` giver derfor boot-crash før `/health` findes. **Mønster: formgyldig men funktionsdød dummy** — `TWILIO_ACCOUNT_SID=AC00000000000000000000000000000000` (AC + 32 nuller) består konstruktør-tjekket, men fejler højlydt på ethvert reelt API-kald (og fejlen lander i AppSignal under `staging`). Fail-fast ved boot er en *feature* i prod — men i staging med bevidst døde creds skal dummies være formgyldige. Frisbii/Scaleway/Supabase-SDK'erne initialiserer dovent og tåler rå placeholders.

- **Twilio:** separat **test-nummer** (gerne en egen subkonto). Testopkald i staging → staging-DB, ikke ægte leads i prod. ✅ *Subkonto + dansk testnummer oprettet 3/7-26, voice-webhook → staging-URL/opkald (HTTP POST). Fuld kæde røgtestet samme dag: opkald → webhook → firma-opslag → greeting → lead → SMS modtaget. Verificeret: rækker i staging-`calls`/`leads`, NUL rækker i prod — muren holder. Subkonto-balance $0.00 er uskadelig: forbrug ruller op i moderkontoens fakturering.*
  🔑 **Lærdomme fra opsætningen (3/7-26):**
  1. **Opkaldsrutningen læser `firms.phone_number` — IKKE `phone_numbers`-tabellen.** `/opkald` (onboarding.js ~linje 198) slår firma op via den denormaliserede kolonne på firma-rækken; pool-tabellen bruges kun til provisionering/frigivelse. Skal et testnummer rute til et firma, skal **begge** opdateres (konsistens): `firms.phone_number` (afgør rutning) + `phone_numbers` (pool-bogholderi). Den rigtige vej til testdata er dog `provision-test-firm.js` mod staging — den sætter alt korrekt fra start.
  2. **Twilio-konsollens region-vælger er en fælde:** nummer-konfiguration findes PR. REGION, og webhooks skal gemmes i den **aktive** region (**US1** for vores numre — IE1 står Inactive). En webhook gemt i IE1 bruges aldrig; symptom: opkald i Call Log med status "No Answer"/0 sek og total tavshed i Railway.
  3. **Voice og Messaging er separate konfigurationssektioner** på nummeret (venstremenu: "Voice and emergency calling" vs. "Messaging"). `/opkald`-webhooken hører til Voice. Spejl prods opsætning i begge — men med staging-URL!
  4. **Twilios Call Log-detaljer (Request Inspector) er fejlsøgnings-facit:** klik på et opkald → se præcis hvilken URL Twilio kaldte, metode og svarkode. Bemærk også default-filteret "Direction: Outbound" i Call Logs — indgående opkald er skjult, til det fjernes.
  5. **Kopieret prod-data kan kryds-referere prod:** det kopierede firmas `greeting_audio_url` peger på prods offentlige Storage-URL — virker, men er en artefakt. Ved ægte staging-testfirmaer (provision-scriptet) renderes greeting til stagings egen bucket.
  📌 **Kendt afvigelse fra EU-princippet (konstateret 3/7-26): Twilio voice-trafik behandles i US1 — i BÅDE prod og staging.** Twilios Irland-region (IE1) står "Inactive" på numrene; al voice-behandling (og dermed opkaldsmetadata, evt. optagelser/lyd i transit) går via USA. Det bryder med stakkens ellers konsekvente EU-datasuverænitet (Railway EU West, Supabase Irland, Scaleway, AppSignal Amsterdam). **Ikke akut med testdata, men skal vurderes før/kort efter go-live med ægte kunder:** undersøg om IE1 kan aktiveres for jeres numre og hvad det kræver (webhook-URL'er, TwiML, evt. funktionsbegrænsninger i IE1 — ikke alle Twilio-features findes uden for US1). Behandles som ét samlet projekt for begge miljøer — staging først, som alt andet.
- **Frisbii:** kør i **test-/sandbox-tilstand** i staging, så et test-checkout aldrig trækker et rigtigt kort. ✅ *Færdig og røgtestet end-to-end 5/7-26: hosted checkout (testkort 4111...) → `invoice_settled` → staging-webhook (POST 200) → provisionering (firma + nummer claimet + auth-bruger) → `[STAGING -> ...]`-velkomstmail + pulje-alarm modtaget. Prod verificeret uberørt.*
  **Kontomapping** (autoritativ HER — handles er permanente, navne kan ændres; verificér ALTID via handle i browserens URL, ikke via visningsnavnet):
  | Handle | Navn (pr. 5/7-26) | Rolle |
  |---|---|---|
  | `test-2-lommekontor` | prod dit digitale kontor | **PROD** — test-nøgler indtil go-live (bevidst: live-nøgler koster penge, trækkes umiddelbart før launch). Webhook → KUN prod-URL. |
  | `lommekontor` | test dit digitale kontor | **STAGING** — egen API-nøgle, egen webhook-secret, webhook → KUN staging-URL, spejlet plan + dunning-plan. |
  | `oprettelse-og-abonnement` | (uændret) | **UBRUGT — må ikke tages i brug.** |
  🔑 **Lærdomme fra opsætningen (4-5/7-26):**
  1. **⚠️ Frisbii-UI'et opdaterer IKKE pålideligt ved kontoskift — tryk F5 efter HVERT skift.** Ellers vises den gamle kontos data under det nye kontonavn. Var årsag til både tilsyneladende "delte data" mellem konti og et test-checkout, der reelt skete i PROD-kontoen (→ prod provisionerede et testfirma, der måtte ryddes op: firms + firm_users + auth-bruger + phone_numbers-frigivelse + annullér abonnementet i Frisbii, så det ikke fornyer).
  2. **Hosted checkout arver konto → webhook → miljø.** Betalingssiden afgør, hvilket miljø der provisionerer. Brug ALTID en emailadresse du selv ejer i test-checkouts — hvis eventet ender i prod, sender prod en ÆGTE mail til adressen.
  3. **Webhooks kan stå DISABLED** (overset ved oprettelse, eller Frisbii deaktiverer selv efter gentagne fejlede leverancer). Symptom: events genereres fint i event-loggen med "Forsøg: -", men intet leveres — tavs Railway, urørt DB. Tjek status-togglen, ikke kun URL/events.
  4. **Frisbiis event-log kan GENUDSENDE events** (flueben → resend) — uvurderligt testværktøj: ét checkout kan afprøves mod webhooken igen og igen uden nye betalinger.
  5. **En plan kræver en dunning-plan** — "dunning plan not found" ved plan-oprettelse i tom konto betyder: opret dunning-planen først (spejl prods: samme handle, forsøg, interval). Dunning-indstillingerne skal genbesøges i byggetrin 6 (grace-periodens længde afstemmes med dem).
  6. **Frisbii retryer fejlede webhooks i op til 3 dage** (2-5-10-20-30 min, så hver time) — gamle fejlede forsøg kan banke på længe efter; prods idempotens-/alders-guard håndterer dem som no-ops (verificeret 5/7-26).
  7. **Kendt udestående — checkout-endpointet er en kontrolleret 500'er i BEGGE miljøer:** `FRISBII_PLAN_HANDLE` og `SIMPLY_BASE_URL` mangler i Railway (begge miljøer — de har aldrig været sat; `requireConfig()` i frisbii-checkout.js fejler pænt ved kald, ikke ved boot). **Go-live-blokerende for salg via partnersitet.** Fix: sæt begge vars i begge miljøer (prods plan-handle i prod, stagings i staging) + konfigurér accept_url/cancel_url, så kunden lander på onboarding i stedet for `GET /` (404) efter betaling.
  8. **Staging-puljens artefakt:** +4591309229 er en kopieret prod-data-artefakt — tallet refererer et nummer, der fysisk bor i Twilio-HOVEDKONTOEN og ikke kan rutes til staging. Fint til at bevise provisioneringskæden; til trin 6-arbejdet skal artefakt-rækken slettes og erstattes af et ægte subkonto-nummer i puljen.
  **Go-live-gate (føj til master-punkt 8):** Frisbii live-nøgler trækkes → live-nøgler i PROD; staging beholder sin testkonto uændret. + checkout-vars (lærdom 7) skal være sat og checkout-flowet røgtestet fra partnersitet.
- **Scaleway TEM:** i staging, **override modtager til din egen adresse**, så mails fra staging aldrig går til kunder. ✅ *Færdig og røgtestet 4/7-26.*
  **Beslutning: DELTE creds mellem prod og staging** (samme `SCW_SECRET_KEY`/`SCW_PROJECT_ID`/`SCW_REGION`/`SMTP_FROM`) — bevidst undtagelse fra dedikerede-creds-princippet. Ræsonnement: mail har ingen delt *tilstand* at beskytte (modsat Supabase/Twilio); den eneste fare er "staging mailer en rigtig modtager", og den håndhæves i kode af to lag. Separat setup ville kræve nyt Scaleway-projekt + domæneverifikation for ingen reel gevinst. **Miljøseparation er to principper: tilstand isoleres på KONTO-niveau, afsendelse kan isoleres i KODE.**
  **Murens to lag i `mail.js` (alt går gennem ét chokepunkt, `sendViaScaleway`):**
  1. **Override:** `MAIL_OVERRIDE_TO` sat + ikke-production → AL mail omdirigeres dertil, original modtager bevares i emnet (`[STAGING -> kunde@...]`). Sættes varen ved en fejl i PROD, ignoreres den og der råbes op i loggen.
  2. **Fail-closed (tilføjet 4/7-26):** ikke-production UDEN `MAIL_OVERRIDE_TO` → mail BLOKERES helt (`✋ Mail BLOKERET` i loggen) i stedet for at gå til rigtige modtagere. En glemt env-var må aldrig være hullet i muren.
  **Konfiguration:** `MAIL_OVERRIDE_TO` sættes KUN i staging — aldrig i prod (prod skal maile kunder normalt; koden tåler dog fejlen, jf. lag 1).
  **Kaldsteder logger sandfærdigt:** `sendWelcomeMail`/`sendAdminAlert` returnerer `{ blocked: true }` ved blokering, og alle tre velkomstmail-kaldsteder (onboarding.js, frisbii-webhook.js, onboarding-link.js) tjekker resultatet før succes-log — en log-linje må ikke påstå "sendt", når gaten blokerede.
  **Røgtestet begge veje 4/7-26** via `POST /onboarding/nyt-link` mod staging: med override → mail i egen indbakke med `[STAGING -> ...]`-emne; uden override → blokeret + to enige log-linjer. Bemærk endpointets cooldown (60 sek. pr. email/IP) ved gentagne tests — tavshed inden for cooldown er featuren, ikke en fejl.
- **ElevenLabs:** delt nøgle er fint (det er bare rendering) — hold øje med kvoten. ✅ *5/7-26: prod-værdierne genbrugt i staging — alle TRE vars: `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_IDM` + `ELEVENLABS_VOICE_IDF` (stemme-ID'er er kontouafhængige). Ingen mur nødvendig: pre-renderet lyd ved onboarding, ingen delt tilstand, ingen kunde-risiko. Røgtestes implicit ved næste provisionering med greeting-rendering — filen skal lande i STAGINGS `greetings`-bucket.*

**🏁 DEL 0.D FÆRDIG 5/7-26 — og dermed HELE DEL 0 (fundament-opsætningen):** Git ✓ · Railway to miljøer ✓ · Supabase staging + migrationer ✓ · Twilio subkonto ✓ · Frisbii testkonto pr. miljø ✓ · Scaleway mail-mur ✓ · ElevenLabs ✓ · Backup + gendannelses-øvelse ✓ · AppSignal ✓. Alle tre webhook-sømme (Twilio, Frisbii, Scaleway) er røgtestet end-to-end i staging med verificeret uberørt prod. Udskudte gates (dokumenteret med re-triggere): Pro/PITR + Frisbii live-nøgler + checkout-vars (master-punkt 8), RBAC + legacy-nøgle-migration (Del 0.B).

### E. Backup på prod

⚠️ **VIRKELIGHEDEN LIGE NU (Free-plan):** Supabase tager **INGEN automatiske backups** af projektet på Free-planen. Den manuelle pg_dump-rutine nedenfor er **den eneste backup, der findes** — den er ikke et supplement, den er strategien, indtil planen opgraderes. Kadence med testdata: frisk dump før hver større skemaændring.

**GO-LIVE-GATE (før første betalende kunde):** opgradér prod-organisationen til **Pro** (~25 USD/md) og slå **PITR** til. Fra det øjeblik findes der ægte kundedata, og beskyttelsen skal være automatisk — ikke afhængig af en manuel rutine.

- Pro-plan giver de seneste 7 dages daglige (fysiske) snapshots — de kan **ikke** downloades/inspiceres.
- Databasen er lille (<4 GB) → slå **PITR** til (sekund-granularitet). Bemærk: PITR kræver mindst et Small compute-add-on, og når PITR er slået til, tages der ikke længere daglige backups (PITR er finere).
- **Manuelt, portabelt snapshot du selv ejer** (beholder sin rolle som off-site-kopi, også efter Pro/PITR). Docker-fri vej med `pg_dump` (PostgreSQL-klientværktøjer installeret 3/7-26; `supabase db dump` kræver Docker):
  ```powershell
  $env:PGPASSWORD = 'databasepassword-fra-password-manager'   # enkelte anførselstegn!
  pg_dump "postgresql://postgres.<PROD_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --schema=public --schema-only -f schema.sql
  pg_dump "postgresql://postgres.<PROD_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --schema=public --data-only -f data.sql
  pg_dump "postgresql://postgres.<PROD_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --data-only --table=auth.users --table=auth.identities -f auth-users.sql
  ```
Til min hukommelse: $env:PGPASSWORD er den midlertidige PowerShell-variabel, som pg_dump automatisk læser passwordet fra — så det ikke skal stå i selve kommandoen. Det, du skal sætte ind mellem de enkelte anførselstegn, er prod-databasens Postgres-adgangskode — den, du resettede og gemte i din password manager tilbage ved gendannelses-øvelsen (3/7). Det er ikke en API-nøgle (eyJ...) og ikke dit Supabase-login — det er det "rå" databasepassword, som kun bruges til direkte Postgres-forbindelser som pg_dump.

Kan du ikke finde det i password manageren: reset det igen (Supabase prod-projektet → Database-ikonet → Configuration → Settings → Reset database password — generér langt, uden specialtegn, gem straks). Resettet er stadig ufarligt for den kørende app (den bruger API-nøglerne, ikke DB-passwordet) — det eneste, der skal opdateres bagefter, er... ingenting i Railway, men bemærk: push-prod.ps1 spørger også efter netop dét password ved prod-migrationer, så gem det et sted, du kan finde igen.

De tre huskeregler, når du sætter det: enkelte anførselstegn (dobbelte lader PowerShell fortolke $ og ` i passwordet), samme vindue som pg_dump-kommandoerne, og passwordet lander i PowerShell-historikken — kør evt. Clear-History bagefter for hygiejnen.


  ⚠️ **Forbindelses-lærdomme (3/7-26):** den direkte forbindelse (`db.<ref>.supabase.co:5432`) er IPv6-only og kan ikke nås fra vores netværk ("could not translate host name"). Brug **session-pooleren** (port 5432, bruger `postgres.<ref>`) — aldrig transaction-pooleren (port 6543, knækker pg_dump). Facit-connection-string: Connect-knappen i dashboardet → Session pooler. Dump-filerne (`schema.sql`, `data.sql`, `auth-users.sql`) må **ikke** committes til git.
- ⚠️ **To huller `pg_dump`-rutinen ikke dækker uden videre:** (1) **auth-brugere** (håndværkernes logins) ligger i `auth`-skemaet → dumpes separat (tredje kommando ovenfor); (2) **Storage** (greeting-lyd + lead-billeder) ligger slet ikke i Postgres → eksportér bucket'en for sig.
- **Gendannelses-øvelse:** ✅ **BESTÅET 3/7-26.** Prod gendannet til staging-projektet via pg_dump/psql over session-pooler, rækkefølge: skema → auth-brugere → data. Verificeret: identiske tabel-/kolonnelister + matchende rækketal på `firms`/`leads`/`calls` + `auth.users`. Støj undervejs: "permission denied to change default privileges" ved ALTER DEFAULT PRIVILEGES er harmløs (Supabase-projekter har dem sat fra fabrikken). **Bemærk:** øvelsen brugte prod→staging-kopi, hvilket var OK med testdata — **den dag der er ægte kunder, gendannes til et isoleret mål, ikke staging** (eller data anonymiseres).

### F. Overvågning (så I opdager fejl før kunden)
- Tilføj et simpelt **health-check-endpoint** (fx `GET /health` → 200).
- Sæt en gratis **uptime-monitor** til at pinge det og **alarmere til din telefon**.
- Log + alarmér på de tre sømme der fejler tavst: **Twilio-webhook · Frisbii-webhook · Scaleway-mail.**
- 📌 **TODO (fra byggetrin 6, 6/7-26): dead-letter-alarm på `frisbii_webhook_events`.** Tabellen bogfører nu udfald (`processed_at`/`error`); et event med `processed_at IS NULL` ældre end ~1 time er et tabt/fejlet event, der venter på Frisbii-retry — eller er løbet tør for retries (3 dage). Cron/dagligt tjek: `select id, event_type, received_at, error from frisbii_webhook_events where processed_at is null and received_at < now() - interval '1 hour';` → mail via `sendAdminAlert` hvis ikke tom. Byg sammen med drifts-overvågningen (trin 7).
- Evt. en daglig digest-mail: "X nye leads, Y fejlede SMS'er."

---

## Del 1 — Daglig udvikling (hver ændring)

1. `git checkout -b feat/min-aendring` (ud fra `staging`).
2. Lav kodeændringen. Er der en skemaændring? → **ny migrationsfil** (aldrig direkte SQL på en levende DB).
3. `git push` → staging-appen auto-deployer. Kør migrationen på **staging**:
   ```powershell
   .\push-staging.ps1   # verificerer linket FØR push — nægter hvis linket ≠ staging
   ```
4. **Røgtest på staging:** kør `provision-test-firm.js` mod staging, og lad en *bekendt* ringe til staging-nummeret. Tjek at lead lander, SMS sendes, mail kommer.
5. Merge til `staging` → (når grøn) PR/merge til `main`.
6. **Promote til prod — i deploy-vinduet** (se Del 2):
   - Railway: promote / deploy `main`.
   - Kør samme migration på **prod**: `.\push-prod.ps1` (kræver PROD-bekræftelse, linker selv om, og skifter tilbage til staging bagefter).
   - **Bump `sw.js` cache-version** — ellers serveres den gamle frontend.
7. Verificér i prod: health-check grøn + én ægte handling (fx et testopkald fra egen telefon). Hold øje i ~10 min.
8. Går det galt: **rollback koden** i Railway (hurtigst). DB: kør kun frem-migrationer; ingen destruktive ændringer uden frisk backup.

---

## Del 2 — Release-regler ("udviklingsstoppet")

- **Deploy-vindue:** deploy ikke til prod i håndværkernes arbejdstid — det er præcis dér de ubesvarede opkald kommer. Aften/weekend eller et defineret lavtrafik-vindue. **Hotfix er undtagelsen.**
- `main` er **altid** deploybar.
- **Aldrig** håndredigeret SQL på prod — kun migrationer.
- **Aldrig** live-creds i staging.
- `service_role`-nøglen kun server-side (den omgår RLS).

---

## Del 3 — Hvis det brænder (incident)

1. Kunde melder fejl → tjek **health-check**, **Railway-logs** og de **tre webhooks**.
2. **Rollback koden først** — det er det hurtigste tilbage til en kendt god tilstand.
3. DB-fejl (forkert data/migration) → vurder **PITR-gendannelse**. Husk: prod er **utilgængelig under restore**, og varigheden vokser med DB-størrelsen — meld evt. kort driftsstop.
4. Tjek Twilio- og Frisbii-status hvis opkald/betaling driller.

---

## Byg-trin 6 — Frisbii-livscyklus

*Frisbii Billing & Pay (Reepay-arven). Bygges + testes i staging mod sandbox, med skemaændringer som migrationer.*

**STATUS 10/7-26 (opdateret): Skridt A-D FÆRDIGE + TRIAL-PROVISIONERING bygget og røgtestet i staging (D-F bestået).** Prod-toget for trin 6-koden + migrationer 2+3 er kørt; staging- og prod-dataoprydning gennemført. Trial-startskuddet (`subscription_created` → trial-tjek via API → samme provisionFirm) virker end-to-end: dead-letter ved tom pulje → nummer tilføjet → gensend → provisioneret ✓ · no-op-værn ved gensend af behandlet abonnement ✓ · ikke-trial-gren ✓. **10/7 afslørede desuden en tværgående rodårsag:** de statiske sider (onboarding/dashboard) havde HARDCODET prod-Supabase-config → staging-magic-links blev afvist som "udløbet" af prod-projektet. Fix: `/config.js`-mønsteret (app-config.js) — se lærdomme nedenfor. **Tilbage: config-fixet deployes (opskrift i docs/), E (varslinger — produktbeslutning m. Anne, scope udvidet igen 10/7), F (evt. IP-lås, valgfri), prod-tog for trial+config-koden.** Se "Udeståender — samlet overblik" nederst.

✅ **A. Idempotens-skema** (migration `webhook_events_processed`): `processed_at` + `error` på `frisbii_webhook_events` — skelner "set" fra "behandlet".
✅ **B. Dead-letter-arkitektur:** claim er nu tre-tilstands (new/unprocessed/processed); events claimes FØR 200, bogføres efter udfald (markProcessed/markFailed). Et claimet-men-fejlet event genbehandles ved Frisbiis retry i stedet for at blive tabt. **Dead-letter-listen** = `select * from frisbii_webhook_events where processed_at is null;` — SKAL overvåges (cron-alarm: TODO i Del 0.F; behovet demonstreret 8/7 med to ægte dead-letters på ti minutter).
✅ **C. Cancelled ≠ expired + deprovisionering + karantæne:**
- `subscription_cancelled` → status `cancelled`, service/nummer BEHOLDES (retention-vindue!) · `subscription_uncancelled` → `active` · `subscription_expired`/`expired_dunning` → `expired` + **deprovisionering**, gated på timestamp-guarden (setBillingStatus returnerer nu applied-bool).
- **Deprovisionering:** firma inaktivt + `firms.phone_number` ryddes (rutning stopper; et genbrugt nummer må aldrig pege på to firmaer) + pool-rækken frigives — med **karantæne efter kundetype**: *prøvekunde (aldrig betalt) → frigives STRAKS; betalende kunde → 30 dages karantæne* (`QUARANTINE_DAYS_PAID`, env-var, default 30). Betalingshistorik dømmes af Frisbiis fakturaer (`hasEverPaid` via `/list/invoice?state=settled` — verificeret virkende 8/7); fail-safe mod LANG karantæne. `last_firm_id` gemmes til win-back-genforening. Migration `phone_number_quarantine`: `quarantined_until` + `last_firm_id` (bevidst uden FK).
- **Pool-udvælgelse** (webhook + onboarding.js Shopify-flow) og lav-pulje-tælling springer karantæne-numre over.
- **Testet 8/7 (sub-0003 + gensendte events):** cancel→cancelled ✓ · uncancel→active ✓ · expire→deprovisionering m. "betalt kunde: 30 dage" ✓ · idempotens afviser gensendte dubletter ✓ · karantæne-filter afviser ny provisionering ("Ingen ledige numre" som dead-letter m. fejltekst!) ✓ · **cirkel lukket:** karantæne ophævet → dead-letter gensendt → 🔁 genbehandlet → kunde provisioneret ✓.
- 📌 **Win-back-hjørne til senere:** i karensen svarer nummeret med "intet firma"-stilhed — en venlig TwiML-besked ("nummeret er ikke aktivt") ville være pænere for slutkunder. + retention-alarm til OS ved cancel (hører til E).
- 📌 **Skridt E's scope (udvidet 8/7 efter karantæne-testen):** (1) dunning-varsling til kunden (grace-periode), (2) retention-alarm til OS ved cancel, og — **vigtigst, fundet i test:** (3) **kundevendt besked når provisionering strander** ("Ingen ledige numre"-dead-letter): kunden HAR betalt og får i dag TAVSHED. Skal have en mail med det samme: "Tak for din bestilling — vi gør dit nummer klar og vender tilbage hurtigst muligt." Sendes fra provisioneringens fejlgren (kundens email kendes fra Frisbii-opslaget). Uden den er hvert pulje-tomt-tilfælde en supportsag eller en fortrydelse.
- ✅ **AFKLARET 8/7 (eksperiment i staging): en 0-kr-trial udløser IKKE `invoice_settled`** — kun customer_created/subscription_created m.fl. Konsekvens: **provisioneringen kører aldrig for trial-kunder** (intet firma, intet nummer, ingen velkomst/magic link — kunden får kun Frisbiis egen bekræftelsesmail og ellers TAVSHED; demonstreret end-to-end inkl. "ukendt email" ved nyt-link-forsøg). ✅ **LØST 10/7 (trial-provisionering, røgtestet D-F):** `subscription_created`-case i frisbii-webhook.js → henter abonnementet via API (korrekthedsregel 2) → `isTrialSubscription()` (`is_in_trial` / `trial_end` i fremtiden, fail-closed på feltlæsning, fail-loud/dead-letter på API-fejl) → trial: samme `provisionFirm`; ikke-trial: no-op-log (invoice_settled ejer stadig betalte planer). **Dobbelt-provisionerings-værn i to lag:** app-tjekket på `frisbii_subscription` + den **medfødte** unique-constraint `firms_frisbii_subscription_key` (kolonnen blev født `unique` i frisbii-webhook-migration.sql — separat migration viste sig overflødig og blev droppet). Race-taberen (23505 fra netop dén constraint) behandles som no-op/processed i stedet for dead-letter. Trial-kunder ER "prøvekunder" i karantæne-logikken → nummer frigives straks ved udløb uden betaling.
- ⚠️ **KENDT BEGRÆNSNING (fundet 8/7): dublet-emails knækker email-opslag.** Provisioneringen tillader samme email på flere firmaer (testdata beviste det: to firmaer med `ann@ditdigitalekontor.dk`), og `maybeSingle()`-opslag på email (fx nyt-link-endpointet) fejler så og svarer "ukendt email" — teknisk forkert, men sikkert (intet lækkes/sendes). **Kodeopgave:** `invoice_settled`-provisioneringen skal ved eksisterende email enten GENBRUGE firmaet/brugeren eller afvise med alarm — beslutning + implementering før go-live (en rigtig kunde med to abonnementer/gen-tilmelding rammer det ellers). Indtil da: pilot-drejebogens manuelle dublet-tjek før hver provisionering. *(NB 10/7: en formodet forekomst viste sig at være en tastefejls-email — rescue-flowet virkede korrekt. Opgaven består, men den blokerer ikke test-loopet.)*

🔑 **Lærdomme 10/7-26 (trial-dagen):**
- **⚠️ VIGTIGST — hardcodet frontend-config (rodårsagen til "udløbet link"):** `onboarding.html`/`dashboard.html` havde prod-Supabase-URL + anon-nøgle HARDCODET → alle statiske sider talte med PROD-projektet fra browseren, uanset serverende miljø. Staging-tokens blev afvist af prod som "udløbet" — usynligt indtil første ægte magic-link-login i staging (trial-arbejdet tvang stien frem). **Fix: `/config.js`-mønsteret** (`app-config.js`-rute: serveren udstiller `window.APP_CONFIG` fra SINE env-vars, fail-closed + `Cache-Control: no-store`; HTML læser derfra). **Princip: filer må ikke kende miljøer — kun miljøet ejer sine adresser.** Kræver ny env-var `SUPABASE_ANON_KEY` i BEGGE Railway-miljøer + lokale .env'er, FØR koden deployes (ellers 500 på /config.js). Sample-lyd-URL'er bygges nu også af `SUPABASE_URL` → staging-Storage skal have `greetings/_samples/*.mp3` uploadet (pg_dump-restore tager IKKE Storage med).
- **Migrations-hovedbogen:** `supabase\migrations` skal stemme 1:1 med `supabase_migrations.schema_migrations` i hver database. **En migrationsfil, der har været kørt mod nogen database, må ALDRIG omdøbes eller slettes** — manuel "oprydning" i mappen orphanede en anvendt migration og blokerede alle push ("Remote migration versions not found"). Reparation: gør reverten SAND først (drop det, migrationen skabte), dernæst `npx supabase migration repair --status reverted <version>`. Og arbejdsgangen er: opret fil → indsæt indhold → gem → push (ALDRIG push imellem — en tom fil bogføres også).
- **CLI-kaldeform:** `supabase` er devDependency (npm) → kaldes `npx supabase …`. `migration new` er ren fil-oprettelse med timestamp-navn — kan gøres manuelt i PowerShell.
- **Fallback-fjernelse i nummer-scripts:** `VOICE_URL` havde hardcodet prod-fallback → et staging-nummer ville i tavshed få prod-webhook. Nu krævet env-var (fail-closed). Samme princip som config-fixet.
- **Env-var-navnedrift:** lokal `.env` sagde `TWILIO_PHONE_NUMBER`, Railway/koden siger `TWILIO_SYSTEM_NUMBER` → scriptenes systemnummer-vagt kørte stumt slået fra. Omdøbt lokalt; overvej check-env.js-validering af nøglen.
- **`reset-test-data.js` opdateret** til trin 6-skemaet: `messages` + `frisbii_webhook_events` i sletterækkefølgen, frigørelse nulstiller også `quarantined_until`/`last_firm_id`.
- **Skridt E's scope udvidet IGEN (10/7, punkt 4):** tastefejl i kunde-email → velkomstmail/magic link når aldrig frem (i prod findes ingen MAIL_OVERRIDE_TO til at maskere det); kunden har nummer og service, men ingen adgang. Hører under "strandet onboarding"-varsling: detektér uleveret velkomstmail / aldrig-logget-ind og reager.

🔑 **PowerShell-lærdomme (7/7-26):** (1) `.ps1`-scripts skal være **REN ASCII** — Windows PowerShell 5.1 læser UTF-8 uden BOM som ANSI, og flerbyte-tegn (—, emojis) kan parse som anførselstegn → kryptiske "Missing closing brace"-fejl. (2) **Engangsopsætning pr. maskine:** `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (+ evt. `Unblock-File` på hentede scripts) — ellers "not digitally signed"-afvisning. (3) Ingen PS7-syntaks (`? :`-ternary) — maskinerne kører PS 5.1. *Alle tre ville have bidt partneren på dag ét.*

**Event → handling:** *(oprindelig plan — nu implementeret som beskrevet under C ovenfor)*
- `invoice_settled` → provisionér (claim nummer, opret firma + Auth-bruger, aktivér). Også ved fornyelse: bekræft `billing_status = paid`.
- Betalingsfejl/dunning *(verificér event-navn i dashboardet)* → `billing_status = past_due`, start grace-periode, varsl kunden. **Frigiv IKKE nummeret endnu.**
- Opsigelse (`subscription_cancelled`) → markér opsagt, **behold service til periodeslut**, brug som retention-signal. Ingen deprovisionering.
- `subscription_expired` → **DEPROVISIONÉR:** frigiv Twilio-nummeret til puljen (`firm_id = null`), sæt firmaet inaktivt, stop billing. *Her lukkes udgiftsdriveren.*
- `invoice_refund` → bogfør/flag.

**Fire korrekthedsregler (fra Frisbii-docs):**
1. **Opsigelse ≠ udløb.** Frigiv nummeret ved *expired*, ikke ved cancel (kunden har betalt til periodeslut). En cancel kan ankomme efter en uncancel — stol ikke på rækkefølgen alene.
2. **Webhooken bærer ingen tilstand** — den siger kun event-type + resurse-id. Hent den faktiske status via Frisbii-API'et før du handler.
3. **Idempotens via event-id:** gem id'et i en `webhook_events`-tabel **før** du svarer 200, behandl asynkront derfra (din dead-letter), og ignorér gentagne id'er. Lukker "immediate-200 taber et event"-risikoen.
4. **Lås endpointet:** kun Frisbiis kilde-IP'er (52.18.114.235 / 34.247.100.100) eller HTTP Basic Auth på webhook-URL'en. Frisbii retry'er fejlede webhooks (2-5-10-20-30 min, derefter hver time i 3 dage).

**Checkout (penge ind):** Frisbii hosted checkout ligger på partnerens kundesite → `invoice_settled` → din provisionering. Bekræft at knappen findes og peger rigtigt — ellers kan ingen betale.

---

## Byg-trin 9 — Brugs-/engagement-analytics (fast-follow efter launch)

Dormant-kunde-detektion og værdi-realisering. **Ikke launch-blokerende:** det kræver ægte trafik for at give mening, og med en håndfuld kunder kan du læse det med øjnene. Det er din **vækst/retention-løftestang**, ikke en sikkerheds- eller udgiftssag — derfor sidst.

- Per-firma: `last_active`, leads/uge, aktivering (har de fået første lead? logget ind i dashboardet?).
- Et ugentligt cron-job skriver en oversigt og mailer dig listen over **dormant kunder** (0 leads ELLER 0 logins i N dage), så du kan gribe dem, før de churner.

---

## Deploy-tjekliste (kopiér denne pr. release)

```
[ ] Migration testet på staging
[ ] Røgtest grøn på staging (bekendt har ringet, lead landede)
[ ] Merged til main
[ ] Vi er i deploy-vinduet (uden for arbejdstid) — eller det er en hotfix
[ ] Migration kørt på prod
[ ] sw.js cache-version bumpet
[ ] Health-check grøn
[ ] Én ægte handling verificeret i prod
[ ] Holdt øje i ~10 min
```

---

## Minimal-version (hvis I kun orker det vigtigste nu)

1. **Staging-miljø på Railway** med egne env-vars — stop med at teste i prod.
2. **Versionerede migrationer** — stop med håndredigeret SQL på prod.
3. **PITR-backup + én gendannelses-øvelse** — så I ved den virker.

Resten kan lægges ovenpå, når I har luft.

---

## Roller

- **Anne** — backend, infra, migrationer, prod-deploys og rollback.
- **Partner** — kundevendt site, onboarding-UI, indhold. Kan trigge deploys, ikke prod-secrets.
- **Evt. tredje person** — får **staging-adgang først**; prod-adgang når oplært. ⚠️ **Før dette sker:** aktivér Railway RBAC på production (udskudt 2/7-26, se Del 0.B punkt 4).

---

## Gendannelses-øvelse (step-by-step)

✅ **BESTÅET 3/7-26** — prod gendannet til staging via pg_dump/psql (Docker-fri vej), inkl. auth-brugere. Proceduren nedenfor er opdateret til den metode, der faktisk virkede, og er nu den gældende gendannelses-opskrift.

*Princippet står stadig: en backup du aldrig har gendannet, er et håb.*

1. **Tag snapshottet** — via **session-pooleren** (den direkte forbindelse er IPv6-only og virker ikke fra vores netværk; transaction-pooleren port 6543 knækker pg_dump):
   ```powershell
   $env:PGPASSWORD = 'prod-databasepassword'   # enkelte anførselstegn — $ og ` i dobbelte fortolkes af PowerShell!
   pg_dump "postgresql://postgres.<PROD_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --schema=public --schema-only -f schema.sql
   pg_dump "postgresql://postgres.<PROD_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --schema=public --data-only -f data.sql
   pg_dump "postgresql://postgres.<PROD_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --data-only --table=auth.users --table=auth.identities -f auth-users.sql
   ```
2. **Rejs et tomt mål** — staging-projektet (eller et midlertidigt Supabase-projekt). ⚠️ Med ægte kundedata i prod: brug et **isoleret** mål, ikke staging — eller anonymisér.
3. **Gendan ind i målet** — rækkefølgen er vigtig: **skema → auth-brugere → data** (FK'er fra `firm_users` m.fl. peger på `auth.users`):
   ```powershell
   $env:PGPASSWORD = 'målets-databasepassword'
   psql "postgresql://postgres.<MÅL_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" -f schema.sql
   psql "postgresql://postgres.<MÅL_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" -f auth-users.sql
   psql "postgresql://postgres.<MÅL_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" -f data.sql
   ```
   **Kendt, harmløs støj:** "ERROR: permission denied to change default privileges" ved ALTER DEFAULT PRIVILEGES-linjerne — nye Supabase-projekter har dem allerede sat.
4. **Verificér.** Først struktur (kør i begge projekters SQL-editor, listerne skal være identiske):
   ```sql
   select table_name, count(*) as kolonner
   from information_schema.columns
   where table_schema = 'public'
   group by table_name order by table_name;
   ```
   Så indhold:
   ```sql
   select 'firms' t, count(*) from firms
   union all select 'leads', count(*) from leads
   union all select 'calls', count(*) from calls
   union all select 'auth_users', count(*) from auth.users;
   ```
   Stemmer alle tal, og kan du slå et kendt firma op → gendannelsen virker.
5. **Ryd op:** slet dump-filerne, eller flyt dem til sikker off-site-placering — de må **ikke** committes til git.

**Note:** dette dækker `public`-tabellerne + auth-brugere. Til en ægte katastrofe-gendannelse skal **Storage**-filer (greeting-lyd + lead-billeder) også med — de ligger uden for Postgres og eksporteres for sig. Øv dét, når der er ægte kundedata at beskytte.

---

## Udeståender — samlet overblik (pr. 10/7-26)

*Én autoritativ liste. Når et punkt løses: flyt det til den relevante sektions ✅-historik og slet det her.*

### 🚂 Klar til at køre NU (opskrift: `opskrift-config-fix-og-prodtog.md` i docs/)
1. **Config-fixet til staging:** `SUPABASE_ANON_KEY` i staging-Railway + lokal .env → `app-config.js` + require i server.js → nye onboarding.html/dashboard.html → sw.js-bump v14→v15 → sample-mp3'er til staging-Storage → merge feat-gren → staging → verificér /config.js + frisk trial-gennemløb m. magic-link-LOGIN (den sidste ubestrøgne sti).
2. **Prod-tog for trial+config-koden:** `SUPABASE_ANON_KEY` i prod-Railway FØRST (ellers knækker dashboardet ved deploy!) → merge main → deploy → sw-bump verificeret → ét ægte login i prod. INGEN migrationer denne gang.
3. **Navne-sweep 1/3:** runbook omdøbes (`git mv` → ditdigitalekontor-drift-runbook.md) + interne referencer. De to andre filer (opskriftsbog-numre, config-fortegnelse) ved næste upload.

### 🔧 Kodeopgaver (prioriteret)
1. **Dublet-emails** (FØR go-live, blokerer ikke test): genbrug-eller-afvis ved eksisterende email i provisioneringen — produktbeslutning m. Anne. Indtil da: manuelt tjek jf. pilot-drejebog. *(Byg-trin 6, fundet 8/7; falsk alarm 10/7 var en tastefejls-email.)*
2. **Trin 6 E — varslinger** (produktbeslutning m. Anne, scope udvidet 10/7): (a) "vi er på sagen"-mail ved strandet provisionering (VIGTIGST — kunden har betalt og hører i dag INTET), (b) dunning-varsling/grace, (c) retention-alarm til os ved cancel, (d) **NY 10/7:** detektion af uleveret velkomstmail/aldrig-logget-ind (tastefejls-email → kunde med service men uden adgang).
3. **Checkout-vars** (go-live-gate): `FRISBII_PLAN_HANDLE` + `SIMPLY_BASE_URL` i BEGGE miljøer + accept_url/cancel_url → onboarding i stedet for `GET /` 404. *(Delvis genvej: sæt trial-planens handle i staging som led i checkout-test.)*
4. **Dead-letter-cron** (m. trin 7 overvågning): dagligt tjek af `processed_at is null` ældre end 1 time → sendAdminAlert. *(Del 0.F TODO.)*
5. `firms.phone_number` **unique-constraint** (kendt udskudt skema-skævhed — dagens medfødte `frisbii_subscription`-constraint dækker KUN samme-abonnement-racet, ikke to forskellige abonnementer der vælger samme pulje-nummer) + `created_at` på firms. *(Bonus-oprydning ved lejlighed: redundant `idx_firms_frisbii_sub` + legacy `firms_shopify_order_id_key`.)*
6. **check-env.js:** validér også `TWILIO_SYSTEM_NUMBER` + `VOICE_URL` + `SUPABASE_ANON_KEY` (navnedrift/manglende nøgler fanget 10/7).
7. **Trin 6 F** (valgfri hærdning): IP-lås/Basic Auth på webhook-endpointet.
8. Win-back-polish: venlig TwiML-besked på karantæne-numre + reset-/login-link-flowets UX (bevar rate-limit/anti-enumeration).

### 🏗️ Infrastruktur/indkøb
1. **Staging-systemnummer (subkonto-nummer nr. 3):** onboarding-verifikationsopkaldet kan IKKE testes i staging, før subkontoen har sit eget systemnummer (prod-nummeret kan ikke ringe fra subkontoen). Sæt `TWILIO_SYSTEM_NUMBER` i staging-Railway + lokal .env til det. *(Nr. 2 til puljen: ✅ købt + konfigureret 10/7 via configure-number.js.)*
2. **Prod-numre til pilot-ambitionen:** tjek puljen, køb evt. flere i HOVEDKONTOEN via buy-numbers.js (kræver nu eksplicit `VOICE_URL` = prod!), verificér voice-webhooks — pilot-drejebogens forudsætningsliste
3. Frisbii-branding (logo/farver/mails, dansk) i begge konti + øvelser: dunning-testkort, kuponer, planskift

### 🚦 Go-live-gates (master-punkt 8 — før første betalende kunde)
1. Supabase Pro + PITR på prod
2. Frisbii live-nøgler i PROD (kræver indløsningsaftale + MobilePay MSN → kræver bankkonto; staging beholder testkonto)
3. Checkout-vars + checkout-flow røgtestet fra partnersitet (kodeopgave 3)
4. Dublet-email-håndtering løst (kodeopgave 1)
5. Config-fixet deployet + verificeret i BEGGE miljøer (🚂-punkt 1+2)

### ⏸️ Bevidst udskudt (re-triggere dokumenteret i Del 0.B)
- Railway RBAC (tredje person/planopgradering) · Legacy→nye Supabase-nøgler (Supabase-deadline/refaktorering) · Twilio voice-region US1→IE1-vurdering (EU-princippet; før/kort efter go-live) · AppSignal expressErrorHandler-optimering

### 👥 Med Anne
- Pilot-formularen + forventningstekst + personlig velkomst (pilot-drejebog) — **rekruttering af testvirksomheder kan starte NU** (piloterne provisioneres manuelt uden om Frisbii)
- Dublet-email-beslutningen: genbrug eller afvis? (kodeopgave 1 — produktvinkel)
- Trin 6 E-varslingernes tekster/timing (kodeopgave 2)
- Onboarding af Anne i staging som udvikler (separat chat-oplæg findes)
