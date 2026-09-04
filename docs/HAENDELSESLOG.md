# Hændelseslog — Dit Digitale Kontor

**Ejer:** Ann
**Oprettet:** 2026-08-01
**Relaterede dokumenter:** `RISIKOREGISTER.md` · `RUNBOOK-noeglerotation.md` · `gdpr.xlsx` (ark: Databrud)

---

## Regler for denne log

1. **Append-only.** Poster rettes aldrig og slettes aldrig. Ny viden tilføjes som et opdateringsafsnit under posten med dato.
2. **Alt logføres.** Også hændelser der viser sig at være ufarlige. En tom log er ikke bevis på, at der ikke er sket noget.
3. **Vurderingen er det vigtige.** Konklusionen "ikke anmeldelsespligtig" er kun værd noget, hvis begrundelsen står der.
4. **Ingen hemmeligheder i loggen.** Aldrig nøgler, adgangskoder, telefonnumre eller navne på registrerede. Henvis i stedet ("nøgle A i Bitwarden", "berørt kunde nr. 3").
5. **Opdagelsestidspunktet starter uret.** 72-timersfristen løber fra det øjeblik, du blev opmærksom på hændelsen — ikke fra hændelsen selv. Notér tidspunktet først, analysér bagefter.

**Alvorlighed:** `Lav` (ingen persondata, ingen adgang) · `Middel` (adgang mulig, ikke sandsynlig) · `Høj` (persondata berørt eller adgang sandsynlig)

**Klassifikation:** `Sikkerhedshændelse` (ikke persondata) · `Databrud — ikke anmeldelsespligtigt` · `Databrud — anmeldt`

---

## Skabelon

```
## [ÅR-MM-DD] Kort titel                                    HÆNDELSE-NNN

| Felt | Værdi |
|---|---|
| Opdaget | dato + klokkeslæt |
| Opdaget af | |
| Hændelsen fandt sted | dato eller periode, evt. "ukendt" |
| Alvorlighed | |
| Klassifikation | |
| Persondata berørt | Ja / Nej / Kan ikke udelukkes |
| Registrerede berørt | antal og kategori, eller "ingen" |
| Anmeldt til Datatilsynet | Ja (dato) / Nej |
| Berørte informeret | Ja (dato) / Nej / Ikke relevant |
| Lukket | dato |

**Hvad skete der**

**Hvordan blev det opdaget**

**Hvad blev gjort — med tidspunkter**

**Vurdering af anmeldelsespligt**
Begrundelse for konklusionen. Hvilke persondata kunne teoretisk tilgås, af hvem,
og hvad taler for og imod at det er sket.

**Årsag**

**Hvad forhindrer gentagelse**
Henvis til risiko-ID i registret hvis relevant.
```

---

# Hændelser

> De to poster nedenfor er **udkast, der skal efterprøves af Ann**. Datoer, tidspunkter og forløb er rekonstrueret og skal rettes til det faktiske, før posterne betragtes som endelige. Fjern denne note, når det er sket.

## [2026-05-xx] `.env` committet til git — UDKAST, SKAL EFTERPRØVES     HÆNDELSE-001

| Felt | Værdi |
|---|---|
| Opdaget | 2026-05-xx|
| Opdaget af | Ann |
| Hændelsen fandt sted | tidligt i projektet — maj måned først i projektet |
| Alvorlighed | Middel |
| Klassifikation | Sikkerhedshændelse |
| Persondata berørt | Nej |
| Registrerede berørt | Ingen |
| Anmeldt til Datatilsynet | Nej |
| Berørte informeret | Ikke relevant |
| Lukket | Lukket |

**Hvad skete der**
En `.env`-fil med API-nøgler til flere tjenester blev committet til git-repositoriet. Filen forblev i historikken efter, at den var fjernet fra arbejdstræet.

**Hvordan blev det opdaget**
Visuel gennemgang af git-repositoriet

**Hvad blev gjort**
Fuld rotation af nøgler til Scaleway TEM, Simply.com DNS, VAPID, AppSignal, Frisbii, Supabase og Twilio. Processen er dokumenteret i `RUNBOOK-noeglerotation.md`.

**Vurdering af anmeldelsespligt**
*Udfyldes af Ann. Punkter der bør indgå:*
- *Var repositoriet privat i hele perioden? Ja
- *Havde andre end Ann adgang? Nej 
- *Nøglerne er ikke i sig selv persondata — men de gav adgang til systemer, der indeholder persondata. Vurderingen bør forholde sig til, om uautoriseret adgang er sandsynlig eller blot teoretisk mulig. Der var på dette tidspunkt ingen data i systemet.  
- *Findes der adgangslogs hos Supabase eller Twilio, der kan be- eller afkræfte brug? Nej

