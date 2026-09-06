# Testplan: den samlede onboarding-tilretning

Skrevet 5. september 2026. Dækker de ni punkter plus s-9/s-9b-teksten.
Rækkefølgen er sat efter **hvad der kan aflyse resten** — de billige tjek, der
kan vælte en antagelse, ligger først. Telefonrunden er den dyre; den tages
**én gang**, når alt andet er grønt.

**Miljø:** staging (`sms-backend-staging-908c.up.railway.app`). Prod røres
ikke i denne plan.

---

## Fase 0 — fem minutter, før noget deployes

Fire tjek. Fejler et af dem, skal planen laves om, ikke køres.

### 0.1 Returnerer Frisbii overhovedet et telefonnummer? ⚠️ Vigtigst

D49 hviler på, at `frisbiiGet("/customer/<handle>")` giver et `phone`-felt.
`/checkout/start` *sender* det som `create_customer.phone` — men at det sendes
ind, beviser ikke at det kommer ud igen. **Er feltet tomt, er hele D49-rettelsen
uvirksom**, og så er der ingen grund til at teste den bagefter.

Kør fra `sms-backend` (`.env` peger på staging):

```powershell
node tjek-frisbii-telefon.js
```

Scriptet henter de 10 nyeste firmaers `frisbii_customer`-handles fra Supabase,
spørger Frisbii om hver kunde, og siger til sidst om feltet `phone` nogensinde
kommer tilbage udfyldt. Det læser kun, og numre maskeres i udskriften.

**Kommer der 0 med telefonnummer, betyder det ikke automatisk at rettelsen er
død.** To forklaringer, som ikke kan skelnes fra terminalen:

- **(a)** Frisbii returnerer feltet fint, men ingen af *de her* kunder fik
  tastet et nummer ind ved tilmeldingen
- **(b)** Feltet kommer aldrig med ud — og så er D49 uvirksom

Afgør det ved at slå én af kunderne op i Frisbii-konsollen. Står der et nummer
dér, men ikke i scriptets svar, er det (b): nummeret skal hentes et andet sted
fra, og D49 rulles ud af ændringen. Er konsollen også tom, er det (a) — kør ét
checkout **med** telefonnummer og kør scriptet igen.

Scriptet printer i (b)-tilfældet også, hvilke felter Frisbii faktisk sendte, så
du kan se, om nummeret bare hedder noget andet.

> Vært og nøglenavn er efterprøvet mod koden: `FRISBII_API` er
> `https://api.frisbii.com/v1` (`frisbii-webhook.js` linje 46) og nøglen er
> `FRISBII_PRIVATE_KEY` (linje 59).

### 0.2 Normaliseringen — 30 sekunder

```powershell
node -e "const {normalizePhone}=require('./phone'); const d=e=>e&&/^\+45\d{8}$/.test(e)?e:null; ['+45 30 51 83 13','30518313','004530518313','+4930123456','','12345','ring til mig'].forEach(x=>console.log(JSON.stringify(x),'->',d(normalizePhone(x))))"
```

Forventet: de tre første giver `+4530518313`, resten `null`. Et `null` betyder
"onboardingen spørger", præcis som før — det er den rigtige opførsel, ikke en
fejl.

### 0.3 Er der numre i stagings pulje?

`vaelgLedigtNummer()` verificerer nu mod Twilio (D43). Er puljen tom eller
kun spøgelser, dead-letter'er provisioneringen, og checkout-testen i fase 4
kan ikke gennemføres.

```powershell
node afstem-numre.js
```

### 0.4 Dubletter før migrationen

Kør SQL'en, der står i toppen af
`supabase/migrations/20260905140000_firms_email_lowercase.sql`, i stagings
SQL-editor. Giver den rækker, så **stop** og afgør hvert tilfælde i hånden —
adresser, der kun adskiller sig ved versaler, smelter sammen bagefter.

---

## Fase 1 — udrulning til staging

1. Flyt de syv filer fra `~/claude-arbejdstrae` til `~/sms-backend`:
   `static/onboarding.html` · `static/dashboard.html` · `onboarding-link.js` ·
   `frisbii-webhook.js` · `provision-test-firm.js` ·
   `supabase/migrations/20260905140000_firms_email_lowercase.sql` ·
   `proev-app-start.js`

