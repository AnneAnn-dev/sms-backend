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
7. **Udvidet 19/8 (D35, fælles beslutning): kunde ≠ husstand ≠ adresse.** En udlejer
   kan have flere adresser; en opgave kan have flere kontaktpersoner (mand/kone,
   lejer, projektleder). Fem tabeller bærer hierarkiet: `kunder` (betalende
   identitet) · `adresser` (hvor arbejdet foregår; `kunde_id` peger på den
   ansvarlige, én kunde kan have flere) · `opgaver` (knyttet til adresse, ikke
   direkte til kunde) · `opgave_kontakter` (engangs, pr. opgave — lejer,
   ægtefælle) · `kunde_kontakter` (persisterende på tværs af kundens opgaver —
   projektleder, voksne børn med fuldmagt). Opslag sker tre steder: `/opkald`
   slår read-only op mod telefonnummer og tagger `calls`-rækken uden at oprette
   noget · `/formular/:token` foreslår et match mod åbne opgaver/kendte kunder ·
   `/opret-opgave` er der, hvor beslutningen reelt tages. **Start strammere:**
   al matchning kræver manuel godkendelse, ingen automatisk sammenlægning endnu.
   ⚠️ **Uafklaret spænding med punkt 1 ovenfor:** punkt 1 siger "`leads`-tabellen
   ER opgave-tabellen, der oprettes ingen separat opgavetabel." D35 (besluttet
   efter punkt 1 blev skrevet) taler om en selvstændig `opgaver`-tabel. Er
   `opgaver` et nyt navn for det udvidede `leads`, eller en ægte ny tabel ved
   siden af? Ikke afklaret i nogen af kilderne — bekræft, før migrationen til
   D35 skrives.

## De 10 datafunktioner — besluttet

Annes funktionsnavne og kaldesteder BEVARES, men indmaden skrives om fra
"gem hele listen" til **operationer pr. række** (insert/update/delete på id).

Hvorfor: hele-listen-gem giver last-write-wins mellem to åbne skærme (telefon +
iPad, eller mester + svend) → **tavst datatab** — den farligste fejlklasse, usynlig
i test med én bruger. Konsekvens: de steder i prototypen, der "sletter" ved at
filtrere listen og gemme resten, skrives om til eksplicitte delete-kald.

## Transskription — besluttet

- **Scaleway (EU) frem for OpenAI — VALGT af Ann 28/8.** syv.ai blev testet og
  fravalgt (bedre på nogle områder, dårligere på andre; prisen var udslagsgivende).
  Mistral Voxtral (FR) var fallback-kandidat; OpenAI direkte er fravalgt pga.
  EU-princippet. Modellen er `whisper-large-v3` på `POST /v1/audio/transcriptions`.
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

## Claude-proxy (4 AI-kald) — besluttet

**Rettet 28/8 og igen 29/8.** Primeren sagde tidligere "ét generisk endpoint" og
modsagde dermed risikoregistrets **S6** (20/8). Ann har bekræftet navngivne
endpoints. Ved samme lejlighed kom en anden uenighed frem: primeren opregnede
kaldene som *referat, tilbud, **notefoto***, mens S6 opregnede dem som *referat,
udtræk, tilbudslinjer*. Begge sagde "tre" — og derfor så ingen, at det ikke var de
samme tre. **Der er fire kald.**

- **Fire navngivne endpoints**, ét pr. AI-kald:
  `/api/tilbud/referat` (Fase 1) · `/api/tilbud/notefoto` (Fase 1) ·
  `/api/tilbud/udtraek` (Fase 2) · `/api/tilbud/tilbudslinjer` (Fase 2).
  **Hvorfor tre og ikke ét:** hvert kald får sit eget loft og sin egen linje i Ø2's
  forbrugslog — med ét endpoint kan et dyrt og et billigt kald ikke skilles ad,
  hverken i kvoten eller i regnskabet. Og det er ruten selv, ikke noget klienten
  sender, der afgør hvilken prompt der bruges. Filstruktur:
  `server/prompts/{referat,notefoto,udtraek,tilbudslinjer}.js` bygger prompten pr.
  endpoint, `server/routes/tilbud-ai.js` eksponerer dem.

## Håndskrevne noter — besluttet 28/8 (del af Fase 1)

