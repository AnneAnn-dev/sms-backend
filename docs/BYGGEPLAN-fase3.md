# Fase 3 byggeplan: betaling og pakker i Frisbii

*Udskrift af Claude Doc'en »Fase 3 byggeplan: betaling og pakker i Frisbii« (rev 24, 17/11-26), lagt i repoet 18/11-26. Oprettet 28/10-26 af Ann. Registret er facit; denne plan er kortet.*

## Kort fortalt

**I prod siden 2/11-26.** Statusafsnittet »Status 2/11 – 6/11« under Byggetrinnene viser, hvad der blev gjort og bevist. Det, der står tilbage, står i »Efter prod« under byggetrinnene.

Fase 3 bygges i ni trin i staging, hvert med sit eget bevis, og intet når prod, før en læsende afstemning har vist, at DB Tømrer ikke mister noget. Modellen er besluttet (D25, model A): Frisbii er sandheden om, hvad et firma har købt, og én synk-funktion oversætter abonnementet til rækker i `firma_moduler`.

Rækkefølgen er valgt, så målingen kommer før funktionen: først kataloget og afstemningen (de læser kun), så den skrivende synk bag et flag, så telefonen som tilkøb, og til sidst det, kunden ser i Profil.

**Ann skal godkende:** rækkefølgen T1–T9, spillereglerne, og svare på de fem beslutninger under "Beslutninger". Ingen kode skrives før det.

## Spilleregler

1. **Staging først, prod sidst.** Alt bygges og bevises i staging mod Frisbii-testkontoen `lommekontor`. Intet fra Fase 3 når prod, før piloternes Referathjælper-tidsplan i D36 er overstået (ét modul ad gangen i prod).
2. **Bag et flag.** Den skrivende synk og ændringerne i webhooken kører kun, når `FASE3_SYNK=true`. Slukket opfører webhooken sig præcis som i dag. Flaget er rollback-vejen.
3. **Én opgave = én mappe i `Claude outputs` = én commit.** Base og resultat som git-hashes, aflevering med `aflever.ps1`, commit med `commit-opgave.ps1`. Claude måler størrelsen på Anns maskine efter hver levering.
4. **Bevis begge veje.** Hvert trin har et tjek, der bliver rødt uden ændringen. Rene funktioner får en `proev-*.js`, som står i `KOERES` i `kor-proever.js`, så CI kører den.
5. **Læs før skriv mod prod.** Første gang noget fra Fase 3 rører prod, er det afstemningen i læsemodus. Den skal vise DB Tømrer, Anns og Annes firmaer uden ændringer, før synk må skrive.
6. **Vokser et trin, stopper vi** og siger det højt (arbejdsprincip 4).

## Byggetrinnene

Trinene tages i rækkefølge; hvert bygger på det forrige. T1–T3 læser kun og kan ikke gøre skade. T4–T7 skriver og ligger bag `FASE3_SYNK`. T8–T9 er det, kunden ser.

**Status 28/10:** ✅ **T1 færdig.** T1a: `frisbii-katalog.js` og `proev-frisbii-katalog.js` (22/22, i CI, CI grøn). T1b: `opret-frisbii-produkter.js` oprettede `ddk-basis` og add-ons `modul-telefon`, `modul-referat` og `modul-hele-pakken` i Frisbii-staging; `check-env.js --live` var rød før og grøn efter. ✅ **T2 færdig:** `frisbii-modulsaet.js` og `proev-frisbii-modulsaet.js` (20/20, i CI, CI grøn). Målt 28/10: et opsagt abonnement har `expires` (periodens slut); knappen hedder "Genindfør". Rykkerreglen er ikke målt endnu (Port 3). Alt pushet til `staging`. Næste: T3.

