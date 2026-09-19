# Resultat 4 — to modellers uenighed som markering: målt og forkastet

**Kørt:** 19/9 · `06-uenighed.ps1` og `07-uenighed-alignet.ps1` · de samme syv optagelser
· **ingen API-kald, ingen udgift** — begge regner på `konfidens-scaleway\` og
`tidslinje-hviske\`, som allerede lå der.

**Idéen kom fra Ann:** whisper er fuldstændig, men rammer forkert på fagsprog. Hviske
rammer fagsproget, men taber indhold. Kan de to holdes op mod hinanden, så uenighed
bliver markeringen?

Den er principielt **stærkere end teknik C**, fordi den ikke spørger en model om den
selv. To modeller med forskellig arkitektur hører den samme lyd. Uenighed er bevis
udefra, ikke selvvurdering — og det var netop selvvurderingen, der fejlede i A og C.

---

## 1. Svaret

| | 06 (ordsammenligning) | 07 (aligneret) |
|---|---|---|
| Markerede ord pr. optagelse | 76 | **47** |
| Fanget af de 18 fejl, der faktisk stod i teksten | 17 | **15** |
| Vinduer brugt | 186 | 158 |
| Vinduer sprunget over som for tynde | 2 | 30 |

**47 markeringer på ca. 375 ord er hvert ottende ord.** Det er ikke en markering. Det er
"læs det hele" med gult på.

Forventningen skrevet før kørslen var 30-40. Det blev 47 — cirka rigtigt, men på den
forkerte side af grænsen.

## 2. Tre fejl i første måling var mine, ikke idéens

06 blev ikke forkastet på sit eget tal. Den havde tre defekter:

**Længdefiltret sorterede de vigtigste ord fra.** 06 kasserede ord under fire tegn. "USB"
er tre. Den enkelte vigtigste fejl i hele materialet blev filtreret væk af mit eget
filter — og de farligste fagudtryk er præcis de korte: OSB, VVS, HPFI.

**Tætheden blev regnet forkert.** 06 tog hele Hviske-segmentets tekst, men delte kun med
de sekunder, der overlappede vinduet. Tallet blev for højt, og kun 2 ud af 186 vinduer
blev sprunget over — selvom Hviske taber 9-49 % af indholdet.

**Og den blandede to forskellige ting sammen.** 06 markerede ethvert whisper-ord, Hviske
ikke havde. Men der er to grunde til, at Hviske mangler et ord: enten sagde den noget
*andet* (uenighed — det, vi leder efter), eller også sagde den *ingenting* (Hviskes eget
hul). 06 kunne ikke skelne, og hullerne fyldte alt.

07 retter alle tre: ingen længdegrænse men en stopordsliste, korrekt skaleret tæthed, og
LCS-alignering, så kun ord med et *andet ord på samme plads* markeres.

**En bemærkning om metoden, der ikke er pyntet væk:** 06's tal blev første gang læst som
17 af 23. Det var forkert. Fem af de 23 ord stod slet ikke i den whisper-kørsel — whisper
svarer ikke ens hver gang. Reelt var der **18** at fange. Den rettelse ændrede
vurderingen fra "middelmådig træfsikkerhed" til "næsten perfekt træfsikkerhed, uacceptabel
støj", og dermed hvad der skulle rettes.

## 3. Det, der afgør sagen

Støjen faldt en tredjedel. **Men træfsikkerheden faldt med** — 17 blev til 15.

Se hvad der forsvandt. "fliseklip" røg ud, fordi murer-optagelsens vindue blev sprunget
over: Hviske havde tabt indholdet dér. **Filtret gjorde præcis det rigtige.** Men det
betyder:

> **De to fejltyper overlapper. Hviske kan ikke være vidne i de vinduer, hvor Hviske selv
> er gået i sort.**

Og murer-optagelsen er netop den, hvor fugeinstruktionen vendte om — *"skal der ikke
anvendes elastisk silikonefuge"*. Der, hvor vi mest har brug for et vidne, er vidnet
blindt.

**Det kan intet filter rette.** Det er ikke en indstilling, det er en egenskab ved de to
modellers fejl.

## 4. To veje, der også er lukket — uden at skulle prøves

**Sætningsniveau i stedet for ord.** 328 markeringer fordelt på 158 vinduer er godt to
pr. vindue. Maler-optagelsen har 71 på 36. Næsten hver eneste sætning ville blive
markeret, og så er der ingen gevinst ved at gå op i niveau.

**Normalisering af tal og forkortelser.** Toppen af listen er `ca`, `to`, `første`, `cm`,
`mig`, `nyt`. Det er ikke uenighed, det er skrivemåde: Hviske skriver "2 styks", whisper
"to styks"; "cirka" mod "ca.". Det kan normaliseres ufarligt og ville nok give 25-30.
**Men 25 er ikke 10**, og træfsikkerheden bliver ikke bedre — den er begrænset af Hviskes
indholdstab, ikke af hvordan vi tæller.

Begge er noteret her, så de ikke skal prøves igen for at nå samme konklusion.

## 5. En ting, der bevidst ikke blev gjort

Bøjningsstøj som "arbejde" mod "arbejdet" kunne fjernes ved at lade ord tælle som ens,
hvis de deler de første bogstaver.

**Det ville også skjule "tætningsbånd" mod "tætningspunkt".** På dansk deler sammensatte
ord forstavelse lige dér, hvor fejlen sidder. Reglen ville ramme netop de fejl, vi leder
efter, og den står derfor som en advarsel i `stopord.txt` i stedet for som kode.

## 6. Sidegevinsten, der skal bruges

**10 steder, hvor whisper har ord og Hviske intet har. 30 vinduer for tynde til
overhovedet at bruge. På syv optagelser à 2½ minut.**

Det er første gang, Hviskes indholdstab er et tal pr. optagelse i stedet for "9-49 %
færre tegn". Det er konkret, reproducerbart, og det er lige den slags, syv.ai bad om, da
de tilbød at kigge på materialet. Det hører i opfølgningen.

---

## Mønsteret, der nu er målt tre gange

| | Spørgsmålet til maskinen | Hvorfor den faldt |
|---|---|---|
| **A** | Hvad valgte du? | Kræver tvivl. Modellen havde ingen. |
| **C** | Hvor sikker var du? | Sikkerheden var normal eller høj ved fejlene. |
| **E** | Er I to enige? | Enige nok — og uenige overalt ellers. |

> **Et ord, der lyder rigtigt og står på den forkerte plads, efterlader ingen maskinelt
> læsbare spor.**

Tre forsøg, tre metoder, samme væg. Det er ikke tre uheld.

**Konsekvens:** bundgrænsen i D36 er uændret. Den accepterer fagtermfejl, fordi
håndværkeren selv har dikteret, selv læser og selv retter — og fordi fejlen er synlig for
ham. Det var et argument 13/9. Nu er det en måling.

**Teknik B er ikke det bedste, vi har. Det er det eneste, der virker** — og den er
release-blokerende for Fase 1.
