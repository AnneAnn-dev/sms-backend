# Runbook: Nøglerotation

> Sidst opdateret: 2026-07-24
> Gælder: Scaleway TEM, Simply.com, VAPID, Frisbii, Supabase, Twilio — udvid med flere services efterhånden.
> Princippet er altid det samme: **opret ny nøgle → skift den ind → verificér → slet den gamle.**
> Slet ALDRIG den gamle nøgle, før den nye er bekræftet i drift i alle miljøer.

---

## Trin 0: Start ALTID her — byg arbejdslisten

Kør fra repo-roden:

```powershell
.\sammenlign-env.ps1
```

Scriptet sammenligner `.env.staging` og `.env.prod` uden at vise en eneste
værdi og deler variablerne i tre sektioner:

- **GUL (delte værdier):** samme nøgle i begge miljøer → skal roteres i
  BEGGE miljøer. Dette er din primære arbejdsliste.
- **GRØN (forskellige):** adskilte pr. miljø → kun det berørte miljø
  skal roteres.
- **BLÅ (kun i én fil):** ofte glemte tilføjelser — tjek om noget mangler
  i den anden masterfil.

Langsigtet mål: den gule sektion skal være tom (én nøgle pr. miljø overalt).

### De tre .env-filer — sådan hænger de sammen

- `.env.prod` og `.env.staging` er **masterfilerne** — sandheden for hvert miljø.
- `.env` er en **KOPI** af den aktive master, lagt dér af `skift-prod.ps1` /
  `skift-staging.ps1` (dotenv kan kun læse `.env`; den kan ikke "henvise").
- `.ENV-ER-PROD`-markørfilen viser, hvilket miljø der er aktivt.

**REGLEN: rotér altid i masterfilen, aldrig kun i `.env`.** Ændringer direkte
i `.env` overskrives ved næste miljøskifte — og så er den gamle nøgle
pludselig tilbage ("spøgelses-rotation"). Arbejdsgang: ret masterfilen →
kør skift-scriptet → `.env` følger med.

Sundhedstjek: `.env` skal være identisk med den master, markørfilen udpeger.
Afviger den fra begge masterfiler, er der redigeret direkte i `.env` —
red ændringerne over i masterfilen, før de går tabt.

---

## Generelle regler (alle services)

1. Ingen udbyder har en "rotér"-knap — rotation er altid opret/skift/slet.
2. Nye og gamle nøgler er gyldige samtidigt → rotation kan altid ske uden nedetid.
3. Inden sletning: tjek om den gamle nøgle bruges andre steder
   (kodebase, env-filer, CLI-værktøjer, Terraform, cron-jobs).
4. Rækkefølge ved miljøer: staging først, verificér, derefter production.
5. Rollback = sæt den gamle nøgle tilbage — derfor må den ikke slettes for tidligt.
6. **Verifikation = en rigtig handling gennemført, ikke en grøn status-side.**
   Konsollernes "Valid"/"Excellent"-mærkater siger noget om domæner og
   konti — ikke om din nye nøgle virker. Send mailen. Ring opkaldet.
   Log ind. En rotation er først færdig, når produktet har gjort sit.
7. **En ny nøgle kan være gyldig og alligevel magtesløs.** 401 = forkert
   nøgle. 403 = rigtig nøgle, manglende rettigheder. Læs koden, før du
   begynder at lede efter tastefejl i nøglen.

---

## Scaleway TEM

SMTP-passwordet ER secret key'en på API-nøglen, der hører til TEM-projektet.
Brugernavn = Project ID (ændres aldrig ved rotation).

### Trin

1. **Find IAM-applicationen**
   Konsol → Security & Identity → IAM → Applications.
   Nøglen skal ligge på en dedikeret application med en policy, der kun giver
   Transactional Email-rettigheder — ikke på en personlig bruger.

2. **Opret ny API-nøgle**
   Applicationen → fanen "API keys" → Generate API key.
   ⚠️ Secret key vises kun ÉN gang — gem den med det samme.

