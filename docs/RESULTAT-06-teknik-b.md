# RESULTAT-06 — Teknik B målt, forkastet i sin brede form, og hvad der kom i stedet

*Målt 26-27/9-2026 på de syv referater i prøvebænken (`mistral-medium-3.5-128b`,
Anns stemme). Tærsklerne blev sat, før målingen blev kørt.*

**Kort:** den brede Teknik B — *alt i referatet, der ikke står i transskriptionen,
markeres* — virker ikke. Den markerer en femtedel af teksten. Den snævre udgave,
der kun markerer tal, navne og forkortelser, virker og er tavs. Og forsøget på at
fjerne årsagen gav et andet resultat, som ændrede en beslutning.

---

## 1. Den brede B markerer hvert femte ord

| Metode | Median markeringer pr. referat | Tæthed, værste referat |
|---|---|---|
| Ord ikke i transskriptionen | **51** | 29,6 % |
| Samme, på punkt-niveau | 12-22 af ~31 punkter | — |
| Med bøjninger tilgivet (fuzzy 0,85) | 28 | — |
| Fuzzy 0,65 — så støjen forsvinder | 4 | 4,2 % |

Tærsklen var **median 5, ingen over 10**. Den kan kun nås ved at slå netop de fund
fra, værnet findes for: ved fuzzy 0,65 forsvinder både *møbler* og *Murerhalsen*.

**Det er samme død som teknik C.** En markering, der rammer hvert femte ord, læres
at ignorere på en uge.

## 2. Årsagen er ikke metoden — referatet er en omskrivning

Transskriptionen: *"Bulve og køkken elementer skal afdækkes."*
Referatet: *"kraftig plast til møbler/elementer."*

Ord, der ikke står i transskriptionen, er **normaltilstanden**, ikke undtagelsen.
Det, der står tilbage efter al normalisering, er ægte omskrivning: *mangler*,
*gammel*, *møde*, *reparation*, *tandspartel*.

## 3. To af de fem kendte eksempler findes ikke længere

Facitlisten i `BESLUTNINGSGRUNDLAG-fase1.md` (afsnit 4) nævner fem tilføjelser,
B skulle fange. To af dem holder ikke mod de nuværende data:

| Eksempel | Status i dag |
|---|---|
| *møbler* | Ægte tilføjelse. Fanges |
| *Murerne og VVS fra Murerhalsen* | **Kan principielt ikke fanges.** Alle ordene står i transskriptionen — opfindelsen var omgrupperingen til to parter |
| *IP-grad* | Ægte tilføjelse. Fanges |
| *afrettes* | **Står i transskriptionen i dag.** Var en opfindelse, da eksemplet blev skrevet |
| *over 4 m* | **Står i transskriptionen i dag.** Kun relationsordet "over" er modellens |

Transskriptionerne blev kørt om 13/9. Whisper hører nu det, modellen dengang
gættede. **Facitlisten er ældre end dataene** — og det er værd at huske næste gang
et krav bygges på eksempler fra et dokument frem for på filerne selv.

## 4. Den snævre B virker

Markerer kun tre slags ord, når de ikke står i transskriptionen: **tal** (beløb,
mål, mængder), **navne** (stort begyndelsesbogstav midt i en sætning) og
**forkortelser** (bare store bogstaver).

**Median 0, max 3 over de syv referater.** Fundene var `IP-grad` (to gange) og
`Stilladset` (én gang). **Nul falske alarmer på tal.**

Det rammer præcis D36's kriterium 3 — *intet opfundet om personer, aftaler eller
beløb*. Det fanger ikke *møbler*, for det er et almindeligt lille ord uden stort
begyndelsesbogstav. Det er hele prisen ved at være snæver.

## 5. Forsøget med at fjerne årsagen

En ordnær systemprompt (`03b-referat-ordnaert.ps1`): modellen må forkorte og
strukturere, men ikke bytte ordene ud.

| | Før | Efter | Mål |
|---|---|---|---|
| Median markeringer | 51 | **45** | 10 |
| Med bøjninger tilgivet | 28 | **22** | 10 |
| Tæthed, værste referat | 29,6 % | 18,3 % | — |
| Ord i alt, syv referater | 2.330 | **2.928** | — |

**Tærsklen blev ikke nået, og den var sat på forhånd. Den brede B er dermed
forkastet** — som A, C og E, og på samme måde: ved måling, ikke ved vurdering.

## 6. Men forsøget ændrede en anden beslutning

