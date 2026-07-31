# Tilbudsmodul — runbook (rækkefølge og opgaver)

Arkitektur og begrundelser: se `tilbud-primer.md`. Denne fil er opgavelisten.
Arbejdsform: Claude Code, lodrette skiver, feature branches, plan mode ved
flerfilsopgaver, `/clear` mellem opgaver, `/usage` efter hver opgave de første uger.

## Grundregel: piloterne har forrang

Pilot-support må afbryde modularbejdet — men i faste vinduer (morgen + sen
eftermiddag), ikke løbende. Ægte brande undtaget.

## Repo- og navnestruktur (besluttet 31/7)

**Ét repo.** Tilbudsmodulet bor i SAMME repository som resten af Dit Digitale Kontor.
Begrundelse: samme Supabase-database og dermed én migrationstidslinje (modulet
udvider jo `leads`); samme service worker og cacheversion; samme Express-app, auth
og `billing_status`-gate; og ét sæt værn (deny-regler, gitleaks, `smoke-staging.js`,
`rls-isolation-test.js`). To repos = to sandheder om skemaet og to kopier af værnene.

Isolationen mod dashboardet er en KODE-egenskab (ø-arkitekturen), ikke en
repo-egenskab. Og retningen er den nemme vej: en mappe kan altid skilles ud i eget
repo senere — to repos med fælles database er svære at flette. (Økonomisystem-
integrationen er den eneste realistiske kandidat til eget repo, og først når vi når dertil.)

**Eksisterende filer flyttes IKKE.** Roden er flad i dag (`server.js`, `dashboard.html`,
`sw.js`, push-scripts) og forbliver det. En omstrukturering midt i pilotdrift er en
stor diff uden funktionel gevinst. Kun NY kode får den nye struktur.

### Navnekonventioner

| Hvad | Regel | Eksempel |
| --- | --- | --- |
| Serverkode | `routes/tilbud/` | `routes/tilbud/transskription.js`, `routes/tilbud/ai-proxy.js`, `routes/tilbud/data.js` |
| Frontend | undermappen `tilbud/` dér hvor statiske filer serveres i dag | `tilbud/index.html`, `tilbud/tilbud.js`, `tilbud/tilbud.css` |
| API-stier | ALT under ét præfiks | `/api/tilbud/...` |
| Branches | `feat/tilbud-...` / `fix/tilbud-...` | `feat/tilbud-transskription` |
| Migrationer | fælles mappe, ingen modulopdeling | `supabase/migrations/` |
| Modulets env-variable | præfiks `TILBUD_` | `TILBUD_AKTIV`, `TILBUD_DAGSLOFT` |
| Dokumentation | `docs/` | `docs/tilbud-primer.md`, `docs/tilbud-runbook.md` |

Delte hemmeligheder beholder deres eget navn (`ANTHROPIC_API_KEY`, `SCALEWAY_*`) —
de tilhører platformen, ikke modulet.

### Hvorfor ét API-præfiks betyder mere end det ser ud til

Når hver rute, hver statisk fil og hver modul-env-variabel bærer ordet `tilbud`, kan
hele modulet **slukkes i ét greb**: routerne mountes bag et feature flag
(`TILBUD_AKTIV`), så en dårlig deploy afmonteres uden git-revert og uden at røre
dashboardet. Det er ø-arkitekturen ført helt ud i routingen — og den eneste
rollback-plan, der virker, når piloterne er på.
Flagget lægges ind sammen med det ALLERFØRSTE modul-endpoint, ikke bagefter.

### Nested CLAUDE.md

`routes/tilbud/CLAUDE.md` med modulets egne regler (ø-arkitektur, per-række-CRUD
frem for hele-listen-gem, frysningsreglen, lyd gemmes aldrig). Claude Code opdager
CLAUDE.md-filer i undermapper, men **indlæser dem ikke ved opstart** — de kommer
først med, når Claude læser en fil i den mappe, og de genindlæses heller ikke
automatisk efter `/compact`.

