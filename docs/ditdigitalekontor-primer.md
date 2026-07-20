# Dit Digitale Kontor — projekt-primer

*Indsæt denne tekst i starten af en ny tråd, så Claude hurtigt har kontekst.*

*Dette er samtidig teamets **fælles, levende dokument**: den gældende version er filen på `staging`-branchen i repoet — løse dokumenter, chatbeskeder og gamle kopier tæller ikke. Sektionerne **Produktplan** og **Design & visuel identitet** ejes af [makkerens navn]; de tekniske sektioner ejes af Anne. Redigering uden teknisk opsætning: åbn filen på GitHub i browseren → blyants-ikonet → "Propose changes".*

---

## Hvad er det

Dit Digitale Kontor (ditdigitalekontor.dk, tidligere "LommeKontor" / lommekontor.dk) er en dansk B2B SaaS-platform til håndværkere. Hver kunde får et dedikeret **+45-nummer**. Ved ubesvarede opkald afspilles en personlig stemmehilsen, kunden får en SMS med link til et opgave-indtastningsformular, og leadet lander i en håndværker-vendt PWA-dashboard.

**Roller:** Anne ejer backend, infrastruktur og al kode. [Makkerens navn] ejer produktplanen, det visuelle udtryk, kundevendt indhold og QA/røgtest — hans mockups, tekster og AI-prototyper er *spec*, som Anne implementerer (prototyper går aldrig direkte i kodebasen). Detaljeret samarbejdsmodel: se `ditdigitalekontor-drift-runbook.md` → "Partner som bidragyder".

---

## Produktplan

*Ejes af [makkerens navn]. Dette er den gældende plan — Anne og Claude tager altid afsæt her, ikke i løse dokumenter.*

### Produktvision — appens fire hovedområder

Appen udvides fra ét skærmbillede (opgavelisten) til **fire hovedområder i en bundnavigation** (et bånd i bunden af appen). Øverst i appen: **håndværkerens profil** som en lille cirkel med firmaets logo.

1. **Overblik** *(det nuværende "Opgaver" omdøbes)* — to indgange:
   - **Opgaver** — den eksisterende opgave-/lead-oversigt
   - **Kunder** — kundekartotek (nyt)
2. **Tilbud** — kæden fra samtale til afsendt tilbud:
   - Input: **tale-til-tekst** + **upload af billede**
   - **Dan referat** — kan lede videre til et tilbud
   - **Tilbud** — skrives/redigeres, også via tale-til-tekst
   - **Godkend tilbud** → dan PDF (inkl. integration til økonomisystem)
   - **Send tilbud** — inkl. valg af opfølgningsproces
3. **Opgaver** — indhold **ikke afklaret endnu** (bevidst åbent, se åbne spørgsmål)
4. **Faktura**:
   - Udarbejdelse — tale-til-tekst; integrationer til økonomisystemer; tjek om et godkendt tilbud kan konverteres direkte til faktura
   - Godkendelse
   - Afsendelse

**Den røde tråd (arkitektur-princip):** hele kæden hænger på samme anker — *opkald → opgave/lead → referat → tilbud → faktura*. Nye moduler bygges derfor **oven på det eksisterende opgave-univers** (referat/tilbud/faktura knyttes til opgaven i datamodellen), ikke som parallelle siloer. Det er sådan Annes tilbud-arbejde passer ind i det, der allerede findes.

### Arbejdsdeling lige nu

