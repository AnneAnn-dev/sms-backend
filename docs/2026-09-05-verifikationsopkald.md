# Hændelse: Verifikationsopkald i onboarding nåede ikke frem

| | |
|---|---|
| **Dato** | 5. september 2026 |
| **Miljø** | Twilio-subkonto `ditdigitalekontor-staging` |
| **Varighed** | ca. 08:15 – 09:04 CEST |
| **Status** | Ophørt — **årsagen er ikke fastslået** |
| **Kundepåvirkning** | Ingen (staging, egen testtelefon) |
| **Afledte punkter** | D39, D40 · noter på D3 og D9 |

Alle klokkeslæt er **CEST (UTC+2)**. Twilios API returnerer UTC — omregn ved sammenligning. Twilios `duration` tælles **fra opkaldet besvares**, ikke fra det oprettes; ringetiden indgår ikke.

---

## 1. Resumé

Verifikationstrinnet i onboardingen fejlede: systemet ringede, telefonen reagerede ikke, og tjekket blev ikke bekræftet.

Twilio var uden skyld. Credentials var korrekte, kontoen aktiv, begge numre på plads, og opkaldene blev oprettet og besvaret. Det viderestillede ben nåede bare aldrig frem til pool-nummeret `+4593702605`, og verifikationen havde derfor intet at bekræfte.

Tilstanden ophørte kl. 09:04, hvor et tjek forløb normalt. **Hvorfor viderestillingen var uvirksom, og hvorfor den virkede igen, er ikke fastslået.** Der er ingen registreret indgriben i tidsrummet. Se afsnit 6.

Under hele hændelsen blev der ikke logget en eneste fejl — ikke i Twilios debugger, ikke i applikationen. Det er hændelsens væsentligste træk.

---

## 2. Tidslinje

| Tidspunkt | Hændelse |
|---|---|
| 4. sep 14:33:57 | Verifikationstjek mod `+4553798745` — **lykkes** (8 s + 7 s, komplet par) |
| 4. sep 15:11:18 | Verifikationstjek mod `+4526841720` — **lykkes** (8 s + 7 s, komplet par) |
| 4. sep 16:05:20 | Indgående opkald fra `+4526841720` til systemnummeret, `no-answer` (manuelt) |
| 5. sep 08:18:56 | Verifikationstjek mod `+4526841720` — **fejler**. Ét ben, 17 s, intet viderestillet ben |
| 5. sep 08:26:32 | Gentaget — **fejler identisk**. 17 s, intet viderestillet ben |
| 5. sep ~08:30–09:00 | Fejlsøgning. **Ingen kendt indgriben i viderestillingen** |
| 5. sep 09:04:06 | Verifikationstjek mod `+4526841720` — **lykkes igen** (8 s + 7 s, komplet par) |

---

## 3. Involverede numre

| Nummer | Rolle | Placering |
|---|---|---|
| `+4591309928` | Systemnummer / MIS — afsender på verifikationsopkald | Subkonto staging |
| `+4593702605` | Pool-nummer, `PNa7caea8307b49d21c0718f7d6e90b969` | Subkonto staging |
| `+4526841720` | Testtelefon (Ann) | Ekstern |
| `+4553798745` | Testmodtager | Ekstern |

---

## 4. Sådan virker verifikationen

DDK bruger `**61*` — **viderestilling ved intet svar**, ikke ubetinget viderestilling. Det betyder at telefonen **skal** ringe. `onboarding.html` regner selv med det: *"telefonen ringer 20-30 sek., før operatøren viderestiller, så det forwardede opkald når typisk først frem efter 30-40 sek."*

Et vellykket tjek er derfor **to opkald** i Twilio-loggen, ikke ét:

```
Ben 1   outbound-api   systemnummer  →  brugerens telefon      ringer 20-30 sek.
                                        ingen svarer
                                        operatøren viderestiller
Ben 2   inbound        systemnummer  →  brugerens pool-nummer   greeting spiller
```

