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
`.gitignore` rettet. Fremadrettet: secret scanning i CI — se **S2** i risikoregistret. Historikken består fortsat — se **S1**.

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
