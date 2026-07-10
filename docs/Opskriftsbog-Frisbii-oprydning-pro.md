# Opskriftsbog — Frisbii-oprydning + produktionstog (8/7-26)

*Dit Digitale Kontor · to opskrifter, køres i rækkefølge. Hvert trin har et
forventet resultat — stemmer det ikke, STOP og undersøg før næste trin.*

---

## Opskrift 1: Frisbii- og staging-oprydning (~15 min)

**Formål:** test-menageriet fra byggetrin 6-testene afvikles, så (a) intet
fornyer/trækker testkroner om 30 dage, (b) dead-letter-listen starter ren,
(c) staging-puljen kun indeholder numre, staging faktisk ejer.

### 1a. Expire alle test-abonnementer i Frisbii

1. Frisbii → **staging-kontoen** — F5 EFTER kontoskift, verificér handle
   (`lommekontor`) i browserens URL!
2. **Abonnementer** → gennemgå listen. For HVERT abonnement der ikke allerede
   står UDLØBET: åbn det → **Expire now** (ikke kun cancel — cancel lader det
   leve til periodeslut).
   - ⚠️ **Særligt vigtigt: trial-abonnementet fra 13:56** — det konverterer
     ellers om 30 dage og trækker 1.500 testkroner + affyrer events midt i
     noget andet.
3. **Forventet i Railway staging-loggen** pr. expire: enten
   `billing_status -> expired` + evt. `DEPROVISIONERET` (hvis firmaet fandtes)
   eller `Intet firma for frisbii_subscription: sub-XXXX — ignorerer expired`
   (hvis det aldrig blev provisioneret). BEGGE er korrekte.
4. **Slutkontrol:** abonnementslisten viser kun UDLØBET-badges.

### 1b. Ryd staging-databasen (SQL-editor, staging-projektet — tjek ref `hehrv...` i URL!)

```sql
-- 1) Overblik foerst: hvad ligger der?
select id, name, email, phone_number, billing_status from firms order by created_at;
select number, firm_id, quarantined_until, last_firm_id from phone_numbers;
select id, event_type, received_at, error from frisbii_webhook_events
where processed_at is null;
```

```sql
-- 2) Slet test-firmaerne fra dagens Frisbii-tests (Lommekontor-navnene).
--    BEHOLD rutnings-testfirmaet 'Dit Digitale Kontor' (3a0044f1..., +4591309928)!
--    firm_users foerst (FK), saa firms:
delete from firm_users where firm_id in
  (select id from firms where name = 'Lommekontor');
delete from firms where name = 'Lommekontor';
```

```sql
-- 3) Slet prod-artefakt-nummeret (staging ejer det ikke — runbook-laerdom 8):
delete from phone_numbers where number = '+4591309229';
```

```sql
-- 4) Stempl resterende dead-letters (testene er faerdige; listen skal starte ren):
update frisbii_webhook_events
set processed_at = received_at
where processed_at is null;
```

5. **Auth-brugere:** Supabase staging → Authentication → Users → slet dagens
   test-brugere (`anntondering@gmail.com`, `ann@ditdigitalekontor.dk`,
   trial-adressen) — BEHOLD `info@ditdigitalekontor.dk` (rutnings-testfirmaets).
6. **Slutkontrol:**
```sql
   select count(*) from firms;                    -- forventet: 1 (Dit Digitale Kontor)
   select number, firm_id from phone_numbers;     -- forventet: KUN +4591309928, bundet
   select count(*) from frisbii_webhook_events
   where processed_at is null;                    -- forventet: 0
```
   📌 **Kendt konsekvens:** puljen har nu NUL ledige numre — fremtidige
   provisioneringstests kraever subkonto-nummer nr. 2 (staar paa trin 6-listen).

---

## Opskrift 2: Produktionstoget (~20 min + 10 min overvaagning)

