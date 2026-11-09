# Drejebog: Skrivehjælp (Fase 4, T2) på staging

*Skrevet 8/11-26. Grenen `fase4/t2` (seneste commit `725c389`). Prod røres ikke.*

Rækkefølgen er valgt, så intet kan gå galt halvvejs: databasen først, så koden med flaget **slukket**, så flaget tændt, så ét testfirma. Hvert trin har et tjek. Passer tjekket ikke, så stop.

**Rollback på ethvert tidspunkt:** sæt `SKRIVEHJAELP_AKTIV=false` i Railway staging. Ruterne forsvinder (404), og fanen siger "Skrivehjælpen er på vej." Migrationerne kan blive stående; de rører ingen data.

## 0. Før du går i gang

- [ ] Railway er oppe (status.railway.com).
- [ ] `git status -sb` på `fase4/t2` er ren, og `node kor-proever.js` giver 37 af 37 grønne.
- [ ] Ingen anden chat deployer til staging lige nu.

## 1. Migrationerne i staging-databasen

Køres i denne rækkefølge, på samme måde som I plejer for staging. **Aldrig prod.**

1. `supabase/migrations/20261105120000_ai_forbrug_skrivehjaelp.sql`: tre nye formål i CHECK-reglen på `ai_forbrug`. **Skal køres før koden**, ellers bliver Skrivehjælps forbrug ikke bogført, og loftet virker ikke.
2. `supabase/migrations/20261108120000_firma_profil_skrivehjaelp.sql`: `branche`, `afsender_navn` og `afsender_telefon` i `firma_profil`.

Tjek bagefter i SQL-editoren:

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_forbrug_formaal_gyldig';
-- skal nævne skrivehjaelp_svar, skrivehjaelp_kommentar og skrivehjaelp_opslag

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'firma_profil'
  and column_name in ('branche', 'afsender_navn', 'afsender_telefon');
