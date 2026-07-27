# Tilbudsmodul — runbook (rækkefølge og opgaver)

Arkitektur og begrundelser: se `tilbud-primer.md`. Denne fil er opgavelisten.
Arbejdsform: Claude Code, lodrette skiver, feature branches, plan mode ved
flerfilsopgaver, `/clear` mellem opgaver, `/usage` efter hver opgave de første uger.

## Grundregel: piloterne har forrang

Pilot-support må afbryde modularbejdet — men i faste vinduer (morgen + sen
eftermiddag), ikke løbende. Ægte brande undtaget.

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
- [ ] **Opgave: `smoke-staging.js` — røgtest som definition af færdig.**
      Branch `feat/smoke-staging`. Ét script, ét samlet grønt/rødt resultat.
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

## Trin 1 — Beslutninger der lukkes FØR kode

- [ ] **Scaleway-verifikation:** findes whisper-transskription i deres Generative
      APIs, EU-region, pris, filformater, størrelsesgrænser? (NO-GO → Mistral Voxtral.)
- [ ] Annes nik: "opkald nr. 2 fra kendt nummer = ny opgave, altid"
- [ ] Anne: indhold af STANDARDFELTER pr. branche (felter + brancher)
- [ ] Anne: samtykke-tekst i optager-UI
- [ ] DPA-liste + privatlivspolitik: tilføj Anthropic + transskriptionsleverandør

## Trin 2 — Spike 0: mikrofonen (GO/NO-GO, ½–1 dag)

Minimal testside i staging-PWA'en: getUserMedia + MediaRecorder + upload af blob.
Testes i den **installerede** app på ægte iPhone (ikke kun Safari). Verificér:
permission-flow, optagelse, mp4-blob, upload. Fejler dette, ændres planen NU
(fx upload af lydfil optaget i iPhones egen app som fallback) — ikke i uge 4.

## Trin 3 — Skive 1: referatflowet ende-til-ende

Mål: Anne kan oprette kunde+opgave, optage/uploade lyd, få transskript, få
AI-referatudkast, rette, gemme og genfinde det — på staging.

- [ ] Migration A (staging → røgtest → prod): `kunder`, `leads.kunde_id`
      (nullable), `referater`. RLS på alt. Unique på kunder(firm_id, telefon).
- [ ] Transskriptions-endpoint (Scaleway, multipart webm+mp4, lyd slettes efter brug)
- [ ] Claude-proxy-endpoint (generisk; body-limit, billing-gate, dagsloft,
      forbrugslog, fail-pænt) — kun referat-prompten kobles på her
- [ ] Datafunktioner for kunder/opgaver/referater (per-række CRUD bag Annes navne)
- [ ] Ny PWA-side (ø-arkitektur, kun Kunder+Referater-fanerne aktive), SW-bump
- [ ] Anne QA på staging → derefter prod

## Trin 4 — Skive 2: tilbudsflowet

- [ ] Migration B: `tilbud` (med frysningsfelter fra dag ét), `firma_profil`,
      `standardfelter`
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
