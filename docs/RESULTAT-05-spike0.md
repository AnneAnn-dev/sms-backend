# RESULTAT-05 — Spike 0: mikrofon og foto i den installerede PWA

*Målt 26/9-2026 på Anns iPhone. iOS 18.7, Safari 26.6.1, siden installeret på hjemmeskærmen
fra staging (`/spike0.html`), `standalone=true` bekræftet ved hver åbning.*

**Kort:** vejen virker. Formatet går uændret til Scaleway. Men optagelsen overlever ikke,
at appen går i baggrunden, og i ét tilfælde blev 48 sekunder væk uden en fejlbesked.

---

## De syv spørgsmål

| # | Spørgsmål | Svar |
|---|-----------|------|
| 1 | Kan appen få mikrofonen fra hjemmeskærmen? | **Ja.** 48 kHz, mono, `echoCancellation: true`, enhed "iPhone-mikrofon" |
| 2 | Hvilket format optager den i? | **`audio/mp4; codecs=mp4a.40.2`** (AAC i MP4-beholder) |
| 3 | Tager Scaleway imod formatet? | **Ja, rå.** HTTP 200 på 8,8 sek., dansk tekst retur. Ingen konvertering |
| 4 | Holder optagelsen, når skærmen låser eller man skifter app? | **NEJ.** Se afsnittet nedenfor |
| 5 | Spørger den om lov hver gang? | **Nej.** Én gang, og tilladelsen overlever, at appen lukkes helt |
| 6 | Holder den 2½ minut? | **Ja.** 161,1 sek. optaget = 161,1 sek. lyd, 3,7 MB, intet tab |
| 7 | Fotovejen? | **JPEG**, 3024 × 4032, 2,3 MB. Ingen HEIC |

## Formatet — og en fælde i koden

`MediaRecorder` blev oprettet uden `mimeType`, så iOS selv valgte. Resultatet er AAC i en
MP4-beholder, og filen blev sendt som `.mp4` til `whisper-large-v3` uden at blive rørt.

```
Fil:        spike0-2026-09-26-05-32-25.mp4   (3,7 MB, 2 min 41 sek.)
Model:      whisper-large-v3, sprog da
HTTP 200 -- 8,8 sek.   1957 tegn dansk tekst retur
```

**Det betyder, at serveren ikke skal omkode.** Ingen ffmpeg, ingen ny afhængighed, ingen
ny fejlkilde mellem telefonen og leverandøren. Det var det dyreste mulige udfald, og det
blev undgået.

**⚠️ Fælde til adapteren: `recorder.mimeType` var TOM streng hele vejen.** Ved hver eneste
optagelse loggede siden `recorder.mimeType = ''`. Formatet står kun på den færdige blob
(`blob.type`). Bygges filnavnet i multipart på recorderens felt, sender vi en fil uden
endelse af sted. **Læs formatet fra blobben, ikke fra recorderen.**

Forholdet mellem lyd og tid: 161 sekunders lyd blev transskriberet på 8,8 sekunder,
altså cirka 1 : 18. Det er tallet, ventetiden i UI'et skal designes efter.

## Tilladelsen

| Hændelse | Ventetid på `getUserMedia` | Spurgte den? |
|---|---|---|
| Første optagelse efter installation | 1359 ms | Nej (tilladelsen stod allerede som `granted`) |
| Alle efterfølgende, samme session (9 kald) | 300-397 ms | Nej |
| Efter appen blev lukket helt og åbnet igen | — | Nej. `tilladelse ved start: granted` |

Tilladelsen følger oprindelsen og overlever en genstart af appen. Den skal derfor ikke
forklares ved hver brug i onboardingen — kun første gang.

## Det alvorlige fund: baggrunden dræber optagelsen

Mønsteret er det samme hver gang, appen forlades under optagelse:

```
SPOR MUTE (lyden stoppet af systemet)
SYNLIGHED: hidden  [optager]
... 4-6 sekunder ...
SPOR ENDED (mikrofonen taget fra os)
```

Fem forsøg i træk, alle med tab:

