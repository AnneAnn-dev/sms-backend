# D16 — oprydning i miljøvariabler

*Arbejdsdokument. Oprettet 2/8-26 efter første kørsel af `afstem-railway-env.js`.
Slettes, når alle punkter er krydset af og resultatet er skrevet i drift-runbogen.*

---

## Hvad vi ved

Produktionsvariabler tastes manuelt to steder: i Railway og i `.env.prod`/`.env.staging`.
Ingen har afstemt dem. Første afstemning 2/8-26 fandt:

| | Staging | Produktion |
|---|---|---|
| Variabler i Railway (uden systemvariabler) | 26 | 24 |
| Variabler i filen | 27 | 27 |
| Afvigelser | 9 | 8 |

**Koden læser 46 forskellige navne.** Det er flere end nogen af kilderne har. Se afsnittet
"Udestående" nederst.

**Sandheden bor i Railway.** Filerne rettes til at matche — aldrig omvendt.

⚠️ **Tallene er fra målingen 2/8-26 formiddag.** Senere samme dag blev
`OPKALD_SIGNATUR=haandhaev` sat i prod-Railway, så prod har nu 25 variabler og én
afvigelse mere end tabellen viser. **Kør afstemningen igen som allerførste skridt**,
så du arbejder ud fra friske tal og ikke fra dette dokument:

```powershell
node afstem-railway-env.js --environment staging --file .env.staging
node afstem-railway-env.js --environment production --file .env.prod
```

---

## Fire regler, der gælder hele vejen

1. **Staging helt færdig først. Derefter produktion.** Aldrig i samme runde.
   Fejl opdaget i staging koster ingenting.
2. **Ændringer i Railway udløser en deploy.** Railway samler dem som afventende
   ændringer, du skal godkende. Hver runde ender altså med en ny deploy — og
   variablerne følger med den deploy, hvis du senere ruller tilbage. Se runbogens
   rollback-afsnit, punkt 2.
3. **Rediger kun master-filerne** `.env.staging` og `.env.prod`. Aldrig `.env` direkte.
   Efter redigering køres `.\skift-staging.ps1` eller `.\skift-prod.ps1`, som kopierer
   master over i `.env`.
4. **Værdier må aldrig ud af de tre steder, de hører hjemme:** Railway-dashboardet,
   master-filen, og din adgangskodemanager. Ikke i terminalen, ikke i en chat, ikke
   i en commit. Afstemningsscriptet er bygget til at kunne deles — det viser kun navne.

---

## Trin 0 — sikkerhedskopi, før du rører noget (5 min)

`.env.prod` og `.env.staging` er git-ignorerede. Det betyder også, at der **ikke findes
en tidligere version at fortryde tilbage til.** Tag en kopi først.

```powershell
Copy-Item .env.staging ".env.staging.bak-2026-08-02"
Copy-Item .env.prod ".env.prod.bak-2026-08-02"
```

⚠️ **Tjek derefter, at kopierne også er git-ignorerede.** Hedder mønstret i `.gitignore`
`.env.prod` præcist, er `.env.prod.bak-2026-08-02` IKKE dækket — og så ligger dine
produktionsnøgler og venter på næste `git add .`:

```powershell
git check-ignore -v .env.staging.bak-2026-08-02 .env.prod.bak-2026-08-02
```

- Skriver den to linjer med en regel: kopierne er ignoreret. Fortsæt.
- **Skriver den ingenting: STOP.** Tilføj `.env*.bak-*` til `.gitignore` og kør igen.

Gitleaks som pre-commit-vagt ville formentlig fange det alligevel, men to spærringer er
bedre end én, og vagten er ikke afprøvet på netop dette.

- [ ] Kopier taget
- [ ] `git check-ignore` bekræfter at begge er ignoreret

**Slet kopierne igen**, når hele oprydningen er verificeret. En efterladt kopi af
produktionsnøgler er selv en risiko.

---

## Trin 1 — tre beslutninger, før du taster (10 min)

Tre af afvigelserne er ikke fejl, der skal rettes, men spørgsmål, der skal besvares.
Gæt ikke. Skriv svaret i kolonnen, og skriv begrundelsen ind under.

