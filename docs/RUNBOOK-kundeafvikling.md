# RUNBOOK — kundeafvikling (opsigelse, nummer-tilbagetagelse, datasletning)

Hvad der sker, når en kunde stopper: opsigelse i Frisbii, automatisk
nummer-tilbagetagelse, og — kun når du eksplicit beslutter det — permanent
sletning af firmaets data.

Sidst opdateret: 24/8-2026 (ny)

---

## 0. Tre ting, der let blandes sammen

1. **Opsigelse** — kunden siger op i Frisbii. Service fortsætter til
   periodeslut (kunden har betalt for den). Intet ryddes op endnu.
2. **Udløb/deprovisionering** — abonnementet er reelt forbi. Nummeret
   frigives (med karantæne), firmaet sættes inaktivt. Sker **automatisk**,
   du skal ikke gøre noget.
3. **Datasletning** — `firms`-rækken og alt, hvad der hænger på den,
   forsvinder permanent. Sker **aldrig automatisk** i dag. Kun manuelt, kun
   med `delete-firma.js`, kun ét firma ad gangen.

Denne runbog beskriver **mekanikken** — det koden kan i dag. Den afgør
**ikke** hvor lang tid der bør gå efter en opsigelse, før data rent faktisk
slettes — det er en åben beslutning (J4/J5 i `RISIKOREGISTER.md`, "Venter på
andre" til GDPR-pakken er afklaret). Indtil den beslutning er taget: slet
kun et firma, når du eksplicit har besluttet at det skal væk (en udtrykkelig
anmodning fra kunden, eller oprydning af et forladt test-/pilotfirma) — ikke
efter en fast frist, for den frist er ikke besluttet endnu.

---

## 1. Opsigelse → udløb: hvad der sker automatisk

Logikken bor i `frisbii-webhook.js`, spejlet 1:1 fra Frisbiis events:

| Event                                        | Effekt                                                              |
|-----------------------------------------------|-----------------------------------------------------------------------|
| `subscription_cancelled`                      | `billing_status = cancelled`. Service **fortsætter** til periodeslut. Retention-signal — kontakt kunden, hvis I vil prøve at redde den. |
| `subscription_expired` / `subscription_expired_dunning` | `billing_status = expired` → **`deprovisionFirm()`** kører automatisk. |

`deprovisionFirm()` gør to ting:

- **Nummeret:** `phone_numbers.firm_id = null`, plus `quarantined_until` og
  `last_firm_id`. Betalende kunde → 30 dages karantæne
  (`QUARANTINE_DAYS_PAID`, win-back-vindue — nummeret står måske stadig på
  bilen). Prøvekunde (aldrig betalt, dømt via Frisbiis fakturaer) →
  frigives straks, ingen karantæne.
- **Firmaet:** `status = inactive`, `phone_number = null`. **Selve
  `firms`-rækken (navn, e-mail) bliver stående.** Det er præcis her
  datasletnings-hullet fra 9/8 sad (J4) — deprovisionering er ikke det
  samme som sletning.

Du skal ikke selv gøre noget for at få nummeret tilbage i puljen — bekræft
bagefter med `node afstem-numre.js` (se `RUNBOOK-numre.md` afsnit 3) at
nummeret er dukket op med korrekt karantænedato.

---

## 2. Kunden skal have sine data slettet (eller du vil rydde et forladt firma op)

Brug `delete-firma.js` — se filens egne kommentarer for den fulde,
autoritative liste over hvad der ryddes (CASCADE-tabeller, `calls`
eksplicit, Storage i `greetings/` og `lead-images/`).

**Rækkefølge:**

1. **Opsig abonnementet i Frisbii**, hvis det ikke allerede er sket.
   Springer du dette over, bliver kunden ved med at blive opkrævet, efter
   du har slettet deres firma i jeres egen database.
2. **Vent til `subscription_expired` er kørt igennem** — dvs. at
   `deprovisionFirm()` allerede har frigivet nummeret MED karantæne (se
   afsnit 1). Bekræft med `afstem-numre.js`.
   ⚠️ Se advarslen nedenfor, hvis du ikke kan vente.
3. Find firma-id'et i Supabase-UI'en (`firms`-tabellen).
4. Kør `skift-staging.ps1` / `skift-prod.ps1`, så `.env` peger det rigtige
   sted hen.
5. **Tørkørsel** (standard, intet skrives):
   ```powershell
   node delete-firma.js --ref <project-ref> --firma <firm-id>
   ```
   Læs rapporten. Tæl efter at antallet af rækker/filer giver mening for
   netop dette firma.
6. **Udførsel:**
   ```powershell
   node delete-firma.js --ref <project-ref> --firma <firm-id> --bekraeft
   ```
   Scriptet beder om at få firma-id'et skrevet igen, før det rører noget.
7. **Efterkontrol:** scriptet tjekker selv at alle tabeller er tomme og at
   `firms`-rækken er væk — læs outputtet, stol ikke blot på "FÆRDIG".
8. **Auth-bruger:** hvis scriptet advarer "Ingen `firm_users`-række
   fundet" (sker hvis en tidligere, ufuldstændig afvikling allerede har
   ryddet koblingen), kan brugeren ikke findes automatisk. Slå e-mailen op
   manuelt under **Authentication → Users** i Supabase og slet den der.
