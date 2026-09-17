# Opfølgning til syv.ai — udkast

**Til:** mads@syv.ai
**Emne:** Sv: Hviske springer tale over — ét spørgsmål, jeg glemte at stille

---

Hej Mads

Tak for de hurtige svar. Pr. lydtime var lige det, jeg skulle bruge for at kunne regne
rigtigt, og ordlisten lyder som noget, vi gerne vil prøve.

Jeg må lige indrømme, at jeg stillede mit andet spørgsmål dårligt. Jeg skrev "ændrer den
noget ved ovenstående?", og det kunne umuligt læses som andet end termerne. Så jeg
stiller det ordentligt her, for det er faktisk det eneste, der afgør sagen for os:

**Er det kendt hos jer, at Hviske kan tabe indhold inde i et segment — og arbejdes der
på det?**

Altså det, jeg beskrev i midten af sidste mail: segmenter, der påstår at dække 25
sekunders tale og afleverer 75 tegn, hvor normal taletæthed i de samme optagelser er
14–17 tegn i sekundet. `no_speech_prob` er 0.0, tidsstemplerne har ingen huller, og
filens varighed matcher. Lyden når frem — ordene gør ikke.

Grunden til, at jeg spørger så direkte, er at de to ting ikke er samme problem for os:

- **Ordlisten** gør de ord, der kommer igennem, rigtigere. Det er reelt, og I er i
  forvejen bedre end whisper på dansk fagsprog uden ordliste.
- **De tabte ord** kan en ordliste ikke nå. Og når midten af to sætninger forsvinder og
  resterne svejses sammen, kan resultatet skifte betydning — som fugeeksemplet, hvor
  "der skal ikke anvendes cementfuge, her skal anvendes silikonefuge" blev til "der skal
  ikke anvendes silikonefuge". Den sætning er stavet korrekt og er stadig forkert, og
  vores bruger kan ikke se det.

Derfor har vi valgt whisper til første fase — ikke fordi den er bedre, men fordi dens
fejl er synlige. **Vi skifter gerne til jer, hvis tabet lukkes.** Vi har de syv filer og
en færdig måling liggende, så en gentest tager os en eftermiddag.

Tre praktiske spørgsmål, hvis svaret er "ja, det er kendt":

1. Er der en indstilling eller en nyere version, hvor det ikke sker — eller er det
   iboende i modellen, som den er trænet nu?
2. Er det noget, I forventer at røre ved, og i givet fald groft hvornår? Jeg har ikke
   brug for en dato, kun om det er uger, måneder eller "ikke lige nu".
3. Vil I have vores materiale? Syv lydfiler, begge sæt transskriptioner, den fulde
   `verbose_json` og facitlister pr. optagelse. I må frit bruge det.

Hvis svaret er, at det ikke er kendt, siger I bare til — så laver jeg et minimalt
eksempel med én fil og de præcise tidsstempler, så det er til at reproducere.

Venlig hilsen
Ann
Dit Digitale Kontor