**Lasten:** byggetrin 6-koden (dead-letter, karantaene, refund, sandfaerdig
mail-logning) + migrationerne `webhook_events_processed` og
`phone_number_quarantine` + docs (runbook, pilot-drejebog).
**Risikoprofil:** venlig — al ny kode er webhook-adfaerd, prods Frisbii-konto
sender kun testevents endnu, og migrationerne er additive (den ene er endda
allerede i prod fra link-uheldet — db push springer den over).
**Deploy-vindue:** aften/weekend jf. Del 1 — eller nu, med testdata i prod.

### 2a. Pak lasten (PowerShell, `sms-backend`, branch `staging`)

```powershell
git status --short
# Forventet: M docs/lommekontor-drift-runbook.md (+ evt. ny pilot-drejebog)
# Laeg pilot-drejebogen i docs\ hvis ikke sket, saa:
git add docs/
git commit -m "docs: trin 6 A-D bogfoert, pilot-drejebog, dublet-email-laerdom"
git push
```

**Kontrol:** Railway **staging** auto-deployer (docs-aendringer = harmloes
deploy). Vent paa groen. `git log origin/main..staging --oneline` viser hele
lasten — genkend hver commit.

### 2b. PR og merge (GitHub)

1. **Pull requests** → **New** → base `main` ← compare `staging`
2. **Fil-kontrol i diffen:** frisbii-webhook.js, onboarding.js, mail.js,
   onboarding-link.js, supabase/migrations/ (2 filer), scripts, docs.
   ❌ MAA IKKE optraede: `.env`, `auth-users.sql`, `schema.sql`, `data.sql`,
   `supabase/.temp/`
3. **Create** → **Merge pull request** → **Confirm** — og klik IKKE
   "Delete branch"!

### 2c. Prod-koden deployer

1. Railway → **production** → Deployments → ny deploy i gang → vent paa groen
2. **Boot-log-kontrol:** `appsignal.cjs loadet ... | env: production` +
   `Server koerer paa port 8080`
3. **Health:** `https://sms-backend-production-5ee1.up.railway.app/health` → OK

### 2d. Migrationerne (jomfrurejse for push-prod.ps1)

```powershell
.\push-prod.ps1
```

Forventet forloeb:
1. Tjekliste vises → skriv **PROD** (store bogstaver — "prod" afvises)
2. Scriptet linker selv om til prod (spoerger efter PROD-databasens password
   — Bitwarden)
3. `db push` tilbyder **kun `phone_number_quarantine`**
   (webhook_events_processed er allerede i prod fra link-uheldet 6/7 —
   at den IKKE tilbydes er en BEKRAEFTELSE, ikke en fejl)
4. Bekraeft → Finished
5. Scriptet skifter SELV tilbage til staging — kontrollér slutlinjen
   `[SKIFT] ... staging`

**Kontrol i PROD SQL-editor** (ref `glymux...` i URL!):
```sql
select column_name from information_schema.columns
where table_name = 'phone_numbers' order by ordinal_position;
-- forventet: 7 kolonner (inkl. quarantined_until, last_firm_id)
```

### 2e. Efterkontrol (~10 min)

- [ ] AppSignal **production**: ingen nye fejl-spikes
- [ ] Prod Deploy Logs: rolige (webhook-koden aktiveres kun af Frisbii-events)
- [ ] **Funktionel stikproeve (valgfri men fin):** Frisbii PROD-kontoen
      (`test-2-lommekontor`-handlen!) → gensend et gammelt, allerede behandlet
      event → prod-loggen skal svare `Frisbii webhook allerede behandlet,
      ignorerer` = ny kode + tabel virker i prod, nul sideeffekter
- [ ] `git log origin/main..staging --oneline` → forventet: TOM (miljoeer i synk)

### 2f. Aftenens rosin (valgfri): runbook-navne-sweep

```powershell
git checkout staging
git mv docs/lommekontor-drift-runbook.md docs/ditdigitalekontor-drift-runbook.md
# + ret titel-linjen og interne LommeKontor-referencer i filen
# (BEVAR: historiske fakta, APPSIGNAL_APP_NAME-undtagelsen, gamle filnavne i log-citater)
git commit -m "docs: runbook omdoebt til ditdigitalekontor (navne-sweep 1/3)"
git push    # → lille PR-tur til main ved lejlighed, eller med naeste tog
```