**Årsag**
`.env` var ikke i `.gitignore` fra projektets start.

**Hvad forhindrer gentagelse**
`.gitignore` rettet. Gitleaks pre-commit etableret 31/7 og verificeret i begge retninger. Serverside secret scanning viste sig **ikke** at være tilgængelig for private repoer på gratis-plan (afklaret 5/8) — se **S2**. Historikken består fortsat — se **S1**.

### Opdatering 2026-08-05 — uafhængig bekræftelse af commit og omfang

*Tilføjet efter arbejde med S2 (push protection). Ændrer ikke vurderingen; rettes ikke ind i teksten ovenfor, jf. regel 1.*

**Intet nyt i sagen.** At `.env` lå i git, har været kendt hele vejen, og nøglerne blev roteret — to gange, da HÆNDELSE-002 senere gav anledning til en rotation mere. Det følgende er dokumentation, ikke et nyt fund.

**Hvad GitHubs secret scanning viser.** To alarmer, begge oprettet 15. maj 2026, begge med *Detected in 1 location*: commit `d6e373b`, filen `.env`. Kilden er altså dette private repositorium og ikke en offentlig lokation — mærkaten **"Public leak"** beskriver mønsterkategorien (nøgleformater, der er offentligt dokumenterede og derfor genkendelige), ikke at nøglerne har ligget offentligt tilgængeligt. **Præmissen "repositoriet var privat i hele perioden" holder dermed.**

| # | Type | Fundet i |
|---|---|---|
| 1 | Twilio Account String Identifier | `.env` linje 4 |
| 2 | Supabase Service Key | `.env` linje 2 |

**Værdien er, at vurderingen nu hviler på noget efterprøvbart** — commit-hash, fil og dato fra en tredjepart — i stedet for på hukommelse. Det er værd at have, hvis vurderingen nogensinde skal forsvares over for andre end os selv.

**To forbehold, der bør stå her.** Alarmlisten er **ikke** en opgørelse over omfanget: GitHub genkender kun sine partneres mønstre. Filen indeholder eksempelvis også `TWILIO_AUTH_TOKEN` på linje 5 — den egentlige hemmelighed, hvor Account SID på linje 4 blot er en identifikator — og den har ingen alarm. Scaleway, Frisbii og VAPID har heller ingen. **Det fulde omfang læses af commit `d6e373b`, ikke af alarmlisten.** Alt er roteret uanset.

**Konsekvens for S1.** Registrets åbne spørgsmål — hvad ligger der i historikken — kan nu besvares præcist ved at åbne den ene commit. Det er en billigere vej end den, S1 forudsatte.

**Handling.** Begge alarmer lukkes som *Revoked* med henvisning til nøglerotationen.

---

## [2026-07-22] Claude Code læste `.env` — UDKAST, SKAL EFTERPRØVES     HÆNDELSE-002

| Felt | Værdi |
|---|---|
| Opdaget | 2026-07-22 |
| Opdaget af | Ann |
| Hændelsen fandt sted | *udfyldes* |
| Alvorlighed | *vurderes — foreslået: Middel* |
| Klassifikation | *vurderes — foreslået: Sikkerhedshændelse* |
| Persondata berørt | *vurderes* |
| Registrerede berørt | *vurderes — formentlig ingen* |
| Anmeldt til Datatilsynet | Nej |
| Berørte informeret | Ikke relevant |
| Lukket | *udfyldes* |

**Hvad skete der**
Under opsætning af Claude Code læste værktøjet `.env`-filen, før deny-reglerne i `.claude/settings.json` var bekræftet virksomme. Indholdet blev dermed sendt til en ekstern tjeneste.

**Hvordan blev det opdaget**
*Udfyldes.*

**Hvad blev gjort**
Fuld nøglerotation. Deny-regler i `.claude/settings.json` blokerer nu adgang til `.env`-filer. Guardrails tilføjet i `CLAUDE.md`.

**Vurdering af anmeldelsespligt**
*Udfyldes af Ann. Punkter der bør indgå:*
- *Der blev overført nøgler, ikke persondata.*
- *Modtageren er en ekstern databehandler uden aftale på tidspunktet.*
- *Nøglerne gav adgang til systemer med persondata — samme overvejelse som i HÆNDELSE-001.*
- *Nøglerne blev roteret, hvilket gør efterfølgende misbrug umuligt. Hvor hurtigt?*

