# Byggeplan: Skrivehjælp og SoMe med og uden kunder til salg (Fase 4, salg)

Skrevet 16/11-26 ud fra `origin/main` = `e93c197`. **Godkendt af Anne 17/11.** Navne, pris og salgsvej afgjort 17/11 (Ann), se nedenfor.
**Opdateret 19/11 (T8-chatten)** ud fra registret til og med indførslen om bestillingssiden 19/11 og T8's egen indførsel. Prod-toget nr. 2 var ved at blive sat i gang, da det her blev skrevet. Det er ikke bekræftet i prod.
Claude skriver ikke i sms-backend og rører ikke prod; filer leveres i `_til-repo\<emne>\`.

## Status 19/11

| Trin | Status |
|---|---|
| T1–T4 | **I prod** (tog 1, PR #119, 18/11). Migrationen `20261117120000_firma_moduler_kunder.sql` er kørt i prod. |
| T5 | **I prod.** Anne har godkendt mail-, skift- og bestillingsteksterne (18/11). |
| T6 | **I prod, og salget er tændt** (`SKRIVEHJAELP_SALG=true`, 18/11 kl. 09.13 UTC). Add-ons er oprettet i Frisbii live. |
| T7 | Målt på Frisbii test 18/11. **Ikke målt i live:** bestillingssiden med flaget tændt, skift mellem udgaverne, og om de fire gratis-firmaer kan komme til at betale for det, de har. Test 5 på Erikas står ikke som gjort i registret. |
| T8 | **På `staging` 19/11, godkendt af Anne, målt på `2026-11-19b`.** Kører med i tog 2. |
| Bestillingssiden | `/bestil` som eneste betalingsside, låste sider (`?pakke=`), salgsnavn, kortlogoer, velkomstmail med salgsnavn, S40 lukket. **På `staging`**, kører med i tog 2 (den anden chat). |
| Prod-tog 2 | Bærer bestillingssiden, T8, S40-rettelsen og `mail-salgsnavn`. Sat i gang 19/11 af den anden chat. **Ikke bekræftet i prod.** |

Arbejdet blev delt i to chats 18/11: `claude/overdragelse-fase4-prod.md` og `claude/overdragelse-fase4-t8-generel.md` i projektet. T8-overdragelsen har en statusdel øverst fra 19/11.

## Beslutninger (Ann 16/11, opdateret 19/11)

| | Skrivehjælp og SoMe med kunder | Skrivehjælp og SoMe uden kunder |
|---|---|---|
| Handle i Frisbii | `modul-svar-some` | `modul-svar-some-uden-kunder` |
| Pris | 200 kr./md. ekskl. moms | 200 kr./md. ekskl. moms |
| Giver modulerne | svar, facebook, **kunder** | svar, facebook |
| Appen viser | Opgaver, Kunder, Værktøjer, Profil. Kunder og opgaver kan oprettes i hånden. | Kun Værktøjer og Profil |
| Telefonnummer | nej (samme vej som Referat uden telefon) | nej |
| Navn i Din pakke | **Skrivehjælp og SoMe med kunder** | **Skrivehjælp og SoMe uden kunder** |
| Navn, køberen ser (19/11) | **Skrivehjælp og SoMe** (`salgsnavn`) | **Skrivehjælp og SoMe** (`salgsnavn`) |
| Sælges på | `/bestil` (eneste betalingsside fra tog 2) | den låste side `/bestil?pakke=svar-some-uden-kunder`; står ikke på den fulde liste |
| Målgruppe | håndværkere | små virksomheder uden for håndværket |

- Handles er endelige og kan ikke ændres i Frisbii. Navnene står kun i `frisbii-katalog.js` og kan rettes senere.
- Brandet er det samme for begge (Ann 17/11): afsender, onboarding og ikon siger fortsat Dit Digitale Kontor. Ingen brand-kode.
- **"Uden kunder" sælges til alle allerede nu (Ann 18/11).** Fag uden for håndværket kører på Håndværk-pakken, til T8 er i prod. Det var et bevidst valg, og det ophævede aftale 3 mellem de to chats.
- Har firmaet Telefonpasser, Referat (eller senere Tilbud, Faktura, Booking), har det Kunder og Opgaver i forvejen. For de nuværende kunder ændres intet: de har alle Telefonpasser.
- De fire firmaer, der fik Skrivehjælp gratis 15/11 (rækker med `kilde = 'manuel'`), beholder den (Ann 18/11).
- Frisbii (Ann 19/11): planen hedder "Dit Digitale Kontor", og begge add-ons hedder "Skrivehjælp og SoMe".

## Sådan virkede det før Fase 4 salg (målt i koden 16/11)

- **Kataloget** (`frisbii-katalog.js`): pakken `svar-some` (`modul-svar-some`) gav `["svar", "facebook"]`, `saelges: false`, `kommer: true`. `tjekKatalog` afviste et modul i to pakker.
- **Modulerne** (`moduler.js`): `MODULER = ["telefon", "referat", "tilbud", "faktura", "booking", "svar", "facebook"]`. Navnene står også i CHECK-reglen `firma_moduler_modul`. `aktiveModuler` ser kun på rækkerne og datoerne, ikke på abonnementets status. (Efter T1 er `kunder` med.)
- **Nummeret følger modulerne** (`frisbii-webhook.js`): uden `telefon` sættes `udenNummer = "A"`, der tildeles intet nummer, og kunden får `sendVelkomstUdenNummerMail(... variant "A")`.
- **Onboarding uden telefon**: `POST /onboarding/faerdig-uden-telefon` (T7d).
- **Appens faner** (`static/dashboard.html`, `aktiverFaner`): fanerne vises kun med `tilbudAktiv:true`. Værktøjer (`nav-skriv`) kun med `svar` eller `facebook`. (Efter T3 skjules Opgaver og Kunder uden "har kunder".)
- **Serveren**: "Kunder og opgaver er fundamentet og spærres ikke" (`server.js`, ved `TILBUD_AKTIV`).
- **Checkout** (`frisbii-checkout.js`): `add_ons: [{ add_on: handleForVare(m) }]`, intet beløb sendes; prisen ligger i Frisbii.

## Ændringerne

### T1 — Modulet `kunder` (migration først) ✅ i prod
- Migration: CHECK-reglen `firma_moduler_modul` udvidet med `'kunder'`.
- `moduler.js`: `MODULER` har `"kunder"`.
- `frisbii-katalog.js`: `MODUL_ADDONS.kunder` (`modul-kunder`, "Kunder og opgaver", 200 kr., `saelges: false`). Oprettes IKKE i Frisbii.

### T2 — De to pakker i kataloget ✅ i prod
- `svar-some` (med kunder): `["svar", "facebook", "kunder"]`. `svar-some-uden-kunder`: `["svar", "facebook"]`. Begge 200 kr.
- Et modul må gerne være i flere pakker; "dobbelt" på ét abonnement meldes af `modulerFraHandles` og afstemningen.

### T3 — Appen: "uden kunder" viser hverken Opgaver eller Kunder ✅ i prod
- "Har kunder" = `kunder`, `telefon`, `referat`, `tilbud`, `faktura` eller `booking` (`harKunder` i `moduler.js`, samme regel i `aktiverFaner`). Uden: start på Værktøjer.
- Serveren spærrer ikke kunder og opgaver (kan tages senere med `kraevModul`).

### T4 — Din pakke: se og skifte udgave ✅ i prod
- Skift i ét kald til Frisbii (`timing: "immediate"`). Med Telefonpasser eller Referat vises kun "med kunder" (målt i prod på Anns firma 18/11).

### T5 — Oprettelse og velkomstmail ✅ i prod
- Variant A vælger tekst efter `harKunder`. Mailen nævner Referat i begge udgaver (J8) og telefonnummeret kun med kunder. Anne har godkendt.
- Tog 2: mailen bruger `salgsnavn` ("Skrivehjælp og SoMe"), aldrig "med/uden kunder".

### T6 — Frisbii og salg ✅ i prod
- Salget styres af flaget `SKRIVEHJAELP_SALG` (fail-closed). Tændt i prod 18/11.
- Frisbii live: `modul-svar-some` og `modul-svar-some-uden-kunder` (`on_off`, 200 kr., `eligible_plans: ["ddk-basis"]`).
- Tog 2: `/bestil` bliver den eneste betalingsside. Efter toget peger hjemmesidens "Kom i gang" på `https://opgave.ditdigitalekontor.dk/bestil`, Annes `betaling.html` pensioneres, og annoncerne får de låste prod-links.

