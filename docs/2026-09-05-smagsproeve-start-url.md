# Smagsprøve: engangstoken i `start_url`

Skrevet 5. september 2026. Svarer på ét spørgsmål: **hvor svært er det at få
appen til at åbne på `/dashboard` uden logon?**

Kort svar: mekanikken er lille — omkring 70 linjer fordelt på fire filer, og
ingen af dem er nye idéer. Men den hviler på én iOS-adfærd, som ingen af os har
set virke. `proev-app-start.js` måler den på ét install.

---

## 1. Kør målingen først

```
require("./proev-app-start")(app);      // én linje i server.js, ved de andre require-kald
```

Deploy til staging. Åbn `/proev` på iPhone i Safari, notér mærket, føj til
hjemmeskærm, luk Safari helt, åbn fra ikonet.

| Skærmen siger | Betydning |
|---|---|
| **JA** + samme mærke | iOS bager manifestets `start_url` ind i ikonet. Vejen er farbar. |
| **JA** + andet mærke | Mekanikken virker, men iOS cachede et gammelt manifest → manifestet skal have en cache-buster. |
| **NEJ** | iOS åbnede bare den side, du stod på. Engangstoken i `start_url` er en blindgyde, og kodesporet er den rigtige vej. |

Modulet monterer sig **kun** når `APPSIGNAL_APP_ENV !== "production"` (samme
miljøgate som `mail.js`). Det rører hverken database, konti eller mail.

Siden måler samtidig `display-mode` og `navigator.standalone` i en **ægte**
installeret app — det åbne punkt i **D45**, hvor `isStandalone()`-grenen fra 5/9
aldrig er set virke i appen. To ubekendte, ét install.

Baggrunden står i registrets ændringslog 5/9 og i D45: app-hilsenen i
`dashboard.html` fyrer på `mm || ns` og kan derfor ikke bruges som bevis for en
gren, der kræver `mm && ns`.

Slet filen og require-linjen, når svaret er i hus. Det er et måleredskab, ikke
en feature.

---

## 2. Hvad der skal bygges, hvis svaret er JA

### `/onboarding` har intet manifest i dag

Verificeret i `static/onboarding.html`: ingen `<link rel="manifest">`, ingen
`apple-touch-icon`, ingen `apple-mobile-web-app-capable`. Installationen sker
fra netop den side (s-8 til s-11). Der er altså ikke et `start_url`, der skal
*ændres* — der skal først være et manifest overhovedet.

### Tokenet behøver ikke være nyt

Supabases eget `generateLink` giver et `hashed_token`, som allerede er
engangsbrug og udløber af sig selv — præcis det, `onboarding-link.js` bruger i
dag (linje 46-64). Ingen ny tabel, ingen ny hemmelighed, ingen ny udløbslogik.

### De fire dele

| # | Fil | Hvad | Ca. |
|---|---|---|---|
| 1 | `onboarding.js` | `POST /onboarding/app-token` (Bearer) → mint `hashed_token` for brugerens e-mail | 20 linjer |
| 2 | `server.js` | `GET /app-manifest.json?t=…` → manifest med `start_url: /dashboard?token_hash=…&type=email` | 15 linjer |
| 3 | `server.js` | `/onboarding`-ruten injicerer `<link rel="manifest" href="/app-manifest.json?t=…">` i head'en | 5 linjer — hooket findes allerede (linje 427) |
| 4 | `static/dashboard.html` | Løs `token_hash` fra URL'en ved boot, fald blidt tilbage på sessionen | 15 linjer — kopi af `init()` i onboarding.html (linje 1043-1057) |

### Den ene rigtige forhindring

Tokenet kendes **ikke** ved sideindlæsning. Brugeren logges ind client-side med
`verifyOtp`, længe efter head'en er sendt. To veje:

- **(a) JS udskifter `href` på manifest-linket**, når kunden når s-8. Mindst
  arbejde — men det er uafklaret, om WebKit læser et manifest-link, der ændres
  efter load. Endnu en ubekendt oveni.
- **(b) Et rigtigt sideskift** til `/onboarding?trin=app&t=<token>` lige før
  installationsguiden. Serveren renderer manifest-linket ind i head'en fra
  starten, og der er intet at være i tvivl om. Sessionen ligger i localStorage
  og overlever genindlæsningen i Safari.

**(b) er den sikre**, og den koster kun et sideskift, kunden ikke ser som andet
end "Næste". Vælg den. `/proev` bruger med vilje samme mønster, så målingen
tester den vej, vi rent faktisk vil gå.

---

## 3. Tre ting, der skal med i designet

**`start_url` bages permanent ind.** Fra anden åbning er tokenet brugt. Appen må
aldrig vise en fejl på det — dashboardet skal prøve tokenet, og ellers falde
tilbage på sessionen fra første åbning, og ellers på login. Samme rytme som
`init()` i onboarding.html allerede har.

**Tokenet ligger for altid i ikonet på telefonen.** Engangsbrug og udløb gør det
harmløst, men det må aldrig havne i en log. Ryd URL'en med
`history.replaceState` straks efter, præcis som onboarding.html gør (linje 1049).

**At minte et nyt link dræber det forrige i indbakken.** Uden betydning her:
kunden er allerede logget ind, når s-8 nås. Men det er værd at vide, hvis
tokenet en dag skal mintes tidligere i flowet.

---

## 4. Dommen

Hvis målingen siger JA: en halv dags arbejde inkl. test, og ingen af delene er
uprøvet mekanik — det er fire kendte mønstre sat sammen.

Hvis den siger NEJ: vi har brugt ét install på at undgå at bygge det, og
kodesporet er svaret. Det er stadig en god handel.

Uanset hvad: **ikke før mandag.** Målingen kan tages nu; bygningen hører til
efter go-live.