**Årsag**
Værktøj taget i brug, før dets adgangsbegrænsninger var verificeret.

**Hvad forhindrer gentagelse**
Deny-regler verificeres, før et nyt værktøj får adgang til repositoriet. Bredere princip: nye værktøjer med filadgang testes først mod et tomt repo.

---

## Årsoversigt

| År | Hændelser i alt | Heraf databrud | Heraf anmeldt |
|---|---|---|---|
| 2026 | 2 | *vurderes* | 0 |

---

## Vurderet og bevidst IKKE logført

*Regel 2 siger, at alt logføres — også det ufarlige. Men loggen dækker sikkerhedshændelser og databrud, ikke driftsfejl. Denne liste findes, så fravalget er et valg og ikke en forglemmelse, og så det kan omgøres, hvis vurderingen viser sig forkert.*

| Dato | Hvad | Hvorfor ikke her | Hvor det bor |
|---|---|---|---|
| 2026-08-05 | System-PATH på udviklingsmaskinen var overskrevet ned til to poster; alle System32-værktøjer utilgængelige | Ingen persondata, ingen adgang, intet eksternt. Ren arbejdsstationskonfiguration | Runbogens Del 1 |
| 2026-08-05 | `npm run smoke:prod` havde aldrig kørt reelt — `.env.smoke` havde en placeholder som Supabase-URL og pegede på Simply-sitet i stedet for backenden | Manglende overvågningsdækning, ikke en hændelse. Ingen data berørt. **Grænsetilfælde:** et forsvar, man troede man havde, er beslægtet med det, S2 viste sig at være | Runbogens Del 1 |
| 2026-08-05 | GitHub Secret Protection er ikke inkluderet for private repoer på gratis-plan; knapperne kan slås til uden effekt | Et kontrolhul, ikke en hændelse — ingen hemmelighed slap ud som følge af det. Men det er årsagen til opdateringen af HÆNDELSE-001 ovenfor | Registret, **S2** |
| 2026-08-05 | Onboardingens velkomstskærm lovede en engangskode, mens knappen bad om et link | Brugsfejl uden sikkerheds- eller databeskyttelsesdimension | Registret, ændringslog |
| 2026-08-09 | Kunde nr. 1 (nåede aldrig at blive aktiv) afviklet: nummeret taget tilbage til puljen, `firm_users`-rækken og den tilhørende Auth-bruger slettet for at ugyldiggøre et udsendt, men uindløst magic link | Driftshandling, ikke en hændelse. **Ingen uautoriseret adgang:** linket var udstedt lovligt til modtageren selv, blev aldrig indløst, og firmaet havde hverken tildelt nummer eller kundedata. **Grænsetilfælde:** var brugeren ikke blevet slettet, ville en person uden adgangsgrundlag have haft en gyldig indgang liggende i sin indbakke — det er tilstanden, ikke handlingen, der er risikoen | `RUNBOOK-numre.md` afsnit 4 · registret, **S15** |
| 2026-08-19 | To prod-Twilio-numre skulle tilbage i puljen (afsnit 4), men blev ved en forveksling behandlet efter afsnit 5 (frigivelse): en `delete` uden `returning` gav et tvetydigt "Success. No rows returned", og et af numrene var tæt på at blive frigivet hos Twilio, før forvekslingen blev fanget i selve Release-dialogen | Ingen persondata, ingen uautoriseret adgang, intet tabt hos Twilio — numrene forblev aktive og betalt hele vejen igennem. Ren proces-/tooling-forveksling, rettet før noget fandt sted (genoprettet via afsnit 2, `configure-number.js`) | `RUNBOOK-numre.md`, nyt afsnit 3½ og genopretningsboks i afsnit 5 |
| 2026-09-04 | Global git-identitet (`user.name` / `user.email`) var væk på udviklingsmaskinen; `git commit` afviste med *"Author identity unknown"*. Seneste commit bærer `anneann <…>`, så konfigurationen har eksisteret og er forsvundet — den lå hverken lokalt, globalt eller i systemet på opdagelsestidspunktet | Ingen persondata, ingen adgang, intet eksternt. Ren arbejdsstationskonfiguration — **samme klasse som PATH-hændelsen 5/8, anden forekomst på fem uger**. Værd at bemærke: git fejlede *lukket* — commit'en blev afvist frem for at gå igennem med en gættet identitet. Identiteten genetableret samme dag; `core.hooksPath` var upåvirket, fordi den ligger lokalt i repoet | Runbogens Del 1 · denne tabel |

