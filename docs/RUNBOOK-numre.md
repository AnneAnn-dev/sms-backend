# RUNBOOK — telefonnumre (Twilio + phone_numbers)

Håndtering af nummerpuljen: køb, konfiguration, afstemning, frigivelse og
genopretning efter kontosuspendering.

Sidst opdateret: 8/8-2026 (afsnit 4: tilbagetagelse fra kunde + fjernelse af adgang)

---

## 0. Før du gør noget som helst

**Tjek hvilken miljøprofil der er indlæst.** Det er den fejl, alt andet i dette
dokument bygger oven på.

```powershell
node -e "require('dotenv').config({quiet:true}); console.log('VOICE_URL =', process.env.VOICE_URL); console.log('SUPABASE  =', process.env.SUPABASE_URL); console.log('TWILIO    =', (process.env.TWILIO_ACCOUNT_SID||'').slice(0,8))"
```

| Miljø   | voiceUrl indeholder            | Twilio-konto starter med |
|---------|--------------------------------|--------------------------|
| staging | `sms-backend-staging-908c`     | `ACd9…`                  |
| prod    | `sms-backend-production-5ee1`  | `AC9ff32e…`              |

Der er **to separate Twilio-konti**, én per miljø. Et nummer købt i den ene
konto findes ikke i den anden. Skift profil med `skift-prod.ps1` /
`skift-staging.ps1`.

Alle scripts nedenfor printer nu miljøet øverst. Læs de linjer.

---

## 1. Køb af numre

```powershell
node buy-numbers.js 3 --dry-run    # gratis: viser kandidater
node buy-numbers.js 3              # KØBER — koster penge pr. nummer
```

`buy-numbers.js` gør **alt** i ét kald: køber nummeret, sætter `voiceUrl` og
`voiceMethod: POST`, og indsætter rækken i `phone_numbers` med `firm_id = null`.

**Der er intet efterfølgende konfigurationstrin.** Nummeret er klar til
onboarding med det samme. Onboarding tildeler selv det næste ledige nummer til
firmaet — du rører aldrig `firm_id` manuelt.

Bekræft altid bagefter:

```powershell
node afstem-numre.js
```

### Forudsætninger i miljøet

`TWILIO_ADDRESS_SID` (godkendt adresse — påkrævet for DK-mobil),
`TWILIO_SYSTEM_NUMBER`, `VOICE_URL`. Scriptet nægter at køre uden dem.

En bundle (`TWILIO_BUNDLE_SID`) er **ikke** nødvendig for DK-mobilnumre; Twilio
afviser dem. Sættes kun hvis reglerne ændrer sig.

---

## 2. Numre købt manuelt i konsollen

Kun i dette tilfælde skal `configure-number.js` bruges:

