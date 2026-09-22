# ASR-adapteren — grænsefladen, konkret

Uddyber 6d i `BESLUTNINGSGRUNDLAG-fase1.md`. Skrevet 14/9, **efter** at teknik C blev
målt, fordi udfaldet ændrede begrundelsen for krav 1.

**Hvorfor den findes:** vi ved, vi kommer til at skifte transskriptionsmodel — enten når
syv.ai lukker tabet inde i segmenterne, eller når en tredje bliver bedre. Adapteren er
det, der gør skiftet til en miljøvariabel i stedet for en omskrivning.

**Beviset på, at den kan være tynd:** i prøvebænken var forskellen mellem Scaleway og
syv.ai **én parameter**. Samme script, samme filer, samme facitlister — kun adressen
skiftede. Begge bruger `POST /v1/audio/transcriptions`, multipart, med `model`,
`language`, `response_format`.

---

## Returtypen — det eneste, der er dyrt at rette bagefter

```js
{
  tekst: "hele transskriptionen som en streng",
  sprog: "da",
  varighedSek: 161.7,
  segmenter: [
    {
      startSek: 18.3,
      slutSek: 45.6,
      tekst: "...",
      ingenTaleSandsynlighed: 0.0,   // no_speech_prob, hvis leverandøren giver den
      konfidens: -0.1601             // avg_logprob, hvis leverandøren giver den
    }
  ],
  leverandoer: "scaleway",
  model: "whisper-large-v3",
  lydsekunder: 161.7                 // grundlaget for prisberegningen
}
```

**`segmenter` er hele pointen.** Returnerer adapteren kun `tekst`, kan tæthedsværnet
aldrig bygges bagefter uden at rive den op — og den næste leverandør kan ikke måles med
`04-tidslinje.ps1` og `05-konfidens.ps1` uden at der skrives et parallelt kodespor ved
siden af produktionen. **Lad segmenterne være returtypen fra dag ét, også selvom Fase 1
kun bruger `tekst`.**

**`konfidens` gemmes, men vises ALDRIG for brugeren.** Målingen 14/9 viste, at whispers
konfidens er normal eller høj netop dér, hvor den tager fejl (`RESULTAT-03-teknik-c.md`).
Feltet er der, så en fremtidig leverandør kan måles på det — ikke fordi det skal bruges
til at markere noget. **Bygger nogen en gul markering på `konfidens`, markerer den
halvdelen af teksten og fanger ikke "USB-plader".** Det står som en advarsel i koden, ikke
kun her.

Begge de to felter er **valgfrie**. En leverandør, der ikke giver dem, skal ikke få
adapteren til at fejle — de sættes til `null`, og det, der læser dem, tåler `null`.

---

## Ind i adapteren

```js
transskriber({
  lyd,                    // Buffer eller stream
  filnavn,                // til multipart
  sprog = "da",
  ordliste = null         // valgfri. Kastes væk, hvis leverandøren ikke har den
})
```

**`ordliste` er grænsefladens vigtigste asymmetri.** syv.ai har en `Vocabulary`-parameter;
Scaleway har den ikke. Adapteren tager altid imod den og **kaster den lydløst væk** hos en
leverandør, der ikke kan bruge den. Resten af systemet skal aldrig vide, hvem der er i den
anden ende — ellers siver leverandørnavnet ud i kaldekoden, og så er adapteren holdt op
med at være en adapter.

---

## Konfigurationen — fire variabler, ingen kode

```
TILBUD_ASR_LEVERANDOER=scaleway
TILBUD_ASR_URL=https://api.scaleway.ai/<projekt-id>/v1
TILBUD_ASR_MODEL=whisper-large-v3
SCW_SECRET_KEY=...                  # nøglen under leverandørens eget navn
```

**Modelstrengen låses eksplicit** (D14). Aldrig et alias, aldrig "latest" — en model, der
skifter under os, gør regressionssættet værdiløst uden at nogen opdager det.

**Nøglen hedder leverandørens navn, ikke `ASR_KEY`.** Samme regel som i prøvebænken, hvor
nøglen vælges ud fra adressen, så Scaleway-nøglen aldrig kan sendes til syv.ai. Det er en
fem-tegns beslutning nu og en hændelse senere.

---

## Prisen — to enheder, ikke én konstant

Scaleway afregner **pr. lydminut**. syv.ai afregner **pr. lydtime** (bekræftet 13/9).
En fremtidig leverandør kan afregne pr. kald.

`kvote.js` skal derfor spørge adapteren om enheden, ikke gange med en konstant:

```js
{ enhed: "lydminut", satsOere: 2.24 }
```

Ellers er budgettet forkert **den dag, modellen skiftes** — og det er nøjagtig den dag,
ingen kigger på budgettet, fordi opmærksomheden er på kvaliteten.

---

## Referatmodellen er et selvstændigt valg

Transskription og referat skal kunne skiftes hver for sig, med hver sin variabel. Vi har
allerede set, at den bedste transskription og den bedste referatmodel kan komme fra to
forskellige huse — og at en ræsonnerende model er ubrugelig til referatet, uanset hvor god
den er ellers (J9: `qwen3.5-397b-a17b` brugte 4.000 tokens på at tænke og leverede intet).

```
TILBUD_REFERAT_LEVERANDOER / _URL / _MODEL
```

---

## Det, der gør skiftet forsvarligt

De syv lydfiler og facitlisterne er **ikke testmateriale — de er infrastruktur.**

Uden dem er et leverandørskifte et spring i mørke. Med dem er det en eftermiddag og en
tabel: kør `02`, `04` og `05` mod den nye adresse, hold resultatet op mod de samme facit,
og se, om bundgrænsen i D36 stadig er opfyldt. Det er den kørsel, hele adapteren findes
for at muliggøre.

**Derfor er kravet om segmenter et målbarhedskrav, ikke et værnskrav.** Teknik C er død
(målt 14/9), men adapteren skal stadig kunne levere det, `05-konfidens.ps1` læser — ellers
kan den næste leverandør ikke afvises eller godkendes på samme grundlag som denne.
