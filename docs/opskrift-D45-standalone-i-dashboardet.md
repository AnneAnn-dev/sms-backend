# Opskrift: D45 — standalone-detektionen i dashboardet (skrevet 5/9-26)

**Målet:** to ting, i denne rækkefølge. Først **måle**, om den nye
`isStandalone()` overhovedet svarer sandt i en ægte installeret app — det
afgør, om `fix/ios-standalone-diag` kan merges til `main`. Derefter **rette**
`dashboard.html`, så app-hilsenen ikke længere fyrer i en mailapps indbyggede
browser.

**Forudsætninger:** grenen `fix/ios-standalone-diag` ligger i `staging` ·
`docs/2026-09-05-smagsproeve-start-url.md` med `proev-app-start.js` ·
en iPhone med Safari · en testmail, du kan sende et dashboard-link til.

**Princippet bag det hele:** et signal skal vælges efter hvad det
**udelukker**, ikke efter hvad det bekræfter. `navigator.standalone` er sand
både i en ægte hjemmeskærms-app og i SFSafariViewController og kan derfor
ikke alene skelne dem. `display-mode: standalone` er falsk i den indbyggede
browser og skal derfor være grundsignalet — *forudsat* den er sand i den ægte
app. Præcis det er ikke målt endnu.

---

## Fase 0 — Hvorfor rækkefølgen ikke må byttes om

Rettelsen i `onboarding.html` fra 5/9 kræver `mm && ns` på iOS. Er `mm` falsk
i en ægte hjemmeskærms-app, er den rettelse forkert, og så skal **både**
onboarding og dashboard have en anden løsning.

Retter du dashboardet først, bygger du i så fald den samme fejl to steder i
stedet for ét. Mål først.

---

## Fase 1 — Målingen

Den ligger allerede beskrevet i `docs/2026-09-05-smagsproeve-start-url.md`.
`/proev` måler `display-mode` og `navigator.standalone` i en ægte installeret
app — og samtidig om `start_url` bages ind i ikonet. To spørgsmål, ét install.

1. Tilføj require-linjen i `server.js` ved de andre require-kald:
   ```js
   require("./proev-app-start")(app);
   ```
   Modulet monterer sig kun når `APPSIGNAL_APP_ENV !== "production"`.
2. Deploy til staging. Bevis at den er med — noget der ikke fandtes før:
   ```powershell
   (Invoke-WebRequest "https://sms-backend-staging-908c.up.railway.app/proev").StatusCode
   ```
3. Åbn `/proev` på iPhone **i Safari**. Notér mærket.
4. Føj til hjemmeskærm. **Luk Safari helt** — swipe den væk, ikke bare skift.
5. Åbn fra ikonet. Aflæs `ns`, `mm` og mærket.

### Hvad de tre udfald betyder for D45

| Måling | Betydning | Hvad du gør |
|---|---|---|
| `mm=true ns=true` | Rettelsen fra 5/9 holder i den ægte app | Fortsæt til fase 2. Grenen kan merges |
| `mm=false ns=true` | `mm && ns` er **forkert** — appen ville se sig selv som browser | **STOP.** Gå til fase 4. Grenen må ikke merges |
| begge `false` | Appen kører ikke standalone — installationen er ikke lykkedes | Undersøg installationen først; målingen siger intet om D45 |

6. Fjern require-linjen og filen igen, når svaret er i hus. Det er et
   måleredskab, ikke en feature.

⚠️ **Brug ikke app-hilsenen som måling.** Den vises kun én gang
(`localStorage`-nøglen `ddk-app-hilsen-vist`), og den fyrer på `mm || ns` —
altså netop den eftergivende form, D45 handler om. Den kan ikke skelne de to
udfald ovenfor. Det er hele grunden til, at `/proev` findes.

---

## Fase 2 — Rettelsen i `dashboard.html`

**Kun hvis fase 1 gav `mm=true`.**

Blokken ligger ~linje 395-405, lige under `#app-hilsen`-markupen. Erstat de to
linjer, der beregner `standalone`:

```js
      var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                       window.navigator.standalone === true;
```

med:

```js
      // RETTET (D45): den gamle form spurgte "mm ELLER ns", og ns er SAND i
      // SFSafariViewController — den browser en mailapp aabner links i. En
      // kunde, der trykkede paa et dashboard-link i sin mail, fik derfor
      // "Dit Digitale Kontor er klar" uden at have installeret noget.
      // Maalt 5/9-26 paa iPhone: ns=true, mm=false i den indbyggede browser.
      // Samme rettelse som isStandalone() i onboarding.html.
      var ua    = navigator.userAgent || '';
      var erIOS = /iPhone|iPad|iPod/i.test(ua) ||
                  (/Macintosh/.test(ua) && 'ontouchend' in document);
      var mm    = !!(window.matchMedia &&
                     window.matchMedia('(display-mode: standalone)').matches);
      var standalone = erIOS ? (mm && window.navigator.standalone === true) : mm;
```

Resten af blokken står urørt — `try/catch`, `localStorage`-nøglen og
kommentaren om at hilsenen aldrig må vælte dashboardet.

