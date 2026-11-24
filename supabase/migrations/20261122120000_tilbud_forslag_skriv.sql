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
-- KONTRAKT udkast 12 (Ann 24/11): forslaget skriver også tilbuddets indledning,
-- som bekræftes som titlerne, og formkontrollens markeringer gemmes på tilbuddet.
--
-- RETTELSE AF TRIN A (fundet 24/11 af den lokale prøve): tilbud_barn_laas()
-- afviste den UPDATE, som fremmednøglen tilbud_kilder_referat_fkey selv laver
-- ("on delete set null (referat_id)"), når et referat slettes. Derfor fejlede
-- slet_firma() — og dermed delete-firma.js — for ethvert firma med et tilbud,
-- der har referater som kilder, og et referat kunne ikke slettes, når det var
-- kilde til et godkendt tilbud. Ramte ikke drift: der findes ingen rækker i
-- tilbud_kilder endnu (forslaget er ikke i brug). Se afsnit 4 nedenfor.
--
-- RETTELSE AF TRIN A (fundet 24/11 af samme prøve): godkend_tilbud() byggede
-- mangellisten med `v_mangler || 'tekst'`, som Postgres læser som to lister og
-- fejler på ("malformed array literal", 22P02). Godkendelsen blev stadig afvist
-- (transaktionen faldt), men aldrig med listen, og ruten svarede 500. Ruten tjekker
-- mangler selv først, så det ramte kun, hvis koden og databasen var uenige — men
-- sikkerhedsnettet virkede ikke. Funktionen er genskabt nedenfor (afsnit 5) med
-- array_append, og med udkast 12's regel: en ubekræftet indledning fra modellen
-- stopper også godkendelsen. Resten af funktionen er uændret fra tilbud_fase5.
--
-- SEKS TING:
--   0. tilbud.indledning_kilde, tilbud.indledning_bekraeftet, tilbud.forslag_markeringer.
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
-- Rører kun data i ét tilfælde: en indledning, der allerede står i en kladde, er
-- skrevet af håndværkeren og mærkes `haandvaerker`, så et forslag aldrig
-- overskriver den. Tilføjer fire kolonner og tre funktioner.
-- KAN RULLES TILBAGE (se nederst).
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tilbud' and column_name = 'kaede_id') then
    raise exception 'VAGT: migrationen 20261122061048_tilbud_fase5 skal være kørt først';
  end if;
end $$;

-- 0. Indledningen og forslagets markeringer (kontrakt §1, §3) ------------------------
alter table public.tilbud add column if not exists indledning_kilde text;
alter table public.tilbud add column if not exists indledning_bekraeftet boolean not null default false;
alter table public.tilbud add column if not exists forslag_markeringer jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tilbud_indledning_kilde_gyldig') then
    alter table public.tilbud add constraint tilbud_indledning_kilde_gyldig
      check (indledning_kilde is null or indledning_kilde in ('model', 'haandvaerker'));
  end if;
