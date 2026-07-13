# Oplæg til ny chat: mobil-hvid-skærm + rescue-mail (skrevet 12/7-26)

**Kontekst-kort:** Dit Digitale Kontor (tidl. LommeKontor) — dansk B2B SaaS: håndværkeres
ubesvarede opkald → SMS-lead med formularlink. Ann = teknisk co-founder (backend/infra,
Windows/PowerShell 5.1, oplæring i git/drift undervejs — forklar hvorfor før hvordan, ét
skridt ad gangen, komplette kørbare filer, spørg ved tvivl, svar på dansk). Anne = makker,
design/UX/indhold, ingen udviklerbaggrund. Stack: Node/Express (CommonJS, Express 5) på
Railway EU West (staging + prod, custom domæne `opgave.ditdigitalekontor.dk` på prod),
Supabase eu-west-1 (staging `hehrvdmtzokzbnbihcel` / prod `glymuxqtrbpeyzmflilf`), Twilio
(subkonto = staging), Scaleway TEM, ElevenLabs. Deploy: feature-gren → merge `staging`
(auto-deploy) → røgtest → PR `staging`→`main` (main er PR-beskyttet). Primer + runbook
ligger i repoets `docs/` og uploades sammen med dette oplæg.

**Status der er relevant:** Frontend læser Supabase-config fra `/config.js`-ruten
(`app-config.js` — env-baseret, fail-closed; indført 10-11/7 efter hardcodet prod-config
i HTML'erne). SMS-segmentfejlen er rettet og deployet 12/7. Prod indeholder to firmaer:
"Prodfirma Røg" (Anns test) + pilot #0 (Anne) — begge provisioneret 12/7, fulde flow
verificeret på Anns PC/telefon-SMS-side. PWA: service worker `static/sw.js`, cache-version
bumped til v15 ved config-fixet. Magic links er token_hash-baserede (prefetch-sikre) og
virker; `/dashboard`, `/config.js`, `/sw.js` svarer alle 200 i prods HTTP-log.

---

## Opgave 1 (høj prioritet): HVID SKÆRM på mobil-dashboard

**Symptom:** Både Ann og Anne får en helt hvid side på TELEFONEN, når de åbner
dashboardet (`https://opgave.ditdigitalekontor.dk/dashboard`). På PC virker alt.
HTTP-loggen (12/7) viser 200 + normale svartider for /dashboard, /config.js,
/manifest.json og /sw.js ved forsøgene — serveren leverer; fejlen sker i klienten.

**Tidligere observationer (11/7, FØR prod-nulstillingen):**
- Formularlink på Anns telefon: langt tryk viste preview af formularen; slip → hvid side;
  INKOGNITO-fane → formularen virker. (Inkognito ≈ ingen service worker.)
- Dashboard på telefon: hvid; på PC: fint.
- OBS: prod blev nulstillet 11/7 og firmaerne gen-provisioneret — men telefonerne kan
  stadig bære gamle service workers/PWA-installationer fra før.

**Hovedmistanke (UBEKRÆFTET):** service workeren. Scope dækker hele domænet, så den
intercepter både /dashboard og kundeformularen. Mulige mekanismer: (a) gammel SW/cache
serverer en forældet dashboard.html; (b) SW'ens fetch-strategi håndterer /config.js
forkert (den serveres med Cache-Control: no-store og SKAL altid gå til nettet) →
window.APP_CONFIG undefined → `supabase.createClient(undefined, …)` kaster → hvid side;
(c) sw.js-bump v15 nåede måske aldrig med i config-fix-committet (blev tilføjet via
--amend — verificér i den deployede fil).

**Diagnoseplan (i rækkefølge — bekræft/afkræft før der røres kode):**
1. På telefonen: åbn `https://opgave.ditdigitalekontor.dk/config.js` direkte → viser den
   prod-config? (Server-aksen frikendes.)
2. Åbn /dashboard i PRIVAT fane på telefonen → virker det dér, er SW/cache-teorien bevist.
3. Kig i den DEPLOYEDE sw.js (View Source på /sw.js): hvilken cache-version? Hvilken
   fetch-strategi — og undtager den /config.js og /formular-stierne?
4. Slet PWA + website-data for domænet på én telefon → geninstallér → virker det så?
5. Hvis intet af det: mobil-JS-fejl i dashboard.html — fejlfind med remote inspection
   (Android: chrome://inspect) eller midlertidig fejl-overlay.

**Filer den nye chat skal bruge:** `static/sw.js` (ALDRIG set i denne chat — nøglefil!),
aktuelle `static/dashboard.html`, evt. `static/onboarding.html`. Sandsynligt fix-mønster:
SW-strategi der (a) aldrig cacher /config.js, (b) network-first for HTML, (c) lader
kundeflowets stier (/formular, /:slug/:token) helt urørte + version-bump og opdaterings-
flow. Husk: kundens telefon har ALDRIG SW'en (kun håndværkere, der har besøgt appen) —
så kundeflowet er formentlig kun ramt på "egne" telefoner, men det skal bevises.

## Opgave 2 (lille, afgrænset): separat rescue-mail-skabelon

**Symptom:** "Send mig et login-link"-endpointet genbruger VELKOMSTMAILEN ("Velkommen —
din konto er klar", telefonnummer-boks, "færdiggør din opsætning"). Forvirrende/skræmmende
for en eksisterende kunde, der bare har glemt sit password. Linket selv virker.

**Fix:** ny `sendLoginLinkMail`-funktion + rescue-endpointet peger på den. Velkomst-
skabelonen røres IKKE. Bevar rate-limit og anti-enumeration uændret.

**Tekstforslag (Anne polerer ordlyden; strukturen bør stå):**
> Emne: Dit login-link til Dit Digitale Kontor
> Hej! Du har bedt om et nyt login-link. Klik her for at logge ind: [Log ind]
> Linket er gyldigt i 24 timer og kan bruges én gang.
> Har du ikke selv bedt om det, kan du roligt ignorere denne mail — der er ikke
> ændret noget på din konto.

Bevidste valg: intet "velkommen"/"konto klar", ingen opsætningsinstruks, tryghedslinje
ved uopfordret mail, ingen nummer-boks.

**Filer den nye chat skal bruge:** `onboarding-link.js` (rescue-endpointet) + `mail.js`
(hvis skabelonerne bor dér).

## Rækkefølge-anbefaling
Start med opgave 2 (lille sejr, uafhængig), MENS diagnosepunkt 1-4 for opgave 1 udføres
på telefonerne — de kræver ingen kode, kun observationer, og resultatet afgør hvor stor
opgave 1 reelt er. Anne er i gang med sit pilot-gennemløb; hendes mobil-fund hører til
opgave 1.

## Røgtest-opskrifter (efter fix)
- Opgave 2: staging → bed om nyt link → mailens ordlyd + linket logger ind → PR til main.
- Opgave 1: på en telefon MED gammel PWA: opdater → dashboard viser login/indhold (ikke
  hvidt) → formularlink virker i normal fane → gentag på ren telefon/privat fane.