Den ordnære prompt lader whispers fejl blive stående i stedet for at rette dem i
stilhed:

| Whisper hørte | Gammel prompt | Ordnær prompt |
|---|---|---|
| undertallet | rettet til undertag | **står** |
| bosvand | rettet til brugsvand | **står** |
| slipning | rettet til slibning | **står** |
| fliseklip | rettet til fliseklæb | **står** |
| midløbsrøret | rettet til nedløbsrøret | **står** |
| køkkenbrudet | rettet til køkkenbordet | **står** |
| kærpslingsgrader | rettet til kapslingsgrader | **står** |

Ti tilfælde i alt. Beslutningsgrundlaget kalder rettelserne *gode* (afsnit 2a) og
siger samtidig, at poleringen *"fjerner de synlige fejl og bevarer de usynlige —
isoleret set er det en forringelse"* (afsnit 3).

**✅ Besluttet 27/9 af Ann og Anne: modellen skal IKKE rette.** Begrundelsen er
brugeren, ikke teknikken: **håndværkerne er ikke trænede læsere.** En pæn tekst
bliver læst hurtigt og godkendt. "Bosvand" midt i et referat bliver set — og han
ved selv, at det hedder brugsvand.

Prisen er taget med: referaterne bliver 25 % længere, de indeholder volapyk, og
de gode rettelser går tabt.

## 7. Hvad der bygges til Fase 1

- **Den snævre B.** Tal, navne og forkortelser. Deterministisk, ingen model.
- **Den ordnære prompt** som referatmodellens systemprompt.
- **Markeringerne må aldrig præsenteres som "her er fejlene."** De er *"det her
  stod ikke i det, du sagde."* Et værn, der ligner en fuldstændig fejlliste, gør
  referatet mere troværdigt — og det var netop grunden til, at teknik A faldt.
- D36's forudsætning skal rettes: den lover i dag et værn mod **alle** tilføjelser.

## 7b. Bygget og målt om — 1-2/10

**Tallene i afsnit 4 kunne ikke køres om.** Scriptet, der målte den snævre B den
27/9, blev lavet ad hoc og findes hverken i prøvebænken eller i arkivet. Kun
tallene overlevede — i dette dokument.

Det er samme mønster som facitlisten, der viste sig ældre end dataene (afsnit 3),
og det er alvorligere her, fordi værnet er release-blokerende i D36. **Et tal,
der ikke kan efterprøves, er ikke et grundlag at frigive på.**

Derfor er værnet bygget som `teknik-b.js` i repoet, med `proev-teknik-b.js` ved
siden af. Fra nu af hører tallet til den kode, der faktisk udgives.

| Måling | Sæt | Median | Max | Tæthed, værste | Falske alarmer |
|---|---|---|---|---|---|
| 27/9 (script væk) | gammel prompt | 0 | 3 | — | 0 |
| **1/10** | gammel prompt | 0 | 4 | 1,0 % | 0 |
| **1/10** | ordnær prompt | **0** | **2** | 0,5 % | **0** |
| **2/10** | ordnær + samlede punkter | **0** | **2** | 0,5 % | **0** |

Målingen 1/10 mod den gamle prompt fandt `IP-grad` (2×), `Murerhalsen` (2×) og
`Træafval` (2×) — altså netop dem, afsnit 4 rapporterede. **27/9's måling blev
derfor lavet mod de gamle referater**, ikke de ordnære. Det forklarer forskellen
i tallene og bekræfter, at den nye udgave gør det samme som den forsvundne.

### Rettelse 2/10: navnereglen gælder ikke i overskriften

Målingen mod de samlede referater markerede `Tømrerarbejde,` i overskriften, fordi
transskriptionen siger *tømrerarbejdet* i bestemt form. Det er en bøjningsforskel,
ikke en opfindelse.

Den egentlige grund er, at **en overskrift ikke er en sætning.** Reglen "stort
bogstav midt i en sætning = navn" giver mening i brødtekst; en overskrift sætter
stort bogstav på det, der er vigtigt. Navnereglen er derfor slået fra i
overskriften — **tal og forkortelser tjekkes stadig dér**, for et opfundet beløb i
overskriften er lige så alvorligt som i brødteksten.

Fire selvtjek i `proev-teknik-b.js` holder reglen fast, så en senere oprydning i
`slags()` ikke kan fjerne den uden at noget siger fra.

## 7c. ⚠️ Værnet er også prøven på prompten

