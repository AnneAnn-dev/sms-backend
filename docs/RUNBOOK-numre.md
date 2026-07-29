# RUNBOOK — telefonnumre (Twilio + phone_numbers)

Håndtering af nummerpuljen: køb, konfiguration, afstemning, frigivelse og
genopretning efter kontosuspendering.

Sidst opdateret: 29/7-2026 (karantæne-feltet tilføjet)

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
bør bekræftes i koden — se punkt 7 nedenfor.

Det amerikanske gratis-nummer fra kontooprettelsen (`+1618…`) dukkede op som
forældreløst, indtil det blev frigivet. Sådanne kendte undtagelser bør frigives
frem for at blive vænnet til i outputtet.

---

## 4. Frigivelse af et nummer

Rækkefølgen er vigtig, og **begge trin skal laves**. Konsollen rører ikke
databasen, og databasen rører ikke Twilio.

**Trin 1 — kontrollér, at nummeret er ledigt:**

```sql
select id, number, twilio_sid, firm_id, quarantined_until, last_firm_id
from phone_numbers
where number = '+45XXXXXXXX';
```

Står der et `firm_id`, er nummeret tildelt en kunde. **STOP** — det skal
håndteres som en kundeflytning, ikke en frigivelse.

Er `firm_id` tom, men `quarantined_until` ligger i **fremtiden**, er
nummeret heller ikke ledigt i praksis — det sidder i en betalende kundes
30-dages win-back-vindue (se boksen i afsnit 3). **STOP** også her. En
manuel frigivelse nu ville forkorte vinduet og gøre det umuligt at give
kunden nummeret tilbage, hvis de vender tilbage. Vent til
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

## 5. Kontoen er suspenderet (fejl 20003 / 401)

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

## 6. Systemnummeret

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

## 7. Lagerstyring

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

## 8. Hændelseslog

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
