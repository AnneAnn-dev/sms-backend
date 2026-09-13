-- =====================================================================
-- Migration — firms.app_bekraeftet_at + firms.app_valgt_fra_at
-- Dit Digitale Kontor · 13/9-26
--
-- HVORFOR: viden om, at en kunde stadig mangler at laegge appen paa
-- telefonen, har indtil nu ligget i BROWSEREN — et flag i localStorage
-- (`ddk-vil-installere`) og maerket `?trin=app` i adressen. Browsere deler
-- ingen af delene. Mailens indbyggede browser og Safari er to fremmede, og
-- i det sekund kunden skifter over, er oplysningen vaek.
--
-- Foelgen, maalt paa Annes telefon 13/9-26: hun gennemfoerte onboardingen i
-- mailens browser, skiftede til Safari og loggede ind med engangskoden — og
-- landede DIREKTE i dashboardet. Installationsguiden blev aldrig vist, og
-- intet sted stod der noget om det. Uden appen er der ingen web-push, og
-- uden push faar haandvaerkeren ikke besked om sine leads. Altsaa hele den
-- betalte vaerdi, tabt i et browserskift.
--
-- Rettelsen er at flytte oplysningen hen, hvor BEGGE browsere kan naa den.
-- Serveren er det eneste, de deler.
--
--   app_bekraeftet_at  Appen er paa telefonen. Saettes to steder:
--                      (1) kunden trykker "Jeg har lagt den paa min telefon"
--                      (2) dashboardet aabnes standalone — altsaa et BEVIS,
--                          ikke en paastand. Det andet signal retter sig selv,
--                          ogsaa hvis kunden sprang knappen over.
--   app_valgt_fra_at   Kunden trykkede "Aabn i browseren". Slukker den
--                      automatiske omdirigering til guiden — men IKKE
--                      paamindelsen i dashboardet. "Ikke nu", ikke "aldrig".
--
-- Expand-halvdelen af expand/contract: to nullable kolonner, ingen backfill,
-- ingen aendring af eksisterende raekker. Tom = ikke bekraeftet, hvilket er
-- den sikre standard.
--
-- ⚠️ Ingen kunder i drift 13/9-26, saa der er ingen bivirkning. Var der
-- kunder, ville de alle se guiden én gang ved naeste browser-besoeg, indtil
-- de aabnede appen — selvkorrigerende, men vaerd at vide.
--
-- Rulles tilbage med:
--   alter table public.firms
--     drop column if exists app_bekraeftet_at,
--     drop column if exists app_valgt_fra_at;
-- Intet andet objekt afhaenger af dem, saa det er en sikker rollback.
--
-- RLS: `firms` har sine politikker i forvejen, og en ny kolonne aendrer dem
-- ikke. Kolonnerne LAESES af klienten gennem den eksisterende politik og
-- SKRIVES kun server-side med service role (POST /api/firma/app-status).
--
-- Raekkefoelge: staging -> roegtest -> prod, via push-scripts. Aldrig db reset.
-- =====================================================================

alter table public.firms
  add column if not exists app_bekraeftet_at timestamptz,
  add column if not exists app_valgt_fra_at  timestamptz;

comment on column public.firms.app_bekraeftet_at is
  'Appen er bekraeftet paa kundens telefon (knap eller standalone-aabning). NULL = ikke bekraeftet.';
comment on column public.firms.app_valgt_fra_at is
  'Kunden valgte "Aabn i browseren". Slukker omdirigering til installationsguiden, ikke paamindelsen.';

-- ---------------------------------------------------------------------
-- Kontroller efter koersel (koer manuelt, gem output)
-- ---------------------------------------------------------------------
-- 1) Kolonnerne findes og er nullable:
--      select column_name, data_type, is_nullable
--      from information_schema.columns
--      where table_schema='public' and table_name='firms'
--        and column_name in ('app_bekraeftet_at','app_valgt_fra_at');
--
-- 2) Ingen raekker roert:
--      select count(*) as bekraeftede from public.firms where app_bekraeftet_at is not null;
--      -- forventet: 0 lige efter migrationen
--
-- 3) PostgREST har set skemaet:
--      notify pgrst, 'reload schema';
