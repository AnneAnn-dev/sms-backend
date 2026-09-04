# Forslag: overgang til betalende drift — go-live 7/9-2026

**Status:** forslag. Intet af dette er skrevet i `RISIKOREGISTER.md` — rækkerne nedenfor er formateret, så de kan indsættes direkte.
**Bygget på:** kopien i `claude-arbejdstræ` af 29/8 (registrets header siger *Sidst gennemgået 2026-08-28*, sidste ændringslogpost er 29/8). **Kør `sync-docs.ps1` før du bruger listen** — er der skrevet i registret i den forgangne uge, kan punkter herunder allerede være lukket.
**Anledning:** en sælger er sat på produktet, og der går rigtig produktion i luften mandag 7/9.

---

## 1. Det bærende: `Betalende`-udløseren fyrer mandag

Registrets sorteringsregel er *udløser → K → indsats*. Det betyder, at en stribe punkter har ligget lovligt nede i bunken med begrundelsen "der er ingen betalende kunder endnu". Den begrundelse holder op med at gælde mandag — ikke gradvist, men på én dag. Det er ikke nye risici; det er risici, hvis udløser er nået.

Forslag til udløserændringer:

| ID | I dag | Foreslået | Hvorfor nu |
|---|---|---|---|
| D15 | `Betalende · timer`, Åben | `NU · timer` | Frisbii-status kan drive fra firmastatus i Supabase i begge retninger, uden fejlmeddelelse. Med én kunde er det en anekdote; med en sælger på gaden er det en supportsag, der ikke kan diagnosticeres uden en afstemning. Å2 har allerede afstemning for Twilio — dette er samme mønster på Frisbii↔Supabase |
| S8 | `Betalende · timer`, Åben | `NU · timer` | `service_role` omgår al RLS, og anvendelserne er ikke kortlagt. Med én tenant i basen er en RLS-omgåelse usynlig; fra flere betalende tenants er den en krydslækage |
| S18 | Åben | Uændret status, **udløser til `NU`** | Et allerede udsendt magic link kan ikke spærres teknisk ved kundeafvikling — kun proceduren står imellem. Første opsigelse kommer tidligere, end man tror, når nogen sælger aktivt |
| O1 | `Betalende`, **M/M** | **K hæves M → H** | Nedgraderingen 4/8 hviler eksplicit på "med nul kunder er konsekvensen af Anns fravær lille". Præmissen udløber mandag. Det er ikke en ny risiko — det er en nedgradering, hvis grundlag forsvinder |
| O2 | `Betalende · timer`, I gang | **K hæves M → H** | Samme begrundelse som O1; de blev nedgraderet sammen og hører sammen |
| J11 | `Betalende · timer`, I gang | Uændret | Varemærket bliver ikke farligere af en kunde mere. Nævnt her kun for at have gennemgået hele `Betalende`-listen |

**Registerhygiejne:** hvis udløseren flyttes, skal tabellerne sorteres om, ellers holder "kan læses ovenfra og stoppes, når tiden er brugt" op med at være sandt.

---

## 2. Tre nye punkter

Klar til indsættelse. ID'erne D39, Ø7 og S24 er ledige i kopien af 29/8 — verificér efter sync.

**Drift:**

```
| D39 | **Gendannelse bliver alt-eller-intet fra første dag med mere end én betalende kunde.** PITR ruller hele projektet tilbage i tid; der findes ikke "rul kun denne ene kundes rækker tilbage". Én kundes fejl kan derfor ikke rettes med gendannelse uden at koste alle andres data i samme tidsrum | L | H | Betalende · timer | Åben | Gør D13's audit-spor til den faktiske rettevej frem for gendannelse. Behold det logiske dump ved siden af PITR, så en enkelt tabel kan hentes ud uden at rulle projektet tilbage |
```

**Økonomi:**

```
| Ø7 | **PITR + Small compute er en ny fast månedlig omkostning, besluttet før Ø1 er regnet.** PITR koster ca. $100/md for 7 dages vindue, og PITR kræver mindst Small compute-tillægget oveni. Ca. 650 kr/md — omkring en tredjedel af ét abonnements 1.875 kr/md — bundet før dækningsbidraget pr. kunde er kendt | H | M | NU · penge | Åben | Regn Ø1 igennem (2 timer, står som punkt 7 på NU-listen). Er dækningsbidraget for lavt, er det ikke PITR, der skal skæres — det er prisen, der er forkert |
```