Konsekvens: nestede filer er gode til *modulets håndværk*, men de hårde
sikkerhedsregler (migrationer kun via push-scripts, `.ENV-ER-PROD`, aldrig reset mod
prod) skal blive stående i rod-`CLAUDE.md` — de skal gælde fra sekund nul i enhver
session. Kilde: https://code.claude.com/docs/en/memory


## Røgtesten — sådan bruges den

Ét script, `smoke.js`, to måder at køre på. IKKE to filer: to filer, der påstår
at teste det samme, driver fra hinanden, og så ved man ikke hvilken der er sandheden.

```
npm run smoke          # staging — alle tjek
npm run smoke:prod     # prod — KUN de læsende tjek
```

Kræver `.env.smoke` i roden (må ALDRIG committes — tilføj til `.gitignore`).

### Hvornår

Efter forandring, ikke efter kalenderen. Har du ikke rørt noget, er der intet at fange.

- efter hvert push til staging
- FØR hvert prod-deploy
- efter hvert prod-deploy (`npm run smoke:prod`)

**En opgave er først færdig, når `npm run smoke` er grøn.** Samme linje står i CLAUDE.md.

### Rød betyder stop

Enten fixer du koden, eller også fixer du tjekket. Deployer du forbi en rød røgtest
én gang, fordi "det tjek er nok bare skævt", har du lært dig selv at den er
vejledende — og så er hele investeringen tabt.

### Vedligehold

1. Hver driftsfejl fremover får et tjek, der ville have fanget den.
2. Nye tjek skal **kunne fejle** — bræk dem én gang med vilje og se dem blive røde.
   Et tjek, du aldrig har set rødt, er dekoration.
3. Ustabile afhængigheder markeres ADVARSEL, ikke FEJL. Rød skal betyde rød.
4. Tjek der skriver noget, markeres `sikker: false` og køres aldrig mod prod.

### Åbne punkter i scriptet

- [ ] Verificér stien til Twilio-opkaldshandleren (`/opkald`) mod `onboarding.js`
- [ ] Bræk hvert tjek én gang og se det blive rødt (den halve værdi af opgaven)
- [ ] `/api/tilbud/health` tilføjes i modulet, så flag-tjekket får noget at spørge om


## Trin 0 — FØR modulet (pilot-sporet + sikkerhedsfundament)

### 0a. Sikkerhedsopsætning omkring Claude Code

- [x] Deny-regler i `.claude/settings.json` (Read + Bash-omveje til .env-filer,
      prod-scripts, reset, force-push, buy-numbers) — testet virksomme 22/7
      (dummy-test: Read-kald afvist) på Claude Code 2.1.218
- [x] Settings-filen committet (gitignore-undtagelse: `.claude/*` +
      `!.claude/settings.json`)
- [x] Branch-oprydning lokalt + GitHub (kun main + staging i hvile;
      rytme fremover: branch fødes til én opgave → merges → slettes)
- [ ] **Nøglerotation efter .env-eksponeringen 22/7.** Rækkefølge: delte
      kontonøgler først (Simply/DNS, tjek Scaleway, ElevenLabs, AppSignal —
      opdatér i BEGGE masterfiler + BEGGE Railway-miljøer), derefter rene
      staging-nøgler (Supabase service role + anon, Twilio testkonto, Frisbii
      testnøgler + webhook-secret, nyt VAPID-par). Bitwarden ajourføres løbende.
      FÆRDIG = `node check-env.js --live` grøn + ét testopkald gennem staging-flowet.
- [ ] **Modulets nye nøgler lægges ind i SAMME omgang som rotationen.**
      Transskriptions-nøgle (Scaleway el. Voxtral) og `ANTHROPIC_API_KEY` skal
      alligevel ud i BEGGE masterfiler + BEGGE Railway-miljøer + Bitwarden. Gør det
      én gang frem for to. Sæt et **månedligt forbrugsloft på Anthropic-kontoen**
      med det samme — det er den hårde grænse under dagsloftet i proxyen, og den
      eneste der holder, hvis koden fejler. Brug en API-nøgle adskilt fra
      Claude Code-forbruget, så modulets forbrug kan aflæses rent.
      FÆRDIG = `node check-env.js --live` grøn med de nye navne i begge miljøer.
