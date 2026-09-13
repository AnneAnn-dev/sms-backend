# Resultat 2 — Hviske (syv.ai) mod whisper-large-v3 (Scaleway)

**Kørt:** 13-09-2026 · samme syv lydfiler · **ingen ordliste hos nogen af dem**
`syv-transcribe` via `platform.syv.ai/v1` mod `whisper-large-v3` via Scaleway.

**Hastighed:** Hviske 3,7–4,4 sek. · Scaleway 9,3–10,5 sek. — **ca. 2,5× hurtigere.**

---

## 1. Hviske vinder klart på dansk fagsprog

Det var hypotesen, og den holder. Samme lyd, samme betingelser:

| Blev sagt | Scaleway | **Hviske** |
|---|---|---|
| OSB-plader | USB-plader | **OSB plader** ✅ (3×) |
| brugsvand | bosvand | **brugsvandet** ✅ |
| vandmåler | valgmåneren | **vandmåleren** ✅ |
| slibe / slibning / finpudse | slips / slipning / finpusses | **slibes / slibning / finpudses** ✅ |
| stillads | stillagelse / stilæset | **Stilladset** ✅ |
| gulv, gulvlæggerne | guld, guldlæggerne (gennemgående) | **gulv, gulvlæggerne** ✅ |
| VVS-arbejdet | IVS-arbejdet | **VVS arbejdet** ✅ |
| tætningsbånd | tætningspunkt | **tætningsbånd** ✅ |
| nedløbsrør | midløbsrøret | **nedløbsrøret** ✅ |
| el-dåser | elddoser | **eldåser** ✅ |
| fliseklæb | fliseklip | **fliseklæb** ✅ |
| vådrum | rødrummet | **vådrum** ✅ |
| entré | "stue og træ" | **entré** ✅ |
| akklimatiseres | klimatiseres | **akklimatiseres** ✅ |
| egetræsgulvet | E-træsguldet | **Egetræsgulvet** ✅ |
| ovenlysvinduer | ovenløsvinduer | **ovenlysvinduer** ✅ |
| kapslingsgrad | kærpslingsgrader | kapslingsgrader ⚠ næsten |
| forskudte samlinger | forskellige samlinger ⚠ *(meningsændring)* | **forskudte samlinger** ✅ |
| køkkenelementer | "køkken, elementer og vand" | **køkkenelementer** ✅ |
| står i lod | står i lodder | **står i lod** ✅ |

**Og én ting mere, der har direkte betydning for referattrinnet:**
Scaleway skrev *"højdesforskel på ca. 8 mm **og en afstand på** ca. 4 meter"*, som
referatmodellen så måtte gætte sig til betydningen af. Hviske skrev **"højdeforskel på
cirka 8 mm **over** en afstand på cirka 4 meter"** — korrekt fra starten. **En rigtig
transskription fjerner behovet for, at modellen gætter.**

### Hvor Hviske til gengæld taber

| Blev sagt | Scaleway | Hviske |
|---|---|---|
| regler (til skillevægge) | **regler** ✅ | **reklamer** / **rickler** ❌ |
| mineraluld | mineral ud ❌ | mineraler ud ❌ |
| lægter | **lægter** ✅ | **længde** ❌ |
| oprydningen | **oprydning** ✅ | **oplygningen** ❌ |
| tandspartel | tandspæl ❌ | tandspejl ❌ |
| forskalling | forskatning ❌ | forskatning ❌ |

**Og begge hallucinerer i starten af el-optagelsen.** Scaleway: *"Eller det er vores
regering, for det er det, jeg nærmer mig."* Hviske: *"Efter vores regering fulgte
nærmest."* To forskellige modeller finder på næsten det samme sted — **det er
optagelsen, ikke modellen.** Der er noget lyd i starten, som ingen af dem kan tyde.

---

## 2. ⛔ Men Hviske taber indhold — og det er værre

Tegn pr. fil, Hviske mod Scaleway:

| Optagelse | Scaleway | Hviske | Forskel |
|---|---|---|---|
| 1 tømrer | 2.263 | 2.055 | −9 % |
| 2 murer | 2.271 | **1.163** | **−49 %** |
| 3 el | 2.572 | 2.327 | −10 % |
| 4 vvs | 2.315 | 1.871 | −19 % |
| 5 maler | 2.373 | 2.049 | −14 % |
| 6 taglægger | 2.319 | 1.804 | −22 % |
| 7 gulv | 2.434 | 1.765 | −27 % |