```powershell
node configure-number.js PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Scriptet henter selv E.164-nummeret fra Twilio, afviser hvis det er
systemnummeret (**før** det ændrer noget), sætter webhooken og lægger nummeret i
puljen.

Bruges også, hvis `buy-numbers.js` skrev `⚠️ KØBT, men DB-insert fejlede` —
så mangler kun databaserækken.

---

## 3. Afstemning

```powershell
node afstem-numre.js
```

Læser Twilio og `phone_numbers`, skriver intet, exit-kode 1 ved fund.

| Fund                  | Betydning                                              | Alvor |
|-----------------------|--------------------------------------------------------|-------|
| **Spøgelse**          | I puljen, men findes ikke hos Twilio                   | Kritisk — onboarding kan tildele et dødt nummer |
| **Forældreløst**      | Hos Twilio, men ikke i puljen                          | Pengespild, ikke fejl |
| **Webhook-afvigelse** | `voiceUrl` peger et andet sted end miljøets `VOICE_URL`| Kritisk — opkald lander i forkert miljø eller ingen steder |
| **SID-afvigelse**     | `twilio_sid` i databasen matcher ikke Twilio           | Bider ved frigivelse |
| **Systemnummer i puljen** | Kan tildeles en kunde                              | Kritisk |
| **I karantæne**       | `firm_id` er tom, men `quarantined_until` ligger i fremtiden | Ikke en fejl — men må ikke behandles som ledigt |

Kør den efter hvert køb, hver frigivelse, og før hver pilotkunde-onboarding.

### Karantæne — numre der ser ledige ud, men ikke er det

Når en betalende kundes abonnement udløber, deprovisioneres nummeret med
`firm_id = null`, men det låses samtidig i **30 dage** via
`quarantined_until` + `last_firm_id` (win-back-vindue — kunden kan få sit
gamle nummer tilbage, hvis de vender tilbage inden fristen). Prøvekunder
(aldrig betalt) frigives straks uden karantæne. Mekanismen ejes af
Frisbii-livscyklussen, ikke af scripterne i denne runbook — se
Byg-trin 6 i drift-runbooken for selve logikken.

For scripterne her betyder det: **`firm_id = null` er ikke det samme som
ledigt.** Et nummer i karantæne skal ikke købes over, tildeles en ny kunde
eller frigives manuelt, før `quarantined_until` er passeret (eller feltet
bevidst ryddes, hvis kunden er endeligt opgivet). Om `afstem-numre.js` og
den automatiske pool-udvælgelse allerede filtrerer korrekt på dette felt,
bør bekræftes i koden — se punkt 8 nedenfor.

Det amerikanske gratis-nummer fra kontooprettelsen (`+1618…`) dukkede op som
forældreløst, indtil det blev frigivet. Sådanne kendte undtagelser bør frigives
frem for at blive vænnet til i outputtet.

---

## 4. Tilbagetagelse af et nummer fra en kunde

Når en kunde skal af med sit nummer, men **nummeret skal blive i puljen** og
genbruges. Det er ikke en frigivelse: intet frigives hos Twilio, rækken i
`phone_numbers` bliver stående, `voiceUrl` røres ikke, og
`configure-number.js` skal ikke bruges. Nummeret skifter kun ejer — fra et
firma tilbage til puljen.

Skal nummeret helt ud af regnskabet, så Twilio holder op med at fakturere det,
er det afsnit 5 i stedet.

### Trin 0 — stop kilden først

Har firmaet et aktivt abonnement i Frisbii, ejer livscyklussen (Byg-trin 6)
tildelingen af nummeret. Nulstiller du `firm_id` her, mens abonnementet lever,
kan en senere webhook-event tildele firmaet et nyt nummer eller sætte det gamle
tilbage. Afslut abonnementet først — ellers arbejder du imod automatikken, og
den vinder.

### Trin 1 — læs status, og notér de to ID'er du skal bruge

```sql
select pn.id, pn.number, pn.twilio_sid, pn.firm_id,
       pn.quarantined_until, pn.last_firm_id,
       f.name, f.email, f.status
from phone_numbers pn
join firms f on f.id = pn.firm_id
where pn.number = '+45XXXXXXXX';
```

```sql
select fu.user_id, fu.firm_id
from firm_users fu
where fu.firm_id = '<firm_id fra ovenstående>';
```

Notér både `firm_id` og `user_id`. **Rækkefølgen er ikke kosmetisk.** Trin 2
nulstiller både `firm_id` og `last_firm_id`, og dermed findes der bagefter
ingen sti fra nummeret tilbage til firmaet — det første opslag her giver nul
rækker, når trin 2 først er kørt.

Er du havnet i den situation, findes firmaet i stedet på listen over firmaer
uden nummer:

```sql
select f.id, f.name, f.email, f.status, fu.user_id
from firms f
left join firm_users fu on fu.firm_id = f.id
order by f.name;
```

Bekræft altid, at du har fat i det rigtige, før du sletter noget:

```sql
select id, number from phone_numbers where firm_id = '<firm_id>';
```

Nul rækker er det forventede svar. Kommer der en række, har firmaet stadig et
nummer, og så er det ikke det, du leder efter — stop og læs listen igen.

### Trin 2 — tag nummeret fra firmaet

```sql
update phone_numbers
set firm_id = null,
    quarantined_until = now() + interval '7 days',
    last_firm_id = null
