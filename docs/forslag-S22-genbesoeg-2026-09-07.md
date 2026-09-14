# Forslag: S22 genbesoegt 7/9-26 - de to Dependabot-alerts

**Status:** forslag. Intet er skrevet i RISIKOREGISTER.md. Ann udfoerer selv.
**Skrevet:** 2026-09-07, af Claude, efter maaling - ikke efter hukommelse.

---

## 1. Konklusionen foerst

**De to alerts er ikke nye, og de er ikke uset. De er S22.**

Oplaegget til denne opgave sagde, at de dukkede op i et push soendag 6/9, og at
ingen havde set paa dem. Det passer ikke. S22 blev oprettet og accepteret 27/8
og efterproevet 4/9. Begge advisories er navngivet i `ci.yml`s egen kommentar.

**Derfor: opret ikke D57.** Et nyt nummer paa et registreret vilkaar giver to
raekker om samme sag, der kan komme til at sige hver sit. Skriv i S22 i stedet.

---

## 2. Hvad de to er

| | Hoej | Moderat |
|---|---|---|
| Pakke | `@opentelemetry/propagator-jaeger` | `@opentelemetry/core` |
| Installeret | 2.7.1 | 2.7.1 |
| Rettet i | 2.9.0 | 2.8.0 |
| CVE | CVE-2026-59892 | CVE-2026-54285 |
| GHSA | GHSA-45rx-2jwx-cxfr | GHSA-8988-4f7v-96qf |
| CVSS | 7.5 (A:H) | 5.3 (A:L) |
| EPSS | 0,784 % | 0,344 % |
| Sti | transitiv via `@appsignal/nodejs` 3.8.1 | transitiv via `@appsignal/nodejs` 3.8.1 |
| Naaelig? | **Nej, saa vidt maalt** | **Ja, saa vidt udledt** |

Den hoeje: `JaegerPropagator.extract()` kalder `decodeURIComponent()` uden at
gribe fejl. En header som `uber-trace-id: %` kaster `URIError` og *afslutter
processen*. Men advisory'en er utvetydig om betingelsen: man er kun ramt, hvis
JaegerPropagator er registreret som aktiv propagator - via `OTEL_PROPAGATORS=jaeger`
eller et eksplicit `propagation.setGlobalPropagator(new JaegerPropagator())`.
Bruger man standardpropagatorerne (W3C tracecontext + baggage), er man ikke ramt.

Den moderate: `W3CBaggagePropagator.extract()` haandhaever ingen stoerrelsesgraenser
paa indgaaende baggage-headere. W3C baggage er en af OpenTelemetrys **standard**-
propagatorer. Den er slaaet til, medmindre noget slaar den fra.

**Alvorsgraderne peger den forkerte vej.** Den hoeje sidder paa kode, der efter
alt at doemme aldrig aktiveres. Den moderate sidder paa vejen ind i hver eneste
forespoergsel - foer Twilio-signaturtjekket og foer S12-loftet. Det er praecis
den vurdering, registret allerede skrev 27/8.

---

## 3. Maalinger foretaget 7/9, med kilde

1. **`@appsignal/nodejs` er fortsat 3.8.1.**
   Kilde: `registry.npmjs.org/@appsignal/nodejs/latest`, 7/9-26.
   Dens egne `dependencies` binder `@opentelemetry/core` til `>= 2.6.0 < 2.7.0`.
   Rettelsen ligger i 2.8.0. **Der er stadig intet at installere.**
   Dependabot siger det samme: opdateringsstien ender paa 1.21.0 - en nedgradering.
   **Re-trigger 1 har ikke fyret.**

2. **`appsignal.cjs` paa `origin/main` konfigurerer ingen propagator.**
   Kilde: filen laest fra `raw.githubusercontent.com` paa `main`, 7/9-26 - altsaa
   serverens udgave, ikke en lokal gren (weekendens faelde nr. 1).
   Ingen forekomst af `propagator`, `OTEL_PROPAGATORS`, `setGlobalPropagator`
   eller `Jaeger`.

