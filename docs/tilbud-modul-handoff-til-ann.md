# Tilbud-modul — samlet spec/prototype til Ann

**Status:** Dette er én klikbar prototype, `referater-app.html` — ét selvstændigt HTML-dokument (HTML+CSS+JS i én fil, ingen build-step, ingen andre filer nødvendige). Åbn den i en browser for at klikke dig igennem hele flowet.

Den følger samme princip som primeren beskriver: *prototyper er spec, som Ann implementerer — de går aldrig direkte i kodebasen.* Formålet med dette dokument er at give et samlet overblik over hele modulet, så du kan gå i gang uden at skulle spore historikken bag det.

---

## 1. Overblik — hvad er appen?

En mobil-first prototype til håndværkere, bygget op om fire faner nederst:

| Fane | Formål |
|---|---|
| **Referat** | Optag eller fotografér noter fra byggemøder/kundemøder → AI laver et struktureret referat |
| **Tilbud** | Indtal kunde + opgave → AI finder/opretter kunde og opgave, håndværkeren udfylder en tjekliste → strukturerede tilbudslinjer → godkend → PDF → (manuel) afsendelse |
| **Kunder** | Browse kunder → deres opgaver → referater og tilbud på hver opgave |
| **Firma** | Virksomhedens stamdata og faste svar (timepriser, betingelser, standardvalg) |

---

## 2. Arkitektur — datahierarki

```
Kunde → Opgave → Referat / Tilbud
```

- **Kunde** = den varige identitet (svarer til jeres kommende `kunder`-tabel).
- **Opgave** = arbejdsenheden (svarer til en række i jeres eksisterende `leads`-tabel, udvidet med `kunde_id`). En opgave kan opstå fra et opkald *eller* oprettes manuelt.
- **Referat** og **Tilbud** hænger altid på en opgave — aldrig direkte på kunden. (Eksempel: "hvilket af Jensens tre referater hører til badeværelset, og hvilket til carporten?" — svaret er opgaven imellem.)
- **FirmaProfil** står uden for dette hierarki: ét singleton-objekt pr. virksomhed, uafhængigt af kunder/opgaver.

Prototypen respekterer hierarkiet fuldt ud: man vælger/opretter en kunde, derefter en opgave under den kunde, og referater/tilbud gemmes på opgaven.

---

## 3. De 10 funktioner, der skal udskiftes

Al data-adgang i hele appen går **udelukkende** gennem disse 10 funktioner — ingen andre steder i koden rører ved lagringen direkte. De ligger samlet øverst i `<script>`-blokken under overskriften **"BACKEND-GRÆNSEFLADE (TIL ANN)"**, med fuld datamodel-dokumentation som kommentar lige ovenover.

| Funktion | Gør hvad |
|---|---|
| `loadCustomers()` | Hent alle kunder |
| `saveCustomers(list)` | Gem hele kundelisten (opret/rediger) |
| `loadOpgaver(kundeId)` | Hent alle opgaver for én kunde |
| `saveOpgaver(kundeId, list)` | Gem opgave-listen for én kunde |
| `loadReferater(opgaveId)` | Hent alle referater for én opgave |
| `saveReferater(opgaveId, list)` | Gem referat-listen for én opgave |
| `loadTilbud(opgaveId)` | Hent alle tilbud for én opgave |
| `saveTilbud(opgaveId, list)` | Gem tilbud-listen for én opgave |
| `loadFirmaProfil()` | Hent firmaets profil (singleton) |
| `saveFirmaProfil(profil)` | Gem firmaets profil |

De bruger i dag Claude-artifactens indbyggede `window.storage` (nøgle/værdi) til at simulere en database, så flowet kan testes fra ende til anden. **Dette er det eneste, der reelt skal udskiftes** — resten af koden (UI, optager, billed-upload, AI-prompts, trin-navigation) kan genbruges uændret, fordi alt andet udelukkende kalder disse 10 funktioner.

### Datastrukturer

