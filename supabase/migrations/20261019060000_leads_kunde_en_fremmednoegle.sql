-- 20261019060000_leads_kunde_en_fremmednoegle.sql — én fremmednøgle fra leads til kunder (D88)
--
-- FEJL fundet 19/10-26 på staging, efter 20261018120000_kunde_telefoner:
-- Kunder-fanen svarede "Noget gik galt her hos os" ved åbning af en kunde.
-- Årsag: leads fik en ANDEN fremmednøgle til kunder (leads_kunde_samme_firma,
-- den sammensatte (kunde_id, firm_id)), oven i den gamle leads_kunde_id_fkey.
-- Med to relationer mellem samme to tabeller kan PostgREST ikke vælge, og
-- ethvert `kunder(navn)` i en select fra leads fejler (routes/tilbud/data.js,
-- GET /api/tilbud/opgaver og /opgaver/:id). Testen målte databasen, men ikke
-- et PostgREST-embed — derfor slap det igennem.
--
-- RETTELSEN: den gamle, enkle nøgle fjernes. Den sammensatte gør det samme
-- og mere (samme kunde OG samme firma, `on delete set null (kunde_id)`).
-- Hullet i en sammensat nøgle — en række med firm_id NULL tjekkes ikke —
-- lukkes med en CHECK: en opgave med kunde skal have et firma.
--
-- KAN RULLES TILBAGE:
--   alter table public.leads drop constraint if exists leads_kunde_kraever_firma;
--   alter table public.leads add constraint leads_kunde_id_fkey
--     foreign key (kunde_id) references public.kunder(id) on delete set null;
-- (men så er embeddet tvetydigt igen).

do $$
declare n integer;
begin
  select count(*) into n from public.leads where kunde_id is not null and firm_id is null;
  if n > 0 then
    raise exception 'STOP: % opgave(r) har en kunde, men intet firma. Ret dem, før migrationen køres igen.', n;
  end if;
end $$;

alter table public.leads drop constraint if exists leads_kunde_id_fkey;

alter table public.leads drop constraint if exists leads_kunde_kraever_firma;
alter table public.leads add constraint leads_kunde_kraever_firma
  check (kunde_id is null or firm_id is not null);

-- Præcis ÉN fremmednøgle fra leads til kunder — ellers er embeddet stadig
-- tvetydigt (fx hvis den gamle nøgle hed noget andet end forventet).
do $$
declare n integer;
begin
  select count(*) into n
    from pg_constraint
   where contype = 'f'
     and conrelid = 'public.leads'::regclass
     and confrelid = 'public.kunder'::regclass;
  if n <> 1 then
    raise exception 'STOP: leads har % fremmednøgler til kunder, forventet 1.', n;
  end if;
end $$;

notify pgrst, 'reload schema';
