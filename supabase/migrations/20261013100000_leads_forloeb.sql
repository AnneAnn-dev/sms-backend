-- 20261013100000_leads_forloeb.sql — opgavens forløb (udviklingsplanens Fase 1a)
--
-- Beslutning (Ann 13/10-26, D80): fanerne Nye / I gang / Lukkede.
--   Nye     = status 'open' og startet_at er tom
--   I gang  = status 'open' og startet_at er sat
--   Lukkede = alt andet ('completed', 'rejected', 'inactive')
--
-- KUN TILFØJELSER. `status` beholder sine tre betydninger, så det nuværende
-- dashboard i prod virker uændret. "Ny"-mærket og badgen bygger fortsat på
-- seen_at (ulæst) — det er et andet begreb end Nye-fanen (ikke startet).
--
-- Hvad tæller som HANDLING (sætter startet_at første gang, sidst_roert hver
-- gang): note gemt, referat oprettet, tilbud oprettet, SMS sendt fra
-- opgaven (/send-sms kalder opgave_handling) og "Flyt til i gang". Hvad
-- tæller IKKE: at åbne opgaven (seen_at) og at rette navn, telefon, adresse.
--
-- Reglen ligger i databasen, ikke i appen: dashboardet skriver direkte i
-- leads, og referater og tilbud er andre tabeller. Én funktion,
-- opgave_handling(), bærer reglen; notes-triggeren er dens eneste gentagelse,
-- fordi en BEFORE-trigger ikke kan opdatere sin egen række via en funktion.

-- 1. Kolonnerne -------------------------------------------------------------
alter table public.leads
  add column if not exists startet_at  timestamptz,
  add column if not exists sidst_roert timestamptz;

-- 2. Backfill — i ÉN sætning, så en evt. updated_at-trigger ikke når at
--    flytte updated_at, før sidst_roert læser den.
--    Åbne opgaver, håndværkeren har åbnet  -> I gang (fra seen_at)
--    Åbne opgaver, han ikke har åbnet      -> Nye
--    Lukkede opgaver                        -> startet, så Genåbn lander i I gang
update public.leads
   set startet_at  = case when status = 'open' then seen_at
                          else coalesce(seen_at, created_at) end,
       sidst_roert = coalesce(updated_at, created_at, now())
 where sidst_roert is null;

alter table public.leads alter column sidst_roert set default now();
alter table public.leads alter column sidst_roert set not null;

-- 3. Status låses. Målt 13/10: kun 'open' og 'rejected' i staging, kun
--    'open' i prod — reglen kan ikke ramme en eksisterende række.
alter table public.leads drop constraint if exists leads_status_gyldig;
alter table public.leads add constraint leads_status_gyldig
  check (status in ('open', 'completed', 'rejected', 'inactive'));

-- 4. Reglen: én handling på én opgave -----------------------------------------
-- SECURITY INVOKER: kaldt af authenticated gælder RLS (kun egne opgaver);
-- kaldt af serveren med service-nøglen gælder den ikke.
create or replace function public.opgave_handling(p_lead uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.leads
     set startet_at  = coalesce(startet_at, now()),
         sidst_roert = now()
   where id = p_lead;
$$;
revoke all on function public.opgave_handling(uuid) from public, anon;
grant execute on function public.opgave_handling(uuid) to authenticated, service_role;

-- 5. Note gemt = handling. IS DISTINCT FROM er afgørende: dashboardet sender
--    notes med ved HVER gemning, også når kun navnet er rettet.
create or replace function public.leads_forloeb_noter()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.notes is distinct from old.notes then
    new.startet_at  := coalesce(old.startet_at, now());
    new.sidst_roert := now();
  end if;
  return new;
end;
$$;
drop trigger if exists leads_forloeb_noter on public.leads;
create trigger leads_forloeb_noter
  before update of notes on public.leads
  for each row execute function public.leads_forloeb_noter();

-- 6. Referat og tilbud oprettet = handling.
create or replace function public.marker_opgave_handling()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.opgave_handling(new.lead_id);
  return null;
end;
$$;
drop trigger if exists referater_marker_handling on public.referater;
create trigger referater_marker_handling
  after insert on public.referater
  for each row execute function public.marker_opgave_handling();
drop trigger if exists tilbud_marker_handling on public.tilbud;
create trigger tilbud_marker_handling
  after insert on public.tilbud
  for each row execute function public.marker_opgave_handling();

-- 7. Lukning efter 3 måneder uden handling. Kaldes af natjobbet (kommer
--    senere) med p_firm = null. p_firm findes, så prøven kun rører sit eget
--    testfirma — ellers ville en prøve lukke staging's rigtige testdata.
--    ⚠️ FØR natjobbet kører i prod: dashboardets "Afsluttede"-filter skal
--    vise alt, der ikke er 'open' — i dag viser det kun completed/rejected.
create or replace function public.luk_inaktive(p_firm uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.leads
     set status = 'inactive'
   where status = 'open'
     and sidst_roert < now() - interval '3 months'
     and (p_firm is null or firm_id = p_firm);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.luk_inaktive(uuid) from public, anon, authenticated;
grant execute on function public.luk_inaktive(uuid) to service_role;
