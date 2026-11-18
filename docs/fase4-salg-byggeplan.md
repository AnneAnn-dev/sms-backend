# Byggeplan: Skrivehjælp og SoMe med og uden kunder til salg (Fase 4, salg)

Skrevet 16/11-26 ud fra `origin/main` = `e93c197`. **Godkendt af Anne 17/11.** Navne, pris og salgsvej afgjort 17/11 (Ann), se nedenfor.
Claude skriver ikke i sms-backend og rører ikke prod; filer leveres i `_til-repo\<emne>\`.

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
1. Frisbii **test**: opret `modul-svar-some` og `modul-svar-some-uden-kunder`, 200 kr. ekskl. moms, sat op som `modul-referat` (samme planer under "Gælder").
2. Kode: `saelges: true` for begge pakker. Staging.
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

### T8 — Den generelle branchepakke (Annes udkast 17/11, efter T1-T6)
- Ny pakke i `prompts/skrivehjaelp-pakker.js` med Annes otte situationer og en fagliste (fx Frisør, Revisor, Restaurant, Webshop, Fotograf, Hotel, Fitness, IT, Andet).
- Tekstfelt til faktummet, hvor et valg kræver et (Ann 17/11): tid (situation 2), pris (3), status/levering (4). Uden felt finder modellen på tallet eller skriver uden om (P5).
- `sectorOf` falder tilbage til den generelle pakke i stedet for Håndværk (Ann 17/11).
- `SKRIVEHJAELP_PROMPT_VERSION` hæves, og `maal-skrivehjaelp.js` køres med et sæt på de otte eksempler.
- Skal være i prod, før "uden kunder" sælges uden for håndværket.

## Rækkefølge i prod
1. Migrationen (T1) — før koden. Peg CLI'en på prod med `npx supabase link --project-ref glymuxqtrbpeyzmflilf`, `db push`, og TILBAGE til staging med det samme (`skift-prod.ps1` flytter ikke linket).
2. Koden med `saelges: false` (T1-T5).
3. Frisbii live add-ons (T6.4).
4. `saelges: true` (T6.2) i prod.
5. Hjemmesiden.

## Tilbagerulning
| Problem | Gør |
|---|---|
| Salget fejler | `saelges: false` igen (kode) og hjemmesidens knap tilbage til "Giv mig besked". |
| Appen viser forkerte faner | Railway: redeploy forrige deploy. |
| Migrationen | Bliver liggende; den udvider kun CHECK-reglen. |

## Åbne spørgsmål
- Anne: godkender ordlyden i velkomstmailen og onboardingen (udkast 17/11), især Referat-linjen (J8).
- Anne: ordlyden i tekstfelterne i den generelle pakke.

Afgjort 17/11 (Ann): navnene, prisen på `kunder` (200 kr.), salgsvej og brand.