Begge ben viser 7–9 sekunders varighed, fordi `duration` først tælles fra greetingen svarer. **Ben 2 er beviset for at viderestillingen virker.** Ben 1 alene beviser kun, at Twilio kunne ringe op.

`pollVerification()` i onboardingen venter allerede korrekt på ben 2 — den poller `verification_status` i ~70 sekunder. Logikken er i orden; kun timeout-beskeden er misvisende (D40).

### Sådan læses loggen

| Observation | Betydning |
|---|---|
| Ben 1 + ben 2, begge 7–9 s | Viderestilling virker. Tjek bestået |
| Ben 1 alene, `no-answer` | Ingen svarede, og ingen viderestilling greb ind |
| Ben 1 alene, `completed`, afvigende varighed | **Noget andet besvarede opkaldet** — telesvarer eller operatørbesked |
| Intet ben 1 overhovedet | Fejlen ligger i backenden. Twilio blev aldrig kontaktet. Se Railway-loggen |

### Beviset i denne sag

```
FEJLENDE (5. sep)
08:18:56  outbound-api  +4591309928 → +4526841720  completed  17 s   ← intet ben 2
08:26:32  outbound-api  +4591309928 → +4526841720  completed  17 s   ← intet ben 2

VELLYKKET (5. sep, samme dag)
09:04:06  outbound-api  +4591309928 → +4526841720  completed   8 s   forwarded_from: +4526841720
09:04:09  inbound       +4591309928 → +4593702605  completed   7 s   forwarded_from: +4593702605
```

To detaljer afgjorde sagen. **Ben 2 mangler helt** på de fejlende opkald. Og **varigheden er præcis 17 sekunder begge gange** — identisk varighed på to uafhængige opkald er signaturen på en indspillet besked, der spilles færdig. De vellykkede tjek ligger konsekvent på 7–9 sekunder.

---

## 5. Forkerte spor

Skrevet ned, så de ikke skal gennemgås igen.

### 5.1 "Available balance: $0.00" i Twilio-konsollen

**Ikke en fejlindikator.** Subkonti har ikke egen saldo — forbruget ruller op til hovedkontoen (`AnneAnns SMS`). Subkontoen viser derfor **altid** `$0.00`, og der findes ikke noget sted at indbetale på den. Konsollen antyder det ikke med et ord.

Auto-refill og saldoalarm hører til på hovedkontoen — kontrollér dem dér. Noteret på **D9**.

### 5.2 Nøglerotationen

Timingen passede mistænkeligt godt på "det virkede i går, ikke i dag", og hypotesen var konkret: subkonti har deres eget auth token, så hovedkontoens token i staging-miljøet ville tage al telefoni ned med `20003`.

**Afkræftet.** Opslaget svarede `Navn: ditdigitalekontor-staging | Status: active | Type: Full`.

### 5.3 `20003 — No credentials provided` (falsk alarm)

Første kørsel af diagnoseskriptet gav `20003` og syntes at bekræfte 5.2. De to variabeltildelinger øverst i scriptet var bare ikke kørt med, så `$sid` og `$token` var tomme og URL'en blev `/Accounts//`.

| Besked | Betydning |
|---|---|
| `Authentication Error - No credentials provided` | Der blev ikke sendt credentials. Tjek dine variabler |
| `Authentication Error - invalid username` | Der blev sendt credentials, og de var forkerte |

Kun den anden peger på nøglerne.

### 5.4 En rettelse midt i forløbet

Fejlsøgningen antog undervejs, at DDK bruger ubetinget viderestilling (`**21*`), og konkluderede derpå at en tavs telefon var *forventet* opførsel. **Det var forkert.** Med `**61*` skal telefonen ringe, og at den ikke gjorde det er derfor en ægte observation, ikke en misforståelse hos brugeren. Antagelsen blev korrigeret mod D37 og `onboarding.html`, som begge viser `**61*`.

### 5.5 "Dobbelt-SMS" — et punkt der blev oprettet og trukket tilbage