9. **"potentielle kunder"-bucketten røres ikke** af scriptet — den er ikke
   fundet i koden (grep 19/8). Tjek selv i Storage-UI'en, hvis relevant.

### ⚠️ Rækkefølgen er ikke tilfældig

Kør **ikke** `delete-firma.js`, før nummeret er frigivet ordentligt via den
automatiske deprovisionering — medmindre du har en konkret grund til at
fravige den, og kender konsekvensen. `phone_numbers.firm_id` sættes
ganske vist også til `null`, hvis du sletter et firma, der stadig har et
nummer (`SET NULL`-konsekvens af FK'en) — men **uden**
karantæne-mekanikken (`quarantined_until`/`last_firm_id`). En betalende
kundes nummer kunne dermed blive genudleveret til en ny kunde med det
samme, mens den gamle kunde stadig havde et win-back-vindue tilbage.
Deprovisionering (afsnit 1) og sletning (dette afsnit) er to forskellige
handlinger med to forskellige formål — lad dem ske i den rækkefølge.

---

## 3. Tredjepartsdata — håndværkerens egne kunder

`kunder`/`leads`/`calls` bærer håndværkerens *egne* kunders data. Der er
Dit Digitale Kontor **databehandler**, ikke dataansvarlig — fristen for
sletning er i princippet kundens (håndværkerens), ikke vores (jf. J1/J5).
`delete-firma.js` sletter dem alligevel automatisk sammen med resten af
firmaet, fordi de CASCADE'r på `firm_id`. Der findes **ikke** i dag en
separat vej til at slette kun tredjepartsdata uden at slette hele firmaet
— det er hverken bygget eller besluttet at være nødvendigt.

---

## 4. Hvad denne runbog bevidst IKKE afgør

- **Slettefrist efter opsigelse/udløb** — hvor længe skal en `firms`-række
  stå tilbage, før den skal slettes? Ubesvaret. J4/J5, venter på
  GDPR-pakken.
- **Bogføringslovens 5-års-krav** på fakturadata — vores egen database
  gemmer ingen fakturaer (Frisbii er kilden), så det rammer formentlig
  ikke `delete-firma.js`, men det er ikke eksplicit efterprøvet.
- **Automatisk sletning** — findes ikke, og bør efter min vurdering ikke
  bygges, før frist og proces er besluttet (arbejdsprincip 2: irreversible
  beslutninger fortjener tid, ikke en gætteværdi kodet ind som standard).

---

## 5. Reference

- Automatisk deprovisionering: `frisbii-webhook.js` → `deprovisionFirm()`,
  uddybet i Byg-trin 6, `ditdigitalekontor-drift-runbook.md`.
- Sletteværktøjet: `delete-firma.js` — filens egne kommentarer er
  autoritative for hvad der dækkes.
- Nummerpuljens karantæne-mekanik: `RUNBOOK-numre.md`, afsnit 3.
- Åbne GDPR-beslutninger: `RISIKOREGISTER.md`, punkt J4 og J5.