2. **Én linje i `server.js`**, ved de andre require-kald:

   ```js
   require("./proev-app-start")(app);
   ```

   Modulet monterer sig kun når `APPSIGNAL_APP_ENV !== "production"`, men
   **linjen skal alligevel ud igen, før prod-toget kører.** Skriv det på
   huskesedlen nu.

3. `git status` og læs diffen igennem. Forventet omfang:
   `onboarding.html` ca. +128/-34, `dashboard.html` +18/-2, `onboarding-link.js`
   +30/-1, `frisbii-webhook.js` +27/-1, `provision-test-firm.js` +5/-1. **Ser du
   hele filer som ændret, er linjeskiftene gået tabt** — filerne er CRLF, og det
   skal de blive ved med at være.

4. Commit på en gren fra `staging` og merge ind, eller commit direkte på
   `staging` som I plejer. `main` røres ikke.

5. **Ingen `sw.js`-bump.** Service workeren har kun håndteret `/dashboard`
   siden allowlist-omskrivningen 13/7, og `/onboarding` går udenom.
   `dashboard.html` er network-first og slår igennem ved første genindlæsning.
   Bump kun, hvis du ændrer `sw.js` selv.

6. Vent på Railways build, og bekræft i opstartsloggen:

   ```
   🔗 Nyt-link endpoint registreret paa /onboarding/nyt-link
   🧪 Start-URL proeve monteret paa /proev
   ```

   En manglende linje her er D23-fejlklassen: modulet er ikke monteret, ruten
   svarer 404, og intet siger fra.

## Fase 2 — røgtest

```powershell
npm run smoke
```

Forventet **11/11**. Den fanger 404-klassen og de kritiske endpoints. Er den
rød, gå ikke videre til telefonen.

## Fase 3 — migrationen

Efter 0.4 er grøn:

```powershell
.\push-staging.ps1
```

Scriptet nægter, hvis CLI-linket ikke peger på staging. Bekræft bagefter i
SQL-editoren, at `select count(*) from firms where email <> lower(email)`
giver 0.

---

## Fase 4 — telefonrunden

**Én gang, i denne rækkefølge.** Sæt en time af. Læs hele afsnittet, før du
begynder — de tre fælder nedenfor koster mere end selve testen, hvis de
rammer dig undervejs.

### Tre fælder, du skal kende først

**Cooldownen.** `/onboarding/nyt-link` har 60 sekunders cooldown **pr. e-mail
OG pr. IP**. Tester du flere skærmtilstande i træk fra samme telefon, får du
den generiske kvittering *uden* at der sendes noget — og det ligner til
forveksling en fejl. Sæt `RELINK_COOLDOWN_MS` lavt på staging under testen,
eller brug `mint-link.js`.

**Hver ny mail dræber den forrige.** Bestiller du to links, virker kun det
sidste. Bestil ét, brug det.

**Mailen kan være ti minutter undervejs (D47).** Derfor: **brug
`mint-link.js` til alt, der bare skal bruge en session.** Kun D46 kræver, at
du faktisk går gennem mailvejen.

Går der noget galt med mail: tjek `MAIL_OVERRIDE_TO` og at
`APPSIGNAL_APP_ENV` er `staging`.

### 4.1 `/proev` — først, fordi den gater D45

Åbn `<staging>/proev` i Safari. Notér mærket. Del → Føj til hjemmeskærm. Luk
Safari helt. Åbn fra ikonet.

| Aflæsning | Betydning |
|---|---|
| JA + samme mærke | `start_url` bæres igennem. Engangstoken-sporet er farbart |
| `display-mode: standalone` = **sand** | ✅ D45 og `isStandalone()` er rigtige — merge må ske |
| `display-mode: standalone` = **falsk** | ⛔ **Stop.** `mm && ns` kan ikke skelne app fra indbygget browser. Både `dashboard.html` og `onboarding.html` skal have en anden løsning — se `opskrift-D45-standalone-i-dashboardet.md`, fase 4 |

**Slet proeve-ikonet fra hjemmeskærmen bagefter**, så det ikke forveksles med
den rigtige app senere.

### 4.2 Checkout MED telefonnummer → D49

Gennemfør et rigtigt checkout på staging med testkort og **udfyldt**
telefonnummer.

- Tjek først i basen: `select name, owner_phone from firms order by id desc limit 1;`
  → skal stå som `+45XXXXXXXX`. **Står den `null`, er det fase 0.1, der svigtede.**
