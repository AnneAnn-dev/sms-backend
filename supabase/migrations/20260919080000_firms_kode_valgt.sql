-- =====================================================================
-- Migration — firms.kode_valgt_at
-- Dit Digitale Kontor · faerre logins i onboardingen, niveau 1 (D60)
--
-- HVORFOR DEN FINDES
-- Kunden vaelger i dag sin adgangskode paa `s-2` i Safari og skal foerst
-- bruge den, naar hun aabner den installerede app. To browsere, to
-- lagringer, og et felt hvor iOS kan have gemt en kode i noeglering, som
-- hun aldrig har set. Niveau 1 fjerner det trin fra onboardingen og
-- spoerger i stedet INDE I APPEN, hvor koden faktisk skal bruges.
--
-- Serveren skal derfor kunne svare paa ét spoergsmaal: har hun valgt en
-- kode endnu? Browseren kan ikke svare — hun moeder skaermen i en anden
-- browser end den, hun kom fra. Det er praecis samme begrundelse som for
-- `app_bekraeftet_at` (13/9): serveren er det eneste, de to browsere deler.
--
-- ⚠️ BEMAERK: feltet sidder paa FIRMAET, ikke paa brugeren, fordi resten af
-- app-tilstanden goer det samme. Faar et firma en dag to brugere, er det
-- forkert sted — saa skal det flyttes til en pr-bruger-tabel. Skrevet ned
-- nu, saa det ikke skal opdages.
--
-- Expand-halvdelen: NULLABLE kolonne, ingen contract. Kode uden kolonne
-- fejler blidt; kolonne uden kode er harmloes.
--
-- Rulles tilbage med:
--   alter table public.firms drop column if exists kode_valgt_at;
--
-- Raekkefoelge: staging -> roegtest -> prod (via push-script, aldrig db reset).
-- Denne fil maa efter anvendelse ALDRIG omdoebes eller slettes.
-- =====================================================================

alter table public.firms
  add column if not exists kode_valgt_at timestamptz;

comment on column public.firms.kode_valgt_at is
  'Naar kunden valgte sin adgangskode inde i appen (D60 niveau 1). NULL = ikke valgt endnu; saa beder appen om den ved foerste aabning. Foerste skrivning vinder.';

-- ---------------------------------------------------------------------
-- Engangs-udfyldning af de firmaer, der allerede findes
-- ---------------------------------------------------------------------
-- Alle eksisterende firmaer er kommet gennem `s-2` og HAR en adgangskode.
-- Uden denne linje ville de alle sammen blive bedt om at vaelge en ny ved
-- naeste aabning af appen — en skaerm, ingen af dem har brug for, og som de
-- ikke kan komme forbi. Det er ikke en "backfill for pænhedens skyld";
-- det er forskellen paa en rolig udrulning og en, hvor hver eneste kunde
-- moeder en spaerreskaerm.
--
-- now() og ikke created_at: tidspunktet er ikke data, vi kender — vi ved
-- kun, at koden ER valgt. Et opdigtet tidspunkt ville se ud som en maaling.
update public.firms
   set kode_valgt_at = now()
 where kode_valgt_at is null;

-- ---------------------------------------------------------------------
-- ⚠️ FOER DU KOERER DEN MOD PROD — det ene hul, der ikke kan lukkes i SQL
-- ---------------------------------------------------------------------
-- Et firma, der staar MIDT i onboardingen i dette oejeblik, kan vaere naaet
-- forbi `s-2` (har kode) eller ikke (har ingen). Linjen ovenfor stempler
-- dem begge som "kode valgt". Den, der ikke naaede det, bliver aldrig
-- spurgt igen og har saa kun engangskoden som vej ind.
--
-- Tjek derfor foerst, om der overhovedet er nogen:
--    select id, name, created_at from public.firms where status = 'onboarding';
--
-- Nul raekker: koer bare. Er der raekker, saa vent til de er faerdige, eller
-- saet deres kode_valgt_at tilbage til null bagefter, saa appen spoerger:
--    update public.firms set kode_valgt_at = null where id = '<firma-id>';

-- ---------------------------------------------------------------------
-- Kontroller efter koersel (koer manuelt, gem output)
-- ---------------------------------------------------------------------
-- 1) Kolonnen findes og er nullable:
--      select column_name, data_type, is_nullable from information_schema.columns
--      where table_schema='public' and table_name='firms' and column_name='kode_valgt_at';
--
-- 2) Ingen gamle firmaer staar tilbage uden stempel (skal give 0):
--      select count(*) from public.firms where kode_valgt_at is null;
--
-- 3) PostgREST har set skemaet:
--      notify pgrst, 'reload schema';
--
-- 4) Efter foerste nye kunde — hun skal have faaet sit stempel i appen:
--      select name, status, app_bekraeftet_at, kode_valgt_at
--      from public.firms order by created_at desc limit 5;