**Sikkerhed:**

```
| S24 | **`main` deployes til produktion med rigtige kunder på, uden at deploy-vinduet er en spærre.** D8's regel "deploy aldrig 7-17" er besluttet, men eksisterer kun som hensigt — intet forhindrer et deploy midt i arbejdstiden, og et opkald under deploy giver ingen fejlmeddelelse | M | M | NU · min | Åben | Å3 anvendt på deploy: gør reglen til noget, der skal omgås aktivt, ikke huskes. Fx en `pre-push`-hook eller en CI-betingelse på klokkeslæt, med en dokumenteret nødvej |
```

**Opdatering af eksisterende D1** (ikke en ny række — tilføj til `Næste skridt`):

> **4/9: PITR lukker den ene halvdel af D1, ikke begge.** Den fysiske backup tager hele databasen, så `storage.objects` og `storage.buckets`-metadata kommer med — præcis det, `--schema=public` ikke dumpede. **Selve filerne i bucketen ligger uden for Postgres og gendannes ikke af PITR.** Lead-billeder kan derfor stadig ikke genskabes. `TILLAEG-gendannelse-storage.md` gælder uændret, og beståelseskriteriet skal skelne mellem metadata og filer, ellers kan øvelsen bestå uden at bevise det, den skal bevise.

---

## 3. Mandagslisten

Samme form som NU-listen. Sorteret efter *hvad der går galt først*, ikke efter tid.

| # | Hvad | ID | Tid | Hvorfor før mandag |
|---|---|---|---|---|
| 1 | **Køb numre til prod-puljen** | — (planens opgave 3) | 30 min | Puljen står på **ét ledigt**. Kunde nummer to fejler ved provisionering. Blokerer også det fulde checkout-gennemløb, der stadig mangler. Husk `VOICE_URL` = prod i `buy-numbers.js` |
| 2 | **Aktivér dødmandsknappen** | D3 | 1 t | Bygget og testet ende-til-ende, bevidst ikke slået til. Uden den opdages en død Twilio-webhook af en sur kunde. **To fund i filen 4/9 — se afsnittet nedenfor, den kan ikke bare slås til som den står** |
| 3 | **Fjern `/test-appsignal`** | S23 | 5 min | Offentligt endpoint, der kaster en fejl på kommando, markeret *"MIDLERTIDIG — fjern efter test"* i `server.js` linje 586 |
| 4 | **Small compute + PITR** (Pro bekræftet på plads 4/9) | Ø7, D1 | 30 min | Compute-skiftet kræver en databasegenstart — den skal ligge før mandag, ikke søndag aften. Rækkefølge: Small compute → PITR |
| 5 | **Gendannelsesøvelsen igen, efter PITR** | D1 | timer | De daglige logiske backups stopper, når PITR slås til. Er dit eget `pg_dump`-script ikke kørende ved siden af, mistes den fil, øvelsen hviler på. **Øvelsen skal ligge før mandag** — se afsnittet nedenfor. *En leveret rettelse er ikke en anvendt rettelse* |
| 6 | **Enhedsøkonomien regnet igennem** | Ø1 | 2 t | H/H, `NU`, står åben som punkt 7. Fra mandag sælger et andet menneske på et dækningsbidrag, ingen har set. Ø7 gør tallet dyrere, ikke billigere |
| 7 | **MFA hele vejen rundt** | S10 | 45 min | Punkt 12 på NU-listen, stadig åben. Domæneregistratoren styrer e-mail og dermed magic links — den er hele auth-overfladens rod |
| 8 | **Afklar J1** | J1 | — | Markeret pilotblokerende i GDPR-sporet. Er svaret på ansøgningen ikke kommet, udløses den besluttede reserveplan: DPA-skabelonen købes særskilt |

**Ikke på listen, bevidst:** D2 (tests), D11 (triage-runbog), D24 (RLS-testens huller), S9. Alle fire er reelle og alle fire er `Pilot`. De bliver ikke farligere mandag end i fredags — men de bliver dyrere at undvære, når support begynder at afbryde udviklingsarbejdet (O3). De hører til i den første uge efter, ikke i weekenden før.