- **[Makkerens navn]:** Overblik (opgaver + kunder).
- **Anne:** Tilbud — aktuelt tale-til-tekst-referatet. Referat-PWA-prototypen (`referater-app`) er spec-reference for flowet (prototype = spec, ikke produktionskode — artifact-API'erne findes ikke i prod).

### Åbne spørgsmål (afklares før UI-tekster og datamodel låses)

- **Navne-kollision:** "Opgaver" findes både som indgang under Overblik *og* som selvstændigt hovedområde nr. 3 med uafklaret indhold. Skal område 3 hedde noget andet — eller er det dér den enkelte opgaves *udførelse* bor, mens Overblik er *listen*?
- **Økonomisystem-integration:** hvilke systemer først (e-conomic, Dinero, Billy …)? Stor beslutning — rammer både tilbuds-PDF og faktura.
- **Opfølgningsproces ved "Send tilbud":** hvilke valgmuligheder (fx automatisk påmindelses-SMS efter X dage)?
- **Profil-logo:** cirklen i toppen kræver en logo-upload-funktion (findes ikke i dag; formentlig Supabase Storage à la lead-billeder).

### Nu / Næste / Senere

**Nu (bygges/testes i denne iteration):**
- Overblik: omdøbning + de to indgange (opgaver, kunder) — [makkerens navn]
- Tilbud: tale-til-tekst-referat — Anne

**Næste (besluttet, ikke påbegyndt):**
- Bundnavigation med de fire områder + profil-cirkel i toppen
- Tilbud: resten af kæden (tilbud → godkend/PDF → send m. opfølgning)

**Senere / idébank (ikke besluttet — må ikke påbegyndes):**
- Faktura-området
- Økonomisystem-integrationer
- Indhold i hovedområde 3 ("Opgaver")

**Bevidst fravalgt (så diskussionen ikke genopstår):**
- SMS-skabeloner — fjernet, frit tekstfelt vandt (jf. *Opgave-modal*)
- Deadline + "Ønsket tidspunkt" på opgaver — fjernet fra formular og modal

### Spec-format (en feature er klar til Anne, når den har:)

1. **Problem:** hvad oplever kunden i dag? (én sætning)
2. **Flow:** skærm-for-skærm — mockup, skitse eller AI-prototype (prototyper er spec, ikke kode)
3. **Tekster:** alle kundevendte formuleringer, færdigskrevne
4. **Acceptkriterier:** "det virker, når …" — inkl. mindst ét kant-tilfælde (tilbage-knap, dobbelt-tryk, tom indtastning)
5. **Prioritet:** blokerer det launch, eller er det "Næste"?

---

## Design & visuel identitet

*Ejes af [makkerens navn]. Styrende for alt kundevendt UI — Anne implementerer, men afviger ikke herfra uden aftale.*

- **Farver:** navy `#1A3A5C` (primær — header, knapper, brand), stålblå `#2C6B9E` (sekundær — links, aktive tilstande), skovgrøn `#2E7D52` (succes — verificeret, lead modtaget), røg `#F4F7FA` (baggrund/flader).
- **Typografi:** Nunito (overskrifter), Source Sans 3 (brødtekst).
- **Navigation (besluttet):** bundbånd med fire områder — Overblik · Tilbud · Opgaver · Faktura. Profil øverst som cirkel med firmaets logo.
- **Tone of voice:** [udfyld — fx: jordnær og direkte, vi taler til håndværkere, ikke tech-folk; "du", aldrig "De"; korte sætninger i SMS'er]
- **UI-principper:** [udfyld — fx: mobil først (kunden står på et stillads); store trykflader; maks. ét valg pr. skærm i onboarding]
- **Kilde-filer:** [link til Figma/mockup-mappe, hvis den findes]

---

## Teknisk stack

- **Backend:** Node.js/Express på Railway (EU West), repo `AnneAnn-dev/sms-backend`. **To miljøer:** prod (`main`-branch, `sms-backend-production-5ee1.up.railway.app`, custom domain `opgave.ditdigitalekontor.dk`) + staging (`staging`-branch, `sms-backend-staging-908c.up.railway.app`) — egne env-vars pr. miljø.
- **Database + Auth:** Supabase **eu-west-1 (Irland — IKKE Frankfurt som tidligere angivet; verificeret 3/7)**. Prod: `glymuxqtrbpeyzmflilf` · Staging: `hehrvdmtzokzbnbihcel` (separat projekt, seedet fra prod via bestået gendannelses-øvelse). RLS på alle tabeller. **Skemaændringer KUN som versionerede migrationer** (`supabase/migrations` + CLI via `push-staging.ps1`/`push-prod.ps1` — aldrig håndredigeret SQL, aldrig rå `db push`; se runbook om link-fælden).
- **Telefoni/SMS:** Twilio — prod-numre i HOVEDKONTOEN, staging har egen **subkonto** (`ditdigitalekontor-staging`) med eget DK-testnummer (+4591309928). ⚠️ Voice-konfiguration er PR. REGION — aktiv region er **US1** (IE1-vurdering udskudt, se runbook). (46elks noteret som muligt post-launch-alternativ)
- **E-mail + storage:** Scaleway TEM (HTTP API, ikke SMTP) og Supabase Storage. **Delte creds prod/staging** (bevidst — muren er kode: `MAIL_OVERRIDE_TO` + fail-closed i mail.js).
- **TTS/stemmer:** ElevenLabs (`eleven_multilingual_v2`), delt nøgle, pre-renderet og afspillet via `<Play>`-URL. Polly-fallback (Polly.Mads/Polly.Naja) hvis ingen lydfil.
- **Billing:** Frisbii med MobilePay Recurring. **Én testkonto PR. MILJØ** (handles er permanente og autoritative — navne kan snyde, og UI'et kræver F5 efter kontoskift!): `test-2-lommekontor` = PROD (test-nøgler til go-live), `lommekontor` = STAGING, `oprettelse-og-abonnement` = ubrugt/fredet. Live-nøgler trækkes først ved go-live (kræver indløsningsaftale + MSN).
- **DNS:** Simply.com
- **Formular-domæne:** `opgave.ditdigitalekontor.dk` (skiftet fra `opgave.lommekontor.dk`, se *Status → Domæneskift*)
- **Frontend-stier:** dashboard på `/dashboard`, onboarding på `/onboarding`.
- **Overvågning:** AppSignal (EU, Amsterdam) — fejlsporing, `APPSIGNAL_APP_ENV` skelner production/staging. Se *Drift & udvikling*.

Scripts køres **lokalt fra PowerShell 5.1** i `sms-backend`-mappen (Windows/VS Code), ikke på Railway. `dotenv` indlæser `.env` — og **den lokale `.env` peger på STAGING** (besluttet 5/7): prod-værdier bor kun i Bitwarden + Railway og sættes som session-vars (`$env:...`) ved bevidste prod-kørsler. Verifikation efter enhver `.env`-ændring: `node check-env.js --live`. ⚠️ `.ps1`-scripts skal være REN ASCII (PS 5.1 fejllæser UTF-8 uden BOM) og kræver engangs `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Kerneflow

1. Indgående/ubesvaret opkald → Twilio `/opkald`-webhook
2. SMS med maskeret formular-link: `${BASE_URL}/{firma-slug}/{lead_token}` (nu `opgave.ditdigitalekontor.dk/…`) — `lead_token` er **per opkald**, genereres af `generateToken()` (./token) og gemmes på `calls`-rækken. URL'en bygges nu fra `BASE_URL` (`FORM_BASE` i onboarding.js), **ikke hårdkodet** — se *Lærte faldgruber*.
3. Kunde udfylder formular (DAWA adresse-autocomplete)
4. Lead i dashboard (modaler, status open/completed/rejected, seen_at-badges, billed-upload via signed URLs, manuel oprettelse)

**Onboarding/provisionering:** Frisbii `invoice_settled`-webhook → claimer ledigt nummer fra puljen → opretter firma → Auth-bruger (uden kode) → velkomstmail med magic link (`token_hash` + client-side `verifyOtp`, lander på `{BASE_URL}/onboarding`). I **onboarding trin 1** sætter brugeren nu en **adgangskode** (`updateUser({ password })`) mens login-link-sessionen er gyldig — det er der, kontoens kode oprettes. Lander en allerede-aktiv bruger på `/onboarding` (fx via et nyt login-link), sendes de videre til `/dashboard`.

**Verifikation (viderestillings-test):** nyt firma oprettes med `status: "onboarding"`, `verification_status: "pending"`. Onboarding trin 4 → `POST /onboarding/verificer` lægger et **udgående** Twilio-opkald fra systemnummeret (`+45 52 51 60 63`) til håndværkerens `owner_phone`. Svarer de **ikke**, viderestiller deres telefon (jf. trin 3) opkaldet til Dit Digitale Kontor-nummeret → `/opkald` ser et indgående kald med `From = owner_phone` (eller systemnummeret som sikkerhedsnet) og markerer firmaet `verified` + `active` + sender demo-SMS. Frontenden poller `/api/firma/status` (op til ~70 sek., fordi telefonen ringer 20-30 sek. før viderestilling). **Tager de telefonen**, viderestilles der ikke → TwiML'en i det udgående opkald siger derfor IKKE "det virker", men beder dem lægge på og prøve igen uden at svare; timeout-beskeden gør det samme. Derefter behandles opkald som ægte kundeopkald.

## Auth / adgangskode (bekræftet)

- Auth-brugeren oprettes **uden kode** (webhook/`createUser`). Magic link logger dem ind første gang.
- **Koden sættes i onboarding side 2 ("Adgangskode")** via `db.auth.updateUser({ password })` — ÉT felt m. Vis/Skjul-knap (gentag-feltet udgik i 16/7-redesignet), mindst 8 tegn ("Minimum 8 tegn."). Det lukker hullet: uden det får brugeren aldrig en kode og kan ikke logge ind igen, når magic-link-sessionen udløber. **NB (PWA, vigtigt):** på iPhone deler den installerede app IKKE lagring med Safari → første åbning fra hjemmeskærms-ikonet viser login-skærmen — koden fra side 2 er derfor bærende for hele installations-finalen.
- **Dashboard** logger ind med `signInWithPassword`. Login-skærmen har en redningsvej: **"Send mig et login-link"** → `POST /onboarding/nyt-link` (prefetch-sikker Scaleway-mail med **egen rescue-skabelon** `sendLoginLinkMail` fra 13/7 — ikke længere velkomstmailen; anti-enumeration; rate-limited). Linket lander på `/onboarding`, som sender aktive firmaer videre til `/dashboard#nyt-login` → dashboardet viser et lukbart puf-banner med genvej til profilsidens skift-adgangskode-felt (vises kun ved ægte link-login, og kun én gang). **Fra 17/7 indeholder rescue-mailen OGSÅ en 6-cifret engangskode** (`email_otp` fra samme `generateLink`-kald — samme engangstoken i tastbar form): efter "Send mig et login-link" viser login-skærmen et kodefelt (`autocomplete="one-time-code"` → iOS foreslår koden direkte fra Mail) → `verifyOtp({ email, token, type: 'email' })`. **Det er vejen ind i den INSTALLEREDE app**, hvor mail-linket ellers åbner i Safari (delt-lager-fælden). Bruges linket, dør koden — og omvendt. Login-felterne fik samtidig `autocomplete="email"`/`"current-password"`, så iOS-nøgleringen (delt på tværs af Safari/app) selv foreslår adgangskoden. **Kodetilstanden strammet 19/7 (Anns spec):** når der er bestilt en mail, SKJULES adgangskode-feltet og [Log ind] (koden er sporet; genindlæs nulstiller), og statustekst + "send mig et link"-knappen FLYTTES ned under kodefeltet (samme DOM-elementer — JS-referencer uændrede). Begge login-veje har onboardingens ✓-rytme: grøn ✓-knap ved korrekt kode/adgangskode, mens appen tager over. Kodefeltet er tolerant (6-10 cifre, mellemrum strippes) — længden er en Supabase-PROJEKTINDSTILLING (Auth → Sign In/Providers → Email → OTP Length); prod stod på 8, **besluttet 19/7: sættes til 6 i BEGGE projekter** (MitID-vane, lettere for målgruppen).
- **Skift adgangskode** ligger på profilsiden (`updateUser({ password })`, client-side, ingen backend).
- Edge håndteret: går man i onboarding tilbage til trin 1 og frem igen med samme kode, svarer Supabase "skal være anderledes" — den fejl ignoreres, så man ikke spærres.

## API-endpoints (bekræftet)

- `POST /api/firma/opdater` (onboarding.js:429) — `{ voice_gender, greeting_text }` + Bearer. Gemmer felterne, og hvis begge er sat, re-renderer den ElevenLabs-lyd via `renderGreeting` og gemmer den returnerede URL (med `?v=`-cache-buster) i `greeting_audio_url`. Renderingen er synkron i try/catch — fejler den, falder `/opkald` tilbage til live-TTS. Firma udledes af token (ikke body). **Fra 16/7 returnerer den `{ ok, greeting_audio_url }`** — bruges af onboardingens ▶ Lyt (afspilles m. cache-buster; frontenden re-renderer kun ved ændret tekst/stemme).
- `POST /api/firma/opdater-telefon` (onboarding.js:412) — `{ owner_phone }` + Bearer.
- `GET /api/mig` (onboarding.js:387) — Bearer; returnerer firmaet til onboarding. Henter **alle** brugerens `firm_users`-koblinger (IKKE `.single()`, som vælter ved flere rækker) og vælger ét firma robust: foretrækker det med `status: "onboarding"`, ellers det første. Selecten inkluderer `status`, så `/onboarding` viderestiller aktive firmaer til `/dashboard`.
- `GET /api/firma/status` (onboarding.js:468) — Bearer; returnerer `verification_status` + `status`. Pollet af onboarding trin 4.
- `POST /onboarding/verificer` (onboarding.js) — Bearer; lægger det udgående verifikations-opkald (system → `owner_phone`), sætter `verification_status: "pending"`. TwiML'en guider til "læg på og prøv igen uden at svare" (en besvaret opkald verificerer ikke).
- `GET/POST/DELETE /api/firma/hvidliste` — Bearer; max 20, dublet-afvisning, E.164-normalisering.
- `POST /onboarding/nyt-link` — `{ email }`; mailer et friskt login-link **+ (fra 17/7) en 6-cifret engangskode** i samme mail (`sendLoginLinkMail({ to, loginUrl, otpCode })`; koden er valgfri — mangler den, sendes mailen som før). Anti-enumeration, rate-limited. Bruges både af onboardingens expired-skærm og dashboardets login-redningsvej.
- `POST /onboarding/sidevisning` (onboarding.js, nyt 16/7) — Bearer; `{ side, sekunder }`. **Tidsmåling på onboarding-siderne:** firm_id udledes af tokenet (kan ikke spoofes), kun kendte side-navne accepteres, sekunder klippes til 0-3600, insert i `onboarding_sidevisninger`. DB-fejl er ikke-fatale (svarer altid 204 — analyse må aldrig genere kunden). Færdig analyse-SQL (kunder/gns/median pr. side) står som kommentar over endpointet.
- `POST /send-sms` (onboarding.js) — Bearer; `{ body, lead_id }`. Modtager udledes **server-side** fra leadets opkald (`calls.from_number`), aldrig fra body'en; bekræfter at opkaldet tilhører firmaet. Sender via `sendSms`-hjælperen (Twilio) fra firmaets eget nummer. **Logger derefter beskeden i `messages`** (firm_id, lead_id, to_number, body, `direction: 'outbound'`, twilio_sid) **før** den svarer 200. Lognings-fejl er **ikke** fatal — SMS'en er allerede sendt, så en 500 ville få håndværkeren til at sende igen; fejlen logges blot i konsollen.
- `/opkald` — Twilio voice-webhook (gater kun på `billing_status`).
- `/:slug/:token` → redirect til `/formular/:token` (12-tegns regex).

## Profilside (dashboard.html) — funktioner

Rækkefølge (ændret 13/7, Anns valg): profilkort → **Din telefonbesked** → hvidliste → **Skift adgangskode** → **Din viderestilling** → Log ud.

- **Din telefonbesked:** redigér stemme (Kvinde/Mand) + besked efter onboarding. Forhåndsvis afspiller en fast ElevenLabs-sample (`…/greetings/_samples/{female|male}.mp3?v=2`). Gem → `POST /api/firma/opdater` (spinner-knap; ruten re-renderer lyd, så det tager et par sek.). Nuværende værdier loades ved at hente `greeting_text, voice_gender` med i `loadData`'s select.
- **Skift adgangskode:** ny + gentag (mindst 8 tegn), `updateUser({ password })`, spinner-knap.
- **Din viderestilling (nyt 13/7):** viser firmaets dedikerede nummer (`phone_number` er føjet til loadData's firms-select — vises nu også i profilkortet, feltet var før tomt) + til-koden `**61*<nr>#` og fra-koden `##61#` med Kopiér-knapper (Clipboard-API guarded), samt `*61*`-fallback og teleselskabs-note — samme indhold som onboarding trin 3. Baggrund: Anne mistede sit nummer; det stod før KUN i onboardingen og velkomstmailen.
- **App-hilsen (16-17/7, i prod):** første gang dashboardet åbnes som installeret app (`display-mode: standalone` / `navigator.standalone`) vises én gang: grønt ✓-mærke + "Dit Digitale Kontor er klar." + [Åbn] (localStorage-flag `ddk-app-hilsen-vist`). Slutningen på onboardingens installations-rejse — den installerede app åbner i egen kontekst, så øjeblikket SKAL fanges her. Bevidst helt selvstændig blok (egen markup + eget script, alt i try/catch): kan aldrig vælte dashboardet, jf. hvid-skærm-historikken. Anne ser den én enkelt gang — ventet, ikke en fejl.

## Onboarding-flow (onboarding.html)

**Totalt redesignet 16-17/7 (Annes spec) — i prod.** Apple/MobilePay-udtryk: ro og plads, hvid flade uden kort-rammer, én besked + én handling pr. side. Navigation: 150 ms crossfade (fra ved `prefers-reduced-motion`), fem prikker øverst (opgaverne nummer → kode → stemme+besked → viderestilling → test), diskret tilbage-pil øverst t.v. (44 px trykfelt; skjult på side 1 og ✓-siderne). **✓-rytmen:** hver primærknap bliver kort grøn med ✓ (800 ms) før sideskiftet (`bekraeftOgVidere` for rene navigationsknapper; serverknapper sætter ✓ efter succes), og siden efter et gennemført trin åbner med grøn kvittering (`✓ Beskeden er klar.` / `✓ Viderestilling er aktiv.`).

**Siderne** (skærm-id ≠ visuel rækkefølge — s-4 og s-12 er nedlagt ved sammenlægninger; tidsmålingens sidenavne følger id'erne):
- **s-1 Velkommen:** "Er det dit nummer?" (19/7; indtastnings-varianten spørger "Hvad er dit nummer?") — er `owner_phone` sat, bekræftes det ([Forbind nummeret] / Skift nummer); ellers indtastning m. fast +45-prefiks (præcis 8 cifre). Gemmer via `/api/firma/opdater-telefon`.
- **s-2 Adgangskode:** ét felt m. Vis/Skjul, [Gem adgangskode] → ✓. Supabases "skal være anderledes"-fejl ved samme kode ignoreres fortsat.
- **s-3 Stemme + besked (sammenlagt):** Naja/Mads-kort (N/M-initialcirkler). Valg viser "✓ Naja/Mads valgt", og besked-sektionen (tekstfelt + ▶ Lyt + [Næste]) **glider ind** nedenunder (`.reveal`). **▶ Lyt på kortene** = fast sample (`_samples/{female|male}.mp3?v=2`); **▶ Lyt til beskeden** = gem+render via `/api/firma/opdater` og afspil returneret `greeting_audio_url` — re-render KUN ved ændret tekst/stemme (ElevenLabs-besparelse). Al lyd stoppes ved sideskift (ellers "spillede" demosætningen med over på næste side).
- **s-5 Viderestilling:** kvittering øverst, tre luftige nummererede trin, kopiér-kode `**61*<nr>#`, "Virker koden ikke?"-foldeud m. `*61*`-variant + operatør-faldback. [Jeg har gjort det] → ✓.
- **s-6 Test:** [Start testen] → `/onboarding/verificer` + poll ~70 sek. Succes: status "Klar." + grøn ✓-knap → s-7.
- **s-7 Alt virker:** kun "Fra nu af bliver ubesvarede opkald sendt videre automatisk" + [Videre]. **Nummer-boksen fjernet 17/7** (nummeret findes på profilsidens viderestillings-kort) — se regressions-lærdommen nedenfor.
- **s-8 Sidste trin:** "Læg Dit Digitale Kontor på din telefon." + [Næste] → guiden. "Åbn i browseren" = næsten usynligt ghost-link nederst.
- **s-9/s-10 Guide (trin 1-2 af 2):** platform auto-detekteres (iOS inkl. iPadOS-som-Macintosh). Trin 1 viser et **tegnet SVG-"screenshot"** (Safaris bundlinje / Chromes toplinje) m. ring + "Tryk her"-pil — SVG fremfor rigtige screenshots, så de aldrig forældes af et OS-redesign. Trin 2: "Føj til hjemmeskærm/startskærm" + rul-ned-hint + "Tryk til sidst på **Tilføj**" (iOS' reelle tredje trin). [Jeg har lagt den på min telefon] → ✓.
- **s-11 Færdig:** tro kopi af hjemmeskærms-ikonet (`/apple-touch-icon.png?v=2`; vises først onload — aldrig et knækket billede) m. label **"Dit Kontor"** (matcher manifestets `short_name` = "Dit Kontor" — verificeret 18/7; ændres labelen, SKAL manifestet følge med) + "Åbn Dit Digitale Kontor fra ikonet." Stille flugtveje: "Kan du ikke finde ikonet? Prøv igen" (→ s-9) og ghost-link til /dashboard.

**init()-hærdning (16-17/7):**
- **`token_hash` i URL'en vinder ALTID over en eksisterende session.** Rodårsagen bag "kan ikke se mit nummer" 16/7: en gammel test-session i localStorage skyggede for det nye link → siden viste det gamle/intet firma. Fejler `verifyOtp` (brugt/udløbet token), faldes tilbage til evt. eksisterende session.
- Ikke-200 eller `!data.firm` fra `/api/mig` → klar besked på expired-skærmen. ALDRIG et tomt UI.
- **`setText`-værnet (17/7-regression):** al DOM-udfyldning i `startFlow` springer manglende elementer over. Historien: nummer-boksen blev slettet på s-7, men startFlow skrev stadig til `success-number` → TypeError → init's catch viste "Linket er udløbet" for ALLE brugere med gyldigt login (og tokenet var allerede forbrugt ved første forsøg — dobbelt forvirrende). **QA-regel: fuldt id-tjek (getElementById ↔ id=) efter hvert redesign — og husk at localhost-demoen SKJULER denne fejlklasse** (rammes kun m. rigtigt login).
- **Hvidlisten er UDE af onboardingen** (kun profilsiden). Aktive firmaer redirectes fortsat til /dashboard.
- **Tidsmåling:** `goTo` + `visibilitychange(hidden)` sender (side, sekunder) via `fetch keepalive` til `POST /onboarding/sidevisning` — keepalive, fordi flowets vigtigste måling (kunden forlader Safari på s-11) ellers ville dø med fanen. Flere rækker pr. side pr. kunde er BY DESIGN (bidder ved baggrund/retur) — summér pr. (firm_id, side) i analysen.

## Opgave-modal (dashboard.html) — funktioner

Modalen for et enkelt lead ("kundens opgavebeskrivelse"):

- **Felter:** Navn, telefon, adresse (gade / by / postnr / mailadresse), beskriv opgaven, **Haster**, noter, billeder. Deadline og "Ønsket tidspunkt fra kunde" er **fjernet (reelt gjort 15/7** — stod tidligere fejlagtigt som gjort her i primeren). **Haster** persisteres ved luk fra 15/7 (`is_urgent` i `closeModal`s update — var gået tabt; toggleUrgent rørte kun UI), og haster-rækken er **én kontakt**: checkboxen er ren visning (`pointer-events:none`), labelen har ingen `for=`-kobling — ellers vippede klik på selve krydset dobbelt og virkede dødt.
- **Adresse-håndtering (14-15/7):** `parseAddress()` (postnr+by findes bagfra, tåler dubletter/tomme segmenter/supplerende bynavne) bruges af visning, sortering og modal; `closeModal` skriver **kun ved ændring** (snapshot ved åbning). DAWA på gadefeltet: adgangsadresse = gyldigt valg straks, onType nulstiller IKKE postnr/by. Se *Status → NYESTE (14-15/7)*.
- **Send SMS:** ét frit tekstfelt (placeholder "Skriv din besked her"). Skabelon-knapperne (Bekræft tidspunkt / Tilbud på vej / Skriv selv) er fjernet sammen med `setTpl`/`smsTpls`. Afsendelse → `POST /send-sms`.
- **Sendte beskeder:** historik-liste under Send SMS. `loadMessages(lead.id)` læser fra `messages` (anon-key + RLS), nyeste øverst, opdateres efter afsendelse. `escapeHtml` på beskedtekst. Tom/blokeret → "Ingen sendte beskeder endnu."
- **Ny opgave-modal:** "Hvornår passer det dig?"-feltet er fjernet (15/7, `desired_time` sendes null). Adressefeltet viser **fuld adresse** efter DAWA-valg (skjulte postnr/by-felter), og gem-vagten kræver at postnr faktisk er fanget.

## Database — nøgletabeller

- **firms:** `name`, `slug` (unik), `phone_number` (Dit Digitale Kontor-nr.; ⚠️ **ingen unique-constraint endnu** → flere firmaer kan ende med samme nummer, se *Drift & robusthed → Snart*), `twilio_number_sid`, `email`, `owner_phone`, `voice_gender` (default 'female'), `greeting_text`, `greeting_audio_url`, `status` (default 'onboarding'→'active'), `verification_status` (default 'pending'→'verified'), `billing_status` (default 'active'), `frisbii_subscription`/`frisbii_customer`, `shopify_order_id`/`stripe_customer_id` (legacy)
- **firm_users:** `firm_id`, `user_id`, `role` (default 'employee'; ejer = `'owner'`), unik (firm_id, user_id)
- **phone_numbers (pulje):** `id`, `number` (E.164), `twilio_sid` (PN…), `firm_id` (**null = ledigt**), + fra 8/7: `quarantined_until` (nummer reserveret til win-back — pool-udvælgelsen springer karantæne-numre over) og `last_firm_id` (hvem havde det; historisk spor, bevidst uden FK). Provisionering claimer ved at sætte `firm_id`. **Deprovisionering** (trin 6): betalt kunde → 30 dages karantæne (`QUARANTINE_DAYS_PAID`); prøvekunde (aldrig betalt, dømt via Frisbii-fakturaer) → frigives straks.
- **frisbii_webhook_events (idempotens + dead-letter):** `id` (webhook-id, PK), `event_id`, `event_type`, `received_at`, + fra trin 6: `processed_at` (**NULL = claimet men aldrig færdigbehandlet → genbehandles ved Frisbii-retry**) og `error` (fejlårsag). Dead-letter-listen = `where processed_at is null` — skal overvåges (cron-TODO).
- **firm_whitelist:** `firm_id`, `number`, `label` — numre der **bypasser** lead-flowet (max 20)
- **calls:** `from_number`, `to_number`, `firm_id`, `lead_token`, `status` (fx 'demo'), `raw_payload`
- **onboarding_sidevisninger (nyt 16/7, migration `20260716090000`, kørt staging+prod):** `firm_id` (FK → firms, on delete set null — så testoprydning ikke blokeres), `side`, `sekunder` (numeric, check 0-3600), `oprettet`. RLS slået til UDEN policies: kun service role kan læse/skrive; skrives udelukkende af `/onboarding/sidevisning`. Én række pr. "ophold" på en side — summér pr. (firm_id, side).
- **messages:** `firm_id`, `lead_id`, `to_number`, `body`, `direction` (default 'outbound'), `twilio_sid`, `created_at`. Log over sendte SMS'er, så håndværkeren kan se historik pr. opgave. Skrives **kun server-side** af `/send-sms` via service-rollen (omgår RLS). RLS: **kun en SELECT-policy** for firma-medlemmer (`firm_users`-opslag på `firm_id`) — ingen insert/update/delete-policy, så klienten ikke kan fabrikere "sendte" beskeder.

## Arkitektur-noter (bekræftet)

- **`/opkald` gater KUN på `billing_status !== "active"`.** Hverken `status` eller `verification_status` blokerer et opkald.
- **Nummer-pulje-mønster:** `buy-numbers.js`/`configure-number.js` lægger numre i `phone_numbers` med `firm_id: null`. Provisionering claimer ved at sætte `firm_id`. Systemnummeret må **aldrig** i puljen (guards i begge scripts; matcher `TWILIO_SYSTEM_NUMBER`).
- **Frigør et nummer:** `update phone_numbers set firm_id = null where number = '+45…';` (typisk efter en testkørsel, så nummeret kan genbruges). `firm_id = null` er nok — provisioneringen claimer kun på `firm_id`. Rammer den 0 rækker, er det næsten altid format-mismatch → find med `where number like '%…%'` og frigør på `id`. Frigør **kun** numre som intet aktivt firma har i `firms.phone_number`, ellers kan to firmaer få samme nummer. Helt ud af puljen = `delete` + frigiv/luk i Twilio-konsollen (ellers betales der videre).
- **Fuld oprydning af testdata** (alt er pt. testdata, ingen ægte firmaer): slet i FK-rækkefølge → `lead_images` → `leads` → `calls` → `firm_whitelist` → `firm_users`, derefter `update phone_numbers set firm_id = null;` (frigør alle numre, beholder pulje-rækkerne), så `delete from firms;`. Auth-brugere ryddes separat (Supabase → Authentication → Users, eller `reset-test-data.js`). **Systemnummeret er aldrig i puljen**, så det røres ikke.
- **Hilsen / tts.js:** `greeting_audio_url` er valgfri — er den null, bruger `/opkald` live Polly-TTS med `greeting_text`. `renderGreeting(supabase, {firmId, text, voiceGender})` skriver til **fast sti** `<firmId>/<voiceGender>.mp3` (upsert/overskriv), men returnerer en URL med `?v=<timestamp>` cache-buster — så Twilio/CDN ikke serverer gammel lyd. `/api/firma/opdater` (og provision-test-firm.js) gemmer den **returnerede** url (med `?v=`) i `greeting_audio_url` — bekræftet. Skift af stemme efterlader den gamle fil som forældreløs (uskadelig).
- **Hjælpemoduler:** `./tts` (`renderGreeting(supabase, {firmId, text, voiceGender})` → `{url}`), `./mail` (`sendWelcomeMail`), `./auth` (`firmIdFromToken`), `./token` (`generateToken`), `./phone` (`normalizePhone`)
- Adskillelse af `status` (onboarding-livscyklus) vs. `billing_status` (abonnement). **Frisbii-webhook-arkitekturen (trin 6, 8/7):** signatur-verifikation → idempotens-claim i `frisbii_webhook_events` FØR 200 → svar 200 straks → behandl → bogfør udfald (`processed_at`/`error`). Claimet er tre-tilstands: nyt/ubehandlet-dublet (genbehandles!)/færdigbehandlet. `billing_status`-værdier: `active` · `past_due` (dunning) · `cancelled` (opsagt, SERVICE FORTSÆTTER til periodeslut — retention-signal) · `expired` (deprovisioneret: firma inaktiv, `firms.phone_number` ryddet, nummer til pulje m. karantæne-regler). Timestamp-guard (`billing_status_updated_at`) beskytter mod out-of-order-retries og gater deprovisionering. Refund → 💸-log + admin-alarm, INGEN automatik (menneske-beslutning).
- ElevenLabs voice IDs sættes via env `ELEVENLABS_VOICE_IDM` (mand) / `ELEVENLABS_VOICE_IDF` (kvinde) — ikke hardcoded i tts.js. Kendte værdier: mand `qhEux886xDKbOdF7jkFP`, kvinde `4RklGmuxoAskAbGXplXN`. `sinch.js` er dødt kode.
- **SMS-historik:** dashboardets opgave-modal har en "Sendte beskeder"-liste der **læser direkte fra Supabase** (`messages`, anon-key + RLS) — ikke gennem backenden. Den henter ved modal-åbning (`loadMessages(lead.id)`) og opdaterer efter afsendelse. **Begge** afsendelses-veje i dashboardet (knappen "Send SMS" og afslå-SMS'en i afslut-flowet) går gennem `/send-sms`, så begge logges automatisk. Viser kun beskeder med et `lead_id`. Historik starter fra det øjeblik logningen blev sat op — ældre beskeder (sendt før) findes ikke i tabellen.
- **`if not exists`-migrationsfælde (lært):** en ældre `messages`-tabel fandtes allerede, så `create table if not exists` i `messages.sql` blev sprunget over, og kolonnen `twilio_sid` manglede → PostgREST afviste hele insert'en (`Could not find the 'twilio_sid' column … in the schema cache`). **Løst** ved at droppe den gamle tabel (`drop table public.messages cascade;`) og køre `messages.sql` forfra — tabellen har nu det **fulde** skema med FK + NOT NULL (ikke patch-versionen). `messages-patch.sql` (add-column-if-not-exists + `notify pgrst, 'reload schema';`) findes stadig som hurtig-fix hvis fælden rammer igen. **Generel læring:** tjek om en tabel findes i forvejen før du antager at en `create table`-migration har sat alle kolonner.
- **Forældreløse lead-kolonner:** `desired_time` og `deadline` på `leads` skrives ikke længere (felterne er fjernet fra både kunde-formular og dashboard-modaler). Kolonnerne står stadig — uskadelige, kan droppes ved en oprydning.

## Scripts / værktøjskasse

- **buy-numbers.js** — køber DK-mobilnumre, sætter `/opkald`-webhook i samme kald, lægger i puljen. `DRY_RUN=1 node buy-numbers.js 3` viser kandidater gratis; uden DRY_RUN købes for rigtige penge. **Fra 10/7: kræver eksplicit `VOICE_URL` i .env** (prod-fallbacken fjernet — den kunne i tavshed pege staging-numre på prod).
- **configure-number.js** — til numre købt manuelt i konsollen: sætter webhook + lægger i pulje (tager PN-SID). **Kræver også eksplicit `VOICE_URL`.**
- **skift-prod.ps1 / skift-staging.ps1** (nyt 11-12/7) — miljøskifte-ritualet som tooling: kopierer master (.env.prod/.env.staging) ind over .env og verificerer (check-env-prod.js --live hhv. check-env.js) — nægter ved fejl. skift-prod lægger synlig `.ENV-ER-PROD`-markør i repo-roden (rød lampe i Stifinder/VS Code/git status); skift-staging fjerner den først EFTER grøn verifikation. Ret altid masterfilerne, aldrig .env direkte.
- **check-env-prod.js** (nyt 11/7) — dømmer om .env er en REN prod-profil: læser projekt-ref + rolle direkte ud af Supabase-JWT'erne (fanger blandede profiler!), tjekker URL'er for staging-lugt, `--live` spørger Supabase og Twilio "hvem er du?". Exit 1 ved enhver fejl.
- **app-config.js** (nyt 10/7, route-modul — ikke CLI-script): serverer `/config.js` med `window.APP_CONFIG` (SUPABASE_URL + SUPABASE_ANON_KEY fra serverens env), fail-closed + no-store. Frontendens ENESTE kilde til Supabase-config. Wires i server.js: `require("./app-config")(app);`.
- **provision-test-firm.js** — opretter et **testfirma uden Frisbii**: claimer puljenummer, opretter Auth-bruger + firm_users (role owner), printer magic link (`?token_hash=…&type=email` — IKKE `magiclink`, ellers fejler verifyOtp). Standard: opretter et færdigt `verified`+`active` firma (springer onboarding over) og renderer hilsen via `./tts`. Flags: `--onboarding` (opret i `status:onboarding`/`verification_status:pending`, så brugeren gennemgår den rigtige onboarding via linket — sæt kode, stemme/besked, viderestilling, verificér via opkald; `--phone` bliver valgfri, og hilsenen renderes først i trin 2), `--dry-run` (vis plan, opret intet), `--yes` (spring bekræftelse over), `--number`, `--greeting`, `--slug`, `--mark-test` via `MARK_TEST` i CONFIG (kræver `is_test`-kolonne). Whitelister **ikke** ejeren — så testopkald bliver til ægte leads (lad en *bekendt* ringe). **Rydder selv op:** genbruges en eksisterende e-mail/bruger, fjernes brugerens **gamle** firma-koblinger bagefter (frigør gamle numre, sletter koblinger, best-effort sletter forældreløse firmaer) — så testdata ikke hober sig op og `/api/mig` ikke ser flere firmaer.
- **reset-test-data.js** — fuld nulstilling: sletter alle firmaer + koblinger + auth-brugere i FK-rækkefølge og frigør alle numre (beholder pulje-rækkerne). **Opdateret 10/7 til trin 6-skemaet:** `messages` + `frisbii_webhook_events` er nu med i sletterækkefølgen, og frigørelsen nulstiller også `quarantined_until` + `last_firm_id`. `--dry-run` viser kun optælling — og afslører samtidig hvilken version der kører (mangler messages-linjen, er det den gamle fil). Se også **opskriftsbogen** (`lommekontor-opskriftsbog-numre.md`) for numre/testdata-oprydning trin for trin.
- **mint-link.js** — minter en frisk magic link via service-rollen, til at komme forbi "link udløbet" uden om mail/rate-limiting.
- **check-env.js** (nyt 5/7) — dømmer den lokale `.env`: statisk (JWT role/ref, formater, MAIL_OVERRIDE_TO) + `--live` (spørger Supabase/Twilio/Frisbii "hvem er du?" — friendly name/handle skal svare staging). Køres efter enhver `.env`-redigering.
- **push-staging.ps1 / push-prod.ps1** (nye 6/7) — de ENESTE veje til `supabase db push`: staging-scriptet nægter hvis CLI-linket ≠ staging (link-fælden); prod-scriptet kræver "PROD"-bekræftelse, linker selv, og skifter ALTID tilbage til staging. Ren ASCII (PS 5.1-krav).

## Twilio — DK-mobil (vigtigt)

- DK-mobilnumre kræver **ingen bundle** (Twilio afviser dem aktivt; bundle kun relevant hvis reglerne ændrer sig).
- DK-mobil kræver **en godkendt Regulatory Compliance Address** (`AD…`-SID) — **ikke** en Emergency Address (det er en anden ting). Oprettes under Console → Phone Numbers → Regulatory Compliance → Addresses (udfyld Customer Name, ingen postboks).
- `TWILIO_ADDRESS_SID` ligger **kun i lokal `.env`**, ikke på Railway (numre købes lokalt). `buy-numbers.js` stopper med en klar fejl hvis den mangler.

## Miljøvariabler

**Railway + lokal:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (**ny 10/7** — frontendens nøgle, serveres via `/config.js`; SKAL findes i begge Railway-miljøer FØR config-fix-koden deployes, ellers 500 på /config.js), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SYSTEM_NUMBER` (⚠️ hed `TWILIO_PHONE_NUMBER` i lokal .env indtil 10/7 — navnedriften slog scriptenes systemnummer-vagt stumt fra; staging-værdien er provisorisk indtil subkontoen får eget systemnummer), `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_IDM`, `ELEVENLABS_VOICE_IDF`, `BASE_URL`, `SCW_SECRET_KEY`, `SCW_PROJECT_ID`, `SCW_REGION`, `FRISBII_WEBHOOK_SECRET`, `APPSIGNAL_PUSH_API_KEY`, `APPSIGNAL_APP_NAME`, `APPSIGNAL_APP_ENV` (sidstnævnte **pr. miljø**: production/staging)
**Kun lokal (til nummer-køb):** `TWILIO_ADDRESS_SID` (AD…), `VOICE_URL` (**krævet fra 10/7** — pr. miljøprofil: staging-/prod-backendens `/opkald`; fallback fjernet fra scripts)
**Valgfri:** `DASHBOARD_URL` (verifyOtp-vært; falder tilbage til `BASE_URL`)

**Mail-relaterede env-vars (efter domæneskift):** `SMTP_FROM = info@ditdigitalekontor.dk` (afsender*adressen* — styrer DKIM/SPF-domænet). `APP_NAME` = afsender*navnet* der vises i indbakken (separat fra adressen; skift ved rebranding). `MAIL_OVERRIDE_TO` omdirigerer ALT udgående mail til egen adresse **når `APPSIGNAL_APP_ENV !== "production"`** (staging-sikkerhed i mail.js) — hvis mail "sendes" men aldrig ankommer, tjek denne + at `APPSIGNAL_APP_ENV` er `production` på prod.

Service-role-nøglen er fuld admin — hold den ude af git.

## Arbejdskonventioner

CommonJS (ingen ESM); flad filstruktur; **komplette kørende filer, ikke diffs**; konkrete holdningsstærke anbefalinger; proaktiv risiko-flagging; EU-sovereignty/GDPR-præference; Windows/VS Code/PowerShell; **kommunikation på dansk**. Service worker cache-version bumpes ved hver frontend-deploy.

## Drift & udvikling (opsætning før launch)

*Detaljeret opskrift i `ditdigitalekontor-drift-runbook.md`. Princip: **én kodebase, to verdener** (staging/prod), **fundament før features**.*

**Master-rækkefølge:**
1. Git: `main` + `staging`
2. Railway: staging-miljø + **egne env-vars pr. miljø**
3. Supabase: separat **staging-projekt** + **versionerede migrationer** (`supabase/migrations` + CLI) — **før Frisbii**
4. Eksterne tjenester i test-mode (Twilio test-nr, Frisbii sandbox, mail → egen adresse)
5. AppSignal (fejl) + uptime på `/health` ("trin 0", se nedenfor)
6. Frisbii-livscyklus (bygget + testet i staging) → 7. drifts-/funnel-overvågning
- Lige før go-live: PITR-backup + **én gendannelses-øvelse**. Efter launch: brugs-/engagement-analytics.

**Kritisk fælde:** Railway-duplikering kopierer Supabase-env-vars **ordret** → staging vil pege på **prod-Supabase**, indtil de skiftes til staging-projektet. Staging er ikke ægte før da. (Railways "frisk DB pr. miljø" gælder ikke os, fordi DB'en er ekstern Supabase.)

**Migrationer:** stop med håndredigeret SQL på prod — kør hver skemaændring som en migrationsfil på staging, så prod. Afløser `if not exists`-fælden.

**Hemmeligheder/config:** fortegnelse efter `lommekontor-config-fortegnelse-skabelon.md`, lagt som *secure note* i en delt **Bitwarden**-collection (EU-region eller self-hosted). Dokumentet indeholder kun **referencer** — værdierne bor i Bitwarden (logins/nøgler/2FA-recovery) + Railway (runtime). Break-glass: partner-adgang til alle konti, 2FA-recovery i delt collection, Bitwarden master-recovery **offline**.

*Status (8/7-26): **DEL 0 (hele fundamentet) ER FÆRDIG 5/7** — git-branches m. beskyttet main, to Railway-miljøer, separat Supabase-staging seedet via bestået gendannelses-øvelse, versionerede migrationer, alle eksterne tjenester i test-mode (Twilio-subkonto, Frisbii-testkonto pr. miljø, mail-mur m. fail-closed, ElevenLabs delt), alle tre webhook-sømme røgtestet end-to-end med verificeret uberørt prod. **Byggetrin 6 (Frisbii-livscyklus) A-D bygget og testet 8/7** (idempotens/dead-letter, cancelled≠expired m. deprovisionering + nummer-karantæne, refund-flag). Detaljer, lærdomme og den samlede udestående-liste: runbooken (docs/). Pilot-spor åbnet: manuelle prøvekunder via formular + provision-script indtil Frisbii live (pilot-drejebog i docs/).*

### Overvågning — AppSignal (trin 0, virker)

- EU-region (Amsterdam), `@appsignal/nodejs` ^3.8.1. Init i **`appsignal.cjs`**, preloadet via start-kommandoen `node --require ./appsignal.cjs server.js` — **skal loades før alle andre requires**, ellers instrumenteres Express ikke. `appsignal.cjs` initialiserer med key fra env og loader `dotenv` selv.
- Env: `APPSIGNAL_PUSH_API_KEY` (auto-aktiverer), `APPSIGNAL_APP_NAME=lommekontor`, `APPSIGNAL_APP_ENV` **pr. miljø**.
- **Status: virker.** Request-instrumentering er bekræftet på Express 5 (throughput, svartider, og fejl kobles til rute-navnet — fx `GET /test-appsignal`). Den tidligere Express 5-bekymring (OTel `instrumentation-express` understøttede historisk kun Express 4) ramte os ikke i praksis.
- **Fejlsporing via custom handler:** route-fejl fanges af en middleware med **`sendError`** (egen rod-span): `app.use((err, req, res, next) => { sendError(err); next(err); })` sidst i kæden, med `const { sendError } = require("@appsignal/nodejs")` i toppen. Verificeret ende-til-ende (test-route → `throw` → handler → fejl i AppSignal Issue list).
- **Åben optimering (ikke-hastende):** nu hvor request-instrumenteringen virker, ville det "rene" mønster være AppSignals egen `expressErrorHandler` (kobler fejl til request-konteksten) i stedet for `sendError`-workaround'en. Kan testes senere; `sendError` virker og er fint indtil da. (Supportmail til AppSignal blev dermed ikke nødvendig.)
- Den midlertidige `/test-appsignal`-route er fjernet efter verifikation.

## Drift & robusthed — kendte huller (red-team)

*De steder hvor "det virker i staging" ikke er nok, når der er ægte, betalende kunder.*

### Sværhedsgrader vi ikke må undervurdere
- **Migrationer på levende data:** brug expand/contract (tilføj nyt → backfill → skriv begge → skift læsning → drop gammelt i senere release). Omdøb/dropp aldrig en kolonne i samme deploy som koden ændres. Test migrationer mod **prod-størrelse data**, ikke tomt staging (locks/varighed skjules ellers).
- **PITR = katastrofe-knap, ikke fortryd:** prod er nede under restore, og data skrevet siden gendannelsespunktet tabes. Redder ikke fra en dårlig migration.
- **Service worker:** "bump sw.js" er et ritual, ikke et sikkerhedsnet. Dårlig SW kan låse gammel app fast i kundernes browsere. Hav en kill-switch og verificér at udrulningen faktisk nåede enhederne.
- **Deploy-vindue er ikke nok:** små, reversible deploys + **feature flags** (ship dark, tænd/sluk) slår et "vindue". Adskil deploy fra release.
- **RLS er hele sikkerhedsmodellen:** RLS-fejl = firma A ser firma B's leads. Hvert backend-kald med `service_role` omgår RLS → hvert endpoint med klient-leveret `firm_id` skal selv tjekke ejerskab (IDOR). Kræver **automatiske tenant-isolations-tests**, ikke bare politik.

### Huller — prioriteret

**Launch-blokerende (før kunde nr. 2):**
- Funnel-overvågning på pengevejen: detektér "opkald ind, men ingen SMS ud" (ikke kun oppe/nede).
- Webhook-hærdning: signaturvalidering (`X-Twilio-Signature`) + idempotens på Twilio + Frisbii.
- Nummerpulje: alarm ved lav pulje; frigiv Twilio-nummer ved churn (ellers løbende betaling + kan ikke onboarde).
- Storage-backup: bekræft at backup dækker greeting-lyd + billeder i Supabase Storage — ikke kun Postgres. Replikér bucket hvis ikke.
- Break-glass / bus-faktor 1: partner skal kunne tilgå Railway, Supabase, Twilio, Frisbii, Simply.com (domæne/DNS). 2FA-recovery-koder gemt sikkert + delt. Domæne auto-fornyelse til.
- GDPR: DPA'er med underdatabehandlere (Twilio, Scaleway, Frisbii, Supabase, ElevenLabs, Railway), slettepolitik ved churn, opbevaringsgrænser, brud-procedure (72t). Vi er databehandler for håndværkeren.

**Snart (første uger):**
- **Dublet-leads (observeret):** ⚠️ **De synlige dubletter er slettet manuelt — beviset er væk.** Vi nåede aldrig at se om de havde NULL eller forskellig `call_id`, så kilden er **uafklaret**. **Næste gang du ser en dublet: kør diagnosen FØR du sletter** (slet den ikke før du ved hvilken kilde det er — ellers gentager vi tabet). DB-garantien er **allerede på plads** — `constraint leads_call_unique unique (call_id)` findes på `leads` (FK til `calls`, `on delete cascade`). To leads med **samme** `call_id` er derfor umulige. Følgelig er de dubletter der **stadig** ses per definition *ikke* samme-opkald-dubletter — de må være én af to ting:
  - **NULL `call_id`** (manuelt oprettede leads, eller en form-sti der ikke sætter `call_id`). NULL tæller ikke i en UNIQUE-constraint, så flere NULL-leads kan sameksistere. Tjek: `select count(*) filter (where call_id is null) from leads;`.
  - **Forskellige `call_id` der peger på dublerede opkald** — ét logisk opkald har skabt **flere `calls`-rækker** (Twilio kan ramme `/opkald` flere gange for ét kald: retry ved timeout/fejl, eller flere TwiML-trin). Hvert call → eget token → eget *lovligt* lead, så constrainten kan ikke fange det. **Fixet sidder opstrøms:** dedup `calls` på Twilios `CallSid` (tilføj `call_sid`-kolonne + `UNIQUE` + upsert i `/opkald`) — `CallSid` er stabil pr. opkald uanset hvor mange gange webhooken fyrer. (`calls` har pt. ikke en `call_sid`-kolonne; `raw_payload` indeholder den.)
  - **Diagnose:** `select call_id, count(*) from leads group by call_id having count(*) > 1;` kan **kun** returnere NULL-gruppen (constrainten udelukker resten). NULL-række med højt tal → kilde 1. **Ingenting**, men du ser stadig dubletter → kilde 2 (kig i `calls` efter samme `from_number` få sekunder fra hinanden).
  - **Graceful håndtering (stadig værd at gøre):** form-submit laver formentlig et plain `insert` → 2. submit med samme `call_id` kaster en **unique-violation (23505)** mod kunden i stedet for en pæn kvittering. Skift til upsert `{ onConflict: 'call_id', ignoreDuplicates: true }` → 2. submit bliver en tavs no-op. **Første vinder** er det rigtige (beskytter felter som `is_urgent`, som håndværkeren har rørt). Med `DO NOTHING` returnerer `.select()` **tomt** → behandl tomt som "allerede modtaget, vis tak-side", ikke som fejl.
- **Dublet-firmaer på samme nummer (observeret 28/6):** `firms.phone_number` har **ingen unique-constraint** → gentagne `provision-test-firm.js`-kørsler uden oprydning efterlod **tre** firmaer (`HansensHavefirma10`, `AnjasRengøring2`, `AnjasRengøring4`) med samme `+45`-nummer. `/opkald` slår firmaet op på nummeret med `.single()` → flere rækker → kaster → falder i "**Intet firma fundet**"-grenen → opkaldet dør tavst (telefonen ringer, men hilsen/verifikation kommer aldrig). **Samme klasse som `call_id`-dubletterne ovenfor:** en manglende constraint, ikke en logikfejl.
  - **Akut workaround (testfasen):** kør `reset-test-data.js` (eller ryd det gamle firma) **før** hver ny provisionering, så `firms` aldrig hober dubletter op. Bemærk: `update phone_numbers set firm_id = null;` frigør kun **puljen** — den rører ikke `firms.phone_number`, så et dødt firma kan stadig sidde på nummeret.
  - **Fix (migration, på staging-sporet — en af de første):** **partial unique index**, så kun ét *aktivt* firma kan eje et nummer ad gangen, uden at blokere genbrug efter deprovisionering:
    ```sql
    create unique index firms_phone_number_active_uniq
      on firms (phone_number)
      where status <> 'inactive' and phone_number is not null;
    ```
    Tilpas prædikatet til hvordan deprovisionering markerer et firma (Frisbii `subscription_expired` → firma inaktivt). **Simplere alternativ:** ryd også `firms.phone_number = null` ved deprovisionering (spejler `phone_numbers.firm_id = null`), så en **plain** `unique (phone_number)` rækker — NULL'er konflikter ikke.
  - **Hærd `/opkald`-opslaget samtidig:** filtrér på det aktive firma, og brug ikke blindt `.single()` — et forældreløst inaktivt firma med samme nummer (efter deprovisionering) skal ikke kunne vælte opslaget. Vælg robust (foretræk aktivt firma), præcis som `/api/mig` allerede gør for flere `firm_users`-rækker.
- Billing-livscyklus: fejlede MobilePay-fornyelser, dunning, grace; **retry/dead-letter** på async-provisionering (immediate-200 taber ellers tavst et event ved jobfejl).
- Fejlsporing (AppSignal, **kører**) + struktureret logning + lead-funnel-dashboard.
- Connection pooling: backend skal bruge Supabase pooler (Supavisor), ikke direkte forbindelse.
- Hemmeligheds-rotation: plan ved læk af service-role/Twilio-token; tokens aldrig i logs.
- On-call-virkelighed: hvem svarer en alarm kl. 06 lørdag? Eskalering + tunede alarmer (undgå alarmtræthed).

**Senere / ved skalering:**
- Off-platform `pg_dump` til anden udbyder/region (beskytter mod konto-/region-tab).
- Config-drift mellem staging/prod (let infra-as-code eller dokumenteret config-inventar).
- Omkostnings-/skaleringsklipper pr. tjeneste (Twilio, ElevenLabs, Supabase compute/PITR, Railway-forbrug).
- DMARC-overvågning; syntetisk opkalds-overvågning (automatisk testopkald der asserterer SMS ankommer).

## Status / top of mind

**NYESTE (16-17/7): Onboarding TOTALT redesignet (Annes spec) — i prod. Plus tidsmåling på siderne, app-hilsen i dashboardet — og en selvforskyldt regression fundet+rettet samme formiddag.**
- **Redesignet:** én besked + én handling pr. side, 150 ms crossfade, fem prikker + tilbage-pil, ✓-rytme på alle knapper, grønne kvitteringslinjer, stemme+besked sammenlagt (besked-sektionen glider ind ved valg), viderestilling m. luft, SVG-tegnede guide-"screenshots" m. "Tryk her", hjemmeskærms-ikonkopi m. "Dit Kontor"-label på slutsiden. Hvidlisten UDE af flowet (kun profilsiden). Detaljer: *Onboarding-flow*-sektionen.
- **Session-fixet (rodårsagen bag "usynligt nummer" 16/7):** `token_hash` i URL'en vinder nu ALTID over en gammel session; manglende firma giver klar fejlskærm, aldrig tomt UI. `/api/firma/opdater` returnerer nu `greeting_audio_url` → ▶ Lyt afspiller kundens egen besked m. valgt stemme (re-render kun ved ændring).
- **Tidsmåling (EU-egen, ingen tredjeparter):** tabel `onboarding_sidevisninger` (migration `20260716090000`, kørt på staging+prod via push-scripts) + `POST /onboarding/sidevisning` + keepalive-beacons i goTo/visibilitychange. Analyse-SQL i endpointet.
- **Dashboard:** app-hilsen ved første standalone-åbning (grønt ✓ + "Dit Digitale Kontor er klar." + [Åbn]; localStorage-flag; selvstændig fejlsikker blok).
- **REGRESSIONEN (17/7-lærdom):** nummer-boksen blev slettet på succes-siden, men `startFlow` skrev stadig til elementet → TypeError → init's catch viste **"Linket er udløbet" for alle med gyldigt login** (og tokenet blev forbrugt ved første forsøg). Maskeret som link-/miljøproblem; afsløret via konsollen (husk: konsol-FILTERET kan skjule fejlene — "4 er skjult"). Fix: `setText`-værn på al DOM-udfyldning. **QA-regler: fuldt id-tjek efter hvert redesign; localhost-demoen skjuler fejlklassen; ved "Linket er udløbet" → tjek konsollen for `Init fejlede` FØR miljø-teorier.**
- **App-redningsvejen lukket (17/7, kodeopgave 1a+1b BYGGET — afventer deploy + iPhone-røgtest):** rescue-mailen indeholder nu en 6-cifret engangskode (`email_otp` fra `generateLink` — gratis, samme token som linket, engangsbrug på tværs), `sendLoginLinkMail` viser den i egen boks, og dashboardets login-skærm fik kodefelt + `loginWithOtp()` (`verifyOtp` type 'email'; `one-time-code`-autofyld fra Mail). Dermed kan kunden komme ind i den installerede app UDEN at mail-linket sender dem til Safari. Autofyld-attributter (`email`/`current-password`) sat på login-felterne. Alle tre filer (mail.js, onboarding-link.js, dashboard.html) er hver især bagudkompatible — deploy-rækkefølge ligegyldig.
- **Røgtest + finpudsning (19/7):** kernetest ✅ i den installerede app (kode → inde uden Safari), negativtest ✅, rate-limit ✅. Fund: prod-OTP var 8 cifre (felt var hårdkodet til 6 → gjort tolerant 6-10; indstillingen sættes til 6 i begge projekter). iOS' kode-forslag kræver Apples Mail-app (Ann bruger Simply-webmail — derfor udeblev det; ingen fejl). Login-skærmens kodetilstand strammet (se Auth). Side 1-tekster: "Er det dit nummer?" / "Hvad er dit nummer?". Sidste gate-punkt: nøglering-testen (kodeopgave 1b).
- **Affødte udeståender:** ~~manifest-`short_name`~~ (✅ verificeret 18/7: "Dit Kontor", matcher); evt. preview-endpoint til ▶ Lyt (i dag koster hvert Lyt m. ændret tekst et ElevenLabs-kald).

**NYESTE (14-15/7): Adresse-sporet lukket i prod (postnr/by forsvandt) + Annes pilot-gennemløb GRØNT → pilot-rekruttering kan starte.**
- **Fejlen:** postnr/by forsvandt "ved overførsel fra kundeformular til dashboard". Reelt TO samvirkende fejl: (1) **kilden skrev beskidt** — formularen lagde DAWA's fulde tekst (som allerede slutter på "postnr by") i vejfeltet, og serveren klistrede postnr+by på igen → dubletter ("…, 3400 Hillerød, 3400 Hillerød"); DAWA-*trædesten* (mellemtrins-forslag) blev accepteret som endelige valg → rækker uden postnr/by og med tomme segmenter (", ,"). (2) **dashboardet ødelagde** — opgave-modalens parse antog præcis ét komma, og `closeModal` genskrev adressen ved HVER lukning (også klik på baggrunden) → på flerkomma-adresser (fx supplerende bynavn "Ny Hammersholt") blev postnr/by permanent slettet i databasen, blot man ÅBNEDE leadet.
- **Fixet (begge lag):** `bygAdresse()` i server.js = ét normaliserings-chokepoint ved lead-indsættelse (split på komma, trim, fjern tomme/dubletter, postnr+by præcis én gang, bagerst). `parseAddress()` i dashboard.html finder postnr+by **bagfra** og tåler alt historisk griseri — bruges af liste-visning, sortering (gade+by) og modal. `closeModal` skriver **kun ved ændring** (snapshot ved åbning): "kig på lead" er aldrig en skriveoperation. Adresse-konvention: `"Gade 12[, Supplerende Bynavn/etage], 1234 By"` i én `leads.address`-streng.
- **DAWA-overhaul (kundeformular + begge dashboard-modaler):** validering er nu **resultat-baseret** (er postnr fanget?), ikke klik-baseret. En *adgangsadresse* (selve huset, har postnr i data) tæller som gyldigt valg STRAKS — listen bliver stående til valgfri etage/dør-finpudsning; kun rene vejnavne er ugyldige. `rens()` fjerner DAWA's tomme etage-hul, så ", ," aldrig vises. "Ny opgave"-modalen viser **fuld adresse** i feltet efter valg (den har skjulte postnr/by-felter — et felt med kun "Barakstien 4" såede tvivl → redigering → valg nulstillet → fejl); rediger-modalen viser kun gadedelen (den HAR synlige postnr/by-felter), og dens onType nulstiller IKKE længere postnr/by (at rette en tastefejl i gaden må aldrig tømme dem).
- **Felter fjernet (endelig gjort — primeren påstod det fejlagtigt allerede):** "Hvornår passer det dig?" (opret-modal, `desired_time` sendes nu null), Deadline + "Ønsket tidspunkt fra kunde" (rediger-modal; deadline blev kun vist, aldrig gemt — kolonnerne ligger ubrugte men harmløse). Mailfeltet omdøbt til "Mailadresse".
- **Haster-persist-fix (15/7, fundet ved docs-revision):** `is_urgent` blev IKKE gemt (toggleUrgent rørte kun UI; closeModal skrev det aldrig — funktionen var gået tabt, selvom primeren påstod den fandtes). Nu med i snapshot + closeModal-update. **Opfølger samme dag:** krydset kunne sættes men ikke fjernes — rækkens `onclick` OG checkboxens/labelens native adfærd vippede begge, så antal vip afhang af klik-zonen (boks-baggrund = 1, selve krydset = 2 = "ingenting"). Fix: rækken er nu **eneste kontakt** (checkbox `pointer-events:none` + `tabindex="-1"`, label uden `for=`) i begge modaler.
- **Allerede amputerede rækker** (åbnet+lukket FØR fixet) kan ikke gendannes automatisk — kun få pilotdata-rækker; rettes manuelt i Supabase ved behov. Beskidte-men-komplette rækker vises pænt (parseAddress) og renses fysisk næste gang nogen redigerer dem.
- **Annes fulde pilot-gennemløb (oplæggets 4 punkter) er GRØNT:** ægte opkald→lead ✓, rescue-sti+puf ✓, mobil/viderestillings-kort ✓, onboarding på mobil ✓. **Exit-kriteriet er opfyldt → rekruttering af rigtige håndværker-piloter kan starte** (drejebog i docs/; Anne ejer formular/kommunikation).

**NYESTE (13/7): Hvid skærm på mobil LØST (rodårsag fundet) — og rescue-mail, kodeskifte-puf, session-hærdning og nye ikoner er alle i prod, røgtestet.**
- **Hvid skærm (rodårsag + fix):** `onAuthStateChange` skjulte login → ukapslet `Notification.requestPermission()` kastede ReferenceError på iPhone (API'et findes IKKE i Safari-faner, kun i installerede PWA'er, iOS 16.4+) → `loadData()` blev aldrig nået → app forblev skjult = hvid skærm. Ramte alle faner med session — også "private" (iOS deler privat-lager, til ALLE private faner er lukket, så en gammel link-login-session lå og lurede dér). Fix i dashboard.html: guard (`if ('Notification' in window)`), script-tags flyttet fra `<head>` til lige før inline-scriptet (siden tegnes altid, før scripts kan hænge/fejle), fail-SYNLIGT boot (manglende APP_CONFIG/supabase-lib giver besked i stedet for stille død) + **midlertidigt fejl-overlay** (window.onerror/unhandledrejection → rød bjælke med fejltekst nederst — pilotfasens diagnoseværktøj; se huskelisten).
- **sw.js v17 (omskrevet — to alvorlige fejl fjernet):** den gamle besvarede ALLE navigationer (også kundeformularen!) med cache-nøglen `/dashboard` OG forgiftede nøglen med den faktisk hentede side (formular-HTML kunne lande under dashboard-nøglen og omvendt). Ny strategi: **allowlist** — kun `/dashboard`-navigation håndteres, network-first (cache bruges kun offline); kundeformular, `/onboarding` og `/config.js` røres aldrig. Deploy-konsekvens: rene HTML-ændringer slår nu igennem UDEN sw-bump; bump kun ved ændring af sw.js selv/cachede CDN-aktiver.
- **Rescue-mail (kodeopgave 8 ✅ prod):** egen skabelon `sendLoginLinkMail` i mail.js (eget emne, ingen nummer-boks/opsætningsinstruks, tryghedslinje); onboarding-link.js bruger den. Rate-limit + anti-enumeration uændret; går gennem samme sendViaScaleway-chokepoint (staging-gate gælder automatisk).
- **Kodeskifte-puf (✅ prod):** efter link-login foreslår dashboardet en ny adgangskode. Mekanik: /onboarding sætter `viaLoginLink` KUN ved ægte verifyOtp → redirect `/dashboard#nyt-login` (hash: aldrig til server, ingen cache-nøgle) → lukbar bjælke (stålblå, navy-knap, hvid tekst) med genvej der åbner profilsiden og fokuserer pw-feltet; hash fjernes straks, så puffet kun vises én gang.
- **Session-hærdning (✅ prod):** kodeskifte trækker alle ANDRE Supabase-sessioner tilbage (bevidst sikkerhed) → gammel kode crashede på `.data.user.id` (null). Nu: loadData validerer via getUser og falder roligt tilbage til login; onAuthStateChange håndterer SIGNED_OUT; 30-sekunders-lead-polleren springer over uden gyldig bruger (før: stille crash hvert 30. sek. — også på login-skærmen, hvor polleren altid har kørt).
- **Nye ikoner (✅ prod):** hele sættet udskiftet + `?v=2`-cache-buster på ikon-links i dashboard/onboarding (browserens favicon-cache er separat og stædig; buster = den eneste kundevenlige vej — bump til ?v=3 ved næste skifte) + `crossorigin="anonymous"` på supabase-CDN-tagget, så fejl-overlayet får ÆGTE fejltekst i stedet for maskeret "Script error.". Verificeret hos Anne (hendes faner skiftede af sig selv). Rest: PWA slet+geninstallér på begge iPhones (hjemmeskærms-ikon = installations-øjebliksbillede).
- **Viderestillings-kort på profilsiden (✅ prod, 13/7 aften):** se *Profilside — funktioner*. Profilsidens rækkefølge samtidig ændret (viderestilling nederst, før Log ud).
- **Uafklaret (lav prioritet):** sporadisk "Script error." på iPhone — dashboardet virker, bjælken kommer og går; formentlig godartet baggrundsfejl i supabase-js (tokenfornyelse). Afventer gentagelse NU med crossorigin aktiv → ægte fejltekst → dom.

**NYESTE (12/7): SMS-segmentfejlen fundet og rettet — kerneproduktet bevist ende-til-ende i prod.** Rebrandingen gjorde domænet 8 tegn længere → alle kunde-SMS'er over 160 GSM-tegn → delt midt i linket → "Cannot GET" hos kunden. Fix live i begge miljøer: `kundeSmsBody()`-skabelon (154 tegn, ét sted), demo som to beskeder (forklaring + nøjagtig kopi), `gsmSegments`-vagt. Ny produktregel: firmanavn+slug ≤ 46 tegn (m. Anne). Miljøskifte er nu tooling: `skift-prod.ps1`/`skift-staging.ps1` m. `check-env-prod.js`-verifikation og synlig `.ENV-ER-PROD`-markør. Prod nulstillet 11/7 (SIDSTE gang — fremover kun kirurgisk sletning) og gen-etableret: testfirma + pilot #0 (Anne). Staging-systemnummer: +4591309928. **Åbne fund overdraget til ny chat: hvid skærm på mobil-dashboard (begge telefoner, server-200, SW-mistanke) + rescue-mail genbruger velkomstskabelon (kodeopgave 8).** Oplæg i docs/.

**NYESTE (11/7): Prod-toget kørt via PR — trial-provisionering + config-fix er LIVE i prod og verificeret i begge miljøer.** Staging: magic-link-login virker ende-til-ende (config-rodårsagen definitivt lukket; onboarding gennemført til trin 4 — verifikationsopkaldet kræver staging-systemnummer, kendt udestående), rescue-sti ✓. Prod: `/config.js` svarer med prods egen ref ✓, login ✓. Ikke-trial-grenen + timestamp-guard bevist live (sub-0013 — OBS: dens plan var oprettet UDEN prøveperiode; lærdom: navngiv Frisbii-planer efter egenskab). **Prod-tog-køreplan fremover: PR fra `staging` → `main` på GitHub — `main` er PR-beskyttet, lokalt merge+push afvises (GH013).** Pilot-sporet er åbent: næste skridt er pilot #0 (Anne) via manuel provisionering på prod, jf. drejebogen. Runbookens udestående-liste er autoritativ (pr. 11/7).

**NYESTE (10/7): Trial-provisionering bygget + røgtestet — og en tværgående config-rodårsag fundet.** `subscription_created` er nu startskud nr. 2 ind i samme `provisionFirm` (trial-tjek via Frisbii-API, `isTrialSubscription()`, fail-closed på feltlæsning / fail-loud på API-fejl); dobbelt-provisionering stoppes af app-tjek + den **medfødte** `firms_frisbii_subscription_key`-constraint (kolonnen var unik fra fødslen — separat migration viste sig overflødig og blev droppet efter en migrations-hovedbogs-oprydning). Staging-røgtest D–F bestået: dead-letter ved tom pulje → nummer via `configure-number.js` → gensend → provisioneret ✓; no-op-værn ✓; ikke-trial-gren ✓. **Dagens store fund:** onboarding/dashboard havde **hardcodet prod-Supabase-config** → staging-magic-links afvist som "udløbet" af prod-projektet (usynligt indtil første staging-login). Fix: `/config.js`-mønsteret (`app-config.js`) — **filer må ikke kende miljøer**. Deploy-opskrift i `docs/opskrift-config-fix-og-prodtog.md`. Runbookens udestående-liste er den autoritative (opdateret pr. 10/7); pilot-rekruttering kan starte NU (manuelle piloter uden om Frisbii).

**NYESTE (2/7-8/7): Fundament + Frisbii-livscyklus.** Del 0 færdig (se *Drift & udvikling*). Byggetrin 6 A-D bygget og end-to-end-testet i staging: dead-letter-arkitektur (ingen betalende kunde kan forsvinde — claimet-men-fejlede events genbehandles ved Frisbii-retry, demonstreret med "cirkel-lukning": tom pulje → dead-letter → nummer frigjort → gensend → kunde provisioneret), cancelled≠expired med deprovisionering og nummer-karantæne (betalt: 30 dage/env-var; prøve: straks — win-back-hensynet: nummeret står på håndværkerens bil), refund → alarm uden automatik. **Vigtige afklaringer:** en 0-kr-trial udløser IKKE `invoice_settled` → trial-provisionering er en kodeopgave FØR trial-lancering; dublet-emails knækker email-opslag → kodeopgave før go-live. **Umiddelbart forestående:** prod-toget (trin 6-kode + migrationer → prod, opskriftsbog i docs/), staging- + prod-dataoprydning, pilot-sporet (formular + manuel provisionering — drejebog i docs/, Anne ejer formular/kommunikation). **Den samlede, prioriterede udestående-liste bor i runbookens sidste sektion** ("Udeståender — samlet overblik") — dét er den autoritative liste, ikke huskelisterne nedenfor (som er ældre men bevaret for kontekst).

**Onboarding er testet ende-til-ende og virker** (i inkognito/efter `sw.js`-bump). Hele flowet kører: link → trin 1 (kode + `+45`-telefon) → trin 2 (stemme/besked) → trin 3 (ét viderestillings-flow, GSM-kode `**61*<nr>#` + `*61*`-faldback, ingen custom timer) → trin 4 (verifikation via udgående opkald, ~70 sek. poll, svar-håndtering) → trin 5 (valgfri hvidliste) → success med "gem som app"-vejledning (PWA). `/api/mig` er robust over for flere `firm_users`-rækker, og `provision-test-firm.js` rydder selv op, så testdata ikke hober sig op.

SMS-historik er live: håndværkeren kan se sine sendte beskeder pr. opgave (`send → log i messages → vis i "Sendte beskeder"`). Opgave-modalen er ryddet op (Deadline + "Ønsket tidspunkt" fjernet, Haster persisteres, frit SMS-tekstfelt). Profilsiden er komplet (telefonbesked, hvidliste, skift adgangskode). Adgangskode-hullet er lukket. Hvidliste-numre kan nu udfyldes **både i onboardingen (trin 5) og bagefter på profilsiden**, og success-skærmen guider til at gemme appen på hjemmeskærmen (PWA).

**Domæneskift gennemført (28/6): `lommekontor.dk` → `ditdigitalekontor.dk`.** Den **funktionelle** del er færdig og verificeret ende-til-ende. ✅ **Brand-omdøbningen** (tekst "LommeKontor" → "Dit Digitale Kontor" i frontend/manifest/mail-afsendernavn/kode-kommentarer) er nu **gennemført** — hele repoet er brandrent (verificeret via case-insensitivt sweep). Eneste bevidste undtagelse: `APPSIGNAL_APP_NAME`. Det der hang på domænet og blev skiftet:
- **Railway custom domain** `opgave.ditdigitalekontor.dk` + auto-cert (Let's Encrypt). TXT `_railway-verify.opgave` + CNAME `opgave` → Railway-target i Simply.
- **`BASE_URL`** skiftet i **både Railway og lokal `.env`** (de to er separate; scripts som `provision-test-firm.js` læser den lokale).
- **Twilio voice-webhook:** sættes af `configure-number.js`, som bygger URL'en fra `VOICE_URL`/rå Railway-URL (`sms-backend-production-5ee1.up.railway.app/opkald`) — **ikke** fra `BASE_URL`. Den rå Railway-URL var derfor aldrig på det gamle domæne; webhooks ramte appen hele tiden. (Frisbii-webhooken samme sag: pegede altid på rå Railway-URL.)
- **Supabase Auth → URL Configuration:** Site URL + Redirect URLs skiftet til `https://opgave.ditdigitalekontor.dk` (+ `/onboarding`, `/dashboard` el. wildcard). En gammel **ngrok**-Site-URL lå som rest og blev fjernet. Uden dette afviser `verifyOtp` redirect'et → magic-link-login fejler.
- **Scaleway TEM:** nyt afsenderdomæne `ditdigitalekontor.dk` tilføjet (region PAR/fr-par, matcher mail.js). DNS i Simply: **SPF** flettet (`v=spf1 include:spf.simply.com include:_spf.tem.scaleway.com -all`, kun ÉN record); **DKIM** via opdateret `simply-dns-add.js` (Simply web-panel afviser >255 tegn) — **samme selector** som lommekontor.dk (delt Scaleway-projektnøgle) men **anden nøgleværdi** pr. domæne; **DMARC** er en CNAME til `dmarc.simply.com` (Simply-styret, `p=reject`) → rør den ikke; **MX skippet** (modtager ikke mail på domænet — Scaleways `blackhole`-MX ville blokere evt. fremtidig indgående mail). DNS-fælde bekræftet igen: navn skal være **relativt** (uden `.ditdigitalekontor.dk`); verificér ny nøgle mod **autoritativ** server (`-Server ns1.simply.com`), ikke lokal/Google-cache, som viser gammel nøgle indtil TTL udløber.
- **`SMTP_FROM`** skiftet til `info@ditdigitalekontor.dk` (Railway + `.env`). **Afsender*navnet*** styres separat af env-var **`APP_NAME`** (skiftet) — ikke af `SMTP_FROM`. **`APPSIGNAL_APP_NAME` lades bevidst stå som `lommekontor`** (internt teknisk navn, ikke kundevendt; omdøbning ville splitte fejl-/performance-historikken).

**Lærte faldgruber (så de ikke bider igen):**
- **DAWA-autocomplete er en TRAPPE, ikke en liste (14-15/7):** forslagene omfatter *trædesten* (vejnavn/adgangsadresse — tekst med tomt etage-hul: "Vej 4, , 2970 By") som er ment til at fortsætte indtastningen. Tre regler: (1) validér **resultatet** (er postnr fanget i data?), aldrig klikket — en adgangsadresse ER en gyldig adresse; (2) DAWA's `tekst` slutter allerede på "postnr by" — klistr ALDRIG postnr+by på igen (normalisér i ét server-chokepoint, `bygAdresse`); (3) rens tomme segmenter før visning. UX-lærdom: et felt der *ser* forkert ud (kun "Barakstien 4" uden by), lokker brugeren til at redigere — og redigering nulstillede valget → fejl. Vis den fulde adresse.
- **"Kig" må aldrig være en skriveoperation (14/7):** opgave-modalen genskrev `leads.address` ved HVER lukning (også baggrunds-klik) ud fra en ét-komma-parse → åbn+luk af et lead med flerkomma-adresse SLETTEDE postnr/by permanent. Mønster: snapshot ved åbning, skriv kun ved faktisk ændring — og parse adressestrenge **bagfra** (find postnr-mønstret `\d{4} + by` fra enden).
- **Dokumentation kan lyve om kode (15/7):** primeren påstod at Haster-persist og felt-fjernelser var gjort — koden viste det modsatte (`is_urgent` blev aldrig gemt; felterne fandtes). Ved docs-revision: verificér påstande mod filerne (grep), ret enten koden eller dokumentet.
- **Klikbar række + native checkbox = dobbelt-vip (15/7):** en `onclick` på rækken OG en checkbox/label med egen native toggle-adfærd vipper BEGGE — klik på selve krydset gav 2 vip (= dødt), klik på baggrunden 1 (= virkede). Lumsk asymmetri: man rammer baggrunden når man SÆTTER, men sigter efter krydset når man FJERNER. Mønster: gør rækken til eneste kontakt — checkbox `pointer-events:none` + `tabindex="-1"`, ingen `for=` på labelen. (Lå skjult indtil persisteringen kom — før blev intet gemt alligevel.)
- **Web-API'er skal guardes (13/7):** `Notification` findes ikke i iPhone Safari-faner — ét ukapslet kald gav hvid skærm på hele mobilplatformen. Mønster: `if ('X' in window/navigator)` før ethvert API, der ikke er garanteret overalt.
- **SW-allowlist-princippet (13/7):** en service worker må kun håndtere stier, den EJER. Catch-all på navigationer + fast cache-nøgle = kapring af fremmede sider OG cache-forgiftning. Test-fælde: privat fane frikender SW'en, men IKKE session-afhængige fejl — iOS deler privat-lager mellem alle private faner, til de alle er lukket.
- **"Script error." = cross-origin-mundkurv (13/7):** ufangede fejl fra scripts på fremmede domæner maskeres af browseren til to ord. `crossorigin="anonymous"` på script-tagget (CDN'et skal sende CORS-headere — jsdelivr gør) giver fuld fejltekst.
- **Kodeskifte dræber andre sessioner (13/7):** Supabase trækker øvrige sessioner tilbage ved password-skift. Klientkode skal tåle "session findes lokalt, men serveren siger nej": validér med getUser og fald tilbage til login — aldrig `.data.user.id` uden null-tjek. Gælder også baggrunds-pollere (og husk: en setInterval startet ved load kører OGSÅ på login-skærmen).
- **PWA-ikon og app-navn er PERMANENTE brand-aktiver (13/7, princip):** alt INDE i appen opdaterer sig selv hos alle installerede PWA'er (kode/sider flyder via nettet; fra sw v17 ved første genindlæsning) — men SKALLEN (ikon, navn, splash) er et øjebliksbillede fra installationen. Android self-healer (Chrome gen-tjekker manifestet inden for ~et døgn); **iOS har INGEN mekanisme** — slet+geninstallér er eneste vej. Konsekvens: ikon/navn ændres ALDRIG efter kundelancering. Rebrandingen faldt heldigt: FØR rigtige kunder installerede (kun Ann+Annes telefoner skulle geninstalleres). Nødplan hvis det alligevel sker: Android ordner sig selv; iOS-kunder beholder forældet men fungerende ikon + evt. venligt engangsbanner i appen med geninstallations-vejledning.
- **Favicon-cache + PWA-ikoner (13/7):** browserens favicon-lager ignorerer normal genindlæsning → `?v=N`-cache-buster på ikon-links er den kundevenlige vej. PWA-hjemmeskærmsikonet er et øjebliksbillede fra installationen — kun slet+geninstallér opdaterer det. iOS beder selv om `/apple-touch-icon-precomposed.png`; 404 dér er harmløs støj.
- **git revert + untracked filer (13/7):** revert nægter at overskrive untracked filer (de findes kun i mappen — det er beskyttelse, ikke fejl): flyt dem ud af repoet først. Omvendt: flyttes en TRACKED fil ud, står den som "deleted" — `git restore <fil>` henter den tilbage. `origin/staging` i loggen = GitHubs position; "ahead by 1 commit" = manglende push.
- **SMS-segmentfælden (rettet 12/7):** 160 GSM-tegn pr. SMS; over det deles i segmenter à 153 — MIDT i URL'en, så linket knækker hos modtageren. Ét ikke-GSM-tegn (emoji, krøllet citat, tankestreg) → UCS-2 → grænsen bliver 70! Rebrandingens +8 domænetegn skubbede ALLE kunde-SMS'er over. Værn: skabelon ét sted (`kundeSmsBody`), `gsmSegments`-vagt logger ⚠️, budget: navn+slug ≤ 46 tegn.
- **Prod-nulstilling er afskaffet (11/7 var sidste gang):** `reset-test-data.js` mod prod tog pilot #0 med sig. Fremover: test i prod med det, der findes; oprydning kun kirurgisk pr. eksplicit firma-id.
- **Hardcodet frontend-config = miljø-blind frontend (rettet 10/7):** `onboarding.html`/`dashboard.html` bar prod-Supabase-URL + anon-nøgle hardcodet → alle statiske sider talte med PROD fra browseren, uanset serverende miljø. Symptom: staging-magic-links "udløbet" ved første klik (prod-projektet kendte ikke stagings tokens) — usynligt indtil første ægte staging-login. Fix: `/config.js`-mønsteret (`app-config.js`). **Princip: filer må ikke kende miljøer — miljøet ejer sine adresser** (samme princip som MAIL_OVERRIDE_TO og VOICE_URL-kravet). Læring til fejlsøgning: "udløbet/ugyldigt token" på tværs af projekter = tjek HVILKET projekt klienten taler med (DevTools → Network → verify-kaldets værtsnavn).
- **Migrations-hovedbogen (lært 10/7):** en migrationsfil, der har været kørt mod nogen database, må ALDRIG omdøbes eller slettes — mappen og `supabase_migrations.schema_migrations` skal stemme 1:1, ellers nægter CLI'en alle push. Arbejdsgang: opret fil → indsæt indhold → gem → push (aldrig push imellem). Reparation af orphan: gør reverten sand (drop det skabte) → `npx supabase migration repair --status reverted <version>`. CLI'en er devDependency → `npx supabase …`.
- **Badge ≠ bevis:** UI'ets UNIQUE-badge siger ikke HVILKET værn — `frisbii_subscription` viste sig medfødt unik (`_key`-constraint fra `create table`), så dagens migration var redundant og blev droppet. Spørg `pg_constraint`/`pg_indexes`, ikke dashboardet, og husk at kolonner født FØR CLI-baselinen ikke findes i migrations-mappen (grep kan hverken be- eller afkræfte dem).
- **Hårdkodet domæne i SMS-link (rettet 28/6):** `onboarding.js` byggede både demo-SMS (`demoUrl`) og kunde-SMS (`formUrl`) med hårdkodet `https://opgave.lommekontor.dk/...` i stedet for `BASE_URL`. Derfor pegede SMS-links på det døde domæne efter skiftet, selvom `BASE_URL` var rettet. **Fix:** ny `FORM_BASE = (process.env.BASE_URL||"").replace(/\/$/,"")` øverst i modulet, brugt begge steder. Læring: ved næste domæne-/brand-skift, grep ALT for hårdkodede domæner — de bygges ikke altid fra `BASE_URL`.
- **Manglende route-registrering = tavs 404 (rettet 28/6):** `/onboarding/nyt-link` ("Send mig et login-link") fandtes **kun** i `onboarding-link.js`, men `server.js` kaldte aldrig `require("./onboarding-link")(app, supabase)`. Routen eksisterede derfor ikke → POST gav 404. Lumsk fordi `fetch` **ikke kaster** ved 404 (kun ved netværksfejl), så frontendens try/catch fangede intet, og knappen viste sit generiske "vi har sendt et link"-svar **uden at sende noget**. Symptomet ("ingen mail, intet i Railway-loggen") lignede et mail-/DNS-problem, men var en manglende `require`. **Fix:** linjen tilføjet efter `frisbii-webhook`. Bekræftelse: opstartsloggen viser nu `🔗 Nyt-link endpoint registreret paa /onboarding/nyt-link`. Læring: en route der "lykkes tavst" i frontenden, men intet logger på serveren → tjek at modulet er wiret ind i `server.js`.
- **Service-worker-cache:** efter hver frontend-deploy → bump `sw.js` og test i **inkognito**. "Tomt nummer på trin 1" var cache, ikke data.
- **`/api/mig` + flere firmaer:** gentagne testkørsler på samme e-mail hobede `firm_users`-rækker op → `.single()` væltede. Nu robust, og provisioneringen rydder selv op.
- **GSM-timer:** custom no-reply-timer virkede ikke pålideligt — drop den, brug teleselskabets standard, og forlæng poll-timeout tilsvarende.

**Næste skridt / huskeliste:**
- **Fejl-overlayet i dashboard.html skal dæmpes eller afmonteres, når piloten er stabil** (indført 13/7 som diagnoseværktøj): det viser ALLE ufangede fejl, også godartede baggrundsfejl. Muligt mellemtrin: ignorér kendte godartede supabase-fejl, behold resten.
- **PWA slet+geninstallér på begge iPhones**, så hjemmeskærms-ikonet skifter til det nye (fane-ikonerne er klaret via ?v=2-busteren).
- **Domæneskift gjort (28/6):** `ditdigitalekontor.dk` kører funktionelt ende-til-ende (se *Status → Domæneskift*). **Rebranding-tekst gennemført:** brandnavn "LommeKontor" → "Dit Digitale Kontor" er skiftet i frontend/manifest/mail-afsendernavn/kode-kommentarer på tværs af hele repoet (samlet sweep, case-insensitivt). Berørte filer: `dashboard.html`, `onboarding.html`, `manifest.json` (`name`+`short_name`), `sw.js` (cache bumpet v13→v14), `mail.js`, `server.js`, `frisbii-webhook.js`, `slug.js`. `short_name` = "Dit Kontor" (home-skærm-label). **Bevidst undtagelse:** `APPSIGNAL_APP_NAME` = `lommekontor` (bevarer fejl-/performance-historik).
- **I gang (fundament):** fundament-opsætning før launch (se *Drift & udvikling*). AppSignal (trin 0) **virker** — fejlsporing live via `sendError`-handler, request-instrumentering bekræftet på Express 5. Næste fundament-brik: staging-split (Railway-miljø + **separat** Supabase-projekt + versionerede migrationer), derefter Frisbii-livscyklus. **De to nye to-dos fra 28/6** (skema-skævhed `firms.phone_number` unique-constraint + tydeligere/sikrere reset-flow) lander som rene migrationer/ændringer på dette spor.
- **Gjort:** hvidliste-numre kan nu udfyldes i onboardingen (**trin 5**, valgfrit) — løser discoverability-hullet (før kunne det kun gøres på profilsiden bagefter). Success-skærmen guider desuden til at gemme appen på hjemmeskærmen (PWA, auto-detekteret iPhone/Android).
- (Valgfrit) Ægte ét-tryks "Installér"-knap på Android kræver et `<link rel="manifest">` + `beforeinstallprompt`-håndtering på siden; pt. er PWA-installationen ren tekstvejledning (robust, virker på både iOS og Android). Ideelt installeres fra `/dashboard` (PWA-scope), hvilket vejledningen guider til.
- (Valgfrit) `alter table firms add column created_at timestamptz not null default now();` — til statistik senere; gør også `/api/mig`-sortering muligt på nyeste.
- Måle den faktiske ringe-tid før viderestilling på rigtige telefoner → evt. stramme "~20-30 sek." til et fast tal i UI'et.
- Sætte rigtige håndværkere på (efter en sidste ende-til-ende-test med et frisk `provision-test-firm.js --onboarding`).
- **Dubletter (huskeliste):** `UNIQUE(call_id)` er på plads → samme-opkald-dubletter er **allerede** blokeret. ⚠️ **De sidst sete dubletter blev slettet manuelt → kilden er uafklaret. Næste gang: kør diagnosen FØR du sletter** (`select count(*) filter (where call_id is null) from leads;` — NULL-tal = manuelle/form-uden-call_id; ingen NULL men stadig dubletter = flere `calls`-rækker pr. opkald). Resterer ellers: (1) graceful upsert (`onConflict: 'call_id', ignoreDuplicates`) på form-submit så 2. submit ikke kaster 23505 mod kunden, og (2) `CallSid`-dedup opstrøms i `/opkald` hvis kilde 2. Se *Drift & robusthed → Snart*.
- Distinkt "du tog telefonen" vs. "viderestilling ikke sat op" kræver en `statusCallback` på det udgående verifikations-opkald (ikke lavet endnu).
- **Tydeligere + sikrere "nulstil adgangskode"/login-link-flow — STORT SET LØST 13/7** (egen rescue-skabelon + puf-banner efter link-login; rate-limit/anti-enumeration bevaret — rest er evt. en dedikeret side, lav prioritet). Oprindeligt krav: i dag er den eneste vej til et nyt login-link knappen **"Send mig et login-link"** på login-skærmen (→ `onboarding-link.js` → `sendWelcomeMail`). Der findes ingen dedikeret "glemt adgangskode"-flow. **Byg et tydeligere, selvstændigt skridt** til at anmode om nulstillings-/login-link. **Sikkerhed er en del af kravet, ikke en eftertanke:** et reset-/link-endpoint må aldrig kunne misbruges til inbox-spam, kvote-afbrænding eller email-enumeration. `onboarding-link.js` har allerede rate-limiting (cooldown pr. email + IP), generisk anti-enumeration-svar (afslører aldrig om en email er kunde), og sender kun hvis firmaet faktisk findes — **et nyt reset-flow SKAL bevare alle tre.** (Magic-/reset-links er email-gatede: linket går til indehaverens indbakke, så en fremmed kan ikke anmode sig ind i en andens konto — men de kan spamme/afbrænde kvote uden beskyttelsen.) NB: forudsætter at mail-leverancen virker — en pænere, sikrere knap hjælper ikke hvis mailen aldrig når frem (se mail-leverance-fælden nedenfor).
