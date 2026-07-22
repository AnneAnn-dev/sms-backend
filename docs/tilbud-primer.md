# Tilbudsmodul — primer (arkitekturbeslutninger)

Besluttet af Ann i samråd med Claude, juli 2026, på baggrund af Annes handoff
(`tilbud-modul-handoff-til-ann.md`) og prototypen (`referater-app.html`).
Dette dokument er autoritativt for HVAD og HVORFOR. Rækkefølge og opgaver: se `tilbud-runbook.md`.

## Hvad modulet er

Produktområde nr. 2: mødereferater og tilbud for håndværkere. Fire faner (Kunder,
Referater, Tilbud, Indstillinger) som ny side i den eksisterende PWA. AI-assisteret:
tale-til-tekst af møder, referatudkast, tilbudsudkast ud fra referat + firmaprofil,
PDF-eksport. Annes prototype definerer UI og flow; grænsefladen mod backend er de
10 datafunktioner + 2 stubbe + 3 AI-kald beskrevet i handoffet.

## Datamodel — besluttet

**Hierarki: Kunde → Opgave → (Referater, Tilbud, Billeder, Beskeder).**

1. **`leads`-tabellen ER opgave-tabellen.** Der oprettes ingen separat opgavetabel.
   `leads` udvides med `kunde_id` (nullable, FK til `kunder`). "Opgave" er det nye
   produktord for et lead. Eksisterende pilotleads må stå kundeløse — der findes
   ingen kunder endnu, så ingen backfill.
2. **Referater og tilbud er BØRN af opgaven** — egne tabeller med `lead_id`,
   præcis som `lead_images` og `messages` i dag. Én opgave kan have flere referater
   og flere tilbudsversioner. De er ikke kolonner på leadet.
3. **Nye tabeller:** `kunder`, `referater`, `tilbud` (+ evt. `tilbud_linjer`),
   `firma_profil`, `standardfelter`. Alle med RLS fra FØRSTE migration
   (SELECT-mønster: opslag via `firm_users`; skrivning server-side som `messages`).
4. **Databasen ejer id'erne (uuid).** Prototypens klientgenererede id'er er ikke sandheden.
5. **Opkald nr. 2 fra kendt nummer = samme kunde, NY opgave. Altid.** Simpelt og
   forudsigeligt; haandvaerkeren kan selv flytte/slette. (Afventer Annes endelige nik.)
6. **`kunder.telefon`: unique constraint pr. firma fra dag ét**, og opslag skrives
   robust (aldrig `.single()` uden fallback). Dette lukker opkaldsmatchings-spøgelset
   (jf. dublet-leads og /opkald-hændelsen 28/6 — samme fejlklasse: manglende constraint).

## De 10 datafunktioner — besluttet

Annes funktionsnavne og kaldesteder BEVARES, men indmaden skrives om fra
"gem hele listen" til **operationer pr. række** (insert/update/delete på id).

Hvorfor: hele-listen-gem giver last-write-wins mellem to åbne skærme (telefon +
iPad, eller mester + svend) → **tavst datatab** — den farligste fejlklasse, usynlig
i test med én bruger. Konsekvens: de steder i prototypen, der "sletter" ved at
filtrere listen og gemme resten, skrives om til eksplicitte delete-kald.

## Transskription — besluttet

- **Scaleway (EU) frem for OpenAI.** Skal verificeres (whisper-modeller i Scaleways
  Generative APIs) FØR endpointet designes. Fallback-kandidat: Mistral Voxtral (FR).
  OpenAI direkte er fravalgt pga. EU-princippet.
- Endpoint modtager multipart-lyd. **Håndtér både webm (Android/Chrome) og mp4
  (iPhone).** Fornuftig størrelsesgrænse. Bearer-auth, firm_id fra token.
- **Lyd gemmes ALDRIG.** Optag → transskribér → smid lydfilen væk. Kun tekst og
  referat består. Det er vores vigtigste GDPR-håndtag (ingen arkiv af
  stemmeoptagelser af tredjeparter).