---

**Naar begge opskrifter er koert:** byggetrin 6 A-D er i PROD, miljoeerne er i
synk, staging er rent, og pilot-sporet kan aabnes. Naeste kapitler: trin 6 E
(varslinger, med Anne) · trial-provisionering (kodeopgave) · dublet-email-
haandtering (foer go-live) · subkonto-nummer 2 · Frisbii-branding + oevelser.


Uddybning af skridt 2b

Selvfølgelig! Lad mig folde det ud til noget du faktisk kan følge trin for trin. Det er en helt normal proces, så bare rolig.
Trin 1: Opret pull request'en

Gå ind på jeres repo på GitHub.com
Klik på fanen "Pull requests" øverst
Klik på den grønne knap "New pull request"
Du får nu to dropdown-menuer der siger noget i stil med "base: main" og "compare: staging":

base skal stå på main (det er den gren I merger ind i — altså produktion)
compare skal stå på staging (det er den gren I merger fra — jeres nye ændringer)


GitHub viser nu automatisk en diff (en oversigt over alle ændringer)

Trin 2: Tjek filerne i diffen — det vigtige sikkerhedstjek
Scroll ned til fanen der hedder "Files changed". Her ser du en liste over alle filer der bliver ændret.
Skal være med (det er forventet og fint):

frisbii-webhook.js
onboarding.js
mail.js
onboarding-link.js
2 filer under supabase/migrations/
filer under scripts
filer under docs

Må IKKE være med — hvis du ser nogen af disse, så STOP og spørg nogen, merge ikke:

.env
auth-users.sql
schema.sql
data.sql
noget under supabase/.temp/

Grunden til at disse er farlige: de indeholder typisk hemmeligheder (.env) eller rå data/database-dumps som ikke skal ende i produktionskoden.
Hvis listen matcher det forventede (og ingen af de farlige filer dukker op), går du videre.
Trin 3: Opret selve pull requesten

Øverst på siden (hvor du lavede diff'en) klikker du "Create pull request"
Giv den evt. en titel (f.eks. "Staging → Prod deploy") — det er ikke kritisk
Klik "Create pull request" igen for at bekræfte

Trin 4: Merge den

Du lander nu på selve PR-siden. Scroll ned til bunden
Der er en grøn knap der hedder "Merge pull request" — klik på den
GitHub beder dig bekræfte — klik "Confirm merge"
VIGTIGT: Efter merge tilbyder GitHub ofte en knap der hedder "Delete branch".
Klik IKKE på den. Lad staging-branchen blive liggende.

Det var det! 🎉
Når merge'et er gennemført, er ændringerne nu i main, og afhængig af jeres opsætning starter en deployment til produktion enten automatisk eller ved et separat skridt (det ved jeg ikke om I har — sig til hvis du er i tvivl om det næste led).
Er der noget bestemt trin du er nervøs for, eller vil du gerne vide hvad der sker efter merge'et (f.eks. om der kører en deployment automatisk)?




Prodversionen af oprydning. 

Prod-oprydning: ja, men IKKE opskriften uændret
Princippet holder (testdata, engangsoprydning før ægte kunder — DML i editoren er legitimt), men tre trin skal vendes om, fordi prod er en anden verden:

Trin 3 (slet +4591309229) må ALDRIG køres i prod — logikken er spejlvendt: i staging var nummeret en artefakt; i prod er det et ægte aktiv (fysisk Twilio-nummer, jeres udgift, pilot-puljens indhold). Ingen delete from phone_numbers i prod overhovedet — numrene skal frigøres, ikke slettes.
Backup først — prods egen regel (Del 0.E): kør pg_dump-treklangen inden større DML. Fem minutter, og du har fortrydelsesret.
Firma-sletningen skal ske pr. eksplicit id, ikke pr. navn — prods indhold er ældre og mere blandet end stagings; kør overbliks-forespørgslerne, kig på hver række, og slet med id-liste.

Prod-tilpasset version (kør i prod-editoren, ref glymux... i URL):

-- 0) FØRST: pg_dump-treklangen fra PowerShell (Del 0.E-opskriften)
$env:PGPASSWORD = 'prod-databasepassword'   # enkelte anførselstegn!
pg_dump "postgresql://postgres.glymuxqtrbpeyzmflilf@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --schema=public --schema-only -f schema.sql
pg_dump "postgresql://postgres.glymuxqtrbpeyzmflilf@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --schema=public --data-only -f data.sql
pg_dump "postgresql://postgres.glymuxqtrbpeyzmflilf@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --data-only --table=auth.users --table=auth.identities -f auth-users.sql

