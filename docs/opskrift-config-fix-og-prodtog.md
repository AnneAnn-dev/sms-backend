# Opskrift: config-fix → staging-verifikation → prod-tog (skrevet 10/7-26, til 11/7)

**Målet:** de statiske sider skal tale med det miljø, de serveres fra (aldrig hardcodet prod),
magic-link-LOGIN skal bevises i staging (den sidste ubestrøgne sti i trial-flowet), og derefter
skal trial- + config-koden med prod-toget.

**Forudsætninger på plads fra 10/7:** trial-provisionering bygget + røgtestet D-F i staging ·
nye filer klar: `app-config.js` (ny), `onboarding.html`, `dashboard.html`, `reset-test-data.js`
(alle leveret 10/7) · feature-grenen `feat/trial-provisionering` findes og er merget til staging
(webhook-koden kører allerede i staging).

**Princippet bag det hele:** filer må ikke kende miljøer — kun miljøet (env-vars) ejer sine
adresser. Det var brud på dét princip, der gav "udløbet link"-fejlen.

---

## Fase 1 — Miljøvariabler FØRST (rækkefølgen er vigtig!)

Koden fejler bevidst (fail-closed), hvis nøglerne mangler — så nøglerne skal ind FØR koden.

1. **Find anon-nøglerne:** Supabase-dashboard → (hvert projekt) → Project Settings → API →
   `anon` `public`-nøglen. Staging-projekt: `hehrvdmtzokzbnbihcel`. Prod: `glymuxqtrbpeyzmflilf`.
   (Anon-nøglen er designet offentlig — RLS er adgangskontrollen — men den skal være MILJØETS egen.)
2. **Railway staging → Variables:** tilføj `SUPABASE_ANON_KEY` = STAGING-projektets anon-nøgle.
3. **Railway prod → Variables:** tilføj `SUPABASE_ANON_KEY` = PROD-projektets anon-nøgle.
   ⚠️ GØR DET NU, selvom prod-deployet først sker i fase 5 — så kan intet deploy nogensinde
   lande før nøglen.
4. **Lokal `.env` (staging-profilen):** tilføj samme staging-nøgle (til lokale kørsler).
5. **Samme lejlighed — navneoprydningen fra 10/7:** omdøb `TWILIO_PHONE_NUMBER` →
   `TWILIO_SYSTEM_NUMBER` i lokal `.env` (Railway hedder det allerede rigtigt).
6. Kør `node check-env.js` — skal stadig melde staging.

## Fase 2 — Filer ind i repoet

Stå på feature-grenen (`git checkout feat/trial-provisionering`).

1. **`app-config.js`** (NY fil) → repo-roden.
2. **`onboarding.html`** og **`dashboard.html`** (nye versioner) → erstat i `static\`.
   Ændringerne i dem: `<script src="/config.js"></script>` indlæses FØR supabase-CDN'et;
   de hardcodede `SUPABASE_URL`/nøgle-linjer læser nu `window.APP_CONFIG`; sample-lyd-URL'er
   bygges af `SUPABASE_URL`.
3. **`reset-test-data.js`** (opdateret version fra 10/7, hvis den ikke allerede er lagt ind —
   tjek med `node reset-test-data.js --dry-run`: den nye viser `messages` og
   `frisbii_webhook_events` i tabellisten).
4. **`server.js`:** tilføj wiring-linjen (placer den ved de andre route-requires, fx lige før
   frisbii-webhook):
   ```js
   require("./app-config")(app);
   ```
   ⚠️ Glem den ikke — det var præcis en manglende require, der gav den tavse 404 på
   nyt-link-endpointet 28/6. Verifikation: opstartsloggen skal vise
   `⚙️  Frontend-config-rute registreret paa /config.js`.
5. **`static\sw.js`:** bump cache-versionen v14 → v15 (frontend-ændring = SW-ritualet).
6. Commit + push:
   ```powershell
   git add app-config.js server.js static\onboarding.html static\dashboard.html static\sw.js reset-test-data.js
   git commit -m "Config-fix: /config.js-moenster - frontend laeser miljoeets Supabase-config fra serveren"
   git push
   ```

## Fase 3 — Storage-forudsætningen i staging

pg_dump-restoren tog kun databasen — IKKE Storage. Med miljø-relative sample-URL'er vil
stemme-prøverne i staging-onboardingen 404'e, indtil filerne findes.

1. Hent `female.mp3` + `male.mp3` fra PROD-projektets Storage: bucket `greetings`, mappe
   `_samples` (download via dashboardet).
2. Upload dem til STAGING-projektets Storage på PRÆCIS samme sti: `greetings/_samples/`.
   (Findes bucketen/mappen ikke: opret bucket `greetings` som public, opret mappen.)

## Fase 4 — Deploy til staging + verifikation

1. Merge og deploy:
   ```powershell
   git checkout staging
   git pull
   git merge feat/trial-provisionering
   git push          # -> Railway auto-deployer staging
   git checkout feat/trial-provisionering
   ```
2. Vent på ACTIVE i Railway (staging) — commit-teksten skal være config-fixet.
3. **Verifikation 1 — config-ruten:** åbn
   `https://sms-backend-staging-908c.up.railway.app/config.js` i browseren.
   Forventet: én linje `window.APP_CONFIG = {...}` med **hehrvdmtzokzbnbihcel** i URL'en.
   Ser du en fejl om manglende env vars → fase 1 punkt 2 mangler/redeploy.
