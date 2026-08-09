# Dit Digitale Kontor — runbook: drift & udvikling

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
4. ⏸️ **UDSKUDT (besluttet 2/7-26):** Restrikt `production`-miljøet (RBAC): Anne kan trigge deploys, men ikke se/redigere prod-secrets. Kræver Railway team-plan-features — ikke launch-blokerende med to personer, der begge er founders. **Tag den op igen:** senest når tredje person får adgang (jf. Roller), eller hvis I opgraderer Railway-planen af anden grund.
   ✅ **GENNEMFØRT 24/7-26 (ophæver UDSKUDT 3/7-26):** Migration fra Supabases legacy JWT-nøgler til Publishable/Secret keys — udløst af nøglerotationen efter .env-eksponeringen (legacy-nøgler KAN ikke roteres; migrering var eneste vej). Begge projekter kører nu sb_publishable/sb_secret i eksisterende variabelnavne (`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` — ingen kodeændring, app-config.js leverer til frontend), legacy-nøglerne er DEAKTIVERET i dashboardet, supabase-js 2.105.4 verificeret kompatibel. Fremadrettet rotation = normal opret/skift/slet af secret keys. Se `docs/RUNBOOK-noeglerotation.md`.
   ⏸️ **UDSKUDT (besluttet 24/7-26):** Twilio-migrering fra auth-token til API-nøgler (Twilios anbefaling). Kræver KODEÆNDRING: klient-init skiftes fra `twilio(accountSid, authToken)` til `twilio(apiKeySid, apiKeySecret, { accountSid })` + nye env-vars i begge miljøer + fuld telefoni-røgtest (opkald→SMS→lead). ⚠️ Auth-tokenet FORSVINDER IKKE ved migreringen — det signerer fortsat webhooks (X-Twilio-Signature) og skal derfor stadig roteres ved eksponering (mekanisme: sekundært token, se nøglerotations-runbooken; begge kontoers tokens roteret 24/7-26). Gevinst: nøgler der kan revokeres enkeltvis uden at røre kontoen. **Tag den op igen:** ved næste Twilio-relaterede kodearbejde, eller senest sammen med IE1-regionsvurderingen (Del 0.D) — de to Twilio-projekter kan med fordel tages i samme ombering.
5. Find **rollback-knappen** i Railway nu, så du ved hvor den er, før du får brug for den.

### C. Supabase — staging-projekt + versionerede migrationer
Dette er det vigtigste skifte. **Stop med at køre SQL i hånden i dashboard-editoren mod prod.**

