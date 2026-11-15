# Drejebog: staging-toget i produktion (Fase 4 Skrivehjælp m.m.)

Skrevet 16/11-26 ud fra `origin/staging` = `6aea97d` og `origin/main..origin/staging` (ca. 70 commits, 54 filer).
Ann udfører hvert trin. Claude skriver ikke i sms-backend og rører ikke prod.

## Hvad der kommer i prod

| Gruppe | Indhold | Risiko | Testes i trin |
|---|---|---|---|
| Skrivehjælp (Fase 4) | ruter, prompt 2026-11-15, format, kvote med puljer, Værktøjer-fanen, jeg/vi | Lav: bag `SKRIVEHJAELP_AKTIV` (slukket ved deploy) | 5 |
| Fase 3, Køb | nyt forsøg uden kompensation ved Frisbii code 215 (kun 100 % rabat, kun tilkøb straks) | Middel | 4 |
| Pakker i kataloget | "Kundehenvendelser og SoMe" (`modul-svar-some`) som vare, `saelges: false` | Lav: vises som "Kommer snart" | 4 |
| D2 T2/T3 | kunde-SMS og POST /formular flyttet til `kunde-sms.js` og `formular-rute.js` (uændret) | Middel: kerneflowet | 4 |
| Dependabot | dotenv 17 → 18, fire produktionspakker, GitHub Actions | Lav: Railway sætter miljøet selv; dotenv bruges kun lokalt | 4 |
| Små ting | `mail.js` (pakkens navn i mails), `phone.js` (visDanskTlf), `opgave-felter.js` (flyttet), docs | Lav | 4 |
| Migrationer | `20261105120000_ai_forbrug_skrivehjaelp`, `20261108120000_firma_profil_skrivehjaelp`, `20261115120000_firma_profil_skrive_form` | Lav: tilføjer kun | 2 |

Prod har migrationerne til og med `20261030120000` (målt i prod-projektets SQL-editor 16/11).

## Før start: to svar fra Ann

- [ ] Hvordan lagde du migrationerne i prod ved Fase 3 (2/11)? Brug samme vej i trin 2, hvis den er en anden end den, der står der.
- [ ] Hvordan gav du Nillis NixBix adgang til Skrivehjælp på staging? Samme vej bruges i trin 5. Tjek, at Frisbii-synken (`FASE3_SYNK`) ikke fjerner adgangen igen ved næste event.

## Trin 1 — Variabler i Railway (prod), FØR deployet

Sæt dem nu. Railway genstarter den nuværende kode, og den læser dem ikke; det er ufarligt.

| Variabel | Værdi |
|---|---|
| `SKRIVEHJAELP_AKTIV` | `false` (kun ordet `true` tænder) |
| `SKRIVEHJAELP_MODEL` | `mistral-medium-3.5-128b` |
| `SCW_GENAI_SECRET_KEY` | secret key fra IAM-applikationen `ddk-prod-skrivehjaelp` (kun `GenerativeApisModelAccess`, scope "referater produktion") |
| `TILBUD_REFERAT_LEVERANDOER` | `scaleway` |
| `TILBUD_REFERAT_URL` | `https://api.scaleway.ai/<projekt-id for "referater produktion">/v1` — IKKE staging-URL'en |
| `TILBUD_REFERAT_MODEL` | som i staging |
| `AI_KALD_LOFT_DKK`, `AI_GLOBALT_MAANEDSLOFT_DKK` | som i staging |
| `AI_FIRMA_MAANEDSLOFT_DKK`, `AI_FIRMA_DAGSLOFT_DKK` | som i staging |
| `AI_SVAR_MAANEDSLOFT_DKK`, `AI_SVAR_DAGSLOFT_DKK` | 50 og 3 (Anns beslutning), tjek mod staging |
| `AI_FACEBOOK_MAANEDSLOFT_DKK`, `AI_FACEBOOK_DAGSLOFT_DKK` | 50 og 3, tjek mod staging |

- [ ] Alle 14 findes i prod-miljøet. Mangler et loft, svarer Skrivehjælp `kvote_ukonfigureret` (fail-closed).
- [ ] Nøglen ejes af applikationen, ikke af en bruger (Scaleway → IAM → API keys).

## Trin 2 — Migrationerne i prod

⚠️ `skift-prod.ps1` skifter `.env`, men IKKE Supabase-CLI'ens link. `supabase\.temp\project-ref` var stadig staging (`hehrvdmtzokzbnbihcel`) efter `skift-prod.ps1` 16/11. Uden trin 2a rammer `db push` staging.

**2a. Peg CLI'en på prod og kontrollér**
```
cd C:\Users\Bruger\sms-backend
git switch staging ; git pull
npx supabase link --project-ref glymuxqtrbpeyzmflilf
Get-Content supabase\.temp\project-ref
npx supabase migration list
```
- [ ] project-ref er `glymuxqtrbpeyzmflilf`.
- [ ] Kun de tre migrationer ovenfor mangler i kolonnen Remote. Mangler andre, så stop.

**2b. Læg dem på**
```
npx supabase db push
```
- [ ] Den nævner præcis de tre filer og ingen nulstilling. Ellers svar nej.

