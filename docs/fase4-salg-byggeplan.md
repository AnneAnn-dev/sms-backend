# Byggeplan: Skrivehjælp og SoMe med og uden kunder til salg (Fase 4, salg)

Skrevet 16/11-26 ud fra `origin/main` = `e93c197`. **Godkendt af Anne 17/11.** Navne, pris og salgsvej afgjort 17/11 (Ann), se nedenfor.
Claude skriver ikke i sms-backend og rører ikke prod; filer leveres i `_til-repo\<emne>\`.

## Status 18/11

| Trin | Status |
|---|---|
| T1–T4 | På `staging`. Migrationen er kørt på staging, **ikke i prod**. |
| T5 | På `staging`: velkomstmailen følger modulerne (`velkomstUdenNummer`, 34 prøver). Anne mangler at godkende ordlyden. |
| T6 | På `staging`: salget styres af flaget `SKRIVEHJAELP_SALG` i stedet for `saelges: true` i koden. Add-ons er oprettet i Frisbii test. Frisbii live er ikke bekræftet. |
| T7 | Skiftet er målt på Frisbii test (se T7). Test 5 på Erikas mangler. |
| T8 | Planen er godkendt (Ann 18/11). **Ikke bygget.** Bygges i sin egen chat og merges først til `staging`, når prod-toget er kørt. |
| Prod | Intet af salget er i prod. Toget kører i sin egen chat fra en låst `staging`-commit. |

Arbejdet er delt i to chats 18/11: `claude/overdragelse-fase4-prod.md` og `claude/overdragelse-fase4-t8-generel.md` i projektet.

## Beslutninger (Ann 16/11)

| | Skrivehjælp og SoMe med kunder | Skrivehjælp og SoMe uden kunder |
|---|---|---|
| Handle i Frisbii | `modul-svar-some` | `modul-svar-some-uden-kunder` |
| Pris | 200 kr./md. ekskl. moms | 200 kr./md. ekskl. moms |
| Giver modulerne | svar, facebook, **kunder** | svar, facebook |
| Appen viser | Opgaver, Kunder, Værktøjer, Profil. Kunder og opgaver kan oprettes i hånden. | Kun Værktøjer og Profil |
| Telefonnummer | nej (samme vej som Referat uden telefon) | nej |
| Navn | **Skrivehjælp og SoMe med kunder** | **Skrivehjælp og SoMe uden kunder** |
| Sælges på | ditdigitalekontor.dk | egen side hos Simply (samme brand); indtil den er bygget: ditdigitalekontor.dk |
| Målgruppe | håndværkere | små virksomheder uden for håndværket |

- Handles er endelige og kan ikke ændres i Frisbii. Navnene står kun i `frisbii-katalog.js` og kan rettes senere.
- Brandet er det samme for begge (Ann 17/11): afsender, onboarding og ikon siger fortsat Dit Digitale Kontor. Ingen brand-kode.
- **Uden kunder sælges uden for håndværket** — derfor er Annes generelle branchepakke en forudsætning for salget (T8).
- Har firmaet Telefonpasser, Referat (eller senere Tilbud, Faktura, Booking), har det Kunder og Opgaver i forvejen. For de nuværende kunder ændres intet: de har alle Telefonpasser.
- De firmaer, der fik Skrivehjælp gratis 15/11 (rækker med `kilde = 'manuel'`), beholder den. Det er ikke en del af denne plan at ændre det.

## Sådan virker det i dag (målt i koden 16/11)

- **Kataloget** (`frisbii-katalog.js`): pakken `svar-some` (`modul-svar-some`) giver `["svar", "facebook"]`, `saelges: false`, `kommer: true`. `tjekKatalog` afviser et modul i to pakker ("modulet svar er i to pakker").
- **Modulerne** (`moduler.js`): `MODULER = ["telefon", "referat", "tilbud", "faktura", "booking", "svar", "facebook"]`. Navnene står også i CHECK-reglen `firma_moduler_modul` (migrationerne `20261013120000_firma_moduler.sql` og `20261029051526_synk_frisbii_moduler.sql`). `aktiveModuler` ser kun på rækkerne og datoerne, ikke på abonnementets status.
- **Nummeret følger modulerne** (`frisbii-webhook.js` ca. linje 517-555): uden `telefon` sættes `udenNummer = "A"`, der tildeles intet nummer, og kunden får `sendVelkomstUdenNummerMail(... variant "A")`.
- **Onboarding uden telefon** findes: `POST /onboarding/faerdig-uden-telefon` (T7d) sætter status `active` uden verifikation, når `telefonTilstand(...).udenVerifikation`.
- **Appens faner** (`static/dashboard.html`, `aktiverFaner`): fanerne vises kun med `tilbudAktiv:true`. Opgaver (`nav-alle`) og Kunder (`nav-kunder`) vises altid; Værktøjer (`nav-skriv`) kun med `svar` eller `facebook`. Startfanen er `setFane('alle')`.
- **Serveren**: "Kunder og opgaver er fundamentet og spærres ikke" (`server.js`, ved `TILBUD_AKTIV`).
- **Checkout** (`frisbii-checkout.js` ca. linje 284): `add_ons: [{ add_on: handleForVare(m) }]` — intet beløb sendes. Prisen ligger altså i Frisbii (add-on'ens pris pr. plan; listen viser "kr0.00" med "Pris pr. enhed" og "Gælder: ddk-basis"). Den nye add-on sættes op som `modul-referat`.
- **Hjemmesiden** viser allerede "Kundehenvendelser og SoMe — 200 kr. — Prøv gratis". Den kan ikke gennemføres, før trin 6.

## Ændringerne

### T1 — Modulet `kunder` (migration først)
- Ny migration `supabase/migrations/<ts>_firma_moduler_kunder.sql`: CHECK-reglen `firma_moduler_modul` udvides med `'kunder'`. Ingen data røres. Kontrol og rollback i filen.
- `moduler.js`: `MODULER` får `"kunder"`.
- `frisbii-katalog.js`: `MODUL_ADDONS.kunder = { handle: "modul-kunder", navn: "Kunder og opgaver", prisOere: 20000, saelges: false }` (prisen afgjort 17/11) (kræves af `tjekKatalog`: katalog og `MODULER` skal nævne de samme). Oprettes IKKE i Frisbii.
- `proev-frisbii-katalog.js` tjekker CHECK-reglen mod `MODULER` — opdateres.

### T2 — De to pakker i kataloget
- `PAKKER["svar-some"]`: `moduler: ["svar", "facebook", "kunder"]`, navn "Skrivehjælp og SoMe med kunder", `saelges: false` (tændes i T6).
- `PAKKER["svar-some-uden-kunder"]`: handle `modul-svar-some-uden-kunder`, navn "Skrivehjælp og SoMe uden kunder", `moduler: ["svar", "facebook"]`, 20000 øre, `saelges: false`, `kommer: true`.
- `tjekKatalog`: et modul må gerne være i flere pakker. "Dobbelt" (to pakker med samme modul på ét abonnement) meldes stadig af `modulerFraHandles` og afstemningen.
- Synk og webhook kender pakkerne gennem `varer()` og `handleTilPakke` — ingen ændring, men prøverne udvides med begge handles.

### T3 — Appen: "uden kunder" viser hverken Opgaver eller Kunder
- `aktiverFaner(moduler)`: firmaet "har kunder", når `moduler` indeholder et af `kunder`, `telefon`, `referat`, `tilbud`, `faktura`, `booking`. Har det ikke: skjul `nav-alle`, `nav-kunder`, "+ Ny opgave" og opgavesøgningen, og start på `setFane('skriv')`.
- Uden `tilbudAktiv:true` ændres intet (fejler mod "som i dag").
- `sw.js` bumpes.
- Serveren spærrer IKKE kunder og opgaver i denne runde (firmaet ser kun sine egne data). Kan tages senere med `kraevModul`.

### T4 — Din pakke: se og skifte udgave
- Begge pakker vises under Din pakke. Har firmaet den ene, vises den anden som "Skift til …".
- Skift = ét kald til Frisbii, der tilføjer den nye og fjerner den gamle (`timing: "immediate"`), så kunden aldrig betaler for begge. Bygges i `frisbii-pakke.js` (`planlaeg`) med prøver. Code 215-reglen (100 % rabat) gælder også her.
- Har firmaet Telefonpasser eller Referat, vises kun "med kunder" ("uden kunder" giver intet ekstra).

### T5 — Oprettelse og velkomstmail
- Køb af kun én af de to udgaver: ingen `telefon` → intet nummer (findes), variant "A".
- Variant A vælger tekst efter, om firmaet har kunder. Reglen "har kunder" står ét sted på serveren (`harKunder(moduler)` i `moduler.js`), samme regel som `aktiverFaner` i T3. Mailen nævner pakkens navn frem for modulnavnene.
- Mailen nævner to tilkøb (Ann 17/11): Referat i begge udgaver (J8: "dine egne noter efter et møde eller en telefonsamtale" — aldrig optagelse af samtalen) og telefonnummeret kun med kunder. Claudes udkast 17/11 til Anne; Anne godkender ordlyden.
- Onboarding uden kunder: hjælpeteksten under firmanavnet bliver "Det er navnet, dine kunder kender dig under." (der er ingen opgaver).
- Tjek i den friske `mail.js`, at `firmName` escapes i variant A og B (`tilHtml`); i kopien fra 1/11 gjorde den ikke.
- Måles på staging (T7).

### T6 — Frisbii og salg (rækkefølgen er vigtig)
**Ændret 18/11 (Ann):** salget tændes med flaget `SKRIVEHJAELP_SALG=true` i Railway, ikke med `saelges: true` i koden. Begge pakker har `saelges: SKRIVEHJAELP_SALG`. Flaget er fail-closed: mangler det, sælges der ikke. Serveren logger `Skrivehjaelp-salg: TAENDT/SLUKKET` ved opstart. Add-ons oprettes med `opret-frisbii-produkter.js --vare svar-some,svar-some-uden-kunder` (og `--prod` for live) og skal være On-Off.

1. Frisbii **test**: opret `modul-svar-some` og `modul-svar-some-uden-kunder`, 200 kr. ekskl. moms, sat op som `modul-referat` (samme planer under "Gælder").
2. Flaget `SKRIVEHJAELP_SALG=true` på staging.
3. Køb på staging: med kunder alene, uden kunder alene, med kunder oven på Telefonpasser, skift uden → med og med → uden.
4. Frisbii **live**: samme to add-ons, samme handles.
5. Prod.
6. Hjemmesiden: "Prøv gratis" peger på den rigtige pakke (`?modul=svar-some` eller `svar-some-uden-kunder`, efter hvordan `/bestil` tager imod). Indtil den nye side findes, ligger begge på ditdigitalekontor.dk. Når den nye side kommer: `/tak` og `/afbrudt` følger i dag `SIMPLY_BASE_URL`, så en kunde derfra lander på ditdigitalekontor.dk efter betalingen — tages op, når siden bygges.

### T7 — Test på staging (før prod)
- Nyt firma køber kun Skrivehjælp og SoMe uden kunder: intet nummer, onboarding uden telefon, appen viser kun Værktøjer og Profil, udkast virker.
- Nyt firma køber kun Skrivehjælp og SoMe med kunder: intet nummer, Opgaver og Kunder vises, "+ Ny opgave" virker, udkast virker.
- Firma med Telefonpasser køber Skrivehjælp og SoMe med kunder: ingen ændring i telefonen, Værktøjer kommer til.
- Skift mellem udgaverne: én faktura-ændring, ingen dobbeltbetaling (læs fakturaen i Frisbii, gæt ikke).
- Afstemningen (`afstem-frisbii.js`) melder ingen uenighed.
- `kor-proever` grøn.

**Målt (18/11):**
- Skiftet går igennem i ét kald begge veje.
- Frisbii krediterer forholdsmæssigt (249,96 kr. på inv-39) og laver en ny faktura på ca. 250 kr. Et skift mellem to udgaver til samme pris koster altså kunden ca. 0.
- Ingen kode 215 på Nillis NixBix (sub-0147, 100 % rabat).
- **Hul fundet og lukket:** bestillingssiden tog imod begge udgaver i samme bestilling. Den afviser nu med `to_udgaver`.
- **Sidefund, ikke undersøgt:** efter at en kundes e-mail var rettet, gik webhooken ind i T8a-opslaget ("T8a: pilot - intet nyt firma for sub-0149").

**Mangler:** test 5 på Erikas (køb af Referat får fanerne frem; opsig-teksten). Afstemningen er ikke bekræftet kørt.

### T8 — Den generelle branchepakke (Annes udkast 17/11, efter T1-T6)
- Ny pakke i `prompts/skrivehjaelp-pakker.js` med Annes otte situationer og en fagliste (fx Frisør, Revisor, Restaurant, Webshop, Fotograf, Hotel, Fitness, IT, Andet).
- Tekstfelt til faktummet, hvor et valg kræver et (Ann 17/11): tid (situation 2), pris (3), status/levering (4). Uden felt finder modellen på tallet eller skriver uden om (P5).
- `sectorOf` falder tilbage til den generelle pakke i stedet for Håndværk (Ann 17/11).
- `SKRIVEHJAELP_PROMPT_VERSION` hæves, og `maal-skrivehjaelp.js` køres med et sæt på de otte eksempler.
- Skal være i prod, før "uden kunder" sælges uden for håndværket.

**Godkendt plan (Ann 18/11), ikke bygget.** Annes spørgsmål 1 er det afgørende felt i hver situation.

| Annes situation | id | Tekstfelt |
|---|---|---|
| 1 Forespørgsel / ny kunde | `nyopgave` | – |
| 2 Booking / ændring | `flyt` | Ny tid eller valgmuligheder |
| 3 Prisforespørgsel | `pris` | Pris eller link til prisliste |
| 4 Levering / ordre / kundeservice | `status` (ny) | Hvad kan du sige om status? |
| 5 Support / hjælp | `support` (ny) | – |
| 6 Ros | `ros` | Link til anmeldelse |
| 7 Klage | `kvalitet` | – |
| 8 Andet | `andet` | – |

- Det afgørende felt kan sættes pr. situation i pakken (`afgoerende`), fordi den generelle pakke bruger andre felter end de tre andre.
- Nye åbnings- og afslutningstekster til `status` og `support` i jeg- og vi-form (udkast; Anne retter).
- Pakkens regel: virksomheden er ikke nødvendigvis en håndværker og må aldrig kaldes det.
- Rullemenuen med brancher får de nye fag af sig selv (i dag kan kun Håndværk, Grøn og Service vælges).
- **Følge, ikke løst:** de ti cases uden for håndværk i `skrivehjaelp-saet-anne20.json` rammer den generelle pakke efter T8. Syv af dem har ingen felter og bliver afvist. Enten rettes de, eller Annes otte nye eksempler erstatter dem.

## Rækkefølge i prod
1. Migrationen (T1) — før koden. Peg CLI'en på prod med `npx supabase link --project-ref glymuxqtrbpeyzmflilf`, `db push`, og TILBAGE til staging med det samme (`skift-prod.ps1` flytter ikke linket).
2. Frisbii live add-ons (T6.4). Mål først, om de findes.
3. Koden (T1–T7) fra en låst `staging`-commit, med `SKRIVEHJAELP_SALG` fraværende eller `false` i prod. `FRISBII_PLAN_HANDLE` skal stå som `abonnement-standard` (D103).
4. T8 i prod (eget lille tog).
5. `SKRIVEHJAELP_SALG=true` i prod, efter beslutning (Ann og Anne). Tændes flaget før T8, sælges "uden kunder" til fag, der kører på Håndværk-pakken.
6. Hjemmesiden.

**Frist:** undtagelsen for `picomatch` (S40) udløber 25/11. Fra 26/11 er CI rød, og Railway deployer ikke.

## Næste tog: nødbremsen (D103, besluttet 18/11)
Ann valgte vej (b): bremsen skal stoppe salget i stedet for at falde tilbage til den gamle plan, hvis pris er forkert. Ikke bygget.
- Når bremsen er trukket, svarer bestillingssiden, at der ikke kan bestilles lige nu. Anne skriver teksten.
- Derefter fjernes `FRISBII_PLAN_HANDLE` og kravet om den i `requireConfig`.
- Afklares i koden først: om bremsen fortsat er `FASE3_SYNK=false` eller får sit eget flag.

## Tilbagerulning
| Problem | Gør |
|---|---|
| Salget fejler | `SKRIVEHJAELP_SALG=false` i Railway (kræver ingen kode; tjek loglinjen `Skrivehjaelp-salg: SLUKKET`) og hjemmesidens knap tilbage til "Giv mig besked". |
| Appen viser forkerte faner | Railway: redeploy forrige deploy. |
| Migrationen | Bliver liggende; den udvider kun CHECK-reglen. |

## Åbne spørgsmål
- Anne: godkender ordlyden i velkomstmailen og onboardingen (udkast 17/11), især Referat-linjen (J8).
- Anne: ordlyden i tekstfelterne i den generelle pakke, de nye åbnings- og afslutningstekster og fagnavnene (T8).
- Anne: teksterne i skift-boksen i Din pakke og gratis-teksten på bestillingssiden ("… – undtagen Skrivehjælp og SoMe uden kunder.").
- Anne: teksten til kunden, når nødbremsen er trukket (D103).
- Ann og Anne: hvornår `SKRIVEHJAELP_SALG` tændes i prod.
- Ann: skal de generelle cases i anne20 rettes eller erstattes (T8)?

Afgjort 17/11 (Ann): navnene, prisen på `kunder` (200 kr.), salgsvej og brand.
