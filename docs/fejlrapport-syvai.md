# Mail til syv.ai — udkast

**Til:** mads@syv.ai (og soren@syv.ai)
**Emne:** Hviske springer tale over midt i et segment — med tidsstempler og tal

---

Hej Mads

Vi er i gang med at vælge transskriptionsmodel til et dansk produkt, hvor håndværkere
dikterer noter, og vi har kørt Hviske op mod whisper-large-v3 på det samme sæt
optagelser. Jeg synes, I skal have resultatet — der er både noget rigtig godt og én
ting, der ser ud som en fejl.

## Opsætningen

Syv optagelser à ca. 2½ minut, dansk diktering af byggemødenotater fordelt på syv fag
(tømrer, murer, el, VVS, maler, tagdækker, gulvlægger). Én taler, varierende
baggrundsstøj. Filerne er `.m4a` fra en iPhone. Kaldt direkte mod
`platform.syv.ai/v1/audio/transcriptions` med `model=syv-transcribe`, `language=da`,
ingen ordliste. Samme filer kørt gennem `whisper-large-v3` til sammenligning.

## Det gode først

**Hviske er markant bedre til dansk fagsprog end whisper**, og forskellen er ikke
marginal. Nogle eksempler, hvor whisper fejlede og Hviske ramte rigtigt:

| Blev sagt | whisper-large-v3 | Hviske |
|---|---|---|
| OSB-plader | USB-plader | OSB plader ✅ |
| brugsvand | bosvand | brugsvandet ✅ |
| vandmåler | valgmåneren | vandmåleren ✅ |
| slibning / finpudse | slipning / finpusses | slibning / finpudses ✅ |
| stillads | stillagelse | stilladset ✅ |
| gulvlæggerne | guldlæggerne (gennemgående) | gulvlæggerne ✅ |
| VVS-arbejdet | IVS-arbejdet | VVS arbejdet ✅ |
| tætningsbånd | tætningspunkt | tætningsbånd ✅ |
| nedløbsrør | midløbsrøret | nedløbsrøret ✅ |
| fliseklæb | fliseklip | fliseklæb ✅ |

I er også ca. 2,5 gange hurtigere: 3,7–4,4 sek. mod 9,3–10,5 sek. pr. optagelse.

## Fejlen

Hviske afleverer **mellem 9 % og 49 % mindre tekst** end whisper på de samme filer.
Det er ikke komprimering — Hviske beholder "øh" og tøvelyde, som whisper fjerner. Der
mangler indhold.

Med `response_format=verbose_json` kan man se hvor. Fra optagelse 2 (murer, 161,7 sek.):

| Segment | Længde | Tegn | Tegn/sek. | `no_speech_prob` |
|---|---|---|---|---|
| 18,3–45,6 | 27,3 s | 429 | 15,7 | 0.0 |
| 59,8–73,4 | 13,6 s | 236 | 17,4 | 0.0 |
| 84,4–90,4 | 6,0 s | 102 | 17,1 | 0.0 |
| **91,5–116,7** | **25,2 s** | **75** | **3,0** | **0.0** |
| **116,7–139,0** | **22,3 s** | **61** | **2,7** | **0.0** |

Normal taletæthed i optagelserne er 14–17 tegn i sekundet. De to markerede segmenter
påstår at dække 47 sekunders tale og afleverer 136 tegn. `no_speech_prob` er 0.0 — altså
vurderer modellen selv, at der bliver talt.

Samme mønster i optagelse 7 (gulvlægger): 104,4–129,8 (25,5 s) giver 5,6 tegn/sek., og
162,3–185,4 (23,1 s) giver 3,5.

Tidsstemplerne har ingen huller af betydning, og `duration` fra API'et matcher filens
faktiske længde målt med ffprobe (142,31 sek. mod jeres 142,3 på optagelse 5). Lyden
når altså frem — indholdet forsvinder inde i segmentet.

## Hvorfor vi hæfter os ved det

Det er ikke kun et tab. I ét tilfælde opstod der en **omvendt instruktion**.

Der blev sagt: *"Ved hjørner og overgange skal der **ikke** anvendes almindelig
cementfuge. Her skal anvendes **elastisk silikonefuge**."*

Hviske skrev: *"Ved hjørne og overgange skal der **ikke anvendes elastisk
silikonefuge**."*

Det ligger præcis i det lavdensitets-segment. Midten er sluppet væk, og resterne er
svejset sammen, så negationen fra første sætning er havnet på materialet fra den anden.
Sætningen læser helt naturligt, og der er intet i svaret, der antyder, at noget mangler.

For os er dét forskellen på en fejl, brugeren kan opdage, og en, han ikke kan.

## Vi deler gerne materialet

Vi har de syv lydfiler, transskriptionerne fra begge leverandører, den fulde
`verbose_json` med tidsstempler og en facitliste over fagtermer pr. optagelse. I er
velkomne til det hele, hvis det kan bruges — sig bare til.

## To spørgsmål

1. **Prisenheden.** Vi har fået 3,60 kr./time for Hviske v5.3 og 10,80 for premium
   (2,80 og 8,64 ekskl. moms). Er det pr. **lydtime** eller pr. maskintime? Det ændrer
   regnestykket fuldstændigt for os, og jeg vil nødig regne forkert.
2. **Vocabulary.** Jeres API har en ordliste-funktion. Vi har en fagordbog pr.
   håndværkerfag liggende. Hjælper den på termerne — og ændrer den noget ved
   ovenstående?

Vi har valgt whisper til vores første fase på grund af fuldstændigheden, men Hviske er
klart bedst på det, der betyder mest for os, så vi vil gerne kigge på den igen.

Venlig hilsen
Ann
Dit Digitale Kontor