-- tre rækker
```

## 2. Variabler i Railway staging

Sæt dem, **før** koden deployes. Flaget står slukket indtil trin 4.

| Variabel | Værdi | Hvorfor |
|---|---|---|
| `SKRIVEHJAELP_AKTIV` | `false` | Ruterne registreres ikke endnu |
| `SKRIVEHJAELP_MODEL` | `mistral-medium-3.5-128b` | Skrivehjælps egen låste model (D14) |
| `AI_SVAR_MAANEDSLOFT_DKK` | `10` | Ann 5/11 |
| `AI_SVAR_DAGSLOFT_DKK` | `2` | Ann 5/11 |
| `AI_FACEBOOK_MAANEDSLOFT_DKK` | `10` | Ann 5/11 |
| `AI_FACEBOOK_DAGSLOFT_DKK` | `2` | Ann 5/11 |

Mangler en `AI_SVAR_*` eller `AI_FACEBOOK_*`, afvises den pulje med 503 (fail-closed); optagelse og referat påvirkes ikke.

## 3. Koden på staging (flaget slukket)

```powershell
git switch staging
git pull
git status -sb
git merge fase4/t2
git show HEAD:static/sw.js | Select-String "CACHE_NAME ="
node kor-proever.js
git push
```

- [ ] Konflikter i `git merge`: stop og send outputtet til Claude.
- [ ] `CACHE_NAME` skal være højere end alt, der har været brugt. T2 har `dashboard-v73`. Har staging selv fået v73 eller højere i mellemtiden, så bump til næste ledige før push.
- [ ] `kor-proever.js`: 37 af 37 grønne.
- [ ] Railway-loggen ved opstart viser `Skrivehjaelp:      SLUKKET`.
- [ ] Appen virker som før: Opgaver, Kunder, Profil, Din pakke med én grå linje "Kundehenvendelser og SoMe – Kommer snart".

## 4. Tænd flaget

- [ ] `SKRIVEHJAELP_AKTIV=true` i Railway staging. Railway genstarter.
- [ ] Loggen viser `Skrivehjaelp:      TAENDT` og `✍️  Skrivehjælp registreret paa /api/skrivehjaelp`.

## 5. Modulet på ét testfirma

Fanen Værktøjer vises kun for firmaer med `svar` eller `facebook`. Giv dem til testfirmaet i hånden (`kilde = 'manuel'`, som synken ikke rører):

```sql
insert into public.firma_moduler (firm_id, modul, kilde)
values ('<testfirmaets id>', 'svar', 'manuel'), ('<testfirmaets id>', 'facebook', 'manuel')
on conflict (firm_id, modul) do nothing;
```

## 6. Røgtest på iPhone (installeret app, logget ind som testfirmaet)

Luk og åbn appen først, så den nye `sw.js` hentes.

| # | Gør | Forventet |
|---|---|---|
| 1 | Se bundbjælken | Opgaver · Kunder · **Værktøjer** (skruenøgle) |
| 2 | Tryk Værktøjer første gang | Skærm 1: navn, telefonnummer (forslag med "Firmaets nummer"/"Dit nummer"), "Dine svar slutter sådan:", branche nederst |
| 3 | Tryk Gem uden navn | "Skriv dit navn." Intet gemt |
| 4 | Udfyld og Gem | Værktøjer med tre rækker under "Skrivehjælp" |
| 5 | Profil → Skrivehjælp | Afsender og branche står der; "Ret" åbner skærm 1 |
| 6 | Svar til en kunde: vælg Ny opgave, lad "Vil du tage opgaven?" stå tom, Skriv udkast | "Udfyld: Vil du tage opgaven?" Intet kald |
| 7 | Udfyld feltet, SMS, Skriv udkast | "Skriver udkast …", derefter udkastet, "Læs udkastet …", "Tjek før du sender" |
| 8 | Kopiér svaret, indsæt i Beskeder | Teksten er der, uden ### og noter |
| 9 | Kortere og Nyt forslag | Nyt udkast hver gang |
| 10 | "‹ Ret" | Formularen med det, du skrev |
| 11 | Mail i stedet for SMS | Udkastet starter med "Emne:" |
| 12 | Opslag, platform Begge | Fire kort: Vinkel 1 og 2, hver med Facebook og Instagram; Kopiér virker |
| 13 | Svar på en kommentar | To forslag |
| 14 | Felter: tryk i et skrivefelt | iPhone zoomer IKKE ind (16 px) |

**Loftet og 90 %-beskeden** (sæt midlertidigt `AI_SVAR_DAGSLOFT_DKK=0.05`, dvs. 5 øre; ét svar koster ca. 3,5 øre):

| # | Gør | Forventet |
|---|---|---|
| 15 | Skriv ét svar | Udkast, ingen besked |
| 16 | Skriv ét svar mere | Udkast med "Du har nu brugt 90 % af din dagsrate." |
| 17 | Skriv et tredje | Afvist med Annes tekst: "Du har brugt dagens skrivehjælp. …" |
| 18 | Skriv et opslag | Virker: opslag er en anden pulje |
| 19 | Sæt `AI_SVAR_DAGSLOFT_DKK=2` igen | |

**Bogføringen:**

```sql
select formaal, count(*), round(sum(pris_oere)::numeric, 2) as oere
from public.ai_forbrug
where created_at > now() - interval '2 hours' and formaal like 'skrivehjaelp_%'
group by formaal;
-- en række pr. formål, du har brugt; antallet passer med dine kald
```

- [ ] AppSignal: forventede "Kvoteafvisning" fra trin 17, ingen "Bogfoeringsfejl".
- [ ] Railway-loggen: ingen kundetekst (søg efter et ord fra en testbesked).

## 7. Derefter

1. **Annes QA** på staging med sine egne beskeder.
2. **Fase 4's port** (udviklingsplanen): udkast på 10 **rigtige** beskeder, læst af Anne.
3. **Registret:** P5 (tallet fra den hånd-læste måling, lag 1-2 bevist på staging), S6 (ruterne bygget, `proev-skrivehjaelp-ruter.js` grøn), Ø2 (lofterne bevist), J9 lukkes for Skrivehjælp (Scaleways svar 6/11), D14 (låst model i Railway).
4. Først derefter prod: migrationerne, variablerne, flaget og ét pilotfirma — en drejebog for sig.