3. **🚨 TJEK POLICYEN — glemmes altid, koster 403 (se faldgruber)**
   IAM → Policies. Applicationen SKAL være principal i en policy med en
   rule, der har:
   - **scope** = det projekt, hvor mail-domænet ligger (skal matche
     `SCW_PROJECT_ID` i env — ikke "alle projekter" på må og få)
   - **permission set** = `TransactionalEmailFullAccess`

   En ny application fødes med NUL rettigheder. Kun organisationens
   Owner (= din personlige bruger) kan noget uden policy — derfor
   virkede den gamle nøgle måske uden, mens den nye ikke gør.

4. **Tjek anden brug af den gamle nøgle**
   "Last used" i IAM-konsollen + søg efter access key'en (starter med `SCW`)
   i kodebase og env-filer.

5. **Opdatér Railway — staging først**
   Skift SMTP-password-variablen til den nye secret key.
   Railway redeployer automatisk ved variabelændring.

6. **Verificér på staging — SEND EN RIGTIG MAIL**
   Udløs rescue-mailen (`/onboarding/nyt-link`) og se den lande i indbakken.
   ⚠️ Grøn domænestatus i TEM beviser INTET om nøglen — den siger kun,
   at DNS er i orden. Kun en faktisk afsendt mail dømmer rotationen.
   Tjek også Railway-loggen for `Scaleway TEM 4xx` i minutterne efter.

7. **Opdatér Railway — production** — samme fremgangsmåde, verificér igen
   med en rigtig mail.

8. **Slet den gamle nøgle** i IAM, når begge miljøer er bekræftet grønne.

### Faldgruber

- 🚨 **403 `permissions_denied` (`action: create`, `resource: email_api`)
  efter rotation** = nøglen er GYLDIG, men applicationen mangler policy
  (eller policyens projekt-scope matcher ikke `SCW_PROJECT_ID`).
  Bemærk 403 ≠ 401: 401 ville betyde forkert nøgle. Fix: trin 3.
  *(Ramt 27/7-26 — rescue-mails fejlede i BEGGE miljøer i to dage,
  fordi domænestatus var grøn og rotationen derfor virkede "færdig".)*
- **Delte creds = begge miljøer knækker samtidigt.** Scaleway er den
  bevidste undtagelse fra dedikerede-creds-princippet (jf. drift-runbook
  Del 0.D), så en fejlrotation rammer PROD med det samme — også selvom
  du kun testede staging. Verificér prod med en rigtig mail hver gang.
- Nøglerotation påvirker ALDRIG domænestatus i TEM. Rød prik på et domæne
  handler om DNS (SPF/DKIM/MX/DMARC), ikke om nøgler.
- Behold den gamle nøgle, til begge miljøer har sendt en mail med den nye.
  Så længe den lever, er rollback = sæt den gamle værdi tilbage i Railway.

---

## Simply.com (DNS-udbyder)

API-nøgler ligger i kontrolpanelet under **Kontoadministration** (sektionen
med kontonummeret S636296) → API-nøgler. Ved API-kald bruges kontonummeret
som brugernavn og API-nøglen som password.

### Strategi: ad hoc-nøgle, ingen permanent nøgle

Simply-API'et bruges KUN lejlighedsvist via `simply-dns-add.js` (tilføjer
DNS-records, som webpanelet afviser — typisk lange DKIM-værdier). Der skal
derfor IKKE ligge en permanent nøgle i .env. Rotation er erstattet af:
**opret ved behov, slet efter brug.**

En Simply-nøgle giver fuld DNS-kontrol over domænet (omdirigering, cert-
udstedelse, mail-interception) — den må aldrig ligge og flyde permanent.

### Arbejdsgang, når scriptet skal bruges

1. Kontoadministration → API-nøgler → opret ny nøgle.
2. Sæt `SIMPLY_ACCOUNT` (S636296) og `SIMPLY_API_KEY` i lokal .env.
3. Kør scriptet: `node simply-dns-add.js` (ret RECORD-blokken først).
   ⚠️ Husk fælden: record-navnet skal være RELATIVT (uden domænesuffiks).
