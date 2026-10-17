-- =====================================================================
-- Indtal ny opgave — nyt formål i ai_forbrug
-- Dit Digitale Kontor · dashboardet ("+ Ny opgave")
--
-- Besluttet af Ann 16/10-26: indtaling i "+ Ny opgave" trækker fra SAMME
-- kvote som Referat-fanen, men bogføres under sit eget formål, så de to
-- slags forbrug kan skilles ad bagefter.
--
-- ⚠️ KØRES FØR KODEN (routes/tilbud/index.js med /api/indtaling/*).
-- Uden den afviser CHECK-reglen rækken, kvote.bogfoer() logger fejlen og
-- lader svaret gå igennem — så er indtalingen gratis, og loftet virker ikke.
--
-- Rører ingen data. Reglen udvides; ingen eksisterende række kan bryde den.
-- =====================================================================

alter table public.ai_forbrug
  drop constraint if exists ai_forbrug_formaal_gyldig;

alter table public.ai_forbrug
  add constraint ai_forbrug_formaal_gyldig
  check (formaal in ('transskription','referat','tilbud','notefoto','opgave_transskription'));

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Kontrol efter kørsel
-- ---------------------------------------------------------------------
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'ai_forbrug_formaal_gyldig';
--   -- skal nævne 'opgave_transskription'
--
-- Rollback (kun hvis ingen rækker har det nye formål):
--   alter table public.ai_forbrug drop constraint ai_forbrug_formaal_gyldig;
--   alter table public.ai_forbrug add constraint ai_forbrug_formaal_gyldig
--     check (formaal in ('transskription','referat','tilbud','notefoto'));