**Status 28–29/10:** ✅ **T3 færdig:** `afstem-frisbii.js` kørt i staging (rød på de to kendte: `sub-0122` uden firma, `sub-0124` med måle-add-on'et) og læsende i prod (DB Tømrer, Anns og Annes firma OK; kun det lukkede `sub-0077` uenigt). ✅ **T4 færdig:** migrationen `20261029051526_synk_frisbii_moduler.sql` i staging, bevist grønt 10/10 i staging's SQL-editor, intet gemt. Tidsstemplet blev skiftet, fordi en anden chats migration (`20261028100000`) var nyere — lav den tomme migration lige før levering. Næste: T5.

**Status 29–30/10:** ✅ **T5 færdig:** `synkFirma` og `gensynk-firma.js`, bevist i staging på `sub-0124` (tørkørsel skriver intet; `--ignorer-ukendte` overtog telefon). ✅ **T6 færdig:** webhooken synker efter hvert event bag `FASE3_SYNK` (tændt i staging); ukendt produkt → alarm + dead-letter; bevist i fire skridt. **Fund (D92):** Frisbii gensender aldrig et event (COMPLETED efter 1 forsøg) → T6b retter alarmteksterne. ✅ **D92 del 3b:** natlig kontrol `natlig-frisbii.js` som cron-service `natlig-frisbii` i Railway staging kl. 03:00 UTC — dead-letter + afstemning i én mail hver nat (kun læsning). ✅ **T7a færdig i staging:** `telefon-nummer.js` (tildel/frigiv), karantæne efter verifikation i stedet for betaling (D95, Ann 30/10), triggeren `firma_faar_telefon` erstattet af kode (migration `20261030100001`). **T7 delt i fire (Ann 30/10):** T7a nummer og D95 · T7b oprettelse uden nummer og tildeling ved tilkøb · T7c opkald følger modulet (neutral besked, Ann 30/10) · T7d onboarding uden nummer. Næste: T7b.

**Status 30–31/10:** ✅ **T7b–T7d færdige i staging** (oprettelse uden nummer, opkald følger modulet, onboarding uden telefon). ✅ **T8 delt i to (Ann 31/10):** T8a samme firma i webhooken · T8b checkout og bestillingsside. Tilkøb på et eksisterende abonnement flyttet til T9. Gamle `abonnement-standard`-abonnementer flyttes ikke (kataloget oversætter). **Måling 31/10:** Frisbiis checkout tager `ddk-basis` plus add-ons i samme session (`sub-0133`, `sub-0135` → `[referat, telefon]`). Frisbiis hostede sider bruges ikke (går uden om serveren, D33/D91). ✅ **T8a færdig i staging:** `frisbii-kunde.js`; genkøb med samme e-mail bevist på `anneann1904+t8m3` — kørende abonnement gav alarm og intet nyt firma (`sub-0137`), udløbet firma blev genoplivet med `sub-0138` (samme firma, ét login, »Velkommen tilbage«). Eget nummer tilbage fra karantæne bevist i sandkassen (staging-puljen er tom). Hele pakken sælges ikke, før der er flere moduler (Ann 31/10). Næste: T8b.

**Status 31/10 (eftermiddag):** ✅ **T8 færdig i staging.** T8b: bestillingssiden `/bestil?moduler=telefon,referat` (staging: `sms-backend-staging-908c.up.railway.app`) og `/checkout/start` med basis + moduler bag `FASE3_SYNK`; kunde med kørende abonnement får »Du har allerede en konto« og sendes til log ind-siden. Bevist i staging: `har_konto` på Anns e-mail, `sub-0139` med `[referat, telefon]`, log ind-knappen. Katalog: kun Telefonpasser og Referat sælges; Tilbud og Faktura 500 kr.; Hele pakken venter (Ann 31/10). **Fund og rettet:** login-link-ruten sendte ingen mail til en e-mail med flere firmaer (gælder også prod, rettet i staging). **S37 oprettet og accepteret** (bestillingssiden afslører, om en e-mail er kunde). Anne får knappernes adresser til hjemmesiden. Næste: T9 (Din pakke i Profil + tilkøb på eksisterende abonnement).

**Status 1/11:** ✅ **T9 færdig i staging — hele Fase 3 er bygget i staging.** Målinger 31/10 (`sub-0139`): stop = `timing: renewal` + `remove_add_ons`; en straks-ændring sletter et ventende stop, og et tilkøb af et modul, der findes, giver et ekstra eksemplar (dobbeltbetaling) — derfor er »Fortryd« `cancel_change`, aldrig et tilkøb. T9a: `frisbii-pakke.js` (`/api/pakke` + køb, stop, fortryd, opsig, genindfør). T9b: »Din pakke« i Profil, »Din telefonpasser« skjult uden modulet, `sw.js` v71. Bevist i staging 1/11 af Ann på `e700fe38`/`sub-0139`: stop, fortryd, sidste modul kan ikke stoppes, opsig og genindfør. Firmaer uden Frisbii-abonnement ser ikke »Din pakke« (Ann: fint). **Anns beslutninger 31/10:** gamle `abonnement-standard`-abonnementer flyttes i hånden ved prod-overgangen (DB Tømrer ved planskift med særpris 0 kr., opskriften måles i staging først); SoMe sælges i to udgaver à 200 kr. (med og uden opgaver og kunder, gratis skift) som eget trin, når SoMe er klar. **Næste:** 2/11 måling af forholdsmæssig faktura på `sub-0124`, 5/11 D93, opskrift til planskift, D15, derefter vejen til prod.

**Status 2/11 – 6/11: FASE 3 I PROD.** ✅ Toget gik fra `3b28cb1` via grenen `tog/fase3-0211` (PR, flaget slukket). Dependabot-opdateringerne og D2 T2/T3 kom bevidst ikke med. Migrationerne T4 (`20261029051526`) og T7a (`20261030100001`) kørte med `push-prod.ps1 -IncludeAll`. Produkterne blev oprettet i LIVE med `opret-frisbii-produkter.js --prod` (`ddk-basis` 0 kr./7 dage, Telefonpasser 500 kr., Referat 400 kr.). Den natlige kontrol kører som cron-service i prod, og den første mail var grøn. Derefter blev `FASE3_SYNK=true` tændt. **Bevist i prod:** røgtest 13/13 før og efter, afstemningen er »Enige«, Anns firma og telefon er uændret, og et køb uden betaling lander på Annes `/afbrudt`. Den første synk-skrivning i prod ryddede `sub-0077` op. **Rabatkode (1/11):** bygget og bevist i staging, men **kuponer kræver Frisbii Growth** (2.500 kr./md.), så der er ingen kupon i LIVE. Piloterne håndholdes med særpris 0 kr. og en senere betalingsdato. Første pilot er `sub-0082` (6/11). **Målt 2/11 (`sub-0124`):** når et add-on fjernes straks uden for prøveperioden, refunderer Frisbii fakturaen og laver en ny, forholdsmæssig. **Registret** (D25, D91 → I prod), **runbooken** (F3 i begge miljøer) og **pilot-drejebogen** er opdateret 6/11. **Næste:** måle D93 (`sub-0122`), flytte DB Tømrer og Annes firma til den nye plan (valg C, opskriften måles i staging først), lade afstemningen se særpriser og dobbelte eksemplarer, og rette kataloget, før Fase 4 sælger »Kundehenvendelser og SoMe« samlet til 200 kr.

| Trin | Hvad | Bevis (rødt uden ændringen) | Rollback | Størrelse |
| --- | --- | --- | --- | --- |
| **T1 Katalog** | `frisbii-katalog.js`: oversætter mellem modul og Frisbii-handle. Den gamle `abonnement-standard` uden add-ons = `telefon` (så DB Tømrer og de andre ikke mister noget). Hele pakken = hele `MODULER`-listen, også fremtidige. Ann opretter basisplanen (0 kr., 7 dage) og et add-on pr. modul i Frisbii-staging. D26-tjekket udvides til add-ons | `proev-frisbii-katalog.js`: hvert modul i `MODULER` og i CHECK-reglen har et handle; et ukendt handle afvises | Slet filen | S |
| **T2 Modulsættet** | Ren funktion `modulsaet(abonnement, addOns, nu)` → moduler + `til`. `til` = `next_period_start` + 7 dage; opsagt = periodens slut; udløbet = nu (så læseadgangen virker). Bygget på de målte svar fra 25/10 | Kendte svar fra `sub-0124`, `sub-0122` og et opsagt abonnement; manglende `subscription_add_ons` må aldrig give "ingen moduler" | Slet filen | S |
| **T3 Afstemning** | `afstem-frisbii.js`, kun læsning: sammenligner Frisbii med `firma_moduler` og `firms` og melder uenighed, også abonnementer uden firma (D15) | **Rødt på `sub-0122`** (aktiv i Frisbii, intet firma, Å1). Køres derefter læsende mod prod | Slet filen | M |
| **T4 Databasefunktion** | Migration: `synk_frisbii_moduler(firma, moduler, til)` — fuldt replace af firmaets rækker med kilde `frisbii`, `auto` og `migration`; en manuel række for et modul, der nu betales, overtages; andre manuelle rækker røres ikke. Låst for alle andre end serveren | `has_function_privilege` = false for `anon` og `authenticated`; et modul, der ikke er i sættet, forsvinder; en manuel række for et andet modul bliver | `drop function` (kan rulles tilbage) | S |
| **T5 Synk** | `frisbii-synk.js` med `synkFirma(abonnement)`: henter abonnement og add-ons fra Frisbii, kalder T2 og T4. `gensynk-firma.js` med tørkørsel som standard erstatter håndskrevet SQL (D42) | Gensynk af `sub-0124` med og uden add-on'et; tørkørsel viser forskellen og skriver intet | Slet filerne | S |
| **T6 Webhook** | Bag `FASE3_SYNK`: oprettelse, ændring, fornyelse, opsigelse, genoptagelse, udløb og betalt faktura kalder `synkFirma`. Ukendte events bogføres ikke længere stille, og et fejlet event giver alarm (D92) | `subscription_changed` på `sub-0124` giver en loglinje og en ny række; flaget slukket = ingen forskel fra i dag | `FASE3_SYNK=false` | M |
| **T7 Telefon som tilkøb** | Egne funktioner til at tildele og frigive nummeret. Firma uden nummer, når telefon ikke er købt eller puljen er tom (beslutning 4a, med alarm). Triggeren `firma_faar_telefon` fjernes i samme udgivelse. Karantæne efter, om firmaet har haft telefonen, ikke efter beløbet (D95). Velkomstmail uden nummer | Køb af kun Referat i staging giver et firma uden nummer og ingen puljealarm; tilkøb af telefon bagefter giver et nummer; 0-kr.-abonnement giver karantæne | `FASE3_SYNK=false` + triggeren tilbage | L |
| **T8 Samme firma** | Tilkøb til et eksisterende firma sker server-side på dets abonnement (målt virker 25/10), aldrig som et nyt køb. Checkout genkender en e-mail, der allerede har et firma (D91, løsning B) | Ann gentager 27/10 i staging: opsig, køb igen — samme firma, samme nummer, samme login | `FASE3_SYNK=false` | M |
| **T9 Din pakke i Profil** | Til- og fravalg i Profil. Tilkøb gælder straks, fravalg fra næste måned, det sidste modul kan ikke fravælges ("Opsig abonnementet"). Annes tekster. `sw.js` bumpes | Tilkøb og fravalg i staging; afstemningen grøn bagefter | Skjul blokken | M |

## Efter prod: det, der står tilbage (pr. 17/11)

T1–T9 er i prod siden 2/11. Tilbage er ét tog med det, der ligger klar i staging, to små visningsfejl og fem ting, der venter på en beslutning eller en anden chat. Intet her blokerer piloterne.

| Trin | Hvad | Bevis | Hvem og hvornår | Størrelse |
| --- | --- | --- | --- | --- |
| **T10 Næste tog** | Til `main`: Køb i Din pakke ved rabat på 100 % (`2026-11-08-koeb-kompensation`, bevist på `sub-0146`), Dependabot-opdateringerne (`dotenv` 18, #88, #45, actions v7) og D2 T2/T3. Er Fase 4 flettet ind i staging, skal den være slukket bag sit flag | `git log origin/main..origin/staging` gennemgået, migrationer målt, røgtest 13/13 før og efter, ny `sw.js`-version i prod | Ann, efter kl. 17. Venter på gennemgangen af listen | S |
| **T11 Din pakke: to visningsfejl** | Gammel plan viser ikke »Telefonpasser – Dit nuværende abonnement« (telefonen kommer fra planen, ikke fra et add-on). Et udløbet abonnement vises som aktivt med knapper og sum; skal i stedet sige »Dit abonnement er udløbet« | `proev-frisbii-pakke.js` rød før, grøn efter; Din pakke vist for DB Tømrer og et udløbet testfirma | Ann 8/11: vi lever med det. Med et senere tog | S |
| **T12 Kataloget: én pakke** | »Kundehenvendelser og SoMe« som ét add-on til 200 kr., der giver modulrækkerne `svar` og `facebook` (som Hele pakken). Står som »kommer snart«, til Fase 4 er klar | Katalog-, checkout-, pakke- og synk-prøverne grønne; Din pakke viser én grå linje | Fase 4-chatten (overlevering givet 8/11) | M |
| **T13 Afstemningen udvides** | Særpriser (D15), dobbelte eksemplarer af samme modul og første betalingsdato. Det samme i den natlige kontrol | Rød på en kendt særpris og et kendt dobbelt eksemplar i staging, grøn ellers | Ann 6/11: senere | M |
| **T14 Ret e-mail (S38)** | Kunden ændrer e-mail i Profil med bekræftelse til både gammel og ny adresse; e-mailen ændres samtidig hos Frisbii | Login og Frisbii-kunde har samme e-mail bagefter; et afbrudt skift ændrer ingen af dem | Ikke planlagt | M |
| **T15 MFA (S39)** | Valgfri to-faktor med godkendelsesapp (Supabase TOTP). Afklar først: mistet telefon, og om MFA kræves ved følsomme handlinger | Login kræver koden for en bruger med MFA; en uden mærker intet | Ikke planlagt | M |
| **T16 Gammel plan → `ddk-basis`** | DB Tømrer og Annes firma flyttes ved planskift på samme abonnement med særpris 0 kr. på begge moduler (valg C) | Opskriften målt i staging først; afstemningen »Enige« bagefter, nummer uændret | Kun hvis I ønsker det (Ann 8/11: ikke nu) | S |

**Beslutninger hos Ann og Anne:** Frisbii Growth (kuponer i salget, 2.500 kr./md.) · Frisbiis egne mails · Annes endelige velkomsttekster · sletning af `sub-0077`-firmaet i prod.

## Beslutninger

Alle fem er afgjort af Ann 28/10, alle som foreslået. Planen er dermed klar til T1.

| # | Spørgsmål | Forslag | Senest | Beslutning (Ann) |
| --- | --- | --- | --- | --- |
| 1 | Et opsagt abonnement: adgang til periodens slut, eller periodens slut + 7 dages respit? | Periodens slut, ingen respit. Respitten er til en betaling, der fejler, ikke til en opsigelse, kunden selv har valgt | T2 | Enig (Ann 28/10): periodens slut, ingen respit |
| 2 | Telefonen når respitten er gået (dag 7), mens Frisbii prøver at trække til ca. dag 15 | Opkald omstilles ikke længere, men nummeret beholdes til abonnementet udløber. Betaler han dag 10, virker hans nummer igen med det samme | T7 | Enig (Ann 28/10) |
| 3 | Genkendelse af en tilbagevendende kunde (D91, løsning B) med i Fase 3? | Ja, i T8. Det skete 27/10 ved en almindelig kundehandling og kan ramme DB Tømrer i dag | T8 | Enig (Ann 28/10): med i T8 |
| 4 | Tilkøb straks: forholdsmæssig betaling eller en hel måned? | Forholdsmæssig (Frisbiis standard, planen står på `bill_prorated`). Afgøres efter målingen på `sub-0124` efter 1/11 | T9 | Forholdsmæssig betaling (Ann 28/10) |
| 5 | Hvor bor oversættelsen modul ↔ Frisbii: i vores katalog-fil eller i Frisbiis egne "entitlements" på hvert add-on? | Katalog-filen. Den kan testes i CI, Frisbii-navne står ét sted, og den virker for den gamle plan uden add-ons | T1 | Enig (Ann 28/10): katalog-filen |

**Til Anne:** velkomstmailen til et firma uden nummer (T7) og teksterne til "Din pakke" i Profil (T9).

## Port 3 og vejen til prod

**Port 3 (fra udviklingsplanen):** køb, opgradering til Hele pakken og opsigelse er prøvet i Frisbiis testmiljø, og afstemningen er grøn. Hertil fra i dag: genkøb efter opsigelse giver samme firma (T8).

**Vejen til prod, i denne rækkefølge:**

1. Port 3 grøn i staging, og piloternes Referathjælper-tidsplan i D36 overstået.
2. Produkterne oprettes i Frisbii LIVE (`test-2-lommekontor`), og `check-env-prod.js --live` er grøn, også for add-ons.
3. Koden med toget til `main`, med `FASE3_SYNK=false` i prod. Intet ændrer sig for kunderne.
4. `afstem-frisbii.js` køres læsende mod prod. **Den skal vise DB Tømrer (`sub-0071`), Anns (`sub-0072`) og Annes (`sub-0076`) firma uden ændringer** — samme moduler, samme nummer. Viser den en forskel, stopper vi.
5. `gensynk-firma.js` køres først med skrivning på Anns eget firma, derefter Annes. DB Tømrer sidst, og kun efter at afstemningen er grøn for de to første.
6. `FASE3_SYNK=true` i prod. Afstemningen kører igen samme dag og dagen efter.

**Det, der ikke må gå i stykker:** DB Tømrers nummer og hans adgang. Han har en brugerdefineret pris på 0 kr. (Ann 27/10), så indtil T7 er i prod gælder D95's procedure: hans abonnement lukkes aldrig, uden at vi først har besluttet, hvad der sker med nummeret.

## Grundlag

Registret er facit; denne plan er kortet. Planen bygger på `RISIKOREGISTER.md` som committet 28/10 (680.073 bytes).

- **Beslutninger:** D25 (model A og Anns seks beslutninger 25/10), D91 (løsning B, H/H fra 27/10), D95 (0-kr.-abonnementer).
- **Åbne rækker, planen lukker:** D15 (T3), D42 og D92 (T5, T6), D91 (T8), D93 (T3 viser det; T7 og T8 fjerner årsagen), D95 (T7).
- **Allerede lukket i staging og prod:** D26 og D41 (`check-env.js`, `check-env-prod.js`, `frisbii-tjek.js`).
- **Målinger 25–28/10:** projektdoc `claude/fase3-d25-beslutninger.md` — feltnavne, add-on-kald, events og rykkerforløb.
- **Kode på `origin/staging`:** `frisbii-webhook.js` `369b0e74`, `frisbii-checkout.js` `eae68dca`, `moduler.js` `e65e6e77`, migrationen `20261013120000_firma_moduler.sql`. Hentes frisk før hvert trin.
- **Udviklingsplanen:** "Fase 3: betaling og pakker i Frisbii" (rev 107). Rettes, når denne plan er godkendt.
- **Datoer at måle:** 2/11 første faktura på `sub-0124` (beslutning 4), 5/11 om `sub-0122` blev genoplivet (D93).