Finder du ikke afsnittet i din lokale kopi, har du muligvis en ældre version af runbooken liggende — den nyeste er den fra vores seneste bogføring (med 🏁 Del 0-markeringen og hele byggetrin 6-statussen). Den bør være den, der ligger i docs/ og ryger med toget.nu er jeg med, jeg har glemt hvad er $env:PGPASSWORD = 'prod-databasepassword'$env:PGPASSWORD er den midlertidige PowerShell-variabel, som pg_dump automatisk læser passwordet fra — så det ikke skal stå i selve kommandoen. Det, du skal sætte ind mellem de enkelte anførselstegn, er prod-databasens Postgres-adgangskode — den, du resettede og gemte i din password manager tilbage ved gendannelses-øvelsen (3/7). Det er ikke en API-nøgle (eyJ...) og ikke dit Supabase-login — det er det "rå" databasepassword, som kun bruges til direkte Postgres-forbindelser som pg_dump.

De tre huskeregler, når du sætter det: enkelte anførselstegn (dobbelte lader PowerShell fortolke $ og ` i passwordet), samme vindue som pg_dump-kommandoerne, og passwordet lander i PowerShell-historikken — kør evt. Clear-History bagefter for hygiejnen.De tre huskeregler, når du sætter det: enkelte anførselstegn (dobbelte lader PowerShell fortolke $ og ` i passwordet), samme vindue som pg_dump-kommandoerne, og passwordet lander i PowerShell-historikken — kør evt. Clear-History bagefter for hygiejnen.

-- 1) Overblik — beslut pr. række hvad der er testaffald:
select id, name, email, phone_number, billing_status, created_at from firms order by created_at;
select number, firm_id, quarantined_until from phone_numbers;
select id, event_type, received_at, processed_at from frisbii_webhook_events order by received_at;

-- 2) Slet testfirmaer med EKSPLICIT id-liste (indsæt de id'er, du dømmer ude):
delete from firm_users where firm_id in ('<id1>', '<id2>');
delete from leads where call_id in (select id from calls where firm_id in ('<id1>', '<id2>'));
delete from calls where firm_id in ('<id1>', '<id2>');
delete from firms where id in ('<id1>', '<id2>');

-- 3) FRIGØR numrene (slet IKKE rækkerne!) — klar til piloterne:
update phone_numbers set firm_id = null, quarantined_until = null, last_firm_id = null;

-- 4) Stempl gamle webhook-events (samme som staging):
update frisbii_webhook_events set processed_at = received_at where processed_at is null;
Plus auth-brugere (Authentication → Users: slet test-adresserne, behold din egen admin-bruger, hvis dashboardet bruger den) — og bagefter pilot-drejebogens forudsætningstjek: voice-webhooks på begge numre mod prod-URL'en. Bemærk at trin 3 forudsætter, at prod-toget er kørt (kolonnerne findes ellers ikke i prod — endnu en grund til togets rækkefølge). Beslutningen om jeres eget demo-firma (vil I beholde ét "Dit Digitale Kontor"-firma i prod til egne tests, bundet til +4591309423?) er din — men træf den bevidst i trin 1-gennemgangen frem for at slette i flæng.