- [ ] **Branch-beskyttelse på `staging`:** GitHub → Settings → Branches → regel
      for `staging` med "block force pushes". FÆRDIG = force-push afvises.

### 0b. Værn som kode (de to første Claude Code-opgaver efter manifestet)

- [ ] **Opgave: gitleaks som pre-commit-vagt.** Branch `feat/gitleaks-precommit`.
      Secret-scanning der nægter commits med nøgler i — beskytter mod hardcodede
      secrets fra alle hænder, inkl. Claude Code selv.
      FÆRDIG NÅR: (1) gitleaks er installeret og koblet på pre-commit (Windows/
      PowerShell 5.1-kompatibelt — hook-scripts i ren ASCII); (2) et testcommit
      med en fake Twilio-token AFVISES med forståelig besked; (3) et normalt
      commit går igennem upåvirket; (4) evt. falske positiver fra eksisterende
      kode er håndteret via `.gitleaks.toml`-allowlist (dokumentér hvorfor pr.
      undtagelse); (5) opsætningen er beskrevet i drift-runbooken (installation
      på ny maskine inkl.).
- [x] **`rls-isolation-test.js` — RLS som testet påstand (leveret 27/7).**
      To firmaer, to brugere, én række i hver tabel. Tester TRE ting: at A ikke
      kan læse B's rækker; at A KAN læse sine egne (en politik der nægter ALT ville
      ellers bestå med glans — fejlen ville først vise sig som et tomt dashboard
      hos en kunde); og at `authenticated` afvises på insert/update/delete på de
      seks nye tabeller (skrivning er server-side pr. design — en manglende
      write-politik fejler ikke højlydt, den nægter stille). Begge retninger testes,
      da asymmetriske politikker er en klassisk håndskrevet fejl. Rører aldrig
      rækker, den ikke selv har oprettet; rydder op i `finally`, også ved crash.
      Tørkørsel som standard (printer projekt-ref), skriver kun med `--bekraeft`.
      **GRØN 27/7: 37 bestået / 0 fejlet i BÅDE staging og prod.**
      Vedligehold: hver ny tabel med `firm_id` skal med i `NYE_TABELLER`.
- [ ] **Opgave: `smoke.js` — røgtest som definition af færdig.**
      Branch `feat/smoke-staging`. Udkast leveret 31/7; skal tilpasses og brækkes igennem. Ét script, ét samlet grønt/rødt resultat.
      FÆRDIG NÅR: (1) scriptet tjekker mindst: health-endpoint svarer 200;
      /opkald AFVISER kald med ugyldig Twilio-signatur; rescue-endpointet
      svarer; Supabase-forbindelse OK og forventede kernetabeller findes;
      login-flowets endpoint svarer; (2) exit code 0 ved grøn / 1 ved rød, med
      dansk linje pr. tjek; (3) kører KUN mod staging — scriptet fail-closer
      hvis env peger på prod (genbrug check-env-mønsteret); (4) køretid under
      30 sek.; (5) CLAUDE.md er opdateret med: "En opgave er først færdig, når
      `node smoke-staging.js` er grøn."
      Vedligehold: hver driftsfejl fremover får et tjek, der ville have fanget den.

### 0c. Gendannelses-brandøvelse (én time, uden kode)

- [ ] Øv restore af prod-databasen i Supabase til et NYT testprojekt (aldrig
      oven i eksisterende). Verificér data. Skriv opskriften ind i
      drift-runbooken, mens du gør det. FÆRDIG = du har selv gendannet én gang
      og proceduren står i runbooken.

### 0d. Pilot-sporet (fra drift-runbooken)

- [ ] iPhone-røgtest af redningsvejen (gater prod-deploy af mail.js/dashboard.html)
- [ ] Prod-nummerpulje tjekket/fyldt FØR første pilot provisioneres
- [ ] **Manifest-opgaven: `short_name` → "Dit Kontor" + SW-versionsbump.**
      Claude Code session 2 (første rigtige opgave, feature branch
      `fix/manifest-short-name`, lille diff, fuldt review). Derefter: PWA slettes
      og geninstalleres på begge iPhones.
      FÆRDIG NÅR: diffen rører præcis manifest + sw.js; installeret PWA på
      iPhone viser "Dit Kontor" under ikonet.