4. Verificér at recorden svarer korrekt (fx via Scaleways DNS-tjek).
5. Slet nøglen i kontrolpanelet og fjern `SIMPLY_API_KEY` fra .env.

Tilstand pr. 2026-07-24: ingen aktiv Simply-nøgle skal eksistere.
Findes der en i kontrolpanelet uden igangværende opgave → slet den.

---

## VAPID-nøgler (Web Push, PWA-dashboard)

VAPID er et selvgenereret nøglepar — der findes INGEN udbyder-konsol.
Nøglerne eksisterer kun i .env og Railway (`VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY`). Klienten henter public key fra serveren; intet er
hardcodet. Subscription-logikken ligger inline i dashboard.html.

### Rotation

1. Generér nyt par:  `npx web-push generate-vapid-keys`
2. Opdatér begge variabler i Railway — staging først, derefter prod —
   samt i lokal .env.
3. Verificér: åbn dashboardet på staging, accepter notifikationer, og
   tjek at subscribe-kaldet lykkes uden konsolfejl.

### ⚠️ VIGTIGT når der findes aktive subscriptions

Rotation gør ALLE eksisterende push-subscriptions ugyldige — de er bundet
til den gamle public key. Brugerne skal ikke give tilladelse igen, men
deres subscription skal genoprettes ved næste besøg. Før rotation med
rigtige brugere, sørg for at:

1. Send-koden håndterer døde subscriptions (400/403/410 → slet fra DB).
2. Dashboardet ved load sammenligner eksisterende subscription med den
   aktuelle public key og genabonnerer stille, hvis de ikke matcher.

Uden punkt 2 mister eksisterende brugere notifikationer, indtil de
tilfældigt rammer subscribe-flowet igen.

Historik: roteret 2026-07-24 (eksponeret .env-historik) — dengang nul
subscriptions, så ingen migrering var nødvendig.

---

## Frisbii (billing)

Frisbii har TO hemmeligheder pr. konto — og I har én konto pr. miljø,
så alt nedenfor gøres pr. konto (staging = testkontoen, prod = prod-kontoen).

### 1. Privat API-nøgle — normal rotation

Findes i Frisbii-administrationen under udviklerindstillinger (API
credentials). Ny og gammel nøgle kan leve samtidigt:

1. Opret ny privat nøgle på kontoen.
2. Opdatér `FRISBII_PRIVATE_KEY` i Railway + masterfilen for miljøet.
3. Verificér: udløs en handling, der rammer Frisbii-API'et (fx trial-flow
   på staging), og se at den lykkes.
4. Slet den gamle nøgle i Frisbii.

### 2. Webhook-secret — ⚠️ REGENERÉR-knap, gammel dør ØJEBLIKKELIGT

Frisbii signerer webhooks med secreten; vores handler verificerer.
Regenerering dræber den gamle med det samme → et kort vindue hvor
indkommende webhooks afvises. Arkitekturen tåler det (Frisbii retrier +
idempotent handler + dead-letter), men gør det kontrolleret:

1. Vælg et stille tidspunkt (ingen igangværende checkouts).
2. Regenerér secreten i Frisbii.
3. Opdatér webhook-secret-variablen i Railway MED DET SAMME
   (+ masterfilen).
4. Efterkontrol: tjek `frisbii_webhook_events` for events omkring
   skiftet — afviste skal være retried OK eller ligge i dead-letter
   til manuel behandling.

Husk begge miljøer har hver sin secret — gentag pr. konto.

---

## Supabase (auth + database)

Supabase er et SPECIALTILFÆLDE: de gamle JWT-baserede nøgler (anon /
service_role) KAN IKKE roteres. Rotation = migrering til de nye nøgler
(sb_publishable_... / sb_secret_...), som de gamle alligevel udfases til
fordel for ved udgangen af 2026. Efter migreringen bliver fremtidig
rotation normal: secret keys kan oprettes/slettes uafhængigt, uden at
brugersessioner ryger.

Vigtigt at vide:
- **anon-nøglen er IKKE hemmelig** — den er designet til browseren og
  beskyttes af RLS. Eksponering af den er et ikke-problem.
