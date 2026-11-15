-- =====================================================================
-- Skrivehjælp (Fase 4) — jeg eller vi i firma_profil
-- Dit Digitale Kontor · Kundehenvendelser og SoMe
--
-- Besluttet af Ann og Anne 15/11-26:
--   Svar, opslag og kommentarer skrives som standard i jeg-form, for det er én
--   person, der skriver. Firmaet kan skifte til vi-form under Profil -> Skrivehjælp.
-- Skrives kun af serveren (POST /api/skrivehjaelp/profil, service role).
-- firma_profil har allerede RLS, og rækken findes for hvert firma (D68).
--
-- Én ny kolonne med standarden 'jeg'. Alle eksisterende firmaer får 'jeg',
-- som er det, alle svar skrives i fra denne udgave. Ingen andre data røres.
-- KAN RULLES TILBAGE uden tab af andet end de valg, firmaer har nået at gøre.
--
-- RÆKKEFØLGE: kør migrationen, FØR koden deployes. Koden læser skrive_form,
-- og uden kolonnen kan Skrivehjælp ikke hente firmaets profil.
-- =====================================================================

alter table public.firma_profil
  add column if not exists skrive_form text not null default 'jeg';

alter table public.firma_profil drop constraint if exists firma_profil_skrive_form_vaerdi;
alter table public.firma_profil
  add constraint firma_profil_skrive_form_vaerdi
  check (skrive_form in ('jeg', 'vi'));

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Kontrol efter kørsel
-- ---------------------------------------------------------------------
--   select column_name, data_type, column_default, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'firma_profil' and column_name = 'skrive_form';
--     -- én række: text, 'jeg'::text, NO
--   select skrive_form, count(*) from public.firma_profil group by skrive_form;
--     -- kun 'jeg', lige efter kørslen
--
-- Rollback (tjek først, hvem der har valgt vi: select count(*) from public.firma_profil where skrive_form = 'vi';):
--   alter table public.firma_profil drop constraint if exists firma_profil_skrive_form_vaerdi;
--   alter table public.firma_profil drop column if exists skrive_form;
