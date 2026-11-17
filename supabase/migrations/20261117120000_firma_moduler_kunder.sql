-- 20261117120000_firma_moduler_kunder.sql — Fase 4 salg, T1 (17/11-26)
--
-- Nyt modul "kunder": Kunder og Opgaver i appen. Det saelges ikke for sig, men
-- foelger med "Skrivehjaelp og SoMe med kunder" (pakken modul-svar-some).
-- Telefonpasser, Referat, Tilbud, Faktura og Booking giver allerede Kunder og
-- Opgaver uden en kunder-raekke; reglen bor i koden, ikke her.
-- Byggeplan: docs/fase4-salg-byggeplan.md (godkendt af Anne 17/11).
--
-- Kun CHECK-reglen firma_moduler_modul udvides. Ingen data roeres.
-- Modulnavnene staar OGSAA i moduler.js (MODULER). Ret begge steder;
-- proev-frisbii-katalog.js tjekker, at de er ens.
--
-- Koeres FOER koden, der kender modulet: ellers afviser databasen synk-kaldet
-- for et firma med pakken, og hele kaldet rulles tilbage.
--
-- Kontrol efter koersel (skal vise 'kunder' i listen):
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'firma_moduler_modul';
--
-- Kan rulles tilbage: ja, saa laenge ingen raekke har modul = 'kunder'.
--   select count(*) from public.firma_moduler where modul = 'kunder';  -- skal vaere 0
--   alter table public.firma_moduler drop constraint firma_moduler_modul;
--   alter table public.firma_moduler add constraint firma_moduler_modul check
--     (modul in ('telefon', 'referat', 'tilbud', 'faktura', 'booking', 'svar', 'facebook'));

alter table public.firma_moduler drop constraint firma_moduler_modul;

alter table public.firma_moduler add constraint firma_moduler_modul check
  (modul in ('telefon', 'referat', 'tilbud', 'faktura', 'booking', 'svar', 'facebook', 'kunder'));
