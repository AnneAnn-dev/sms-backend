-- =====================================================================
-- leads.telefon — opgavens indtastede/rettede telefonnummer
-- Dit Digitale Kontor · hotfix 10/10-26 (telefonfeltet i dashboardet)
--
-- FUNDET: dashboardets telefonfelt var redigerbart, men blev aldrig gemt.
-- Retter haandvaerkeren et forkert nummer, forsvandt rettelsen ved lukning.
--
-- REGLEN EFTER DENNE MIGRATION:
--   leads.telefon er ALTID et nummer, et menneske har tastet (ikke verificeret).
--   Nummeret, der gaelder, er leads.telefon, ellers calls.from_number.
--   calls.from_number roeres aldrig: det er, hvad nettet oplyste.
--   Reglen staar i /send-sms (onboarding.js) og i leadTelefon() (dashboard.html).
--
-- Rent additiv. Fjerner intet, aendrer intet eksisterende.
-- SKAL koeres paa prod FOER koden deployes: den nye kode laeser kolonnen,
-- den gamle kode er ligeglad med den.
--
-- KAN RULLES TILBAGE: ja, efter koden er rullet tilbage:
--   alter table public.leads drop column telefon;
-- Prisen: numre, der er rettet efter migrationen, gaar tabt.
-- =====================================================================

alter table public.leads
  add column if not exists telefon text;

-- Kun danske numre (+45 og 8 cifre), besluttet af Ann 10/10-26.
-- SAMME regel som gyldigtSmsNummer() i phone.js. Skal udenlandske numre
-- tillades, rettes BEGGE steder — ellers afviser det ene stadig nummeret.
-- Reglen er ogsaa sidste vaern, hvis nogen skriver kolonnen uden om
-- /lead-telefon (authenticated har UPDATE paa leads via RLS).
alter table public.leads
  drop constraint if exists leads_telefon_format;
alter table public.leads
  add constraint leads_telefon_format
  check (telefon is null or telefon ~ '^\+45[0-9]{8}$');

comment on column public.leads.telefon is
  'Indtastet/rettet af haandvaerkeren, ikke verificeret. Gaar forud for calls.from_number. Kun +45 og 8 cifre (leads_telefon_format).';

-- Backfill: "Ny opgave" lagde foer et indtastet nummer i den syntetiske
-- calls-raekke (to_number = ''). Kendes som indtastet, ikke fra opkaldet.
-- Maalt 10/10-26: 0 raekker i baade staging og prod. Bevares alligevel —
-- den er harmloes at koere igen og daekker en opgave oprettet i mellemtiden.
update public.leads l
set    telefon = c.from_number
from   public.calls c
where  l.call_id = c.id
  and  l.telefon is null
  and  c.to_number = ''
  and  c.from_number ~ '^\+45[0-9]{8}$';

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Kontroller efter koersel (koer manuelt, gem output)
-- ---------------------------------------------------------------------
-- 1) Kolonnen og reglen findes:
--      select column_name, data_type, is_nullable from information_schema.columns
--      where table_name = 'leads' and column_name = 'telefon';
--      select conname from pg_constraint where conname = 'leads_telefon_format';
--
-- 2) Ingen manuel opgave med et nummer, der IKKE blev flyttet (skal give 0).
--    Giver den andet end 0, staar et indtastet nummer stadig som "fra opkaldet":
--      select count(*) from public.leads l join public.calls c on c.id = l.call_id
--      where c.to_number = '' and c.from_number <> 'Manuel oprettelse'
--        and l.telefon is null;
--
-- 3) Reglen afviser et udenlandsk nummer (skal FEJLE med leads_telefon_format;
--    koeres i en transaktion, der rulles tilbage):
--      begin;
--      update public.leads set telefon = '+46701234567'
--      where id = (select id from public.leads limit 1);
--      rollback;
