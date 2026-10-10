# Tilbudsmodul — runbook (rækkefølge og opgaver)

Arkitektur og begrundelser: se `tilbud-primer.md`. Denne fil er opgavelisten.
Arbejdsform: Claude Code, lodrette skiver, feature branches, plan mode ved
flerfilsopgaver, `/clear` mellem opgaver, `/usage` efter hver opgave de første uger.

## Grundregel: piloterne har forrang

Pilot-support må afbryde modularbejdet — men i faste vinduer (morgen + sen
eftermiddag), ikke løbende. Ægte brande undtaget.

## Fase-opdeling (D36, besluttet 23/8, præciseret 28/8)

Tilbudsmodulets tynde skive er delt i tre selvstændige faser — ikke kun en
byggerækkefølge. **Gate'erne (Ø2, S6, J8, J9) flyttes ikke af faseopdelingen:**
en fase kan først frigives, når dens egne gates er lukket, uanset hvor langt
Trin-nummereringen nedenfor er nået.

**Fase 1 — Diktafon/referat.** Selvstændig pilotudgivelse, uden tilbud eller
faktura bagved. To veje ind: indtaling → transskription → referat, og
(besluttet 28/8) foto af håndskreven note → referat, med samme JSON-facit begge
veje (se primerens "Håndskrevne noter"). Kun `/api/tilbud/referat` og
`/api/tilbud/notefoto` skal være bygget. **Gates for Fase 1:** Ø2 (kvoter —
arkitektur besluttet 28/8, ikke implementeret) · S6 (proxy — arkitektur
besluttet, ikke implementeret) · J8 (samtykke — tre tekster godkendt af Anne
26/8, ikke lagt ind i koden) · J9 (transskriptionsmodel afgjort: Scaleway
`whisper-large-v3`; **referatmodel afgjort 19/9: `mistral-medium-3.5-128b`, ca.
11 øre pr. referat**; **vision-modellen til fotovejen er stadig åben** og
afgøres af D14's regressionssæt) · **D36: det maskinelle værn mod tilføjelser
(den SNÆVRE teknik B) er bygget** — tilføjet som gate 27/9, fordi det er D36's
bindende forudsætning og manglede på denne liste. Se `RESULTAT-06-teknik-b.md`.
**Ingen af de fem er lukket endnu.** ⚠️ D36's oprindelige krav om et forventningsbrev til
pilotkunden (fordi Fase 1 kun dækker halvdelen af P7's oprindelige
efterspørgsel) er **bevidst droppet af Ann 28/8** — den mundtlige afdækning ved
næste kontakt er valgt i stedet.

**Fase 2 — Tilbud.** Udtræk af kunde/opgave fra indtalt tekst → tilbudsforslag
→ kladde → godkendelse → kundeaccept. `/api/tilbud/udtraek` og
`/api/tilbud/tilbudslinjer` hører her. Tilbuds-rykkeren (aktiv påmindelse mod
kunden, jf. D22) er en del af denne fase; dens konkrete udformning er ikke
fastlagt.

**Fase 3 — Faktura.** D22's fulde flow (se primerens "Faktura"-afsnit), inkl.
betalings-rykkerprocedure. Ikke begyndt.

⚠️ **Ikke reconcilieret med Trin 0-6 nedenfor:** Trin-nummereringen i resten af
denne fil blev skrevet, før faseopdelingen fandtes, og er ikke skrevet om til
at følge den. Løst sagt dækker Trin 2-3 det meste af Fase 1's diktafonvej
(fotovejen står slet ikke i noget Trin endnu), Trin 4 er en del af Fase 2, og
Faktura (Fase 3) har intet Trin overhovedet. Det er ikke rettet her — det
kræver en beslutning om, hvorvidt Trin-listen skal skrives om, eller om de to
inddelinger bare skal leve side om side. Flagget, ikke løst.

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

- [ ] **`OPKALD_SIGNATUR=haandhaev`** — signaturkontrol på `/opkald` blev tilføjet
      31/7 i LOG-tilstand, efter at røgtesten fandt, at ruten accepterede kald med
      falsk signatur. Rækkefølge: (1) deploy staging, ring et rigtigt opkald
      igennem, se `signatur OK` i loggen; (2) samme i prod, følg loggen et døgn;
      (3) sæt `haandhaev` i BEGGE miljøer.
      FÆRDIG = røgtesten viser `afvist med 403` i stedet for ADVARSEL.
- [ ] Fjern `OPKALD_SIGNATUR` og gaflen igen, når `haandhaev` har kørt
      problemfrit i prod i et par uger
- [ ] Bræk hvert tjek én gang og se det blive rødt (den halve værdi af opgaven)
- [ ] `/api/tilbud/health` tilføjes, når modulet oprettes

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

- [x] **Scaleway-verifikation — GO, afsluttet 26/9-26.** `whisper-large-v3` i
      EU-region, afregnet pr. lydminut (1,34 kr./lydtime, `RESULTAT-01`).
      **Formatet: iPhonens egen fil (`audio/mp4`, AAC) tages RÅT imod** — HTTP 200
      på 8,8 sek. for 2 min 41 sek. lyd, dansk tekst retur (`RESULTAT-05`).
      API-referencens formatliste er altså ikke udtømmende, og **det omkodningstrin,
      punktet frygtede, skal ikke bygges.** Mistral Voxtral forbliver ubrugt fallback.
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

**✅ KØRT 26/9-26 — GO.** Resultatet står i `RESULTAT-05-spike0.md`; konsekvenserne
for arkitekturen i `tilbud-primer.md`. Kort: mikrofonen virker fra hjemmeskærmen,
formatet (`audio/mp4`, AAC) går **rå** til Scaleway uden omkodning, og fotovejen
giver JPEG. Fundet, der ændrede planen: **iOS tager mikrofonen, når appen går i
baggrunden** (D66) — derfor er der bygget et optager-modul med tre værn, og en
diktering kan bestå af flere dele.

## Trin 3 — Skive 1: referatflowet ende-til-ende

Mål: Anne kan oprette kunde+opgave, optage/uploade lyd, få transskript, få
AI-referatudkast, rette, gemme og genfinde det — på staging.

- [x] **Migration A — KØRT staging + prod 27/7.** `kunder`, `leads.kunde_id`
      (nullable), `referater`. RLS på alt. Unique på `kunder(firm_id, telefon)`
      som PARTIAL index (kun aktive kunder med nummer — så NULL-numre og
      arkiverede kunder ikke blokerer). Leveret ud over planen: `leads.firm_id`,
      `leads.titel`, `updated_at` + trigger, og `mine_firmaer()`-helperen.
      Se Skema-status ovenfor.
- [x] **ASR-adapteren — BYGGET OG KALDT RIGTIGT 28/9.** `asr-adapter.js` +
      `proev-asr-adapter.js` (25 tørkørselstjek). Første rigtige kald: 163 sek.
      lyd, **6,09 øre**, svartid 9,3 sek. (forhold 1 : 17), 29 segmenter.
      **Prisenheden er dermed bekræftet mod en faktureret handling**, ikke mod en
      prisside — `kvote.js` kan regne på adapteren. Tal og konsekvenser i
      `asr-adapter.md`. Nøglen er `SCW_GENAI_SECRET_KEY` (omdøbt 2/10 fra `SCW_ASR_SECRET_KEY`;
      egen nøgle, ikke mailens — og nu delt med referatmodellen).
- [x] **Monter modulet — GJORT 28/9.** `routes/tilbud/index.js` (tom, én statusrute) + tænd
      `TILBUD_AKTIV` i staging. Prøveplanen kræver, at rollback-håndtaget prøves
      **i begge retninger**. ✅ **Crash-påstanden i `server.js` er efterprøvet
      28/9:** tændes flaget uden mappen, dør processen på `server.js:111` med
      `MODULE_NOT_FOUND` — **før `app.listen`**, så der tages aldrig en
      forespørgsel imod. Bemærk at de øvrige moduler har registreret sig og
      skrevet i loggen først: den ægte prøve på en lykkelig opstart er linjen
      `Tilbudsmodul: TAENDT`, ikke emoji-linjerne.
- [x] **TRANSSKRIPTIONS-ENDPOINTET — GRØNT I STAGING 1/10.**
      `POST /api/tilbud/transskriber` + `GET /api/tilbud/kvote` + `GET /api/tilbud/status`.
      **Målt:** én del = 163 sek. lyd, 6,09 øre, svartid 9,7 sek. (1:17) · to dele =
      324 sek., 12,11 øre, 19,2 sek. · rækkefølgen holder · én række i `ai_forbrug`
      pr. kald · **bogføringen stemmer på øren**, prøvet både lokalt og i staging.
      Afvisningerne prøvet: 402 ved firmaloft, 413 `del_for_stor`, 413 `upload_afvist`,
      400 `ingen_lyd`, 401. Varslet ved 80 % siges til én gang. `Kvoteafvisning` set i
      AppSignal på staging. **Fire fund undervejs, alle med konsekvenser:**
      **(a)** uploadgrænsen var sat for stramt — en RIGTIG optagelse på 10,5 MB blev
      afvist. Hævet til 30 MB, og delen og totalen er nu samme tal: *en diktering må
      fylde 30 MB, uanset hvordan den er delt.* Værste tilfælde 3,92 kr, under
      kaldsloftet ·
      **(b)** en manglende ASR-variabel blev meldt som `kvote_utilgaengelig`. Fejlkoder
      adskilt (`asr_ukonfigureret` · `kvote_ukonfigureret` · `kvote_utilgaengelig`), og
      `/api/tilbud/status` udstiller nu `konfigureret: { asr, kvote }`. **En fejlkode,
      der peger på den forkerte mekanisme, koster mere tid end ingen fejlkode** ·
      **(c)** AppSignal kan ikke starte lokalt på Windows (`extension failed to load`),
      også for `/test-appsignal`. **Alt, der skal efterprøves i AppSignal, efterprøves
      i staging.** Derfor larmer bremsen også gennem `console.warn` — den kanal virkede,
      da den anden ikke gjorde ·
      **(d)** se D68 nedenfor.
- [x] ~~Transskriptions-endpoint~~ (Scaleway, multipart webm+mp4, lyd slettes efter brug).
      ✅ **mp4 tages RÅT imod — byg ikke et omkodningstrin** (målt 26/9, `RESULTAT-05`).
      Læs formatet fra selve blobben: `recorder.mimeType` er tom streng på iOS.
      **Kvoten tjekkes på SAMLET lydtid, før første kald** — ikke pr. del, ellers
      kan en flerdelt diktering køre halvvejs og stoppe midt i.
      **Skalerer ventetiden:** tre dele ≈ 30 sekunders ventetid, så siden skal have
      en synlig arbejdstilstand og en knap, der slår sig fra ved første tryk —
      ellers sendes dikteringen to gange (dobbelt betaling, to referater).
      **Åbent:** skal adapterens timeout følge lydens længde? Se `asr-adapter.md`.
- [x] **REFERAT-ENDPOINTET — GRØNT I STAGING 5/10.**
      `POST /api/tilbud/referat`. Tekstadapter, kvote og teknik B samlet i én rute.
      **Målt:** 2.263 tegn transskription → 11-12 punkter, **6,00-7,22 øre**,
      13-17 sek. · én række i `ai_forbrug` pr. kald (`formaal='referat'`,
      `enhed='token'`) · **bogføringen stemmer på øren** i alle kørsler.
      Afvisningerne prøvet: 401 · 400 `ingen_tekst` · 413 `for_meget_tekst` ·
      402 `firma_dagsloft` · 502 `referat_ubrugeligt`. `Kvoteafvisning (referat)`
      set i AppSignal.
      **TO RUTER, IKKE ÉN — med vilje.** Lyd → tekst → referat kunne have været ét
      kald. Men han skal kunne SE transskriptionen og rette i den først: D14's fund
      fra 13/9 er, at referattrinnet retter nonsens i stilhed og lader rigtige ord
      på forkert plads stå — og gør dem SVÆRERE at opdage, fordi resultatet læser
      pænt. Mellemtrinnet er hans eneste chance for at fange USB-plader, der skulle
      have været OSB.
      **Variablerne** `TILBUD_REFERAT_LEVERANDOER` / `-URL` / `-MODEL` kom først ind
      i Railway staging og `.env.staging` her — ikke før ruten brugte dem.
      **To fund i koden, begge med konsekvenser:**
      **(a) Den bindende grænse stod et andet sted, end koden troede.**
      `express.json()` i `server.js` linje 19 er sat uden `limit` og bruger derfor
      Express' standard på 100 KB — global, og den kører længe før modulet monteres.
      Rutens egne 200.000 tegn kunne aldrig nås: en krop over 100 KB blev afvist med
      en **HTML-fejlside, som en klient ikke kan læse**. Grænsen er nu 60.000 tegn,
      sat med afstand under de 100 KB, så vores egen læselige fejl altid når først.
      Rutens egen parser er fjernet — den var død kode, der *lignede* en grænse, og
      det er værre end ingen grænse. Det kendte hul (stærkt komprimeret lyd kan give
      op mod 145.000 tegn) er bevidst efterladt med en præcis udløser: **først når en
      rigtig diktering afvises med `for_meget_tekst`, røres linje 19** — den gælder
      alle ruter, også webhooks ·
      **(b) Et fejlet kald kunne være betalt uden at nå hovedbogen.** Svarede
      leverandøren, men bestod svaret ikke formvalideringen, blev tokentallet smidt
      væk sammen med fejlen. **Loftet holdt altså ikke, når modellen fejlede:** en
      promptregression ville kunne brænde en kundes kvote usynligt. Fundet med et
      vrøvlinput, der kostede **33,70 øre, ingen kunne se**. Fejlen bærer nu prisen
      med sig de to steder, hvor den kastes EFTER et svar, og ruten bogfører den.
      Fejl kastet FØR et svar (timeout, 401, 403, netværk) bærer ingen pris — og så
      bogføres der ikke. **Vi gætter aldrig i hovedbogen.**
      **To fund i selve prøveplanen, og de er lige så dyre:**
      **(c)** trin 4 forventede vores `for_meget_tekst` ved 200.001 tegn. Den globale
      grænse bed først, og 413 så rigtigt ud med den forkerte afsender — **statuskoden
      alene siger ikke, hvem der afviste** ·
      **(d)** trin 7 forventede 402 på FØRSTE kald efter at loftet var sat ned. Forkert:
      det kald, der krydser grænsen, skal slippe igennem (Anns beslutning 29/9), og det
      næste bliver stoppet. **Der er to bremser med to formål:** kaldsloftet måles på
      værste tilfælde FØR kaldet og forhindrer én stor overraskelse; dags- og
      månedsloftet måles på det, der ALLEREDE er brugt, så han ikke mister en
      diktering, han lige har talt ind, fordi han manglede to øre.
      **En prøve, der forventer det forkerte, er lige så dyr som en fejl i koden** —
      den får den næste til at tro, at noget virker, der ikke gør, eller omvendt.
      Begge er rettet i `PROEVEPLAN-referat.md`.
      ⚠️ **Og modelnavnet `mistral-small-3.2-24b-instruct` fandtes ikke** (rigtig:
      `-2506`). Det stod i prislisten som et valg, og prisen vi regnede med var
      prisen på noget, der ikke eksisterede. Alias-vagten fanger navne uden version;
      tørkørslen har hverken netværk eller nøgle. Hullet lå mellem to værn, der hver
      især virkede. `node proev-tekst-adapter.js --modeller` slår nu listen op og
      sammenligner — gratis. Se D14.
- [x] ~~Claude-proxy-endpoint~~ (generisk; body-limit, billing-gate, dagsloft,
      forbrugslog, fail-pænt) — kun referat-prompten kobles på her.
      **Prompten er den ORDNÆRE** (besluttet 27/9): modellen må forkorte og
      strukturere, men ikke bytte ordene ud, og den retter ikke whispers fejl.
      **UDVIDET 2/10 — SAMLEDE PUNKTER.** To linjer tilføjet: *saml det, der
      hører sammen, i ét punkt* og *højst 15 punkter*. Anledningen var, at
      **3 af 7 referater blev afvist af P5 på "for mange punkter"** (24-25 mod
      grænsen på 20): modellen delte ét emne — én membran — op i fem linjer, så
      referatet blev næsten lige så langt som det, han selv sagde. Anne valgte
      mellem to eksempler side om side (`claude/referat-laengde-forslag.md`).
      **Målt efter ændringen: 7 af 7 bestod, punkter faldt fra 13-25 til 12-15,
      og teknik B's tal rørte sig ikke** — modellen købte altså ikke kortheden
      ved at omskrive. **Grænsen i prompten er 15, i valideringen 20; afstanden
      er med vilje — prompten sigter, valideringen spærrer.**
      Prisen faldt kun 4,4 % (7,01 → 6,70 øre): at samle fem punkter til ét
      fjerner ikke indholdet, det omarrangerer det. **Referatet blev ikke kortere
      — det blev bedre organiseret**, og det var også det, der blev bedt om.
      Begrundelse og pris i `tilbud-primer.md` og `RESULTAT-06-teknik-b.md`.
      Modelstrengen låses eksplicit i en miljøvariabel (D14), aldrig et alias.
- [x] **DEN SNÆVRE TEKNIK B — BYGGET OG MÅLT 1-2/10.** `teknik-b.js` +
      `proev-teknik-b.js` i repoet. **Median 0, max 2, tæthed 0,5 % i værste
      referat, nul falske alarmer, nul tal markeret** — alle fire kriterier fra
      målespecen godkendt. Mangler kun at blive koblet på ruten.
      ⚠️ **Tallene fra 27/9 (median 0, max 3) kunne ikke køres om:** scriptet var
      lavet ad hoc og findes hverken i prøvebænken eller i arkivet. Kun tallene
      overlevede. Derfor ligger målingen nu i repoet, og tallet hører til den kode,
      der faktisk udgives. Samme mønster som facitlisten, der viste sig ældre end
      dataene — og alvorligere her, fordi værnet er release-blokerende.
      ⚠️ **VÆRNET ER OGSÅ PRØVEN PÅ PROMPTEN** (fundet 1/10, bekræftet 2/10):
      begge målinger fangede modellen i at rette whispers `relædet` til `relæet`
      i stilhed — præcis det, den ordnære prompt blev valgt for at undgå.
      Konsekvensen står i D36. **Tætheden betyder to ting, ikke én.**
      **Rettet 2/10:** navnereglen gælder ikke i overskriften (en overskrift er
      ikke en sætning, så stort bogstav betyder intet dér), men tal og
      forkortelser tjekkes stadig. Fire selvtjek i prøvescriptet holder den regel
      fast, så den ikke kan fjernes ved en oprydning uden at noget siger fra.
- [x] **TEKNIK B KOBLET PÅ RUTEN — 3/10.** D36's bindende forudsætning, altså
      release-blokerende, og nu opfyldt. **Målt gennem ruten: 0 markeringer, 0 %
      tæthed** på to rigtige referater — og prøvescriptets fire selvtjek består, så
      nul betyder nul og ikke "værnet kiggede det forkerte sted". De to ser ens ud
      udefra, og det er netop derfor selvtjekkene kører før målingen.
      Prøvebænkens syv referater: median 0, max 2, værste tæthed 0,5 % — uændret.
      Værnet fandt **`USB-plademateriale`** og **`HPFI-relæ`**: præcis D14's farlige
      klasse, ord der findes og står forkert.
      **Værnet må aldrig kunne vælte referatet.** Det kører i try/catch i ruten: et
      referat, der er skrevet og betalt, skal ud til ham, også hvis markeringen
      fejler. Så står `taethed` som `null`, og prøvescriptet siger det højt.
      De tre regler står ved magt: Markér kun **tal, navne og
      forkortelser**, der ikke står i transskriptionen (den brede udgave er målt
      og forkastet: median 51 markeringer, en femtedel af teksten). Tre regler
      følger med:
      **(a)** markeringerne må aldrig præsenteres som "her er fejlene" — de er
      *"det her stod ikke i det, du sagde"*; en liste, der ligner en fuldstændig
      fejlliste, gør referatet mere troværdigt, og det var grunden til, at teknik
      A faldt · **(b)** sikkerhedsventil: overstiger markeringerne 10 % af
      referatets ord, vises der ikke enkeltsteder, men én besked om at læse hele
      referatet igennem · **(c)** tætheden (markeringer pr. 100 ord) logges pr.
      referat — efter tredive rigtige referater er den et mål for, hvordan
      modellen klarer ægte stemmer, og det er gratis at samle op.
- [x] **DATAFUNKTIONERNE — GRØNT I STAGING 10/10.** `routes/tilbud/data.js`
      (egen fil; `index.js` var 26 KB i forvejen). Ni ruter: kunder, opgaver og
      referater, hver med liste, oprettelse, opslag og rettelse. **23 tjek
      grønne** mod staging, uden at en model ringes op.
      **Serversiden er færdig; Annes ti funktionsnavne hører til klientsiden**
      (navne og kaldesteder bevares dér, se afsnittet i primeren) og kommer med
      PWA-siden.
      ⚠️ **EN OPGAVE OPRETTES UDEN OPKALD — beslutning B, 9/10 (Ann).**
      `/opret-opgave` i `server.js` laver en syntetisk `calls`-række med
      `from_number: "Manuel oprettelse"` for hver manuelt oprettet opgave. Det
      var den ENESTE måde at gøre opgaven synlig, dengang alle RLS-politikker på
      `leads` gik gennem `call_id` — og den sti blev lukket 7/10.
      **Begrundelsen for ikke at gentage omvejen er ikke, at `calls` holdes ren.
      Den er, at `leads.call_id` kun kan holde ÉN værdi.** Så længe opgavens
      identitet hænger på ét opkald, er der ingen plads, når kunden ringer igen
      om den samme opgave — og *"vi vil gerne kunne samle kundens opgaver"* var
      netop spørgsmålet, der afgjorde valget. Med `firm_id` som bærende nøgle
      bliver `call_id` valgfri og historisk, og et opkald kan senere pege på
      opgaven i stedet for omvendt. **B åbner døren; den går ikke selv igennem
      den** — selve ændringen hører i Trin 5 sammen med opkaldsmatchningen.
      **Tre ting er gjort strukturelle frem for huskede:** (a) ingen
      `{...req.body}` — hver ressource har en eksplicit feltliste · (b) hvert id
      fra klienten slås op MED firmafilteret først (`ejerskab.js`), så et ægte
      token ikke kan hænge et referat på et fremmed firmas opgave · (c) "findes
      ikke" og "er ikke din" svarer ens, så man ikke kan tælle sig frem til
      andres id'er.
      **Teknik B måles server-side ved gemning**, på `transskript` mod
      `ai_udkast` — ikke på tal fra klienten, og ikke på `indhold`, fordi tallet
      er et mål for MODELLEN. Fire nye kolonner bærer det (`ai_model`,
      `ai_prompt_version`, `teknik_b_markeringer`, `teknik_b_ord`, migration
      `20261009070000`): de to første lukker D14's "hvad skrev det her referat?",
      de to sidste indfrier D36's regel (c), som lovede logning uden at have et
      sted at logge til.
      **To ting er bevidst ikke med:** `status` på opgaver kan ikke rettes af
      modulet (værdierne deles med opkaldsflowet, og sættet er ikke skrevet ned
      — at sætte dem ville være at gætte på en anden del af produktet), og
      `transskript`/`ai_udkast` kan ikke rettes (kildemateriale; kunne de rettes,
      var sammenligningen med `indhold` intet værd).
- [ ] ⚠️ **`dashboard.html` henter stadig med `calls!inner` og kan derfor IKKE
      se en opgave uden opkald** (~linje 1472, og polleren ~2435 gør det samme).
      Kommentaren dér siger *"leads har ikke firm_id direkte"* — sandt da den
      blev skrevet, usandt siden 27/7. Skal skifte til `.eq("firm_id", ...)` med
      et almindeligt join. **Målt sikkert:** 5 af 5 i prod og alle i staging har
      `firm_id`, og `server.js` sætter den på begge indsættelsesveje (D21), så
      ingen række forsvinder. **Udløser: FØR modulet opretter opgaver i drift** —
      ellers får håndværkeren to lister med hver sin definition af sine egne
      opgaver. Prod-vendt fil i en anden chats område; koordineres, smides ikke ind.
- [ ] Ny PWA-side (ø-arkitektur, kun Kunder+Referater-fanerne aktive), SW-bump
- [ ] **Flyt optager-modulet ind:** `static/spike-optager.js` → `tilbud/optager.js`
      (bag `TILBUD_AKTIV`, så det ikke findes i prod). Modulet er bygget og målt
      26/9 — se D66. Fanen kalder `start()`, `fortsaet()`, `stop()` og handler på
      `ok` / `kanBruges`.
- [ ] **Sammensæt delene:** hver del transskriberes for sig, og teksterne sættes
      sammen i rækkefølge FØR referatmodellen ser dem. Kvoten tæller samlet
      lydtid på tværs af dele. Invarianterne står i `tilbud-primer.md`.
- [ ] ⚠️ **MÅL PERMISSION-FLOWET IGEN i dashboardets egen app.** iOS husker
      mikrofon-tilladelsen **pr. installeret app**, og Spike 0 blev målt i to
      andre installationer (`/spike0.html` og prøvebænken). Det, vi ved derfra,
      gælder ikke automatisk her. **Målingen:** installer dashboardet på
      hjemmeskærmen, luk appen helt, åbn den, og start én optagelse. Spørger den
      om lov? Og spørger den igen ved næste optagelse? Svaret afgør onboarding-
      teksten — og det er dyrt at opdage dagen før frigivelse.
- [ ] Anne QA på staging → derefter prod. ⚠️ **"Derefter prod" betyder: når Fase
      1's fem gates er lukket** (Ø2, S6, J8, J9, D36's teknik B — se
      faseopdelingen øverst). Grøn QA er ikke en frigivelse.