```js
// Kunde
{ id, navn, telefon, adresse, oprettet }
// telefon er tom som standard i prototypen - det er nøglen, der skal
// matches mod indkommende opkald (from_number), jf. jeres /opkald-flow.

// Opgave (gemt pr. kunde)
{ id, titel, beskrivelse, oprettet }

// Referat (gemt pr. opgave)
{
  id, titel, type: "Noter", dato, createdAt,
  // "type" har bevidst kun én mulig værdi - "Kundemøde" er fjernet som valg
  // af GDPR-hensyn (kundens stemme skal ikke optages). Feltet er bevaret i
  // datamodellen for stabilitet, men UI'et tilbyder ikke længere et valg.
  data: {
    opsummering, emner: [{ titel, noter }], beslutninger: [string],
    opgaver: [{ opgave, ansvarlig, deadline }],
    tilbudsNoter,   // bruges automatisk som kontekst i Tilbud-modulet
    naesteSkridt
  }
}

// Tilbud (gemt pr. opgave)
{
  id, dato, createdAt,
  indledning, opgaveBeskrivelse,
  linjer: [ { id, type: "arbejde"|"materiale"|"gebyr", beskrivelse, antal, enhed, enhedspris } ],
  // "samlet" pr. linje er altid antal × enhedspris, regnet i kode - aldrig af AI'en.
  momsProcent, subtotal, momsBeloeb, total,
  afslutning, betingelser,
  status: "udkast" | "godkendt" | "sendt",
  godkendtAt, sendtAt,
  opfoelgning: { dage, status: "planlagt" } | null
}

// FirmaProfil (singleton - ét pr. virksomhed, IKKE gemt pr. kunde/opgave)
{
  brancher: string[],  // fx ["Tømrer", "Murer"] - firmaet kan have flere
  timepriser: [ { id, branche, rolle: "Lærling"|"Svend"|"Mester", sats } ],
  koersel: { type: "km" | "time", sats },
  moms, betalingsbetingelser, gyldighedDage, garanti, forsikringer,
  cvr, bankoplysninger,
  standardvalg: { [feltId]: "altid" | "spoerg" | "aldrig" }
}
```

---

## 4. AI-kald — 3 steder, alle med samme begrænsning

**Vigtigt:** Alle tre AI-kald går direkte til `https://api.anthropic.com/v1/messages` **uden API-nøgle** — det er et trick, der kun virker inde i Claude-artifactens preview-miljø. Det virker **ikke** uden for Claude, og det virker naturligvis ikke i jeres produktionsmiljø. **Alle tre skal proxies gennem jeres egen backend** med jeres egen Anthropic API-nøgle server-side.

| # | Hvor i koden | Trigger | Hvad den gør |
|---|---|---|---|
| 1 | `generateBtn` (Referat-fanen) | "Generér referat" | Sender transskription **og/eller** vedhæftede billeder (vision) til Claude, får struktureret JSON-referat tilbage |
| 2 | `analyzeTilbudBtn` (Tilbud-fanen) | "Find kunde og fortsæt" | Udtrækker kundenavn/adresse/opgavebeskrivelse fra en indtalt tekst |
| 3 | `generateTilbudBtn` (Tilbud-fanen) | "Generér tilbudsudkast" | Foreslår materiale-linjer ud fra tjeklistens felter + evt. referat-kontekst |

Alle tre bruger `model: "claude-sonnet-4-6"`, `max_tokens: 1000`, og beder modellen svare **udelukkende med JSON** (ingen markdown/kodeblok). System-prompterne står direkte i koden ved hvert kald — skrevet så de kan bruges uændret bag jeres egen proxy.

---

## 5. Optageren — bygget til Whisper

Lyden optages med **MediaRecorder** — en helt almindelig browser-funktion, der virker ens på tværs af Chrome, Safari, Firefox og Edge (i modsætning til browserens indbyggede tale-til-tekst, som slet ikke findes i Firefox og er upålidelig i Safari på iPhone). Når håndværkeren stopper optagelsen, samles lyden til én fil (`Blob`, typisk `audio/webm` eller `audio/mp4`), som sendes til **præcis ét sted i koden**: funktionen `transcribeAudio(audioBlob)`. Både Referat- og Tilbud-fanens optager kalder denne ene funktion.

### 🔴 DETTE SKAL ANN BYGGE

`transcribeAudio(audioBlob)` er en bevidst fejlende stub — søg efter kommentaren **"WHISPER-INTEGRATION (TIL ANN)"** i `<script>`-blokken. Der står et konkret kodeeksempel på, hvordan et backend-kald til OpenAI Whisper typisk ser ud:

```js
async function transcribeAudio(audioBlob) {
  // Byg et backend-endpoint der modtager audioBlob og sender den videre
  // til OpenAI Whisper, fx:
  //   POST https://api.openai.com/v1/audio/transcriptions
  //   model: "whisper-1" (eller "gpt-4o-transcribe")
  //   Authorization: Bearer <OPENAI_API_KEY>  ← kun server-side, aldrig i browseren
  // og returnér den transskriberede tekst som en almindelig streng.
}
```

Prototypen kan (ligesom med Claude-kaldene) ikke selv kalde eksterne AI-API'er med en rigtig nøgle — der er ingen "gratis adgang" til OpenAI her, som der er til Claude. Funktionen fejler derfor bevidst med en tydelig besked i UI'ets fejlbanner, indtil I har koblet et rigtigt backend-endpoint på. **Anne har bevidst ikke testet optageren siden omlægningen — det er meningen, den først testes, når dette er bygget.**

**Kvalitetsanbefalinger til selve Whisper-kaldet (backend-siden, når Ann bygger det):**
- Send `language: "da"` med i kaldet, så Whisper ikke selv skal gætte sprog.
- Overvej `prompt`-parameteren (understøttet af Whisper-API'et) til at "prime" modellen med typiske fagudtryk/materialenavne i byggebranchen — forbedrer genkendelsen af ord, en generisk model ellers ofte hører forkert.
- Overvej `gpt-4o-transcribe`/`gpt-4o-mini-transcribe` som alternativ til `whisper-1` — nyere OpenAI-modeller med rapporteret bedre nøjagtighed, samme API-mønster.

**Kvalitetsforbedringer allerede bygget ind i optager-komponenten (client-side):**
- Skærmens Wake Lock aktiveres under optagelse, så mobilen ikke dæmper/låser skærmen og afbryder optagelsen midtvejs.
- `echoCancellation`/`noiseSuppression`/`autoGainControl` er eksplicit slået fra (`MIC_CONSTRAINTS`-konstanten) — disse kan på mobil nogle gange fejlagtigt dæmpe eller klippe stemme, og Whisper er selv god til at håndtere baggrundsstøj i rå lyd.
- `audioBitsPerSecond: 128000` sat eksplicit for at undgå for hård komprimering på visse enheder.
- Lydbølgen under optagelse er nu **ægte lydniveau** (Web Audio AnalyserNode på samme stream som optages), ikke en simuleret animation — giver håndværkeren øjeblikkeligt visuelt bevis på, at mikrofonen rent faktisk fanger noget.
- En kort advarsel vises, hvis en optagelse er under 1,5 sekund (typisk tegn på at optag-knappen blev trykket forkert).

Andre detaljer:
- **Ingen live-tekst mens der tales** — sådan fungerer Whisper's API (hele klippet sendes samlet). Status går "Optager…" → "Transskriberer…" → teksten dukker op.
- Lydbølge-animationen er en simuleret puls, ikke ægte lydanalyse — bevidst UI-pynt, uafhængig af transskriptions-motor.
- Optager-logikken er samlet i én genbrugelig funktion, `createRecorder(...)`, som begge faner instansierer hver for sig.

---

## 6. Billed-upload (håndskrevne noter)

- `<input type="file" accept="image/*" multiple>` **uden** `capture`-attribut — giver den native vælger på både iOS og Android, som selv tilbyder "Tag foto" og "Vælg fra bibliotek".
- Billeder konverteres til base64 client-side og sendes som `{ type: "image", source: { type: "base64", media_type, data } }`-blokke i samme besked som transskriptionen (AI-kald #1).
- Kan bruges **alene, sammen med tale-optagelse, eller slet ikke** — "Generér referat" er aktiv, så snart mindst én af de to kilder findes.
- Håndskrift læses direkte af Claude (vision), ingen separat OCR-omvej. Modellen er bedt om at udelade det, den er usikker på, fremfor at gætte.
- Ryddes automatisk (sammen med transskriptionen) når referatet er gemt.

---

## 7. Virksomhedsprofilen (Firma-fanen)

- **Branche er multi-select** — et firma kan have både tømrer og murer. Timepriser er derfor en **åben liste** af `{branche, rolle, sats}`-rækker frem for et fast rolle-hierarki, så et blandet firma automatisk får de satser, det har brug for.
- **Standardvalg-felterne (affald, oprydning, materialepåslag, miljøgebyr osv.) er IKKE hardcodet på firmaets objekt.** De ligger i en separat, central liste kaldet `STANDARDFELTER` (lige efter de 10 funktioner i koden), som hver har en `gaelderForBrancher`-liste (tom = gælder alle) og et valgfrit `gyldigFra`-dato-felt. Firmaets profil gemmer kun *svaret* pr. felt-id. **Hvorfor:** kommer der et nyt lovkrav, tilføjer I ét objekt centralt, og kun de relevante virksomheder (ud fra branche) bliver bedt om at tage stilling — uden en ny app-release. I produktion bør `STANDARDFELTER` ligge i en tabel, I selv kan redigere, ikke hardcodet i frontend.
- **Profilen "fryses" ikke automatisk ind i det enkelte tilbud endnu** — se punkt 9 (ikke bygget endnu).

### Sådan bruges profilen i Tilbud-fanens tjekliste

I `prefillChecklist()` slås firmaprofilen op:
- Standardvalg sat til **"altid"** eller **"aldrig"** viser slet ikke feltet for håndværkeren — værdien sættes automatisk, med en kort forklarende note. Kun **"spørg hver gang"** (eller en tom profil) viser spørgsmålet.
- Timepris forudfyldes fra profilen, hvis den ikke blev nævnt i optagelsen.
- Betalingsbetingelser-udkastet bruger firmaets egen tekst, hvis udfyldt, ellers et generisk udkast.
- Moms og kørselssats sendes med som kontekst til AI-genereringen af tilbuddet.

---

## 8. Strukturerede tilbudslinjer, Buffer, Godkend/Send-loop, Kladder og Genbrug

**Linjerne:** Hver tilbudslinje er `{ beskrivelse, antal, enhed, enhedspris }`. AI'en foreslår **kun materiale-linjer** (usikre mængder/priser, skal kunne rettes) — ud fra BÅDE opgavebeskrivelsen og en eventuel materiale-fritekst, så den også selv foreslår typiske materialer, når de ikke er nævnt eksplicit. Arbejdslinjen bygges deterministisk i kode ud fra timepris × timer. Totalen (`subtotal`, `momsBeloeb`, `total`) beregnes altid i JavaScript, aldrig af AI'en.

**Buffer på materialer** lægges direkte ind i hver materialelinjes pris ved generering (`enhedspris × (1 + buffer%)`) — der er bevidst IKKE en selvstændig "påslag"-linje. En note i UI'et gør det tydeligt, at priserne allerede inkluderer påslaget.

**Hele flowet (Tilbud-fanens sidste trin):**
1. **Udkast** — linje-editor + live prisoversigt. To knapper herfra:
   - **"Gem som kladde"** — gemmer med `status: "udkast"`, ingen PDF eller godkendelse krævet. Til når priserne ikke er klar endnu.
   - **"Vis tilbud som PDF"** — bygger et snapshot (`godkendtTilbud`) og går videre til forhåndsvisning.
2. **PDF-forhåndsvisning** — dokumentet vises indlejret i en `<iframe>` via en `Blob`-URL fra jsPDF, præcis som kunden ville se det. Herfra: **"Godkend tilbud endeligt"** (går videre), **"Download PDF"**, eller **"‹ Tilbage og ret"**.
3. **Send-skærmen** — vælg **opfølgning** (Ingen/3/7/14 dage, gemt som `{ dage, status: "planlagt" }`), og **"Markér som sendt & gem"** (`status: "sendt"`, `sendtAt`, nulstiller flowet).

**Kladder kan genåbnes til redigering:** under Kunder → kunde → opgave viser en kladde "tryk for at fortsætte" — trykkes den, hopper man direkte ind i linje-editoren (`openTilbudForEditing()`), uden om diktering/tjekliste. Gemmes den igen, **opdateres** den samme post (sporet via `tilbudRedigererId`) i stedet for at oprette en duplikat. Et allerede sendt tilbud kan ikke redigeres direkte (det er en historisk post), men kan **genbruges som skabelon** for et nyt tilbud via knappen "Genbrug som nyt tilbud" på tilbud-visningen (`reuseTilbudAsTemplate`-flowet) — man vælger, hvilken kunde/opgave det nye tilbud skal knyttes til (kan sagtens være en anden opgave end originalen), og lander i editoren med alt forudfyldt, klar som en frisk kopi.

---

## 9. Forberedt til eksterne integrationer (IKKE aktive endnu)

To integrations-typer er forberedt arkitektonisk, men bevidst **ikke tilkoblet** — appen fungerer 100% uden dem, og alt UI omkring dem håndterer "ingenting tilkoblet endnu" pænt.

### Materiale-leverandører (prisopslag)

Søg efter kommentaren **"MATERIALE-LEVERANDØR-INTEGRATION (TIL ANN)"**. En tom liste, `MATERIALE_LEVERANDOERER`, venter på at få leverandør-objekter tilføjet, hver med en `soegPris(soegeterm)`-funktion, der returnerer `[{ beskrivelse, enhedspris, enhed }, ...]`. Hver materialelinje i editoren har en 🔎-knap, der kalder `slaaMaterialePrisOp()` — er listen tom (som nu), viser den blot "Ingen leverandør tilkoblet endnu", uden fejl. Er der senere flere leverandører tilkoblet samtidig, bruges i dag kun den første i listen — det er markeret som noget, der kan udvides i UI'et, hvis det bliver relevant.

### Økonomisystemer (eksport af sendte tilbud)

Søg efter kommentaren **"ØKONOMISYSTEM-INTEGRATION (TIL ANN)"**. En tom liste, `OEKONOMISYSTEM_CONNECTORER`, venter på system-objekter, hver med en `eksporter(tilbud)`-funktion. Et sendt tilbuds visningsside har en dropdown + "Eksportér"-knap, som lige nu viser "Ingen økonomisystemer forbundet endnu" og er deaktiveret, indtil mindst ét system er registreret. `tilbud` her er præcis samme objekt-form, som gemmes via `saveTilbud()` (de strukturerede linjer er allerede i det format, en økonomisystem-eksport har brug for).

Begge steder: API-nøgler/OAuth skal ligge på jeres backend, aldrig i browseren — funktionerne i listerne skal kalde jeres egne proxy-endpoints, akkurat som Whisper- og Claude-kaldene andre steder i denne fil.

---

## 10. Bevidst ikke bygget endnu

- **Automatisk e-mail-afsendelse af tilbuddet til kunden** — kræver jeres backend (SMTP/mailtjeneste); ingen browser kan gøre det alene. PDF'en genereres allerede rigtigt, kun selve afsendelsen mangler.
- **Reel udløsning af opfølgning** (at der faktisk sker noget efter X dage) — kræver en scheduler/cron-job på jeres side. Kun *valget* af opfølgningsperiode er gemt som data.
- **Profil-værdier "fryses" ikke automatisk ind i det enkelte tilbud** — en senere prisændring i firmaprofilen bør ikke ændre allerede godkendte/sendte tilbud retroaktivt. Værd at bygge ind, når I arbejder videre med `tilbud`-tabellen.
- **Kunde-fletning** (samme person, to numre/registreringer) og **faktureringsfelter** (CVR/EAN på kundeniveau) — bevidst udskudt, må ikke blokere resten.
- **"Lær af tidligere tilbud"** (stil-/skabelon-genbrug ved lignende opgaver, fx gentagne terrasseopgaver) — kan bygges oven på de strukturerede linjer nu, hvor de findes. Kan starte simpelt som at sende et par tidligere tilbud med som stil-reference i AI-prompten; kræver ingen ny infrastruktur, kun at der findes nok gemte tilbud at trække på.
- Deling af den ene "recorder"-logik mellem Referat- og Tilbud-fanen (to næsten identiske instanser af samme `createRecorder`-funktion) — kan ryddes yderligere op i ved lejlighed, ikke et funktionelt problem.

---

## 11. Forslag til rækkefølge

1. Migrationen: `kunder`-tabel + `leads.kunde_id` (jeres eget udkast).
2. **Byg Whisper-endpointet og kobl `transcribeAudio()` til det** — blokerer reelt afprøvning af resten, da tale-til-tekst er indgangen til både referat og tilbud.
3. Byg proxy-endpoint(s) til de 3 Claude-AI-kald (samme prompts, jeres egen nøgle).
4. Udskift de 10 data-funktioner til at kalde jeres rigtige data, inkl. `STANDARDFELTER` som en redigerbar tabel frem for hardcodet liste.
5. Kobl `/opkald`-flowet til at matche `from_number` mod `kunder.telefon`.
6. Alt UI, optager-komponent, billed-upload, firmaprofil og linje-editor kan genbruges som det er.

Sig til hvis noget af dette skal uddybes, eller hvis det er nemmere med en kort snak i stedet for at læse det hele.
