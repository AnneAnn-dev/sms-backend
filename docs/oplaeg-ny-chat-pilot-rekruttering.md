# Oplæg til ny chat: pilot-rekruttering + klargøring til pilot #1 (skrevet 15/7-26)

**Kontekst-kort:** Dit Digitale Kontor (tidl. LommeKontor) — dansk B2B SaaS: håndværkeres
ubesvarede opkald → SMS-lead med formularlink. Ann = teknisk co-founder (backend/infra,
Windows/PowerShell 5.1, oplæring i git/drift undervejs — forklar hvorfor før hvordan, ét
skridt ad gangen, komplette kørbare filer, spørg ved tvivl, svar på dansk). Anne = makker,
design/UX/indhold, ingen udviklerbaggrund, pilot #0 i prod. Stack: Node/Express (CommonJS,
Express 5) på Railway EU West (staging + prod, custom domæne
`opgave.ditdigitalekontor.dk`), Supabase eu-west-1, Twilio (subkonto = staging), Scaleway
TEM, ElevenLabs. Deploy: feature-gren → merge `staging` (auto-deploy) → røgtest → PR
`staging`→`main` (main er PR-beskyttet). Primer + runbook bor i repoets `docs/` og
uploades med dette oplæg — **læs primerens "NYESTE (14-15/7)"-afsnit og faldgruberne
først.**

**Status der er relevant (alt i prod og røgtestet pr. 15/7):**
- **Annes fulde pilot-gennemløb er GRØNT** (alle 4 punkter: ægte opkald→lead, rescue-sti
  m. puf-banner, mobil inkl. viderestillings-kort, onboarding på mobil via staging).
  **Exit-kriteriet er opfyldt → rekruttering af rigtige håndværkere kan starte.**
- **Adresse-sporet lukket** (gren `fix/adrees-postnummer-by`): postnr/by forsvandt pga.
  dobbelt-påklistring + DAWA-trædesten ved kilden OG modalens ét-komma-parse +
  genskrivning ved hver lukning. Nu: `bygAdresse()`-chokepoint (server), `parseAddress()`
  bagfra (dashboard), closeModal skriver kun ved ændring, resultat-baseret DAWA-validering
  (adgangsadresse m. postnr = gyldig straks), `rens()` fjerner ", ,". Felter fjernet:
  "Hvornår passer det dig" (opret), Deadline + "Ønsket tidspunkt" (rediger). Haster
  persisteres nu reelt (`is_urgent` i closeModal — var gået tabt).
- Dashboardets **midlertidige fejl-overlay** (rød bjælke ved ufangede JS-fejl) kører
  stadig — det er pilotfasens diagnoseværktøj og viser OGSÅ godartede fejl.

---

## Opgave 1 (hovedspor): klargøring til pilot #1 — teknisk forudsætningstjek

Rekrutteringen er Annes (drejebog i docs/; hun ejer formular og kommunikation). Den nye
chats opgave er at sikre, at teknikken er klar til at modtage pilot #1, og at guide den
manuelle provisionering, når Anne har en kandidat:

1. **Prod-nummerpuljen** (runbook: infrastruktur-punkt 2): tjek antal ledige numre i
   `phone_numbers` på prod. Skal der købes flere: `buy-numbers.js` i HOVEDKONTOEN (ikke
   subkontoen = staging!) og med eksplicit `VOICE_URL` = prod — verificér voice-webhooks
   på de nye numre bagefter (`configure-number.js`).
2. **Pilot-drejebogens forudsætningsliste** gennemgås punkt for punkt (docs/) — herunder
   den manuelle dublet-email-rutine (kodeopgave 1 er IKKE løst; indtil da tjekkes
   kandidatens email manuelt mod eksisterende Auth-brugere før provisionering).
3. **Manuel provisionering af pilot #1** ad drejebogens vej, når kandidaten er klar
   (uden om Frisbii — betalingssporet afventer bankkonto/indløsningsaftale).
   ⚠ Kirurgi-reglen gælder: prod-oprydning kun pr. eksplicit firma-id; `reset-test-data.js`
   er permanent forbudt mod prod.
4. **Efter-onboarding-tjek hos piloten:** ægte opkald → SMS → formular → lead (husk:
   hvidlistede numre får med vilje ingen SMS), PWA-installation, viderestillings-kortet.

**Exit-kriterium:** pilot #1 kører i prod med egne ægte kundeopkald, og fund fra deres
første dage er høstet og triageret.

## Opgave 2 (sidespor): fejl-overlay-dommen (kodeopgave 10)

Annes gennemløb var fint — indhent om den røde bjælke overhovedet viste sig undervejs,
og om den sporadiske "Script error." på iPhone er set igen (crossorigin er aktiv, så
ægte fejltekst kommer nu frem). Beslut derefter: dæmp overlayet (ignorér kendte
godartede supabase-baggrundsfejl) eller afmontér det helt — SENEST før pilot #1
onboardes, så en rød bjælke ikke er det første, en fremmed håndværker ser.

## Småopgaver (kan tages som pauser)
- Frisbii staging-oprydning: expire trial-testabonnementer + omdøb planer efter egenskab.
- PWA slet+geninstallér på begge iPhones (nyt hjemmeskærms-ikon).

## Filer den nye chat skal bruge
`docs/ditdigitalekontor-primer.md` + `docs/ditdigitalekontor-drift-runbook.md` (altid),
pilot-drejebogen i docs/ ved opgave 1, `buy-numbers.js`/`configure-number.js` ved
nummerkøb, `static/dashboard.html` ved overlay-arbejdet (opgave 2). Railway-log +
AppSignal ved serverside-mistanke.

## Rækkefølge-anbefaling
Start med opgave 2 (overlay-dommen) eller småopgaverne, hvis Anne endnu ikke har en
pilotkandidat — de er små og uafhængige. Opgave 1's punkt 1-2 (nummerpulje +
forudsætningsliste) kan og bør køres FØR kandidaten findes, så provisioneringen ikke
venter på teknik den dag, en håndværker siger ja.
