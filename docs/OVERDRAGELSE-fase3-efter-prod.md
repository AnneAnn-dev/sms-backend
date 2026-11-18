# Overdragelse: Fase 3 efter prod (pr. 17/11-26)

*Skrevet af Fase 3-chatten 17/11-26, lagt i repoet 18/11-26. Den næste chat, der tager Fase 3, starter her. Registret (`docs/RISIKOREGISTER.md`) er facit; står der noget andet her, gælder registret.*

**Status kort:** Fase 3 (betaling og pakker i Frisbii, T1–T9) er i prod siden 2/11 med `FASE3_SYNK=true`. Første pilot (`sub-0082`) kom 6/11. Det, der står tilbage, er ét tog med det, der ligger klar i staging, to små visningsfejl og fem punkter, der venter på en beslutning eller en anden chat. Intet blokerer piloterne.

## Læs først
1. Dette dokument.
2. Byggeplanen `docs/BYGGEPLAN-fase3.md`, afsnittet »Efter prod«. (Udskrift af Claude Doc'en »Fase 3 byggeplan: betaling og pakker i Frisbii«, rev 24.)
3. Registret: D25, D91, D93, D15, S37, S38, S39 og ændringsloggen 2/11–10/11.
4. `docs/pilot-drejebog.md` (piloter via `/bestil`) og runbookens F3 (natlig kontrol i begge miljøer).
5. Kan du læse projektet »tilbud«: projektnotatet `claude/fase3-d25-beslutninger.md` med alle målinger og beslutninger fra 25/10 til 8/11. De vigtigste står også nedenfor.

## Sådan ser prod ud
- **Frisbii LIVE** (`test-2-lommekontor`): `ddk-basis` (0 kr., 7 dages prøve), `modul-telefon` (500 kr.), `modul-referat` (400 kr.), alle ekskl. moms. Oprettet med `opret-frisbii-produkter.js --prod`.
- **Kuponer kræver Frisbii Growth** (2.500 kr./md. + 0,95 %). Der er ingen kupon i LIVE. Rabatfeltet på `/bestil` findes og er bevist i staging (`PILOTTEST`), men en kode giver »findes ikke« i prod.
- **Piloter:** køber via `https://opgave.ditdigitalekontor.dk/bestil?moduler=telefon,referat` (eller Annes `betaling.html`). Ann sætter særpris 0 kr. på begge moduler og rykker betalingsdatoen ud i Frisbii. Pilot `sub-0082` (første betaling 11/11-2027). Anns eget firma `sub-0079`.
- **Gammel plan** (`abonnement-standard`): DB Tømrer (`sub-0071`) og Annes firma (`sub-0076`), prøve rykket til 1/11-2027, Referat som manuel række. Din pakke viser »skriv til info@…«. Bliver sådan indtil videre (Ann 8/11).
- **Natlig kontrol:** cron-servicen `natlig-frisbii` i begge miljøer (prod fra `main`, `0 3 * * *`, Restart Policy Never). Mailen har været grøn.
- **Annes sider:** `ditdigitalekontor.dk/tak/` og `/afbrudt/` (mapper med `index.html`); `SIMPLY_BASE_URL=https://ditdigitalekontor.dk`.

## Planen: T10–T16

### T10 Næste tog (S) — det eneste, der bør gøres snart
Til `main`:
- `2026-11-08-koeb-kompensation` (commit på staging): Køb i Din pakke prøver igen med `compensation_method: "none"` ved Frisbii code 215. Bevist på `sub-0146`.
- Dependabot: `dotenv` 18, gruppen #88 »produktion«, #45 »udvikling«, actions v7.
- D2 T2/T3 fra en anden chat (kunde-SMS og `/formular` flyttet ud af `server.js`/`onboarding.js`, uden ændret adfærd).
- Det, der ellers er kommet på staging siden. **Gennemgå listen før toget:** `git log origin/main..origin/staging`, `git diff --stat origin/main origin/staging`, og `... -- supabase/migrations`. Er Fase 4 flettet ind, skal den være slukket bag sit flag. Kommer der migrationer, køres de efter deployet med `push-prod.ps1` (mål med `migration list` og `db push --dry-run` først).
- Efter kl. 17 (D8). PR `main...staging`, grøn CI, merge. Bevis: ny `sw.js`-version i prod, `npm run smoke:prod` 13/13. Flet `origin/main` tilbage i staging med `-X ours`; `git diff ORIG_HEAD HEAD --stat` skal være tom.
- Sidste tog (2/11) gik fra en fast commit (`3b28cb1`) via grenen `tog/fase3-0211`, fordi staging havde uprøvede ting. Gør det samme, hvis noget på staging ikke er klar.

### T11 Din pakke: to visningsfejl (S)
- Gammel plan viser ikke »Telefonpasser – Dit nuværende abonnement«: telefonen kommer fra planen (`GAMLE_PLANER`), ikke fra et add-on, og `visning()` i `frisbii-pakke.js` tæller kun add-ons.
- Et udløbet abonnement vises som aktivt med knapper og sum. Frisbii afviser ændringerne (code 13), så kun visningen er forkert. Skal sige »Dit abonnement er udløbet«.
- Ann 8/11: vi lever med det. Med et senere tog.

### T12 Kataloget: én pakke (M) — hos Fase 4-chatten
»Kundehenvendelser og SoMe« som ét add-on til 200 kr., der giver modulrækkerne `svar` og `facebook` (samme mønster som `HELE_PAKKEN` i `modulerFraHandles`). Status »kommer snart«, til Fase 4 er klar. Overlevering givet 8/11. Kataloget bruges i checkout, Din pakke, synk/webhook, afstemning og mails.

### T13 Afstemningen udvides (M) — senere (Ann 6/11)
Særpriser (D15), dobbelte eksemplarer af samme modul og første betalingsdato; det samme i den natlige kontrol. Bevis: rød på en kendt særpris og et kendt dobbelt eksemplar i staging.

### T14 Ret e-mail (S38, M) — ikke planlagt
Bekræftelse til både gammel og ny e-mail (Supabase), og e-mailen ændres samtidig hos Frisbii (`PUT /customer/{handle}`).

### T15 MFA (S39, M) — ikke planlagt
Valgfri TOTP via Supabase. Afklar først: mistet telefon, og om MFA kræves ved følsomme handlinger.

### T16 Gammel plan → `ddk-basis` (S) — kun hvis Ann ønsker det
Planskift på samme abonnement med særpris 0 kr. på begge moduler. Opskriften måles i staging først.

**Beslutninger hos Ann og Anne:** Frisbii Growth · Frisbiis egne mails · Annes endelige velkomsttekster · sletning af `sub-0077`-firmaet i prod.

## Målinger, der vil overraske dig
- **Tilkøb straks uden for prøven** (8–9/11): en betalende kunde får kreditnota for de ubrugte dage og en ny faktura med alle moduler for resten af perioden; netto betaler hun kun det nye modul (`sub-0145`).
- **Med 100 % rabat** afviser Frisbii tilkøbet med code 215 »Compensation method not allowed« (også med `prorated_credit`). Med `none` går det igennem, men alle moduler faktureres igen uden refusion. Derfor kun som genforsøg ved 215.
- **Om særpris 0 kr. giver samme 215 er IKKE målt.**
- **En ændring straks** sletter et ventende fravalg; et tilkøb af et modul, der findes, giver et ekstra eksemplar (dobbeltbetaling). »Fortryd« må aldrig være et tilkøb (31/10).
- **D93:** en fornyelse på et abonnement uden firma forsøger at oprette et firma. I staging stoppet af T8a, fordi e-mailen havde flere firmaer. Accepteret: proceduren (opsig og vent på udløb før `delete-firma.js`) er værnet.
- **Railway** havde en netværkshændelse fra 4/11 (Railways IP-adresser blokeret af nogle netværk); byg fejlede med 504 fra GitHub. En tom commit (`git commit --allow-empty`) starter et nyt byg, når der er hul igennem.

## Måleskripter (ikke i repoet, `claude-arbejdstrae\Claude outputs\`)
- `2026-10-31-t9-maaling\maal-t9-pakke-v3.js`: status med fakturaer; fjern-straks, tilfoej (med `--komp=` og `--billing=`), opsig, genindfoer, fortryd. Kun staging, kun `ddk-basis`.
- `2026-11-08-tilkoeb-maaling\maal-uden-proeve-v2.js`: checkout-session uden prøve (`no_trial`), valgfri rabatkode.
- `2026-11-01-kupon-maaling\maal-kupon-v2.js`: `valider` må læse i prod.
- `2026-10-25-fase3-maaling\maal-frisbii-fase3-2a.js`: kun abonnementer på `abonnement-standard`.

## Arbejdsregler, der bed
- Kode: `Claude outputs\<dato-opgave>\repo\` + `NOTER.md` med base- og resultathashes. Ann kører `aflever.ps1 <opgave> -Udfoer -TilladOverskriv`, `commit-opgave.ps1 <opgave> -Tekst '…' -Udfoer` (stopper, hvis grenen ikke er `staging`) og `git push`. Tjek altid basehashes mod `origin/staging` før aflevering.
- Dokumenter: `_til-repo\<emne>\<nyt filnavn>` med base- og resultatstørrelse i bytes; bevar CRLF byte for byte; aftal teksten, før du skriver i registret eller runbooken; bed Ann køre `sync-docs.ps1` først.
- Kommandoer til Ann skrives fuldt ud, uden pladsholdere, ét trin ad gangen. Commit-beskeder i ASCII.
- Mål, gæt ikke. Ingen prod-deploy kl. 7–17. Gå direkte fra deploy til migrationer.
- Anne kan ikke åbne artefakter; giv hende Word-filer.
