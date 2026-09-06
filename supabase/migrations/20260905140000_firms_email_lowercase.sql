-- 20260905140000_firms_email_lowercase.sql
--
-- Normaliserer firms.email til smaa bogstaver.
--
-- BAGGRUND (fundet 5/9-26)
-- /onboarding/nyt-link — "Send mig et login-link", login-redningsvejen —
-- slaar firmaet op med .eq("email", <input gjort til smaa bogstaver>). `=` er
-- versalfoelsomt i Postgres, saa en raekke skrevet med stort rammes aldrig:
-- endpointet svarer "ukendt email", sender ingen mail, og kunden faar
-- alligevel den generiske kvittering (anti-enumeration). Fejlen er dermed
-- usynlig i BEGGE ender — kunden ser en kvittering, og loggen paastaar at
-- adressen ikke findes.
--
-- Skriverne er rettet i samme ombaering: provision-test-firm.js normaliserer
-- nu ved oprettelse (den indsatte foer --email ordret), og frisbii-webhook.js
-- gjorde det i forvejen (linje 307). Denne migration rydder derfor kun op
-- efter de raekker, der allerede staar forkert.
--
-- KOER DETTE FOERST — findes der adresser, der kun adskiller sig ved
-- versaler, smelter de sammen til det samme opslag bagefter, og saa skal du
-- vide det, FOER du koerer opdateringen:
--
--     select lower(email) as adresse, count(*), array_agg(id)
--       from public.firms
--      where email is not null
--      group by lower(email)
--     having count(*) > 1;
--
-- Giver den raekker, saa stop og afgoer hvert tilfaelde i haanden. Giver den
-- ingenting, er migrationen ufarlig.
--
-- IDEMPOTENT: kan koeres igen uden virkning.
--
-- ROLLBACK: ingen automatisk. Det er en envejs-normalisering, og den er ikke
-- tabsgivende for opslaget — en lowercased adresse rammer alt, den gamle
-- vaerdi ramte, plus dem den ikke ramte. Skal den oprindelige skrivemaade
-- endelig frem igen, findes den kun i backup (PITR, 7 dages vindue).
--
-- BEVIDST IKKE MED: en unique-constraint paa lower(email). Dubletter er et
-- kendt aabent punkt, og en constraint, der kan fejle paa eksisterende data,
-- hoerer ikke til to dage foer go-live. Tjekket ovenfor er svaret indtil da.

update public.firms
   set email = lower(email)
 where email is not null
   and email <> lower(email);
