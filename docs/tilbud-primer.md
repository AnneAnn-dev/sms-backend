# Tilbudsmodul — primer (arkitekturbeslutninger)

Besluttet af Ann i samråd med Claude, juli 2026, på baggrund af Annes handoff
(`tilbud-modul-handoff-til-ann.md`) og prototypen (`referater-app.html`).
Dette dokument er autoritativt for HVAD og HVORFOR. Rækkefølge og opgaver: se `tilbud-runbook.md`.

## Hvad modulet er

Produktområde nr. 2: referater og tilbud for håndværkere. Fire faner (Kunder,
Referater, Tilbud, Indstillinger) som ny side i den eksisterende PWA. AI-assisteret:
tale-til-tekst af håndværkerens **egen indtaling**, referatudkast, tilbudsudkast ud
fra referat + firmaprofil, PDF-eksport. Annes prototype definerer UI og flow;
grænsefladen mod backend er de 10 datafunktioner + 2 stubbe + 3 AI-kald beskrevet
i handoffet.

**Referat-fanen er en diktafon, ikke en mødeoptager** (J8, fælles beslutning 19/8).
"Kundemøde" findes ikke som valgmulighed i UI'et — kun "Noter". Se
"Samtykke og afgrænsning" nedenfor; afgrænsningen er bindende for både UI, prompts
og markedsføring.

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

- **Scaleway (EU) frem for OpenAI — VALGT af Ann 28/8.** Fallback-kandidat var
  Mistral Voxtral (FR); OpenAI direkte er fravalgt pga. EU-princippet.
  Modellen er `whisper-large-v3` på `POST /v1/audio/transcriptions`.
  ⚠️ **Valget af leverandør er truffet — verifikationen er ikke gennemført.**
  Pris, størrelsesgrænser og dansk kvalitet mangler stadig at blive målt.
- Endpoint modtager multipart-lyd. **Håndtér både webm (Android/Chrome) og mp4
  (iPhone).** Fornuftig størrelsesgrænse. Bearer-auth, firm_id fra token.
  ⚠️ **Formatfælde, fundet 28/8:** Scaleways audio-API angiver i sin offentlige
  API-reference `wav, mp3, flac, mpga, oga, ogg` — **hverken webm eller mp4/m4a**,
  altså præcis det, `MediaRecorder` producerer i PWA'en. Holder det ved kontrol i
  konsollen, skal der et transkodningstrin (fx ffmpeg på Railway) ind mellem upload
  og transskription. Det er nyt arbejde, en ny afhængighed, og det ændrer
  succeskriteriet for Spike 0. **Skal afklares før endpointet designes.**
- **Lyd gemmes ALDRIG.** Optag → transskribér → smid lydfilen væk. Kun tekst og
  referat består. Det er vores vigtigste GDPR-håndtag (ingen arkiv af
  stemmeoptagelser af tredjeparter).

## Samtykke og afgrænsning — besluttet (J8)

**Rettet 28/8.** Dette afsnit erstatter primerens oprindelige samtykke-linje
("Husk at fortælle mødedeltagerne, at du optager"), som beskrev en mødeoptager.
Den beskrivelse er ikke længere gældende.

- **Referat-fanen er afgrænset til egen-diktering** (fælles beslutning 19/8).
  "Kundemøde" er fjernet som valgmulighed; kun "Noter" er tilbage. Restrisikoen er
  **misbrug** — at håndværkeren optager et møde alligevel — ikke en manglende
  samtykkemekanik. Derfor er værnet tekst og ansvarsplacering, ikke en samtykkeskærm.
- **Tre tekster er release-blokerende for diktafonen.** Godkendt af Anne 26/8;
  implementering i koden udestår. Ordlyden er den godkendte:
  1. **Advarsel ved optageknappen:** "Kun dine egne noter. Nævnes andre, er det dit
     ansvar, at de ved det."
  2. **Uddybning i onboarding:** "Referat-fanen er til dine egne noter — ikke til at
     optage kundemøder. Du taler frit ind, og vi laver et referat af det, du selv
     siger. Nævner du andre i optagelsen, en kollega, en kunde, er det dig, der har
     ansvaret for at fortælle dem, at du optager."
  3. **Linje i vilkårene:** "Referat-funktionen ('Noter') er til brugerens egne
     notater. Nævnes tredjeparter i en optagelse, er det brugerens eget ansvar at
     oplyse dem om det — Dit Digitale Kontor indhenter ikke samtykke på
     tredjeparters vegne."
- **Konsekvens for CLAUDE.md's tilbuds-invariant.** Invarianten siger "tvungen
  samtykkeskærm i produktet, ikke en linje i vilkårene". Den blev skrevet, da fanen
  stadig var en mødeoptager. Med tredjeparter udelukket fra optagelse er der ikke
  længere en tredjepart at indhente samtykke fra — værnet er flyttet fra en skærm
  til en afgrænsning plus de tre tekster. **Invarianten bør omformuleres, så den
  ikke læses som et krav, der er sprunget over.** Ikke gjort endnu.

## Claude-proxy (3 AI-kald) — besluttet

**Rettet 28/8.** Primeren sagde tidligere "ét generisk endpoint" og modsagde dermed
risikoregistrets **S6** (20/8). Ann har bekræftet **tre endpoints**; afsnittet er
rettet, så der kun står ét svar.

- **Tre navngivne endpoints**, ét pr. AI-kald — `/api/tilbud/referat` ·
  `/api/tilbud/udtraek` · `/api/tilbud/tilbudslinjer`. Til Fase 1 bygges kun den
  første; de to øvrige hører til Fase 2.
  **Hvorfor tre og ikke ét:** hvert kald får sit eget loft og sin egen linje i Ø2's
  forbrugslog — med ét endpoint kan et dyrt og et billigt kald ikke skilles ad,
  hverken i kvoten eller i regnskabet. Og det er ruten selv, ikke noget klienten
  sender, der afgør hvilken prompt der bruges. Filstruktur:
  `server/prompts/{referat,udtraek,tilbudslinjer}.js` bygger prompten pr. endpoint,
  `server/routes/tilbud-ai.js` eksponerer dem.
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
  ⚠️ **Åbent 28/8 (J9): hvilken model skriver selve referatet?** Transskriptionen er
  afgjort (Scaleway), men referat-genereringen er et selvstændigt valg. Scaleways
  Generative APIs hoster også sprogmodeller i EU, så begge trin *kan* ligge samme
  sted — det ville fjerne US-undtagelsen og efterlade én DPA i stedet for to.
  Prisen er, at referatkvaliteten på dansk med en open-weight model er umålt.
  **Valget afgøres af regressionssættet (D14), ikke af et skøn.**

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