---

## 4. Ændringslogpost, klar til indsættelse

```
| 2026-09-04 | **Overgang til betalende drift besluttet: go-live 7/9 med sælger på produktet.** `Betalende`-udløseren fyrer dermed på én dag, og seks punkter er gennemgået på den præmis (D15, S8, S18, O1, O2, J11). **O1 og O2 får K hævet M → H:** nedgraderingen 4/8 hvilede eksplicit på "med nul kunder er konsekvensen af Anns fravær lille", og den præmis udløber — en nedgradering, hvis grundlag forsvinder, er ikke en risiko, der er blevet mindre. **D39, Ø7 og S24 oprettet.** **D1 præciseret:** PITR tager hele databasen fysisk og dækker dermed `storage.objects`/`storage.buckets`-metadata, som `--schema=public` ikke dumpede — men ikke filerne selv, så D1's storage-halvdel er uændret åben. **Bemærk om PITR: de daglige logiske backups stopper, når PITR slås til** — det egne dump-script skal køre ved siden af, ellers forsvinder den fil, gendannelsesøvelsen hviler på |
```

---

## 5. Seks-linse-tjek på beslutningen om at gå live mandag

Registret kræver tjekket ved en beslutning. Et blankt svar er selv en advarsel — her er der to.

- **Driftbarhed** — Nej, ikke fuldt. O1 står uændret: én operatør, ingen anden kan deploye, rotere nøgler eller læse en migration. D11's triage-runbog findes ikke, så "en kunde siger det ikke virker" har ingen første side. Det er den svageste linse, og den er svag på en måde, der ikke kan bygges væk inden mandag — kun bemandes omkring.
- **Arkitektur** — Ingen ny særting. Alt herover er eksisterende mønstre, der får deres udløser: afstemning (Å2), fail-closed (Å3), alarmer (Å6).
- **Kodekvalitet** — Uændret. D2 står åben; der er stadig ingen automatiske tests på de dyre veje, og det er Å1 i sin oprindelige form.
- **Sikkerhed** — Ny angrebsflade: flere tenants i samme base. S8 er den, der gør forskellen fra usynlig til reel, og D24's tre huller betyder, at den grønne RLS-test beviser mindre, end den ser ud til.
- **Økonomi** — **Blankt felt.** Ø1 er ikke regnet, og Ø7 lægger en ny fast omkostning oveni. Det er den eneste linse, hvor svaret ikke bare er "utilstrækkeligt" men "ukendt", og det er to timers arbejde at lave om.
- **Forretning** — Ja. Produktet kan forklares i én sætning, og der er nu et menneske, hvis arbejde det er at gøre det. Men **P1 står stadig åben**: ingen fremmed har brugt produktet. Sælgeren løser rekrutteringen (P3), ikke observationen. Sid ved siden af den første kunde under onboarding, og sig ingenting.

---

## 2b. Dødmandsknappen (D3) — to fund og konfigurationen

Gennemgang af `dodmandsknap.js` 4/9. **Tidszonen er i orden** — `koebenhavnNu()` bruger `Intl` med `Europe/Copenhagen`, så arbejdstidsvinduet er sommertidssikkert af sig selv. Men to ting skal rettes, før den slås til.

**Fund 1 — alarmen kunne svigte tavst netop når den skulle bruges.** Miljøtjekket dækkede kun `SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY`, altså evnen til at *opdage* stilhed. Mail-variablerne (`SCW_SECRET_KEY`, `SCW_PROJECT_ID`, `SMTP_FROM`, `ADMIN_EMAIL`) og `APPSIGNAL_APP_ENV=production` var utjekkede — manglede en af dem, kørte servicen grønt i ugevis og tav først den dag, den skulle råbe. **En dødmandsknap uden fungerende mailvej er farligere end ingen, fordi den giver falsk tryghed.** Rettet 4/9: tjekket udvidet til seks variabler plus ét værditjek på `APPSIGNAL_APP_ENV` (tilstedeværelse er ikke nok — en forkert værdi glider igennem og blokerer mailen tavst). Fail-closed ved opstart, jf. Å3.

