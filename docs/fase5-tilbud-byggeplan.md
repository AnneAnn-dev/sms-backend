# Byggeplan: Tilbud (Fase 5)

Skrevet 19/11-26 ud fra arbejdskopien af `docs/` synket 19/11 (registret 803.155 bytes, sidste post D104).
Beslutninger 1–9, opgavetyper, bundgrænse og vilkårslinje afgjort af Ann 19/11. Rækkefølgen efter Fase 5 afgjort af Ann 20/11. **Ikke godkendt af Anne.** Åbne punkter står nederst.
Claude skriver ikke i sms-backend og rører ikke prod; filer leveres i `_til-repo\<emne>\`.

Denne fil erstatter Trin 4 i `tilbud-runbook.md` som rækkefølge for tilbuddet. Primeren er stadig autoritativ for HVAD og HVORFOR (frysning, append-only, D13, D22).

## Port 5

Et tilbud kan laves både med og uden referat, godkendes, deles som PDF og markeres sendt og accepteret — og et godkendt tilbud viser de samme tal, efter at profilen er rettet.

## Beslutninger (Ann 19/11)

| # | Emne | Beslutning |
|---|---|---|
| 1 | Sendt | Håndværkeren har sendt PDF'en selv (telefonens del-knap) og markerer selv "Sendt". DDK sender ingen mail. Rykkeren (D22) er parkeret. |
| 2 | Kundeaccept | Håndværkeren markerer selv "Accepteret af kunden". Intet offentligt accept-link. |
| 3 | Prisforslag | Modellen må foreslå priser, men en foreslået linje er tydeligt **ikke accepteret**, til håndværkeren har bekræftet den. Serveren afviser at godkende et tilbud med ubekræftede linjer. Arbejdslinjen (timepris × timer) og alle summer regnes i kode. Senere: priser fra materialeleverandører (samme markering, til de er bekræftet). |
| 4 | Udtræk | Intet eget endpoint: tilbuddet starter fra en opgave, der allerede har kunde og adresse. `tilbudslinjer` foreslår i stedet opgavetype, mængde og timer — ikke accepteret, til håndværkeren bekræfter. Fase 5 har ét AI-kald, ikke to. |
| 5 | Timepris | Én timepris plus kørsel (kolonnerne i `firma_profil`). Liste pr. branche/rolle, når et firma har brug for to satser. |
| 6 | Standardfelter | Ikke med. Betingelser og gyldighed er fritekst fra profilen, fryses ind i tilbuddet. |
| 7 | Tilbudsnummer | Fortløbende pr. firma, sat ved godkendelse. **Håndværkeren kan sætte startnummeret**, så han fortsætter sin egen serie. Nummeret kan ikke sættes under det højeste, der er brugt. |
| 8 | PDF | jsPDF i browseren, hostet selv fra start. Anne laver layoutet. Intet logo i første udgave. |
| 9 | Placering | Tilbud i opgavevinduet; timepris, kørsel, betingelser og startnummer i Profil. |

## Referencetal (Ann 19/11)

Målet på længere sigt: referencetal pr. opgavetype — først fra håndværkerens egne tilbud, senere anonymiseret på tværs af firmaer, og til sidst som et produkt, der sælges. Det afgør datamodellen nu, fordi et tilbud uden struktureret type og mængde ikke kan sammenlignes bagefter.

- **Med i Fase 5 (trin 1, egne tal):** tilbuddet får `opgavetype` fra en fast liste og en hovedmængde med enhed (typen bestemmer enheden). Referencetallet regnes i kode: pris ekskl. moms ÷ mængde, delt i arbejde og materialer. Vises ved godkendelse, fx "500 kr./m² · dine accepterede terrasser: 230–280 kr./m²". Kun firmaets egne tilbud (S21).
- **Erfaring = accepterede tilbud.** Når Faktura findes, er fakturaer erfaring på et højere niveau.
- **Bundgrænse 5 gælder kun kollegers tal** (Ann 19/11): mindst 5 firmaer pr. opgavetype, før et tal på tværs vises. Hans egne tal har ingen bundgrænse og vises fra første accepterede tilbud af samme type, med antallet ved siden af.
- **Opgavetyperne** (Ann 19/11): listen starter med DB Tømrerfirmas opgaver, hver med sin enhed, plus "Andet" (intet referencetal). Listen skal være fast i databasen, så den kan udvides uden at gamle tilbud ændres.
- **Vilkårslinjen** (Ann 19/11): Anne og advokaten skriver linjen om anonymiseret brug af tal, før det første rigtige tilbud.
- **Ikke med (trin 2 og 3, kollegers tal og salg):** parkeres i registret med udløser. Forudsætninger: vilkårene giver lov til anonymiseret brug (nyt formål — DDK bliver dataansvarlig for det), konkurrenceretten er set af advokaten, og forretningskonflikten (håndværkerne betaler os; deres prisniveau sælges til deres kunder) er afgjort af Ann og Anne.
- **Idé, ikke med:** håndværkeren indlæser tidligere fakturaer, så han har referencetal fra start. Kræver OCR/vision (J9, Mistrals DPA mangler), at hver faktura får type og mængde bekræftet af ham, og at vilkåret dækker data fra før han blev kunde. Fakturaerne indeholder hans kunders persondata (ny J-række som J14). Parkeres med udløseren "trin 1 har været i drift hos piloterne".

## Sådan står det i dag

- Tabellerne `tilbud`, `tilbud_linjer`, `firma_profil`, `standardfelter` findes i begge miljøer siden 27/7 (migration `20260727065703`), med RLS. Skemaet er fra før D88, D13's design og append-only-invarianten og skal **måles**, ikke antages.
- Hvert firma har en `firma_profil`-række (D68-trigger, 1/10).
- `tilbud_historik` (D13) findes ikke.
- Kvote, `ai_forbrug`, server-side prompt og `mistral-medium-3.5-128b` (PREVIEW, D14) er i drift for referat og Skrivehjælp.
- Modulet `tilbud` står i kataloget med `kommer: true`.
- D5 (ruterne ud af `server.js`) står til "umiddelbart før tilbudsmodulets første migration".

## To spor

To chats arbejder samtidig. De rører hver sine filer.

| Trin | Spor 1: data og server | Spor 2: måling, derefter klient |
|---|---|---|
| **0** | Mål skemaet på staging: `information_schema.columns`, `pg_policies`, grants på `tilbud*` og `firma_profil`. Kun læsning. Afvigelser skrives ned. | Grænser for AI-målingen skrevet og godkendt af Ann og Anne **før** første resultat. Anne samler ca. 10 rigtige opgaver/referater med facit-linjer. |
| **A** | D5: tilbudsruterne i egen fil. Én migration: `tilbud_historik` (INSERT-only RLS), rettelser fra trin 0, `opgavetype`, `maengde`, `enhed`, arbejde/materialer, `tilbudsnummer`, startnummer i `firma_profil`, grants. Kontrol og rollback i filen. | `prompts/tilbudslinjer.js` og et målescript mod sættet. Kvotepuljen `tilbud` og loftet foreslås (Ø2). |
| **B** | Ruter med CRUD pr. række og ejerskabstjek (IDOR); beregning i kode (numeric, moms). | AI-porten afgøres efter grænserne fra trin 0. Prompten låses med en version (D14). |
| **C** | Godkend: profilværdier fryses ind, nummer tildeles atomisk, linje i historikken, tilbuddet låses. Ny version erstatter et afsendt. Sendt og accepteret som hændelser. **Frysningstest** som prøve. | Klient: Tilbud i opgavevinduet, linjeeditor med "ikke accepteret"-markering, Profil-felterne. |
| **D** | `/api/tilbud/tilbudslinjer`: kvote før kald, låst model, formvalidering (P5), retry én gang. Referencetal-rute (kun egne tal). | PDF og del-knap. Referencetallet ved godkendelse. Browserprøve med `<img src=x onerror=…>` som navn. |
| **Samling** | Ende til ende på staging, med og uden referat (Port 5). Seks-linse-gennemgang, Annes QA, installeret app på iPhone. | ← samme |
| **Pilot** | Eget flag for tilbudsdelen (navn afgøres i koden). Modulet sat på manuelt: Anns firma, derefter DB Tømrerfirma. Tog fra en låst `staging`-commit. | |
| **Salg** | Add-on `modul-tilbud` (400 kr./md. ekskl. moms) i Frisbii test, derefter live; salgsflag efter Fase 4-mønstret; `kommer: false`. | |

**Hvorfor sådan:** AI-delen er den eneste, hvor det er uvist, om den holder. Fejler den, ændrer det klienten (færre linjer, ingen prisforslag), ikke datamodellen. Et tilbud uden modelforslag er stadig et tilbud.

## Regler for de to chats

- **Filejerskab.** Spor 1: `supabase/migrations/`, `routes/tilbud/`, `server.js`, `kor-proever.js`. Spor 2: `prompts/tilbudslinjer.js`, målescriptet, testsættet, `static/dashboard.html`, PDF-filen, `sw.js`. Spor 2 sender sine linjer til `kor-proever.js` som tekst.
- **Kontrakten** skrives før trin A: JSON for tilbud, linje og modelsvar, og `bygTilbudslinjePrompt(data) → {system, user}`.
- **Registret:** kun spor 1 skriver; spor 2 leverer sine linjer som tekst.
- **Grene:** `fase5/server` og `fase5/klient`. Ingen merger til `staging`, mens et tog kører.

## Registret

Genåbnes eller udvides for tilbud: S6, Ø2, J9, D14, P5, D13, D5, S21 (egne tal). Nye rækker, `Parkeret` med udløser: referencetal på tværs af firmaer (vilkår og formål, anonymiseringsgrænse, konkurrenceret, forretningskonflikt), indlæsning af tidligere fakturaer, tilbudsrykkeren (D22). Ny J-række: kundens adresse og opgavetekst sendes til Scaleway (som J14). Spørgsmål til advokaten: opbevaring af tilbud (J4, D89).

## Tilbagerulning

| Problem | Gør |
|---|---|
| Tilbudsdelen fejler i prod | Flaget slukkes i Railway (Deploy/Apply, tjek `/health`). |
| Salget fejler | Salgsflaget slukkes. |
| Migrationen | Tilføjer kun tabel og kolonner; bliver liggende. Rollback står i filen. |

## Efter Fase 5 — rækkefølgen (Ann 20/11)

Ann omprioriterer 20/11: processerne omkring tilbuddet og opgaveformularen uden telefon kommer før Booking. Udviklingsplanens Fase 6 (Booking) og Fase 7 (Faktura) rykker derfor. **Udviklingsplanen (Claude Doc-masteren) skal rettes, så de to planer ikke modsiger hinanden.**

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

1. **Ann og Anne — selve listen over opgavetyper** fra DB Tømrerfirma (navn og enhed pr. type). Skal ligge før spor 1's migration (trin A).
2. **Anne og advokaten:** vilkårslinjen om anonymiseret brug, før første rigtige tilbud.
3. **Anne:** PDF-layout, teksterne for "ikke accepteret", Sendt og Accepteret.
4. **Ann:** rette udviklingsplanen (Claude Doc-masteren) til den nye rækkefølge efter Fase 5.
