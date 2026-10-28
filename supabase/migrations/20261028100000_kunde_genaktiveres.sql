-- 20261028100000_kunde_genaktiveres.sql — en inaktiv kunde aktiveres igen, naar
-- hun ringer (D94 trin 3a, besluttet af Ann 27–28/10-26).
--
-- "Inaktiv" i appen ER `kunder.arkiveret_at` (findes siden 27/7; intet satte
-- den foer D94). Der kommer ingen ny kolonne — to kolonner for samme ting ville
-- vaere en ny dublet (CLAUDE.md, "Ingen ny dublet").
--
-- AENDRER D88 betingelse 6. Foer: et nummer hos en ARKIVERET kunde blev flyttet
-- til en NY kunde ("kun aktive kunder matches"). Nu: kunden aktiveres igen
-- (`arkiveret_at = null`) og beholder sit nummer, sine opgaver og sine
-- stamdata; svaret er `ny = false`. Navn og adresse roeres stadig IKKE.
-- Begrundelse (Ann 28/10): inaktiv betyder "rydde op" — ringer hun igen, er
-- hun aktuel. Ellers opstaar en dublet, hver gang en gammel kunde ringer.
--
-- Samme signatur og samme returtype, saa koerende kode (kundematch.js) ikke
-- maerker skiftet. Samme laas pr. (firma, nummer) som foer: to samtidige
-- opkald fra en inaktiv kundes nummer giver én aktiv kunde.
--
-- INGEN DATA AENDRES af migrationen (maalt 28/10: 0 arkiverede kunder i baade
-- staging og prod).
--
-- KAN RULLES TILBAGE: koer afsnit 5 i 20261018120000_kunde_telefoner.sql igen
-- (create or replace af den gamle definition). Kunder, der er aktiveret imens,
-- forbliver aktive — det er den eneste forskel, og den er ufarlig.

create or replace function public.find_eller_opret_kunde(
  p_firm    uuid,
  p_telefon text,
  p_navn    text,
  p_adresse text
)
returns table (kunde_id uuid, ny boolean)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_kunde  uuid;
  v_arkiv  timestamptz;
  v_navn   text := coalesce(nullif(btrim(p_navn), ''), 'Ukendt kunde');
  v_adr    text := nullif(btrim(p_adresse), '');
begin
  if p_firm is null then
    raise exception 'find_eller_opret_kunde: p_firm mangler' using errcode = '22004';
  end if;

  if p_telefon is null then
    insert into public.kunder (firm_id, navn, adresse)
    values (p_firm, v_navn, v_adr)
    returning id into v_kunde;
    return query select v_kunde, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_firm::text || '|' || p_telefon, 0));

  select kt.kunde_id, k.arkiveret_at
    into v_kunde, v_arkiv
    from public.kunde_telefoner kt
    join public.kunder k on k.id = kt.kunde_id
   where kt.firm_id = p_firm
     and kt.telefon = p_telefon;

  if v_kunde is not null then
    -- D94 trin 3a: en inaktiv (arkiveret) kunde aktiveres igen. Kun
    -- arkiveret_at roeres — aldrig navn eller adresse (D88 betingelse 6).
    if v_arkiv is not null then
      update public.kunder
         set arkiveret_at = null
       where id = v_kunde
         and firm_id = p_firm;
    end if;
    return query select v_kunde, false;
    return;
  end if;

  insert into public.kunder (firm_id, navn, adresse)
  values (p_firm, v_navn, v_adr)
  returning id into v_kunde;

  insert into public.kunde_telefoner (firm_id, kunde_id, telefon)
  values (p_firm, v_kunde, p_telefon);

  return query select v_kunde, true;
end;
$$;

revoke all on function public.find_eller_opret_kunde(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.find_eller_opret_kunde(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Kontroller efter koersel (SQL-editoren):
-- 1) Den nye definition er den, der koerer:
--      select position('D94 trin 3a' in prosrc) > 0 as ny_udgave
--        from pg_proc where proname = 'find_eller_opret_kunde';          -- true
-- 2) Kun serveren kan kalde den:
--      select has_function_privilege('authenticated',
--        'public.find_eller_opret_kunde(uuid,text,text,text)', 'execute'); -- false
-- Resten bevises af proev-kunde-telefoner.js --bekraeft (22/0).