- [ ] Frisbii staging-oprydning (jf. drift-runbook)

Rækkefølge i Trin 0: nøglerotation + branch-beskyttelse NU → manifest (session 2)
→ gitleaks → smoke-staging → brandøvelse → resten af pilot-sporet.

## Skema-status — databaserne er KLARGJORT (27/7-26)

Alle tre migrationer er kørt på **staging og prod** via push-scripts, og filerne
ligger i git under `supabase/migrations/`. Datamodellen fra primeren står dermed i
begge databaser, FØR piloterne kommer på — hvilket var hele formålet: tabeller er
gratis at oprette og dyre at ændre, når der ligger kundedata i dem.

| Migration | Indhold |
| --- | --- |
| `20260727065655_kunder_og_opgavelag` | `mine_firmaer()`, `set_updated_at()`, `kunder` + RLS, `leads.firm_id` / `.kunde_id` / `.titel` / `.updated_at` |
| `20260727065656_leads_adressefelter` | `vejnavn`, `husnr`, `etage`, `doer`, `postnr`, `by`, `dawa_id` på `leads` |
| `20260727065703_referater_tilbud_profil` | `referater`, `tilbud`, `tilbud_linjer`, `firma_profil`, `standardfelter` + RLS på alle fem |

Verificeret i BEGGE miljøer: seks tabeller til stede, RLS aktiv overalt, leads uden
firma = 0, og `rls-isolation-test.js` grøn (37/0).

**Beslutning truffet undervejs (ud over primeren):** `leads.firm_id` blev tilføjet som
direkte firmakobling. Uden den skal enhver RLS-politik og ethvert unikt indeks pr.
firma joine via `calls` — og den sti brød for manuelt oprettede opgaver, hvor `call_id`
er nullable. Med kolonnen er politikken ordret ens på alle seks tabeller.

**To huller i skemaets levetid — kolonnerne findes, men er tomme:**
1. `leads.firm_id` udfyldes ikke af koden (drift-runbookens **kodeopgave 21**).
   Nye leads får NULL. **Haster ikke:** ingen kode læser kolonnen endnu, og
   backfill-sætningen i kodeopgave 21 er idempotent og skalerer. Deadline er
   **Trin 5** — politikken må ikke skifte til `firm_id`, mens der står NULL-rækker.
   Planen: tag ændringen med oven i næste `server.js`-deploy, ikke som egen opgave.
2. DAWA-adressefelterne udfyldes ikke af koden (drift-runbookens **kodeopgave 20**).
   Bevidst efter piloten.

Begge er expand/contract's anden halvdel. Skemaet er på plads; nogen skal skrive i det.

## Trin 1 — Beslutninger der lukkes FØR kode

- [ ] **Scaleway-verifikation:** findes whisper-transskription i deres Generative
      APIs, EU-region, pris, filformater, størrelsesgrænser? (NO-GO → Mistral Voxtral.)
- [x] Annes nik: "opkald nr. 2 fra kendt nummer = ny opgave, altid" — **BEKRÆFTET 27/7**
- [ ] Anne: indhold af STANDARDFELTER pr. branche (felter + brancher)
- [ ] Anne: samtykke-tekst i optager-UI
- [ ] DPA-liste + privatlivspolitik: tilføj Anthropic + transskriptionsleverandør
- [ ] **Annes prototype fastfryses i git** (`docs/referater-app.html` + handoffet).
      Den er UI-kontrakten for de 10 datafunktioner; ligger den kun i en mailtråd,
      driver implementeringen fra den uden at nogen opdager det.
- [ ] **Testfirma nr. 2 på staging** med egen bruger, så QA af modulet kan se
      isolationen med øjnene og ikke kun via `rls-isolation-test.js`.

## Trin 2 — Spike 0: mikrofonen (GO/NO-GO, ½–1 dag)

Minimal testside i staging-PWA'en: getUserMedia + MediaRecorder + upload af blob.
Testes i den **installerede** app på ægte iPhone (ikke kun Safari). Verificér:
permission-flow, optagelse, mp4-blob, upload. Fejler dette, ændres planen NU
(fx upload af lydfil optaget i iPhones egen app som fallback) — ikke i uge 4.