1. Opret et **separat Supabase-projekt** til staging (samme region som prod: **eu-west-1, West EU Irland** — verificeret i dashboardet 3/7-26; tidligere stod her fejlagtigt Frankfurt). Total isolation — testfirmaer rører aldrig prod. ✅ *Oprettet: `ditdigitalekontor-staging`.*
2. Indfør CLI-migrationer (Windows/PowerShell). ⚠️ **Docker-forbehold:** `supabase db pull` (og `db dump`) kræver Docker. **Docker-fri vej (den vi brugte):** dump prod-skemaet med `pg_dump`, opret en tom migration med `npx supabase migration new baseline`, kopiér skemaet ind i den, og markér den som allerede kørt i begge projekter med `npx supabase migration repair --status applied <timestamp>`. Commit filen. Det er jeres nul-punkt. ✅ *Baseline etableret 3/7-26.*
   ✅ **`.env`-parse-fejlen LØST 5/7-26:** synderen var en linje med variabelnavn uden `=` (`SCW_REGION`-torso fra en tidligere redigering — Go-parseren i Supabase CLI nægter, Node's dotenv ignorerer). Omdøbnings-dansen er pensioneret.
   ⚠️ **LINK-FÆLDEN (bidt 6/7-26):** Supabase CLI'en læser HVERKEN `.env` eller Railway — dens mål er usynlig tilstand i `supabase\.temp\project-ref` fra sidste `supabase link`. Et `db push` rammer lydløst det linkede projekt, uanset hvad du tror. (Bed-eksempel: migration nr. 2 landede i PROD, fordi linket aldrig var skiftet efter baseline-arbejdet — harmløst dén dag, additive nullable kolonner, men mønstret er farligt ved destruktive migrationer.) **Værn:** brug `.\push-staging.ps1` (nægter at pushe, hvis linket ≠ staging) til dagligt arbejde og `.\push-prod.ps1` (kræver at man skriver PROD, linker selv, og skifter ALTID tilbage til staging bagefter) til releases. **CLI'ens faste hviletilstand er staging.** Manuel kontrol: `Get-Content supabase\.temp\project-ref` før enhver push.
   ⚠️ **TOM-FIL-FÆLDEN:** `db push` "applier" gladeligt en tom/ugemt migrationsfil, melder Finished og bogfører den som kørt — kolonnerne opstår aldrig, og et nyt push gør intet. **Verificér ALTID med kolonne-forespørgsel i SQL-editoren efter push** (og tjek projekt-ref i browserens URL — to identiske dashboards!). Fortryd en fejl-bogført migration: `npx supabase migration repair --status reverted <timestamp>` → ret filen → push igen. **Kommentar-undtagelsen (17/7):** i en allerede-kørt migrationsfil må KOMMENTARER gerne tilføjes/rettes (CLI'en genkender på filnavn/tidsstempel og genkører ikke) — fx side-navne-oversættelsen og analyse-SQL'en i `20260716090000`. Filnavnet og selve SQL-sætningerne er fortsat urørlige.
   📌 **Lokal `.env`-arkitektur (besluttet 5/7-26):** Den lokale `.env` peger på **STAGING** (Supabase, Twilio-subkonto, Frisbii-testkonto, staging-BASE_URL) + `MAIL_OVERRIDE_TO` sat — lokale scripts kan dermed ikke ramme prod eller maile kunder ved et uheld. **Prod-værdier bor KUN i Bitwarden + Railway**; skal et script undtagelsesvis køre mod prod, sættes vars eksplicit i PowerShell-sessionen (`$env:...`) for den ene kørsel — friktionen er en feature. **Verifikation efter enhver `.env`-redigering:** `node check-env.js --live` — dømmer alle nøgler statisk (JWT role/ref, formater) OG spørger Supabase/Twilio/Frisbii "hvem er du?" (friendly name/handle skal svare staging). Fangede en Twilio-401 i første kørsel.
3. Fra nu af: **hver skemaændring = en ny migrationsfil.**
   ```powershell
   npx supabase migration new tilfoej_kolonne_xyz
   # skriv din ALTER/CREATE i filen
   ```
   Kør den på staging først, så prod (se Del 1). `messages-patch.sql`-mønsteret bliver nu bare en almindelig migration — og `if not exists`-fælden forsvinder, fordi historikken styres af migrationsrækkefølgen.
4. (Senere, valgfrit) Supabase **branching** kan give en DB-preview pr. pull request. Lad det ligge til I har behov; det persistente staging-projekt er arbejdshesten.

### C2. Gitleaks — pre-commit-vagt mod hemmeligheder (etableret 31/7-26)

Naegter commits med noegler i. Gaelder ALLE haender, inkl. Claude Code.
Baggrund: `.env`-eksponeringen 22/7 — en noegle, der foerst ER committet, ligger i
historikken for altid, og oprydningen kraever BAADE historik-omskrivning OG rotation.

**Verificeret 31/7 i begge retninger:** fake Twilio-token AFVIST (`generic-api-key`,
`Secret: REDACTED`), normal commit gik igennem upaavirket. Begge veje skal testes —
en hook, der aldrig kaldes, ser i den ene retning ud praecis som en, der virker.

**Installation paa ny maskine** (hook'en ligger i git, men virker ikke af sig selv):

```powershell
# 1) Vaerktoejet — hoerer til MASKINEN, ikke projektet
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$mappe = "$env:LOCALAPPDATA\gitleaks"
New-Item -ItemType Directory -Force -Path $mappe | Out-Null
$udg = Invoke-RestMethod "https://api.github.com/repos/gitleaks/gitleaks/releases/latest"
$fil = $udg.assets | Where-Object { $_.name -like "*windows_x64.zip" } | Select-Object -First 1
Invoke-WebRequest $fil.browser_download_url -OutFile "$mappe\gitleaks.zip"
Expand-Archive "$mappe\gitleaks.zip" -DestinationPath $mappe -Force
Remove-Item "$mappe\gitleaks.zip"

# 2) PATH (permanent) — luk terminalen HELT bagefter, PATH laeses kun ved opstart
$p = [Environment]::GetEnvironmentVariable("Path","User")
[Environment]::SetEnvironmentVariable("Path", "$p;$mappe", "User")

# 3) Indstillingen — hoerer til PROJEKTET, koeres i repo-roden
git config core.hooksPath .githooks
```

`winget` findes ikke paa alle maskiner (kraever App Installer) — derfor binaeren direkte.
Virker `gitleaks version` ikke i et FRISKT vindue: tjek `Test-Path`, derefter
User-PATH, derefter `$env:Path`. Er de to sidste uenige, arves miljoeet fra en
proces startet foer aendringen (klassisk med VS Code — luk hele programmet, ikke fanen).
Hjaelper det ikke: `Unblock-File` paa exe'en (zip-udpakkede filer baerer et
"hentet fra internettet"-maerke).

**Filer i repoet:** `.githooks/pre-commit` (ren ASCII, **LF-linjeskift** — CRLF faar
Git for Windows' indbyggede `sh` til at fejle kryptisk) og linjen
`.githooks/** text eol=lf` i `.gitattributes`, saa checkout ikke konverterer dem.
`core.hooksPath` er LOKAL config og foelger ikke med i git — derfor staar
installationsvejledningen ogsaa i toppen af hook-filen selv.

**Hook'en fail-closer:** mangler gitleaks, blokeres commit'et med en forklarende
besked. En vagt, der stiltiende lader alt passere, naar den ikke finder sit
vaerktoej, er vaerre end ingen vagt.

**Triage naar den fyrer** — tre spoergsmaal i raekkefoelge:
1. *Er det en aegte hemmelighed?*
2. *Hvis ja — har den vaeret committet FOER?* Kun i staging-omraadet (hook'en stoppede
   den) → fjern fra filen, faerdig, ingen rotation. Allerede i en tidligere commit →
   **noeglen SKAL roteres**; at slette den nu fjerner den ikke fra fortiden.
3. *Hvis nej — hvorfor tror den, det er en hemmelighed?* → undtagelse i
   `.gitleaks.toml`, saa smal som mulig (én sti, én regel), med kommentar om
   HVORFOR og HVORNAAR. Filen SKAL starte med `[extend]` + `useDefault = true`,
   ellers ERSTATTER den gitleaks' 150+ indbyggede regler i stedet for at supplere —
   en vagt der intet opdager, uden at sige det.

**Historik-baseline:** `gitleaks git --redact` én gang. Fund fra 22/7-eksponeringen er
forventede og roterede — information, ikke brand. Omskriv ikke historik paa den baggrund.

**Udestaaende:**
- [ ] `--no-verify` tilfoejes deny-reglerne i `.claude/settings.json` (Claude Code maa
      ikke kunne omgaa vagten for at faa en commit igennem)
- [ ] Naar tilbudsmodulets nye noegler kommer (transskription, Anthropic): test at
      gitleaks genkender formaterne — fake noegle → skal afvises. Ellers egen regel.
- [ ] Opdatér gitleaks et par gange aarligt (nye regler for nye leverandoerformater)

### C3. Branch-beskyttelse paa GitHub (etableret 1/8-26)

**Ligger IKKE i git.** Rulesets er kontoindstillinger hos GitHub — derfor staar de her.
Samme skel gaelder Railway-miljoeer og Supabase-planer: kode og konfiguration-som-kode
hoerer i repoet, leverandoer-indstillinger hoerer i runbooken.

**Findes under:** Settings → **Rules → Rulesets** (ikke "Branches" — menuen er flyttet).

| Ruleset | Maal | Regler |
| --- | --- | --- |
| `staging-beskyttelse` | `staging` | Block force pushes, Restrict deletions |
| `main-beskyttelse` | `main` | Block force pushes, Restrict deletions, **Require a pull request before merging** |

Asymmetrien er med vilje: `staging` skal vaere hurtig, `main` skal vaere svaer.
PR-kravet gaelder kun dér, hvor kunderne er. Ann pusher aldrig direkte til `main`
(arbejdsgangen er `staging` → PR → merge → prod deployer), saa reglen haandhaever
bare den vane, der allerede findes.

**Verificeret i begge retninger 1/8** — `Everything up-to-date` beviser INTET
(git sendte aldrig noget; reglen blev aldrig proevet). Aegte test:

```powershell
git commit --allow-empty -m "test af branch-beskyttelse"
git push origin staging
git reset --hard HEAD~1     # sikkert: commit'en er TOM, alt ligger paa GitHub
git push --force origin staging     # skal afvises: GH013 "Cannot force-push"
git pull
```

Efterlader en tom commit i historikken, der dokumenterer testen. Harmloest.

**Bypass-listen skal vaere TOM.** En regel med en bypass er en regel, der ikke gaelder
den, der er mest tilboejelig til at bruge den — én selv, sent om aftenen.

### C4. Railway-projekter og GitHub-miljoeer (ryddet 1/8-26)

**Railway:** ét projekt, `noble-ambition`, med to environments — `staging` og
`production`. `shimmering-blessing` (tomt, oprettet ved et uheld) SLETTET 1/8.
Ingen git-oprydning noedvendig; det var aldrig koblet til repoet.

**GitHub-miljoeet `staging.` (med punktum) SLETTET 1/8.** Det stod roedt i
deployment-listen ved hvert push. Diagnosen tog tre skridt og er vaerd at huske,
fordi den foerste forklaring var forkert:

1. Antagelse: "en enkelt mislykket deploy". **Forkert** — den havde intet tidsstempel
   og gik igen ved hvert push.
2. Commit'et bag fejlen aendrede kun KOMMENTARER (`lommekontor` → `ditdigitalekontor`).
   Ingen kode. Altsaa fejlede koden ikke.
3. Afgoerende: projekt-id'et i miljoeets link (`16bdc43e-0a87…`) matchede **ikke**
   `noble-ambition`. Miljoeet pegede paa et Railway-projekt fra FOER navneskiftet,
   som ikke findes laengere. Derfor fejlede deployet — der var intet at deploye til.

**Slettes via Settings → Environments** (ikke via deployment-listen; "Mark as inactive"
findes kun i GitHubs API, ikke i brugerfladen).

**Laere:** et navneskift efterlader spor i leverandoerernes kontoindstillinger, som
ingen kodesoegning finder. Ved fremtidig noeglerotation: tjek at Railway stadig har
ét projekt med to environments, og at GitHub → Settings → Environments matcher.
Et glemt miljoe med gamle noegler er praecis det, der overses.

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
  📌 **Udvidet 5/8-26: der er FIRE konti i vælgeren, ikke tre.** Rollefordelingen nedenfor er uændret og blev bekræftet ved at aflæse **webhooks pr. konto** — det er den eneste pålidelige prøve, for en konto med en webhook mod staging-URL'en *er* staging. Hostede sider og plan-lister siger intet om, hvad koden peger på.
  | Handle | Mærkat i UI | Webhooks | Rolle |
  |---|---|---|---|
  | `test-2-lommekontor` | LIVE | ingen | **PROD ved go-live.** Endnu ikke i brug — derfor hverken webhooks eller hostet side. Live-nøgler koster penge og trækkes umiddelbart før launch |
  | `test-2-lommekontor_test` | TEST | mange | **PROD i dag.** Prod-appen kører bevidst på denne kontos test-nøgler indtil go-live. Webhook → KUN prod-URL |
  | `lommekontor` | TEST | mange | **STAGING** — egen API-nøgle, egen webhook-secret, webhook → KUN staging-URL, spejlet plan + dunning-plan |
  | `oprettelse-og-abonnement` | TEST | ingen | **UBRUGT — må ikke tages i brug.** ⚠️ `.env.staging` pegede alligevel herhen indtil 5/8-26; `check-env.js --live` fangede det, og meldingen blev først læst baglæns. Den er tom, så alt Frisbii-arbejde fra lokale scripts ramte en konto uden data |
  🔑 **Lærdomme fra opsætningen (4-5/7-26):**
  1. **⚠️ Frisbii-UI'et opdaterer IKKE pålideligt ved kontoskift — tryk F5 efter HVERT skift.** Ellers vises den gamle kontos data under det nye kontonavn. Var årsag til både tilsyneladende "delte data" mellem konti og et test-checkout, der reelt skete i PROD-kontoen (→ prod provisionerede et testfirma, der måtte ryddes op: firms + firm_users + auth-bruger + phone_numbers-frigivelse + annullér abonnementet i Frisbii, så det ikke fornyer).
  2. **Hosted checkout arver konto → webhook → miljø.** Betalingssiden afgør, hvilket miljø der provisionerer. Brug ALTID en emailadresse du selv ejer i test-checkouts — hvis eventet ender i prod, sender prod en ÆGTE mail til adressen.
  3. **Webhooks kan stå DISABLED** (overset ved oprettelse, eller Frisbii deaktiverer selv efter gentagne fejlede leverancer). Symptom: events genereres fint i event-loggen med "Forsøg: -", men intet leveres — tavs Railway, urørt DB. Tjek status-togglen, ikke kun URL/events.
  4. **Frisbiis event-log kan GENUDSENDE events** (flueben → resend) — uvurderligt testværktøj: ét checkout kan afprøves mod webhooken igen og igen uden nye betalinger.
  5. **En plan kræver en dunning-plan** — "dunning plan not found" ved plan-oprettelse i tom konto betyder: opret dunning-planen først (spejl prods: samme handle, forsøg, interval). Dunning-indstillingerne skal genbesøges i byggetrin 6 (grace-periodens længde afstemmes med dem).
  6. **Frisbii retryer fejlede webhooks i op til 3 dage** (2-5-10-20-30 min, så hver time) — gamle fejlede forsøg kan banke på længe efter; prods idempotens-/alders-guard håndterer dem som no-ops (verificeret 5/7-26).
  7. **⚠️ RETTET 4/8-26 — checkout-endpointet er IKKE en kontrolleret 500'er. Det er et 404.** Den tidligere formulering her var forkert og kostede en forkert diagnose: `requireConfig()` i `frisbii-checkout.js` kan ikke fejle ved kald, fordi den aldrig **bliver** kaldt. **Modulet er aldrig monteret** — `require("./frisbii-checkout")(app)` findes ingen steder i kodebasen. Linjen står kun som en *kommentar inde i filen selv* (linje 10), der beskriver, hvordan den skulle indlæses. Verificeret 4/8-26 med `Select-String` over alle `.js` uden for `node_modules`.
     **Go-live-blokerende for salg via partnersitet.** Fix i rækkefølge — de tre trin er uafhængige, og hvert af dem *alene* ændrer intet for kunden:
     1. **Montér modulet** i `server.js`, sammen med de øvrige monteringer lige efter `frisbii-webhook`: `require("./frisbii-checkout")(app);` ✅ **Udført OG verificeret 5/8-26** — boot-linjen `🧾 Frisbii checkout-rute registreret paa /checkout/start` observeret lokalt og i Railways deploy-log. ⚠️ **Prod var stadig 404 efter staging-verifikationen:** commiten lå kun på `staging`, og `main` var bagud — PR til `main` var nødvendig. Mål ALTID prod selvstændigt; staging beviser koden, ikke deployet. Verificeret før redigering, så det ikke skal udledes igen: signaturen er **`(app)` alene** (routen rører ikke databasen), og `requireConfig()` kaldes **først inde i rutehandleren** — modulet kan derfor ikke crashe ved boot, og trin 1 er trygt at køre før trin 2. Manglende variabler giver `500 server_misconfigured` med navnene i Railway-loggen. ⚠️ **Env-vars fanges i closuren ved montering, ikke pr. kald** — ændres `FRISBII_PLAN_HANDLE`/`SIMPLY_BASE_URL` i Railway, skal appen genstarte, før det virker. Bekræft monteringen på boot-linjen `🧾 Frisbii checkout-rute registreret paa /checkout/start`. **Nyt fund ved gennemgangen: `/checkout/start` er offentligt og uden rate limit → S12 i registret.**
     2. **Sæt `FRISBII_PLAN_HANDLE` + `SIMPLY_BASE_URL`** i BEGGE Railway-miljøer — de har aldrig været sat. Plan-handlet er **`telefonpasser`** (sat 8/8-26; hed `trial-30-dage` indtil da, se lærdom 413) og læses inde i den rigtige konto (**tryk F5 først, jf. lærdom 1**). Planen åbnes for at bekræfte, at de **30 dages** prøveperiode faktisk står på den — og siden 8/8 er den manuelle aflæsning ikke længere eneste værn: `check-env.js --live` fejler, hvis feltet er tomt (**D26**). `SIMPLY_BASE_URL` er Simply-sitets domæne **uden afsluttende skråstreg** — koden bygger `${SIMPLY_BASE_URL}/tak` og `${SIMPLY_BASE_URL}/afbrudt`. ✅ **Udført og verificeret 5/8-26.** Værdier: `FRISBII_PLAN_HANDLE=telefonpasser` (samme handle i BEGGE Frisbii-konti — det gamle prod-handle `test-2-lommekontor` er ude af brug; handlet blev sat som `trial-30-dage` 5/8 og omdøbt 8/8, se lærdom 413 og **D25**) · `SIMPLY_BASE_URL=https://ditdigitalekontor.dk`. Sat i begge Railway-miljøer og i `.env.staging`/`.env.prod`. **Prøveperioden er 30 dage, ikke 14** (Annes beslutning 5/8). **Verifikationskald — trygt mod prod, fordi `requireConfig()` og e-mailtjekket begge kører før `fetch`, så Frisbii aldrig rammes:**
        ```powershell
        curl.exe -i -X POST https://opgave.ditdigitalekontor.dk/checkout/start -H "Content-Type: application/json" -d "{}"
        curl.exe -i -X POST https://opgave.ditdigitalekontor.dk/checkout/findes-ikke -d "{}"
        ```
        Forventet: **400 `invalid_email`** på den første (= monteret OG variabler sat), **404** på den anden (negativ kontrol — uden den beviser et ≠404-svar ingenting). `500 server_misconfigured` = mindst én variabel mangler, og Railway-loggen navngiver den.
     3. **Byg de to landingssider** `/tak` og `/afbrudt` på Simply-sitet, plus en venlig rod-rute på backenden (redirect til ditdigitalekontor.dk). Rå 404 må aldrig vises et menneske. Afbrudt-siden glemmes let — den ses kun af dem, der fortryder, og det er dem, man helst vil have tilbage.
     ⚠️ **Selv med alle tre trin kan prod ikke tage imod penge endnu:** prod-kontoen kører bevidst på test-nøgler indtil go-live (se kontotabellen ovenfor). Den fulde rækkefølge er montering → variabler → sider → live-nøgler.
     🔁 **Fejlmåden er vigtigere end fejlen:** et umonteret modul giver 404 — intet crasher, intet logges, og knappen "lykkes" tavst. Det er **anden** forekomst; `onboarding-link` var den første, og advarslen om præcis dette står som kommentar i `server.js` linje 78-82. Kommentarer beskytter kun mod fejl, som nogen når at læse dem i tide. Fjernes med et **≠404-tjek pr. kritisk endpoint i røgtesten** (punkt 25) — se **D23** i risikoregistret. ✅ **LEVERET 5/8-26 i `smoke.js`, grøn i begge miljøer.** Tre tjek: negativ kontrol (ukendt rute SKAL give 404, ellers beviser ≠404 intet) · monteringstjek over `MONTEREDE_RUTER` (samler alle fund i én kørsel) · rodrute (302 + validering af `location`). **To regler for listen:** kun ruter der skal findes i BEGGE miljøer — flag-styrede ruter som `/api/tilbud/*` giver 404 MED VILJE, og et permanent rødt tjek lærer dig at ignorere rødt · kun kald der falder på første validering i handleren, så intet skrives i prod. Rest: `/opret-opgave` og Frisbii-webhooken føjes til, når deres handlere er læst.
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

**🏁 DEL 0.D FÆRDIG 5/7-26 — og dermed HELE DEL 0 (fundament-opsætningen):** Git ✓ · Railway to miljøer ✓ · Supabase staging + migrationer ✓ · Twilio subkonto ✓ · Frisbii testkonto pr. miljø ✓ · Scaleway mail-mur ✓ · ElevenLabs ✓ · Backup + gendannelses-øvelse ✓ · AppSignal ✓. Alle tre webhook-sømme (Twilio, Frisbii, Scaleway) er røgtestet end-to-end i staging med verificeret uberørt prod. Udskudte gates (dokumenteret med re-triggere): Pro/PITR + Frisbii live-nøgler + checkout-vars (master-punkt 8), RBAC + Twilio API-nøgle-migration (Del 0.B; Supabase legacy-nøgle-migration ✅ 24/7-26).

### E. Backup på prod

**VIRKELIGHEDEN LIGE NU (Pro-plan — bekræftet i dashboardet 2/8-26):** prod-organisationen er på Pro. Supabase tager daglige fysiske snapshots, og de seneste 7 dage kan gendannes fra dashboardet (Database → Backups → Scheduled backups). Kadence for det manuelle dump: frisk dump før hver større skemaændring.

**PITR er IKKE slået til — bevidst valg 2/8-26.**
- **Valgt:** 7 dages daglige backups. **Alternativ:** PITR som tilkøb.
- **Hvorfor:** prod indeholder testdata, og der er ingen betalende kunder. De op til 24 timers RPO beskytter ikke noget uerstatteligt endnu.
- **Omstødelig:** PITR faktureres pr. time og kan slås til når som helst. Derfor fem minutters beslutning, ikke en dags.
- **Re-trigger: første betalende kunde.** Fra det øjeblik findes der ægte kundedata, og beskyttelsen skal være automatisk frem for afhængig af en manuel rutine.
- ⚠️ **PITR er ikke omfattet af Spend Cap** (Spend Cap er aktiv på organisationen pr. 2/8-26). Den dag PITR slås til, løber udgiften uden om spærringen. PITR kræver desuden mindst et **Small compute-add-on**.
- Se **D17** i `RISIKOREGISTER.md`.

- Pro-plan giver de seneste 7 dages daglige (fysiske) snapshots — de kan **ikke** downloades/inspiceres.
- ⚠️ **Backups dækker IKKE Storage.** Supabase skriver det selv på backup-siden: en databasebackup indeholder kun *metadata* om objekter uploadet via Storage-API'et, ikke objekterne selv — og gendannelse af en gammel backup bringer ikke filer tilbage, der er slettet siden. Greeting-lyd og lead-billeder skal sikres for sig, se "Gendannelses-øvelse (step-by-step)".
- Slås PITR til en dag: bemærk at der så ikke længere tages daglige backups (PITR er finere granularitet, så begge dele er unødvendigt).
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

⚠️ **`npm run smoke:prod` havde aldrig kørt rigtigt — hændelse 5/8-26.** `.env.smoke` havde `SMOKE_PROD_SUPABASE_URL=yyyyyyyy` (placeholder, aldrig udfyldt) og `SMOKE_PROD_URL` pegende på **Simply-sitet** `ditdigitalekontor.dk` i stedet for backenden `opgave.ditdigitalekontor.dk`. Deploy-tjeklistens krav om en grøn prod-røgtest har dermed været uden dækning, selv om punktet blev afkrydset.
**Symptomet lignede et nedbrud:** otte røde tjek på 0,6 sekunder. `/health` 404, `/config.js` 404, `fetch failed` på Supabase. To linjer afslørede sandheden — `URL:` og `Supabase-ref:` i outputtets hoved. **Læs altid de to linjer først, når prod-røgtesten er rød.** Bemærk også, at `/opkald`-tjekket stod som OK med "afvist med 404": det accepterer alt under 500, så et statisk sites 404 ser ud som en afvisning.
**Fix:** `tjekPlaceholder()` i `smoke.js` afviser placeholder-værdier ved opstart, på linje med `normaliserUrl()`. Den splitter URL'en i led først, fordi `https://yyyyyyyy.supabase.co` ikke matcher som hel streng, men `yyyyyyyy` gør. Testet mod 12 tilfælde (inkl. både JWT- og `sb_publishable`-nøgleformater) uden falske positiver.
**Princippet:** en konfigurationsfil kan lyve om at være udfyldt. `.env.smoke` indeholder BEGGE miljøer samtidig og skiftes aldrig — den udfyldes én gang. Kun anon-nøgler, aldrig service role.

⚠️ **Udviklingsmaskinens PATH — hændelse 5/8-26.** System-PATH (`HKLM\...\Session Manager\Environment`) var overskrevet ned til to poster: `C:\Program Files\nodejs\` og `C:\Program Files\Git\cmd`. Alle fem `%SystemRoot%`-standardposter var væk, formentlig fra en installer, der satte PATH med `=` i stedet for at føje til. Ingen `setx`/`SetEnvironmentVariable` fundet i egne scripts eller `$PROFILE`.
**Symptom:** `curl.exe`, `reg`, `where.exe`, `ipconfig`, `netstat`, `icacls` findes ikke — men PowerShells egne cmdlets virker, så maskinen føles rask. Fejlen ligner noget andet, hver gang den rammer.
**Diagnose:** `[Environment]::GetEnvironmentVariable('PATH','Machine')` — længde 49 tegn afslørede det (sund maskine: 150+, her 179 efter rettelsen). `$env:PATH` alene duer ikke, hvis sessionen er lappet med `+=`.
**Rettelse:** `sysdm.cpl` → Miljøvariabler → **Systemvariabler** (ikke Brugervariabler — de to lister ligner hinanden, og bruger-PATH føjes til bagefter, så en rettelse dér *føles* som en løsning uden at være det). Fem poster øverst, i denne rækkefølge: `%SystemRoot%\system32` · `%SystemRoot%` · `%SystemRoot%\System32\Wbem` · `%SystemRoot%\System32\WindowsPowerShell\v1.0\` · `%SystemRoot%\System32\OpenSSH\`. Skriv `%SystemRoot%`, ikke `C:\WINDOWS`. Brug **ikke** `setx` — den afkorter ved 1024 tegn.
**Verifikation i et NYT vindue** (gamle processer arver den gamle PATH): `$env:PATH -split ';' | Select-Object -First 8` skal vise de fem ekspanderet øverst. Filtrerer man på `*System32*`, er det rigtige svar **4** og ikke 5 — `%SystemRoot%` alene ekspanderer til `C:\WINDOWS` og matcher ikke. Tjek også `where.exe node` og `where.exe git`, så redigeringen ikke har kostet noget.
**Sikkerhedskopi før redigering:** `reg export "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "$HOME\env-machine.reg" /y` (kræver at PATH er lappet i sessionen først: `$env:PATH += ";$env:SystemRoot\System32"`). Bemærk at en `.reg`-import kun overskriver og tilføjer — den fjerner ikke noget, du har tilføjet siden, så den er en nødbremse under arbejdet og ikke en vej tilbage bagefter.

1. `git checkout -b feat/min-aendring` (ud fra `staging`).
2. Lav kodeændringen. Er der en skemaændring? → **ny migrationsfil** (aldrig direkte SQL på en levende DB).
3. `git push` → staging-appen auto-deployer. Kør migrationen på **staging**:
   ```powershell
   .\push-staging.ps1   # verificerer linket FØR push — nægter hvis linket ≠ staging
   ```
4. **Røgtest på staging:** kør `provision-test-firm.js` mod staging, og lad en *bekendt* ringe til staging-nummeret. Tjek at lead lander, SMS sendes, mail kommer.
3b. **`npm run smoke` mod staging — en opgave er først færdig, når den er grøn.**
   Ét script (`smoke.js`), ~1,5 sek., ét grønt/rødt svar. Den tester IKKE det, du
   lige har bygget — den tester, at du ikke har brækket noget andet. Rød = stop:
   enten fixer du koden, eller også fixer du tjekket, men du deployer ikke forbi.
   Efter prod-deploy: `npm run smoke:prod` (kun de læsende tjek).
   **Vedligehold:** hver driftsfejl fremover får et tjek, der ville have fanget den.
   Nye tjek skal brækkes én gang med vilje — et tjek, du aldrig har set rødt, er
   dekoration. *(Leveret 31/7. Fandt samme dag et ægte hul: `/opkald` accepterede
   kald med falsk Twilio-signatur — se kodeopgave 24.)*
5. Merge til `staging` → (når grøn) PR/merge til `main`.
6. **Se hvad der FAKTISK er i kø til prod — FØR du rører push-scriptet:**
   ```powershell
   git fetch origin
   git log --oneline origin/main..staging
   git diff --stat origin/main..staging
   ```
   Det er DEN liste, der rammer prod — ikke den ændring, du sidst arbejdede på.
   **Hvorfor (lærdom 27/7):** git og databasen kan glide fra hinanden i BEGGE
   retninger, og `db push` siger det aldrig højt. (a) *Filen mangler i git:*
   `git commit -am` tager KUN filer, git allerede kender — helt nye filer ryger
   tavst udenom, og `git status --short` viser dem som `??` (ikke ignoreret, bare
   aldrig tilføjet). Kvittering: `git ls-files supabase/migrations`. (b) *Ændringen
   mangler i `main`:* `20260716090000_onboarding_sidevisninger` blev kørt på prod
   16-17/7, men filen lå kun på `staging` i 11 dage. Ufarligt — Supabase bogfører
   anvendte migrationer og springer dem over — men skævheden er usynlig, indtil
   man ser efter. Bonus: diffen afslører også, hvis et helt andet spor er sneget
   med på `staging` (PR'en til `main` tager ALT, ikke kun det, du tænkte på).
7. **Promote til prod — i deploy-vinduet** (se Del 2):
   - Railway: promote / deploy `main`.
   - Kør samme migration på **prod**: `.\push-prod.ps1` (kræver PROD-bekræftelse, linker selv om, og skifter tilbage til staging bagefter).
   - **Bump `sw.js` cache-version** ved ændringer i sw.js selv eller cachede aktiver. *(Fra v17, 13/7: /dashboard-HTML hentes network-first, så rene HTML-ændringer slår igennem UDEN bump; kundeformular/onboarding/config.js røres slet ikke af SW'en.)*
8. Verificér i prod: health-check grøn + én ægte handling (fx et testopkald fra egen telefon). Hold øje i ~10 min.
9. Går det galt: **rollback koden** i Railway (hurtigst). DB: kør kun frem-migrationer; ingen destruktive ændringer uden frisk backup.

---

## Del 2 — Release-regler ("udviklingsstoppet")

- **Deploy-vindue:** deploy ikke til prod i håndværkernes arbejdstid — det er præcis dér de ubesvarede opkald kommer. Aften/weekend eller et defineret lavtrafik-vindue. **Hotfix er undtagelsen.**
- `main` er **altid** deploybar.
- **Aldrig** håndredigeret SQL på prod — kun migrationer.
- **Aldrig** live-creds i staging.
- `service_role`-nøglen kun server-side (den omgår RLS).
- **PWA-ikon og app-navn ændres ALDRIG efter kundelancering:** iOS kan ikke opdatere en installeret PWA's skal (ikon/navn/splash = installations-øjebliksbillede; kun slet+geninstallér hjælper). Android self-healer via manifest-gentjek. Alt INDE i appen opdaterer derimod automatisk. (Princip fastlagt 13/7 — detaljer i primerens faldgruber.)

---

## Del 3 — Hvis det brænder (incident)

1. Kunde melder fejl → tjek **health-check**, **Railway-logs** og de **tre webhooks**.
2. **Rollback koden først** — det er det hurtigste tilbage til en kendt god tilstand.
3. DB-fejl (forkert data/migration) → vurder **PITR-gendannelse**. Husk: prod er **utilgængelig under restore**, og varigheden vokser med DB-størrelsen — meld evt. kort driftsstop.
4. Tjek Twilio- og Frisbii-status hvis opkald/betaling driller.

---

## Byg-trin 6 — Frisbii-livscyklus

*Frisbii Billing & Pay (Reepay-arven). Bygges + testes i staging mod sandbox, med skemaændringer som migrationer.*

**STATUS 12/7-26 (opdateret): SMS-SEGMENTFEJLEN FUNDET OG RETTET I PROD — kerneproduktets kæde bevist ende-til-ende.** Rodårsag: efter rebrandingen (domænet +8 tegn) oversteg ALLE kunde-SMS'er 160 GSM-tegn → deling MIDT i linket → "Cannot GET" hos kunden. Fix (deployet + røgtestet i begge miljøer): kunde-skabelonen samlet i `kundeSmsBody()` (154 tegn), demo-SMS som TO beskeder (forklaring + nøjagtig kopi), `gsmSegments`-vagt der logger ⚠️ ved >1 segment. Prod nulstillet 11/7 (SIDSTE gang — se regler) og gen-etableret: testfirma + pilot #0 (Anne) provisioneret med rettet SMS; velkomst→onboarding→verifikationsopkald→demo→ægte opkald→formular→lead: alt grønt. Staging-systemnummer etableret (+4591309928 ophøjet fra puljen). **To ÅBNE fund overdraget til ny chat (oplæg i docs/): (1) HVID SKÆRM på mobil-dashboard hos BÅDE Ann og Anne — server svarer 200 på alt; klient-fejl, SW-mistanke. (2) Rescue-mailen genbruger velkomstskabelonen — forvirrende for eksisterende kunder (kodeopgave 8, konkretiseret m. tekstforslag).**

*(Tidligere status 11/7: prod-toget kørt via PR; trial-provisionering + config-fix live og verificeret.)* Config-fixet er deployet og bevist i BEGGE miljøer: staging-magic-link-login virker ende-til-ende (login → onboarding trin 4; trin 4-verifikationsopkaldet fejler som forventet indtil staging-systemnummer findes — Twilio bekræftede ordret at subkontoen kun må ringe fra egne numre), rescue-stien virker, og prods `/config.js` svarer med prods egen ref. Ikke-trial-grenen + timestamp-guarden er bevist live (sub-0013: `subscription_created uden trial` → `invoice_settled` provisionerede → guard afviste gen-anvendelse). **Byggetrin 6-status: A-D ✓ · trial-provisionering ✓ · tilbage: E (varslinger, produktbeslutning m. Anne), F (valgfri IP-lås), checkout-vars (kodeopgave 3). PILOT-SPORET ER ÅBENT** — manuel provisionering på prod via drejebogen. Se "Udeståender" nederst.

*(Tidligere status 10/7: Skridt A-D FÆRDIGE + trial-provisionering bygget og røgtestet i staging, D-F bestået.)* Prod-toget for trin 6-koden + migrationer 2+3 er kørt; staging- og prod-dataoprydning gennemført. Trial-startskuddet (`subscription_created` → trial-tjek via API → samme provisionFirm) virker end-to-end: dead-letter ved tom pulje → nummer tilføjet → gensend → provisioneret ✓ · no-op-værn ved gensend af behandlet abonnement ✓ · ikke-trial-gren ✓. **10/7 afslørede desuden en tværgående rodårsag:** de statiske sider (onboarding/dashboard) havde HARDCODET prod-Supabase-config → staging-magic-links blev afvist som "udløbet" af prod-projektet. Fix: `/config.js`-mønsteret (app-config.js) — se lærdomme nedenfor. **Tilbage: config-fixet deployes (opskrift i docs/), E (varslinger — produktbeslutning m. Anne, scope udvidet igen 10/7), F (evt. IP-lås, valgfri), prod-tog for trial+config-koden.** Se "Udeståender — samlet overblik" nederst.

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

🔑 **Lærdomme 11/7-26 (prod-togsdagen):**
- **Prod-tog = PR på GitHub, ALDRIG lokalt merge+push:** `main` er PR-beskyttet (Del 0.A) — et lokalt `git merge staging` + `git push` afvises med GH013 "Changes must be made through a pull request". Køreplan: PR fra `staging` → `main` på GitHub → self-review af commit-listen → Merge → Railway deployer prod. Blev dit lokale merge afvist: `git reset --hard origin/main` (ufarligt — indholdet lever på staging). Samme klasse regel som "kun push-prod.ps1 må røre prod-migrationer": de farlige veje er spærret med vilje.
- **Navngiv Frisbii-planer efter egenskab** (fx `trial-14-dage` / `standard-uden-trial`): sub-0013 blev oprettet på en plan UDEN prøveperiode → detektionen sagde korrekt "uden trial", men det kostede detektivarbejde at se, at det var testopsætningen (ikke koden), der afveg. En rigtig kunde-trial SKAL ramme 🎁-grenen — planens handle er samtidig den, `FRISBII_PLAN_HANDLE` skal pege på (kodeopgave 3). ✅ **Efterlevet 5/8-26: `trial-30-dage` oprettet i BEGGE konti** (1.875,00 DKK/md, månedlig, 30 dages prøveperiode — Anne besluttede 30 frem for 14). Bekræftet i planlisten, at Prøveperiode-kolonnen faktisk siger `30 days`; den gamle staging-plan `test-abonement` havde kolonnen TOM, altså præcis `sub-0013`-fælden, synlig direkte i listen uden at åbne planen. **Samme handle i begge konti er et bevidst valg** — så skal forskellen mellem miljøerne ikke huskes. Det gamle prod-handle `test-2-lommekontor` er dermed ude af brug.
  ⚠️ **OMGJORT 8/8-26 — lærdommen gælder ikke længere som navnekonvention.** Planen er omdøbt til **`telefonpasser`**, fordi handlet skal navngive *produktet* og kunne stå side om side med tre andre add-ons (**D25**). Prisen er, at plannavnet ikke længere er trial-garantien: en tom Prøveperiode-kolonne kan ikke længere ses i planlisten. **Forsvaret er flyttet fra navnet til et tjek** — `check-env.js --live` læser prøveperiode-feltet og fejler, hvis det er tomt (**D26**). Det dækker bredere end navnet gjorde, fordi det også fanger en plan oprettet i UI'et med feltet glemt. Selve `sub-0013`-fælden ovenfor er uændret — kun værnet er skiftet.
- **Git-merge åbner en editor** (MERGE_MSG) ved ikke-fast-forward: gem+luk (VS Code: Ctrl+S, Ctrl+W / Vim: `:wq`) — eller giv beskeden direkte: `git merge X -m "..."`. Sæt evt. `git config --global core.editor "code --wait"`.
- **Untracked filer "bor" ikke på en gren:** de følger med ved checkout og vises ikke i checkout-outputtet (kun kendte M-filer gør). Først `git add` + commit binder dem til grenen.
- **M-listen er en statusrapport, ikke en indkøbsliste:** commits opdeles efter emne (config/scripts/docs), og en M-fil man ikke kan forklare, addes ikke før `git diff` er læst.

🔑 **Lærdomme 12/7-26 (SMS-dagen):**
- **SMS-økonomi er hård matematik:** 1 GSM-SMS = 160 tegn; over det: segmenter à 153 (betales pr. stk.) — og telefoner deler MIDT i URL'er, så linket knækker. ÉT tegn uden for GSM 03.38 (emoji, krøllet citationstegn, tankestreg) tvinger UCS-2: grænsen styrtdykker til 70. Regel: kundevendte SMS-skabeloner bor ÉT sted i koden, tegn-regnskabet køres ved hver ordlydsændring, og `gsmSegments`-vagten i onboarding.js logger ⚠️ ved regression. **Budget: fast tekst+link koster ~114 tegn → firmanavn + slug må TILSAMMEN fylde maks. 46 tegn** (produktbeslutning m. Anne: navnegrænse i onboarding eller kortere slugs).
- **Demo = nøjagtig kopi:** demo-SMS'en bygges af SAMME skabelonfunktion som kunde-SMS'en (to separate beskeder: forklaring + kopi) — så demo og virkelighed aldrig kan drive fra hinanden.
- **Formular-rutens anatomi:** `/:slug/:token` IGNORERER slug (kun kosmetik/maskering); tokenet slås op i `calls.lead_token` → miss = `next()` = "Cannot GET". Diagnose-rækkefølge: findes tokenet i calls? → virker fuldt link manuelt? → så er det LEVERINGEN (SMS-deling), ikke ruten.
- **Test i prod med det, der findes** — opret kun nyt i prod, når det ny-oprettede selv er formålet (som pilot-provisionering). Og: **`reset-test-data.js` er hermed FORBUDT mod prod for altid** (11/7 var sidste gang — den tog pilot #0 med sig). Prod-oprydning er kirurgisk: slet pr. eksplicit firma-id, jf. drejebogen.
- **Miljøskifte-ritualet er nu tooling:** `.\skift-prod.ps1` (kopiér .env.prod → `check-env-prod.js --live` skal ende grønt → lægger synlig `.ENV-ER-PROD`-markør i repo-roden) / `.\skift-staging.ps1` (spejlet; fjerner FØRST markøren når check-env.js har blåstemplet). check-env-prod dømmer via JWT-refs+roller — fanger også BLANDEDE profiler. Ret altid MASTER-filerne (.env.prod/.env.staging), aldrig .env direkte. Markøren + profilerne SKAL stå i .gitignore.
- **Rescue-mail ≠ velkomstmail (kodeopgave 8-evidens):** nyt-link-endpointet genbruger velkomstskabelonen ("din konto er klar", "færdiggør din opsætning") — forvirrende/skræmmende for en eksisterende kunde, der bare har glemt sit password. Fix: separat `sendLoginLinkMail`-skabelon (tekstforslag i overdragelses-oplægget). En af de hyppigste kundesituationer → skal løses før piloterne bruger produktet for alvor.

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
- ✅ **Første skive leveret 16/7 (før tid, ufarlig):** tidsmåling på onboarding-siderne — tabel `onboarding_sidevisninger` + `POST /onboarding/sidevisning` + keepalive-beacons (goTo/visibilitychange). Analyse-SQL i endpointet. Resten (dormant-detektion, ugentlig mail) udestår som planlagt.

---

## Deploy-tjekliste (kopiér denne pr. release)

```
[ ] Migration testet på staging
[ ] `npm run smoke` grøn på staging
[ ] Røgtest grøn på staging (bekendt har ringet, lead landede)
[ ] Merged til main
[ ] Vi er i deploy-vinduet (uden for arbejdstid) — eller det er en hotfix
[ ] Migration kørt på prod
[ ] sw.js cache-version bumpet
[ ] Health-check grøn
[ ] `npm run smoke:prod` grøn
[ ] Opstartsblokken i prod-loggen viser PROD's Supabase-ref
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

- **Ann** — backend, infra, migrationer, prod-deploys og rollback.
- **Anne** — produktplan, kundevendt site, onboarding-UI, indhold og QA/røgtest. Kan trigge deploys, ikke prod-secrets.
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

## Rollback på Railway (D4)

*Skrevet 2/8-26 under første øvelse. Gentages hvert kvartal sammen med gendannelsesøvelsen.*

### Fire ting du skal vide, før du trykker

**1. Rollback er ikke det samme som Redeploy.** Menuen (tre prikker på en deploy i historikken) har begge. **Redeploy** kører den valgte deploy op som en NY deploy med de NUVÆRENDE variabler. **Rollback** vender tilbage til den valgte deploy som helhed. Ved en hændelse: **Rollback**.

⚠️ **Menuen er kontekstafhængig.** På den deploy, du forlod, kan du *Redeploy*. På den, du står på nu, kan du *Rollback*. Vejen tilbage hedder altså ikke det samme som vejen frem — led ikke efter det forkerte ord under pres.

**2. Variabler ruller MED.** Railway genskaber både build og de brugerdefinerede variabler under en rollback — det står i bekræftelsesdialogen: *"This will restore both the build and variables."* Det betyder: har du rettet en variabel EFTER den deploy, du ruller tilbage til, forsvinder rettelsen uden varsel og uden fejlmeddelelse.
- Har du roteret en nøgle siden da: **tjek Variables-fanen umiddelbart efter rollbacken.**

**3. Databasen ruller IKKE med.** Rollback rører kun Railway. Supabase står, som den stod. Var der en migration med i den deploy, du forlader, kører gammel kode nu mod nyt skema. Se D10 — afklar altid, om der er en migration i spil, FØR du trykker.

**4. Git og Railway er uenige bagefter.** Skyen kører gammel kode, repoet har den nye. **Næste push genindfører fejlen.** Rollback er en pause, ikke en rettelse — næste skridt er altid at revertere commit'en i git eller fikse fremad.

**Holdbarhedsdato:** deploys ældre end Railways opbevaringspolitik kan ikke rulles tilbage — så vises Rollback slet ikke i menuen. Rollback-vejen rækker kun så langt.

### Fremgangsmåde

0. **Er der en migration i den deploy, du forlader?** `git log --oneline -- supabase/migrations`
   Er der det: rollback løser kun halvdelen. Læs punkt 3 igen.
1. **Notér den aktive deploy:** navn + commit-SHA.
2. `.\skift-staging.ps1` (eller prod-modstykket), derefter `npm run smoke` — **skal være grøn.**
   Det er nulpunktet. Uden det kan du ikke afgøre, om rollbacken hjalp. Notér klokkeslæt.
3. Tre prikker på deployen under den aktive → **Rollback**. Bekræft dialogen. Notér klokkeslæt.
4. Følg deploy-loggen, til status er ACTIVE. Regn med ca. 1 min — rollback er ikke hurtigere end en almindelig deploy, Railway rejser en container op på ny.
5. `npm run smoke` igen. Notér resultat og klokkeslæt.
6. Bekræft i Railway, at den aktive deploy nu er den gamle.
7. **Tjek Variables-fanen**, hvis noget er roteret siden. Se punkt 2.
8. **Beslut:** revertér commit'en i git, eller fiks fremad. Rollbacken står, indtil du gør det.

### Tilbage til nyeste (efter en øvelse)

**Brug Redeploy på den deploy, du forlod.** Tre prikker → *Redeploy*. Den tager præcis den deploy, du peger på, uafhængigt af branches. Verificér bagefter med `npm run smoke` og et kig på Variables-fanen.

⚠️ **Brug IKKE "Deploy latest commit" (Ctrl+K) til dette.** Den deployer nyeste commit fra **default-branchen i GitHub — altså `main`** — uanset hvilket miljø du står i. Står du i staging, kan du dermed komme til at deploye `main` til staging. Kommandoen findes, men den er ikke vejen tilbage efter en øvelse.

*(Ctrl+K åbner i øvrigt en kommandopalette, ikke deploy-listen direkte — "Deployments" i paletten fører derhen.)*

### Hvad en grøn smoke beviser — og hvad den ikke gør

Ved en øvelse, hvor gammel og ny deploy indeholder samme kørende kode, beviser grøn smoke bagefter **ikke**, at rollbacken virkede. Den beviser, at rollbacken ikke brækkede noget, og at nedetiden var kort nok. Den dag det gælder, er signalet et andet: **rød før, grøn efter.**

### D10 — kan migrationerne rulles tilbage? (afklaret 2/8-26)

**Rollback flytter koden tilbage. Skemaet bliver, hvor det er.** Spørgsmålet er derfor ikke, om migrationen kan rulles tilbage, men: *kan den gamle kode leve med det nye skema?*

**Tilføjende ændringer — ufarlige.** Ny tabel, ny kolonne der er nullable eller har `default`, nyt indeks, RLS på en ny tabel. Gammel kode kender dem ikke og rører dem ikke.

**Indsnævrende ændringer — farlige:**

| Ændring | Hvad der sker efter rollback |
|---|---|
| Kolonne omdøbt eller slettet | Gammel kode skriver til et navn, der ikke findes → fejl ved hver skrivning |
| `not null` UDEN default | Gammel kode indsætter uden feltet → alle inserts afvises |
| `unique` på en EKSISTERENDE tabel | Gammel kode indsætter en dublet, den før havde lov til → afvist |
| Datatype ændret | Gammel kode sender gammelt format → afvist, eller konverteret forkert |
| RLS strammet på en EKSISTERENDE tabel | Gammel kode får tomme svar. **Ingen fejl — bare ingenting** |

Den sidste er den ubehagelige: de fire første larmer, den femte er tavs.

**Status 2/8-26: rollback-vejen er HEL.** Alle seks migrationer er gennemgået — ingen `drop`, `rename` eller `alter column`. Alle `not null` står enten i `create table` på nye tabeller eller har `default`. De unikke indekser sidder på nye tabeller. Kode kan rulles tilbage forbi enhver af dem.

⚠️ **Planlagt undtagelse:** `20260727065655_kunder_og_opgavelag.sql` linje 134 noterer, at `firm_id` gøres `not null` i en **senere migration**. Den dag den køres, er rollback-vejen brudt på det punkt. Behandl den som indsnævrende, og noter i logbogen nedenfor, hvornår den lander.

### Reglen: tilføj først, fjern senere

Gælder alle fremtidige migrationer, og bliver vigtig når tilbudsmodulet ændrer skemaet for alvor.

1. **Nye kolonner er nullable eller har `default`.** Aldrig `not null` uden default på en eksisterende tabel.
2. **Omdøb aldrig.** Tilføj den nye kolonne, skriv til begge, fjern den gamle i en senere migration — efter den nye kode har kørt i produktion et stykke tid.
3. **Stram først, når koden er ude.** Indsnævringer (`not null`, `unique`, strammere RLS) hører til i en migration for sig, kørt EFTER den kode, der overholder dem, har været i drift.
4. **Skriv én linje øverst i hver migrationsfil:** `-- rollback-sikker: ja` eller `-- rollback-sikker: nej, fordi ...`. Så skal vurderingen ikke laves om kl. 22.
5. **Tjek altid punkt 0 i fremgangsmåden**, før du ruller tilbage: er der en migration i den deploy, du forlader?

### Øvelseslog

| Dato | Miljø | Fra → til | Nedetid | Smoke før | Smoke efter | Udført af |
|---|---|---|---|---|---|---|
| 2/8-26 | staging | risikoregister mm (f1002fdc) → test af branch-beskyttelse | ca. 1 min (rollback 09:41) | grøn 09:37 | grøn | Ann, med hjælp |
| 2/8-26 | staging | test af branch-beskyttelse → risikoregister mm (f1002fdc) | ca. 1 min (redeploy 10:05) | grøn | grøn, variabler OK | Ann, alene efter runbogen |

**Erfaring 2/8-26:** begge øvelser forløb uden overraskelser. Det ikke-afklarede er stadig D10 — der var ingen migration i spil, så rollback-vejens halve længde ved skemaændringer er ikke afprøvet.

---

## Miljøvariabler — to kilder, én sandhed (D16)

*Skrevet 2/8-26 efter første afstemning. Oprydningen selv står i `docs/D16-variabeloprydning.md`.*

### Sandheden bor i Railway

Produktionsvariabler har hidtil været tastet manuelt **to** steder: i Railway og i `.env.prod`. Railway er det, appen faktisk kører på. `.env.prod` er en kopi — og en kopi af ukendt friskhed, som de lokale scripts læser, når de kører mod prod.

**Regel: afvigelser rettes altid i filen, aldrig i Railway.** Målet er, at `.env.prod` en dag genereres fra Railway og aldrig tastes.

### ⚠️ To uafhængige miljøkontakter

Der er **to** kontakter på maskinen, og de kender ikke hinanden:

| Kontakt | Styrer | Tjekkes med |
|---|---|---|
| `skift-staging.ps1` / `skift-prod.ps1` | hvad `.env` beskriver — altså hvad Node-scripts taler med | `Get-FileHash .env, .env.staging, .env.prod -Algorithm SHA256` |
| Railway CLI's link | hvad `railway`-kommandoer rammer | `railway status` |

**2/8-26 pegede `.env` på staging, mens CLI-linket pegede på production.** Der skete ikke noget, men `railway run` ville have kørt mod prod, mens alt andet sagde staging.

**Tjek altid `railway status`, før du kører en `railway`-kommando — eller angiv `--environment` eksplicit.** Se D20 i registret.

### ⚠️ CLI'en udskriver rå værdier

`railway variable list` viser værdierne i klartekst, og **både `--json` og `--kv` gør det samme** — CLI'ens egen hjælpetekst advarer om det. Der findes ikke et flag, der kun giver navne.

**Kør den derfor aldrig løst i terminalen med prod-miljøet.** Værdierne lander i scrollback og potentielt i PowerShell-historikken.

### Afstemning: `afstem-railway-env.js`

Read-only. Skriver intet. Udskriver **kun variabelnavne og et match/mismatch-flag** — aldrig værdier, og heller ikke hashes (en hash af `NODE_ENV=production` kan gættes). Sammenligningen sker internt på SHA-256.

```powershell
node afstem-railway-env.js --environment staging --file .env.staging
node afstem-railway-env.js --environment production --file .env.prod
```

`--environment` har med vilje **ingen standardværdi** og skal angives. Scriptet arver aldrig CLI-linket. Ukendte flag afvises. Exit 0 = ingen **uforklarede** afvigelser, 1 = uforklarede afvigelser eller en forældet undtagelse, 2 = fejl.

Outputtet indeholder ingen hemmeligheder og kan trygt deles.

**Kadence:** kør den før enhver produktionsdeploy, der rører variabler, og som fast punkt i den kvartalsvise runde sammen med rollback- og gendannelsesøvelsen.

### Bevidste forskelle (indført 5/8-26)

**Målet er ikke "0 afvigelser" — det er "0 uforklarede afvigelser."** Filen og Railway forsyner to forskellige ting: filen forsyner de lokale scripts, Railway forsyner appen. Overlappet er stort, men mængderne er ikke ens, og det er med vilje. Tabellen `BEVIDSTE_FORSKELLE` øverst i `afstem-railway-env.js` bærer undtagelserne, og begrundelsen **printes ved hver kørsel** — så den ikke skal huskes eller slås op.

| Variabel | Type | Miljøer | Hvorfor |
|---|---|---|---|
| `VOICE_URL` | kun i filen | begge | Læses kun af `buy-numbers`, `configure-number`, `afstem-numre`, `check-env`. Appen rører den ikke |
| `TWILIO_ADDRESS_SID` | kun i filen | begge | Læses kun af `buy-numbers.js`. Efter nummer-hændelsen er det en fordel, at den kun findes, hvor indkøbsscriptet kører |
| `SIMPLY_ACCOUNT` | kun i filen | begge | Læses kun af `simply-dns-add.js` |
| `MAIL_OVERRIDE_TO` | kun i filen | **kun production** | Prod skal maile rigtige kunder. I filen som lokal sikkerhedsventil. ⚠️ I **staging** skal den findes BEGGE steder — mangler den dér, er mailmuren nede, og det er en ægte afvigelse |

To ting gør tabellen sikker frem for bekvem. **Undtagelsen er bundet til afvigelsestypen:** `VOICE_URL` er undtaget som "kun i filen" — dukker den op i Railway med en forkert værdi, er den ikke undskyldt. Og **en undtagelse, der ikke længere dækker noget, gør kørslen rød** (`FORAELDEDE_UNDTAGELSER_ER_FEJL`), fordi en liste over undtagelser, der ikke selv ryddes op, ender med at undskylde fremtidige fejl. Rettelsen er at slette linjen.

Verificeret 5/8-26 mod ni testtilfælde, herunder at `MAIL_OVERRIDE_TO` **ikke** undtages i staging.

### Afstemningslog

| Dato | Miljø | Ens | Afviger | Kun i Railway | Kun i filen | Bevidste | Bemærkning |
|---|---|---|---|---|---|---|---|
| 2/8-26 | staging | 21 | 2 | 3 | 4 | — | Første måling. `admin_email` vs. `ADMIN_EMAIL` er en reel defekt |
| 2/8-26 | production | 21 | 1 | 2 | 5 | — | Fire variabler koden læser mangler helt i Railway |
| 5/8-26 | staging | 28 | **0** | **0** | **0** | 3 | ✅ Oprydning gennemført |
| 5/8-26 | production | 27 | **0** | **0** | **0** | 4 | ✅ Oprydning gennemført. Kun fil-siden rørt — ingen deploy udløst |

**Hvad oprydningen 5/8 bestod af** (alt sammen fil-siden; Railway blev ikke rørt, og der blev derfor ikke udløst nogen deploy):

- `admin_email` → `ADMIN_EMAIL` i begge filer. Versalfølsom defekt: koden fik `undefined` lokalt uden fejlmeddelelse. Fjernede to afvigelser pr. miljø på én gang
- `OPKALD_SIGNATUR` og `TILBUD_AKTIV` tilføjet i begge filer. Førstnævnte betød, at en lokal kørsel faldt tilbage til standarden `log`, altså en anden opførsel end appen kører med
- `ELEVENLABS_VOICE_IDM` rettet i begge filer → udløser efterkontrol af stemmefilerne, se nedenfor
- `SIMPLY_ACCOUNT`, `TWILIO_ADDRESS_SID`, `VOICE_URL` **beholdt i filerne og IKKE tilføjet i Railway.** Arbejdsdokumentets trin 2d/3d påstod, at alle fire læses af appen; `Select-String` over alle `.js` viste, at ingen af dem gør. De blev til bevidste forskelle i stedet
- `FRISBII_PRIVATE_KEY` i `.env.staging` pegede på den **ubrugte** konto `oprettelse-og-abonnement` i stedet for `lommekontor`. Se lærdommen nedenfor

⚠️ **Udestående efter oprydningen: stemmefilerne.** `ELEVENLABS_VOICE_IDM` afveg i **begge** miljøer, og regenereringsscriptet læser `.env`. De mandlige greeting-filer kan derfor være renderet med det gamle ID — samme fejl som tidligere: lydfiler ude af sync med stemme-ID'erne. Kontrollér prod-Storage og **lyt til én fil**, ikke bare sammenlign ID'er.

🔑 **Lærdom 5/8-26 — et tjek, der siger sandheden, kan stadig læses baglæns.** `check-env.js --live` meldte `❌ Frisbii: noeglen hoerer til STAGING-kontoen — handle="oprettelse-og-abonnement"`. Meldingen var korrekt: nøglen hørte IKKE til staging. Men navnet var formuleret som en påstand, så den røde linje læste som en konstatering af noget rigtigt, og konklusionen blev vendt om — først blev en nøgle udskiftet unødigt, derefter blev både kontotabellen her og konstanten i scriptet "rettet" til noget forkert. **Fix:** tjekket hedder nu `Frisbii: hvilken konto hoerer noeglen til?` og skriver både det fundne og det forventede. Samme rettelse i Twilio-tjekket. **Regel: et tjeks navn skal være et spørgsmål eller en observation, aldrig en påstand om det ønskede — ellers giver en rød linje mening baglæns.**

**Sådan afgøres hvilken Frisbii-konto der er hvilken:** aflæs **webhooks pr. konto**. Kontoen med en webhook mod staging-URL'en *er* staging. Hostede sider, planlister og kontonavne siger intet om, hvad koden peger på. Bekræftet 5/8: `lommekontor` og `test-2-lommekontor_test` har webhooks; `oprettelse-og-abonnement` og LIVE-kontoen har ingen.


**Værktøjsversion:** Railway CLI 4.61.1 (nyeste er v5.x, hvor kommandoen hedder `railway variable list` i stedet for `railway variables`). Opgraderes som en bevidst opgave — `afstem-railway-env.js` skal testes bagefter.

---

## Udeståender — samlet overblik (pr. 19/7-26)

*Én autoritativ liste. Når et punkt løses: flyt det til den relevante sektions ✅-historik og slet det her.*

### 🚂 Klar til at køre NU
1. **Pilot-rekruttering af rigtige håndværkere** — exit-kriteriet (Annes fulde gennemløb) er opfyldt 14-15/7. Anne ejer formular/kommunikation (drejebog i docs/); teknisk forudsætning: tjek prod-nummerpuljen (infrastruktur-punkt 2) FØR første pilot provisioneres.
2. Frisbii staging-oprydning: expire trial-testabonnementerne + omdøb planerne efter egenskab (lærdomme 11/7).
3. **PWA slet+geninstallér på begge iPhones** (hjemmeskærms-ikonet er et installations-øjebliksbillede — fane-ikoner klaret via ?v=2).
4. ✅ **Manifest-tjek (17/7, VERIFICERET 18/7):** `short_name` i manifest.json ER "Dit Kontor" — matcher ikon-labelen på onboardingens slutside. (Rationalet, hvis labelen nogensinde ændres: de to SKAL følges ad, ellers leder kunden efter en anden tekst end den, vi lige har vist dem.)

*(✅ Kørt 16-17/7: ONBOARDING-REDESIGN (Annes spec) i prod — én besked+handling pr. side, 150 ms crossfade, ✓-rytme + grønne kvitteringslinjer, stemme+besked sammenlagt, SVG-guide-mockups, hjemmeskærms-ikonkopi, hvidliste ude af flowet. init-hærdning: token_hash > gammel session (16/7-rodårsag), klar fejlskærm ved manglende firma, setText-værn. `/api/firma/opdater` returnerer nu `greeting_audio_url` (▶ Lyt, re-render kun ved ændring). Tidsmåling: migration `20260716090000_onboarding_sidevisninger` kørt staging+prod via push-scripts + `POST /onboarding/sidevisning` + keepalive-beacons. Dashboard: app-hilsen ved første standalone-åbning. REGRESSION fundet+rettet 17/7: slettet nummer-boks → TypeError i startFlow → alle så "Linket er udløbet" trods gyldigt login — lærdomme: fuldt id-tjek efter hvert redesign, localhost-demo skjuler klassen, tjek konsollen (og dens FILTER) før miljø-teorier. Detaljer: primerens NYESTE (16-17/7).)*
*(✅ Kørt 14-15/7: ADRESSE-SPORET LUKKET i prod (gren `fix/adrees-postnummer-by`, flere commits) — postnr/by forsvandt pga. (1) dobbelt-påklistring + accepterede DAWA-trædesten ved kilden og (2) modalens ét-komma-parse + genskrivning ved HVER lukning. Fix: `bygAdresse()`-chokepoint i server.js, `parseAddress()` (bagfra, dedupe) i dashboard, closeModal skriver kun ved ændring, DAWA-overhaul begge steder (resultat-baseret validering: adgangsadresse m. postnr = gyldig straks; `rens()` fjerner ", ,"; Ny opgave viser fuld adresse i feltet). Felter fjernet: "Hvornår passer det dig" (opret), Deadline + "Ønsket tidspunkt fra kunde" (rediger); mailfelt omdøbt "Mailadresse". Haster-persist-fixet 15/7 (`is_urgent` manglede i closeModal trods primer-påstand) + opfølger: haster-rækken gjort til ÉN kontakt (dobbelt-vip gjorde at krydset ikke kunne fjernes igen — checkbox nu pointer-events:none, label uden for=). Detaljer: primerens NYESTE (14-15/7). **ANNES PILOT-GENNEMLØB GRØNT: alle 4 punkter** (ægte opkald→lead, rescue-sti+puf, mobil+viderestillings-kort, onboarding på mobil) → pilot-rekruttering ublokeret.)*
*(✅ Kørt 13/7: HVID SKÆRM LØST — rodårsag: ukapslet `Notification.requestPermission()` på iOS Safari + SW-navigation-kapring/cache-forgiftning; fix: guard, script-flyt, fail-synligt boot m. fejl-overlay, sw v17 allowlist/network-first. Rescue-mail m. egen skabelon i prod (kodeopgave 8 ✅). Kodeskifte-puf (#nyt-login → banner → profilens pw-felt) i prod. Session-hærdning: død session → login i stedet for crash, SIGNED_OUT håndteret, 30-sek-poller sikret. Nye ikoner + ?v=2-buster + crossorigin på CDN-tag. Alt røgtestet i prod, inkl. Anne. Navne-sweep 1/3: runbook omdøbt til `ditdigitalekontor-drift-runbook.md` + primerens henvisninger opdateret — Frisbii-handles og historiske omtaler bevidst urørt, jf. APPSIGNAL-princippet. Aften: viderestillings-kort på profilsiden i prod — firmaets nummer + til/fra-koder m. Kopiér; løser "Anne mistede sit nummer". Profilsidens rækkefølge ændret: viderestilling nederst før Log ud.)*
*(✅ Kørt 12/7: SMS-fixet deployet + røgtestet i begge miljøer; staging-systemnummer etableret; prod gen-etableret m. testfirma + pilot #0.)*

### 🔧 Kodeopgaver (prioriteret)
1. **App-redningsvejens fælde (17/7; ✅ RØGTESTET 19/7 — næsten i mål):** Kernetest ✅ (kode tastet i den installerede app → inde, UDEN Safari-omvej), negativtest ✅ (link brugt først → koden fejler m. forklarende besked), rate-limit ✅. **Fund 19/7:** prod-OTP-længden er **8** (frontend gjort tolerant 6-10 + mellemrum strippes — feltet var først hårdkodet til 6). iOS' auto-forslag af koden over tastaturet udeblev KORREKT: det virker kun fra Apples egen Mail-app (og SMS) — Ann bruger Simply-webmail; kunder m. Apple Mail får bonussen automatisk, manuel indtastning er den normale vej for alle andre. **Finpudsning 19/7 (Anns spec):** i kodetilstand skjules adgangskode-felt + [Log ind], og statustekst + gensend-knap flyttes under kodefeltet; ✓-rytme på begge login-knapper ved succes. **OTP-længden sættes til 6 i BEGGE Supabase-projekter** (Auth → Sign In/Providers → Email → OTP Length; prod stod på 8 — frontend er tolerant 6-10, så indstillingen kan ændres frit). **⏳ SIDSTE GATE-PUNKT: (b)-testen — frisk onboarding på ægte iPhone, iOS gemmer koden på side 2, første app-login skal foreslå den fra nøgleringen. Derefter må prod-toget køre.** iPhone-appen deler IKKE lagring med Safari → første åbning fra ikonet = login-skærm. Glemmer kunden koden og trykker "Send mig et login-link" INDE i appen, åbner mail-linket i **Safari** — kunden logges ind i browseren og er tilbage hvor de kom fra. Inde i appen er adgangskoden i dag reelt eneste vej ind. **OBS: et klassisk "glemt kode"-reset via mail-link har SAMME fælde** (reset-linket åbner også i Safari) — det ender blot mindre blindt (kunden står med en ny kode, de kan taste i appen).
   - **(a) ✅ BYGGET — 6-cifret engangskode i appen:** `generateLink` returnerer allerede `email_otp` ud over `hashed_token`. Udvid rescue-mailen (`sendLoginLinkMail`) med koden ("Eller skriv denne kode i appen: 123456") + et kodefelt på dashboardets login-skærm → `verifyOtp({ email, token, type: 'email' })`. Kunden kommer ind **uden at forlade appen**. Ingen nye Supabase-features, egen Scaleway-mail, EU-princippet intakt. Anti-enumeration/rate-limit i `/onboarding/nyt-link` genbruges uændret. Filerne (mail.js, onboarding-link.js, dashboard.html) er hver især bagudkompatible — deploy-rækkefølge ligegyldig. **Røgtest (ægte iPhone, i den installerede app): bestil mail → koden foreslås over tastaturet fra Mail → [Log ind med koden] → inde. Test også at et allerede-åbnet link får koden til at fejle med den forklarende besked.**
   - **(b) ✅ BYGGET — autofyld (reducerer behovet for redning):** dashboardets login-felter skal have `autocomplete="email"` + `autocomplete="current-password"` (onboardingens kodefelt har `new-password` ✓ 16/7) → iOS-nøgleringen (som DELES på tværs af Safari og app, modsat localStorage) foreslår selv koden ved første app-login. Røgtest på ægte iPhone: kode sat i onboarding → installér → første app-login SKAL foreslå koden.
   - **(c) Senere, datadrevet:** parringskode direkte på Færdig-siden (auto-login i appen uden mail) — kun hvis tidsmålingen (`onboarding_sidevisninger`) viser frafald mellem s-11 og første app-login. Passkeys = fremtid (egen WebAuthn; ikke indbygget i Supabase).
   - **(d) FUND 19/7 (Anns skærmbillede): onboardingens "Linket er udløbet"-skærm mangler kodefeltet.** Skærmen bestiller en ny rescue-mail via samme `/onboarding/nyt-link` — og siden 17/7 indeholder den mail OGSÅ engangskoden ("skriv denne kode i appen") — men skærmen har intet sted at taste den: mailen lover noget, skærmen ikke kan indfri. I samme Safari er det "kun" forvirring (linket virker jo dér), men PÅ TVÆRS AF ENHEDER er det reelt: står udløbet-skærmen på computeren og læses mailen på telefonen, åbner linket på den forkerte enhed — koden ville logge ind præcis hvor kunden står. Fix: kopiér dashboardets kodetilstand (kodefelt frem efter bestilt mail + `verifyOtp({ email, token, type: 'email' })`) til udløbet-skærmen. **OBS ved implementering:** efter verifyOtp skal onboardingens init behandle sessionen som FRISK login (samme sti som link-login: aktive firmaer → dashboard, ellers genoptag flowet) — må ikke ramme "gammel session"-grenen fra 16/7-hærdningen (token_hash > gammel session). Røgtest: begge veje (link OG kode), cross-device (skærm på én enhed, kode fra mail på en anden), og at brugt link får koden til at fejle m. forklarende besked (delt engangstoken). **KRITISK 20/7 (Ann): løses FØR ALT ANDET, sammen med (e)** — tilsammen er de grunden til, at nye kunder ikke kan komme ind i appen: uden (e) ved kunden ikke, at appen skal installeres; uden (d) ender de, der prøver at logge ind, i en blindgyde på udløbet-siden. **BYGGET 20/7 — RØGTEST GRØN samme dag (Ann).** Kodespor på s-expired — feltet vises efter bestilt mail, ELLER via "Har du allerede en engangskode fra mailen?"-knappen (vigtigt: bestiller man ny mail, ugyldiggøres koden man står med — derfor må feltet kunne nås uden ny bestilling). `loginMedKode` kører frisk-login-stien eksplicit (sessionen fra verifyOtp direkte; aktiv → `/dashboard#nyt-login`, ellers `startFlow` m. firmadata — rører aldrig gammel localStorage-session). Røgtest: link-vej, kodevej samme enhed, cross-device, brugt link → kode fejler pænt, OG ny: ufærdig onboarding via kode → lander midt i flowet m. korrekt firmanavn/nummer.
   - **(e) NYE TRIN — PWA-installationsguide (Ann 20/7: KRITISK, løses FØR ALT ANDET sammen med (d) — nye kunder kan ikke komme ind i appen uden):** OPKLARET 20/7: guiden FANDTES allerede (s-8→s-11, 2 trin m. platformsdetektion og mockups) — men pilotobservationen viste, at den var FOR GROV: brugeren "fjumrede rundt", vidste ikke HVOR på skærmen han skulle kigge, og kunne ikke navigere efter +-ikonet. **OMBYGGET 20/7 — RØGTEST GRØN samme dag (Ann, eget device = iOS 26-rækken i matrixen). Åbent: ældre iPhone- og Android-rækkerne + Annes gennemsyn af de nye skærme.** 1) orientering ("Kig øverst/nederst på skærmen" — zonen fremhævet, resten dæmpet), 2) knappen (de oprindelige "Tryk her"-mockups, uændrede), 3) menuen folder sig ud (mock af udfoldet menu m. punktet fremhævet + "rul ned"-hint), 4) Tilføj-dialogen (stort umisforståeligt tryk-mål). Skærmkæde: s-8→s-9→s-9b→s-10→s-10b→s-11; BACK_TARGET og "Prøv igen"-vejen fra s-11 følger med. **UDVIDET SAMME DAG (Anns skærmdumps):** hendes iPhone kører det NYE Safari (iOS 26, Liquid Glass) hvor kompakt layout er STANDARD: bundlinjen er ‹ › [adressefelt] ⋯ — del-ikonet er væk, alt bor bag de tre prikker, og "Føj til hjemmeskærm" nås via ⋯ → **Del** → delarket (BEKRÆFTET af dumps: ⋯-menuen indeholder Del/Føj til bogmærker/Ny fane — IKKE Føj til hjemmeskærm direkte). Guiden er derfor VERSIONSFORGRENET via UA (`OS 26_`+ → 5 trin m. ekstra "Tryk på Del"-skærm (s-9c) og nye ⋯-mockups; ældre iOS → de 4 trin m. del-ikonet; Android uændret). Trin-numre og bagud-pile følger varianten dynamisk. Delark-mockuppens rækker matcher det ÆGTE danske delark fra dumpet (Føj til favoritter / Find på side / Føj til hjemmeskærm). OBS: brugere der manuelt har valgt klassisk layout i Safari-indstillinger ser gammel bundlinje men får 5-trins-guiden — acceptabel kant (de er magtbrugere). Piloten der fejlede kan have været NYT Safari, ikke Android — "tre prikker ved urlen" findes begge steder. **Røgtestmatrix: iPhone m. iOS 26 (5 trin), ældre iPhone (4 trin), Android (4 trin) — hele vejen til appen ligger på hjemmeskærmen.** Tilføjet 20/7 (Anns ønske): fælles overskrift på alle guidens trin — "Læg appen på din telefon · Trin X af Y".
   - **(f) Foreslået telefonbesked skal synkroniseres:** dashboardets forslag ændret 20/7 til Anns nye tekst ("Hej, du har ringet til [Firmanavn]. Jeg kan desværre ikke tage telefonen lige nu. Om et øjeblik modtager du en SMS, hvor du nemt kan beskrive din opgave. Jeg vender tilbage hurtigst muligt."). Onboardingens forslag/default skal følge med, ellers møder kunden to forskellige forslag. **DELVIST GJORT 20/7:** onboarding.html's `defaultGreeting` er synket til Anns tekst. **TILBAGE:** serverens evt. default ved provisionering/TTS-prerender — grep repoet efter den gamle tekst ("Tak for din henvendelse" / "Hansens VVS" / "du får straks en SMS") og synk fundne steder.
2. **Dublet-emails** (FØR go-live, blokerer ikke test): genbrug-eller-afvis ved eksisterende email i provisioneringen — produktbeslutning m. Anne. Indtil da: manuelt tjek jf. pilot-drejebog. *(Byg-trin 6, fundet 8/7; falsk alarm 10/7 var en tastefejls-email.)*
3. **Trin 6 E — varslinger** (produktbeslutning m. Anne, scope udvidet 10/7): (a) "vi er på sagen"-mail ved strandet provisionering (VIGTIGST — kunden har betalt og hører i dag INTET), (b) dunning-varsling/grace, (c) retention-alarm til os ved cancel, (d) **NY 10/7:** detektion af uleveret velkomstmail/aldrig-logget-ind (tastefejls-email → kunde med service men uden adgang).
4. **Checkout-vars + kunde-broen** — ~~indholdet stod her~~. **Flyttet til risikoregistret som Ø5 (4/8-26).** Runbogen ejer ikke udestående-lister (jf. rollefordelingen i registret), og punktet dublerede Ø5. Nummeret er bevaret med vilje, fordi andre punkter henviser til listen efter nummer. **Status og rækkefølge: se Ø5.** Fremgangsmåden ejes af Frisbii-lærdom 7 ovenfor — bemærk at den er rettet: endpointet er aldrig monteret, så det svarer 404 og ikke 500.
5. **Dead-letter-cron** (m. trin 7 overvågning): dagligt tjek af `processed_at is null` ældre end 1 time → sendAdminAlert. *(Del 0.F TODO.)*
6. `firms.phone_number` **unique-constraint** (kendt udskudt skema-skævhed — dagens medfødte `frisbii_subscription`-constraint dækker KUN samme-abonnement-racet, ikke to forskellige abonnementer der vælger samme pulje-nummer) + `created_at` på firms. *(Bonus-oprydning ved lejlighed: redundant `idx_firms_frisbii_sub` + legacy `firms_shopify_order_id_key`.)*
7. **check-env.js:** validér også `TWILIO_SYSTEM_NUMBER` + `VOICE_URL` + `SUPABASE_ANON_KEY` (navnedrift/manglende nøgler fanget 10/7).
8. **Trin 6 F** (valgfri hærdning): IP-lås/Basic Auth på webhook-endpointet.
9. **Win-back-polish:** venlig TwiML-besked på karantæne-numre. *(Rescue-mail-delen ✅ 13/7: egen `sendLoginLinkMail`, rate-limit/anti-enumeration bevaret.)*
10. **SMS-navnebudget** (m. Anne): firmanavn + slug ≤ 46 tegn tilsammen — håndhæves i onboarding trin 1 (navnegrænse) eller via kortere slugs. Vagten logger ⚠️ indtil da.
12. **Privatlivs-eftersyn af logs (GDPR — DELVIST GJORT 31/7):** **LEVERET 31/7 i `onboarding.js`:** `maskerTlf()`-hjælper indført og anvendt seks steder (opkald modtaget, intet firma fundet, demo-SMS, hvidliste, firma oprettet) — telefonnumre på kundens kunder står ikke længere i klartekst i Railway-loggen. Samtidig fjernet: `SMS link:`-linjen der udstillede `lead_token` — **tokenet ER adgangskontrollen til opgaveformularen**, og alle med Railway-adgang kunne åbne kundens formular; erstattet af `firma-id + call-id`, som man reelt fejlsøger på (og som er en nøgle til MERE information, ikke mindre). **(a) TILBAGE — maskeringen er for grov:** `maskerTlf()` skjuler de sidste fire tegn uanset længde, så et dansk `+4530518313` bliver til `+453051****` — halvdelen af abonnentnummeret står stadig. Stram til landekode + de to første cifre (`+4530******`). Én funktion, ét sted, ingen kaldesteder skal røres. **(b) TILBAGE — `onboarding-link.js` logger fulde mailadresser** ("Nyt login-link sendt til: …" / "anmodet for ukendt email: …"). Samme behandling: maskér (`an***@firma.dk`) eller udelad. Grep efter `email` ved console-kald — mønstret findes formentlig flere steder. **(c) TILBAGE — VERIFICÉR at persondata ikke flyder fra Railway til AppSignal:** Ann har ikke SET det ske, men det skal EFTERSES aktivt — tjek fejlrapporternes payloads/breadcrumbs (request-parametre, headers) og `appsignal.cjs` for filtrering (`requestHeaders`/param-filtre). AppSignal er EU (NL), men dataminimering gælder stadig. Railway gemmer logs i klartekst, og de er ikke omfattet af RLS eller sletning.
11. **Fejl-overlayet (dashboard.html) dæmpes/afmonteres, når piloten er stabil** (indført 13/7 som diagnoseværktøj — viser ALLE ufangede fejl, også godartede; muligt mellemtrin: ignorér kendte godartede supabase-baggrundsfejl). Hertil UAFKLARET, lav prioritet: sporadisk "Script error." på iPhone (dashboard virker; kommer og går) — afventer gentagelse med crossorigin aktiv → ægte fejltekst → dom.
13. **Vis/Skjul-knap på login-skærmens adgangskodefelt (lav prioritet — tag den med i dashboard-restylingens senere trin):** onboardingens kodefelt (s-2) har en Vis/Skjul-knap (`.toggle-eye` + `togglePw()`); dashboardets login-felt har ingen. Kopiér mønsteret 1:1 fra onboarding.html (~10 linjer: knap inde i feltet + toggle af `input.type` password/text + tekstskift Vis/Skjul). Bevidst IKKE med i login-restylingen 19/7 (ren visuel leverance — ny JS kræver aftale, derfor dette punkt). **OBS ved implementering:** (1) kodetilstanden fra 19/7 skjuler hele adgangskodefeltet via `closest('.lfield')` — øje-knappen skal bo INDE i `.lfield`-wrapperen, så den automatisk følger med når feltet skjules (`.lfield` er dermed bærende i JS, ikke kun styling — må ikke omdøbes); (2) knappen må ikke stjæle `flex: 1` fra inputtet (onboardingens `.toggle-eye` er mønstret); (3) fuldt id-tjek efter ændringen (17/7-QA-reglen) + røgtest med rigtigt login.

14. **Billedupload fra dashboardet blev ALDRIG wiret (fund 20/7, Anns test):** upload-UI'et fandtes i begge modaler, men `saveNewLead` læste aldrig filfeltet (ingen onchange), og `closeModal` uploadede intet — `addPreviews` viste kun LOKALE object-URL-forhåndsvisninger, så det LIGNEDE at billeder blev gemt, indtil genåbning viste serverens sandhed (tom). Kundens formular-billeder virker (den vej er bygget server-side). **Værn deployet 20/7 (Anns beslutning):** upload-UI skjult i begge modaler (`display:none` — elementerne SKAL blive i DOM'en: openModal rydder `#modal-previews` betingelsesløst, sletning = TypeError for alle, 17/7-fejlklassen); edit-modalens billedfelt skjuler sig selv helt uden kundebilleder (`:has()`, iOS 15.4+, ren kosmetik ved ældre browsere). **Byg (når prioriteret):** server-endpoint (fx `POST /opgave-billeder`, multipart) der uploader m. servicenøglen til privat `lead-images`-bucket under firmaets sti + indsætter `lead_images`-rækker — samme mønster som `/opret-opgave` (bevidst uden om RLS) og kundens formular-vej. Størrelse-/typegrænser. Ny opgave uploader EFTER oprettelsen (lead-id skal findes først). Wire `new-file-in` (onchange mangler helt) + upload i closeModal/gem-knap. Fjern display:none igen + røgtest begge modaler m. genåbning (det var genåbnings-tjekket, der afslørede fejlen). *(Samme leverance 20/7: haster-badgen fjernet fra opgavelisten — den røde streg bærer signalet alene (Anns beslutning); badge-CSS'en står tilbage ubrugt, genindsættes m. én linje i renderLeads hvis ønsket.)*

15. **Statistikfelt øverst på profilsiden (Ann 20/7):** antal **håndterede opkald** og antal **oprettede opgaver**, opgjort for seneste uge og seneste måned. Data findes allerede (`calls` + `leads` pr. firm_id m. created_at; RLS tillader firmaets egne rækker) → enten fire count-forespørgsler client-side (`select('*', { count: 'exact', head: true })` m. `gte`-datofilter) eller ét samlet server-endpoint. Design: rolig talrække i profilheaderen i onboarding-sproget (tal i ink, etiketter i muted — ingen kort/rammer). **AFKLAR M. ANNE FØRST:** definitionen af "håndterede opkald" (alle indgående? kun ubesvarede, der udløste SMS?) og om uge/måned er rullende 7/30 dage eller kalenderuge/-måned — tallene skal kunne forsvares over for kunden.

16. **Egen stemme som telefonbesked (Ann 20/7 — bevidst nederst på listen):** kunden kan indtale/uploade sin EGEN stemme i stedet for TTS. Arkitekturen bærer det langt: beskeden afspilles i dag som præ-renderet lydfil (ElevenLabs genereret ved gem) — egen stemme er samme afspilningssti, blot med kundens fil. Skitse: optag i browseren (MediaRecorder, kræver HTTPS ✓) el. filupload → server-endpoint validerer/konverterer (iOS optager m4a/aac; Twilio `<Play>` vil have mp3/wav → ffmpeg server-side el. accepter kun spilbare formater; længde-/størrelsesgrænser) → samme storage-sti som TTS-filerne → firmaets greeting-kilde peger på den. UI: tredje valgmulighed under stemmevalget ("Din egen stemme") + optag/lyt igen/gem-flow (UX m. Anne).

17. **Stemmeprøverne matcher ikke serverens stemmer (fund 20/7, Anns test — kundevendt kvalitet, tag den i onboarding-runden):** stemmekortenes "▶ Lyt" (onboarding s-3) OG dashboardets "▶ Afspil stemme" (profil) afspiller FASTE demoklip fra Storage (`greetings/_samples/female.mp3` / `male.mp3`), mens "▶ Lyt til beskeden" renderer LIVE via serveren (`/api/firma/opdater` → ElevenLabs). Serverens mande-stemme-ID er ikke længere den, demoklippet blev lavet med → kortet lover én stemme, telefonsvareren leverer en anden. **Anns afgørelse: besked-stemmen (serverens) er den rigtige — det er demoklippene, der skal genindspilles.** Opskrift: (1) find serverens stemme-ID'er + model/indstillinger i server.js/env (klippene SKAL genereres med præcis samme indstillinger som serverens render, ellers lyver kortet stadig i klang), (2) generér nye female.mp3 + male.mp3 via ElevenLabs (behold evt. samme manuskript som de nuværende klip), (3) upload til `greetings/_samples/` i BÅDE staging og prod, (4) cache-bust: bump `?v=2` → `?v=3` i onboarding.html (SAMPLE_URL) og dashboard.html (GREETING_SAMPLE_URL), (5) røgtest: kort-Lyt og besked-Lyt skal nu være samme stemme for begge køn. TJEK OGSÅ kvindestemmen — kun manden er bekræftet afvigende. **SCRIPT LEVERET 20/7:** `regenerate-voice-samples.js` (lægges i repo-roden ved siden af tts.js) — genbruger serverens egen `renderTTS`, så stemme-ID/model/indstillinger er identiske pr. konstruktion. Tørkørsel som standard (printer mål-miljøet), skriver kun med `--bekraeft`. Kør staging → prod FØR frontend-deploy; v=3 er allerede bumpet i leverede onboarding.html + dashboard.html (favicon-v=2 er urørt — de er urelaterede). Manuskript besluttet af Ann 20/7 ("Hej. Tak fordi du har ringet. Jeg kan ikke tage telefonen lige nu. Du modtager en SMS, hvor du kan beskrive din opgave.") — bevidst i familie med standardbeskeden, så prøven lyder som produktet. Konstant øverst i scriptet; Annes blik inden prod-kørsel. **OBS tredje stemmelag:** fallback ved manglende lydfil er Amazon Polly (Naja/Mads via Twilio `<Say>`) — en TREDJE klang. Røgtesten bør omfatte et opkald uden renderet fil, så alle tre lag er hørt bevidst.

18. **Opkaldsadfærd-læring umiddelbart efter onboarding (Ann 20/7 — tolkning BEKRÆFTET af Ann samme dag):** kunden skal lære, hvad de skal gøre med et opkald, de ikke kan tage: **LAD TELEFONEN RINGE** — viderestillingen tager først over efter ca. 20-30 sekunder. Tryk IKKE på afvis (rød knap), tag den ikke for at lægge på, og teleselskabets egen telefonsvarer må ikke snuppe opkaldet før viderestillingen (afvisning/telefonsvarer kan sende kalderen i den forkerte "postkasse", og så bliver opkaldet aldrig til en opgave). Placering: info-skærm/side umiddelbart efter onboardingens Færdig-trin og/eller øverst på Tips-siden i dashboardet. Anne ejer copy — kernen er én regel: "Kan du ikke tage den, så lad den ringe."

19. **Mere farve på dashboardet (Ann 20/7 — egen designrunde m. Anne):** (a) lille farvet initialcirkel ved navnene på opgavelisten — genbrug voice-avatar-mønstret fra profilens stemmekort (tint-cirkel, accent-initial, 36-40 px), (b) blød skygge under hver opgaveboks. **OBS — bevidst delvis tilbagerulning:** restylingens trin 3 (20/7) fjernede netop bokse/skygger til fordel for den flade, linjeadskilte liste (onboarding-sproget). Anns ønske efter at have SET den flade liste er mere visuel vægt — det er præcis den slags, man kun kan afgøre med øjnene, og hendes call. Forslag der bevarer roen: kort m. radius 14, 1px --line-kant, skygge `0 6px 16px rgba(22,35,47,.06)` (dæmpet, ikke 16/7-æraens tunge løft), initialcirkler som farveanker. Anne (design-ejer) skal med på afvejningen flade vs. kort, så dashboard og onboarding stadig føles som ét produkt.

20. **Adressefelterne fra DAWA skal faktisk SKRIVES (27/7 — migrationen er kørt, kolonnerne er tomme):** migration `..._leads_adressefelter` gav `leads` (og den nye `kunder`) strukturerede felter — `vejnavn`, `husnr`, `etage`, `doer`, `postnr`, `by`, `dawa_id` — men de udfyldes ikke af sig selv. De tre steder hvor `initDawa()` allerede kører, HAR det strukturerede DAWA-svar i hånden og smider det væk til fordel for én streng: kundeformularen i `server.js` (`bygAdresse()`-chokepointet), "Ny opgave"-modalen og "Rediger lead"-modalen i `dashboard.html`. **Formålet er at afskaffe komma-parsing permanent** — det var rodårsagen bag 14-15/7-adressesporet; `parseAddress()` (bagfra, dedupe) er et symptomfix, ikke en kur, og den knækker igen første gang en adresse har ét komma mere end forventet. Efter denne opgave: `address` bevares som visningsstreng, postnr/by LÆSES fra kolonnerne, og ingen kode må splitte en adresse på komma. **BEVIDST EFTER PILOTEN** — ren additiv gevinst, nul værdi for pilotens kerneflow, og den rører præcis de tre filer, der lige er blevet stabile. **OBS ved implementering:** (1) gamle leads har NULL i felterne — læsekoden skal falde tilbage på `address`, aldrig antage kolonnerne; (2) `husnr` og `postnr` er `text` (husnumre er "12B", postnummer er en identifikator) — ingen `parseInt`; (3) felterne skal gemmes fra DAWA-OBJEKTET, ikke fra den formaterede streng — ellers har vi bare flyttet parsingen ét lag ned; (4) fuldt id-tjek + røgtest med GENÅBNING af begge modaler (17/7-QA-reglen — det var netop genåbnings-tjekket, der afslørede billedupload-fejlen 20/7). Backfill af historiske adresser: engangsscript der slår hver gammel `address` op mod DAWA's API og skriver felterne fra SVARET — valgfrit, haster ikke, må ikke blokere.

21. **`leads.firm_id` udfyldes ikke af koden** ✅ **LUKKET 5/8-26 — bevist i staging og prod.** (fund 27/7): ⚠️ **RETTET 5/8-26: det er `/formular/:token` og `/opret-opgave`, ikke `/opkald`-flowet.** `/opkald` opretter kun `calls`-rækken; leadet skabes først, når kunden udfylder formularen. Den forkerte formulering stod både her og i registrets D21. **Fremgangsmåden 5/8:** `/formular/:token` krævede mere end ét felt — opslaget hentede kun `id` fra `calls`, så `.select("id")` blev til `.select("id, firm_id")`; uden det ville `call.firm_id` være `undefined`, og kolonnen ville stadig stå tom. `/opret-opgave` var derimod gratis, fordi `firm_id` allerede lå i scope fra `firmIdFromToken()`. Verificeret med `Select-String -Path *.js`, at der kun findes **to** indsættelsessteder (`onboarding.js:685` er et opslag, ikke en indsættelse). **Bekræftet ufarligt at have udskudt:** ingen af de fire RLS-politikker på `leads` læser `firm_id` — alle går gennem `call_id`. **Fælde ved verifikationen:** røgtesten kigger ikke på `firm_id`, så en grøn `npm run smoke` beviser INTET her. Beviset er en NY række med udfyldt `firm_id` fra hver af de to veje. migration `..._kunder_og_opgavelag` tilføjede `firm_id` til `leads` og backfillede fra `calls`. Men ingen kode sætter kolonnen — hverken `/opkald`-flowet eller `/opret-opgave`; de blev skrevet, før kolonnen fandtes. Nye leads får derfor `firm_id = NULL`.
    **Det HASTER IKKE, og her er hvorfor:** ingen kode LÆSER kolonnen endnu, og backfill'en er én sætning, der virker lige godt på 10 og 10.000 rækker — gælden er altså ikke rentebærende. Den rigtige deadline er ikke "før piloterne", men **før `leads`-politikken skifter** fra `call_id → calls.firm_id` til `firm_id` (Trin 5 i tilbud-runbooken). Sker det med NULL-rækker i tabellen, forsvinder de fra dashboardet på én gang.
    **SÅDAN LØSES DEN — gratis, ikke som egen opgave:** firmaet er allerede kendt på hvert indsættelsessted (`/opkald` slår firmaet op på det kaldte nummer; `/opret-opgave` skal kende det for at kunne sende SMS), så det er ét felt mere i et objekt, der bygges i forvejen. Find stederne med `Select-String -Path *.js -Pattern "from\('leads'\)" -Context 0,6`. Kodearbejdet er minutter — **prisen er ceremonien**: `server.js` er hot path, altså feature branch → staging → røgtest med rigtigt opkald → PR → deploy-vindue → prod-verifikation. En halv dag i kalendertid for to linjer. Derfor: **læg ændringen oven i den næste `server.js`-opgave, du alligevel skal deploye** (kandidater: billedupload-endpointet nr. 14, telefonbesked-synk nr. 1f, statistikfeltet nr. 15). Marginal pris ≈ nul; prisen for at gøre den alene er en halv dag.
    **SIKKERHEDSNET — kør denne, når du alligevel er i SQL-editoren, og ALTID lige før politikken skiftes:**
    ```sql
    update public.leads l set firm_id = c.firm_id
    from public.calls c where l.call_id = c.id and l.firm_id is null;

    select count(*) as uden_firma from public.leads where firm_id is null;  -- skal give 0
    ```
    Den er idempotent og kan køres så tit man vil. Virker for alle leads MED et `call_id` — og 27/7 havde 100 % af dem det. **Alternativ, hvis det nogensinde bliver presserende før næste server-deploy:** en `BEFORE INSERT`-trigger på `leads`, der udleder `firm_id` fra `call_id` ved NULL (nul kodeændring, nul app-deploy, rammer begge indgange). Fravalgt som standardvej, fordi den skaber en værdi, ingen kode har skrevet — om tre måneder leder man forgæves i `server.js` — og fordi den selv skal fjernes igen bagefter. **Til sidst:** `firm_id` gøres først NOT NULL, når kolonnen har været udfyldt et stykke tid, og tællingen ovenfor giver 0 i prod.

22. **Statusfelt på opgaverne i overblikket (todo — tilføjet 29/7):** hver opgave i opgavelisten (dashboard) skal have et statusfelt, så håndværkeren kan se og skifte status direkte i overblikket — i dag findes kun implicit status via haster-markeringen og om leadet er "set" (den sidste fjernet 20/7, se pkt. 14). **Databaseændring:** ny `status`-kolonne på `leads` (fx enum/text: `ny` → `i gang` → `afsluttet`, default `ny` for nye rækker). Gamle rækker skal have en fornuftig default ved migrationen — sandsynligvis `ny`, siden der ikke findes historik at udlede status fra. **UI:** statusmærke i opgavelisten (farvet badge/prik — genbrug evt. det visuelle sprog fra initialcirklerne, pkt. 19) + en måde at skifte status på, enten inline i listen (dropdown/klik-cyklus) eller inde i "Rediger lead"-modalen, evt. begge steder. RLS er allerede på plads (firmaets egne rækker), så det er en ren tilføjelse, ikke en ny adgangsmodel. **AFKLAR M. ANNE FØRST:** hvilke statusser giver mening for en håndværkers arbejdsgang (tre trin er et gæt — måske skal fx "afvist"/"intet svar" også med), og om status nogensinde skal kunne ses/sættes af kunden (formentlig nej — rent internt værktøj). **Ved implementering:** både "Ny opgave"- og "Rediger lead"-modalen rører de samme rækker, så statusfeltet skal med begge steder, hvis det skal kunne sættes allerede ved oprettelse — og husk fuldt id-tjek + røgtest med GENÅBNING af modalen bagefter (17/7-QA-reglen; det var netop genåbnings-tjekket, der afslørede billedupload-fejlen 20/7, pkt. 14).

23. **Mulighed for at sætte MFA op på dashboardet (todo — tilføjet 29/7):** brugeren (håndværkeren) skal selv kunne aktivere to-faktor-login (MFA/TOTP, fx Google Authenticator/Authy) på sin konto. Supabase Auth understøtter TOTP-MFA indbygget (`auth.mfa.enroll` → QR-kode → `auth.mfa.challenge`/`verify`), så det er ikke en ny mekanisme, der skal bygges fra bunden. **Vigtig afgrænsning ift. eksisterende funktioner:** dette er noget ANDET end engangskoden (`email_otp`), der allerede findes i redningsvejen (pkt. 1a-1d) — den er en genvej IND i appen ved glemt adgangskode; MFA er et EKSTRA lag OVENPÅ login. UI-teksten skal holde de to begreber adskilt, ellers bliver "kode" tvetydigt for brugeren. **Reel kompleksitet, ikke kun én skærm:** login har allerede tre veje ind (adgangskode, magic link, engangskode) og en PWA/Safari-session-arkitektur, der har krævet flere runder hærdning (16/7, 19/7, 20/7) — en MFA-udfordring skal fungere i ALLE tre veje og inde i den installerede app, ikke kun i Safari. En Supabase-session efter bestået MFA-udfordring får et andet AAL-niveau (aal2) — tjek om noget i koden (RLS-politikker, sessions-tjek) forudsætter aal1 og skal opdateres. **AFKLAR M. ANNE FØRST (produktbeslutning, ikke kun teknik):** skal MFA være valgfrit (brugeren slår det til selv, fx under en ny "Sikkerhed"-sektion på profilsiden) eller obligatorisk? Målgruppen (håndværkere, ofte på farten, i forvejen udfordret af PWA-installationen, jf. pkt. 1e) taler for valgfrit indtil videre — ufrivillig ekstra friktion ved login er en reel risiko. **Prioritet: lav / efter piloten** — ingen pilotkunder har efterspurgt det, og det rører login-stien, som lige er blevet stabil (samme forsigtighed som pkt. 20 om adressefelterne: rør ikke tre lige-stabiliserede filer uden god grund).

24. **Twilio-signaturkontrol på `/opkald` — udrulning i prod (fundet 31/7 af `smoke.js`):**
    Ruten havde INGEN signaturvalidering: den læste `req.body.To`/`.From` og handlede
    på dem, som var de sandheden. Enhver, der kendte adressen, kunne dermed sende
    SMS fra håndværkerens nummer til et vilkårligt nummer (linje ~371), oprette
    opdigtede `calls`-rækker, sætte et ufærdigt firma til `verified`+`active`, og
    kortlægge hvilke numre der hører til firmaer. Ingen tegn på misbrug.
    **Rettet 31/7:** `twilio.validateRequest` med URL bygget EKSPLICIT som
    `https://${req.get("host")}${req.originalUrl}` — Railway afslutter TLS foran
    appen, så `req.protocol` ville sige `http`, signaturen aldrig matche, og ALLE
    ægte opkald blive afvist. Det er den farlige fejlmåde, og derfor rulles det ud
    i to trin via `OPKALD_SIGNATUR` (standard `log` = beregn og log, afvis aldrig).
    **STAGING FÆRDIG 31/7:** ægte opkald `signatur OK`, falsk kald `AFVIST` (403),
    `npm run smoke` 8/8 grøn. **PROD: kode deployet 31/7 i log-tilstand** (variablen
    findes ikke i prod, og standarden er `log` — bevidst).
    **STATUS 2/8-26:**
    - ✅ (1) Ægte kundeopkald set gå igennem i prod og blive til opgaveformularer.
    - ✅ (2) `OPKALD_SIGNATUR=haandhaev` oprettet i prod-servicen OG deployet.
      Staging står også på `haandhaev`, så de to miljøer er enige.
    - ⬜ (3) **UDESTÅENDE — og det er det farlige:** ring et opkald +
      `npm run smoke:prod` → skal vise `afvist med 403`. **Håndhævelse er live i
      prod uden at afvisningsvejen er verificeret DER.** Fejler URL-bygningen,
      afvises ALLE ægte opkald. Virker et rigtigt opkald ikke: sæt variablen
      tilbage til `log` med det samme.
    - ⚠️ Bekræftelsen `✅ signatur OK` findes ikke længere i loggen — den logges
      kun i log-tilstand. Fra nu af logges kun afvisninger.
    - ⚠️ **Variablen ruller med ved rollback.** Ruller du prod tilbage til en deploy
      fra før 2/8-26, forsvinder `OPKALD_SIGNATUR` uden varsel, standarden `log`
      træder i kraft, og håndhævelsen er slået fra igen. Se rollback-afsnittet, punkt 2.
    - ⬜ `OPKALD_SIGNATUR` mangler i `.env.prod` og `.env.staging` — tilføjes under
      D16-oprydningen, så lokale kørsler ikke opfører sig anderledes end skyen. **Derefter:** fjern variablen og gaflen i `onboarding.js`
    igen, når `haandhaev` har kørt problemfrit et par uger — et flag har en
    dødsdato, og fjernelsen er kun sikker, mens flaget står TÆNDT.
    Bemærk: `✅ signatur OK` logges kun i log-tilstand; når der håndhæves, logges
    kun afvisninger (ellers er linjen tapet).
25. **Røgtestens næste tjek (vedligeholdelsesreglen, lav prioritet):** to kandidater
    fra egen historik — (a) at Twilio-nummerets voice-webhook peger på det RIGTIGE
    miljø (staging-nummer → staging-URL); et nummer, der peger forkert, fejler
    tavst og er samme fejlklasse som de identiske dashboards; (b) at
    `manifest.json`'s `short_name` stadig er "Dit Kontor" (jf. udestående 4).
    **(c) TILFØJET 4/8-26 — vigtigst af de tre: at hvert kritisk endpoint svarer
    **≠ 404**.** Baggrund: `frisbii-checkout` viste sig aldrig at have været
    monteret — `require("./frisbii-checkout")(app)` fandtes ingen steder, kun som
    en kommentar inde i filen selv. Anden forekomst af samme fejlklasse;
    `onboarding-link` var den første, og advarslen om den står som kommentar i
    `server.js` linje 78-82. Et umonteret modul crasher ikke, logger ikke og
    fejler ikke i CI — det svarer bare 404, og knappen "lykkes" tavst hos kunden.
    Kommentarer beskytter kun mod fejl, som nogen når at læse dem i tide; et tjek
    gør det hver gang. Kandidater til listen: `/checkout`, `/opkald`,
    `/onboarding/nyt-link`, `/config.js`. Se **D23** i risikoregistret.

### 🏗️ Infrastruktur/indkøb

- [ ] **Railway: Hobby → Pro (BOER besluttes).** Prod koerer betalende kunder paa
      **Hobby-planen**: ingen SLA, ingen prioriteret support, lavere ressourcegraenser,
      og planen er beregnet til personlige projekter. Gaar appen ned en fredag aften,
      er der ingen at ringe til. Samme argument som Supabase Pro (gennemfoert 31/7) —
      Railway er det ANDET ben, piloterne staar paa. Bliver mere presserende med
      tilbudsmodulet, der laegger AI-kald og lyduploads oveni. Tjek samtidig, om
      log-opbevaringen aendrer sig (relevant for GDPR-punktet om logs).
1. **Supabase prod er FREE-tier (ok NU, men fast punkt i pilot-tjeklisten):** free pauser projektet efter ~1 uges inaktivitet (= opkald/SMS/leads fejler, til nogen vækker det manuelt) og har INGEN automatiske backups (en fejlkørsel ville være uoprettelig). **Opgradér til Pro, FØR første betalende håndværker er ombord.** Gratis nu: omdøb projektet til `ditdigitalekontor-prod` (Settings → General) — "anneann1904's Project" er en fejllæsnings-fælde (jf. identiske-dashboards-reglen).

1. ✅ **Staging-systemnummer etableret 12/7:** +4591309928 ophøjet fra puljen (slettet fra phone_numbers, sat som `TWILIO_SYSTEM_NUMBER` i staging-Railway + .env.staging). Staging-puljen har nu 1 ledigt nummer (+4593702605) — reset-test-data frigør det mellem kørsler. Verifikationsopkald virker nu i BEGGE miljøer.
2. **Prod-numre til pilot-ambitionen:** tjek puljen, køb evt. flere i HOVEDKONTOEN via buy-numbers.js (kræver nu eksplicit `VOICE_URL` = prod!), verificér voice-webhooks — pilot-drejebogens forudsætningsliste
3. Frisbii-branding (logo/farver/mails, dansk) i begge konti + øvelser: dunning-testkort, kuponer, planskift

### 🚦 Go-live-gates (master-punkt 8 — før første betalende kunde)
1. Supabase Pro + PITR på prod
2. Frisbii live-nøgler i PROD (kræver indløsningsaftale + MobilePay MSN → kræver bankkonto; staging beholder testkonto)
3. Checkout-vars + checkout-flow røgtestet fra partnersitet (kodeopgave 3)
4. Dublet-email-håndtering løst (kodeopgave 1)
5. ✅ Config-fixet deployet + verificeret i BEGGE miljøer (11/7)

### ⏸️ Bevidst udskudt (re-triggere dokumenteret i Del 0.B)
- Railway RBAC (tredje person/planopgradering) · Legacy→nye Supabase-nøgler (Supabase-deadline/refaktorering) · Twilio voice-region US1→IE1-vurdering (EU-princippet; før/kort efter go-live) · AppSignal expressErrorHandler-optimering

### 👥 Med Anne
- Pilot-formularen + forventningstekst + personlig velkomst (pilot-drejebog) — **rekruttering af testvirksomheder kan starte NU** (piloterne provisioneres manuelt uden om Frisbii)
- Dublet-email-beslutningen: genbrug eller afvis? (kodeopgave 1 — produktvinkel)
- Trin 6 E-varslingernes tekster/timing (kodeopgave 2)
- Onboarding af Anne i staging som udvikler (separat chat-oplæg findes)
