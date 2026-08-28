# Oplæg til ny chat — det røde badge for nye opgaver

*Indsæt hele denne tekst som første besked i den nye chat.*

---

## 0. Arbejdsregel — læs denne først, og afvig ikke fra den

Du arbejder **udelukkende** i mappen `C:\Users\Bruger\claude-arbejdstrae`.

Det er en kopi af repoet, lavet med `git archive HEAD`, altså **uden `.git` og uden `.env*`**. Det er ikke en formalitet: der har ligget nøgler i git-historikken (risiko **S1**), og `.env.prod` bærer live-nøgler til Supabase `service_role`, Twilio og SMTP. Kopien er verificeret fri for begge dele, før den blev forbundet.

Konkret betyder det:

- **Du må ikke bede om adgang til `sms-backend`-mappen.** Heller ikke "kun for at læse", heller ikke til `.git`. Mangler du noget derfra, så spørg — jeg henter det.
- **Du skriver aldrig i repoet.** Rettelser leveres som ændrede filer i `claude-arbejdstrae`; jeg kopierer selv ind og committer.
- **Du rører ikke git, Supabase, Railway, Twilio eller Frisbii.** Du foreslår, jeg kører. Alt der koster penge eller rammer produktion, gør jeg.
- **Bliver arbejdstræet forældet**, laver jeg et nyt sådan her — spørg efter det frem for at arbejde videre på gammel kode:

  ```powershell
  $dest = "C:\Users\Bruger\claude-arbejdstrae"
  Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  git archive HEAD --format=zip -o "$env:TEMP\ddk.zip"
  Expand-Archive "$env:TEMP\ddk.zip" -DestinationPath $dest -Force
  Remove-Item "$env:TEMP\ddk.zip"
  ```

**Persondata:** send aldrig rå logudtræk eller databaserækker ind i samtalen. Håndværkerens kunders telefonnumre og mailadresser er persondata, hvor vi er databehandler (**J1**, **J3**). Beskriv i stedet strukturen: "linjen ser sådan ud: `Ny opgave fra <navn>, <nummer>`". Det er lige så brugbart.

---

## 1. Opgaven

Det røde badge, der fortæller håndværkeren, at der er kommet en ny opgave, skal gennemgås og bringes i orden.

Der er reelt **tre visninger af samme tal**, og de er ikke nødvendigvis enige:

1. **App-ikonets badge** på hjemmeskærmen — `navigator.setAppBadge(count)`
2. **Fanens titel** — `document.title = "(3) Leads"`
3. **"Ny"-mærket** på den enkelte opgave i listen — `<span class="badge badge-new">Ny</span>`

Afklar først med mig, hvilken af de tre der driller, hvis det ikke fremgår. Spørg frem for at gætte.

---

## 2. Hvor koden er

Alt ligger i `static/dashboard.html` (linjenumre er fra arbejdstræets version — verificér dem, filen ændrer sig):

| Hvad | Sted |
|---|---|
| `updateBadge(count)` — sætter titel + `setAppBadge` | ~1793 |
| Badge-CSS (`.badge-new`, `.badge-urgent` m.fl.) | ~179-185 |
| Optælling ved render | ~1118 og ~1137 |
| "Ny"-mærket pr. opgave | ~1132 |
| Nulstilling når en opgave åbnes (`seen_at` sættes) | ~1563-1569 |
| Filteret "Nye" | ~1102 |
| 30-sekunders-polleren | ~1939-1956 |

Serversiden: `server.js:329` (`/formular/:token`, kundens egen formular) sætter **ikke** `seen_at` — derfor tæller et nyt kundelead med. `server.js:512` (`/opret-opgave`, manuel oprettelse) sætter `seen_at` med det samme, så en opgave håndværkeren selv har skrevet, aldrig er "ny". Begge dele er som de skal være.

---

## 3. Fire spor, jeg gerne vil have efterprøvet

Det er **observationer, ikke konklusioner.** Bekræft eller afkræft hver enkelt i koden, før du foreslår noget.

