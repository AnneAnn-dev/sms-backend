# syv.ai — testplan (udkast, juli 2026)

Formål: at kunne svare ét spørgsmål med tal bag os — **kan syv.ai levere
transskription, der er god nok til referatflowet i tilbudsmodulet?**
Hører til `tilbud-runbook.md` Trin 1 (leverandørverifikation) og Trin 2 (mikrofon-spiken).

---

## Hvad syv.ai er (så vi tester det rigtige)

Konsulenthus i København, egne danskbyggede modeller. To er relevante for os:

| Produkt | Hvad | Relevans |
| --- | --- | --- |
| **Hviske v5.3** | Tale-til-tekst, 2B parametre, åbne vægte på Hugging Face | **Hovedsporet.** Kandidat mod Scaleway/Voxtral |
| **DanskGPT** | Dansk sprogmodel (LLaMA-finetune) | Sidespor. Alternativ til Claude-proxyen — ikke akut |

**Vigtigt forbehold, som farver hele testen:** begge produkter er markedsført som
*"kører på jeres egen infrastruktur"*. Det er ikke det samme som en betal-pr-kald-API,
og transskriptions-endpointet i primeren forudsætter en leverandør-API. Hvis der ikke
findes et hostet endpoint, sammenligner vi ikke to ens ting — vi sammenligner en
API-integration med et driftsprojekt.

Offentlige tal fra syv.ai (deres egne, på CoRal v3-benchmarket):
9,01 % WER på oplæst dansk, 19,21 % på samtaledansk, ~425× realtid på én RTX 3090.
Samtaletallet er det relevante for os — og vores lyd er værre end CoRal.

---

## Trin 0 — Gates: afklares FØR vi bruger en time på lyd

Rene spørgsmål til Mads/Søren. Ingen af dem kræver kode.

- [ ] **Licens.** Hviske v5.3 er udgivet under CC BY-NC 4.0. Vores brug er kommerciel
      → NC-licensen dækker os **ikke** i produktion. Vi må gerne teste under den.
      SPØRG: pris og vilkår for kommerciel licens.
- [ ] **Leveringsform.** Findes der et hostet endpoint, vi kan kalde med multipart-lyd,
      eller skal vi selv drive en GPU? Hvis kun selvhosting: hvad er minimums-setuppet,
      og hjælper de med det?
- [ ] **Pris ved vores volumen.** Regn på et realistisk tal (fx 50 håndværkere ×
      8 møder/md × 20 min = ~130 timer lyd/md). Bed om pris i begge modeller:
      pr. minut hostet vs. licens + GPU-drift.
- [ ] **Databehandleraftale + underdatabehandlere + region.** Skal på DPA-listen
      sammen med Anthropic uanset hvad.
- [ ] **Formater.** Tager de webm (Android) og mp4 (iPhone) direkte, eller skal vi
      transkode? Deres kodeeksempel læser wav og resampler til 16 kHz — regn med
      at vi selv skal ffmpeg'e. Hvem betaler for den CPU?

**STOP-REGEL:** falder licens eller leveringsform ud forkert, er resten af testen
ligegyldig. Så er svaret Scaleway eller Voxtral, og vi bruger ikke to dage på lyd.

---

## Trin 1 — Definér "god nok" FØR vi måler

Tærsklerne skrives ned og godkendes af Anne, **inden** vi ser et eneste resultat.
Ellers ender vi med at rationalisere det tal, vi får.

**Det, vi måler på (i prioriteret rækkefølge):**

1. **Kritiske fejl** — tal, mål, priser, adresser, egennavne, materialebetegnelser.
   Tælles enkeltvis pr. optagelse. Det er dem, der bliver til et forkert tilbud.
   *Forslag til bar: højst 1 pr. referat, og aldrig en fejl der ser plausibel ud.*
   (Et forvansket ord opdager håndværkeren. "24 m²" i stedet for "42 m²" gør han ikke.)
2. **Brugbarhed af referatet** — kan Anne sende det efter under 2 minutters rettelse?
   Skala 1-5, sat blindt. Det er den eneste måling, der svarer på spørgsmålet.
3. **WER** — nice to have, ikke beslutningskriterium. Bruges kun til at sammenligne
   leverandører indbyrdes.

**Måles på referatet, ikke på transskriptet.** Håndværkeren ser aldrig råteksten.
Et transskript med 19 % WER kan sagtens give et brugbart referat, når Claude har
været over det — og et pænt transskript kan give et ubrugeligt referat. Kør derfor
hver kandidats output gennem den **rigtige** referat-prompt, og bedøm slutproduktet.

