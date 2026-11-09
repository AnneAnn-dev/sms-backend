-- =====================================================================
-- Skrivehjælp (Fase 4) — tre nye formål i ai_forbrug
-- Dit Digitale Kontor · Kundehenvendelser og SoMe
--
-- Besluttet af Ann 5/11-26: Skrivehjælp har sine egne puljer i kvote.js
-- (`svar` og `facebook`, 10 kr./md. og 2 kr./dag pr. del), så Referat og
-- Skrivehjælp ikke tager af hinandens loft. Hver rute bogfører under sit eget
-- formål, så forbruget kan skilles ad bagefter:
--   skrivehjaelp_svar       POST /api/skrivehjaelp/svar        (pulje svar)
--   skrivehjaelp_kommentar  POST /api/skrivehjaelp/kommentar   (pulje svar)
--   skrivehjaelp_opslag     POST /api/skrivehjaelp/opslag      (pulje facebook)
--
-- ⚠️ KØRES FØR KODEN, der bogfører de nye formål. Uden den afviser CHECK-reglen
-- rækken, kvote.bogfoer() larmer i AppSignal og lader svaret gå igennem — så er
-- Skrivehjælp gratis, og loftet virker ikke.
--
-- Listen skal følge PULJER i kvote.js; proev-kvote.js tjekker, at puljerne
-- dækker præcis disse otte formål.
--
-- Rører ingen data. Reglen udvides; ingen eksisterende række kan bryde den.
-- KAN RULLES TILBAGE, så længe ingen række har et af de tre nye formål.
-- =====================================================================

alter table public.ai_forbrug
  drop constraint if exists ai_forbrug_formaal_gyldig;

alter table public.ai_forbrug
  add constraint ai_forbrug_formaal_gyldig
  check (formaal in (
    'transskription','referat','tilbud','notefoto','opgave_transskription',
    'skrivehjaelp_svar','skrivehjaelp_kommentar','skrivehjaelp_opslag'
  ));

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Kontrol efter kørsel
-- ---------------------------------------------------------------------
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'ai_forbrug_formaal_gyldig';
--   -- skal nævne 'skrivehjaelp_svar', 'skrivehjaelp_kommentar' og 'skrivehjaelp_opslag'
--
-- Rollback (kun hvis ingen rækker har de nye formål — tjek først:
--   select count(*) from public.ai_forbrug where formaal like 'skrivehjaelp_%';  -- skal være 0):
--   alter table public.ai_forbrug drop constraint ai_forbrug_formaal_gyldig;
--   alter table public.ai_forbrug add constraint ai_forbrug_formaal_gyldig
--     check (formaal in ('transskription','referat','tilbud','notefoto','opgave_transskription'));