Håndværkere skriver på papir. Uden fotovejen rammer Fase 1 kun den halvdel, der
taler. Udvidelsen er bevidst og står også i risikoregistrets **D36**.

- **To veje ind, ét referat ud.** `/api/tilbud/notefoto` returnerer **nøjagtig samme
  JSON** som `/api/tilbud/referat`. Visning, rettelse, gem og genfind er dermed
  uændret, og der ligger ikke to slags referater i basen. Det er den bærende regel;
  alt andet i fotovejen er en variation over den.
- **Vision-model, ikke tekstmodel.** Kaldet har sin egen leverandørafgørelse (J9),
  sin egen pris i Ø2 og sit eget kvalitetssæt (D14). Dansk håndskrift er sværere for
  en model end dansk tale — det skal måles, ikke antages.
- **Fotoet gemmes ALDRIG.** Samme regel som lyden: læs → udtræk tekst → smid billedet
  væk. Håndværkeren kan tage billedet igen. Vil I beholde det, er det en selvstændig
  beslutning med opbevaringsfrist, bucket og RLS — og den hører i Fase 2.
- **Datoen sættes af systemet ved upload, aldrig af modellen.** Står der en dato på
  papiret, må den gerne stå i referatteksten, men rækkens dato er systemets. Samme
  princip som P5: modellen leverer aldrig metadata, systemet allerede kender.
- **Body-limit'en rykker frem.** Base64-billeder sprænger Express' 100 kb-default.
  Det var et Fase 2-problem; med fotovejen er det et Fase 1-problem.
- **Spiken er billig:** `<input type="file" accept="image/*" capture="environment">`
  åbner kameraet på både iOS og Android uden `MediaRecorder`. En halv time, ikke en
  halv dag som mikrofon-spiken.
- **Byggerækkefølge:** diktafonvejen først, fotovejen ovenpå, begge frigives som Fase 1.
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
  **Valget afgøres af regressionssættet (D14), ikke af et skøn.** Sættet: ca. 10
  rigtige indtalinger med et manuelt skrevet facit-referat ved siden af, lagt i
  repoet, kørt mod begge leverandører med pris ved siden af. Bundgrænsen måles på
  det, der ødelægger et referat — navne, adresser, tal, mål, fagtermer — ikke en
  samlet kvalitetsfornemmelse. Samme sæt bærer D14's modellås: eksplicit
  modelnavn + version i en miljøvariabel, aldrig et alias som `latest`, skrevet
  sammen med det første proxy-endpoint, ikke bagefter.

## Kvoter — besluttet (Ø2)

Arkitektur besluttet 28/8. **To lag, begge nøglet på `firma_id`, aldrig IP:**

1. **`ratelimit.js`** (findes allerede, bygget til S12) fanger loops og bugs FØR
   noget kaldes.
2. **Ny `kvote.js`** tjekker firmaets forbrug denne måned (ny tabel `ai_forbrug`)
   mod `firma_profil.ai_maanedsloft_dkk` FØR ethvert betalt kald til de fire
   S6-endpoints, og afviser **fail-closed** ved overskridelse.

**Fund 28/8, der afgør hvorfor app-laget bærer det hele:** ingen leverandør kan
begrænse ét firmas forbrug. Scaleways "billing alert" er kun en SMS/e-mail-
notifikation, ikke en spærre, og rate-limiten deles af hele organisationen;
Anthropics Workspace-"spend limit" ser ud til at være en reel grænse, men det er
ikke bekræftet i dokumentationen, at den blokerer kald. Leverandørgrænserne er
derfor kun en samlet nødbremse for hele platformen, hvis `kvote.js` selv skulle
fejle — `kvote.js` er reelt den eneste mekanisme, der styrer det enkelte firma.

**Leverandørkrav (gør et fremtidigt skifte billigt):** transskription/AI bygges
bag én adapter-funktion (lyd/tekst ind → resultat ud); leverandør vælges via
miljøvariabel, fail-closed som `flags.js`; pris pr. kald/minut læses fra én
central konfiguration, aldrig hardcodet i `kvote.js`.

