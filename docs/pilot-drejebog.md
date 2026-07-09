# Pilot-drejebog — manuelle prøvekunder før Frisbii live

*Dit Digitale Kontor · oprettet 8/7-26 · ejere: Ann (teknik) + Anne (formular, kommunikation, kundekontakt)*

**Formål:** Begynde stille kundetilgang (gratis prøvemåned til håndværkere) FØR
indløsningsaftalen/MSN og Frisbii live-nøgler er på plads — uden checkout på
hjemmesiden. Betalingsflowet erstattes af en formular + manuel provisionering.
Løsningen er bevidst manuel: med en håndfuld piloter er 5 min/kunde ingen
byrde, og den tætte kontakt med de første kunder er et AKTIV, ikke en omkostning.

**Hvorfor ikke bare checkout-linket nu?** (1) Prods Frisbii-konto kører i
TEST-tilstand — rigtige kort afvises; live kræver indløsningsaftalen.
(2) Trial-tilmeldinger udløser ikke `invoice_settled` → ingen provisionering
(kendt kodeopgave, jf. runbook byggetrin 6). Formular-vejen omgår begge.

---

## Forudsætninger (Ann — tjekkes ÉN gang før første pilot)

- [ ] **Prod-nummerpuljen:** nok ubundne numre til pilot-ambitionen (tjek
      `select number, firm_id from phone_numbers;` i PROD). Køb evt. flere
      DK-numre i Twilio-HOVEDKONTOEN (jf. opskriftsbogen; RC Address, ikke bundle).
- [ ] **Voice-webhooks på ALLE pulje-numre** peger på PROD-URL'en
      (`.../opkald`, HTTP POST, region US1!) — verificér pr. nummer i Twilio.
- [ ] **`+4591309423`s binding afklaret** (jeres eget testfirma — skal den
      genoprettes eller frigives til puljen?).
- [ ] **Prod-toget kørt** (byggetrin 6-koden + migrationer 2+3 i prod), så
      karantæne/dead-letter-logikken også gælder piloterne.
- [ ] `provision-test-firm.js` gennemlæst: bekræft at den sætter alle felter
      korrekt til en RIGTIG kunde (navn, email, telefon — og at evt.
      `is_test`-flag sættes til FALSE for piloter).

## Anne — formular + kommunikation

- [ ] **"Få en gratis prøvemåned"-formular på hjemmesiden:** navn, firmanavn,
      email, mobilnummer, evt. fag/branche. Ingen betaling, ingen kort.
      V1 må gerne bare sende en mail til jer — hastighed over elegance.
- [ ] **Bekræftelsestekst på formularen:** "Tak! Vi gør dit nummer klar og
      vender tilbage inden for [X timer]." — forventningsafstemning er halvdelen
      af oplevelsen (og løser manuelt det hul, systemet har ved tavshed).
- [ ] **Velkomst-opfølgning:** kort personlig mail/SMS efter provisionering
      ("dit nummer er klar — sådan kommer du i gang") som supplement til
      systemets automatiske velkomstmail med magic link.

## Drejebogen pr. tilmelding (Ann, ~5 min)

1. **Tilmelding modtages** (formular-mail). Svar-SLA: samme dag.
2. **Tjek dublet-email FØRST:** `select id, name, email from firms where email = '<kundens>';`
   i PROD. Findes den allerede → STOP og håndtér manuelt (kendt begrænsning:
   dublet-emails knækker nyt-link-opslaget — se runbook byggetrin 6).
3. **Provisionér** fra PowerShell med EKSPLICITTE prod-vars i sessionen
   (lokal `.env` peger på staging — prod kræver bevidst handling, det er meningen):
   ```powershell
   $env:SUPABASE_URL = "https://glymuxqtrbpeyzmflilf.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "<prod service_role fra Bitwarden>"
   # + Twilio-HOVEDKONTOENS creds + Scaleway-vars (INGEN MAIL_OVERRIDE_TO!)
   node provision-test-firm.js --phone <kundens-mobil> ... # jf. scriptets flags
   ```
   Kunden får nummer + velkomstmail + magic link automatisk.
4. **Verificér:** firma i prod-`firms`, nummer bundet, ring selv til nummeret
   (greeting? SMS-lead ankommer?). Læg kundens mobil i whitelisten hvis relevant.
5. **Send Annes personlige velkomst** (punktet ovenfor) + notér kunden i
   pilot-oversigten (simpelt ark: navn, email, nummer, startdato, prøve-udløb).
6. **Kalender-reminder:** prøve-udløb om 30 dage → kontakt kunden FØR udløb
   (konvertering eller afvikling — se nedenfor).

## Overgang når indløsningsaftalen lander

1. Frisbii live-nøgler → PROD (runbookens go-live-gate; staging beholder testkonto).
2. Pr. pilot der vil fortsætte: opret abonnement i Frisbii (eller send rigtigt
   checkout-link) → sæt `frisbii_subscription`-handlen på firmaets række →
   webhooken overtager livscyklussen derfra.
3. Piloter der IKKE fortsætter: expire manuelt → deprovisionering + karantæne-
   logik håndterer nummeret (prøvekunde uden betaling → frigives straks).

## Kendte skarpe kanter

- **Ingen automatisk prøve-udløb:** manuelle piloter har intet Frisbii-abonnement,
  så INTET expirer dem automatisk — kalender-reminderen (punkt 6) er mekanismen.
- **Dublet-emails** (punkt 2) — tjekkes manuelt indtil kodeopgaven er løst.
- **MAIL_OVERRIDE_TO må ALDRIG være sat** i den session, der provisionerer
  piloter — ellers får kunden ingen velkomstmail (den går til jer).
- Scriptet hedder stadig provision-TEST-firm.js — det provisionerer ægte nok,
  men gennemlæs flags/defaults før første rigtige kunde (jf. forudsætninger).