**Dette er den vigtigste iagttagelse fra de to målinger, og den ændrer, hvad
teknik B er værd.**

Begge gange var fundene `HPFI-relæ` og `HPFI-relæet`, hvor transskriptionen siger
`HPFI-relædet` — whispers fejlhøring af *relæet*. **Modellen rettede den i
stilhed.** Det er præcis det, afsnit 6 besluttede, at den ikke må.

Fundet overlevede, at prompten blev ændret 2/10. Teknik B er altså ikke kun en
spærre mod opfindelser: **det er det eneste, der kan opdage, at den ordnære prompt
holder op med at blive fulgt** — den dag modellen skiftes, leverandøren ændrer
noget under os, eller prompten redigeres af en, der ikke kender begrundelsen.

**To konsekvenser:**

1. **Tætheden pr. referat betyder to ting, ikke én.** Den er et mål for
   transskriptionens kvalitet, OG en stigning kan betyde, at prompten ikke bliver
   fulgt. Begge tolkninger skal stå dér, hvor tallet aflæses.
2. **Slutningen "bliver modellen god nok, kan værnet undværes" er vendt om.** Jo
   bedre modellen bliver til at skrive pænt, jo mere er værnet værd.

Skrevet ind i D36 den 2/10.

## 7d. Samlede punkter — besluttet 2/10

Målingen 1/10 viste, at **3 af 7 referater blev afvist af formvalideringen** på
"for mange punkter": 24-25 mod grænsen på 20. Modellen delte ét emne — én membran
— op i fem linjer.

Anne valgte mellem to eksempler side om side
(`claude/referat-laengde-forslag.md`), og valget faldt på at bede modellen samle.
To linjer tilføjet til prompten; alt andet urørt, så en ændring kan tilskrives
netop dem.

| | Før | Efter |
|---|---|---|
| P5 afvist | 3 af 7 | **0 af 7** |
| Punkter | 13 - 25 | **12 - 15** |
| Teknik B, median / max | 0 / 2 | **0 / 2** — uændret |
| Ord pr. referat | 421 | 393 (−6,5 %) |
| Output-tokens | 1.016 | 939 (−7,6 %) |
| Pris pr. referat | 7,01 øre | 6,70 øre (−4,4 %) |
| Svartid, median | 16,3 sek. | 14,4 sek. |

**At værnets tal ikke rørte sig, er det vigtigste i tabellen.** Havde de steget,
havde modellen købt kortheden ved at omskrive — og så var vi tilbage ved det, den
ordnære prompt blev valgt for at undgå.

⚠️ **RETTELSE AF EN FORVENTNING.** Det blev forudsagt, at referaterne ville blive
en tredjedel kortere og dermed mærkbart billigere. De blev 6,5 % kortere og 4,4 %
billigere. **Forslaget gjorde ikke referatet kortere — det gjorde det bedre
organiseret.** At samle fem punkter til ét fjerner ikke indholdet, det
omarrangerer det. 25 linjer blev til 12 med det samme indhold. Det var også det,
der blev bedt om; men den, der læser tallene om et halvt år, skal ikke tro, at
besparelsen var grunden.

## 8. Re-trigger

**Skifter vi transskriptionsmodel, tages metoden op igen.** Beslutningen her hviler
på, hvordan `whisper-large-v3` fejler: synligt, med volapyk, som en utrænet læser
kan få øje på. Hviske (syv.ai) fejler anderledes — den rammer fagordene bedre og
taber til gengæld indhold inde i segmenterne (`RESULTAT-02`).

Bliver syv.ai's næste model virkelig god, kan både den ordnære prompt og den snævre
B være det forkerte svar på et andet problem. **Hører J9's re-trigger sammen med
denne: kør prøvebænken om, og tag begge beslutninger forfra.**

## 9. Grænser for denne måling

- Syv optagelser, **én stemme** (Anns), én referatmodel. Sættet kan sammenligne,
  ikke afgøre absolut kvalitet — det står i `SAETTET.md`.
- Tallene for den snævre B kan stige på en ringere transskription. Med en dårlig
  stemme er flere markeringer ikke en fejl; de er sande.
- **Sikkerhedsventilen** fra målespecen står ved magt: overstiger markeringerne
  10 % af referatets ord, vises der ikke enkeltsteder, men én besked om at læse
  hele referatet igennem.
- Tætheden logges pr. referat. Efter tredive rigtige referater er det et mål for,
  hvordan modellen klarer ægte stemmer — det, sættet ikke kan svare på.