- Samtykke: UI-tekst i optageren ("Husk at fortælle mødedeltagerne, at du optager").
  Lovligt i DK at optage samtaler, man selv deltager i; UI-teksten er god skik.

## Claude-proxy (3 AI-kald) — besluttet

- **Ét generisk endpoint** bærer alle tre kald (referatudkast, tilbudsudkast, notefoto).
- **JSON-body-limit hæves bevidst og bounded på netop denne rute** (Express-default
  er 100 kb — base64-billeder sprænger den).
- **Gate på `billing_status`** som `/opkald` — opsagte firmaer brænder ikke tokens.
- **Dagligt loft pr. firma** (sikring mod amok-klient/misbrug; rammer aldrig normal brug).
- **Forbrugslog pr. firma** (antal kald, tokens) — så prismodel senere kan besluttes
  på data, ikke gæt. Ingen forbrugsbetaling nu.
- **Fail pænt:** strip kodeblok-hegn → parse → retry én gang → ellers ren dansk
  fejlbesked til appen ("Kunne ikke tolke udkastet — prøv igen"). Råt AI-svar logges
  KUN server-side. Aldrig stacktrace/råt output til håndværkeren, aldrig halvt
  parset data gemt.
- **Anthropic (US) er en bevidst accepteret undtagelse fra EU-princippet — indtil videre.**
  DPA-listen i GDPR-punktet opdateres med Anthropic + transskriptionsleverandøren.

## Tilbud & frysning — besluttet

`tilbud`-tabellen er **selvbærende**: alle værdier fra firmaprofilen, der indgår
(timepriser, moms, kørselssats, betingelser, garanti), gemmes som KOPI på
tilbudsrækken. Ved status = godkendt LÅSES felterne. Man joiner ALDRIG tilbage til
`firma_profil` for at vise et eksisterende tilbud. Et godkendt tilbud fra marts med
timepris 450 viser 450 for evigt, uanset hvad profilen siger i maj.
Skal med fra første migration (kan ikke eftermonteres) — **og frysningen skal testes**
(ret profilen, genåbn gammelt tilbud, verificér uændrede tal).

## Frontend — besluttet

- Ny side i den eksisterende PWA. Tips-siden viger midlertidigt (Annes beslutning;
  flyttes til profilsiden senere).
- Bygges som **selvstændig ø** (app-hilsen-mønsteret): kan under ingen omstændigheder
  vælte dashboardet. Alt DOM via setText-mønsteret; mikrofon-/permission-API'er
  feature-detected + try/catch.
- SW-cacheversion bumpes ved deploy. Mobilfeatures røgtestes i den INSTALLEREDE
  app på ægte iPhone (standalone-mode har egne fælder — jf. hvid skærm/Notification).
- PDF genereres client-side med jsPDF som i prototypen (overvej selv-hosting af
  biblioteket frem for cdnjs, jf. EU-princip — lav prioritet).

## Økonomisystem-integration — besluttet: UDSKUDT

Kommer EFTER at referat + tilbud + PDF kører hos piloterne. Hver håndværkers EGET
system (OAuth pr. kundefirma, tokenopbevaring, feltmapping) er et selvstændigt
projekt. Indtil da: `sendTilOekonomisystem` fejler pænt eller skjules bag feature
flag. PDF-download dækker langt størstedelen af værdien.

## Kendte fælder (læs før kode)

1. **iOS standalone-PWA + mikrofon** er ukendt terræn med buggy historik →
   spike FØRST (se runbook). Estimatets største usikkerhed.
2. **Express body-limit** (100 kb) vs. base64-billeder — rammes øjeblikkeligt.
3. **Dublet-kunder på samme nummer** uden constraint → tavse `.single()`-fejl.
4. **Expand/contract på `leads`** — der ligger ægte pilotdata; nyt tilføjes nullable,
   intet eksisterende røres i samme deploy som koden.
5. **Hele-listen-gem** → tavst datatab (se datafunktioner ovenfor).

## Estimat (juli 2026)

4-6 ugers reelt arbejde uden økonomisystemet; 2-2,5 måneder i kalendertid, fordi
pilotsupport har forrang. Største skrid-risiko: PWA/mikrofon-sporet.