**Fund 2 — tærsklen på 4 timer ville fyre hver morgen.** Vinduet er 7–17, men `timerSiden` måler almindelige urtimer inklusive natten. Tirsdag kl. 07 er sidste opkald typisk mandag kl. 16:30 — 14,5 timer, langt over 4. Alarmen fyrer, og uden køletid fyrer den ved hver kørsel til dagens første opkald lander. **De to indstillinger komponerer ikke:** vinduet begrænser *hvornår der spørges*, ikke *hvad der måles*.

**Konfigurationen, i to trin, fordi den ikke kan virke ordentligt uden en hjerteslags-kilde:**

| | Fase 1 — fra mandag, uden hjerteslag | Fase 2 — når det syntetiske opkald findes |
|---|---|---|
| `ARBEJDSTID_START` | `11` | `9` |
| `ARBEJDSTID_SLUT` | `17` | `17` |
| `DOEDMANDS_TIMER` | `20` | `4` |
| Cron | `0 * * * *` (hver time, UTC) | `0 * * * *` |
| Hvad den fanger | flerdøgns-udfald | udfald inden for ca. 4 timer |
| Kendt støj | **fyrer mandag formiddag efter hver weekend** | ingen |

Fase 1 er bevidst ufølsom. Med jeres trafikmængde kan alarmen ikke skelne "webhooken er død" fra "en stille uge" — **det er ikke et konfigurationsproblem, det er et informationsproblem.** Sæt den lavere, og du lærer dig selv at ignorere rødt (samme lærdom som nøglescanningens mønstre 19/8).

**Cron-intervallet er køletiden**, siden scriptet ingen har: hver time giver maks. seks mails på en helt tavs dag i stedet for tolv ved hvert kvarter. Railway kræver mindst 5 minutter mellem kørsler, og skemaet er i UTC — men det er uden betydning her, netop fordi scriptet selv siger nej uden for vinduet. Derfor: kør hele døgnet, lad scriptet bestemme.

**Tre ting til servicens beskrivelse, så de ikke skal genopdages kl. 23:**

1. **Exit-kode 1 betyder fire forskellige ting** — manglende variabel, kan ikke læse `calls`, alarm sendt som den skal (linje 129), og mail fejlede. Byg aldrig overvågning på den. Sammen med D32's libuv-crash er Railways kørselshistorik uden værdi for denne service. **Kun mailen tæller.**
2. **Alarmen er global.** Den læser nyeste række i `calls` på tværs af alle firmaer, så ét fungerende nummer holder den tavs, selv om alle andre kunders numre er døde. Det bliver mere forkert, jo flere kunder der kommer.
3. **Vagthunden kan selv dø tavst.** Railway springer en planlagt kørsel over, hvis den forrige stadig står som `Active` — hænger scriptet (fx et Supabase-kald uden timeout), holder cronnen bare op med at køre, uden at noget siger fra. Overvej en timeout på Supabase-kaldet i en senere opgave.

**Hjerteslaget: Anne, ikke sælgeren.** Besluttet 4/9 — sælgeren skal ikke være led i overvågningskæden. Anne får en fast profil i prod, og et syntetisk opkald til hendes DDK-nummer hver anden time 7–15 giver et garanteret opkald, alarmen kan måle fravær af. **Bemærk scopet:** opkaldene må ikke udløse SMS til den kaldende eller tælle med som leads, så det kræver en kendt-testkalder-spærre i selve flowet — det er ikke en halv times opgave, og det er grunden til fase 1 findes.

**Evaluering efter 14 dage (18/9).** Rigtigt valgt tidspunkt: opstarten er ovre, og de første afviklinger er begyndt. Den skal svare på fire ting:

1. Hvor mange alarmer fyrede, og hvor mange af dem var ægte? Én falsk er én for mange på en alarm, der skal kunne vækkes af.
2. **Hvad er det længste ægte hul mellem opkald inden for en arbejdsdag?** Det tal *er* den rigtige tærskel, og det kan kun aflæses af data:

