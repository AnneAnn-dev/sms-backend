# Fotosættet — hvad hvert billede indeholder

*15 fotos af 13 håndskrevne sedler. Ti af Ann (kuglepen, linjeret notesbog, iPhone
16e, 27/9 og 19/10) og tre af Anne (blyant, ternet papir, iPhone 13, 28/9 ifølge filerne). Originalerne
ligger i `C:\Users\Bruger\proevebaenk\referatfoto\`.*

**Facit udfyldt 19/10 og rettet af Ann og Anne, der har skrevet sedlerne.** Det skal
komme fra den, der skrev sedlen, ikke fra en model. Se afsnittet om rettelser nedenfor.

Dokumentet har samme rolle som `SAETTET.md` har for lyden. Uden det er filerne bare
filer, og resultatet bliver ét gennemsnit i stedet for et svar på, hvad der får
vision-modellen til at fejle. "Skal overleve" er det, der afgør, om referatet kan
bruges: navne, adresser, tal, mål og fagtermer. De står, som de er skrevet på sedlen.

---

## ⛔ Rettet 19/10: tre fejl i læsningen fra 27/9, alle i den farlige klasse

Læsningen 27/9 blev lavet af en vision-model (Claude). I tre af de fem sedler, den
læste, tog den fejl af et tal eller en enhed:

| Seddel | 27/9 sagde | Sedlen siger |
|---|---|---|
| 10 (IMG_0800) | 450 streget ud og rettet til 380 m³ | **To lokaler:** "Lokale 2 måler 450 m³ i timen", "Lokale 3 måler 380 m³ i timen". Det, der er streget over, er **klokkeslættet** (~~10.20~~ → 09.30) og **enheden** (~~m²~~ → m³) |
| 7 (IMG_0795) | 20.000 kr. | **"ca 20 ‰ fald"** (skrevet o/oo). Det er et fald og ikke et beløb |
| 7 (IMG_0795) | 18 m dybde | **"ca 1,8 m dyb"** |

**Det er i sig selv et måleresultat.** Det er netop den fejlklasse, B7 skal måle, og
den slags fejl, værnsvalget (c) accepterer. Ingen af sedlerne indeholder et beløb i kr.

## Det, der er målt

| | |
|---|---|
| Antal | 15 fotos, 13 sedler (referat 4 og 8 er fotograferet to gange) |
| Opløsning | Ann: 5712 × 4284, **24,5 MP** · Anne: 4032 × 3024, 12 MP |
| Filstørrelse | Ann: **5,5–6,9 MB** · Anne: 3,2–3,6 MB (JPEG) |
| Base64 | ≈ 8 MB pr. kald (Anns) |
| Nedskaleret til 1500 px | **265–410 KB, stadig fuldt læsbar** (målt 19/10 på alle 15) |
| Længde pr. seddel | Ann: 12–15 linjer, cirka 45–55 ord · Anne: prosa, op til ca. 95 ord |
| **EXIF-orientering** | **6 på alle 15.** Se vanskelighed 1 |

**Til sammenligning:** Spike 0's foto var 12 MP og 2,3 MB (`RESULTAT-05`). Nyere
telefoner tager større billeder, så regn ikke med, at tallet falder af sig selv.

**Til sammenligning nr. 2:** materialet i
`10_moedesituationer_handskrevne_referater.docx` er 66–81 ord pr. situation.
Anns håndskrift er **en tredjedel kortere**, fordi man forkorter, når man skriver i
hånden: *"Fremløbstemp 62°"* frem for en hel sætning. Anne skriver hele sætninger.

## De kendte vanskeligheder

**Målingen skal dække dem alle.**

**1. Rotation, og det handler om EXIF (rettet 19/10).** Rå pixels ligger alle 15 på
siden, og derfor stod der 27/9, at "alle elleve ligger på siden". Men alle 15 har
EXIF-orientering 6, og **med EXIF anvendt står alle 15 ret op.** Det afgørende er
derfor, om klientens nedskalering (canvas) anvender EXIF, og om modellen kan læse den
rå udgave, hvis den ikke gør. B7 kører hvert foto i begge udgaver.

**2. Overstregninger, der ændrer et tal eller en enhed.** Referat 10: klokkeslættet
~~10.20~~ → 09.30 og enheden ~~m²~~ → m³. Modellen skal læse det, der står tilbage.
**Læser den det overstregede, er fejlen usynlig i referatet.** Overstregede ord findes
også på referat 3, 5, 9 og Annes referat 2 (~~3~~ → TRE).

**3. Gennemskrivning fra forrige side.** Spøgelsesskrift bag den rigtige tekst, tydeligst
på referat 4 (referat 5's sidste linje, "Reparation påbegyndes efter godkendelse", kan
ses nederst), 8 og 10. En model kan læse begge lag som ét.

**4. Tekst skåret af ved kanten (nyt 19/10).** På IMG_0794 (referat 4) mangler
"12", "chef" og "& 120" i højre kant, og der er en finger i billedet. IMG_0994 er samme
seddel med hele siden. **Det rigtige svar på IMG_0794 er mindre tekst, ikke gættet
tekst.**

**5. Rettelser skrevet over linjen.** Referat 5 ("facade" over ~~flade~~), referat 6
("skal") og referat 10 ("m³").

## Sedlerne

| Fil | Referat | Skrevet af | Fag | Vanskeligheder | Skal overleve | Resultat |
|-----|---------|-----------|-----|----------------|---------------|----------|
| IMG_0676 | 1 | Ann | VVS, fjernvarme | spøgelse i margen | tirsdag 08:30 · Industrivej 18 · 62° · 41° · onsdag · fredag kl. 10 | |
| IMG_9596 | 1 | Anne | VVS, fjernvarme | blyant · prosa | tirsdag 08.30 · Industrivej 18 · 62 grader · 41 grader · onsdag · fredag kl. 10.00 | |
| IMG_0677 | 2 | Ann | Glarmester | | mandag 8:00 · Parkvej · 8 lejligheder · 3 vinduer · 3 lag · 1200 × 1400 mm · 2 vinduer · 3. sal · 3 dage · uge 38 | |
| IMG_9595 | 2 | Anne | Glarmester | blyant · ~~3~~ → TRE | mandag 9.00 · 8 vinduer · tre vinduer · 3 lag · 1200 gange 1400 millimeter | |
| IMG_0678 | 3 | Ann | Blikkenslager | to overstregninger | onsdag 07:45 · Vestergade 31 · Pedersen · 3 steder · 0,7 mm · torsdag · mandag–tirsdag uge 37 | |
| 81222223398__…jpeg | 3 | Anne | Blikkenslager | blyant · prosa | onsdag kl. 7.45 · Vestergade 31 · tre samlinger · 0,7 millimeter · torsdag · fredag | |
| IMG_0794 | 4 | Ann | Gulv | **afskåret kant** · finger · spøgelse | torsdag kl. 14 · Møllehuset · 65 kvm · 3 lukkedage · mandag/tirsdag/onsdag — **og intet opfundet for det afskårne** | |
| IMG_0994 | 4 | Ann | Gulv | spøgelse | torsdag kl. 14 · Møllehuset, Havnegade 12 · 65 kvm · korn 40, 80 & 120 · 3 lukkedage · mandag/tirsdag/onsdag · fredag kl. 12 | |
| IMG_0679 | 5 | Ann | Murer | rettelse over linjen | fredag kl. 8 · Nørrebrogade 46 · 2 vinduer · 18 kvm · 1 kvm · tirsdag kl. 13 | |
| IMG_0680 | 6 | Ann | Stillads | rettelse over linjen | mandag 07:00 · Skovvej 22 · onsdag kl. 15 | |
| IMG_0795 | 7 | Ann | Kloak | ‰-tegn | tirsdag kl. 10 · Engtoften 9 · 14 m · **20 ‰** · **1,8 m** · uge 39 | |
| IMG_0796 | 8 | Ann | Anlægsgartner | spøgelse | onsdag 15:30 · Bøgeparken 14 · 65 kvm · 30 × 30 cm · 2 % · 4 arbejdsdage · mandag kl. 07:30 | |
| IMG_0797 | 8 | Ann | Anlægsgartner | samme seddel, anden vinkel | som IMG_0796 | |
| IMG_0798 | 9 | Ann | Køkken | overstregninger | torsdag kl. 13 · Søndergade 58 · 2 skuffefronter · 1 hængsel · fredag kl. 10 | |
| IMG_0800 | 10 | Ann | Ventilation | **to overstregninger (tid, enhed)** · spøgelse | mandag **09.30** · Fabriksvej 4 · 2 mødelokaler · **450 m³** (lokale 2) · **380 m³** (lokale 3) · torsdag · fredag · mandag kl. 9 | |

## Dækningstjek

Kig ned ad hver kolonne. **En kolonne med kun én værdi er et hul.**

- **Delvist lukket 19/10: to håndskrifter.** Anne har skrevet tre sedler med blyant på
  ternet papir, fotograferet med en anden telefon. Det er stadig **to medstiftere og
  ingen håndværker**. Sættet kan sammenligne vision-modeller, men det kan ikke afgøre,
  om kvaliteten er god nok til en rigtig håndværkers håndskrift.
  **Lukkes med:** et par sedler fra pilotkunden, gerne blyant, skæve linjer og papir
  fra en mappe i bagagerummet.
- **Delvist lukket 19/10: blyant.** Annes tre sedler er skrevet med blyant.
- **Åbent: lyset.** Alle er fotograferet indendørs i dagslys. Ingen er taget i en mørk
  kælder eller i skarp sol, som er de to virkelige yderpunkter.
- **Åbent: beløb.** Ingen af sedlerne har et beløb i kr. Den farligste fejl ifølge D36
  (et forkert beløb) indgår altså ikke i sættet.

---

## Facit, ordret

`~~[?]~~` = overstreget ord, der ikke skal læses. Annes tre ark er facit for sig selv.

### Referat 1 — IMG_0676
```
Referat 1
Tirsdag 08:30
Hvor: Teknikrum, Industrivej 18
Deltog: Formand, VVS-installatør, ejendomsansvarlig
Førstesal kold om morgenen
Fremløbstemperatur 62°
Returtemperatur 41°
Kontroller cirkulationspumpe
Mål differenstryk
Rens snavssamleren
Reguleringsventil?
Undersøg onsdag
Tilbagemelding onsdag
Hvis den ex. er defekt bestil ny
Næste kontrol fredag kl 10⁰⁰
```
Skal overleve: tirsdag 08:30 · Industrivej 18 · 62° · 41° · onsdag · fredag kl. 10

### Referat 2 — IMG_0677
```
Referat 2.
Vinduesudskiftning.
Mandag 8:00
Fælleshuset Parkvej
Byggeleder, glarmester & vicevært
- Punkterede ruder i 8 lejligheder
- 3 vinduer m/ dårlige tætningslister
Ønske: energiglas 3 lag
standardruder: 1200 x 1400 mm
2 vinduer kræver opmåling på stedet
Udskiftning begynder på 3. sal.
Endeligt tilbud glarmester torsdag
NB Beboervarsling 3 dage før
Montering planlægges uge 38
```
Skal overleve: mandag 8:00 · Parkvej · 8 lejligheder · 3 vinduer · 3 lag · 1200 × 1400 mm · 2 vinduer · 3. sal · 3 dage · uge 38

### Referat 3 — IMG_0678
```
Referat 3
Onsdag kl 07:45
Vestergade 31
~~[?]~~ Pedersen, blikkenslager, tømrermester
Tagrenden på bagsiden utæt 3 steder
Skotrende tilbygning udskiftes
Sterninddækning løs flere steder,
anvend zink 0,7 mm.
Rendejern kan genbruges, hvor de er intakte.
Nedløbsrør tjek for tilstopning
Blikkenslager mål torsdag.
Arbejde udføres mandag-tirsdag uge 37
~~[?]~~ Pedersen sørger for fri adgang til baghuset.
```
Skal overleve: onsdag 07:45 · Vestergade 31 · Pedersen · 3 steder · 0,7 mm · torsdag · mandag–tirsdag uge 37

### Referat 4 — IMG_0794 og IMG_0994
```
Referat 4
torsdag kl 14⁰⁰
Restaurant Møllehuset, Havnegade 12
Gulvsliber, byggeleder, restaurantchef
Gulvet 65 kvm
Dybe ridser i gangarealet
Gulvet skal slibes m korn 40, 80 & 120
Revner spartles efter 1. slibning
Mat slutlak
Max 3 lukkedage i restaurant
Slibning mandag
lakering tirsdag
tørring onsdag
Plan bekræftes inden fredag kl 12
```
Skal overleve: torsdag kl. 14 · Møllehuset, Havnegade 12 · 65 kvm · korn 40, 80 & 120 · 3 lukkedage · mandag/tirsdag/onsdag · fredag kl. 12
På IMG_0794 er "12", "chef" og "& 120" skåret af. En model må ikke gætte dem — der skal stå mindre, ikke noget opfundet.
**Fælde:** spøgelsesskrift nederst er referat 5's sidste linje ("Reparation påbegyndes efter godkendelse"). Den må ikke komme med.

### Referat 5 — IMG_0679
```
Referat 5
Fredag kl 8⁰⁰
Nørrebrogade 46
Byggeleder, murer, ejerforening formand
Lodrette revner på facade mod gård
Løs puds 2 vinduer
Området ca 18 kvm
Løs puds skal fjernes helt
Etabler armeringsnet på store flader
Grundpuds & slutpuds samme
struktur som eksisterende ~~flade~~ facade
males silikatmaling efter hærdning
Muren laves prøvefelt på 1 kvm²
Prøvefelt gennemgås tirsdag kl 13
Reparation påbegyndes efter godkendelse.
```
Skal overleve: fredag kl. 8 · Nørrebrogade 46 · 2 vinduer · 18 kvm · 1 kvm · tirsdag kl. 13

### Referat 6 — IMG_0680
```
Referat 6
Mandag 07:00
Skovvej 22  *(Ann 19/10)*
Stilladsformand, byggeleder, arbejdsmiljøansvarlig.
Stillads skal gå fra terræn til tagfod
Der skal være rækværk, fodlister på alle arbejdsplatforme.
Adgang via stilladstrappe
Stillads skal forankres i facade.
Afdækning monteres nordside
Belastningsklasse kontrolleres v. modtagelse
Ikke oplagre materiale på platforme.
Kontrol skal dokumenteres dagligt
stilladsformand kontrollerer.
Stillads klar onsdag kl 15:00  *(Ann 19/10; FOTOSAETTET 27/9 sagde 16)*
```
Skal overleve: mandag 07:00 · Skovvej 22 · onsdag kl. 15

### Referat 7 — IMG_0795
```
Referat 7
tirsdag kl 10⁰⁰
Engtoften 9.  *(Ann 19/10)*
Kloakmester, entreprenør, husejer
eksisterende ledning for tæt på bygning
etabler ca 14 m. ny kloakledning
ca 20 ‰ fald
Rensebrønd skal bevares
ny sandfangsbrønd v/ indkørsel
Udgravning ca 1,8 m. dyb
ledning kontrolleres kamera efter etablering
Arbejdet starter uge 39
indkørsel ikke brugbar under arbejde
```
Skal overleve: tirsdag kl. 10 · Engtoften 9 · 14 m · **20 ‰** · **1,8 m** · uge 39

### Referat 8 — IMG_0796 og IMG_0797
```
Referat 8
Onsdag 15:30
Bøgeparken 14
Anlægsgartner, byggeleder, beboer
ex. græsareal fjernes
etableres ca 65 kvm belægning
Belægn. 30x30 cm
kantsten langs kanten
Belægning fald 2 %
Regnvand ledes væk fra hus
Anvend stabilgrus & afretningssand
2 x pladevibrator
4 arbejdsdage.
Opstart mandag kl 07:30
```
Skal overleve: onsdag 15:30 · Bøgeparken 14 · 65 kvm · 30 × 30 cm · 2 % · 4 arbejdsdage · mandag kl. 07:30

### Referat 9 — IMG_0798
```
Referat 9
Torsdag kl 13
Søndergade 58
Køkkenmontør, kunde, byggeleder
Alle skabe monteret
~~[?]~~ 2 skuffefronter står skævt
1 hængsel på overskab justeres
mangler silikonefuge v. bordplade mod væg
Udsparing til ~~[?]~~ kogeplade kontrolleres
Soklen mangler afslutning v/ køleskab
Skuffer & hængsel rettes fredag
fugen laves fredag
Kunden gennemgår mangelliste fredag kl 10⁰⁰
```
Skal overleve: torsdag kl. 13 · Søndergade 58 · 2 skuffefronter · 1 hængsel · fredag kl. 10

### Referat 10 — IMG_0800
```
Referat 10
Mandag ~~10.20~~ 09.30
Kontorbygning, Fabriksvej 4
Ventilationstekniker, elektriker, byggeleder
Lav fugtmængde i 2 mødelokaler
Lokale 2 måler 450 ~~[?]~~ ~~m²~~ m³ i timen
Lokale 3 måler 380 m³ i timen
Kontroller spjæld
Kontroller ventilationsaggregat
Lyddæmper undersøg montage
Indblæsn. & udsugn. måles efter justering
Ventilationstekniker ny indregulering torsdag
Elektriker kontrollerer strømforsyn. til aggregat
Målerapport aflever fredag
Næste byggemøde mandag kl 9.
```
Skal overleve: mandag **09.30** (ikke 10.20) · Fabriksvej 4 · 2 lokaler · **450 m³** (lokale 2) · **380 m³** (lokale 3) · enheden **m³**, ikke m² · torsdag · fredag · mandag kl. 9
**Fælder:** to overstregninger, der ændrer et tal og en enhed · spøgelsesskrift fra forrige side.

### Anne — IMG_9596 (referat 1, prosa)
```
Skal overleve:
Tid: Tirsdag kl. 08.30.
Sted: teknikrummet industrivej 18.
Deltagere: formand, VVS-installatør og ejendomsansvarlig.
Førstesalen er for kold om morgen. Fremløbstemperaturen ligger omkring
62 grader. Returtemperaturen ligger omkring 41 grader. Cirkulationspumpen
skal kontrolleres. Differenstryk skal måles. Snavssamleren skal renses.
Reguleringsventilen kan være årsag til problemet. VVS-installatøren undersøger
anlægget onsdag. Tilbagemelding gives onsdag eftermiddag. Ny pumpe
bestilles kun, hvis den eksisterende er defekt. Næste kontrol: fredag kl. 10.00
```

### Anne — IMG_9595 (referat 2)
```
Skal overleve
Tid: Mandag 9.00
Deltagere: Byggeleder, glarmester og vicevært
Der er punkteret termoruder i 8 vinduer
~~3~~ TRE vinduer har også dårlige tætningslister
Der ønskes energiglas 3 lag
Mål på standardvinduer er 1200 gange 1400 millimeter
```

### Anne — 81222223398__…jpeg (referat 3)
```
Skal overleve:
Tid: Onsdag kl. 7.45
Sted: Vestergade 31
Deltagere: Husejer, blikkenslager og tømrermester.
Tagrenden på bagsiden er utæt ved tre samlinger.
Skotrenden ved tilbygningen skal udskiftes.
Sterninddækningen er løs flere steder.
Der skal bruges zink på 0,7 millimeter.
Eksisterende rendejern genbruges, hvor de er intakte.
Nedløbsrøret skal kontrolleres for tilstopning.
Blikkenslageren tager mål torsdag.
Materialer bestilles fredag.
```