| Vægur | Afkodet lyd | Tab |
|-------|-------------|-----|
| 31,9 s | 27,0 s | 4,9 s |
| 27,0 s | 22,0 s | 5,0 s |
| 27,5 s | 22,0 s | 5,5 s |
| 29,3 s | 23,0 s | 6,3 s |
| 27,6 s | 21,0 s | 6,6 s |

**Og det værste tilfælde, kl. 07:24:18.** Her blev der skiftet frem og tilbage flere
gange. Sporet blev mutet og unmutet tre gange, og optageren stoppede **ikke**:

```
vægur 49,9 s · 2 stykker · største hul 47,9 s · 40 KB
AFKODET OK: lydlængde 1,9 s — tab mod vægur: 48,0 s
```

Femtifire sekunders møde blev til to sekunders lyd. Ingen exception. Ingen advarsel.
Filen kan afspilles, den kan transskriberes, og referatet vil se ud som et referat.

**Det er samme fejlklasse, som fik teknik A, C og E forkastet:** et output, der ikke
bærer spor af det, der mangler. Forskellen er, at her mangler ikke et ord — her mangler
hele samtalen.

Til sammenligning: uden app-skift er tabet **nul**. 31,3 s → 31,3 s. 161,1 s → 161,1 s.
Problemet er ikke optageren. Det er iOS, der tager mikrofonen, når appen ikke er fremme.

## Hvad det betyder for Fase 1

Tre værn, alle tre før frigivelse (nyt punkt **D66** i registret):

1. **Stop og sig det højt.** Lyt på `mute` og `ended` på lydsporet. Sker det, stopper
   optagelsen, og brugeren får det at vide med det samme — ikke når referatet er skrevet.
2. **Wake Lock.** Holder skærmen tændt, så den ikke låser af sig selv. Dækker ikke
   app-skift, men fjerner den hyppigste årsag til, at appen forsvinder i baggrunden.
3. **Længdetjek som port.** Afkod filen, og hold lydens længde op mod uret, før den
   sendes. Afviger de for meget, går den ikke videre uden en advarsel.

**Grænsen — besluttet 26/9 af Ann og Anne, før værnet bygges:** en optagelse afvises,
hvis tabet er **over 2 sekunder eller over 2 % af varigheden — det, der er mindst.**

Begge dele, fordi de fanger hver sin ende: en ren procentgrænse er for slap på en lang
optagelse (2 % af ti minutter er tolv sekunder væk), og en ren sekundgrænse er for stram,
hvis en lang fil har en lille naturlig afvigelse i afkodningen.

Tallet kunne sættes trygt, fordi målingerne ikke har nogen gråzone:

| Optagelser | Afvigelse mellem lyd og vægur |
|---|---|
| Tre uafbrudte (31,3 s · 40,9 s · 161,1 s) | **0,0 s** |
| Fem afbrudte | 4,9 - 6,6 s |
| Det snedige tilfælde | 48,0 s |

Grænsen kunne lægges hvor som helst mellem 0 og 4,9 sekunder uden at ramme forkert.
Den blev valgt, mens den stadig kunne falde ud til begge sider — samme regel som
bundgrænsen i D36.

En fjerde ting, som testen ikke svarer på: **hvor ofte sker det i virkeligheden?** En
håndværker med telefonen på bordet under et kundemøde er ikke den samme som Ann, der med
vilje skifter app. Det tal kommer kun fra pilotkunden.

## Grænser for denne test

- Testen kørte i en **separat** installeret app (`/spike0.html`), ikke inde i dashboardet.
  Samme motor og samme oprindelse, men iOS husker tilladelser pr. installeret app.
  Spørgsmål 5 skal derfor bekræftes igen, når optageren ligger i dashboardet.
- Kun én telefon, én iOS-version, én stemme. Android er ikke rørt.
- Skærmlås og app-skift kan siden ikke skelne imellem — begge kommer som
  `hidden` + `mute`. De behandles som samme tilfælde, fordi konsekvensen er ens.

## Bevismateriale

Logbogen fra siden er råmaterialet: tidsstemplede linjer for hver `getUserMedia`,
hvert synlighedsskift, hver mute/ended, og for hver optagelse dens vægur, antal
stykker, største hul, størrelse og afkodede længde. Testsiden lå på staging som
`static/spike0.html` og blev slettet igen efter testen.