⚠️ Tjek at der ikke er flere steder:

```powershell
Select-String -Path static\dashboard.html -Pattern "display-mode|navigator.standalone"
```

Der skal være **præcis ét** sted efter rettelsen. Var der to, er det andet
sted også med i D45.

Husk `sw.js`-bump — frontend-ændring.

---

## Fase 3 — Beviset, begge veje

Et værn, man aldrig har set fyre, er dekoration. Samme metode som D43: se
fejlen ske, og se den holde op med at ske.

**Rækkefølgen er vigtig — prøve A skal køres FØR deployet.**

**Prøve A — den falske hilsen, med den gamle kode:**

1. Ryd sidedata for staging-domænet: Indstillinger → Safari → Avanceret →
   Websitedata → find domænet → slet. (Det er også SFSafariViewControllers
   lager.)
2. Send dig selv en mail med et link til staging-dashboardet.
3. Åbn linket **inde i mailappen**.
4. Forventet med den gamle kode: hilsenen "Dit Digitale Kontor er klar."
   vises. **Det er fejlen, og nu har du set den.**

**Prøve B — efter deployet af fase 2:**

5. Ryd sidedata igen (ellers er `ddk-app-hilsen-vist` allerede sat, og
   hilsenen udebliver af den forkerte grund — prøven ville bestå uden at bevise
   noget).
6. Åbn samme link i mailappen igen.
7. Forventet: **ingen hilsen**. Du lander direkte på login-skærmen.

**Prøve C — at rettelsen ikke tog hilsenen med sig:**

8. Afinstallér appen fra hjemmeskærmen (det rydder appens egen lagring, som er
   adskilt fra Safaris).
9. Installér den igen fra Safari, luk Safari helt, åbn fra ikonet.
10. Forventet: hilsenen **vises**, én gang. Åbner du igen, er den væk.

⚠️ `localStorage`-nøglen er den største fælde i hele prøven. Glemmer du at
rydde den mellem A og B, ser B ud til at bestå — og du har bevist ingenting.

---

## Fase 4 — Hvis målingen sagde `mm=false`

Så kan de to flag ikke skelne en ægte app fra den indbyggede browser, og både
`onboarding.html` og `dashboard.html` skal have en anden løsning end den fra
5/9.

**Fristelsen er at finde et tredje signal** — vinduets højde mod skærmens,
fraværet af browser-UI, et geometri-skøn. Modstå den: den slags heuristik er
netop den slags, der virker på din telefon og fejler på kundens, og den kan
ikke måles færdig på en eftermiddag.

**Den robuste vej er at holde op med at gætte konteksten og i stedet spørge.**
Side 8 kan sige "Har du allerede Dit Digitale Kontor på din hjemmeskærm?" med
to knapper. Det er en designbeslutning frem for en detektionsopgave, den kan
ikke tage fejl, og den koster kunden ét tryk.

Uanset valget: `fix/ios-standalone-diag` skal ikke merges, før det er afklaret.

---

## Fase 5 — Deploy

Almindelig rytme, ingen migrationer:

1. `sw.js` bumpet (fase 2)
2. Commit på grenen, merge til `staging`, Railway auto-deployer
3. Bevis at ændringen er med — noget der ikke fandtes før:
   ```powershell
   (Invoke-WebRequest "https://<staging-url>/dashboard").Content -match "RETTET \(D45\)"
   ```
4. Prøve B og C fra fase 3
5. PR til `main`

---

## Bagefter / må gerne vente

- **D48** — den tredje tilstand på udløbet-skærmen ("du er kommet over i
  Safari — log ind med en kode"). Samme skærm, anden sag.
- **`start_url`-vejen** (smagsprøvens fase 2). Målingen i fase 1 giver svaret
  gratis, men bygningen hører til efter go-live.
- **D39's tekstrettelse** — timeout-beskeden har to årsager, ikke én.

---

## Hvorfor-noter (til genlæsning om et halvt år)

**Hvorfor `display-mode` er grundsignalet.** Fordi det er det eneste af de to,
der siger *nej* i den indbyggede browser. `navigator.standalone` siger ja
begge steder og bærer derfor nul information alene. Et signal er kun værd
noget for det, det udelukker.

**Hvorfor app-hilsenen ikke kan bruges som bevis.** Den fyrer på `mm || ns`.
Ser du den, ved du kun, at mindst ét flag er sandt — ikke hvilket. Og
`isStandalone()` kræver begge. Det var præcis dén sammenblanding, der efterlod
D45 uafklaret fredag aften.

**Hvorfor målingen skal ligge før rettelsen.** Fordi rettelsen fra 5/9 endnu
ikke er bevist i det ene tilfælde, den kan ødelægge: den ægte installerede
app. Retter man dashboardet i samme form først, har man skrevet den samme
ubeviste antagelse ned to steder — og så er den svær at få øje på.

**Hvorfor `.dj`-fejlen hører sammen med det her.** Både D45 og D46 er den
samme klasse: skærmen påstår noget om verden, som den ikke har målt. Den ene
påstår at appen er installeret, den anden at en mail er sendt. Ingen af dem
efterlader et spor, kunden kan se.
