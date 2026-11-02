# Dashboardets visuelle udtryk

*Dit Digitale Kontor — gælder dashboardet og Kunder-appen. Fastlagt af Ann 26.–30/10-26 (D94).*

## Skrift

Én skrifttype: **Nunito** (reserve: system-ui, sans-serif). Fire størrelser — ikke flere. Forskel på vigtigt og mindre vigtigt laves med **vægt og farve**, ikke med en ny størrelse.

| Rolle | Størrelse / vægt | Bruges til |
|---|---|---|
| **Titel** | 22 px / 800 | Topbjælken, vinduets titel, kundens navn på kundesiden, arkets titel |
| **Overskrift** | 17 px / 800 | Opgavens overskrift og kundens navn i listerne, punkterne på profilen |
| **Tekst** | 16 px / 400 | Brødtekst, feltindhold, anden linje i lister (grå). **Knapper: 16 px / 800** |
| **Etiket** | 13 px / 700, versaler | Feltetiketter, fanerne i bundbjælken |

**Intet skrivefelt under 16 px** — ellers zoomer iPhone ind, når man trykker i feltet.

## Farver

| Farve | Kode | Bruges til |
|---|---|---|
| Hvid | `#FFFFFF` | Lister og skrivefelter |
| Svag lyseblå | `#FAFCFE` | Baggrund på sider med skrivefelter |
| Blå | `#2B5B8A` | Knapper (primær), links, aktiv fane |
| Klar blå | `#2F6FD6` | Streg: **ny** opgave |
| Rød | `#C0392B` | Streg: **haster** — og knappen **Slet kunde** (det eneste sted, rød er en knap) |
| Grå | `#B8C1CC` | Streg: **afsluttet** opgave / **inaktiv** kunde |
| Mørk tekst | `#1F2D40` | Al hovedtekst |
| Grå tekst | `#4F5F73` | Anden linje, etiketter, hjælpetekst |
| Kantlinje | `#D5DDE8` | Felter og hvide knappers kant |
| Skillelinje | `#E3E8EF` / `#DFE5EE` | Mellem rækker og sektioner |

**Ingen grøn.**

## Regler

1. **Lister står på hvidt. Sider med skrivefelter er svagt lyseblå (`#FAFCFE`) med hvide felter.**
2. **Knapper:** den vigtigste handling er blå (fx *Gem*). Alle andre er **hvide med kant** (fx *Inaktivér kunde*, *Læg sammen*, *Fortryd*). **Ingen flere knapfarver** (Ann 30/10) — en handling, der ikke kan fortrydes, markeres med teksten ("Stop! …"), ikke med en ny farve.
3. **Rød er kun *Slet kunde*** (og haster-stregen). Ingen andre røde knapper.
4. **To ligestillede valg** (fx advarslen i Ny opgave: *Læg på X* / *Ny kunde uden nummer*) er to lige store hvide knapper.
5. **Streger i venstre margen på en række:**
   - **blå** yderst = ny (forsvinder, når man gør noget ved opgaven)
   - **rød** som nummer to, med ca. 1 mm luft til den blå = haster
   - **grå** yderst = afsluttet opgave / inaktiv kunde
6. **Funktioner, man ikke har i sit abonnement, vises gråtonede** (fx Referater) — kommer med trin 5, når modulopdelingen er afgjort (Fase 3).
7. **Bekræftelse før noget, der ikke kan fortrydes:** konsekvensen står i tal, i formen *"Stop! Du sletter [kunde] sammen med [tal]. Det kan ikke fortrydes."*
8. **Navne og andet, kunden selv har skrevet, vises altid som tekst** — aldrig som HTML (S33, se `CLAUDE.md`).