- **service_role / sb_secret er den farlige** — bypasser al RLS og må
  aldrig nå en klient.
- Gamle og nye nøgler virker samtidigt → migrering uden nedetid.
- Kræver rimelig ny @supabase/supabase-js (verificeret OK: 2.105.4).

### STOP-tjek inden start

Lå en `SUPABASE_JWT_SECRET` (el.lign.) nogensinde i eksponeret
.env-historik? Med JWT-secreten kan man selv udstede gyldige
service_role-tokens. Hvis JA: gennemfør OGSÅ JWT signing key-migreringen
(Dashboard → Settings → JWT Keys) — ikke kun nøgleskiftet nedenfor.

### Migrering/rotation — pr. Supabase-projekt (staging først)

1. Dashboard → Settings → API Keys → fanen "API Keys" →
   "Create new API keys" → giver sb_publishable + sb_secret ("default").
2. Backend: sæt sb_secret-værdien ind i `SUPABASE_SERVICE_ROLE_KEY`
   (Railway + masterfil). Variabelnavnet beholdes — ingen kodeændring.
3. Frontend: sæt sb_publishable-værdien ind i `SUPABASE_ANON_KEY` samme
   sted — klienten får den via app-config.js fra serverens env.
4. Verificér de kritiske stier: magic link-login, rescue-link
   (generateLink i onboarding-link.js), en webhook-provisionering.
5. Deaktivér de gamle nøgler under fanen "Legacy API Keys" — det er
   dét, der reelt dræber en eksponeret service_role-nøgle.

### Fremtidig rotation (efter migreringen)

Opret en ny secret key i dashboardet → skift værdien i Railway +
masterfil → verificér → slet den gamle secret key. Ingen nedetid,
ingen sessionstab. Overvej én secret key pr. backend-komponent, hvis
setuppet vokser — så kan de roteres uafhængigt.

---

## Twilio (telefoni)

Vi bruger `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`.
SID'et er en identifikator, IKKE en hemmelighed — roteres aldrig.
Auth-tokenet er kontoens masternøgle og roteres via Twilios
sekundære-token-mekanisme (den pæneste af alle: ægte to-tokens-overlap).

⚠️ To konti = to rotationer: hovedkontoen (prod) og staging-subkontoen
har hver deres auth-token. Gentag pr. konto, i det matchende miljø.

### Trin (pr. konto)

1. Konsol → Account → API keys & tokens → Auth tokens →
   **Request a secondary token**. Begge tokens er nu gyldige.
2. Sæt det sekundære token ind i `TWILIO_AUTH_TOKEN` i Railway +
   masterfilen for miljøet. Verificér med et RIGTIGT kald:
   ring til nummeret → SMS modtages → lead lander i dashboardet.
3. **Promote** det sekundære token til primært. Det gamle dør i det
   øjeblik — men Railway kører allerede på det nye, så intet vindue.

### Noter

- Webhook-signering (X-Twilio-Signature) følger det PRIMÆRE token.
  Rækkefølgen ovenfor (Railway før promote) dækker det.
- Auth-tokenet kan ALDRIG afskaffes — selv efter evt. fremtidig
  migrering til API-nøgler bruges det til webhook-signering.
  En eksponering kræver derfor altid token-rotation, uanset hvad
  koden autentificerer med.
- Fremtidsprojekt (ikke rotation, men migrering): skift klient-init
  til API-nøgler — `twilio(apiKeySid, apiKeySecret, { accountSid })`.
  Kræver kodeændring + fuld telefoni-test. Tag den en rolig dag.

---

## Domænestatus "Invalid" i Scaleway TEM (reference)

Domænestatus handler udelukkende om DNS-records: SPF, DKIM, MX, DMARC.
Scaleway re-verificerer løbende.

- **Domænet bruges ikke længere:** bekræft at ingen kode/env-variabler sender
  fra domænet → slet domænet i TEM (⋯ → Delete) → ryd evt. tilbageværende
  TEM-mailrecords hos DNS-udbyderen. Rør IKKE A/CNAME/webforward, hvis
  domænet stadig redirecter.
