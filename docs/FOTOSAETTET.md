# Fotosættet — hvad hvert billede indeholder

*Elleve fotos af håndskrevne sedler, taget 27/9-2026. Ligger i
`C:\Users\Bruger\proevebaenk\referatfoto\`.*

Samme rolle som `SAETTET.md` har for lyden: uden dette dokument er de elleve
filer bare elleve filer, og resultatet bliver ét gennemsnit i stedet for et svar
på, hvad der knækker vision-modellen.

**Udfyldes FØR målingen køres.** "Skal overleve" er det, der afgør, om referatet
er brugbart: navne, adresser, tal, mål, fagtermer. Skriv dem, som de står på
sedlen — også hvis de er forkerte.

---

## Det, der allerede er målt (27/9)

| | |
|---|---|
| Antal | 11 fotos |
| Opløsning | 5712 × 4284 — **24,5 MP** |
| Filstørrelse | **5,5 - 6,9 MB** pr. styk (JPEG) |
| Base64 | ≈ 8 MB pr. kald |
| Nedskaleret til 1500 px | **250 - 340 KB, stadig fuldt læsbar** |
| Længde pr. seddel | 12-15 linjer, **cirka 45-55 ord** (fem stikprøver) |

**Til sammenligning:** Spike 0's foto var 12 MP og 2,3 MB (`RESULTAT-05`). Nyere
telefoner skyder større. Regn ikke med, at tallet falder af sig selv.

**Til sammenligning nr. 2:** materialet i
`10_moedesituationer_handskrevne_referater.docx` er 66-81 ord pr. situation.
Håndskriften er **en tredjedel kortere**, fordi folk forkorter, når de skriver i
hånden: *"Fremløbstemp 62°"* frem for en hel sætning.

## De tre kendte vanskeligheder

Fundet ved at se på fotoerne, ikke ved at gætte. **Målingen skal dække alle tre.**

**1. Alle elleve ligger på siden.** Sedlen er på højkant, fotoet på tværs, og
teksten løber nedefra og op. Sådan fotograferer man en notesbog med én hånd.
Spørgsmålet er ikke, om det kan undgås — det er, om modellen kan læse det, eller
om klienten skal rette op først.

**2. Overstregninger.** På referat 10 er "450" streget over og rettet til
"380 m³". Modellen skal læse det rettede tal. **Det er præcis den slags, der
bliver til en forkert pris i et tilbud.** Læser den det overstregede, er fejlen
usynlig i referatet.

**3. Gennemskrivning fra forrige side.** Spøgelsesskrift bag den rigtige tekst,
tydeligst på referat 10. En model kan finde på at læse begge lag som ét.

## Sedlerne

Referat-numrene svarer til situationerne i
`10_moedesituationer_handskrevne_referater.docx`.

| Fil | Referat | Fag | Kendte vanskeligheder | Skal overleve | Resultat |
|-----|---------|-----|----------------------|---------------|----------|
| IMG_0676 | 1 | VVS, fjernvarme | roteret | tid · sted · 62° · 41° · fredag kl. 10 | |
| IMG_0677 | 2 | Glarmester | roteret | 8 lejligheder · 3 lag · 1200 × 1400 mm · uge 38 | |
| IMG_0678 | | | roteret | | |
| IMG_0679 | | | roteret | | |
| IMG_0680 | 6 | Stillads | roteret | Nørrevej 22 · kl. 16 · onsdag | |
| IMG_0794 | | | roteret | | |
| IMG_0795 | 7 | Kloak | roteret | 14 m ny ledning · 20.000 kr. · 18 m dybde · uge 39 | |
| IMG_0796 | | | roteret | | |
| IMG_0797 | | | roteret | | |
| IMG_0798 | | | roteret | | |
| IMG_0800 | 10 | Ventilation | roteret · **overstregning 450→380** · gennemskrivning | 450→**380 m³/t** · 2 målere · fredag · mandag kl. 9 | |

*Fem af elleve er læst igennem 27/9 (1, 2, 6, 7, 10). Resten står tomme med
vilje — de udfyldes, før målingen køres, ikke bagefter.*

## Dækningstjek — når felterne er udfyldt

Kig ned ad hver kolonne. **En kolonne med kun én værdi er et hul.**

- **Kendte huller allerede nu:**
  - **Én håndskrift — Anns — på alle elleve.** Samme svaghed som lydsættet, og
    samme konsekvens: sættet kan sammenligne to vision-modeller, men **ikke**
    afgøre, om kvaliteten er god nok til en rigtig håndværkers håndskrift.
    Anns skrift er jævn og skrevet med kuglepen på linjeret papir.
    **Lukkes med:** et par sedler fra pilotkunden — blyant, skæve linjer, papir
    fra en bagagerumsmappe.
  - **Alle er fotograferet indendørs med samme lys.** Ingen af dem er taget i en
    mørk kælder eller i skarp sol, som er de to virkelige yderpunkter.
  - **Ingen af dem er blyant.** Alle er kuglepen.