4. **Verifikation 2 — det friske trial-gennemløb** (beviser magic-link-LOGIN, den sidste sti):
   a. `node check-env.js` → staging. `node reset-test-data.js --dry-run` → kig, derefter
      `node reset-test-data.js` (rydder også gamle events nu).
   b. Ny trial-signup i Frisbii-STAGING (handle `lommekontor` — F5 efter kontoskift!):
      opret abonnement på trial-planen, NY kunde, din egen email (stavet rigtigt 🙂).
   c. Railway-log: `🎁 Trial-abonnement oprettet` → `✅ Firma oprettet (Frisbii)` →
      `📩 Velkomstmail sendt`.
   d. Åbn magic linket fra mailen — gerne med DevTools → Network åben som bogføring:
      `POST /auth/v1/verify` skal gå til **hehrvdmtzokzbnbihcel**.supabase.co og svare 200.
      **Forventet: du logges ind og står i onboarding trin 1.** (Gennemfør evt. onboardingen
      helt — det er samtidig en generalprøve på pilot-oplevelsen.)
   e. Test også rescue-stien: log ud / åbn login, "Send mig et login-link" med samme email →
      mail ankommer → linket logger ind.
   Fejler d stadig: notér verify-kaldets host + statuskode + antal kald, og kig i Supabase →
   Logs → Auth. (Men med config-fixet er rodårsagen efter alt at dømme væk.)

## Fase 5 — Prod-toget (kode, INGEN migrationer)

Først når fase 4 er helt grøn.

1. Dobbelttjek at `SUPABASE_ANON_KEY` står i PROD-Railway (fase 1 punkt 3) — uden den
   knækker prod-dashboardet i samme sekund, det nye deploy lander.
2. Merge til main efter jeres normale release-regler:
   ```powershell
   git checkout main
   git pull
   git merge staging
   git push          # -> Railway auto-deployer prod
   git checkout staging
   ```
   (Ingen `push-prod.ps1` denne gang — der er ingen migrationer i releasen. Trial-koden
   bruger den MEDFØDTE unique-constraint; config-fixet er ren kode.)
3. **Prod-verifikation:**
   a. `https://sms-backend-production-5ee1.up.railway.app/config.js` → skal vise
      **glymuxqtrbpeyzmflilf** (prods egen config — bevis for at mønsteret virker begge veje).
   b. Ét ægte login på prod-dashboardet (inkognito, så SW-bumpet også bevises).
   c. Hold øje ~10 min (deploy-tjeklistens ritual).
4. Opdater docs: læg de nye `ditdigitalekontor-primer.md` + runbook + denne opskrift i
   `docs\`, commit.

## Bagefter / må gerne vente

- **Staging-systemnummer (subkonto-nummer nr. 3):** køb i SUBKONTOEN, sæt som
  `TWILIO_SYSTEM_NUMBER` i staging-Railway + lokal .env → onboarding-verifikationsopkaldet
  kan testes i staging. (Indtil da fejler netop dét trin i staging-onboarding — kendt og OK.)
- **Pilot-rekruttering:** kan starte uafhængigt af alt ovenstående (manuelle piloter uden om
  Frisbii, jf. drejebogen). Flueben før FØRSTE provisionering på prod: prod-pulje har ledige
  numre + dette prod-tog er kørt.
- Frisbii staging-oprydning: expire trial-testabonnementerne (sub-0009/0011/…), så de ikke
  støjer — deres events for slettede firmaer logges ellers som "Intet firma … ignorerer"
  (harmløst, men støj).

## Hvorfor-noter (til genlæsning om et halvt år)

- `/config.js` er ikke en fil på disken — det er en RUTE, der genererer én linje JavaScript af
  serverens env-vars. Staging-serveren svarer staging-adresser, prod prod. Derfor kan ingen
  fremtidig fil-glemsel pege et miljø forkert.
- Rækkefølgen env-var → kode er fail-closed-designets pris og pointe: hellere en tydelig 500
  fra /config.js end en side, der tavst taler med det forkerte projekt.
- Migrations-lærdommen fra 10/7 gælder stadig: opret fil → indhold → gem → push; aldrig
  slette/omdøbe kørte migrationsfiler; `npx supabase migration repair` kun EFTER at reverten
  er gjort sand i databasen.