**Det er ikke, fordi Hviske skriver mere kompakt.** Tværtimod: Hviske beholder "øh" og
tøvelyde, som Scaleway fjerner. Den skriver *mere* ordret og alligevel *mindre* — altså
mangler der tekst.

**Konkret, hvad der er væk:**

- **Murer** springer fra "…som skal afklares" direkte til faldet mod gulvafløbet. Hele
  afsnittet om pudsning, flisning, ujævnheden ved brusenichen og de **5 mm ekstra
  spartel** er forsvundet. Det samme er revnen på 1,5 m, mørtlen og armeringsnettet,
  samt hele slutningen om levering og transportskader.
- **Taglægger** begynder midt i en sætning: *"og den har er De beskadigede områder…"*
  Mødedato, deltagere og afsnittet om de gamle tagsten på nordsiden mangler.
- **Gulv** og **el** mangler deres afslutninger.
- **VVS** mangler afsnit i midten.

### Og én meningsvending

Optagelsen: *"Ved hjørner og overgange skal der **ikke** anvendes almindelig cementfuge.
Her skal anvendes **elastisk silikonefuge**."*

Hviske: *"Ved hjørne og overgange skal der **ikke anvendes elastisk silikonefuge**."*

To sætninger er smeltet sammen, og **instruktionen er vendt om.** Det er den værste
enkeltfejl i hele forsøget — værre end USB-plader, fordi den er en anvisning om,
hvordan man skal arbejde, og fordi den læser helt naturligt.

---

## 3. Hvad det betyder

**De to modeller fejler komplementært.** Hviske løser præcis det problem, vi fandt i
Resultat 1 — dansk fagsprog — og gør det overbevisende. Men den introducerer et problem,
der er værre.

**Et forkert ord kan opdages. Manglende indhold kan ikke.** Referatmodellen kan rette
"undertallet" til "undertag"; den kan ikke genskabe et afsnit, der aldrig nåede frem.
Og håndværkeren kan ikke savne noget, han ikke kan se mangler.

**Ingen af dem er god nok alene.** Det er en skarpere konklusion end før, og den er
bedre end at have valgt på fornemmelse.

---

## 4. Næste skridt — diagnosen før beslutningen

**Manglen skal forstås, før den kan diskvalificere.** Den mest sandsynlige forklaring er
**lang lyd**: en 2B conformer har et begrænset vindue og skal skære lyden i stykker.
Går et stykke tabt ved en overgang, forsvinder indholdet lydløst. Modelkortet nævner
netop "long-form audio handling" som et selvstændigt emne.

Er det forklaringen, er det **konfiguration, ikke kvalitet** — og så kan det løses.

**Det kan afgøres præcist:** platformens API har en **`Timestamps`**-fane. Kommer der
segmenter tilbage med start- og sluttid, kan de holdes op mod filens faktiske længde
(optagelse 1 er målt til 142 sekunder). **Er der huller i tidslinjen, er beviset ført** —
og så ved vi, at lyd blev sprunget over, ikke at modellen valgte at udelade.

**Derefter — og først derefter — er `Vocabulary`-fanen interessant.** Fagordlisten er
løsningen på det problem, Hviske allerede er bedst til. Den er ikke løsningen på
manglende indhold.

---

## 4b. DIAGNOSEN — kørt 13/9, og svaret er et fjerde, jeg ikke forudså

Tidsstemplerne afgjorde det. **Ingen af mine tre hypoteser var rigtige.**

**Filen blev ikke afkortet.** `optagelse 5 maler` måler 142,31 sek. med ffprobe, og
API'et melder 142,3 sek. tilbage. Platformen ser hele lyden.

**Hullerne er ikke problemet.** De fleste er 0,8–2,0 sek. — vejrtrækning mellem
sætninger. Min grænse på 0,75 sek. var for stram.

**Problemet ligger INDE i segmenterne.** Se murer-filen:

| Segment | Længde | Tegn | Tegn/sek. |
|---|---|---|---|
| 18,3–45,6 | 27,3 s | 429 | 15,7 |
| 59,8–73,4 | 13,6 s | 236 | 17,4 |
| 84,4–90,4 | 6,0 s | 102 | 17,1 |
| **91,5–116,7** | **25,2 s** | **75** | **3,0** |
| **116,7–139,0** | **22,3 s** | **61** | **2,7** |

Normal taletæthed i optagelserne er **14–17 tegn i sekundet**. To segmenter leverer
**under 3**. De påstår at dække 47 sekunders tale og afleverer 136 tegn.

Og `no_speech_prob` er **0,0** på begge. **Modellen mener selv, at der bliver talt.**
Den hører tale, markerer tidsrummet som transskriberet — og udelader indholdet.

Samme mønster i gulv-filen: 104,4–129,8 (25,5 s) giver 5,6 tegn/s, og 162,3–185,4
(23,1 s) giver 3,5.

Målt mod normal taletæthed **mangler murer ca. 33 % og gulv ca. 22 % af teksten** —
uden at noget i svaret antyder det.

### Og det forklarer meningsvendingen

Optagelsen: *"…skal der **ikke** anvendes almindelig cementfuge. Her skal anvendes
**elastisk silikonefuge**."*
Hviske: *"Ved hjørne og overgange skal der **ikke anvendes elastisk silikonefuge**."*

Det er ikke en selvstændig fejl. **Det er det lavdensitets-segment.** Modellen slugte
midten og svejsede resterne sammen — negationen fra første sætning røg over på
materialet fra den anden. Instruktionen blev vendt om som en bivirkning af, at indhold
forsvandt.

**Det er derfor manglende indhold er den farligste fejlklasse.** Den er ikke bare et tab
— den kan producere en ny, flydende, troværdig sætning, der siger det modsatte.

### Konklusionen: kvalitet, ikke konfiguration

Tredje udfald på listen, altså den dyre. Det er ikke chunking, der kan sættes rigtigt
op — modellen springer tale over midt i et segment, den selv markerer som tale.

**Men det kan opdages.** Tætheden er deterministisk og gratis at måle: **et segment
længere end 8 sek. med under ~7 tegn i sekundet og lav `no_speech_prob` er et rødt
flag.** Det er teknik C fra beslutningsgrundlaget, realiseret — og den virker, fordi
Hviske afleverer tidsstempler.

**Det er også en brugbar fejlrapport.** syv.ai er et lille dansk hus, og de har ikke
noget offentligt benchmark på håndværkersprog. Syv filer med tidsstempler, tegntæthed
og et konkret eksempel på en inverteret instruktion er præcis det, de ville kunne
handle på. Det koster en mail og kan gøre produktet bedre for begge parter.

---

## 5. Foreløbig stilling

| | Scaleway whisper | Hviske |
|---|---|---|
| Fagsprog | svag | **klart bedre** |
| Fuldstændighed | **fuldstændig** | mangler op til halvdelen |
| Hastighed | 10 sek. | **4 sek.** |
| Pris pr. lydtime | **1,34 kr.** | 2,80 kr. |
| Meningsfejl fundet | 1 (plant→blankt) | 1 (inverteret fugeanvisning) |
| Hallucineret opstart | ja (el) | ja (el) — samme sted |

**Anbefaling efter diagnosen (13/9): bliv på Scaleway til Fase 1.**

Hviske er bedre til dansk fagsprog — det er ikke til diskussion efter denne test. Men
den taber 20–33 % af indholdet i nogle optagelser, gør det lydløst, og kan vende en
instruktion om undervejs. **Et forkert ord kan håndværkeren se. Et forsvundet afsnit
kan han ikke.**

**Genoptag Hviske, når to ting er på plads:** at syv.ai har set fejlrapporten og svaret
på den, og at tæthedstjekket er bygget, så et lavdensitets-segment aldrig når frem til
et referat uden et flag.

**Og tag én ting med fra Hviske uanset hvad:** `response_format=verbose_json` giver
segmenter og `no_speech_prob`. Scaleways whisper understøtter efter alt at dømme samme
format. **Kør `04-tidslinje.ps1 -BaseUrl ""` mod Scaleway** — så ved vi, om den samme
tæthedsmåling kan bruges som værn dér, og om whisper har lav konfidens netop ved
"USB-plader".