```sql
select max(gap) as laengste_hul_i_arbejdsdag
from (
  select created_at - lag(created_at) over (order by created_at) as gap,
         (created_at at time zone 'Europe/Copenhagen')::date as dag,
         lag((created_at at time zone 'Europe/Copenhagen')::date) over (order by created_at) as forrige_dag
  from calls
  where extract(isodow from created_at at time zone 'Europe/Copenhagen') <= 5
    and extract(hour  from created_at at time zone 'Europe/Copenhagen') between 7 and 16
) t
where dag = forrige_dag;
```

3. Var der et reelt udfald, alarmen *ikke* fangede? Det er det dyre spørgsmål, og svaret findes i Twilio-loggen, ikke i registret.
4. Er hjerteslaget bygget? Hvis ja, skift til fase 2's tal. Hvis nej, er D3 stadig kun halvt slået til, og det skal stå som sådan.

---

## 5b. Reetableringsøvelsen

Overvejelserne, de fire tabsscenarier, fremgangsmåden og beståelseskriterierne står i **`claude/reetableringsoevelse-forslag.md`** — planlagt til søndag 6/9. Bekræftet i konsollen 4/9: PITR er aktiv, gendannelsesvindue 7 dage, ændringer logges hvert 2. minut, hvilket giver **RPO op til 2 minutter**. Supabase' egen tekst bekræfter D1: *"Restoring an old backup does not restore objects that have been deleted since then."*

*(Holdt ét sted med vilje — jf. O7: fem dokumenter, der beskriver det samme, bliver forældede med garanti.)*

---

## 6. Afklaret af Ann 4/9

**Supabase er på Pro.** Punkt 4 reduceres til Small compute + PITR.

**Numre genbruges ikke længere — de frigives hos Twilio ved afvikling.** Det ændrer tre ting, og lukker ikke D37:

- **D37 skal omskrives, ikke lukkes.** Rodårsagen er ikke genbrug — den er, at den forhenværende kundes viderestilling (`**61*<nr>#`) sidder på kundens eget mobilabonnement og overlever afviklingen. Frigivelse ændrer kun, *hvem* der modtager opkaldet: nummeret går tilbage i Twilios lager og kan købes af hvem som helst. Før gik opkaldet til en anden DDK-kunde, som vi kunne nå; nu går det til en fremmed, vi ikke kan nå. Set fra GDPR er det ikke entydigt en forbedring. **Rettelsen ligger i afviklingsproceduren, ikke i koden:** kunden skal fjerne viderestillingen, og det skal verificeres, før nummeret frigives. `RUNBOOK-kundeafvikling.md` og `RUNBOOK-numre.md` afsnit 4 skal opdateres — ændringslogposten 9/8 beskriver eksplicit den gamle fremgangsmåde (*"Nummer taget tilbage til puljen uden frigivelse hos Twilio"*), og den er nu forkert.
- **D31 bliver formentlig irrelevant, men skal afgøres bevidst.** Spørgsmålet var, om `afstem-numre.js` tæller karantænenumre med som ledige. Frigives numre, findes karantænen ikke længere som tilstand — men kører 30-dages-logikken (`quarantined_until`) stadig i koden, tæller den nu på noget, der ikke eksisterer, og puljen kan se mindre ud, end den er. Enten fjernes logikken, eller også lukkes D31 med en begrundelse.
- **Puljen fyldes ikke længere op af afgang.** Hver ny kunde kræver et nyt nummerkøb. Med en sælger på produktet er nummerkøb en løbende driftsopgave, ikke en engangsopgave. **Lavvandsalarm er på plads (mail ved tre ledige, bekræftet af Ann 4/9).** Åbent spørgsmål: er tre nok varsel? Tre ledige er tre kunders råderum, og indkøbet tager ca. 30 min plus `VOICE_URL`-omtanke. Lukker sælgeren fire på en uge, rammer alarmen for sent.

### Karantæne frem for frigivelse — forslag til D37

Viderestillingen sidder på kundens eget mobilabonnement, så **fjernelsen** er uden for DDK's hænder. Men **modtageren** er ikke: så længe nummeret er DDK's, bestemmer DDK, hvad et forvildet opkald møder. Frigivelsen er dermed ikke en neutral oprydning — den er det øjeblik, hvor kontrollen gives fra sig. Fire skridt, alle inden for egne hænder:

