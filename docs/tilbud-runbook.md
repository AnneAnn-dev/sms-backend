# Tilbudsmodul — runbook (rækkefølge og opgaver)

Arkitektur og begrundelser: se `tilbud-primer.md`. Denne fil er opgavelisten.
Arbejdsform: Claude Code, lodrette skiver, feature branches, plan mode ved
flerfilsopgaver, `/clear` mellem opgaver, `/usage` efter hver opgave de første uger.

## Grundregel: piloterne har forrang

Pilot-support må afbryde modularbejdet — men i faste vinduer (morgen + sen
eftermiddag), ikke løbende. Ægte brande undtaget.

## Trin 0 — FØR modulet (pilot-sporet, fra drift-runbooken)

- [ ] iPhone-røgtest af redningsvejen (gater prod-deploy af mail.js/dashboard.html)
- [ ] Prod-nummerpulje tjekket/fyldt FØR første pilot provisioneres
- [ ] **Manifest-opgaven: `short_name` → "Dit Kontor" + SW-versionsbump.**
      Kørt som Claude Code session 2 (første rigtige opgave, feature branch
      `fix/manifest-short-name`, lille diff, fuldt review). Derefter: PWA slettes
      og geninstalleres på begge iPhones.
- [ ] Frisbii staging-oprydning (jf. drift-runbook)

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
