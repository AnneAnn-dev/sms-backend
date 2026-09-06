# Samlet tilretning af onboardingflowet — følgenotat

Skrevet 5. september 2026. Ni punkter, seks filer, ét deploy. Filerne ligger
færdige i `~/claude-arbejdstrae` og er komplette — ikke diffs.

| Fil | Punkter |
|---|---|
| `frisbii-webhook.js` | `owner_phone` (nyt) |
| `static/onboarding.html` | D46 · D39 · P7 + D48 |
| `static/dashboard.html` | D45 |
| `onboarding-link.js` | versalfølsomhed + bortkastet `error` (nyt) |
| `provision-test-firm.js` | e-mail normaliseres ved skrivning |
| `supabase/migrations/20260905140000_firms_email_lowercase.sql` | datafixet (ny fil) |

---

## 1. `owner_phone` kom aldrig med — nyt punkt

`provisionFirm()` indsatte firmaet uden `owner_phone`, selv om
`/checkout/start` indsamler nummeret og sender det til Frisbii som
`create_customer.phone`. Feltet stod derfor tomt for **hver eneste**
Frisbii-kunde.

Konsekvensen sad på onboardingens side 1, som vælger variant på
`if (state.ownerPhone)`. Bekræftelses-varianten *"Er det dit nummer?"* kunne
aldrig vises. Den er reelt død kode og har kun været set med
`provision-test-firm.js --phone` — altså kun i test, aldrig hos en kunde.

Nummeret hentes nu hjem, normaliseres til E.164 med `normalizePhone`, og
godtages kun som `+45` + otte cifre (`danskMobil()`). Frisbii-feltet er frit
tekst og valgfrit, så der kan stå hvad som helst i det. Er det tomt eller ikke
et dansk mobilnummer, sættes feltet **ikke** — så spørger onboardingen præcis
som før. Et gæt ville være værre end et tomt felt: kunden bekræfter jo bare.

Loggen siger nu hvad der skete, maskeret via `maskerTlf`.

## 2. D46 — tastefejl i e-mailen

Kvitteringen nævner adressen. `textContent`, ikke `innerHTML` — adressen er
brugerinput. Svaret fra backenden er uændret generisk, så anti-enumeringen er
urørt.

**Bemærk hvad rettelsen faktisk køber:** adressen stod der allerede, i feltet
ovenfor. Det, den flytter, er øjet — ingen genlæser et felt, de lige har
udfyldt. Registret beskriver punktet som "usynlig", og det er en anelse for
stærkt. Rettelsen er stadig rigtig.

## 3. D39 — timeout-beskeden

Nævner nu viderestillingen først, med kundens egen `**61*<nr>#`-kode og
kontrolkoden `*#61#`, så han selv kan se om den er aktiv. Årsagerne står i
sandsynlighedsrækkefølge.

Den *anden* kendte årsag — browseren mistede svaret, mens telefonen ringede —
nævnes bevidst ikke: den er rettet i koden samme dag, og en fejlbesked skal
give kunden noget at **gøre**.

## 4. P7 + D48 — `s-expired` fik en tilstandstabel

Ikke fire tekstrettelser. Skærmen dækker nu fire situationer, og tidligere
blev overskrift, brødtekst og knap sat i hånden tre forskellige steder — den
situation, der ikke havde sit eget sæt, arvede "Linket er udløbet".

`ADGANGSTEKSTER` holder de tre tekster samlet pr. tilstand, og
`visAdgangsskaerm()` er eneste vej ind. Der findes ikke længere en vej til at
sætte to ud af tre. `velkomstTilstand` er væk — den var den første lappe på
samme problem.

| Tilstand | Hvornår | Overskrift |
|---|---|---|
| `udloebet` | token i URL'en, men `verifyOtp` sagde nej | Linket er udløbet |
| `appFoersteAabning` | intet token, kører som app | Velkommen |
| `safari` | intet token, kører i en browser | Log ind her |
| `kontoMangler` | login virkede, `/api/mig` fandt intet firma | Vi mangler din konto |

`safari` er D48: kunden følger produktets **egen** anvisning — kopiér
adressen, åbn i Safari — og blev mødt af "Linket er udløbet" for noget, han
ikke havde gjort.

⚠️ **Tabellen er flyttet op over `init()` med vilje.** `const` ligger i
temporal dead zone indtil linjen er kørt. `init()` kaldes i dag på filens
sidste linje, så det ville gå godt — men flytter nogen det kald, kaster
`init()`, `catch` viser adgangsskærmen, og **hver kunde med gyldigt login ser
"Linket er udløbet".** Det er 17/7-regressionen én gang til. Den mulighed er
fjernet frem for dokumenteret.

## 5. D45 — `dashboard.html`

`mm || ns` → `display-mode` som grundsignal, `navigator.standalone` som
bekræftelse på iOS. Samme rettelse som i `onboarding.html` 5/9. Prisen er den
samme og lige så bevidst: på iOS under 17 udebliver app-hilsenen. En manglende
hilsen er harmløs; en hilsen til en, der ikke har appen, er en løgn.