where number = '+45XXXXXXXX'
  and firm_id = '<firm_id fra trin 1>'
returning id, number, firm_id, quarantined_until;
```

`and firm_id = ...` er samme slags sikkerhedssele som `and firm_id is null` i
afsnit 5: rammer du et forkert nummer, sker der ingenting. `returning` skal
vise præcis én række — tæl den.

**`returning` er ikke pynt.** Supabase' SQL-editor svarer "Success. No rows
returned" på ethvert `update` og `delete` uden `returning`, uanset om
forespørgslen ramte én række eller nul. Der er intet at aflæse i det svar.
Uden `returning` kan du ikke skelne "sikkerhedsselen reddede mig" fra "det
virkede" — og de to ting kræver stik modsat handling.

I samme øjeblik `firm_id` er tom, kan indgående opkald på nummeret ikke længere
kobles til et firma, og missed call → SMS holder op med at virke for kunden.
Det er dét, der kobler personen fra nummeret.

**Hvorfor karantæne på et nummer, der ikke er et win-back-tilfælde:** kunden har
efter alt at dømme stadig viderestilling fra sin egen telefon til nummeret.
Ryger nummeret direkte tilbage i den ledige pulje, kan det tildeles en ny kunde
i morgen — og så udløser den gamle kundes ubesvarede opkald SMS'er i den nye
kundes navn. Karantænefeltet bruges her som en ren holdeperiode, indtil
viderestillingen er bekræftet slået fra. `last_firm_id` sættes bevidst til
`null`: det felt betyder "win-back til dette firma", og det er ikke signalet
her — slet ikke hvis firmarækken senere slettes.

Husk forbeholdet i afsnit 8: det er endnu ikke bekræftet, at
`afstem-numre.js`s optælling af "ledige numre" filtrerer karantænenumre fra.
Indtil det er tjekket, kan nummeret tælle med som en buffer, det ikke er.

### Trin 3 — fjern personens adgang

At tage nummeret fjerner ikke login. Firmaets bruger kan stadig komme ind i
dashboardet, og et **allerede udsendt magic link virker stadig**.

Et magic link er en engangs-token bundet til Auth-brugeren, ikke til firmaet
eller nummeret. Den ligger i personens indbakke og er gyldig, til den bruges
eller udløber. At slette rækken i `firm_users` gør den ikke ugyldig — linket
logger stadig personen ind, bare på en konto uden firma. **Det eneste, der
sikkert dræber et uindløst magic link, er at slette selve Auth-brugeren.**

Tjek først, om firmaet har mere end én `user_id` i opslaget fra trin 1. Er der
flere, skal de alle slettes i Auth — ellers har den anden stadig login.

Rækkefølgen (samme som i `reset-test-data.js`: `firm_users` først, Auth-bruger
til sidst):

```sql
delete from firm_users
where firm_id = '<firm_id>'
returning user_id;
```

Derefter Supabase → Authentication → Users → find `user_id` (eller
e-mailadressen fra trin 1) → **Delete user**.

Gør det i konsollen med øjnene på e-mailadressen frem for i et script. Det er
en engangshandling, den er uigenkaldelig, og der findes ikke et script til én
bruger — `reset-test-data.js` sletter alle firmaer og hele puljen og hører kun
hjemme i testmiljøet.

Bekræft bagefter, at brugeren faktisk er væk fra listen. Er der tvivl, kan
personen desuden fjernes fra `firm_whitelist`, så et nyt link ikke kan udstedes
til samme adresse.

### Trin 4 — hvad der sker med firmaet

Firmarækken kan blive stående med ændret `status`. `calls`, `messages` og
`leads` har fremmednøgler mod `firms`, så en sletning enten spænder ben eller
river historikken med sig. Står rækken uden nummer og uden brugere, kan den
ikke bruges til noget — og historikken er intakt, hvis der senere skal ses på,
hvad der skete.

Skal firmaet alligevel slettes helt, er FK-rækkefølgen den samme som i
`reset-test-data.js`, blot filtreret på ét `firm_id`:
`messages` → `lead_images` → `leads` → `calls` → `firm_whitelist` →
`firm_users` → `frisbii_webhook_events` → `firms`.

### Trin 5 — afstem

```powershell
node afstem-numre.js
```

Ingen spøgelser, ingen webhook-afvigelse. Nummeret skal fremgå som **i
karantæne**, ikke som ledigt.

Slutter kørslen med `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`,
er det Node, der falder over sig selv på Windows ved processens afslutning —
efter at alt output er skrevet. Resultatet på skærmen er gyldigt, men
**exit-koden kan ikke bruges**. Læs outputtet med øjnene; brug ikke exit-koden
til at styre noget automatisk, før nedbruddet er fundet.

### Trin 6 — luk karantænen, når viderestillingen er bekræftet slået fra

```sql
update phone_numbers
set quarantined_until = null
where number = '+45XXXXXXXX'
  and firm_id is null