- Åbn linket fra velkomstmailen. **Side 1 skal sige "Er det dit nummer?"** med
  nummeret vist. Det er første gang den variant kører for en kunde.

### 4.3 Gå hele flowet igennem — s-1 til s-11

I samme session, videre fra 4.2:

- **s-2 til s-5:** som før, ingen ændringer
- **s-6 verifikation:** sæt `**61*<staging-nummer>#` og lad telefonen ringe
  ud **uden at svare**. Skal ende på s-7
- **s-8 til s-11 installationsguiden** — her ligger den nye tekst:
  - Trin 1 skal sige **"Find Del-ikonet"** med prikkerne som fallback
  - Trin 2 skal sige **"Kom der en menu frem?"**
  - Trin-tælleren skal sige **"Trin 1 af 5"** på iOS og køre til 5 af 5.
    *Ser du fire skærme og "af 5", er forgreningen forkert* (åbent punkt 2 i
    5/9-notatet)
  - Passer tegningen på trin 1 til det, du faktisk ser i Safari? Koden viser
    det kompakte `•••`-layout; dit skærmbillede 5/9 viste adressefeltet
    øverst. **Afgør det her, med telefonen i hånden**
- Installér appen fra s-11

### 4.4 Første åbning fra ikonet → tilstand `appFoersteAabning`

Luk Safari helt. Åbn appen fra ikonet.

Forventet: **"Velkommen"** + *"Skriv din e-mail, så sender vi dig en
engangskode"* + knappen **"Send mig en kode"**. Alle tre skal sige det samme.

⛔ Står der "Linket er udløbet", er tilstandsvalget forkert.

### 4.5 D39 — timeout-beskeden

Nemmest på et frisk testfirma: `node provision-test-firm.js --onboarding
--name "D39 test" --email <din+d39@…>`, gå til s-6, start testen **uden** at
sætte viderestilling.

Efter ~70 sek. skal beskeden nævne viderestillingen først, vise `**61*<nr>#`
og kontrolkoden `*#61#`.

### 4.6 D48 — Safari-tilstanden

Åbn `<staging>/onboarding` i Safari **uden** token i URL'en og uden session
(privat fane, eller ryd sitedata).

Forventet: **"Log ind her"** — *"Safari har sin egen adgang, så du skal lige
ind én gang mere."*

⛔ Står der "Linket er udløbet", er D48 ikke lukket.

### 4.7 D46 — tastefejlen

På adgangsskærmen: skriv en adresse med en bevidst fejl, fx
`ann@ditdigitalekontor.dj`. Tryk send.

Forventet: kvitteringen **nævner adressen**. Railway-loggen skal samtidig vise
`ℹ️ Nyt-link anmodet for ukendt email` med maskeret adresse.

### 4.8 P7 — kontoen mangler

Den er svær at fremkalde naturligt. Billigste vej: tag et testfirma, slet
dets `firm_users`-række i staging, og log ind med `mint-link.js`.

Forventet: **"Vi mangler din konto"** — ikke "Linket er udløbet".

### 4.9 D49 negativ + D50

- `node provision-test-firm.js --onboarding --name "Uden nummer" --email <…>`
  **uden** `--phone` → side 1 skal **spørge** om nummeret
- Samme firma: bed om et nyt login-link. Det skal virke, og loggen skal sige
  `✉️ Nyt login-link sendt til:`. Fejler opslaget nu, siger loggen det —
  `❌ Firma-opslag fejlede` — i stedet for at påstå "ukendt email"

---

## Fase 5 — dommen

Grøn hele vejen: PR fra `staging` → `main`. **Fjern `/proev`-require-linjen og
`proev-app-start.js` først.**

Rød på 4.1 (`display-mode` falsk): alt andet kan stadig gå videre, men **D45
skal rulles ud af ændringen** og `dashboard.html` leveres tilbage i sin gamle
form, indtil spørgsmålet er afgjort.

Rød på 4.2 (`owner_phone` er `null`): D49 rulles ud. Resten er uafhængigt af
den.

De øvrige punkter er tekst og tilstande — fejler et af dem, er det en rettelse
i `onboarding.html` alene og ikke en grund til at holde resten tilbage.

**Skriv udfaldet i registret**, uanset hvad. De fem punkter står som "Rettelse
bygget 5/9 — afventer deploy", og den formulering må ikke overleve testen.