---

## Trin 2 — Testkorpus (her ligger arbejdet)

10-12 optagelser under ægte forhold. Ikke oplæste, ikke rene.

**Skal indeholde:**
- Byggeplads- eller køkkenstøj, radio i baggrunden
- To-tre personer, der taler i munden på hinanden
- Mindst én tydelig dialekt (jysk/fynsk)
- Fagsprog: faldstamme, spartelmasse, gipsplade, dampspærre, mærkenavne
- Tal sagt i tale: "treogtyve kvadratmeter", "toogtredive hundrede plus moms"
- Afbrydelser, telefon der ringer, mikrofon i lommen
- 2 lange optagelser (>20 min) til at teste chunking

**Optages med PWA'ens egen optager** — webm fra Android, mp4 fra iPhone. Ellers
tester vi ikke vores egen kæde, kun leverandørens model. Det gør dette til en naturlig
forlængelse af Spike 0 (runbookens Trin 2): spiken leverer optageren, testen bruger den.

**Facit:** én person transskriberer 3 af optagelserne ordret som guldreference
(det er dyrt, derfor kun 3). De øvrige vurderes kun på kritiske fejl + brugbarhed.

**Samtykke og sletning:** deltagerne i testoptagelserne skal vide det, og testlyden
slettes efter forsøget — samme princip som i produktet ("lyd gemmes aldrig").

---

## Trin 3 — Kørslen

Samme korpus gennem alle kandidater: **Hviske · Scaleway/Whisper · Mistral Voxtral**.

- Outputtet anonymiseres til A/B/C. Anne ved ikke, hvem der er hvem, når hun scorer.
  (Vi *vil* gerne have, at den danske vinder — derfor blindet.)
- Registrér pr. fil: kritiske fejl, brugbarhedsscore, køretid, fejlede kald.
- Kør hvert transskript gennem referat-prompten og score referatet.

Ét regneark, én række pr. (fil × kandidat). Resultatet er en tabel, ikke en fornemmelse.

---

## Trin 4 — Drift og robusthed

- [ ] Latens på 30 minutters lyd, målt ende-til-ende inkl. upload fra mobil
- [ ] Størrelsesgrænse — hvornår siger endpointet fra, og gør det det pænt?
- [ ] Grimme input: 0-byte-fil, ren tavshed, musik, engelsk tale midt i dansk
- [ ] Support i praksis: send et konkret teknisk spørgsmål og mål svartiden
- [ ] Ved selvhosting: hvad koster GPU'en om måneden ved **nul** brug?
- [ ] Hvad sker der, hvis de lukker eller ændrer licens? Åbne vægte er her en fordel
      — vi kan i princippet blive kørende. Skriv den udvej ned.

---

## Trin 5 — Beslutning

Én side ind i `tilbud-primer.md` under "Transskription":
valgt leverandør, de målte tal, de tærskler vi satte på forhånd, og **hvad der
ville få os til at skifte**. Plus opdatering af DPA-listen.

---

## Tidsforbrug

| Del | Reelt arbejde |
| --- | --- |
| Trin 0, gates | 1-2 timer + ventetid på svar |
| Trin 2, korpus | ½ dag |
| Trin 3-4, kørsel og vurdering | 1 dag |
| Trin 5, beslutning | 1 time |

**Ca. 2 dages reelt arbejde**, spredt over 1-2 uger på grund af svartider.
Mest sandsynlige udfald: Trin 0 afgør det, og vi bruger aldrig de to dage.

---

## Sidespor: DanskGPT vs. Claude (lav prioritet)

Claude-proxyen er allerede besluttet, og Anthropic-undtagelsen er bevidst.
Testes kun, hvis EU-princippet strammes, eller prisen løber løbsk.

Hvis det bliver aktuelt, er **vores hårdeste krav ikke dansk sprogkvalitet — det er
gyldig JSON**. Tilbudsudkastet skal parses til strukturerede linjer, og mindre modeller
fejler markant oftere der end på sproget. Testen er derfor kort og brutal:

- Kør den rigtige tilbuds-prompt 20 gange på samme referat
- Tæl parse-fejl efter kodeblok-strip og ét retry (samme kæde som i primeren)
- **GODKENDT HVIS:** 20/20 parser. Ikke 18/20 — en fejlrate på 10 % er en fejlbesked
  hver tiende gang, håndværkeren trykker på knappen