Message Logs viste hver besked dubleret med identisk tidsstempel ned til sekundet, og det blev skrevet i registret som en fejl med dobbelt omkostning. **Det var forkert.**

De to beskeder sendes **med vilje**. `onboarding.js:181-195` dokumenterer beslutningen fra 11/7-26: demo-SMS'en til håndværkeren deles i to, fordi en samlet besked oversteg 160 GSM-tegn og blev delt midt i linket. Første besked er forklaringen, anden er en nøjagtig kopi af den SMS kunden får. Den ægte lead-SMS (`onboarding.js:563`) sendes én gang.

Tidsstemplerne passer perfekt: parret 15:11:47 følger ét sekund efter det viderestillede ben 15:11:46. Det var demo-SMS'en efter et **vellykket** verifikationstjek — altså beviset på at tingene virkede, læst som en fejl.

**Fejlen i metoden var at et mønster i en log blev til et fund uden at hverken beskedernes indhold eller koden var læst.** To rækker med samme tidsstempel og samme modtager ligner en dublet, og ligner er ikke er.

---

## 6. Den uafklarede del

Vi ved hvad der **ikke** skete: Twilio fejlede ikke, koden fejlede ikke, credentials var korrekte, og verifikationslogikken ventede på det rigtige ben.

Vi ved ikke hvorfor ben 2 udeblev. To forklaringer er i spil:

**Opkaldet gik direkte til telesvarer.** Er telefonen slukket, i flytilstand eller uden dækning, ringer den ikke, og operatøren sender opkaldet til telesvarer i stedet for at aktivere `**61*`. Det forklarer alle tre observationer på én gang — ingen ringen, 17 sekunders indspillet besked, intet ben 2 — og det forklarer også en genopretning uden indgriben, når dækningen kom tilbage. **Dette er den mest sandsynlige forklaring, men den er ikke bekræftet.**

**Viderestillingen faldt af.** Mindre sandsynlig, men ikke udelukket. Ville være alvorligere, fordi den så kan falde af hos en betalende kunde.

De to kræver forskellige modtræk, og forskellen kan ikke afgøres på de data vi har. **Bekræft den første før den anden forkastes.**

Uanset hvilken det var, gælder konsekvensen: hvis en kundes viderestilling holder op med at virke, genereres der ingen leads, og der udløses ingen fejl noget sted. Kunden opdager det når de undrer sig over stilheden. Det er præcis den fejlklasse dødmandsknappen (**D3**) er bygget til, og den er stadig ikke aktiveret.

---

## 7. Diagnoseværktøj

Kør i det miljø hvor backenden kører (efter `skift-staging.ps1` / `skift-prod.ps1`), eller via `railway run`.

```powershell
# --- Disse to linjer er obligatoriske. Uden dem er resten meningsløst. ---
$sid   = $env:TWILIO_ACCOUNT_SID
$token = $env:TWILIO_AUTH_TOKEN
"SID:   $sid"
"TOKEN: " + $(if ($token) { "sat (" + $token.Length + " tegn)" } else { "IKKE sat" })

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$pair = "{0}:{1}" -f $sid, $token
$h = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair)) }

Write-Host "`n=== KONTO ===" -ForegroundColor Cyan
try {
  $a = Invoke-RestMethod -Headers $h -Uri "https://api.twilio.com/2010-04-01/Accounts/$sid.json"
  "Navn: {0} | Status: {1} | Type: {2}" -f $a.friendly_name, $a.status, $a.type
} catch { Write-Host "FEJL: $($_.Exception.Message)" -ForegroundColor Red; $_.ErrorDetails.Message }

Write-Host "`n=== NUMRE PAA DENNE KONTO ===" -ForegroundColor Cyan
try {
  (Invoke-RestMethod -Headers $h -Uri "https://api.twilio.com/2010-04-01/Accounts/$sid/IncomingPhoneNumbers.json?PageSize=50").incoming_phone_numbers |
    ForEach-Object { "{0}  {1}" -f $_.phone_number, $_.friendly_name }
} catch { Write-Host "FEJL: $($_.Exception.Message)" -ForegroundColor Red; $_.ErrorDetails.Message }