3. **Dependabot viser 2 aabne, 1 lukket.** 1 hoej + 1 moderat aaben.
   Kilde: GitHubs Dependabot-side, 7/9-26.
   Det stemmer med 4/9-optaellingen. `npm audit` taeller anderledes - skriv altid
   kilden med tallet.

---

## 4. To ting der ikke er maalt

**A. Er `OTEL_PROPAGATORS` sat i Railways prod-service?**
Det er det sidste, der skiller den hoeje fra at vaere teoretisk. Kode-siden er
ren, men en miljoevariabel kan slaa Jaeger til uden en commit. Ann skal aflaese
den i Railways konsol paa prod-servicen. Findes variablen ikke, er den hoeje
ikke naaelig, og *det* er beviset - ikke fravaeret af en kodelinje.

**B. Parses baggage-headeren faktisk indgaaende paa en koerende proces?**
Det var det udestaaende spoergsmaal fra 4/9. Advisory-teksten plus AppSignals
afhaengighedstrae (`@opentelemetry/instrumentation-http` ligger i det) peger
staerkt paa ja. **Men det er udledt af pakkelister og advisory-tekst, ikke
aflaest paa noget der koerer. Skrives som uafklaret.**

Maalingen, hvis den skal foretages: send en forespoergsel til staging med en
overdimensioneret `baggage`-header og se, om den naar frem og bliver parset.
Foretages paa staging, aldrig paa prod.

---

## 5. Det, der faktisk har flyttet sig

Ikke sårbarhederne. **Praemissen under accepten.**

S22's accept hviler blandt andet paa saetningen "produktet har nul betalende
kunder". Registret skrev 4/9, at den praemis udloeber mandag 7/9. Det er i dag.

Ann oplyser 7/9, at der lige nu er **nul kunder i prod**. Praemissen holder
altsaa stadig - men den holder paa dagsbasis nu, ikke paa ugebasis. Det er
forskellen paa et vilkaar og en tikkende post.

Det giver et vindue: saa laenge der ikke er kunder i systemet, er prisen ved at
roere ved afhaengighedstraeet lavere end den bliver senere. Men der er intet at
opgradere til, saa vinduet kan ikke bruges paa *denne* sag. Det kan bruges paa
S25 (`qs`), hvor der findes en rettelse - men det er en anden opgave.

---

## 6. Indstilling

**Accepten staar.** Der findes ingen rettelse at installere; det er maalt i dag,
ikke husket. Ingen af de to advisories aendrer den vurdering, registret traf 27/8.

**Men accepten skal have en dato nu, ikke en betingelse.** Formuleringen
"genbesoeges i driftsvinduet efter foerste betalende kunde" var rigtig, da
kunden var hypotetisk. Nu er den en betingelse, der kan fyre paa en tilfaeldig
tirsdag, hvor ingen kigger. Foreslaaet: en fast dato at genbesoege paa, uanset
kunder.

**Tre konkrete skridt, i den raekkefoelge:**

1. Aflaes `OTEL_PROPAGATORS` i Railway prod. Fem minutter. Lukker punkt 4A.
2. Opdater `ci.yml`s echo-blok. Den lister i dag `propagator-jaeger` og
   `sdk-node` som de to kendte fund. `sdk-node` er lukket, og
   `@opentelemetry/core` - den eneste af dem, der reelt kan naas - staar der
   ikke. Blokken skal naevne den, der betyder noget.
3. Skriv 7/9-maalingerne ind i S22 og i aendringsloggen. Udkast nedenfor.

---

## 7. Udkast til tekst i S22 (tilfoejes sidst i "Naeste skridt"-cellen)

