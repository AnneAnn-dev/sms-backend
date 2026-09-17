# Sættet — hvad hver optagelse indeholder

Udfyldes **før** transskriptionen køres, mens du stadig husker det. Uden dette
dokument er de syv filer bare syv filer, og resultatet bliver ét gennemsnit i stedet
for et svar på, hvad der faktisk knækker modellen.

Det er også dette dokument — ikke lydfilerne — der gør sættet til et regressionssæt.
Om et år kan transskriptionerne køres igen mod en ny model, og forskellen kan aflæses
pr. betingelse.

**"Skal overleve"** er de ting, der er vigtige nok til at afgøre, om referatet er
brugbart: navne, adresser, tal, mål, fagtermer. Skriv dem, som de blev sagt. Det er
dem, du tæller bagefter — ikke om teksten "føles rigtig".

---

## Slettebjerget 124 (3).m4a

- **Fag:**
- **Stemme:**
- **Baggrundsstøj:**
- **Handler om:**
- **Skal overleve:**
- **Resultat:** _(efter kørsel: hvor mange af ovenstående kom med)_

## Slettebjerget 124 2.m4a

- **Fag:**
- **Stemme:**
- **Baggrundsstøj:**
- **Handler om:**
- **Skal overleve:**
- **Resultat:**

## Slettebjerget 124 3 (1).m4a

- **Fag:**
- **Stemme:**
- **Baggrundsstøj:**
- **Handler om:**
- **Skal overleve:**
- **Resultat:**

## Slettebjerget 124 4.m4a

- **Fag:**
- **Stemme:**
- **Baggrundsstøj:**
- **Handler om:**
- **Skal overleve:**
- **Resultat:**

## Slettebjerget 124 5.m4a

- **Fag:**
- **Stemme:**
- **Baggrundsstøj:**
- **Handler om:**
- **Skal overleve:**
- **Resultat:**

## Slettebjerget 124 6.m4a

- **Fag:**
- **Stemme:**
- **Baggrundsstøj:**
- **Handler om:**
- **Skal overleve:**
- **Resultat:**

## Slettebjerget 124 7.m4a

- **Fag:**
- **Stemme:**
- **Baggrundsstøj:**
- **Handler om:**
- **Skal overleve:**
- **Resultat:**

---

## Dækningstjek — når felterne er udfyldt

Kig ned ad hver kolonne. **En kolonne med kun én værdi er et hul.** Er alle syv
optaget af samme stemme, ved I intet om, hvordan modellen klarer en anden. Er de alle
2½ minut, ved I intet om den korte besked på tyve sekunder.

Det er sættets egen svaghedsanalyse, og den kræver ingen vurdering — kun at man kigger.
Noter hullerne her, når du har set dem, så det ikke om et halvt år læses som om alt er
afprøvet:

- **Kendte huller:**
  - **Én stemme — Anns — på alle syv (kendt fra start, 30/8).** Det er **Å5** anvendt på
    diktafonen: den, der bygger produktet, taler tydeligere og mere struktureret end
    den, der skal bruge det. Sættet er derfor sandsynligvis optimistisk.
    **Konsekvens:** sættet kan bruges til at sammenligne to modeller (stemmen er en
    konstant og går ud med sig selv) og til format, hastighed og pris — men **ikke**
    til at afgøre, om kvaliteten er god nok til en rigtig bruger.
    **Lukkes med:** to-tre optagelser med andre stemmer. Anne kan tale et par ind, og
    den billigste ægte håndværkerstemme er pilotkunden selv, næste gang I taler med ham
    — det er samtidig et demo-øjeblik og den mundtlige forventningsafstemning fra D36.

## To ting at holde øje med i resultatet

**Støj og stemmer er ikke det samme.** En kompressor, der brummer, trafik, en radio
uden tale — det er bredbåndsstøj, og whisper-modeller er ret robuste over for det.
Andre menneskers tale i baggrunden er en helt anden sag: modellen kan ikke se, hvem der
er hovedtaleren, og begynder at flette de to sammen.

Skelnen afgør, hvad et dårligt resultat betyder. Knækker den kun på tale-i-baggrunden,
er det ikke en modelfejl, der skal købes ud af — det er en linje i onboardingen: *gå væk
fra de andre, før du taler ind.* Knækker den på brummen, er det leverandøren, der ikke
er god nok. To vidt forskellige regninger.

**Fejlene klumper sig sandsynligvis om fagudtrykkene.** Almindeligt dansk klarer
modellen; det er materialenavne, mærker, mål og fagsprog, den ikke har hørt nok af.
Derfor er `Fag`-feltet ikke bogholderi: kan du se, at fejlene falder inden for ét fag,
er problemet ordforråd og ikke lyd — og ordforråd kan afhjælpes i prompten eller med en
ordliste, hvor lydkvalitet ikke kan.