end $$;
-- Kun kladder: et godkendt tilbud er låst (tilbud_laas), og en ny version mærker
-- den kopierede indledning selv (routes/tilbud/tilbud.js, ny-version).
update public.tilbud set indledning_kilde = 'haandvaerker'
 where status = 'kladde' and indledning is not null and indledning_kilde is null;

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
--   { titel, opgave_titel, indledning,
--     markeringer: { indledning_tal_ikke: [..], advarsel: null | {..}, fjernede_tags: n },
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
  v_indl boolean;
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
  v_indl    := coalesce(t.indledning_kilde, 'model') = 'model' and not t.indledning_bekraeftet;
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
    indledning            = case when v_indl then f->>'indledning' else indledning end,
    indledning_kilde      = case when v_indl then (case when f->>'indledning' is null then null else 'model' end) else indledning_kilde end,
    -- Markeringerne hører til dette forslag; tallene i indledningen kun, hvis den blev skrevet nu.
    forslag_markeringer   = jsonb_build_object(
                              'indledning_tal_ikke', case when v_indl then coalesce(f->'markeringer'->'indledning_tal_ikke', '[]'::jsonb) else '[]'::jsonb end,
                              'advarsel', coalesce(f->'markeringer'->'advarsel', 'null'::jsonb),
                              'fjernede_tags', coalesce((f->'markeringer'->>'fjernede_tags')::integer, 0)),
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

-- 4. Låsen på tilbuddets rækker (rettelse af trin A) -------------------------------
-- Uændret: efter godkendelsen kan linjer og kilder hverken oprettes, rettes eller
-- slettes. Nyt: (a) slettevejen må alt, også UPDATE (fremmednøglernes kaskader);
-- (b) er tilbuddet allerede væk i samme kaskade, er der intet at beskytte; (c) når
-- et referat slettes, må henvisningen i tilbud_kilder nulstilles — kun den, kopien
-- af teksten bliver stående (A5). Felterne læses gennem jsonb, så funktionen kan
-- bruges på begge tabeller.
create or replace function public.tilbud_barn_laas() returns trigger
language plpgsql set search_path = public as $$
declare
  v_status text;
  v_tilbud uuid := coalesce(new.tilbud_id, old.tilbud_id);
  v_ny jsonb;
  v_gl jsonb;
begin
  if public.ddk_markering('ddk.slettevej') then return coalesce(new, old); end if;
  select status into v_status from public.tilbud where id = v_tilbud;
  if v_status is null and tg_op <> 'INSERT' then return coalesce(new, old); end if;   -- forælderen er væk (kaskade)
  if tg_op = 'UPDATE' and tg_table_name = 'tilbud_kilder' then
    v_ny := to_jsonb(new); v_gl := to_jsonb(old);
    if v_gl->>'referat_id' is not null and v_ny->>'referat_id' is null
       and (v_ny - 'referat_id') = (v_gl - 'referat_id') then
      return new;   -- referatet er slettet; kopien bliver (A5)
    end if;
  end if;
  if v_status is distinct from 'kladde' then
    raise exception 'tilbud_laast: % kan kun ændres, mens tilbuddet er kladde', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.tilbud_id is distinct from old.tilbud_id then
    raise exception 'tilbud_laast: en række kan ikke flyttes til et andet tilbud' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- 5. godkend_tilbud() med en mangelliste, der virker (rettelse af trin A) -----------
create or replace function public.godkend_tilbud(p_tilbud uuid, p_firm uuid, p_bruger uuid default null)
returns table (tilbud_id uuid, tilbudsnummer integer)
language plpgsql set search_path = public as $$
#variable_conflict use_column
declare
  t public.tilbud%rowtype;
  v_lead public.leads%rowtype;
  v_mangler text[] := '{}';
  v_afv text;
  v_nummer integer;
  v_forrige public.tilbud%rowtype;
begin
  select * into t from public.tilbud where id = p_tilbud and firm_id = p_firm for update;
  if not found then raise exception 'tilbud_findes_ikke' using errcode = 'P0002'; end if;
  if t.status <> 'kladde' then raise exception 'tilbud_ikke_kladde' using errcode = '42501'; end if;
  select * into v_lead from public.leads where id = t.lead_id and firm_id = p_firm;

  -- Det, kan_godkendes også tjekker (kontrakt §1, §3) — databasen tjekker igen.
  if not exists (select 1 from public.tilbud_linjer where tilbud_id = p_tilbud) then v_mangler := array_append(v_mangler, 'ingen linjer'); end if;
  if exists (select 1 from public.tilbud_linjer where tilbud_id = p_tilbud and not bekraeftet) then v_mangler := array_append(v_mangler, 'ubekræftede linjer'); end if;
  if exists (select 1 from public.tilbud_linjer where tilbud_id = p_tilbud and enhed_ny) then v_mangler := array_append(v_mangler, 'ny enhed ikke oprettet'); end if;
  if coalesce(btrim(t.titel), '') = '' or not t.titel_bekraeftet then v_mangler := array_append(v_mangler, 'titel ikke bekræftet'); end if;
  if t.indledning is not null and t.indledning_kilde = 'model' and not t.indledning_bekraeftet then v_mangler := array_append(v_mangler, 'indledning ikke bekræftet'); end if;
  if t.opgavetype_navn is not null and (t.opgavetype_id is null or not t.opgavetype_bekraeftet) then v_mangler := array_append(v_mangler, 'opgavetype ikke bekræftet'); end if;
  if t.maengde is not null and not t.maengde_bekraeftet then v_mangler := array_append(v_mangler, 'mængde ikke bekræftet'); end if;
  if coalesce(btrim(t.firma_navn), '') = '' then v_mangler := array_append(v_mangler, 'firmanavn mangler'); end if;
  if coalesce(btrim(t.firma_cvr), '') = '' then v_mangler := array_append(v_mangler, 'CVR mangler'); end if;
  if t.gyldig_dage is null then v_mangler := array_append(v_mangler, 'gyldighed mangler'); end if;
  if coalesce(btrim(v_lead.name), '') = '' then v_mangler := array_append(v_mangler, 'kundens navn mangler'); end if;
  if coalesce(btrim(v_lead.address), '') = '' then v_mangler := array_append(v_mangler, 'arbejdssted mangler'); end if;
  if cardinality(v_mangler) > 0 then
    raise exception 'tilbud_mangler: %', array_to_string(v_mangler, '; ') using errcode = '23514';
  end if;
  select string_agg(afvigelse, '; ') into v_afv from public.tilbud_genregn(p_tilbud);
  if v_afv is not null then
    raise exception 'summer_passer_ikke: %', v_afv using errcode = '23514';
  end if;

  update public.firma_profil set tilbud_naeste_nummer = tilbud_naeste_nummer + 1
   where firm_id = p_firm returning tilbud_naeste_nummer - 1 into v_nummer;
  if v_nummer is null then raise exception 'firma_profil_mangler' using errcode = 'P0002'; end if;

  perform set_config('ddk.godkender', 'on', true);
  perform set_config('ddk.statusskift', 'on', true);

  -- Den version, den nye erstatter (#15, B16).
  select * into v_forrige from public.tilbud
   where kaede_id = t.kaede_id and version < t.version and status in ('godkendt', 'sendt', 'accepteret')
   order by version desc limit 1 for update;
  if found then
    update public.tilbud set status = 'erstattet', rev = rev + 1 where id = v_forrige.id;
    insert into public.tilbud_historik (tilbud_id, firm_id, haendelse, fra_status, til_status, kopi, created_by)
    values (v_forrige.id, p_firm, 'erstattet', v_forrige.status, 'erstattet',
            jsonb_build_object('erstattet_af', p_tilbud), p_bruger);
  end if;

  update public.tilbud
     set status = 'godkendt', godkendt_at = now(), tilbudsnummer = v_nummer, rev = rev + 1,
         gyldig_til = current_date + gyldig_dage,
         kunde_navn = v_lead.name, kunde_arbejdssted = v_lead.address,
         erstatter_tilbudsnummer = case when v_forrige.id is not null then v_forrige.tilbudsnummer end,
         erstatter_godkendt_at   = case when v_forrige.id is not null then v_forrige.godkendt_at end
   where id = p_tilbud;

  insert into public.tilbud_historik (tilbud_id, firm_id, haendelse, fra_status, til_status, kopi, created_by)
  select p_tilbud, p_firm, 'godkendt', 'kladde', 'godkendt',
         jsonb_build_object(
           'tilbud', to_jsonb(x),
           'linjer', coalesce((select jsonb_agg(to_jsonb(l) order by l.sortering, l.id) from public.tilbud_linjer l where l.tilbud_id = p_tilbud), '[]'::jsonb),
           'kilder', coalesce((select jsonb_agg(to_jsonb(k) order by k.nr) from public.tilbud_kilder k where k.tilbud_id = p_tilbud), '[]'::jsonb)),
         p_bruger
    from public.tilbud x where x.id = p_tilbud;

  return query select p_tilbud, v_nummer;
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
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tilbud'
         and column_name in ('forslag_startet_at', 'indledning_kilde', 'indledning_bekraeftet', 'forslag_markeringer')) <> 4 then
    raise exception 'KONTROL: en af tilbuddets nye kolonner mangler';
  end if;
  if exists (select 1 from public.tilbud where status = 'kladde' and indledning is not null and indledning_kilde is null) then
    raise exception 'KONTROL: en kladdes indledning er ikke mærket';
  end if;
  select string_agg(p.proname, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tilbud_forslag_start', 'tilbud_forslag_slip', 'tilbud_skriv_forslag')
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v is not null then raise exception 'KONTROL: authenticated kan kalde %', v; end if;
end $$;

-- ---------------------------------------------------------------------
-- Rollback (koden, der kalder funktionerne, rulles tilbage FØRST).
-- tilbud_barn_laas() rulles IKKE tilbage: den gamle udgave har fejlen ovenfor.
--   drop function if exists public.tilbud_skriv_forslag(uuid, uuid, jsonb);
--   drop function if exists public.tilbud_forslag_slip(uuid, uuid);
--   drop function if exists public.tilbud_forslag_start(uuid, uuid, integer);
--   alter table public.tilbud drop column if exists forslag_startet_at;
--   alter table public.tilbud drop constraint if exists tilbud_indledning_kilde_gyldig;
--   alter table public.tilbud drop column if exists forslag_markeringer;
--   alter table public.tilbud drop column if exists indledning_bekraeftet;
--   alter table public.tilbud drop column if exists indledning_kilde;
--   notify pgrst, 'reload schema';
-- Forslag, der allerede er skrevet, bliver stående: de er almindelige linjer,
-- kilder og rækker i tilbud_forslag.
-- ---------------------------------------------------------------------