**Foreslåede tal** (fra `OE2-budgetloft-beregner.xlsx`, top-down fra Anns
komfortniveau, regnet på 100 sessioner/firma/md): globalt månedsloft 500 kr
(styrende) · anbefalet firma-månedsloft (`ai_maanedsloft_dkk`) 70 kr/md · globalt
dagsloft 50 kr · leverandør-alarmtærskel (Scaleway og Anthropic, hver) 1.000
kr/md, notifikation ikke spærre · forventet reelt forbrug ved Scaleway ca.
17,56 kr/firma/md (~28,5× buffer til loftet).

⚠️ **Ikke implementeret endnu** — `kvote.js`, migrationen til `ai_forbrug` og
adapteren mangler at blive skrevet. Tallene skal genberegnes, når Fase 1's
fotovej (se ovenfor) er talt med — et billedkald koster mere end et tekstkald,
og regnearket er lavet på lyd + tekst alene.

## Tilbud & frysning — besluttet

`tilbud`-tabellen er **selvbærende**: alle værdier fra firmaprofilen, der indgår
(timepriser, moms, kørselssats, betingelser, garanti), gemmes som KOPI på
tilbudsrækken. Ved status = godkendt LÅSES felterne. Man joiner ALDRIG tilbage til
`firma_profil` for at vise et eksisterende tilbud. Et godkendt tilbud fra marts med
timepris 450 viser 450 for evigt, uanset hvad profilen siger i maj.
Skal med fra første migration (kan ikke eftermonteres) — **og frysningen skal testes**
(ret profilen, genåbn gammelt tilbud, verificér uændrede tal).

## Faktura — besluttet (D22)

Besluttet 19/8 (fælles beslutning): **faktura er en afledt post med egen tabel,
ikke en tilstand på tilbuddet.** Et tilbud skal kunne rettes indtil accept; en
faktura må aldrig ændre sig, når den findes — de to kan ikke dele række.

Fuld proces: udkast → godkendt → sendt til kunde → accepteret → udgifter samles
→ fakturaudkast → faktura godkendelse → faktura afsendelse → betalt faktura.
**Afsendelsen er en aktiv rykker-feature** — bruges til at rykke kunden for
accept/dialog — ikke kun en visning; den kræver en reel udsendelses-/
påmindelsesmekanisme, ikke en gemt hensigt som i prototypen. Den konkrete
udformning af rykkeren (hvornår, hvor tit, hvilken kanal) er ikke fastlagt endnu
og hører til Fase 2 (se D36 i `tilbud-runbook.md`).

**Stopkriterie for netop tilbud→faktura-delen** (afgrænset fra tilbudsmodulets
brede stopkriterie, se runbogens Fase-opdeling): tilbud kan oprettes, rettes som
kladde (uden versionering, se Audit-spor nedenfor) og accepteres · accept
udløser oprettelse af én fakturarække med næste nummer i en ubrudt serie ·
fakturaen kan ikke ændres efter oprettelse, håndhævet med RLS · audit-sporet
logger fra godkendt og frem. Alt efter "betalt faktura" (rykkerprocedure, delvis
betaling) er uden for den tynde skive og hører til Fase 3.

Hører til **Fase 3** i D36's faseopdeling — ikke begyndt endnu.

## Audit-spor — besluttet (D13)

Design fastlagt 19/8 (fælles beslutning). Append-only tabel (`tilbud_historik`)
logger kun fra **godkendt** og frem — kladder (status `udkast`) redigeres i
samme række uden historik; det er et bevidst valg, ingen versionering af kladder.

Hver hændelse (`godkendt` · `sendt_til_kunde` · `accepteret` ·
`ekstra_ydelse_tilfoejet` · `fakturaudkast_oprettet` · `faktura_godkendt` ·
`faktura_afsendt` · `faktura_betalt`) gemmer en **fuld kopi** af
tilbuddet/fakturaen på det tidspunkt, ikke kun ændrede felter.
`ekstra_ydelse_tilfoejet` peger via `kilde_referat_id` på det referat, der
begrunder en ydelse tilføjet ud over det oprindelige tilbud (skopeglidning, fx
dør → tapet + maling). `faktura_betalt` logges manuelt, indtil en
betalingsintegration til fakturaer findes.

**Skal håndhæves med en INSERT-only RLS-politik, verificeret med `pg_policies`**
— ikke kun i applikationskoden. Rart for leads, nødvendigt for tilbud, hvis
kunde og håndværker bliver uenige om en pris.

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