## Trin 3 — Skive 1: referatflowet ende-til-ende

Mål: Anne kan oprette kunde+opgave, optage/uploade lyd, få transskript, få
AI-referatudkast, rette, gemme og genfinde det — på staging.

- [x] **Migration A — KØRT staging + prod 27/7.** `kunder`, `leads.kunde_id`
      (nullable), `referater`. RLS på alt. Unique på `kunder(firm_id, telefon)`
      som PARTIAL index (kun aktive kunder med nummer — så NULL-numre og
      arkiverede kunder ikke blokerer). Leveret ud over planen: `leads.firm_id`,
      `leads.titel`, `updated_at` + trigger, og `mine_firmaer()`-helperen.
      Se Skema-status ovenfor.
- [ ] Transskriptions-endpoint (Scaleway, multipart webm+mp4, lyd slettes efter brug)
- [ ] Claude-proxy-endpoint (generisk; body-limit, billing-gate, dagsloft,
      forbrugslog, fail-pænt) — kun referat-prompten kobles på her
- [ ] Datafunktioner for kunder/opgaver/referater (per-række CRUD bag Annes navne)
- [ ] Ny PWA-side (ø-arkitektur, kun Kunder+Referater-fanerne aktive), SW-bump
- [ ] Anne QA på staging → derefter prod

## Trin 4 — Skive 2: tilbudsflowet

- [x] **Migration B — KØRT staging + prod 27/7.** `tilbud` med frysningsfelter fra
      dag ét (summer på selve tilbuddet, `version`, `sendt_at`), `tilbud_linjer`
      (numeric hele vejen, genereret `linje_sum`), `firma_profil` (én række pr.
      firma), `standardfelter` (pr. firma, ikke globalt). RLS på alle fem
- [ ] Tilbuds-prompt + notefoto-prompt kobles på proxyen
- [ ] Datafunktioner for tilbud/profil/standardfelter
- [ ] PDF-eksport (jsPDF), Tilbuds- og Indstillinger-fanerne aktiveres
- [ ] **Frysningstest:** godkend tilbud → ret profilpriser → verificér at tilbuddet
      viser de gamle tal, og at felterne er låst
- [ ] Anne QA → prod

## Trin 5 — Skive 3: opkaldsmatching

- [ ] `/opkald`: match `from_number` mod `kunder.telefon` (robust, ikke `.single()`);
      kendt nummer → samme kunde, NY opgave; ukendt → opgave uden kunde som i dag
      (kunde oprettes først, når håndværkeren gør det, eller via formularen — afklar
      med Anne hvad der føles rigtigt)
- [ ] **FØR `leads`-politikken skifter til `firm_id`:** kør backfill-sætningen fra
      drift-runbookens kodeopgave 21 og bekræft `uden_firma = 0` i BEGGE miljøer.
      Springes den over, forsvinder alle NULL-rækker fra dashboardet på én gang.
- [ ] Røgtest med rigtige opkald på staging

## Trin 6 — Polering og papir

- [ ] Fejltekster, tomtilstande, dansk sprogvask (Anne via Trin A/GitHub-webeditor)
- [ ] Privatlivspolitik + DBA-skabelon opdateret og publiceret
- [ ] Tips-indholdet parkeres til profilsiden (Annes bord)

## Senere (bevidst udskudt)

- Økonomisystem-integrationer (eget projekt; feature flag indtil da)
- Kunde-fletning ved dubletter (Annes udskudte punkt — forebyggelsen via unique
  constraint er dog med i Skive 1)
- Evt. selv-hosting af jsPDF

## Claude Code-arbejdsregler (gentagelse af de vigtigste)

- Altid feature branch; aldrig direkte på main. Små commits pr. delopgave.
- Plan mode (Shift+Tab) ved alt, der spænder over flere filer.
- Godkend aldrig i blinde; ingen skip-permissions. Esc afbryder altid.
- `/clear` mellem uafhængige opgaver; `/usage` som forbrugsmåler.
- Migrationer KUN via push-scripts; staging før prod; expand/contract på `leads`.
