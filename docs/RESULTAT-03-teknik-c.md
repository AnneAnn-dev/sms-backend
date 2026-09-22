# Resultat 3 — teknik C målt: whisper-konfidens kan ikke bruges til at markere fejl

**Kørt:** 14/9 · `05-konfidens.ps1` · `whisper-large-v3` via Scaleway · de samme syv
optagelser · 189 segmenter · 12 kendte fejlord fra målingen 13/9.

**Hypotesen blev skrevet ned før kørslen** (den står i scriptets hoved) og lød, at teknik
C ville falde. Det gjorde den.

---

## 1. Svaret

| | `avg_logprob`, median |
|---|---|
| Alle 189 segmenter | **−0,1601** |
| De 13 segmenter med et kendt fejlord | **−0,1294** |

Forskellen er **+0,031 — i den forkerte retning.** Segmenterne med fejl havde en anelse
*højere* konfidens end gennemsnittet.

**Den ærlige læsning er ikke "omvendt signal", men "intet signal".** Spredningen blandt
de 13 er fra −0,075 til −0,440; med så få punkter og så stor spredning er 0,031 støj.
Konklusionen er den samme uanset hvilken af de to læsninger man vælger: **der er intet at
bygge en tærskel på.**

## 2. Det argument, der lukker sagen

Man behøver ikke statistik. Kig på ét tal.

Segmentet med **"USB-plader"** (optagelse 1, 71,9–74 sek.) har `avg_logprob` = **−0,103**.
Medianen for alle segmenter er **−0,160**.

**For at fange den fejl skal tærsklen sættes højere end medianen.** Det vil sige: markér
mere end halvdelen af alle segmenter i referatet. Et værn, der markerer halvdelen af
teksten, markerer ingenting — det er "læs det hele med skepsis" med en gul farve på.

Og det værste enkelttilfælde: **"finpusses"** (optagelse 5) har **−0,075** — den
*allerhøjeste* konfidens blandt de tretten. Whisper var mest sikker dér, hvor den tog fejl.

## 3. Hvorfor det giver mening

Det er samme mekanisme, der gjorde teknik A ubrugelig, og det er nu set to gange:

> **Selvrapporteret usikkerhed fanger kun de fejl, modellen selv kan mærke.**

Whisper var ikke i tvivl om "USB-plader". Den hørte en sekvens og skrev et rigtigt dansk
ord — bare det forkerte. Akustisk var der ingenting galt; fejlen opstod i sprogmodellen,
ikke i lytningen. Derfor er konfidensen høj. Det er ikke en mangel ved API'et, det er en
egenskab ved fejlklassen.

**Det er ikke et spildt forsøg.** Vi ved nu, og har målt, at:

- **tynd tekst kan fanges maskinelt** (Hviskes fejlklasse — 2,7 tegn/sek. mod 17)
- **forkerte ord kan ikke** (whispers fejlklasse — konfidensen er normal eller høj)

Det er præcis den skelnen, bundgrænsen i D36 hviler på. Før i dag var den et argument.
Nu er den målt. **Teknik B er dermed ikke "det bedste, vi har" — det er det eneste, der
virker,** og release-kravet om den står uændret.

## 4. Sidegevinst: tæthedsværnet virker, men har en fælde

Seks af 189 segmenter lå under halvdelen af medianen (17,7 tegn/sek.). **Fem af de seks
er det første segment i en optagelse** — 0,0–10,0 · 0,0–17,0 · 0,0–6,4 · 0,0–10,0 ·
0,0–29,2.

Det er ikke tabt indhold. Det er **tilløbet**: sekunderne mellem optagestart og første
ord. Kun ét fund var ægte (optagelse 5, 27,1–29,6 sek.).

**Konsekvens for værnet:** tæthed må ikke regnes på segmentets varighed alene. Enten
springes det første segment over, eller også regnes der på faktisk taletid. Uden den
rettelse markerer værnet **hver eneste optagelse** ved starten, og et værn, der altid
råber, bliver klikket væk inden for en uge.

Til gengæld: udenfor tilløbet gav værnet **ét** fund på 189 segmenter. Det er en
støjrate, man kan leve med — og det er tallet, der gør tæthedsværnet realistisk at bygge.

## 5. Felterne fra Scaleway — svaret på krav 1 i 6d

`verbose_json` giver pr. segment:

```
id, seek, start, end, text, tokens, temperature,
avg_logprob, compression_ratio, no_speech_prob
```

**Krav 1 i 6d kan opfyldes med Scaleway.** Men begrundelsen for kravet skifter:

- **Før:** "segmenter skal med, så teknik C kan bygges." Den grund er væk.
- **Nu:** *segmenter skal med, så den næste leverandør kan måles med `04` og `05` uden at
  rive adapteren op* — og så tæthedsværnet kan bygges, når Hviske bliver aktuel igen.

Kravet står altså, men det er blevet et **målbarheds**krav, ikke et værnskrav. Det er
værd at skrive ned, fordi den, der læser 6d om et år, ellers bygger noget, ingen skal
bruge.

`compression_ratio` er også med. Det er whispers eget mål for gentagelse og bruges
normalt til at opdage, at modellen er gået i løkke. **Vi har ikke målt på det** — ingen af
de syv optagelser udløste den fejltype. Det noteres som et tilgængeligt felt, ikke som et
værn.

---

## Hvad der ændrer sig i beslutningerne

| Sted | Ændring |
|---|---|
| **Afsnit 4C** (teknik C) | Fra "❓ skal undersøges" til **⛔ målt og forkastet** |
| **Afsnit 6, punkt 4** | Udført. Udfaldet var nr. 2 af de tre forudsete |
| **6d, krav 1** | Står — men begrundet i målbarhed, ikke i teknik C |
| **D36** | Uændret. Bundgrænsen hviler nu på en måling i stedet for et argument |
| **Teknik B** | Fra "anbefales" til **eneste virkende værn**. Release-blokerende, som før |
