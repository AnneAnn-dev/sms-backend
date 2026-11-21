# Byggeplan: Tilbud (Fase 5)

Skrevet 19/11-26 ud fra arbejdskopien af `docs/` synket 19/11 (registret 803.155 bytes, sidste post D104).
Beslutninger 1–9, bundgrænse og vilkårslinje afgjort af Ann 19/11. Rækkefølgen efter Fase 5 og tilbuddets input afgjort af Ann 20/11. Efter spor 1's skemamåling (trin 0) afgjorde Ann 20/11: opgavetyperne er håndværkerens egne (erstatter den faste liste fra 19/11), kørsel, nummer pr. version, frysning af firmaoplysninger, beregning i øre, noter i input og titelforslag (#5, #7, #10–#14). Ann 21/11: afrundingsreglen (#14), nøgle for tilbudskæden (#15), og spor 1 ejer `kvote.js`. **Ikke godkendt af Anne.** Åbne punkter står nederst.
Claude skriver ikke i sms-backend og rører ikke prod; filer leveres i `_til-repo\<emne>\`.

Denne fil erstatter Trin 4 i `tilbud-runbook.md` som rækkefølge for tilbuddet. Primeren er stadig autoritativ for HVAD og HVORFOR (frysning, append-only, D13, D22).

## Port 5

Et tilbud kan laves ud fra opgavens beskrivelse alene og ud fra beskrivelsen plus flere referater, godkendes, deles som PDF og markeres sendt og accepteret — og et godkendt tilbud viser de samme tal, efter at profilen er rettet.

## Beslutninger (Ann 19.–21/11)

| # | Emne | Beslutning |
|---|---|---|
| 1 | Sendt | Håndværkeren har sendt PDF'en selv (telefonens del-knap) og markerer selv "Sendt". DDK sender ingen mail. Rykkeren (D22) er parkeret. |
| 2 | Kundeaccept | Håndværkeren markerer selv "Accepteret af kunden". Intet offentligt accept-link. |
| 3 | Prisforslag | Modellen må foreslå priser, men en foreslået linje er tydeligt **ikke accepteret**, til håndværkeren har bekræftet den. Serveren afviser at godkende et tilbud med ubekræftede linjer. Arbejdslinjen (timepris × timer) og alle summer regnes i kode. Senere: priser fra materialeleverandører (samme markering, til de er bekræftet). |
| 4 | Udtræk | Intet eget endpoint: tilbuddet starter fra en opgave, der allerede har kunde og adresse. `tilbudslinjer` foreslår i stedet opgavetype, mængde og timer — ikke accepteret, til håndværkeren bekræfter. Fase 5 har ét AI-kald, ikke to. |
| 5 | Timepris | Én timepris plus kørsel. Liste pr. branche/rolle, når et firma har brug for to satser. **Kørsel (Ann 20/11):** vælges pr. tilbud — km × sats eller et fast beløb. Profilen har en standard for begge; tilbuddet fryser formen, km og satsen eller beløbet. Kørslen er sin egen linjetype (`koersel`), så referencetallet kan holde den ude. Kolonnerne findes ikke i `firma_profil` i dag (trin 0) og lægges i spor 1's migration. |
| 6 | Standardfelter | Ikke med. Betingelser og gyldighed er fritekst fra profilen, fryses ind i tilbuddet. |
| 7 | Tilbudsnummer | Fortløbende pr. firma, sat ved godkendelse. **Håndværkeren kan sætte startnummeret**, så han fortsætter sin egen serie. Nummeret kan ikke sættes under det højeste, der er brugt. **En ny version får et nyt nummer** (Ann 20/11); den gamle beholder sit. Nummeret er et heltal (i dag tekst, trin 0). |
| 8 | PDF | jsPDF i browseren, hostet selv fra start. Anne laver layoutet. Intet logo i første udgave. |
| 9 | Placering | Tilbud i opgavevinduet; timepris, kørsel, betingelser og startnummer i Profil. |
| 10 | Input (Ann 20/11) | Forslaget bygger på **alt, der ligger på opgaven**: beskrivelsen (fra kundeformularen eller Ny opgave), **opgavens noter** (Ann 20/11) og **alle opgavens referater**, hver med dato og i rækkefølge. Alle referater er valgt fra start; håndværkeren kan fravælge nogle, før forslaget laves. Tilbuddet husker sine kilder (referaternes id'er og en kopi af beskrivelsen og noterne, som de så ud, da forslaget blev lavet), og kilderne fryses med resten. Kildelisten erstatter `tilbud.referat_id`, som fjernes (to veje fra `tilbud` til `referater` får PostgREST-embedding til at fejle). Er kilderne uenige (40 m² og senere 45 m²), vinder den nyeste, og forslaget skriver "kilderne er uenige" ved feltet. Et nyt referat efter afsendelse giver en ny version (D13, `kilde_referat_id`). |
| 11 | Opgavetyper (Ann 20/11) | **Håndværkerens egne**, ikke en fast liste hos DDK. Han opretter en type direkte i tilbuddet (navn og enhed), når det passer ham; valget viser hans tidligere typer først, som hjælp, ikke som spærre. Samme navn med en anden enhed er en ny type. **Enheden vælges fra en liste** (Ann 20/11): stk., m, cm, m², m³, kg, timer og "Andet" med fri tekst. Listen kan udvides; en udvidelse ændrer ingen gamle tilbud. Ingen type = intet referencetal for det tilbud (ingen "Andet"). **Opslag uden hensyn til store/små bogstaver og mellemrum i enderne:** "Terrasse" og " terrasse" er samme type (unikt pr. firma på normaliseret navn og enhed), så hans egen historik ikke deler sig. En stavefejl ("terasse") fanges af forslagene, mens han skriver, ikke af reglen. Dubletter og nuancer ryddes senere af DDK (normalisering, se Referencetal) — han skal ikke begrænses af det arbejde. |
| 12 | Titler (Ann 20/11) | Modellen foreslår **tilbuddets titel og opgavens titel**. Begge er **ikke accepteret**, til håndværkeren bekræfter eller retter dem; opgavens titel skrives først på opgaven, når han har accepteret den. |
| 13 | Firmaoplysninger (Ann 20/11) | CVR, adresse, telefon, mail og bank **fryses ind ved godkendelse** som timeprisen. Et godkendt tilbud viser altid det, kunden fik. En ny version starter fra profilen, som den er nu. |
| 14 | Beregning (Ann 20/11) | **Ingen fejl, heller ikke en øre.** Alle tal regnes af én funktion i kode i hele øre (ingen kommatal): linjesummer, arbejde, materialer, sum ekskl. moms, moms (én gang på summen) og total. Resultatet gemmes; PDF'en viser kun det gemte og regner aldrig selv. Den genererede `linje_sum`-kolonne fjernes (databasen rundede 18,525 til 18,53, JavaScript til 18,52). **Afrundingsreglen (Ann 21/11):** en linje (antal × enhedspris med rabat) regnes præcist og afrundes én gang til hele øre; sum ekskl. moms er de afrundede linjer lagt sammen; momsen regnes én gang på summen ekskl. moms og afrundes én gang; total = sum ekskl. moms + moms. **Halve øre runder væk fra nul** (0,005 → 0,01; ikke bankers rounding). Prøverne har to tilfælde: et halvt øre på en linje (1,5 × 12,35 = 18,53) og et, hvor moms pr. linje og moms på summen giver forskellige ører (to linjer à 10,02: moms på summen = 5,01, ikke 5,02). En prøve kontrollerer, at linjerne summerer præcist til totalen. |
| 15 | Tilbudskæden (Ann 21/11) | Tilbuddet får **en nøgle for kæden** nu, mens tabellen er tom; versionerne er unikke pr. kæde, ikke pr. opgave. **Fase 5 bygger kun én kæde pr. opgave** — en ny version erstatter den gamle. Alternativer side om side (fx lærk og trykimprægneret) er en kendt begrænsning; udløser: en pilot beder om alternativer. Så kræver det kun klient og ruter, ingen omlægning af data. |

## Referencetal (Ann 19/11)

Målet på længere sigt: referencetal pr. opgavetype — først fra håndværkerens egne tilbud, senere anonymiseret på tværs af firmaer, og til sidst som et produkt, der sælges. Det afgør datamodellen nu, fordi et tilbud uden struktureret type og mængde ikke kan sammenlignes bagefter.

- **Med i Fase 5 (trin 1, egne tal):** tilbuddet får en `opgavetype` fra håndværkerens egen liste (#11) og en hovedmængde med enhed (typen bestemmer enheden). Referencetallet regnes i kode: pris ekskl. moms ÷ mængde, delt i arbejde og materialer. Vises ved godkendelse, fx "500 kr./m² · dine accepterede terrasser: 230–280 kr./m²". Kun firmaets egne tilbud (S21).
- **Erfaring = accepterede tilbud.** Når Faktura findes, er fakturaer erfaring på et højere niveau.
- **Bundgrænse 5 gælder kun kollegers tal** (Ann 19/11): mindst 5 firmaer pr. opgavetype, før et tal på tværs vises. Hans egne tal har ingen bundgrænse og vises fra første accepterede tilbud af samme type, med antallet ved siden af.
- **Opgavetyperne** (Ann 20/11, erstatter den faste liste fra 19/11): hvert firma bygger sin egen liste løbende (#11). DB Tømrerfirmas opgaver er ikke længere en forudsætning for spor 1's migration.
- **Normalisering kommer bagefter** (Ann 20/11): DDK arbejder senere med de typer, firmaerne har lagt ind — dubletter og nuancer inden for et firma og på tværs af firmaer. Det stiller krav til datamodellen **nu**: (a) det, han skrev, overskrives aldrig — tilbuddet fryser en kopi af typens navn og enhed, og normaliseringen lægger en kobling oven på, den retter ikke originalen; (b) typerne har et fast id og slettes aldrig, kun deaktiveres, så en kobling altid har noget at pege på; (c) type, mængde og summerne for arbejde og materialer er strukturerede kolonner, ikke fritekst. Koblingen til en fælles type er en kolonne, der tilføjes, når normaliseringen bygges — den kræver ingen omskrivning af gamle tilbud. Brug på tværs af firmaer kræver stadig vilkårslinjen (åbent spørgsmål 1); normaliseringen ændrer ikke på det.
- **Vilkårslinjen** (Ann 19/11): Anne og advokaten skriver linjen om anonymiseret brug af tal, før det første rigtige tilbud.
- **Ikke med (trin 2 og 3, kollegers tal og salg):** parkeres i registret med udløser. Forudsætninger: vilkårene giver lov til anonymiseret brug (nyt formål — DDK bliver dataansvarlig for det), konkurrenceretten er set af advokaten, og forretningskonflikten (håndværkerne betaler os; deres prisniveau sælges til deres kunder) er afgjort af Ann og Anne.
- **Idé, ikke med:** håndværkeren indlæser tidligere fakturaer, så han har referencetal fra start. Kræver OCR/vision (J9, Mistrals DPA mangler), at hver faktura får type og mængde bekræftet af ham, og at vilkåret dækker data fra før han blev kunde. Fakturaerne indeholder hans kunders persondata (ny J-række som J14). Parkeres med udløseren "trin 1 har været i drift hos piloterne".

## Sådan står det i dag

- Tabellerne `tilbud`, `tilbud_linjer`, `firma_profil`, `standardfelter` findes i begge miljøer siden 27/7 (migration `20260727065703`), med RLS. **Målt 20/11 (trin 0) i staging og prod: skemaet, politikkerne og grants er ens i de to miljøer** og svarer til migrationen. 0 tilbud og 0 linjer i begge; prod har 12 referater.
- Afvigelser fra planen (trin 0, rettes i spor 1's migration): ingen kopi af timepris, kørsel og firmaoplysninger på tilbuddet; ingen kørsel i `firma_profil`; status mangler `godkendt`; `nummer` er tekst; den genererede `linje_sum` (fjernes, #14); `tilbud.referat_id` (fjernes, #10); ingen opgavetype, mængde, enhed, summer for arbejde og materialer, ubekræftet-markering eller kildeliste; `authenticated` har `TRUNCATE`, `TRIGGER`, `MAINTAIN` og `REFERENCES` på alle fem tabeller (kun `SELECT` var meningen).
- **Append-only kan ikke håndhæves med RLS alene:** serveren skriver med service role, som omgår RLS. INSERT-only-politikken på `tilbud_historik` stopper klienten; en trigger, der afviser UPDATE, DELETE og TRUNCATE, stopper også serveren. Det samme gælder låsningen af et godkendt tilbud.
- Hvert firma har en `firma_profil`-række (D68-trigger, 1/10).
- `tilbud_historik` (D13) findes ikke.
- Kvote, `ai_forbrug`, server-side prompt og `mistral-medium-3.5-128b` (PREVIEW, D14) er i drift for referat og Skrivehjælp.
- Modulet `tilbud` står i kataloget med `kommer: true`.
- D5 (ruterne ud af `server.js`) står til "umiddelbart før tilbudsmodulets første migration".

## To spor

To chats arbejder samtidig. De rører hver sine filer.

| Trin | Spor 1: data og server | Spor 2: måling, derefter klient |
|---|---|---|
| **0** | Mål skemaet på staging: `information_schema.columns`, `pg_policies`, grants på `tilbud*` og `firma_profil`. Kun læsning. Afvigelser skrives ned. | Grænser for AI-målingen skrevet og godkendt af Ann og Anne **før** første resultat. Anne samler ca. 10 rigtige opgaver med facit-linjer: nogle med kun beskrivelse, nogle med beskrivelse plus 2–3 referater, mindst én hvor kilderne er uenige, og én med et injektionsforsøg i kundens tekst. |
| **A** | D5: tilbudsruterne i egen fil. Én migration: `tilbud_historik` (INSERT-only RLS plus trigger), rettelser fra trin 0, firmaets opgavetyper (#11), `maengde`, `enhed`, arbejde/materialer, `tilbudsnummer`, startnummer og kørsel i `firma_profil`, kildelisten pr. tilbud (#10), ubekræftet-markering på linjer og titler (#3, #12), grants. Kontrol og rollback i filen. | `prompts/tilbudslinjer.js` (kilderne mærket med type og dato; den nyeste vinder; uenighed meldes) og et målescript mod sættet. Kvotepuljen `tilbud` og loftet foreslås (Ø2). |
| **B** | Ruter med CRUD pr. række og ejerskabstjek (IDOR); beregning i kode (numeric, moms). | AI-porten afgøres efter grænserne fra trin 0. Prompten låses med en version (D14). |
| **C** | Godkend: profilværdier fryses ind, nummer tildeles atomisk, linje i historikken, tilbuddet låses. Ny version erstatter et afsendt. Sendt og accepteret som hændelser. **Frysningstest** som prøve. | Klient: Tilbud i opgavevinduet, linjeeditor med "ikke accepteret"-markering, Profil-felterne. |
| **D** | `/api/tilbud/tilbudslinjer`: klienten sender kun opgavens id og de valgte referaters id'er, aldrig tekst; serveren tjekker, at referaterne hører til opgaven og firmaet (IDOR), henter teksterne selv og lægger et loft på inputtets længde. Kvote før kald, låst model, formvalidering (P5), retry én gang. Referencetal-rute (kun egne tal). | PDF og del-knap. Referencetallet ved godkendelse. Browserprøve med `<img src=x onerror=…>` som navn. |
| **Samling** | Ende til ende på staging: kun beskrivelse, og beskrivelse plus flere referater med ét fravalgt (Port 5). Seks-linse-gennemgang, Annes QA, installeret app på iPhone. | ← samme |
| **Pilot** | Eget flag for tilbudsdelen (navn afgøres i koden). Modulet sat på manuelt: Anns firma, derefter DB Tømrerfirma. Tog fra en låst `staging`-commit. | |
| **Salg** | Add-on `modul-tilbud` (400 kr./md. ekskl. moms) i Frisbii test, derefter live; salgsflag efter Fase 4-mønstret; `kommer: false`. | |

**Hvorfor sådan:** AI-delen er den eneste, hvor det er uvist, om den holder. Fejler den, ændrer det klienten (færre linjer, ingen prisforslag), ikke datamodellen. Et tilbud uden modelforslag er stadig et tilbud.

## Regler for de to chats

- **Filejerskab.** Spor 1: `supabase/migrations/`, `routes/tilbud/`, `server.js`, `kvote.js` (Ann 21/11), `kor-proever.js`. Spor 2: `prompts/tilbudslinjer.js`, målescriptet, testsættet, `static/dashboard.html`, PDF-filen, `sw.js`. Spor 2 sender sine linjer til `kor-proever.js` som tekst.
- **Kontrakten** skrives før trin A: JSON for tilbud, linje og modelsvar, og `bygTilbudslinjePrompt(data) → {system, user}`.
- **Registret:** kun spor 1 skriver; spor 2 leverer sine linjer som tekst.
- **Grene:** `fase5/server` og `fase5/klient`. Ingen merger til `staging`, mens et tog kører.

## Registret

Genåbnes eller udvides for tilbud: S6, Ø2, J9, D14, P5, D13, D5, S21 (egne tal). Nye rækker, `Parkeret` med udløser: referencetal på tværs af firmaer (vilkår og formål, anonymiseringsgrænse, konkurrenceret, forretningskonflikt), indlæsning af tidligere fakturaer, tilbudsrykkeren (D22). Ny J-række: kundens adresse, opgavetekst fra formularen og referaterne sendes til Scaleway (som J14). S6 udvides: kundens formulartekst er utroværdigt input i prompten. Spørgsmål til advokaten: opbevaring af tilbud (J4, D89).

## Tilbagerulning

| Problem | Gør |
|---|---|
| Tilbudsdelen fejler i prod | Flaget slukkes i Railway (Deploy/Apply, tjek `/health`). |
| Salget fejler | Salgsflaget slukkes. |
| Migrationen | Tilføjer kun tabel og kolonner; bliver liggende. Rollback står i filen. |

## Efter Fase 5 — rækkefølgen (Ann 20/11)

Ann omprioriterer 20/11: processerne omkring tilbuddet og opgaveformularen uden telefon kommer før Booking. Udviklingsplanens Fase 6 (Booking) og Fase 7 (Faktura) rykker derfor. Udviklingsplanen (Claude Doc-masteren) er rettet 20/11.

| Trin | Hvad | Udløser eller forudsætning |
|---|---|---|
| **5** | Den simple tilbudsmaskine (denne plan). | — |
| **5b** | **Processer omkring tilbuddet:** hvad piloterne savner, når de har brugt tilbuddene. Kandidater: mail fra DDK, rykker til kunden (D22, kræver natjob og afsendelsesvej), accept-link (offentlig side, ny angrebsflade). Egen byggeplan. | Tilbud i drift hos piloterne et stykke tid; hvad de savner, afgør indholdet. |
| **5c** | **Opgaveformular uden telefon** og **kalenderen genovervejet** (se nedenfor). | 5b er afsluttet. |
| **Integrationer** | Materialeleverandører (byggemarkeder, havecentre): en leverandørpris er endnu en kilde til et forslag, med samme "ikke accepteret"-markering. Økonomisystemer (e-conomic, Dinero m.fl.): eget projekt, login pr. håndværker. | Tilbud og PDF i drift hos piloterne (primeren). Rækkefølgen mellem de to afgøres ved 5c. |
| **Booking** | Udviklingsplanens Fase 6. | Afgøres ved 5c: tages den her, eller senere? |
| **Faktura** | Udviklingsplanens Fase 7. | Advokatens svar (D22). Uændret. |

### 5c — opgaveformular uden telefon

I dag får kunden opgaveformularen som et link i en SMS efter et ubesvaret opkald (Telefonpasser). Ideen: håndværkeren sender selv linket til en kunde — i en SMS eller en mail — og kundens udfyldte opgave lander i dashboardet. Det giver værdi til firmaer uden Telefonpasser (Skrivehjælp og SoMe med kunder, Referat).

- **Genbrug, ikke nyt:** D88 trin 2 byggede et engangslink til kundeformularen (S34). Mål, hvad der faktisk er i prod, før der planlægges.
- **Afsendelsesvejen er det store valg:** (a) håndværkeren deler linket fra sin egen telefon (del-knap, som PDF'en) — ingen Twilio-udgift, intet nummer; (b) SMS fra systemnummeret — koster pr. SMS og kræver afsendernavn og kvote; (c) mail via Scaleway TEM. (a) er billigst at bygge og drive.
- **Den offentlige formular er en angrebsflade:** engangstoken, loft pr. firma og spamværn, som Booking også skal have.
- **Kalenderen:** Ann ser på Booking igen ved 5c og beslutter, om den tages her. Formularen og Booking deler meget (offentlig side, spamværn, en henvendelse bliver en ny opgave), så de vurderes sammen.

## Åbne spørgsmål

1. **Anne og advokaten:** vilkårslinjen om anonymiseret brug, før første rigtige tilbud.
2. **Anne:** PDF-layout, teksterne for "ikke accepteret", Sendt og Accepteret.