### T7 — Test
**Målt 18/11 på Frisbii test:** skiftet går igennem i ét kald begge veje; Frisbii krediterer forholdsmæssigt, så et skift koster kunden ca. 0; ingen kode 215 ved 100 % rabat. Bestillingssiden afviser begge udgaver i samme bestilling (`to_udgaver`).
**Ikke målt i live:** bestillingssiden med flaget tændt, skift mellem udgaverne, de fire gratis-firmaer. Ved første rigtige køb: læs webhook-loggen for `T8a` og `ukendte`.

### T8 — Den generelle branchepakke ✅ på staging 19/11, i tog 2
**Bygget (t8-1 til t8-6):**
- Annes `Generel_branchepakke.docx` er den fjerde pakke, `generel`: 8 situationer (`nyopgave`, `flyt`, `pris`, `status` (ny), `support` (ny), `ros`, `kvalitet`, `andet`), fagene Frisør, Revisor, Restaurant, Webshop, Fotograf, Hotel, Fitness, IT-support, Butik og Andet. Rullemenuen viser dem af sig selv.
- `sectorOf` falder tilbage til `generel` i stedet for Håndværk, også for håndværksfag uden for listen.
- Det afgørende felt kan sættes pr. situation (`afgoerendeFor`); i den generelle pakke er Annes spørgsmål 1 kravet.
- Ny opgave har én afslutning ved ja og en anden ved nej (`sit.nej` → `nyopgave_nej`) i alle fire pakker. Ved et nej bruges kun nej-svaret og "Andet", og appen skjuler de andre felter.
- "(henvis venligt)" er fjernet i Håndværk og Grøn sektor; den generelle klage er blødt op.
- Prompt-version `2026-11-19b`. Nyt målesæt `skrivehjaelp-saet-generel8.json`; anne20's 10 generelle cases har fået felter.