**2c. Kontrollér i prod-projektets SQL-editor**
```sql
select version from supabase_migrations.schema_migrations order by version desc limit 3;
-- 20261115120000, 20261108120000, 20261105120000

select column_name, data_type, column_default, is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'firma_profil'
  and column_name in ('branche', 'afsender_navn', 'afsender_telefon', 'skrive_form') order by column_name;
-- fire rækker; skrive_form: text, 'jeg'::text, NO
```
- [ ] Kør også "Kontrol efter kørsel" nederst i `20261105120000_ai_forbrug_skrivehjaelp.sql`.

**2d. Tilbage til staging — med det samme**
```
npx supabase link --project-ref hehrvdmtzokzbnbihcel
Get-Content supabase\.temp\project-ref
.\skift-staging.ps1
```
- [ ] project-ref er `hehrvdmtzokzbnbihcel`, og `skift-staging.ps1` er grøn.

Migrationerne tilføjer kun kolonner og formål. Den kode, der kører i prod nu, ser ikke dem og påvirkes ikke.

## Trin 3 — Deploy: staging ind i main

```
git fetch origin
git log --oneline -1 origin/staging        # 6aea97d
gh pr create --base main --head staging --title "Staging-toget 16/11: Fase 4 Skrivehjælp, Køb code 215, D2 T2/T3, Dependabot"
```
- [ ] CI er grøn på PR'en (kor-proever, inkl. proev-skrivehjaelp*, proev-kunde-sms, proev-formular-rute, proev-frisbii-*).
- [ ] Flet PR'en som merge commit (ikke squash), samme måde som Fase 3-toget.
- [ ] Railway prod: det nye deploy står som **Active**.
- [ ] Loggen ved opstart viser `Tilbudsmodul: SLUKKET` og `Skrivehjaelp: SLUKKET`.

## Trin 4 — Røgtest i prod (Skrivehjælp stadig slukket)

- [ ] Appen: luk den helt og åbn igen. Den henter `dashboard-v76`. Opgaver og Kunder vises som før.
- [ ] Kerneflowet: ring til dit prod-testnummer og læg på → SMS'en kommer som ét stykke med et link, der virker → udfyld formularen → opgaven står i appen med adresse og overskrift.
- [ ] Profil → Din pakke vises uden fejl. "Kundehenvendelser og SoMe" står som "Kommer snart · 200 kr./md.". Telefonpasser og Referat som før.
- [ ] Værktøjer-fanen viser "Skrivehjælpen er på vej" (eller ingenting) for et firma uden modulet.
- [ ] AppSignal efter 15 minutter: ingen nye fejlgrupper. Fraværet af fejl lige efter deployet beviser intet (AppSignal er flere minutter bagud) — se igen efter det første rigtige opkald.

Køb med rigtige penge prøves ikke her. Code 215-rettelsen gælder kun abonnementer med 100 % rabat og blev målt på staging 8/11.

## Trin 5 — Tænd Skrivehjælp

- [ ] Railway prod: `SKRIVEHJAELP_AKTIV` = `true`. Vent på **Active**.
- [ ] Loggen viser `Skrivehjaelp: TAENDT` og `✍  Skrivehjælp registreret paa /api/skrivehjaelp`.
- [ ] Giv dit eget prod-firma modulerne `svar` og `facebook` (samme vej som på staging, se "Før start").
- [ ] Værktøjer: profilen spørger om navn, nummer, "Skriv som" og branche. Gem.
- [ ] Svar til en kunde (SMS) i jeg-form: tre afsnit, ingen afslutning efter et spørgsmål, Annes indledning.
- [ ] Skift til Vi, gem, samme besked: vi-form.
- [ ] Ét opslag og ét kommentarsvar virker.
- [ ] I prod-projektets SQL-editor: der er rækker i `ai_forbrug` med formål `skrivehjaelp_*` og en pris.

## Trin 6 — Salg (senere, egen runde)

Pakken kan ikke købes, før dette er gjort. Indtil da står den som "Kommer snart".

1. Frisbii **test**: opret add-on `modul-svar-some`, "Kundehenvendelser og SoMe", 200 kr. ekskl. moms (25 %).
2. Kode: `saelges: true` for `svar-some` i `frisbii-katalog.js`, via staging. Køb prøves på staging.
3. Frisbii **live**: samme add-on. Derefter koden i prod.
4. Tjek, at `betaling.html` ikke tilbyder pakken, før punkt 3 er færdigt.

## Tilbagerulning

| Problem | Gør |
|---|---|
| Skrivehjælp opfører sig forkert | `SKRIVEHJAELP_AKTIV` = `false`. Ruterne forsvinder; intet andet ændres. |
| Kerneflow, Køb eller andet fra toget | Railway prod → Deployments → redeploy det forrige deploy. Bagefter `git revert -m 1 <merge-commit>` på main, så main passer med det, der kører. |
| Migrationerne | Bliver liggende. De tilføjer kun, og den gamle kode ser dem ikke. |

## Bagefter

- [ ] Flet `origin/main` tilbage i staging, som efter Fase 3-toget.
- [ ] Risikoregistret (Ann skriver, efter "Redigeres nu"-linjen): Fase 4 i prod med flaget tændt; P5 delvist lukket (fast kode fjerner form, prompten holder fakta; 11 af 20 "Ja" hos Anne 14/11, resten mest svarmuligheder); faldgruben om Supabase-CLI'ens link efter `skift-prod.ps1`.
- [ ] Commit drejebogen og registret, før næste opgave.