> **7/9-26: grundlaget efterproevet, accepten staar, praemissen er smallere.**
> Re-trigger 1 har ikke fyret: `@appsignal/nodejs` er fortsat 3.8.1
> (npm-registret 7/9), og pakken binder selv `@opentelemetry/core` til
> `>= 2.6.0 < 2.7.0`, mens rettelsen ligger i 2.8.0. Intet at installere.
> Dependabots opdateringssti ender paa 1.21.0 - en nedgradering, som 27/8.
> Re-trigger 2 er ikke fyret: prod gik i luften 7/9, men der er nul kunder i
> prod pr. 7/9 (Anns oplysning). Praemissen holder, men paa dagsbasis.
> **Den hoeje er stadig ikke naaelig, og nu vides hvorfor praecist:** advisory
> GHSA-45rx-2jwx-cxfr rammer kun, naar JaegerPropagator er registreret aktivt
> (`OTEL_PROPAGATORS=jaeger` eller `setGlobalPropagator`). `appsignal.cjs` paa
> `origin/main` konfigurerer ingen propagator (laest 7/9). ⚠️ **Mangler:
> aflaesning af `OTEL_PROPAGATORS` i Railways prod-service** - en miljoevariabel
> kan slaa den til uden en commit.
> **Det udestaaende spoergsmaal fra 4/9 har faaet et svar, men et udledt et:**
> den moderate er `W3CBaggagePropagator.extract()` (GHSA-8988-4f7v-96qf), og
> W3C baggage er en standardpropagator, altsaa slaaet til medmindre noget slaar
> den fra. Det peger paa, at headeren parses paa vej ind. **Udledt af
> pakkelister og advisory-tekst, ikke aflaest paa en koerende proces -
> uafklaret.** ⚠️ **`ci.yml`s echo-blok er ikke fulgt med:** den naevner
> `sdk-node` (nu lukket) og ikke `@opentelemetry/core` - den ene af de tre, der
> reelt kan naas.

## 8. Udkast til aendringslog

> `| 2026-09-07 | **S22 efterproevet tredje gang; ingen aendring i selve fundene, men praemissen er smallere.** De to Dependabot-alerts fra 6/9 er ikke nye - det er S22's egne to advisories. Maalt 7/9: AppSignal er fortsat 3.8.1 og binder selv otel-core under 2.7.0, saa re-trigger 1 har ikke fyret. Re-trigger 2 heller ikke: nul kunder i prod pr. 7/9. **Alvorsgraderne peger den forkerte vej** - den hoeje (`propagator-jaeger`, CVSS 7.5) kraever en opt-in-konfiguration, vi ikke har; den moderate (`@opentelemetry/core`, CVSS 5.3) sidder paa standard-baggage-parsing, altsaa paa vejen ind i hver forespoergsel. **Lærdom: en alvorsgrad er en egenskab ved pakken, ikke ved installationen.** Udestaaende: `OTEL_PROPAGATORS` i Railway prod er ikke aflaest, og baggage-parsingen er udledt, ikke maalt. |`

---

## 9. Fundet undervejs, hoerer ikke til denne opgave

- **Registerteksten i S22 er brækket to steder.** Der staar
  `**Accepten h** 4/9: den anden re-trigger er ved at fyre.**` og senere
  `Skriv altid kilden med tallet.viler dermed paa et vaerktoej, der holder oeje`.
  En saetning - "Accepten hviler dermed paa et vaerktoej..." - er blevet klippet
  over og halen indsat et forkert sted. Teksten er stadig laesbar, men den ene
  halvdel staar nu inde midt i en anden pointe.
- **`engines` er `"22.x"`, ikke `22.23.2`.** Majoren er laast, patchversionen er
  ikke. Registret er praecist om dette (linje 154 citerer byg-loggen korrekt);
  det er oplaegget til denne chat, der forkortede det til et pin. Ingen
  handling - men "Node er pinnet til 22.23.2" boer ikke gentages.
- **S25 (`qs`) har en tilgaengelig rettelse** og er den eneste af de aabne
  afhaengighedsposter, hvor der faktisk er noget at installere. Det nul-kunde-
  vindue, der er aabent lige nu, passer bedre til den end til S22.
