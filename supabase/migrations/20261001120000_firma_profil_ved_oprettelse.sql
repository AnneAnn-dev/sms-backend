-- =====================================================================
-- Migration — firma_profil oprettes af databasen, naar et firma oprettes
-- Dit Digitale Kontor · D68
--
-- HVORFOR DEN FINDES
-- `firma_profil` blev oprettet med Migration B 27/7-26 og har aldrig faaet
-- en eneste raekke. En migration opretter en tabel, ikke raekker, og
-- provisioneringen var skrevet, foer tabellen fandtes. Hullet var tavst i
-- to maaneder, fordi ingen kode laeser tabellen endnu. Foerste symptom ville
-- have vaeret en kunde med et tilbud uden priser (Trin 4).
--
-- HVORFOR EN TRIGGER OG IKKE KODE I provisionFirm
-- Der findes mindst tre veje, der opretter et firma: Frisbii-webhooken,
-- provision-test-firm.js og haandskrevet SQL. Kode i provisionFirm daekker
-- den ene, og den naeste vej, nogen bygger, skal huske det igen. Det var
-- praecis det, der gik galt i juli. Triggeren sidder dér, hvor ALLE veje
-- moedes, og der er derfor intet at huske.
-- Alternativet, kode i Node, er mere synligt. Synligheden er erstattet af
-- vaernet nedenfor (afsnit 3), som roegtesten spoerger hver gang.
--
-- HVAD RAEKKEN FAAR
-- Kun firm_id. Resten er tabellens standardvaerdier: moms 25, gyldighed
-- 30 dage, tilbudsnummer 1, og intet kvoteloft (NULL = miljoeets standard).
-- Firmaet udfylder resten selv i Indstillinger.
--
-- FEJLER INDSAETNINGEN, FEJLER FIRMAOPRETTELSEN
-- Bevidst. Et firma uden profil er det, D68 handler om. provisionFirm
-- kaster da, eventet gaar i dead-letter og proeves igen. Indsaetningen kan
-- reelt kun fejle, hvis tabellen er vaek.
--
-- Rulles tilbage med (raekkerne, der er oprettet, er harmloese og bliver):
--   drop trigger  if exists firms_opret_firma_profil on public.firms;
--   drop function if exists public.opret_firma_profil();
--   drop function if exists public.firma_profil_komplet();
--
-- Raekkefoelge: staging -> roegtest -> prod (via push-script, aldrig db reset).
-- Denne fil maa efter anvendelse ALDRIG omdoebes eller slettes.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Triggeren
-- ---------------------------------------------------------------------

create or replace function public.opret_firma_profil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.firma_profil (firm_id)
  values (new.id)
  on conflict (firm_id) do nothing;
  return new;
end;
$$;

comment on function public.opret_firma_profil() is
  'D68: opretter firma_profil-raekken for hvert nyt firma, uanset hvilken vej firmaet blev oprettet ad. Kaldes kun af triggeren firms_opret_firma_profil.';

revoke all on function public.opret_firma_profil() from public, anon, authenticated;

drop trigger if exists firms_opret_firma_profil on public.firms;
create trigger firms_opret_firma_profil
  after insert on public.firms
  for each row execute function public.opret_firma_profil();


-- ---------------------------------------------------------------------
-- 2. Engangs-udfyldning af de firmaer, der allerede findes
-- ---------------------------------------------------------------------
-- Ann 1/10: "der er ikke noget at migrere lige nu". Er det rigtigt, goer
-- saetningen ingenting. Ligger der alligevel testfirmaer (fx i staging),
-- faar de deres raekke her, saa vaernet i afsnit 3 ikke er roedt fra dag et.
-- Taaler at blive koert igen.

insert into public.firma_profil (firm_id)
select f.id
from public.firms f
on conflict (firm_id) do nothing;


-- ---------------------------------------------------------------------
-- 3. Vaernet: roegtesten spoerger, om hvert firma har sin profil
-- ---------------------------------------------------------------------
-- smoke.js koerer med ANON-noeglen og maa aldrig have service role, og RLS
-- lader ikke anon taelle firmaer. Funktionen svarer derfor paa ét ja/nej-
-- spoergsmaal med definer-rettigheder.
--
-- Den svarer med et ja/nej og ikke et antal: et antal ville fortaelle enhver
-- med anon-noeglen, hvor mange firmaer der er kommet til siden en fejl.
-- Hvilke firmaer der mangler, finder man med SQL'en i smoke.js' fejlbesked.

create or replace function public.firma_profil_komplet()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.firms f
    where not exists (
      select 1 from public.firma_profil p where p.firm_id = f.id
    )
  );
$$;

comment on function public.firma_profil_komplet() is
  'D68-vaern: true = hvert firma har en firma_profil-raekke. Kaldes af smoke.js med anon-noeglen. Svarer kun ja/nej, aldrig antal eller id''er.';

revoke all     on function public.firma_profil_komplet() from public, anon, authenticated;
grant  execute on function public.firma_profil_komplet() to anon;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Kontroller efter koersel (SQL-editoren)
-- ---------------------------------------------------------------------
--   -- Triggeren findes:
--   select tgname from pg_trigger where tgname = 'firms_opret_firma_profil';
--   -- forventet: 1 raekke
--
--   -- Ingen firmaer uden profil:
--   select f.id from public.firms f
--   where not exists (select 1 from public.firma_profil p where p.firm_id = f.id);
--   -- forventet: 0 raekker
--
--   -- Vaernet svarer:
--   select public.firma_profil_komplet();
--   -- forventet: true