returning id, number;
```

Først her er nummeret reelt tilbage i puljen og kan tildeles ved næste
onboarding.

---

## 5. Frigivelse af et nummer

Rækkefølgen er vigtig, og **begge trin skal laves**. Konsollen rører ikke
databasen, og databasen rører ikke Twilio.

**Trin 1 — kontrollér, at nummeret er ledigt:**

```sql
select id, number, twilio_sid, firm_id, quarantined_until, last_firm_id
from phone_numbers
where number = '+45XXXXXXXX';
```

Står der et `firm_id`, er nummeret tildelt en kunde. **STOP** — det skal
håndteres som en tilbagetagelse, ikke en frigivelse: se afsnit 4.

Er `firm_id` tom, men `quarantined_until` ligger i **fremtiden**, er
nummeret heller ikke ledigt i praksis — det sidder enten i en betalende kundes
30-dages win-back-vindue (se boksen i afsnit 3) eller i en holdeperiode efter
en tilbagetagelse (afsnit 4). **STOP** også her. En manuel frigivelse nu ville
forkorte vinduet og gøre det umuligt at give kunden nummeret tilbage, hvis de
vender tilbage. Vent til
`quarantined_until` er passeret, eller ryd feltet bevidst, hvis kunden er
endeligt opgivet — ikke som en del af en almindelig frigivelse.

Er `quarantined_until` `NULL` eller passeret, er nummeret reelt ledigt, og
trin 2-4 kan følges som normalt.

**Trin 2 — frigiv hos Twilio:** Console → Phone Numbers → Manage → Active
numbers → vælg nummeret → Release. Frigivelse er gratis og stopper det
månedlige abonnement.

**Trin 3 — slet rækken:**

```sql
delete from phone_numbers
where number = '+45XXXXXXXX'
  and firm_id is null