| Spørgsmål | Dit svar |
|---|---|
| **`MAIL_OVERRIDE_TO`** findes i begge filer, men ikke i Railway. Er det en bevidst lokal sikkerhedsventil, der omdirigerer mails, så lokale kørsler ikke rammer rigtige modtagere? | |
| ~~**`OPKALD_SIGNATUR`** findes kun i Railway staging — skal den i prod?~~ | **BESVARET 2/8-26: ja.** `OPKALD_SIGNATUR=haandhaev` er oprettet og deployet i prod, og staging står samme sted. Begge Railway-miljøer er enige. **Tilbage: variablen mangler i BEGGE filer** — se 2c og 3c |
| **`FRISBII_PRIVATE_KEY`** afviger i staging, men er ens i prod. Blev prod roteret uden staging, eller omvendt? Tjek `HAENDELSESLOG.md` for nøglerotationen. | |

**Er `MAIL_OVERRIDE_TO` en sikkerhedsventil:** så er fraværet i Railway **korrekt**, og den
skal blive i filerne. Skriv det som en bevidst forskel her i dokumentet og senere i
runbogen — ellers "retter" nogen den om tre måneder, og så går der prod-mails ud fra en
lokal kørsel.

- [ ] Alle tre spørgsmål besvaret

---

## Trin 2 — staging (30 min)

Arbejd i denne rækkefølge. Kryds af undervejs.

### 2a. Ret defekten: `admin_email` → `ADMIN_EMAIL`

Koden læser `ADMIN_EMAIL`. Begge filer staver `admin_email`. Miljøvariabler er
versalfølsomme, så lokalt får koden `undefined` — uden fejlmeddelelse.

- [ ] I `.env.staging`: slet linjen `admin_email=...`
- [ ] I `.env.staging`: tilføj `ADMIN_EMAIL=` med værdien fra Railway staging

### 2b. Ret de afvigende værdier (fil ← Railway)

- [ ] `ELEVENLABS_VOICE_IDM` — kopiér Railways værdi ind i `.env.staging`
- [ ] `FRISBII_PRIVATE_KEY` — først når trin 1 er besvaret

### 2c. Tilføj det, der mangler i filen (fil ← Railway)

- [ ] `TILBUD_AKTIV`
- [ ] `OPKALD_SIGNATUR` — **skal med.** Værdien i Railway staging er `haandhaev`.
      Mangler den i filen, får en lokal kørsel `undefined`, og koden falder tilbage
      til standarden `log` — altså en anden opførsel end den, appen kører med

### 2d. Tilføj det, der mangler i Railway (Railway ← fil)

Alle fire læses af koden. Appen i skyen får `undefined` for dem i dag.

- [ ] `SIMPLY_ACCOUNT`
- [ ] `TWILIO_ADDRESS_SID`
- [ ] `VOICE_URL`
- [ ] `MAIL_OVERRIDE_TO` — **kun** hvis trin 1 siger, den hører til i skyen

Tilføj dem i Railway → Variables → gennemgå de afventende ændringer → deploy.

### 2e. Verificér

```powershell
node afstem-railway-env.js --environment staging --file .env.staging
.\skift-staging.ps1
npm run smoke
```

- [ ] Afstemningen viser **0 afvigelser** (bortset fra bevidste, noteret i trin 1)
- [ ] `npm run smoke` er grøn
- [ ] Deployen i Railway er ACTIVE

**Er smoke rød:** en af de fire nye variabler i Railway har en forkert værdi, eller
deployen fejlede. Rul tilbage efter runbogens rollback-afsnit og find fejlen. Det er
netop derfor, staging kommer først.

---

## Trin 3 — produktion (30 min)

**Kun når trin 2 er helt afsluttet og smoke har været grøn.** Ikke sidst på en lang dag.

Samme rækkefølge som trin 2, med `.env.prod` og `--environment production`. Forskelle:

- `FRISBII_PRIVATE_KEY` afviger ikke i prod — spring 2b's andet punkt over
- `OPKALD_SIGNATUR` findes nu i BEGGE Railway-miljøer (`haandhaev`, sat 2/8-26). Den skal kun tilføjes i filen
- `MAIL_OVERRIDE_TO` — afhænger af trin 1

