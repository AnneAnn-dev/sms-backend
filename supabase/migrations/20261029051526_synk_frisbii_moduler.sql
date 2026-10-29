-- 20261029051526_synk_frisbii_moduler.sql — Fase 3, T4 (28/10-26; nyt tidsstempel 29/10)
--
-- Én funktion, der lægger Frisbiis modulsæt ind i firma_moduler som FULDT
-- REPLACE (D25, model A). Kaldes kun af serveren (synk, T5) med det sæt,
-- frisbii-modulsaet.js har regnet ud. Funktionen kender ingen Frisbii-navne.
--
-- Reglerne (Ann 28/10, byggeplanen):
--  1. Fravalgte moduler SLETTES IKKE: deres til sættes til nu, så historikken
--     bevares og "afmeldt" kan læses (C17). En række, der aldrig blev aktiv
--     (fra i fremtiden), slettes dog - den kan ikke få til før fra.
--  2. Betalingen vinder: en manuel række for et modul i sættet overtages
--     (kilde -> 'frisbii', til fra Frisbii). Manuelle rækker for moduler
--     uden for sættet røres ikke.
--  3. Én ad gangen pr. firma: en transaktionslås på firmaet, så to webhooks
--     for samme firma ikke skriver oven i hinanden.
--
-- Synk styrer rækker med kilde frisbii, auto, migration, pakke og proeve.
-- 'auto' (triggeren firma_faar_telefon) og 'migration' (13/10) er
-- stedfortrædere fra før Fase 3; de overtages eller afsluttes ved første synk.
--
-- Et ukendt modul afvises af CHECK-reglen firma_moduler_modul, og så rulles
-- HELE kaldet tilbage - der skrives aldrig et halvt sæt.
--
-- LÅST: kun service_role må kalde den (revoke fra public, anon, authenticated).
-- SECURITY INVOKER: den har ingen rettigheder ud over kalderens.
--
-- Kan rulles tilbage: ja - `drop function public.synk_frisbii_moduler(uuid, text[], timestamptz);`
-- Migrationen ændrer ingen eksisterende rækker; kun et kald gør.

create or replace function public.synk_frisbii_moduler(p_firm uuid, p_moduler text[], p_til timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nu        timestamptz := now();
  v_synk      text[] := array['frisbii', 'auto', 'migration', 'pakke', 'proeve'];
  v_moduler   text[];
  v_oprettet  text[] := '{}';
  v_fornyet   text[] := '{}';
  v_overtaget text[] := '{}';
  v_afsluttet text[] := '{}';
  v_slettet   text[] := '{}';
  r           record;
  m           text;
begin
  if p_firm is null then raise exception 'synk_frisbii_moduler: firma mangler'; end if;
  if p_til is null then raise exception 'synk_frisbii_moduler: til mangler'; end if;
  if not exists (select 1 from public.firms where id = p_firm) then
    raise exception 'synk_frisbii_moduler: ukendt firma %', p_firm;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('synk_frisbii_moduler:' || p_firm::text, 0));

  v_moduler := array(select distinct x from unnest(coalesce(p_moduler, '{}'::text[])) as x order by x);

  -- 1) Synk-styrede rækker for moduler UDEN FOR sættet: afslut (regel 1).
  for r in
    select modul, fra, til from public.firma_moduler
    where firm_id = p_firm and kilde = any (v_synk) and not (modul = any (v_moduler))
    for update
  loop
    if r.fra >= v_nu then
      delete from public.firma_moduler where firm_id = p_firm and modul = r.modul;
      v_slettet := v_slettet || r.modul;
    elsif r.til is null or r.til > v_nu then
      update public.firma_moduler set til = v_nu where firm_id = p_firm and modul = r.modul;
      v_afsluttet := v_afsluttet || r.modul;
    end if;
  end loop;

  -- 2) Sættet: opret, forny eller overtag (regel 2).
  foreach m in array v_moduler loop
    select modul, fra, til, kilde into r from public.firma_moduler
      where firm_id = p_firm and modul = m for update;
    if not found then
      if p_til > v_nu then
        insert into public.firma_moduler (firm_id, modul, fra, til, kilde) values (p_firm, m, v_nu, p_til, 'frisbii');
        v_oprettet := v_oprettet || m;
      end if;
    elsif p_til > r.fra then
      if r.kilde = 'manuel' then
        v_overtaget := v_overtaget || m;
      elsif r.til is distinct from p_til or r.kilde is distinct from 'frisbii' then
        v_fornyet := v_fornyet || m;
      end if;
      update public.firma_moduler set til = p_til, kilde = 'frisbii' where firm_id = p_firm and modul = m;
    else
      delete from public.firma_moduler where firm_id = p_firm and modul = m;
      v_slettet := v_slettet || m;
    end if;
  end loop;

  return jsonb_build_object(
    'firma', p_firm, 'til', p_til, 'moduler', to_jsonb(v_moduler),
    'oprettet', to_jsonb(v_oprettet), 'fornyet', to_jsonb(v_fornyet),
    'overtaget', to_jsonb(v_overtaget), 'afsluttet', to_jsonb(v_afsluttet),
    'slettet', to_jsonb(v_slettet));
end;
$$;

revoke all on function public.synk_frisbii_moduler(uuid, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.synk_frisbii_moduler(uuid, text[], timestamptz) to service_role;

comment on function public.synk_frisbii_moduler(uuid, text[], timestamptz) is
  'Fase 3 T4: fuldt replace af et firmas Frisbii-styrede rækker i firma_moduler. Kun service_role. Se migrationen 20261029051526.';
