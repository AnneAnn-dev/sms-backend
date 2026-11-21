# Fase 5 Tilbud — kontrakten mellem spor 1 og spor 2

Udkast 1, skrevet af spor 1 21/11-26 ud fra byggeplanen (`docs/fase5-tilbud-byggeplan.md`, 19.391 bytes, committet 21/11). **Ikke aftalt endnu.** Ingen af sporene koder efter den, før spor 2 har svaret, og Ann har godkendt den.

Kontrakten fastlægger fire ting: hvad klienten sender og får tilbage (tilbud og linje), hvilke felter der er "ikke accepteret", hvad serveren giver prompten, og hvad modellen må svare. Byggeplanens beslutninger står over kontrakten; numrene (#) henviser til dem.

## 0. Grundregler

- **Penge er heltal i øre** overalt i JSON (`12350` = 123,50 kr.). Aldrig kommatal. Det er forudsætningen for #14.
- **Antal og mængde er tekst med op til tre decimaler** (`"1.5"`, `"42.125"`, punktum som decimaltegn). Serveren læser dem præcist; klienten regner aldrig på dem.
- **Klienten regner ingenting.** Alle summer kommer fra serveren og vises, som de er. PDF'en læser kun det, serveren har gemt (#14).
- **Ejerskab udledes af tokenet.** Et id, der tilhører et andet firma, giver `404`, ikke `403`, så det ikke afslører, at det findes (IDOR).
- **Fejlkoder:** `404` ikke fundet eller ikke dit, `409` tilbuddet er låst (ikke kladde), `422` ugyldige data — med `mangler: [...]` i svaret.

## 1. Tilbud (server → klient)

```json
{
  "id": "uuid",
  "lead_id": "uuid",
  "kaede_id": "uuid",
  "version": 1,
  "status": "kladde",
  "tilbudsnummer": null,

  "titel": "Ny terrasse i lærk",
  "titel_bekraeftet": false,
  "opgave_titel_forslag": "Terrasse, Søndergade",
  "opgave_titel_forslag_status": "afventer",

  "opgavetype": { "id": "uuid", "navn": "Terrasse", "enhed": "m²" },
  "opgavetype_bekraeftet": false,
  "maengde": "40",
  "maengde_bekraeftet": false,

  "indledning": "…",
  "betingelser": "…",
  "gyldig_til": "2026-12-21",
  "timepris_oere": 47500,
  "moms_sats": "25.00",
  "koersel": { "form": "km", "km": "18", "sats_oere": 380, "beloeb_oere": null },

  "firma": { "navn": "…", "cvr": "…", "adresse": "…", "telefon": "…", "email": "…", "bank_reg": "…", "bank_konto": "…" },

  "summer": {
    "arbejde_oere": 0, "materialer_oere": 0, "koersel_oere": 6840, "andet_oere": 0,
    "ex_moms_oere": 6840, "moms_oere": 1710, "inkl_moms_oere": 8550
  },

  "kilder": {
    "referat_ids": ["uuid", "uuid"],
    "beskrivelse_kopi": "Vores terrasse er rådden …",
    "noter_kopi": "…",
    "lavet_at": "2026-11-21T08:10:00+01:00"
  },

  "linjer": [ "… se afsnit 2 …" ],

  "kan_godkendes": false,
  "mangler": ["titel ikke bekræftet", "linje 3: antal mangler"],

  "godkendt_at": null,
  "sendt_at": null,
  "accepteret_at": null
}
```

- **`status`:** `kladde` → `godkendt` → `sendt` → `accepteret`. Desuden `afvist`, `udloebet` (findes i skemaet; Fase 5 sætter dem ikke) og `erstattet` (sættes på den gamle version, når en ny i samme kæde godkendes).
- **`firma`, `timepris_oere`, `moms_sats`, `koersel`, `betingelser`:** i en kladde er det profilens værdier, som de er nu. Fra `godkendt` er det de frosne værdier (#2, #13). Klienten og PDF'en læser altid herfra, aldrig fra profilen.
- **`kilder`:** sættes, når forslaget laves (afsnit 4), og fryses ved godkendelse (#10).
- **`tilbudsnummer`:** heltal, sat ved godkendelse; en ny version får et nyt (#7).
- **`kan_godkendes` og `mangler`:** serveren fortæller, hvad der står i vejen. Klienten viser listen; den gætter ikke selv.

## 2. Linje

```json
{
  "id": "uuid",
  "sortering": 3,
  "type": "materiale",
  "beskrivelse": "Lærkebrædder 28×120",
  "antal": "95",
  "enhed": { "id": "uuid", "navn": "m" },
  "enhedspris_oere": null,
  "linje_sum_oere": null,
  "kilde": "model",
  "bekraeftet": false
}
```

- **`type`:** `arbejde`, `materiale`, `koersel`, `andet` (#5).
- **Arbejdslinjen** oprettes af serveren med `enhedspris_oere` = tilbuddets timepris og `antal` = `null`, til han skriver timerne (#3). Den har `kilde: "haandvaerker"`.
- **Kørselslinjen** oprettes og vedligeholdes af serveren ud fra `koersel`; klienten retter `koersel`, ikke linjen.
- **`linje_sum_oere`** regnes af serveren efter afrundingsreglen (#14) og er `null`, så længe antal eller pris mangler.
- **`enhed`** er fra grundlisten eller firmaets egne enheder (#11); linjen fryser navnet.

## 3. Hvad der er "ikke accepteret"

| Felt | Sat af | Accepteres ved |
|---|---|---|
| `titel` | modellen | `titel_bekraeftet: true` i en PATCH |
| `opgave_titel_forslag` | modellen | `POST …/opgave-titel` med `{ "handling": "accepter" }` eller `"afvis"`; først ved accept skrives titlen på opgaven (#12) |
| `opgavetype` | modellen | `opgavetype_bekraeftet: true` |
| `maengde` | modellen | `maengde_bekraeftet: true` |
| linje med `kilde: "model"` | modellen | `bekraeftet: true` i linjens PATCH |

- Han kan rette et forslag og bekræfte det i samme PATCH. Serveren sætter **aldrig** `bekraeftet` af sig selv; det sker kun, når klienten sender det.
- **Godkendelse afvises (`422`)**, hvis noget er ubekræftet, hvis en linje mangler antal eller pris, eller hvis tilbuddet ingen linjer har (#3). Opgavetype og mængde må være tomme (så indgår tilbuddet ikke i referencetallet), men står der et forslag, skal det bekræftes eller fjernes.

## 4. Forslaget: `POST /api/tilbud/tilbudslinjer`

**Klienten sender kun id'er, aldrig tekst** (trin D):

```json
{ "tilbud_id": "uuid", "referat_ids": ["uuid", "uuid"] }
```

Serveren:
1. Tjekker, at tilbuddet er en kladde i hans firma, og at hvert referat hører til netop den opgave og det firma. Ellers `404`.
2. Henter selv beskrivelse, noter og referaternes tekst, sætter referaterne i rækkefølge efter dato og lægger et loft på inputtets samlede længde (tallet kommer fra spor 2's måling).
3. Tjekker kvoten **før** kaldet (puljen `tilbud`, `kvote.js`).
4. Kalder modellen med låst model og prompt-version (D14), validerer svaret (afsnit 5) og prøver én gang mere ved ugyldigt svar.
5. **Erstatter tilbuddets ubekræftede model-linjer og -felter** med det nye forslag. Bekræftede linjer og hans egne linjer røres ikke.
6. Gemmer `kilder` og svarer med hele tilbuddet (afsnit 1).

**Data til `bygTilbudslinjePrompt(data) → {system, user}`** (spor 2's funktion):

```json
{
  "beskrivelse": "…",
  "noter": "…",
  "referater": [ { "dato": "2026-11-18", "kilde": "optagelse", "tekst": "…" } ],
  "firmaets_typer": [ { "navn": "Terrasse", "enhed": "m²" } ],
  "enheder": ["stk.", "m", "cm", "m²", "m³", "kg", "timer", "dag", "sæt", "rulle"]
}
```

Ikke med (#3, #4, dataminimering): timepris, kørsel, moms, kundens navn, telefon og adresse, id'er. Beskrivelsen er kundens egen tekst og behandles som utroværdigt input (S6).

## 5. Modelsvaret (spor 2 leverer — dette er spor 1's forslag)

```json
{
  "tilbud_titel": "Ny terrasse i lærk",
  "opgave_titel": "Terrasse, Søndergade",
  "opgavetype": { "navn": "Terrasse", "enhed": "m²" },
  "maengde": 40,
  "materialer": [
    { "beskrivelse": "Lærkebrædder 28×120", "antal": 95, "enhed": "m" },
    { "beskrivelse": "Skruer", "antal": null, "enhed": null }
  ]
}
```

Formvalideringen på serveren (P5):
- **Ukendte felter afvises** — særligt alt, der ligner pris, timer eller kørsel.
- Alle felter må være `null`; `materialer` må være tom.
- `antal` og `maengde` er tal ≥ 0 eller `null`. `enhed` skal stå i `enheder`-listen, ellers sættes den til `null`, og han vælger selv.
- Loft på tekstlængder og på antal materialer (tallene fra spor 2's måling).
- `opgavetype`: matcher navnet en af firmaets typer (uden hensyn til store/små bogstaver), bruges den; ellers står den som nyt forslag, som oprettes først, når han bekræfter.

## 6. Ruter (spor 1, trin B–D)

| Rute | Hvad |
|---|---|
| `GET /api/tilbud?lead_id=` | opgavens tilbud (alle versioner i kæden) |
| `POST /api/tilbud` `{lead_id}` | ny kladde, version 1, ny kæde. `409`, hvis opgaven har en kæde (Fase 5: én kæde, #15) |
| `GET /api/tilbud/:id` | ét tilbud |
| `PATCH /api/tilbud/:id` | felter på en kladde |
| `POST /api/tilbud/:id/linjer`, `PATCH`/`DELETE …/linjer/:linjeId` | linjer på en kladde |
| `POST /api/tilbud/:id/opgave-titel` | accepter eller afvis forslaget til opgavens titel |
| `POST /api/tilbud/:id/godkend` | frys, nummer, historik, lås (#2, #7) |
| `POST /api/tilbud/:id/ny-version` | ny kladde i samme kæde, fra profilen som den er nu |
| `POST /api/tilbud/:id/sendt`, `…/accepteret` | hændelser, han selv markerer (#1) |
| `POST /api/tilbud/tilbudslinjer` | forslaget (afsnit 4) |
| `GET /api/tilbud/referencetal?opgavetype_id=` | egne accepterede tilbud: antal og kr. pr. enhed for arbejde og materialer hver for sig (#9) |
| `GET`/`POST /api/tilbud/opgavetyper`, `…/enheder` | firmaets typer og enheder (#11) |

Alle tilbudsruter kræver modulet `tilbud` (som `referat` i dag).

## 7. Åbne punkter til spor 2

1. Modelsvarets form (afsnit 5): er felterne og navnene de rigtige for prompten og testsættet?
2. Lofterne: inputlængde, tekstlængder og antal materialer — fra målingen.
3. Hvor mange af firmaets typer sendes med (forslag: de 50 mest brugte)?
4. `rabat_pct` findes i skemaet, men ingen beslutning bruger den. Spor 1 foreslår at fjerne den, så afrundingsreglen har ét trin mindre. Ann afgør.
5. Kolonnenavnene for opgavens titel og noter i `leads` er ikke målt endnu; spor 1 måler dem før trin A.