Write-Host "`n=== SENESTE 10 OPKALD (se efter kald-parret) ===" -ForegroundColor Cyan
try {
  (Invoke-RestMethod -Headers $h -Uri "https://api.twilio.com/2010-04-01/Accounts/$sid/Calls.json?PageSize=10").calls |
    Select-Object date_created, direction, from, to, status, duration | Format-Table -AutoSize
} catch { Write-Host "FEJL: $($_.Exception.Message)" -ForegroundColor Red; $_.ErrorDetails.Message }

Write-Host "`n=== DETALJER (forwarded_from afgoer viderestillingen) ===" -ForegroundColor Cyan
try {
  (Invoke-RestMethod -Headers $h -Uri "https://api.twilio.com/2010-04-01/Accounts/$sid/Calls.json?PageSize=4").calls |
    Select-Object sid, date_created, from, to, status, duration, answered_by, forwarded_from | Format-List
} catch { Write-Host "FEJL: $($_.Exception.Message)" -ForegroundColor Red; $_.ErrorDetails.Message }

Write-Host "`n=== DEBUGGER-ALARMER ===" -ForegroundColor Cyan
try {
  (Invoke-RestMethod -Headers $h -Uri "https://monitor.twilio.com/v1/Alerts?PageSize=15").alerts |
    Select-Object date_created, error_code, log_level, alert_text | Format-List
} catch { Write-Host "FEJL: $($_.Exception.Message)" -ForegroundColor Red; $_.ErrorDetails.Message }
```

**Kontrollér altid at `SID:` faktisk udskriver et `AC...`-nummer, før du tolker resten.** En tom variabel giver `20003` og `20404`, der ligner ægte fejl.

| Præfiks | Konto |
|---|---|
| `AC9ff32eacb...` | Hovedkonto `AnneAnns SMS` |
| `ACd98aa62dfc...` | Subkonto `ditdigitalekontor-staging` |

Kontrolkoder på telefonen: `*#61#` viser status for viderestilling ved intet svar, `**61*+45XXXXXXXX#` sætter den.

---

## 8. Læresætninger

**Fravær af fejl er ikke bevis for succes.** Twilios debugger var tom hele vejen igennem, og alligevel virkede systemet ikke. En hændelse, der ikke sætter aftryk nogen steder, er en hændelse ingen kan supportere. Å1 i praksis, og argumentet for D3.

**Sammenlign med et kendt godt forløb, når der ikke er nogen fejlmeddelelse at læse.** Det var forskellen mellem 8 og 17 sekunder — og det manglende ben 2 — der løste sagen. Der var ingen fejlmeddelelser overhovedet.

**En uforklaret genopretning er ikke en løsning.** Vi ved ikke hvorfor det holdt op, og ikke hvorfor det begyndte igen. Det betyder, at fejlen kan komme tilbage på et tidspunkt vi ikke kan forudsige. Skriv den slags som uafklaret, ikke som lukket.

**Tjek hvilken viderestillingskode produktet faktisk bruger, før du tolker et symptom.** `**21*` og `**61*` giver modsatte forventninger til om telefonen skal ringe. Antagelsen kostede en forkert konklusion midtvejs, som først blev fanget ved at læse D37 og `onboarding.html`.

**Et mønster i en log er en hypotese, ikke et fund.** Tre af de fire ting, denne fejlsøgning først "fandt", var forkerte: saldoen, nøglerotationen og dobbelt-SMS'en. Alle tre blev afvist af den samme slags kontrol — læs kilden. Konsollens felt, API'ets svar, koden. Et punkt hører først i registret, når kilden er læst.

**Skeln mellem "ingen credentials sendt" og "forkerte credentials".** Samme fejlkode, `20003`, to helt forskellige årsager. Den første er næsten altid din egen shell.