- **Domænet skal stadig sende:** kopiér de fejlende records fra Scaleways
  DNS-fane og genopret dem hos DNS-udbyderen præcis som angivet. Scaleway
  re-verificerer selv, når records svarer korrekt.

Historik: lommekontor.dk blev slettet fra TEM 2026-07-24 efter rebranding —
ingen afsenderadresser brugte domænet, og DNS lå ikke hos Simply.

---

## Trin sidst: verificér at variablerne er rigtige

Efter ENHVER `.env`-redigering — og altid som afslutning på en rotation:

```powershell
node check-env.js --live
```

Scriptet gør to ting:

1. **Statisk dom:** tjekker at alle nøgler findes og har rigtigt format
   (JWT role/ref, SID starter med `AC`, osv.).
2. **Live-opslag:** spørger Supabase/Twilio/Frisbii "hvem er du?" —
   friendly name / handle SKAL svare det miljø, du tror du er i.
   (Det var dette tjek, der fangede en Twilio-401 første gang.)

Rækkefølge, så du ikke tester en forældet kopi:

1. Ret i **masterfilen** (`.env.staging` / `.env.prod`) — aldrig kun i `.env`.
2. Kør `skift-staging.ps1` / `skift-prod.ps1`, så `.env` er en frisk kopi.
3. Kør `node check-env.js --live`.
4. Kør `.\sammenlign-env.ps1` til sidst og se, at den gule sektion
   (delte værdier) er blevet mindre — eller i det mindste ikke større.

⚠️ Husk at Railway IKKE læses af scriptet. En grøn `check-env.js` beviser
kun, at de LOKALE filer er rigtige. Railway verificeres altid funktionelt
(mail sendt / opkald gennemført / login virker) — se hver services trin.

Opgaver at holde øje med (jf. drift-runbookens kodeopgave 7):
`check-env.js` bør også validere `TWILIO_SYSTEM_NUMBER`, `VOICE_URL`
og `SUPABASE_ANON_KEY`.

---

## Hurtig-tjekliste (enhver rotation)

- [ ] `.\sammenlign-env.ps1` kørt → arbejdsliste bygget (Trin 0)
- [ ] Ny nøgle oprettet
- [ ] Ny nøgle gemt sikkert (Bitwarden)
- [ ] Gammel nøgle tjekket for anden brug
- [ ] **Masterfilen** rettet (ikke kun `.env`)
- [ ] Railway opdateret i alle berørte miljøer
- [ ] `node check-env.js --live` grøn
- [ ] Funktion verificeret live (mail / opkald / login / webhook)
- [ ] Gammel nøgle slettet eller deaktiveret

---

## Rotationslog

| Dato | Service | Note |
|------|---------|------|
| 2026-07-24 | Scaleway TEM | Ny IAM-nøgle, gammel slettet. lommekontor.dk fjernet fra TEM. |
| 2026-07-24 | Simply.com | Nøgle slettet, ikke roteret — ad hoc-strategi indført. |
| 2026-07-24 | VAPID | Nyt par genereret. Nul subscriptions → ingen migrering. |
| 2026-07-24 | AppSignal | Roteret. |
| 2026-07-24 | Frisbii | API-nøgle + webhook-secret, begge konti. |
| 2026-07-24 | Supabase | Migreret til sb_publishable/sb_secret, legacy deaktiveret, begge projekter. |
| 2026-07-24 | Twilio | Auth-token roteret via sekundært token, begge konti. |
| 2026-07-27 | Scaleway TEM | ⚠️ Efterspil: 403 permissions_denied — den nye applications policy manglede. Rescue-mails fejlede i begge miljøer indtil `TransactionalEmailFullAccess` blev tilknyttet. Lærdom: verificér med en RIGTIG mail. |

Baggrund: `.env` lå i git-historikken tidligt i projektet (fjernet flere
gange, men historikken består). Repoet er privat med kun én adgang.
Nøgler er derfor roteret frem for at omskrive historik.