## Trin 3b — Skive 1b: fotovejen (del af Fase 1)

Håndværkere skriver på papir. Uden denne vej rammer Fase 1 kun den halvdel, der
taler. **Byggerækkefølge: diktafonvejen først, fotovejen ovenpå — men begge
frigives som Fase 1.** Arkitekturen står i primerens "Håndskrevne noter".

*Skrevet 27/9. Fotovejen var en Fase 1-gate uden opgavelinjer i noget Trin —
harmløst, indtil Fase 1 begyndte at blive bygget.*

- [ ] **`/api/tilbud/notefoto` returnerer NØJAGTIG samme JSON som
      `/api/tilbud/referat`.** Det er den bærende regel: visning, rettelse, gem og
      genfind er uændret, og der ligger ikke to slags referater i basen.
- [ ] **Vision-model vælges på måling, ikke på skøn** (J9 + D14). Kvalitetssættet
      findes: **elleve fotos, taget 27/9, ligger i `proevebaenk\referatfoto\`**.
      Beskrivelsen og de kendte vanskeligheder står i `FOTOSAETTET.md` — udfyld
      den, før målingen køres, af samme grund som `SAETTET.md` for lyden.
      **Tre ting, målingen SKAL dække, fundet ved at se på fotoerne:**
      **(a) Alle elleve ligger på siden.** Sedlen er på højkant, fotoet på tværs,
      og teksten løber nedefra og op. Sådan fotograferer man en notesbog. Kan
      modellen læse roteret håndskrift — eller skal klienten rette op først?
      **(b) Overstregninger.** På referat 10 er "450" streget ud og rettet til
      "380 m³". Modellen skal læse det rettede tal. **Det er præcis den slags,
      der bliver til en forkert pris.**
      **(c) Gennemskrivning fra forrige side.** Spøgelsesskrift bag den rigtige
      tekst. En model kan finde på at læse begge dele som ét.
- [ ] **KLIENTEN SKAL NEDSKALERE — det er ikke længere et åbent spørgsmål.**
      De elleve rigtige sedler blev fotograferet 27/9: **5712 × 4284, 24,5 MP,
      5,5-6,9 MB pr. styk.** Base64 af det er cirka **8 MB pr. kald**. Spike 0's
      foto var 12 MP og 2,3 MB — nyere telefoner skyder større, og det er ikke
      noget, vi kan regne med bliver mindre.
      **Målt samme dag: nedskaleret til 1500 px på den lange led fylder de
      250-340 KB, og håndskriften er stadig fuldt læsbar** (Claude læste dem i
      den størrelse). Det er en faktor 20.
      **Sæt derfor body-limit'en lavt og bevidst** — omkring 1 MB, ikke 8 — og
      lad klienten skalere først. Et loft på 8 MB er ikke et loft; det er en
      invitation.
- [ ] **Referattrinnet er formentlig unødvendigt i Fase 1.** De rigtige sedler er
      **12-15 linjer, cirka 45-55 ord** (målt på fem af de elleve 27/9).
      Materialet i `10_moedesituationer...docx` var 66-81 ord — håndskriften er en
      tredjedel kortere, fordi folk forkorter: *"Fremløbstemp 62°"* i stedet for
      en hel sætning. **Der er ikke noget at sammenfatte.**
      **Regel: under 150 ord ER afskriften referatet.** Linjerne bliver punkterne,
      teksten bliver fritekst, systemet sætter overskriften. Ingen model nummer to,
      ingen opfindelse, og teknik B har intet at markere.
      Grænsen er sat højt med vilje: fejler vi, skal vi fejle mod **afskrift**, som
      ikke kan finde på noget. Et referat af en kort seddel kan.
      **Overvej at droppe referattrinnet helt i Fase 1** og lade det vente på en
      seddel, der beviser sit eget behov.
- [ ] **Fotoet gemmes ALDRIG.** Læs → udtræk tekst → smid billedet væk. Samme
      regel som lyden.
- [ ] **Datoen sættes af systemet ved upload, aldrig af modellen.** Står der en
      dato på papiret, må den stå i teksten; rækkens dato er systemets.
- [ ] **Ø2 genberegnes.** `OE2-budgetloft-beregner.xlsx` er regnet på lyd + tekst.
      Billedkald koster mere, og loftet skal flyttes, før vejen åbnes.
- [ ] Klientsiden er billig og målt: `<input type="file" accept="image/*"
      capture="environment">` åbner kameraet på både iOS og Android uden
      `MediaRecorder`. Virker, giver JPEG, ingen HEIC (Spike 0, 26/9).
- [ ] Anne QA på staging.
- [ ] ⚠️ **Teknik B gælder ikke her.** Der findes ingen transskription at holde
      referatet op mod — sedlen ER kilden. Fotovejen har altså ikke det værn,
      diktafonvejen har. **Det skal stå i D36, og Anne skal vide det**, før vejen
      frigives.

## Trin 4 — Skive 2: tilbudsflowet

- [x] **Migration B — KØRT staging + prod 27/7.** `tilbud` med frysningsfelter fra
      dag ét (summer på selve tilbuddet, `version`, `sendt_at`), `tilbud_linjer`
      (numeric hele vejen, genereret `linje_sum`), `firma_profil` (én række pr.
      firma), `standardfelter` (pr. firma, ikke globalt). RLS på alle fem
- [x] ✅ **KØRT staging + prod 1/10, smoke 12/12 i begge.** **`firma_profil`-rækken oprettes af en trigger på `firms` (D68, fundet 1/10).**
      Tabellen var **tom i både staging og prod**: Migration B oprettede den 27/7, men
      ingen kode indsatte nogensinde en række. **Dette trin kan ikke bygges uden den:**
      `timepris`, `moms_sats`, `standard_betingelser` og `ai_tone` bor dér, og uden
      rækken får kunden et tilbud uden priser.
      **Besluttet 1/10 (Ann): trigger, ikke kode i `provisionFirm`.** Mindst tre veje
      opretter et firma (webhooken, `provision-test-firm.js`, håndskrevet SQL); en
      trigger dækker dem alle, også dem der ikke findes endnu.
      **Bygget 1/10, ikke kørt:** `Claude outputs\2026-10-01-firma-profil\` —
      migration `20261001120000_firma_profil_ved_oprettelse.sql` (trigger +
      engangsudfyldning + værnet `firma_profil_komplet()`) og `smoke.js` med tjekket
      "Hvert firma har en firma_profil (D68)".
      **Rækkefølge:** `aflever.ps1` → commit → `push-staging.ps1` → `npm run smoke`
      (D68: OK) → opret ét testfirma og mål `select count(*) from firma_profil where
      firm_id = '<id>'` = 1 → `push-prod.ps1` → `npm run smoke:prod` (D68: OK).
      Indtil prod-migrationen er kørt, viser `smoke:prod` ADV for D68 — ikke rødt.
      **Målt 1/10:** et testfirma indsat direkte i `firms` (uden om Node) fik sin profil — 1 række.
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
