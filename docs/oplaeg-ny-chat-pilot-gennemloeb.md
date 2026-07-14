# Oplæg til ny chat: pilot-gennemløb (Anne) + fejlhøst (skrevet 13/7-26)

**Kontekst-kort:** Dit Digitale Kontor (tidl. LommeKontor) — dansk B2B SaaS: håndværkeres
ubesvarede opkald → SMS-lead med formularlink. Ann = teknisk co-founder (backend/infra,
Windows/PowerShell 5.1, oplæring i git/drift undervejs — forklar hvorfor før hvordan, ét
skridt ad gangen, komplette kørbare filer, spørg ved tvivl, svar på dansk). Anne = makker,
design/UX/indhold, ingen udviklerbaggrund, pilot #0 i prod. Stack: Node/Express (CommonJS,
Express 5) på Railway EU West (staging + prod, custom domæne
`opgave.ditdigitalekontor.dk`), Supabase eu-west-1, Twilio (subkonto = staging), Scaleway
TEM, ElevenLabs. Deploy: feature-gren → merge `staging` (auto-deploy) → røgtest → PR
`staging`→`main` (main er PR-beskyttet). Primer + runbook (nu
`ditdigitalekontor-drift-runbook.md`) bor i repoets `docs/` og uploades med dette oplæg —
**læs primerens "NYESTE (13/7)"-afsnit og faldgruberne først.**

**Status der er relevant (alt fra 13/7 er i prod og røgtestet):**
- Hvid skærm på mobil LØST (rodårsag: ukapslet `Notification.requestPermission()` på
  iPhone Safari + SW-navigation-kapring). `sw.js` er v17: allowlist, network-first for
  `/dashboard`, kundeformular//onboarding//config.js røres aldrig → rene HTML-ændringer
  slår igennem UDEN sw-bump.
- Dashboard har et **midlertidigt fejl-overlay** (rød bjælke m. fejltekst ved ufangede
  JS-fejl) + `crossorigin="anonymous"` på supabase-CDN-tagget, så fejltekster er ægte
  (ikke "Script error."). Overlayet viser OGSÅ godartede fejl — det er et
  pilotfase-diagnoseværktøj.
- Rescue-flowet komplet: egen mail-skabelon (`sendLoginLinkMail`) + puf-banner efter
  link-login (`/dashboard#nyt-login`) med genvej til profilens pw-felt.
- Session-hærdning: kodeskifte trækker andre sessioner tilbage → klienten falder nu
  roligt tilbage til login (loadData-guard, SIGNED_OUT-håndtering, sikret 30-sek-poller).
- Nye ikoner + `?v=2`-cache-buster. **Nyeste tilføjelse (13/7, tjek om deployet):**
  viderestillings-kort på profilsiden — firmaets nummer + til/fra-koder
  (`**61*<nr>#` / `##61#`) med Kopiér-knapper; `phone_number` er føjet til loadData's
  firms-select.

---

## Opgave 1 (hovedspor): Annes fulde pilot-gennemløb — guides og fejlhøstes

Runbookens autoritative udestående-liste (sidste sektion) har dette som punkt 1.
Gen-onboarding af Anne er fravalgt (ville destruere pilot #0 + rotere nummer). Køreplan:

1. **Ægte opkald → lead i HENDES dashboard (prod):** ring til Annes nummer fra et nummer
   der IKKE står på hendes hvidliste (⚠ tjek hvidlisten FØRST — hvidlistede numre får
   med vilje ingen SMS og ligner en fejl). Lad den ringe ubesvaret (~20-30 sek. før
   viderestilling) → SMS → formular → leadet lander i dashboardet på Annes iPhone.
2. **Rescue-stien (prod, Annes konto):** log ud → "Send mig et login-link" → ny
   rescue-mail → login → puf-banner vises → genvej til pw-felt → ny kode virker.
   (Første prod-test af puffet hos en anden bruger end Ann.)
3. **Mobil generelt (prod):** dashboard + formularlink i normal Safari-fane på begge
   iPhones — ingen inkognito-krykker, ingen hvid skærm. Viderestillings-kortet på
   profilsiden viser Annes nummer og koder (dét kort løser "Anne mistede sit nummer").
4. **Onboarding på mobil (staging, engangs-testfirma):** provisionér frisk firma
   (`provision-test-firm.js --onboarding` mod staging), Anne kører hele onboardingen på
   sin iPhone inkl. PWA-installation til sidst. Ryd op bagefter. Pilot #0 røres ikke.

**Exit-kriterium:** alle fire grønne → pilot-rekruttering af rigtige håndværkere kan
starte (drejebog i docs/; Anne ejer formular/kommunikation).

## Opgave 2 (løbende): fejlhøst/triage af overlay-fund

Alt, hvad den røde bjælke viser under gennemløbet, meldes med ordret fejltekst + hvornår
(straks/efter tid/efter handling). Kendt mistænkt: sporadisk **"Script error."** på
iPhone (dashboard virker; kommer og går) — formentlig godartet supabase-baggrundsfejl;
med crossorigin aktiv kommer den ægte tekst nu frem → døm den. Godartede fund føder
kodeopgave 10 (dæmp/afmontér overlayet når piloten er stabil); ægte fejl fixes ad den
vante vej (feature-gren → staging → røgtest → PR).

## Småopgaver (kan tages som pauser)
- PWA slet+geninstallér på begge iPhones (nyt hjemmeskærms-ikon).
- Frisbii staging-oprydning: expire trial-testabonnementer + omdøb planer efter egenskab.

## Filer den nye chat skal bruge
`docs/ditdigitalekontor-primer.md` + `docs/ditdigitalekontor-drift-runbook.md` (altid),
aktuelle `static/dashboard.html` og `static/sw.js` ved fejl-fund, `onboarding.html` ved
onboarding-fund. HTTP-log/Railway-log + AppSignal ved serverside-mistanke.

## Rækkefølge-anbefaling
Punkt 1 er kernen (produktet ER ubesvarede opkald → leads) — start dér. Punkt 2-3 kan
tages samme session. Punkt 4 kræver staging-opsætning og kan ligge sidst. Fejlhøsten
kører hele vejen igennem.