returning id, number, twilio_sid;
```

`and firm_id is null` er en sikkerhedssele: rammer du et forkert nummer, som er
tildelt, sletter forespørgslen ingenting. `returning` viser, hvad der faktisk
blev slettet — tæl rækkerne.

**Trin 4:** `node afstem-numre.js`

### Frigiver du flere ad gangen

Markér ét ad gangen i konsollen. Ved en batch-frigivelse i juli 2026 blev der
frigivet tre numre, hvor kun to var tilsigtet — det blev først opdaget af
afstemningen bagefter.

---

## 6. Kontoen er suspenderet (fejl 20003 / 401)

**Symptom:** alle Twilio-API-kald svarer `401` med `code: 20003 Authenticate`,
også dem der virkede minuttet før. Indgående opkald afvises med fejl 10003.

**Det betyder, at produktet er nede.** Missed call → SMS virker ikke, mens
kontoen er suspenderet. Behandl det som en driftshændelse, ikke som et
faktureringsspørgsmål.

**Diagnose** — skelner mellem forkert nøgle og suspenderet konto:

```powershell
node check-twilio-auth.js
```

Svarer den `active`, er problemet nøglen eller profilen. 401'er den igen, er
kontoen suspenderet, og årsagen står i klartekst øverst på console.twilio.com.

**Genopretning:**

1. Fyld saldo op i konsollen.
2. Vent 5–10 minutter. Log ud og ind igen, hvis kontoen stadig ser suspenderet ud.
3. `node afstem-numre.js` — bekræft at intet er gået tabt.

**Vigtigt:** Twilio frigiver **ikke** numre automatisk ved suspendering, netop
for at de kan bruges igen. Men de bliver ved med at blive faktureret imens, og
hele suspenderingsperiodens abonnementer opkræves samlet på reaktiveringsmåneden.
Efter **90 dages** suspendering er numrene i risiko for at blive inddraget af
Twilio — også kundernes numre og systemnummeret.

**Forebyggelse:** auto-genopfyldning skal være slået til i begge konti. Et
produkt, hvis kerne er indgående opkald, må ikke kunne gå ned, fordi saldoen
ramte nul en fredag aften.

---

## 7. Systemnummeret

**Prod:** `+4552516063`

Systemnummeret må aldrig ende i `phone_numbers`, fordi det så kan tildeles en
kunde. Vagten findes i både `buy-numbers.js` og `configure-number.js` og er
**fail-closed**: mangler `TWILIO_SYSTEM_NUMBER` i miljøet, nægter scriptet at
køre i stedet for at springe tjekket over.

Det princip er bevidst, og det er det samme som `VOICE_URL` og
`MAIL_OVERRIDE_TO`: **beskyttelse må ikke forsvinde, netop når profilen er
mangelfuld.** Den oprindelige vagt var `if (SYSTEM_NUMBER && ...)`, hvilket
betød ingen beskyttelse præcis i de tilfælde, hvor man havde mest brug for den.

I `configure-number.js` sker vagten nu **før** `update`-kaldet, ikke efter. Et
overskrevet `voiceUrl` kan ikke rulles tilbage.

Skriv aldrig rigtige SID'er i hjælpetekster og eksempler. Hjælpeteksten i
`configure-number.js` indeholdt i en periode systemnummerets faktiske PN-SID,
hvilket gjorde det til det oplagte at kopiere ind og køre.

---

## 8. Lagerstyring

`afstem-numre.js` advarer ved 2 eller færre ledige numre. Køb i god tid — et
køb kræver, at kontoen har saldo, og at DK-mobilnumre er ledige hos Twilio den
dag. Ingen af delene er garanteret midt i en onboarding med en kunde i røret.

**Tjek at "ledige" faktisk betyder ledige:** tællingen bør ekskludere numre i
karantæne (se afsnit 3) — de har `firm_id = null`, men kan ikke tildeles en
ny kunde før `quarantined_until` er passeret. Den automatiske
pool-udvælgelse i provisioneringsflowet springer allerede karantænenumre
over (jf. drift-runbooken); bekræft at `afstem-numre.js`s optælling af
"ledige numre" bruger samme filter — ellers kan advarslen her komme for
sent, fordi karantænenumre tælles med som en reel buffer, de ikke er.

---

## 9. Hændelseslog

**Juli 2026 — utilsigtet køb og kontosuspendering.**
`node buy-numbers.js 5 --dry_run` blev kørt i den tro, at flaget gjorde
kørslen gratis. Scriptet læste dengang kun miljøvariablen `DRY_RUN` og ignorerede
alle kommandolinjeargumenter i tavshed, så fem numre blev købt for rigtige penge.
Købene tømte saldoen, kontoen blev suspenderet, og alle efterfølgende API-kald
svarede 401 — inklusive dem, der skulle have frigivet numrene igen.

Genopretning: saldo fyldt op, tre numre frigivet i konsollen (heraf ét ved en
fejl), databaserækker slettet, afstemning kørt.

Rettelser: `buy-numbers.js` afviser nu ukendte argumenter, accepterer
`--dry-run` på kommandolinjen, har en øvre grænse på 10 numre pr. kørsel og
printer miljø og pris-advarsel, før den bruger penge. `afstem-numre.js` blev
skrevet som følge af hændelsen.

Læren: et script, der bruger penge, skal stoppe ved alt, det ikke forstår.