**Målt 19/11 på `2026-11-19b`:** "håndværk" står ikke i nogen af 37 svar; flagniveauet er uændret fra `2026-11-18`. Anne har godkendt tekster, fag og felter.

**Åbent (ikke blokerende):** de andre målesæt (fx t1b) er ikke tjekket for cases, der nu rammer den generelle pakke · "Andet" deles op ved forkortelser (fandtes før T8) · dashboardets skjul ved nej er ikke med i CI.

## Rækkefølge i prod

1. ✅ Migrationen (T1), 18/11.
2. ✅ Frisbii live add-ons (T6.4), 18/11.
3. ✅ Koden T1–T7 (tog 1, PR #119, fra den låste commit `c16bba1`), 18/11.
4. ✅ `SKRIVEHJAELP_SALG=true` i prod, 18/11 (Ann; før T8, bevidst).
5. ⏳ **Tog 2:** bestillingssiden, T8, S40-rettelsen og `mail-salgsnavn`, fra en låst `staging`-commit. Genindlæs appen efter deployet, så det nye dashboard hentes.
6. Hjemmesiden peger på `/bestil`, og `betaling.html` pensioneres (efter tog 2).

**S40:** lukket 19/11 (picomatch er væk fra audit-rapporten). Fristen 25/11 gælder ikke længere.

## Næste tog: nødbremsen (D103, besluttet 18/11)
Ann valgte vej (b): bremsen skal stoppe salget i stedet for at falde tilbage til den gamle plan, hvis pris er forkert. Ikke bygget.
- Når bremsen er trukket, svarer bestillingssiden, at der ikke kan bestilles lige nu. Anne skriver teksten.
- Derefter fjernes `FRISBII_PLAN_HANDLE` og kravet om den i `requireConfig`.
- Afklares i koden først: om bremsen fortsat er `FASE3_SYNK=false` eller får sit eget flag.
- Stadig ikke gjort: advarslen ved variablen i runbooken og i `check-env.js`.

## Skrivehjælp efter tog 2: i prod, under observation

Skrivehjælp er klar til at blive solgt, men ikke "færdig": den er kun målt på testcases. Forslag (T8-chatten 19/11) til hvornår den kan kaldes færdig:
- Anne har læst 20–30 rigtige udkast (med samtykke eller anonymiseret) og fundet dem gode nok.
- Fejl, hun finder, er lavet om til cases i et målesæt.
- Der er mindst én måling af brugen, fx udkast pr. firma pr. uge.

## Tilbagerulning
| Problem | Gør |
|---|---|
| Salget fejler | `SKRIVEHJAELP_SALG=false` i Railway (kræver ingen kode; tjek loglinjen `Skrivehjaelp-salg: SLUKKET`). |
| Appen viser forkerte faner eller Skrivehjælp fejler efter tog 2 | Railway: redeploy forrige deploy. |
| Migrationen | Bliver liggende; den udvider kun CHECK-reglen. |

## Åbne spørgsmål
- Anne: teksten til kunden, når nødbremsen er trukket (D103).
- Frisbii: afsendernavnet "Lommekontor" er låst og kræver Frisbiis support.
- Ann: hvornår T7's tre punkter måles i live (bestillingssiden med flaget, skift, gratis-firmaerne).

Afgjort 17/11 (Ann): navnene, prisen på `kunder` (200 kr.), salgsvej og brand. Afgjort 18/11: salget tændt før T8 (aftale 3 ophævet), gratis-firmaerne beholder Skrivehjælp, Anne godkendte mail-, skift- og bestillingsteksterne. Afgjort 19/11: `/bestil` er den eneste betalingsside, salgsnavnet "Skrivehjælp og SoMe", og Anne godkendte T8.

## Til tilbudsprojektet

Fase 4 salg blokerer ikke tilbudsmodulet. Når tog 2 er i prod, er Fase 4 salg bygget færdigt; det, der er tilbage, er måling i live og D103.

Det, Fase 4 har ændret i filer og regler, som tilbudsmodulet også bruger:
- `moduler.js`: modulet `kunder` findes, og `harKunder(moduler)` er reglen for, om firmaet har Kunder og Opgaver. `tilbud` tæller med i den.
- `static/dashboard.html`: `aktiverFaner` skjuler Opgaver og Kunder uden "har kunder"; Værktøjer-fanen og Skrivehjælp-formularen er ændret (nej-skjul i T8). Hent altid den friske fil fra `origin/staging` før ændringer.
- `frisbii-katalog.js`: kataloget har `salgsnavn`, `beskrivelse`, `side` og `paaListen` (bestillingssiden). Et nyt modul som Tilbud skal også have dem, hvis det skal sælges på `/bestil`.
- `/bestil` er den eneste betalingsside efter tog 2.
- Lære fra 19/11 for alle chats: `git diff --cached --name-only` skal vise præcis opgavens filer før commit (T8 kom med i bestillingssidens commit ved et uheld), og CRLF-leverancer tjekkes, som git gør (`\r\n` → `\n`).