## 6. Versalfølsomheden — nyt punkt

`.eq()` bliver til `=` i Postgres, og inputtet er lowercased. En række skrevet
med stort rammes aldrig.

**Eksponeringen er smallere, end overleveringen sagde:** `frisbii-webhook.js`
lowercaser selv (linje 307), så en almindelig kunde er ikke ramt. Det er
testfirmaer fra `provision-test-firm.js` (indsatte `--email` ordret) og
manuelt oprettede rækker.

Rettelsen sidder hos **skriverne**, ikke i opslaget: `provision-test-firm.js`
normaliserer nu, migrationen retter de rækker der findes, og `.eq()` bliver
stående.

> **Fravalgt: `.ilike()`.** Den ville være versal-uafhængig uden datafix, men
> `_` og `%` er wildcards i ILIKE — `ann_b@x.dk` ville også matche
> `annXb@x.dk` — og korrekt escaping gennem PostgREST er ny query-semantik på
> login-redningsvejen. To dage før go-live er det ikke en byttehandel værd.

**Den værre halvdel var `error`**, som blev kastet væk i destruktureringen.
Fejlede opslaget — RLS, netværk, skema-cache — så det ud *præcis* som "ukendt
email": ingen mail, generisk svar, og en loglinje der påstod noget forkert.
Kunden får stadig det generiske svar; loggen siger nu sandheden.

---

## Bevidst ikke rørt

- **S16** (`trust proxy` frem for `x-forwarded-for`). Vi var i filen. Registret
  udskød den bevidst 13/8, fordi `trust proxy` ændrer adfærd globalt på et
  system i drift, og fordi der ikke er noget hul. Det gælder stadig.
- **S12's kendte dublet** — `onboarding-link.js` er ikke lagt om til
  `ratelimit.js`. Egen commit, røgtest imellem. Vi var i filen og lod den
  ligge; det er et valg, ikke en forglemmelse.
- **Tastefejls-tjek på e-maildomæner** (`gmial.com`, `.dj`). Tilbudt, ikke
  bestilt. Ca. 15 linjer, rører ikke backenden.
- **Unique-constraint på `lower(email)`.** Dubletter er et kendt åbent punkt,
  og en constraint, der kan fejle på eksisterende data, hører ikke til nu.

## Om `sw.js`-bumpet

Både D46 og D39 siger *"husk `sw.js`-bump"*. Det er ikke rigtigt for
`onboarding.html`: siden service workeren blev omskrevet til allowlist 13/7,
rører den kun `/dashboard` — `/onboarding` går udenom. Primeren siger det
samme. `dashboard.html` er network-first og slår igennem ved første
genindlæsning uanset.

Bumpet skader ikke. Men et ritual, der står som et krav, bliver en dag brugt
som forklaring på, hvorfor noget ikke slog igennem. Registret bør rettes.

## Hvad der er efterprøvet — og hvad der ikke er

**Kørt:**

- `node --check` på alle tre `.js`-filer
- inline-scripts i begge HTML-filer syntakstjekket (`new vm.Script`)
- **fuldt id-tjek** (`getElementById`/`setText` ↔ `id=`) på begge HTML-filer,
  QA-reglen fra 17/7. Resultatet er **identisk før og efter**: de fire
  "manglende" id'er (`d`, `page-`, `nav-`, `js-fejl-overlay`) er dynamisk
  byggede id'er og et element, der oprettes af script. Ingen nye indført
- alle fire tilstande i `ADGANGSTEKSTER` har titel, brødtekst, knap og
  `koderSpor`, og ingen er tom
- rækkefølgen tabel → `init()` → `init()`-kaldet efterprøvet i filen

**Ikke kørt — og det er det vigtige afsnit:**

1. **`owner_phone` ende-til-ende.** Ingen betaling er gennemført med den nye
   kode. Test i staging: gennemfør et checkout **med** telefonnummer, og se at
   side 1 siger "Er det dit nummer?" med det rigtige nummer. Og ét **uden**
   nummer — den skal stadig spørge.
2. **De fire tilstande på en rigtig telefon.** Især `safari`: kopiér adressen
   fra den indbyggede browser, indsæt i Safari, og se at der står "Log ind
   her" og ikke "Linket er udløbet".
3. **D45 i den installerede app.** Måles sammen med `/proev` — se
   `2026-09-05-smagsproeve-start-url.md`. App-hilsenen kan ikke bruges som
   bevis, netop fordi den fyrede på `mm || ns`.
4. **Migrationen** er ikke kørt nogen steder. Kør dubletsøgningen i toppen af
   filen først. Foretrækker du at holde migrationshovedbogen ren, så lav filen
   med `npx supabase migration new firms_email_lowercase` og indsæt kroppen —
   navnet her er valgt, ikke genereret.

**D47 hører ikke til her**, men den er H/H og underminerer kodesporet, som er
hovedvejen ind i den installerede app. Den kræver ingen kode, kun en måling:
sammenlign Railways afsendelsestidspunkt med Scaleways leveringstidspunkt for
de to mails fra 15:24 og 15:25. Den bør tages inden mandag.
