-- =====================================================================
-- Skrivehjælp (Fase 4, T2) — branche og afsendernavn i firma_profil
-- Dit Digitale Kontor · Kundehenvendelser og SoMe
--
-- Besluttet af Ann:
--   3/11: branchen spørges ved første brug (vælger Annes branchepakke).
--   8/11: underskriften er navn og firmanavn, fx "Peter, Hansens VVS";
--         navnet spørges første gang Skrivehjælp åbnes. Telefonnummeret under
--         svarene spørges samme sted (Ann 8/11: firmaets nummer og ejerens mobil
--         er ofte det samme, men ikke altid). Tomt = intet nummer i underskriften.
-- Skrives kun af serveren (POST /api/skrivehjaelp/profil, service role).
-- firma_profil har allerede RLS, og rækken findes for hvert firma (D68).
--
-- Rører ingen data. Tre nye kolonner, alle tomme (NULL) for alle firmaer.
-- KAN RULLES TILBAGE uden tab, så længe ingen har udfyldt dem.
-- =====================================================================

alter table public.firma_profil
  add column if not exists branche text,
  add column if not exists afsender_navn text,
  add column if not exists afsender_telefon text;

alter table public.firma_profil drop constraint if exists firma_profil_branche_laengde;
alter table public.firma_profil
  add constraint firma_profil_branche_laengde
  check (branche is null or char_length(branche) between 1 and 40);

alter table public.firma_profil drop constraint if exists firma_profil_afsender_navn_laengde;
alter table public.firma_profil
  add constraint firma_profil_afsender_navn_laengde
  check (afsender_navn is null or char_length(afsender_navn) between 1 and 60);

alter table public.firma_profil drop constraint if exists firma_profil_afsender_telefon_form;
alter table public.firma_profil
  add constraint firma_profil_afsender_telefon_form
  check (afsender_telefon is null or afsender_telefon ~ '^\+?[0-9 ]{8,20}$');

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Kontrol efter kørsel
-- ---------------------------------------------------------------------
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'firma_profil'
--     and column_name in ('branche', 'afsender_navn', 'afsender_telefon');  -- tre rækker, text
--
-- Rollback (tjek først: select count(*) from public.firma_profil
--   where branche is not null or afsender_navn is not null or afsender_telefon is not null;  -- skal være 0):
--   alter table public.firma_profil drop constraint if exists firma_profil_branche_laengde;
--   alter table public.firma_profil drop constraint if exists firma_profil_afsender_navn_laengde;
--   alter table public.firma_profil drop constraint if exists firma_profil_afsender_telefon_form;
--   alter table public.firma_profil drop column if exists branche, drop column if exists afsender_navn,
--     drop column if exists afsender_telefon;