- [ ] 3a. `admin_email` → `ADMIN_EMAIL` i `.env.prod`
- [ ] 3b. `ELEVENLABS_VOICE_IDM` rettet i `.env.prod`
- [ ] 3c. `TILBUD_AKTIV` tilføjet i `.env.prod`
- [ ] 3c-2. `OPKALD_SIGNATUR=haandhaev` tilføjet i `.env.prod` (findes i Railway prod
      siden 2/8-26, men ikke i filen)
- [ ] 3d. `SIMPLY_ACCOUNT`, `TWILIO_ADDRESS_SID`, `VOICE_URL` tilføjet i Railway production
- [ ] 3e. Afventende ændringer gennemgået og deployet
- [ ] 3f. `node afstem-railway-env.js --environment production --file .env.prod` viser 0
- [ ] 3g. `.\skift-prod.ps1` og `npm run smoke` er grøn
- [ ] 3h. Slet `.env.staging.bak-*` og `.env.prod.bak-*`

---

## Trin 4 — efterkontrol af stemmefilerne (15 min)

`ELEVENLABS_VOICE_IDM` afveg i **begge** miljøer. Den lokale værdi har været forkert i
ukendt tid, og regenereringsscriptet læser `.env`.

**Det er den samme fejl som tidligere: lydfiler ude af sync med stemme-ID'erne.**

- [ ] Tjek om de mandlige greeting-filer i Supabase Storage er renderet med det ID,
      der nu står i Railway
- [ ] Er de ikke: genrender med regenereringsscriptet, efter `.env` er rettet
- [ ] Afspil én fil og lyt

---

## Trin 4b — hænger sammen med signaturhåndhævelsen

`OPKALD_SIGNATUR=haandhaev` blev sat i prod 2/8-26, men **verifikationen mangler**:
et falsk kald skal afvises med 403 i produktion. Se runbogens udestående punkt 24,
trin 3. Det hører ikke til denne oprydning, men det står uafklaret samtidig — og
begge dele rører den samme variabel.

- [ ] Punkt 24 trin 3 er enten gennemført eller bevidst udskudt, før filerne rettes

## Trin 5 — skriv resultatet ned (10 min)

- [ ] Antal afvigelser før og efter, pr. miljø, skrevet i drift-runbogen
- [ ] Bevidste forskelle (fx `MAIL_OVERRIDE_TO`) noteret med begrundelse
- [ ] Ændringslogslinje i `RISIKOREGISTER.md`
- [ ] D16 opdateret i registret
- [ ] Dette dokument slettet

**Ny rutine til runbogen:** kør `afstem-railway-env.js` mod begge miljøer **før hver
produktionsdeploy, der rører variabler**, og som fast punkt i den kvartalsvise runde
sammen med rollback- og gendannelsesøvelsen. To målinger på række gør det synligt, hvis
kilderne begynder at glide fra hinanden igen.

---

## Udestående — ikke en del af denne oprydning

Skriv dem i registret, tag dem en anden dag.

1. **17 navne, koden læser, findes ingen steder.** Koden slår 46 navne op; prod-Railway
   og `.env.prod` har tilsammen 29. Mange har formentlig en standardværdi i koden
   (`SCW_REGION`, `APP_NAME`, `DRY_RUN`), men det er ikke verificeret. Nogle af dem kan
   være tavse fejl, ingen har set. **Dette er større end de otte afvigelser.**
2. **Railway staging og Railway produktion er ikke ens indbyrdes.** 26 mod 24 variabler.
   Forskellene er opstået, ikke besluttet. Kræver en tredje sammenligning.
3. **`SHOPIFY_WEBHOOK_SECRET` læses af koden.** Betalingen kører via Frisbii/MobilePay.
   Formentlig død kode fra en tidligere integration.
4. **Generering af `.env.prod` fra Railway.** Målet er, at filen ikke længere tastes.
   Kræver et nyt script, der **skriver til disk** — en anden og farligere slags end
   afstemningsscriptet. Bygges først, når afvigelserne er ryddet, for ellers overskriver
   generatoren det, der kun findes i filen.
5. **Railway CLI er på 4.61.1**, nyeste er v5.x. Kommandonavnene er ændret
   (`railway variables` → `railway variable list`). Opgradering er en bevidst opgave,
   ikke noget der sker undervejs — `afstem-railway-env.js` skal testes bagefter.
