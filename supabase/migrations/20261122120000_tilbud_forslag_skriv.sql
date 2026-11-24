-- =====================================================================
-- Fase 5 trin D — tilbudsforslaget skrives gennem én låsende funktion
-- Dit Digitale Kontor · Tilbud
--
-- Kontrakten (docs/fase5-tilbud-kontrakt.md, udkast 10) §4:
--   trin 1: kører der allerede et forslag på tilbuddet, svarer serveren 409.
--   trin 5: forslaget skrives gennem ÉN funktion, der låser tilbuddet og
--           tjekker status, `kilde` og `bekraeftet` igen på skrivetidspunktet,
--           og erstatter kun det, der både har kilde `model` og ikke er
--           bekræftet. Hans egne og hans rettede felter og linjer røres ikke.
--
-- Supabase-klienten har ingen transaktion over flere kald, så begge dele skal
-- ligge i databasen, som godkend_tilbud() gør.
--
-- TRE TING:
--   1. tilbud.forslag_startet_at — markeringen af et forslag, der kører. Den
--      har en frist (standard 180 sek.), så en afbrudt kørsel (genstart midt i
--      et kald) ikke låser tilbuddet for evigt.
--   2. tilbud_forslag_start() / tilbud_forslag_slip() — sæt og ryd markeringen.
--   3. tilbud_skriv_forslag() — skriver et færdigt, normaliseret forslag
--      (bygget af serveren i routes/tilbud/forslag.js, aldrig af klienten).
--
-- Kvoten: formålet `tilbud` står allerede i CHECK-reglen ai_forbrug_formaal_gyldig
-- (målt på staging 22/11: 0 rækker med formålet). Det flyttes fra puljen
-- `optagelse` til en ny pulje `tilbud` i kvote.js. Ingen ændring her.
--
-- Rører ingen data. Tilføjer én kolonne (nullable) og tre funktioner.
-- KAN RULLES TILBAGE (se nederst).
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tilbud' and column_name = 'kaede_id') then
    raise exception 'VAGT: migrationen 20261122061048_tilbud_fase5 skal være kørt først';
  end if;
end $$;

-- 1. Markeringen ------------------------------------------------------------------
alter table public.tilbud add column if not exists forslag_startet_at timestamptz;

-- 2. Sæt og ryd markeringen -------------------------------------------------------
-- Returnerer 'ok', 'koerer', 'ikke_kladde' eller 'findes_ikke'. Ruten oversætter.
create or replace function public.tilbud_forslag_start(p_tilbud uuid, p_firm uuid, p_frist_sek integer default 180)
returns text
language plpgsql set search_path = public as $$
declare
  t record;
begin
  select id, status, forslag_startet_at into t
    from public.tilbud where id = p_tilbud and firm_id = p_firm for update;
  if not found then return 'findes_ikke'; end if;
  if t.status <> 'kladde' then return 'ikke_kladde'; end if;
  if t.forslag_startet_at is not null
     and t.forslag_startet_at > now() - make_interval(secs => greatest(p_frist_sek, 1)) then
    return 'koerer';
  end if;
  update public.tilbud set forslag_startet_at = now() where id = p_tilbud;
  return 'ok';
end $$;

create or replace function public.tilbud_forslag_slip(p_tilbud uuid, p_firm uuid)
returns void
language plpgsql set search_path = public as $$
begin
  update public.tilbud set forslag_startet_at = null
   where id = p_tilbud and firm_id = p_firm and status = 'kladde' and forslag_startet_at is not null;
end $$;

-- 3. Skriv forslaget (kontrakt §4 trin 5 og 6) -------------------------------------
-- p_forslag (bygget af serveren):
--   { titel, opgave_titel,
--     opgavetype: null | { id, navn, enhed },
--     maengde:    null | { vaerdi, faktorer: [..] },
--     uenige:     [ { felt: 'maengde'|'opgavetype', vaerdier: [..] } ],
--     linjer:     [ { beskrivelse, antal, enhed_id, enhed_navn, enhed_ny, ordret, uenig } ],
--     kilder:     { beskrivelse_kopi, noter_kopi, referater: [ { referat_id, nr, dato, kilde, tekst_kopi } ] },
--     log:        { model, prompt_version, svar, retry, svartid_ms, tokens_ind, tokens_ud } }
-- Returnerer tilbuddets nye rev. Summerne regnes bagefter af serveren (en
-- ubekræftet modellinje kan have haft en pris, og den forsvinder nu).
create or replace function public.tilbud_skriv_forslag(p_tilbud uuid, p_firm uuid, p_forslag jsonb)
returns integer
language plpgsql set search_path = public as $$
#variable_conflict use_column
declare
  t public.tilbud%rowtype;
  f jsonb := coalesce(p_forslag, '{}'::jsonb);
  v_titel boolean;
  v_type boolean;
  v_maengde boolean;
  v_uenige jsonb;
  v_sort integer;
  v_har_type boolean;
  v_har_maengde boolean;