1. **Park nummeret kortvarigt i stedet for at frigive det straks.** ⚠️ **Rettet 4/9: et Twilio-nummer koster $15/md, ikke småpenge** — tre måneders parkering er ca. $45 pr. afviklet kunde, og det tal skalerer med afgang. Parkeringen skal derfor ikke være en fast kalenderperiode, men **kortest muligt og styret af måling: minimum 30 dage, forlænget i 30-dages spring kun så længe der stadig kommer opkald.** For de fleste kunder bliver det ét månedsgebyr. Nummeret peges imens på en neutral TwiML-besked ("dette nummer er ikke længere i brug").
2. **Tæl opkaldene i parkeringsperioden — det er tællingen, der betaler for sig selv.** 30 dage med nul indgående opkald = viderestillingen er væk, nummeret frigives, og gebyret stopper. Kommer der stadig opkald, tjener nummeret sin pris ind som skærm, og du har konkret bevis at give den forhenværende kunde, som lige nu mister leads uden at vide det. **Uden tællingen er du tvunget til at gætte en periode og betale for hele den; med tællingen betaler du kun for den tid, der faktisk er brug for.** Det er også derfor automatikken (punkt 4 nedenfor) er en besparelse og ikke en ekstraopgave.
3. **Skift hilsenen ved afvikling, ikke ved frigivelse.** Den personlige AI-hilsen skal væk fra nummeret i samme øjeblik kunden afvikles. Det lukker "hører en anden kundes besked"-delen af D37 helt, og det er ren konfiguration.
4. **Fail-closed spærre på frigivelsen** (Å3): et nummer kan ikke frigives, før både bekræftelsen og nul-trafik-perioden foreligger. Ellers er parkeringen en hensigt, ikke en spærre — samme mønster som D8's deploy-regel.

Til farvelbrevet: **giv koden, ikke påmindelsen.** Onboardingen gav `**61*<nr>#` med præcise ord; afviklingen skal give modstykket lige så præcist — `##61#`, ring op, kvittering "Erasure was successful". Verificér koden hos de danske operatører først. Og **verificér frem for at spørge:** ring kundens eget mobilnummer op og lad det ringe ud — lander opkaldet i Twilio-loggen på DDK-nummeret, er viderestillingen der stadig. Det tager 30 sekunder og er forskellen på "vi har sagt det" og "vi ved det".

Forslag til ny D37-række:

```
| D37 | **En forhenværende kundes viderestilling overlever afviklingen.** `**61*<nr>#` sidder på kundens eget mobilabonnement, ikke hos DDK, og forsvinder ikke ved opsigelse. Frigives nummeret hos Twilio, kan det købes af hvem som helst — og den forhenværende kundes opkaldere, med deres telefonnumre og deres ærinde, lander hos en fremmed, DDK ikke kan nå | M | H | Betalende · timer | Åben | **Fjernelsen er kundens; modtageren er vores.** (1) hilsenen skiftes til neutral ved afvikling, ikke ved frigivelse · (2) nummeret parkeres **minimum 30 dage, forlænget kun mens der stadig kommer opkald** — $15/md gør en fast 3-måneders periode for dyr · (3) automatisk test af, om viderestillingen er fjernet, plus tælling af indgående opkald: nul i 30 dage = frigiv og stop gebyret · (4) fail-closed spærre: frigivelse kræver både bekræftelse og nul-trafik-perioden. Venlig påmindelse pr. mail og SMS med koden `##61#`; manuelt opkald som sidste kontrol. **Restrisiko: en kunde der aldrig fjerner viderestillingen, og et nummer der frigives til sidst — dokumenteret og accepteret, ikke overset** |
```

**Bemærk også, at dette er en persondatasag og ikke kun en driftssag:** opkalderens telefonnummer er persondata, og det er DDK, der frigiver nummeret. Overvej en henvisning fra J-tabellen til D37, så den ikke kun står under Drift.

### Pointer til farvelbrevet — samlet, ikke skrevet endnu

Brevet skrives, når de første kunder skal afvikles (Ann, ca. en uge efter go-live). Her er det, det skal indeholde, så pointerne ikke skal genfindes:

**Det bærende:** brevet er ikke en høflighed, det er den ene handling, DDK ikke selv kan udføre. Alt andet i afviklingen ligger hos os; **kun fjernelsen af viderestillingen ligger hos kunden.** Brevet skal skrives ud fra den erkendelse — det er en instruktion forklædt som en venlighed, ikke omvendt.

1. **Giv koden, ikke påmindelsen.** `##61#`, ring op, kvitteringen lyder "Erasure was successful". Onboardingen gav dem `**61*<nr>#` med præcise ord; afviklingen skal give modstykket lige så præcist. "Husk at fjerne viderestillingen" bliver ikke gjort. Verificér koden hos TDC/YouSee, Telenor, Telia og 3, før den sendes ud.
2. **Sig hvorfor det er i deres egen interesse, ikke i vores.** Så længe viderestillingen står, ryger deres ubesvarede opkald væk fra dem — de mister kunder uden at opdage det, fordi der ikke kommer nogen fejlmeddelelse. Det er det argument, der virker på en håndværker. "Af hensyn til databeskyttelse" er det, der ikke gør.
3. **Sig hvad der sker, hvis de ikke gør det.** Nummeret bliver frigivet efter en periode og kan derefter tilhøre en fremmed. Deres kunder vil så ringe til en person, de ikke kender. Konkret og uden dramatik.
4. **Sæt en dato.** "Vi holder nummeret indtil [dato]" giver handlingen et tidspunkt. Et brev uden frist er en oplysning; et brev med frist er en opgave.
5. **Både mail og SMS.** SMS'en er den korte med koden; mailen er den med forklaringen. Målgruppen læser SMS.
6. **Fortæl, at vi tjekker — og at vi ringer.** Både fordi det er ærligt, og fordi det virker: en handling, man ved bliver kontrolleret, bliver udført. Det manuelle opkald er sidste kontrol, ikke første.
7. **Ingen bebrejdelse, ingen jura.** Kunden har sagt op. Brevet skal kunne læses af en, der er lidt irriteret på os, uden at gøre det værre.

