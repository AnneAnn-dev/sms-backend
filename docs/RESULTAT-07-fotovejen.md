# RESULTAT-07 — Fotovejen: ingen vision-model hos Scaleway opfylder bundgrænsen

*Målt 19/10-2026 på fotosættet (`FOTOSAETTET.md`): 15 fotos af 13 sedler, ti af Ann
(kuglepen, kursiv) og tre af Anne (blyant, trykbogstaver). Facit er rettet af dem, der
skrev sedlerne. Tærsklen var bundgrænsens kriterium 1–3 fra D36, og den blev sat før
målingen.*

**Kort:** Den bedste model, `qwen3.8-27b`, fik 72 % af de kritiske værdier rigtige på
Anns kursiv og 88 % på Annes trykbogstaver. Fejlene ligner rigtig tekst: forkert
klokkeslæt, forkert enhed, et opfundet navn og en aftale, hvis betydning blev vendt.
Rå fotos (teksten på siden) er markant dårligere for alle modeller. **Konsekvens (Ann
19/10): fotovejen er udskudt fra første prod-udgivelse.** Se D36.

---

## 1. Metode

- **Script:** `b7-vision.js` (prøvebænk, ikke repo), kørt fra `sms-backend` med
  `.env`. Det bruger samme nøgle og URL som referatet (`SCW_GENAI_SECRET_KEY`,
  `TILBUD_REFERAT_URL`). Scriptet og råsvarene ligger i
  `claude-arbejdstrae\Claude outputs\2026-10-19-fotovejen-b7\`.
- **Billeder:** 1500 px, JPEG q85, uden EXIF, lavet på forhånd. Hvert foto findes i to
  udgaver: `-op` (EXIF anvendt, teksten står ret op) og `-raa` (pixels som gemt,
  teksten på siden, svarer til en klient, der ignorerer EXIF). 265–410 KB.
- **Prompt:** Skriv af linje for linje · ret intet · overstreget tekst skal ikke med ·
  gennemskrivning skal ikke med · `[?]` i stedet for at gætte · `[afskåret]` ved
  kanten, fyld aldrig ud · tilføj intet.
- **Kald:** OpenAI-kompatibel `chat/completions` med `image_url` (base64),
  temperatur 0.

## 2. Hvilke modeller kan se billeder

`GET /models` gav 19 modeller. Prøve med ét billede (seddel 10, ret op):

| Model | Udfald |
|---|---|
| glm-5.3 | HTTP 400: "not a multimodal model" |
| lightonocr-3-0.8b | HTTP 400: afviser `max_tokens`-feltet |
| gemma-4-26b-a4b-it | tænkte sig ud over både 1200 og 4000 tokens, intet svar |
| qwen3.5-397b-a17b | samme; 32 s ved 4000 tokens |
| pixtral-12b-2409 | svarede; **450 → "480"**, overstreget med |
| mistral-medium-3.5-128b | svarede; overstreget klokkeslæt med, **torsdag → fredag**, **kl 9 → "d. 9"**, opfundet "køletekniker" |
| mistral-small-3.2-24b-instruct-2506 | svarede; **opfundet dato "12/9"** |
| qwen3.6-35b-a3b | perfekt på seddel 10 ved 4000 tokens, også "Fabriksvej" |
| qwen3.8-27b | rigtigt på alle tal; "Tåbriksvej" |

**`chat_template_kwargs.enable_thinking=false` virker ikke** hos Scaleway. Qwen
brugte samme antal tokens med og uden. De tænkende modeller koster derfor ca. 600–2400
udgående tokens pr. seddel, ikke ca. 200, og det skal med i Ø2.

Seddel 10's referatmodel i dag (`mistral-medium-3.5-128b`) var den dårligste af dem,
der svarede.

## 3. Den fulde kørsel

90 kald: 30 billeder × 3 modeller, `max_tokens` 4000.

| Model | Svar | Løb tør uden svar | Tid pr. kald |
|---|---|---|---|
| qwen3.6-35b-a3b | 7/30 | **23/30**, også 15 af de ret-op | 4–104 s |
| qwen3.8-27b | **30/30** | 0 | 5–38 s |
| mistral-small-3.2 | 25/30 | 5/30, alle rå (løkker: "[?] [?] …", "1.1.1.1…") | 1,5–42 s |

- **qwen3.6 er ustabil.** Den var perfekt i prøven og tænkte sig ud over budgettet på
  23 af 30 i kørslen. Ude.
- **mistral-small:** Tirsdag → "Fredag", kl. 10 → "kl. 11", 18 kvm → "18 km",
  65 kvm → "65 km", opfundne datoer ("12/9", "13.10.2022"). Ude.

## 4. qwen3.8-27b, ret op, mod facit

| Seddel | Rigtige | Forkerte (sedlen → model) |
|---|---|---|
| Ann 1 | 5/7 | Industrivej 18 → "Indenbrog 18" · onsdag → "Omday" |
| Ann 2 | 8/10 | Parkvej → "Balweg" · uge 38 → "og 38" |
| Ann 3 | 4/9 | **07:45 → 09:45** · Vestergade → "Vestvænge" · 3 steder → "3 stk" · **0,7 mm → "2 inch af mm"** · mandag-tirsdag → "mandag eller dag" |
| Ann 4 (hel) | 6/10 | Møllehuset → "Hollehuret" · **korn 40, 80 & 120 → "40,86 e 120"** · tirsdag, onsdag → "hindag", "terin" |
| Ann 4 (afskåret) | — | markerede `[afskåret]` rigtigt, men **opfandt "1400" og "1000"** i to linjer |
| Ann 5 | 5/6 | Nørrebrogade → "Nørrebro" |
| Ann 6 | 2/3 | Skovvej → "Movej" · **"Ikke oplagre materiale" → "Sikre opbevaring af materiale"** |
| Ann 7 | 4/6 | Engtoften → "Fryboften" · 20 ‰ → "20 1000" |
| Ann 8 | 5/7 | Bøgeparken → "Bøje pæren" · **65 kvm → "65 mm"** |
| Ann 9 | 5/5 | men **kunde → "Nina"** (opfundet navn) |
| Ann 10 | 7/8 | Fabriksvej → "Tåbriksvej" |
| **Ann i alt** | **51/71 = 72 %** | |
| Anne 1 | 6/6 | |
| Anne 2 | 4/5 | **3 lag → "2 lag"** |
| Anne 3 | 5/6 | torsdag → "forslag" |
| **Anne i alt** | **15/17 = 88 %** | |

**Modellen skrev aldrig `[?]`.** Prompten beder om det i stedet for gæt. Den gætter.

**Gadenavne er den svageste klasse:** 8 af 10 af Anns adresser er forkerte (kun Havnegade 12 og Søndergade 58 er rigtige). Det er
navne, så de hører under kriterium 3.

## 5. Rotation (B6), afgjort ved måling

Den rå udgave (teksten på siden) er **markant dårligere for alle tre modeller.**
qwen3.8 rå: "18 mm" for 18 kvm, "uge 35" for 39, "kl 15:00" for kl 10, et opfundet
navn ("Lars Sørensen"). mistral-small løb i løkke på 5 af 15 rå.
**Klienten skal sende billedet ret op (EXIF anvendt).** Om iOS-canvas gør det af sig
selv, måles på iPhone, når vejen genoptages.

## 6. Mod bundgrænsen

1. **Tal og mål korrekte: IKKE opfyldt.** Klokkeslæt, kornstørrelse, enhed (kvm → mm,
   mm → inch), antal lag.
2. **Intet opfundet om personer, aftaler eller beløb: IKKE opfyldt.** Et opfundet
   kundenavn, opfundne tal på det afskårne foto, en aftale med vendt betydning.
3. **Spøgelsesskrift: opfyldt** på de læste sedler. Referat 5's linje kom ikke med
   på referat 4.

**Værnsvalget (c) fra 18/10 forudsatte, at fejllæsninger er sjældne og synlige.** Målt
er der omkring én forkert kritisk værdi pr. seddel, og den ligner rigtig tekst. B6 skal
tages op igen, før vejen genoptages.

Det stemmer med læsningen 27/9, hvor en vision-model (Claude) tog fejl i tre af fem
sedler, alle i tal og enheder (rettet i `FOTOSAETTET.md`).

## 7. Næste kandidater (ikke målt)

Begge de første er bygget til håndskrift. Det er Scaleways generelle modeller ikke.

- **Mistral OCR 3/4** (Mistral AI, Frankrig). Fast pris pr. side, uafhængig af
  tænkning. Hvor data behandles, er ikke bekræftet.
- **Transkribus Text Titan** (READ-COOP, servere i Østrig, sletter efter 48 timer).
  Bygget til historiske dokumenter; moderne dansk er ikke bekræftet. Jobbaseret API.
- **Gemini via Vertex AI med EU-inferens** (Google). En generel model som dem ovenfor.

Samme 15 fotos, samme facit og samme skema. Kun kaldet i scriptet skal skiftes.

## 8. Grænser for målingen

- **To håndskrifter**, begge medstiftere. Ingen håndværker.
- **Ét lys**: indendørs, dagslys.
- **Ingen beløb i kr.** på nogen seddel. Den farligste fejl ifølge D36 er ikke i sættet.
- **Én kørsel pr. model** ved temperatur 0. **Temperatur 0 er ikke det samme som
  stabilt:** qwen3.8 gav ordret samme svar på seddel 10 i tre prøver, men i den fulde
  kørsel afveg samme seddel på ordniveau (1047 mod 1136 tokens). Tallene ovenfor er
  altså én stikprøve pr. seddel.
- Scorerne er talt i hånden mod facit ("skal overleve"-kolonnen). Råsvarene ligger i
  `resultater\*.json` til efterprøvning.