begin
  select * into t from public.tilbud where id = p_tilbud and firm_id = p_firm for update;
  if not found then raise exception 'tilbud_findes_ikke' using errcode = 'P0002'; end if;
  if t.status <> 'kladde' then raise exception 'tilbud_ikke_kladde' using errcode = '42501'; end if;

  -- Hvad må erstattes? Kun det, der er modellens og ikke bekræftet. Et tomt felt
  -- (kilde null) er ingens og må udfyldes.
  v_titel   := coalesce(t.titel_kilde, 'model') = 'model' and not t.titel_bekraeftet;
  v_type    := coalesce(t.opgavetype_kilde, 'model') = 'model' and not t.opgavetype_bekraeftet;
  v_maengde := coalesce(t.maengde_kilde, 'model') = 'model' and not t.maengde_bekraeftet;
  v_har_type    := jsonb_typeof(f->'opgavetype') = 'object';
  v_har_maengde := jsonb_typeof(f->'maengde') = 'object';

  -- Uenige: hans punkter bliver; modellens punkter for de felter, der erstattes, skiftes ud.
  select coalesce(jsonb_agg(u), '[]'::jsonb) into v_uenige
    from jsonb_array_elements(coalesce(t.uenige, '[]'::jsonb)) u
   where not ((u->>'felt' = 'maengde' and v_maengde) or (u->>'felt' = 'opgavetype' and v_type));
  select v_uenige || coalesce(jsonb_agg(u), '[]'::jsonb) into v_uenige
    from jsonb_array_elements(case when jsonb_typeof(f->'uenige') = 'array' then f->'uenige' else '[]'::jsonb end) u
   where (u->>'felt' = 'maengde' and v_maengde) or (u->>'felt' = 'opgavetype' and v_type);

  update public.tilbud set
    titel                 = case when v_titel then f->>'titel' else titel end,
    titel_kilde           = case when v_titel then (case when f->>'titel' is null then null else 'model' end) else titel_kilde end,
    -- Opgavens titel: et forslag, han har accepteret, står allerede på opgaven.
    opgave_titel_forslag  = case when opgave_titel_forslag_status = 'accepteret' then opgave_titel_forslag else f->>'opgave_titel' end,
    opgave_titel_forslag_status = case when opgave_titel_forslag_status = 'accepteret' then opgave_titel_forslag_status
                                       when f->>'opgave_titel' is null then null else 'afventer' end,
    opgavetype_id         = case when v_type then (case when v_har_type then nullif(f->'opgavetype'->>'id', '')::uuid end) else opgavetype_id end,
    opgavetype_navn       = case when v_type then (case when v_har_type then f->'opgavetype'->>'navn' end) else opgavetype_navn end,
    opgavetype_enhed      = case when v_type then (case when v_har_type then f->'opgavetype'->>'enhed' end) else opgavetype_enhed end,
    opgavetype_kilde      = case when v_type then (case when v_har_type then 'model' end) else opgavetype_kilde end,
    maengde               = case when v_maengde then (case when v_har_maengde then (f->'maengde'->>'vaerdi')::numeric end) else maengde end,
    maengde_faktorer      = case when v_maengde then (case when v_har_maengde then
                              (select array_agg(x::numeric order by n) from jsonb_array_elements_text(f->'maengde'->'faktorer') with ordinality as a(x, n)) end)
                            else maengde_faktorer end,
    maengde_kilde         = case when v_maengde then (case when v_har_maengde then 'model' end) else maengde_kilde end,
    uenige                = v_uenige,
    kilde_beskrivelse_kopi = f->'kilder'->>'beskrivelse_kopi',
    kilde_noter_kopi       = f->'kilder'->>'noter_kopi',
    kilder_lavet_at        = now(),
    forslag_startet_at     = null,
    rev                    = rev + 1
  where id = p_tilbud;

  -- Linjerne: kun modellens ubekræftede udskiftes. Hans egne og bekræftede bliver.
  delete from public.tilbud_linjer where tilbud_id = p_tilbud and kilde = 'model' and not bekraeftet;
  select coalesce(max(sortering), 0) into v_sort from public.tilbud_linjer where tilbud_id = p_tilbud;
  insert into public.tilbud_linjer
    (tilbud_id, firm_id, sortering, type, beskrivelse, antal, enhed_id, enhed_navn, enhed_ny, kilde, bekraeftet, ordret, uenig)
  select p_tilbud, p_firm, v_sort + x.n::integer, 'materiale', x.l->>'beskrivelse',
         (x.l->>'antal')::numeric, nullif(x.l->>'enhed_id', '')::uuid, x.l->>'enhed_navn',
         coalesce((x.l->>'enhed_ny')::boolean, false), 'model', false,
         coalesce((x.l->>'ordret')::boolean, true),
         case when jsonb_typeof(x.l->'uenig') = 'array' then x.l->'uenig' end
    from jsonb_array_elements(case when jsonb_typeof(f->'linjer') = 'array' then f->'linjer' else '[]'::jsonb end)
         with ordinality as x(l, n);

  -- Kilderne (#10, A5): referatets fremmednøgle (referat_id, lead_id) sikrer, at
  -- et referat kun kan være kilde til sin egen opgaves tilbud.
  delete from public.tilbud_kilder where tilbud_id = p_tilbud;
  insert into public.tilbud_kilder (tilbud_id, firm_id, lead_id, referat_id, nr, dato, kilde, tekst_kopi)
  select p_tilbud, p_firm, t.lead_id, (k->>'referat_id')::uuid, (k->>'nr')::integer,
         (k->>'dato')::date, k->>'kilde', k->>'tekst_kopi'
    from jsonb_array_elements(case when jsonb_typeof(f->'kilder'->'referater') = 'array' then f->'kilder'->'referater' else '[]'::jsonb end) k;

  -- Forslaget selv (A13).
  insert into public.tilbud_forslag (tilbud_id, firm_id, model, prompt_version, svar, retry, svartid_ms, tokens_ind, tokens_ud)
  values (p_tilbud, p_firm, f->'log'->>'model', f->'log'->>'prompt_version', f->'log'->'svar',
          coalesce((f->'log'->>'retry')::boolean, false), (f->'log'->>'svartid_ms')::integer,
          (f->'log'->>'tokens_ind')::integer, (f->'log'->>'tokens_ud')::integer);

  return t.rev + 1;
end $$;

-- Kun serveren (service role) må kalde funktionerne.
revoke all on function public.tilbud_forslag_start(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.tilbud_forslag_slip(uuid, uuid)          from public, anon, authenticated;
revoke all on function public.tilbud_skriv_forslag(uuid, uuid, jsonb)  from public, anon, authenticated;
grant execute on function public.tilbud_forslag_start(uuid, uuid, integer) to service_role;
grant execute on function public.tilbud_forslag_slip(uuid, uuid)          to service_role;
grant execute on function public.tilbud_skriv_forslag(uuid, uuid, jsonb)  to service_role;

notify pgrst, 'reload schema';

-- Kontrol ------------------------------------------------------------------------
do $$
declare v text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tilbud' and column_name = 'forslag_startet_at') then
    raise exception 'KONTROL: tilbud.forslag_startet_at mangler';
  end if;
  select string_agg(p.proname, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tilbud_forslag_start', 'tilbud_forslag_slip', 'tilbud_skriv_forslag')
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v is not null then raise exception 'KONTROL: authenticated kan kalde %', v; end if;
end $$;

-- ---------------------------------------------------------------------
-- Rollback (koden, der kalder funktionerne, rulles tilbage FØRST):
--   drop function if exists public.tilbud_skriv_forslag(uuid, uuid, jsonb);
--   drop function if exists public.tilbud_forslag_slip(uuid, uuid);
--   drop function if exists public.tilbud_forslag_start(uuid, uuid, integer);
--   alter table public.tilbud drop column if exists forslag_startet_at;
--   notify pgrst, 'reload schema';
-- Forslag, der allerede er skrevet, bliver stående: de er almindelige linjer,
-- kilder og rækker i tilbud_forslag.
-- ---------------------------------------------------------------------