**(a) Polleren sammenligner antal, ikke identitet.** Hvert 30. sekund tælles ulæste leads og sammenlignes med det lokale tal; er de ens, genindlæses der ikke. Kommer der ét nyt lead, samtidig med at ét gammelt ulæst bliver åbnet i samme vindue, er summen uændret — og det nye lead dukker ikke op. Verificér om det kan ske i praksis.

**(b) To forskellige definitioner af "ny".** Badge og "Ny"-mærke tæller `!seen_at && status === 'open'`. Polleren tæller kun `!seen_at`, uden statusfilteret — begge sider af sammenligningen. Et ulæst lead med status `completed` eller `rejected` tæller altså med ét sted og ikke det andet. Afgør om det kan give et badge, der aldrig går i nul.

**(c) `setAppBadge` kan fejle tavst.** API'et findes kun i den installerede PWA, og på iOS kræver det som udgangspunkt, at brugeren har givet lov til notifikationer. Kaldet står i dag uden `.catch()`. Vær varsom her: et ukapslet `Notification.requestPermission()` var netop rodårsagen til den hvide skærm på mobil 13/7 — se primerens faldgrube "Web-API'er skal guardes". Foreslå ikke at bede om notifikationstilladelse uden at tage den historie med.

**(d) Sammenhæng med statusfeltet.** Runbogens udestående punkt 22 planlægger et rigtigt statusfelt på opgaver (`ny` → `i gang` → `afsluttet`). Hvis det bygges, overlapper det med `seen_at`. Overvej om badgen skal hvile på `seen_at` eller på status — men **byg ikke statusfeltet her**; det er en selvstændig opgave med en afklaring hos Anne foran sig.

---

## 4. Konventioner der gælder

- **Dansk.** Al kommunikation og alle kodekommentarer.
- **Komplette kørende filer, inden for rimelighed** — ikke diffs. Er filen stor, så vis den ændrede funktion i sin helhed og sig præcis, hvor den skal ind.
- **CRLF bevares.** Alle dokumenter og HTML-filer i repoet bruger CRLF. Konverteres de til LF, viser `git diff` hele filen som ændret, og så kan jeg ikke se hvad du reelt har rørt.
- **`.ps1`-scripts skal være ren ASCII** (PowerShell 5.1 fejllæser UTF-8 uden BOM), og ingen PS7-syntaks.
- **Fuldt id-tjek efter enhver ændring i `dashboard.html`.** Alle `getElementById` skal have et matchende `id=`. Det er en gentagen fejlklasse her: et slettet element gav 17/7 en TypeError, som viste "Linket er udløbet" til alle med gyldigt login.
- **Ingen persondata i logs.** Telefonnumre og mailadresser maskeres med `maskerTlf()` / `maskerMail()` fra `phone.js`.
- **Deploy-ceremonien er prisen, ikke koden.** `dashboard.html` er kundevendt: feature branch → staging → røgtest → PR til `main` → deploy-vindue uden for arbejdstid → prod-verifikation. Overvej derfor, om rettelsen kan følge med en anden `dashboard.html`-opgave.
- **`sw.js` cache-version bumpes**, hvis cachede aktiver ændres.

---

## 5. Dokumenterne

`RISIKOREGISTER.md` er den eneste autoritative liste over alt, hvad der er åbent. Runbogen ejer procedurer, ikke todo-lister. Primeren ejer arkitektur, ikke status.

**Skriv ikke i dem uden at spørge først.** Finder du noget, der hører hjemme i registret, så foreslå formuleringen og lad mig tage stilling. Et fund bliver først et registerpunkt, når det er efterprøvet — ikke når det er formodet.

---

## 6. Færdig betyder

- Det er afklaret, **hvilken** af de tre visninger der var i stykker, og hvorfor.
- Rettelsen ligger som ændrede filer i `claude-arbejdstrae`, klar til at jeg kopierer ind.
- Der er en konkret røgtest, jeg kan køre: hvad gør jeg, og hvad skal jeg se?
- Kanttilfældene er tænkt igennem: nul opgaver, opgave åbnet på én enhed mens en anden er åben, appen lukket når leadet kommer ind.
- Hvis noget forblev uafklaret, står det som en sætning, jeg kan tage med i registret.
