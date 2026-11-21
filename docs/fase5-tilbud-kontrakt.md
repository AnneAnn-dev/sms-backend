# Fase 5 Tilbud — kontrakten mellem spor 1 og spor 2

Udkast 5, skrevet af spor 1 21/11-26 ud fra byggeplanen (`docs/fase5-tilbud-byggeplan.md`, 20.313 bytes) og spor 2's svar på udkast 2 og 3 (21/11). Ændret fra udkast 3: titlerne må indeholde navn og adresse (Ann 21/11) — værnet og prompt-reglen er fjernet. Ændret fra udkast 4: hver uenig værdi har sin kilde og dato med (Ann 21/11). **Spor 2 har sagt god for udkast 4; ændringen i udkast 5 skal bekræftes af spor 2. Afventer Anns godkendelse**; ingen af sporene koder efter den før.

Kontrakten fastlægger fire ting: hvad klienten sender og får tilbage (tilbud og linje), hvilke felter der er "ikke accepteret", hvad serveren giver prompten, og hvad modellen må svare. Byggeplanens beslutninger står over kontrakten; numrene (#) henviser til dem.

## 0. Grundregler

- **Penge er heltal i øre** overalt i JSON (`12350` = 123,50 kr.). Aldrig kommatal. Det er forudsætningen for #14.
- **Antal og mængde er tekst med op til tre decimaler** mellem server og klient (`"1.5"`, `"42.125"`, punktum som decimaltegn). Serveren læser dem præcist; klienten regner aldrig på dem. (Modellen svarer med JSON-tal, se afsnit 5.)
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
  "titel_kilde": "model",
  "titel_bekraeftet": false,
  "opgave_titel_forslag": "Ny terrasse",
  "opgave_titel_forslag_status": "afventer",

  "opgavetype": { "id": null, "navn": "Terrasse", "enhed": "m²", "ny": true },
  "opgavetype_kilde": "model",
  "opgavetype_bekraeftet": false,
  "maengde": { "vaerdi": "40", "enhed": "m²" },
  "maengde_kilde": "model",
  "maengde_bekraeftet": false,

  "uenige": [ { "felt": "maengde", "vaerdier": [ { "kilde": "noter", "dato": null, "vaerdi": "48 m²" }, { "kilde": "referat", "dato": "2026-11-18", "vaerdi": "45 m²" } ] } ],

  "indledning": "…",
  "betingelser": "…",
  "gyldig_til": "2026-12-21",
  "timepris_oere": 47500,
  "moms_sats": "25.00",
  "koersel": { "form": "km", "km": "18", "sats_oere": 380, "beloeb_oere": null },
  "rabat": { "form": "procent", "procent": "10", "beloeb_oere": null },

  "firma": { "navn": "…", "cvr": "…", "adresse": "…", "telefon": "…", "email": "…", "bank_reg": "…", "bank_konto": "…" },

  "summer": {
    "arbejde_oere": 520000, "materialer_oere": 1500000, "koersel_oere": 0, "andet_oere": 0,
    "foer_samlet_rabat_oere": 2020000, "samlet_rabat_oere": 202000,
    "ex_moms_oere": 1818000, "moms_oere": 454500, "inkl_moms_oere": 2272500
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
- **`opgavetype`:** `"ny": true` betyder, at typen ikke findes på firmaet endnu; den oprettes først, når han bekræfter (#11).
- **`maengde`:** har sin egen enhed. Passer enheden ikke til typens, står mængden som forslag uden type, og han vælger.
- **`*_kilde`:** `"model"` eller `"haandvaerker"`. Se afsnit 3 om, hvornår den skifter.
- **`uenige`** (#10): de felter, hvor kilderne siger noget forskelligt. **Hver værdi har sin kilde og dato med** (Ann 21/11), så han kan se, hvem der siger hvad: `kilde` er `"beskrivelse"`, `"noter"` eller `"referat"`, `dato` er kildens dato (`null` for noterne, som ingen dato har), `vaerdi` er det, kilden siger, ordret. Klienten viser fx "Noter: 48 m² · Referat 18/11: 45 m²". Et punkt fjernes, når feltet bekræftes.
- **`rabat`** (#16): rabatten på hele tilbuddet. `form` er `null`, `"procent"` eller `"kroner"`; kun det matchende felt er udfyldt. Trækkes fra efter linjerne og før moms.
- **`summer`:** arbejde, materialer, kørsel og andet er efter linjerabat. `samlet_rabat_oere` er rabatten på hele tilbuddet. Eksemplet er 12 t × 475 kr. − 500 kr. linjerabat, 15.000 kr. materialer, 10 % samlet.
- **`kilder`:** sættes, når forslaget laves (afsnit 4), og fryses ved godkendelse (#10).
- **`tilbudsnummer`:** heltal, sat ved godkendelse; en ny version får et nyt (#7).
- **`kan_godkendes` og `mangler`:** serveren fortæller, hvad der står i vejen. Klienten viser listen; den gætter ikke selv.

## 2. Linje

```json
{
  "id": "uuid",
  "sortering": 3,
  "type": "materiale",
  "beskrivelse": "Skruer",
  "antal": "3",
  "enhed": { "id": null, "navn": "pakker", "ny": true },
  "enhedspris_oere": null,
  "rabat": { "form": null, "procent": null, "beloeb_oere": null },
  "rabat_oere": null,
  "linje_sum_oere": null,
  "uenig": null,
  "kilde": "model",
  "bekraeftet": false
}
```

- **`type`:** `arbejde`, `materiale`, `koersel`, `andet` (#5).
- **Arbejdslinjen** oprettes af serveren med `enhedspris_oere` = tilbuddets timepris og `antal` = `null`, til han skriver timerne (#3). Den har `kilde: "haandvaerker"`.
- **Kørselslinjen** oprettes og vedligeholdes af serveren ud fra `koersel`; klienten retter `koersel`, ikke linjen.
- **`enhed`** er fra grundlisten eller firmaets egne enheder (#11); linjen fryser navnet. `"ny": true` betyder en enhed, firmaet ikke har endnu; den oprettes, når han bekræfter linjen ("Tilføj enhed").
- **`uenig`:** kildernes forskellige værdier for linjen i samme form som `uenige[].vaerdier` (kilde, dato, værdi), eller `null`. Fjernes, når linjen bekræftes.
- **`rabat`** (#16): linjens rabat, samme form som tilbuddets. `rabat_oere` er beløbet, serveren har regnet. Erstatter `rabat_pct`.
- **`linje_sum_oere`** regnes af serveren efter afrundingsreglen (#14): antal × pris − linjens rabat, afrundet én gang. `null`, så længe antal eller pris mangler.
- **En rabat, der gør linjen eller tilbuddet negativt, afvises med `422`.**

## 3. Hvad der er "ikke accepteret"

| Felt | Sat af | Accepteres ved |
|---|---|---|
| `titel` | modellen | `titel_bekraeftet: true` i en PATCH |
| `opgave_titel_forslag` | modellen | `POST …/opgave-titel` med `{ "handling": "accepter" }` eller `"afvis"`; først ved accept skrives titlen på opgaven, `leads.titel` (#12) |
| `opgavetype` | modellen | `opgavetype_bekraeftet: true` |
| `maengde` | modellen | `maengde_bekraeftet: true` |
| linje med `kilde: "model"` | modellen | `bekraeftet: true` i linjens PATCH |

- Han kan rette et forslag og bekræfte det i samme PATCH. Serveren sætter **aldrig** `bekraeftet` af sig selv; det sker kun, når klienten sender det.
- **En PATCH, der ændrer indholdet af et model-felt eller en model-linje, sætter `kilde: "haandvaerker"`.** Feltet eller linjen er nu hans, men stadig `bekraeftet: false`, hvis han ikke har bekræftet. Et nyt forslag rører den ikke (afsnit 4, trin 5).
- **Godkendelse afvises (`422`)**, hvis noget er ubekræftet, hvis en linje mangler antal eller pris, eller hvis tilbuddet ingen linjer har (#3). Opgavetype og mængde må være tomme (så indgår tilbuddet ikke i referencetallet), men står der et forslag, skal det bekræftes eller fjernes.

## 4. Forslaget: `POST /api/tilbud/tilbudslinjer`

**Klienten sender kun id'er, aldrig tekst** (trin D):

```json
{ "tilbud_id": "uuid", "referat_ids": ["uuid", "uuid"] }
```

Serveren:
1. Tjekker, at tilbuddet er en kladde i hans firma, og at hvert referat hører til netop den opgave og det firma. Ellers `404`.
2. Henter selv beskrivelse (`leads.task`), noter (`leads.notes`) og referaternes tekst, sætter referaterne i rækkefølge efter dato og lægger et loft på inputtets samlede længde (afsnit 7).
3. Tjekker kvoten **før** kaldet (puljen `tilbud`, `kvote.js`).
4. Kalder modellen med låst model og prompt-version (D14), validerer svaret (afsnit 5) og prøver én gang mere ved ugyldigt svar.
5. **Erstatter kun det, der både har `kilde: "model"` og `bekraeftet: false`** — linjer, titel, opgavetype, mængde og `uenige`. Hans egne og hans rettede felter og linjer røres ikke, heller ikke de ubekræftede. Klienten advarer, før et nyt forslag laves.
6. Gemmer `kilder` og svarer med hele tilbuddet (afsnit 1).

**Data til `bygTilbudslinjePrompt(data) → {system, user}`** (spor 2's funktion):

```json
{
  "beskrivelse": "…",
  "beskrivelse_dato": "2026-11-12",
  "beskrivelse_kilde": "kundeformular",
  "noter": "…",
  "referater": [ { "dato": "2026-11-18", "kilde": "optagelse", "tekst": "…" } ],
  "firmaets_typer": [ { "navn": "Terrasse", "enhed": "m²" } ],
  "enheder": ["stk.", "m", "cm", "m²", "m³", "kg", "timer", "dag", "sæt", "rulle"]
}
```

- **`beskrivelse_dato`:** opgavens oprettelse (`leads.created_at`).
- **`beskrivelse_kilde`:** `"kundeformular"` eller `"haandvaerker"` (Ny opgave). Kundens tekst er utroværdig (S6); prompten mærker den derefter. Hvordan serveren skelner de to, måler spor 1 i koden før trin D.
- **`noter`** har ingen dato: `leads` har ingen kolonne for, hvornår noterne sidst blev ændret (målt 21/11; `updated_at` gælder hele rækken). **Reglen:** er noterne uenige med en anden kilde, vælger modellen ingen af dem. Feltet står tomt, og uenigheden meldes i `uenige` med begge værdier. Han vælger.
- **`referater[].kilde`:** `"optagelse"`, `"upload"` eller `"manuel"` (check-listen på `referater.kilde`, målt 20/11).
- **`firmaets_typer`:** de 50 mest brugte, ved lige antal sorteret efter senest brugt.

Ikke med (#3, #4, dataminimering): timepris, kørsel, moms, kundens navn, telefon og adresse, id'er.

## 5. Modelsvaret (spor 2 leverer — aftalt form)

```json
{
  "tilbud_titel": "Ny terrasse i lærk",
  "opgave_titel": "Ny terrasse",
  "opgavetype": { "navn": "Terrasse", "enhed": "m²" },
  "maengde": { "vaerdi": 40, "enhed": "m²" },
  "materialer": [
    { "beskrivelse": "Lærkebrædder 28×120", "antal": 95, "enhed": "m" },
    { "beskrivelse": "Skruer", "antal": 3, "enhed": "pakker" }
  ],
  "uenige": [ { "felt": "maengde", "vaerdier": [ { "kilde": "noter", "dato": null, "vaerdi": "48 m²" }, { "kilde": "referat", "dato": "2026-11-18", "vaerdi": "45 m²" } ] } ]
}
```

- `beskrivelse` er ordret, som materialet blev nævnt; modellen retter ikke.
- `uenige[].felt` er `"maengde"`, `"opgavetype"` eller `"materialer[n]"` (linjens plads i svaret, fra 0). `vaerdier` er en liste af `{kilde, dato, vaerdi}`: `kilde` er `"beskrivelse"`, `"noter"` eller `"referat"`, `dato` er den dato, kilden har i input (`beskrivelse_dato`, referatets `dato`, `null` for noterne), og `vaerdi` er det, kilden siger, ordret.
- **Titlerne er håndværkerens** (Ann 21/11): de må indeholde kundens navn, adresse eller andet, han kender opgaven på. De følger samme regel som resten af svaret — intet, der ikke står i kilderne. Kundens adresse fra `leads` sendes ikke til modellen (afsnit 4), så en adresse i titlen kan kun komme fra teksten.

Formvalideringen på serveren (P5):
- **Ukendte felter afvises** — særligt alt, der ligner pris, timer eller kørsel.
- Alle felter må være `null`; `materialer` og `uenige` må være tomme.
- **Tal:** `antal` og `maengde.vaerdi` er JSON-tal ≥ 0 med højst tre decimaler, eller `null`. **Et tal skrevet som tekst (`"1,5"`) eller med flere decimaler er en formfejl** og udløser den ene retry. Serveren laver tallet om til tekst (afsnit 0).
- **Enheder:** modellen skriver enheden, som den står i teksten. Matcher den listen (uden hensyn til store/små bogstaver), bruges den; ellers bliver den et forslag til en ny enhed på firmaet (`"ny": true`).
- **Opgavetype:** matcher navnet en af firmaets typer (uden hensyn til store/små bogstaver og mellemrum i enderne), bruges den; ellers står den som nyt forslag.
- **`uenige[].felt`** skal pege på et felt eller en linje, der findes i svaret, og **hver `kilde`/`dato` skal svare til en kilde, der faktisk var i input** (beskrivelsen med `beskrivelse_dato`, noterne med `null`, et referat med en af referaternes datoer); ellers formfejl.
- Lofter på længder og antal (afsnit 7).

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
| `GET /api/tilbud/referencetal?opgavetype_id=` | egne accepterede tilbud: antal og kr. pr. enhed for arbejde og materialer hver for sig (#9, #16) |
| `GET`/`POST /api/tilbud/opgavetyper`, `…/enheder` | firmaets typer og enheder (#11) |

Alle tilbudsruter kræver modulet `tilbud` (som `referat` i dag).

## 7. Lofter (foreløbige) og PDF

**Lofterne er foreløbige, til spor 2's måling er kørt** (`docs/fase5-tilbud-maaling.md`, udgave 5). Startværdierne er rummelige med vilje:

| Hvad | Foreløbigt loft |
|---|---|
| Tilbuddets og opgavens titel | 100 tegn |
| Materialebeskrivelse | 200 tegn |
| Antal materialer | 60 |
| Input i alt | 40.000 tegn (endeligt: det dobbelte af sættets længste, målt ved loftet) |

De endelige tal kommer i målingens resultat og i en ny udgave af kontrakten.

**Rabatterne på PDF'en** (spor 2's forslag, layoutet aftales med Anne i trin D): linjerabat som en indrykket linje under linjen ("Rabat 10 %", beløbet negativt); samlet rabat som egen linje efter summen af linjerne og før moms. Alle beløb er serverens (`rabat_oere`, `samlet_rabat_oere`).

## 8. Stadig åbent

1. Hvordan serveren kender en opgave fra kundeformularen fra en fra Ny opgave (`beskrivelse_kilde`) — spor 1 måler det i koden. **Skal være afgjort, før prompten låses**, fordi prompten mærker kundens tekst som utroværdig ud fra den værdi.
2. De endelige lofter — fra målingen.