**Det, brevet ikke kan bære:** det kan ikke gøre fjernelsen sikker. Derfor er brevet punkt ét af fire i D37 og ikke løsningen — automatikken, tællingen og spærren er de tre andre.

**P7-kollisionen.** Registrets egen regel fra 8/8 og 13/8 er *"den, der allerede er citeret andetsteds, beholder nummeret"*. D36-posten 23/8 citerer P7 som *den oprindelige forventning, Fase 1 bevidst afviger fra* — altså "piloterne ser halvdelen". **Efter registrets egen regel er det derfor `s-expired`-rækken, der skal have det nye nummer (P8), og "piloterne ser halvdelen", der beholder P7.**

Om at acceptere den: ja, men **ikke ubetinget**. D36-beslutningen 23/8 siger eksplicit, at forventningen skal kommunikeres til pilotkunden før frigivelse. Med en sælger på produktet er det ikke længere Ann, der sætter forventningen. Risikoen flytter sig fra produkt til salgsløfte — den forsvinder ikke. Forslag til rækken:

```
| P7 | **Piloterne ser halvdelen af det, der blev efterspurgt** — samtalepartnerne nævnte indtalte tilbud *og* fakturering. Tilbudsdelen kommer først, faktureringsdelen bagefter | M | L | Pilot · — | **Accepteret 4/9** | Accepteret som produktrisiko: rækkefølgen er bevidst, og ingen kunde mister noget, de har betalt for. **Betingelsen, der gør accepten gyldig:** forventningen skal være sagt højt før salg, og fra 7/9 er det sælgeren, ikke Ann, der siger den. Skriv den ene sætning ned til sælgeren — hvad produktet gør i dag, og hvad der kommer senere. Bortfalder betingelsen, er accepten ikke længere dækkende |
```

**Bemærk mønsteret:** det er tredje gang i denne gennemgang, at en accept eller nedgradering hviler på en præmis, der ikke står i rækken — O1/O2 ("ingen kunder"), NU-listens punkt 15 ("vi tager cifre i stedet") og nu P7. Når præmissen ikke er skrevet ned sammen med beslutningen, kan ingen se, at den er udløbet. **Forslag til en regel i "Sådan bruges registret": en `Accepteret`-status skal indeholde den betingelse, der gør accepten gyldig — ellers er den en forglemmelse med et pænere navn.**
