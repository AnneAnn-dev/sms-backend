-- 20261030120000_leads_gamle_select_vaek.sql — S35's rest (30/10-26).
--
-- Fjerner de to gamle SELECT-politikker paa `leads`, der gaar gennem
-- `call_id`: `leads_select_eget_firma` og `leads_select_own`. De er fra foer
-- 7/10, hvor `leads_select_firma` (firm_id) kom til, og blev staaende.
-- UPDATE-soesteren blev fjernet 21/10 (20261021090000_leads_skriveret).
--
-- MAALT 30/10 i begge miljoeer (Ann): de samme fire politikker paa leads
-- (to gamle SELECT paa call_id, leads_select_firma, leads_update_firma);
-- 0 opgaver uden firm_id og 0 opgaver, hvis firm_id afviger fra deres opkalds
-- (prod: 23 opgaver med opkald, staging: 0). De gamle politikker giver altsaa
-- ikke adgang til noget, leads_select_firma ikke allerede giver.
--
-- MIGRATIONEN STOPPER SELV (intet aendres), hvis
--   * `leads_select_firma` ikke findes — leads maa aldrig staa uden en
--     SELECT-politik, der giver brugeren sine egne opgaver
--   * en opgave mangler firm_id, eller dens firm_id afviger fra opkaldets —
--     saa ville en bruger miste adgang til en opgave, han kan se i dag
--
-- Funktionen user_call_ids() roeres IKKE (den kan bruges andre steder).
--
-- KAN RULLES TILBAGE: opret de to politikker igen med definitionerne
-- herunder (maalt med pg_policies 30/10):
--   create policy leads_select_eget_firma on public.leads for select to public
--     using (call_id in (select calls.id from calls where calls.firm_id in
--            (select firm_users.firm_id from firm_users where firm_users.user_id = auth.uid())));
--   create policy leads_select_own on public.leads for select to authenticated
--     using (call_id in (select user_call_ids()));

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'leads'
                    and policyname = 'leads_select_firma' and cmd = 'SELECT') then
    raise exception 'S35: leads_select_firma findes ikke — stopper, intet aendret';
  end if;
  if exists (select 1 from public.leads l join public.calls c on c.id = l.call_id
              where l.firm_id is null or l.firm_id is distinct from c.firm_id) then
    raise exception 'S35: en opgave mangler firm_id eller afviger fra sit opkald — stopper, intet aendret';
  end if;
  -- I SAMME blok som tjekkene, saa de to ting ikke kan skilles ad — heller
  -- ikke hvis migrationen en dag koeres uden en omsluttende transaktion.
  drop policy if exists leads_select_eget_firma on public.leads;
  drop policy if exists leads_select_own on public.leads;
end $$;

-- ---------------------------------------------------------------------
-- Kontrol efter koersel (SQL-editoren, kun laesning):
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'leads' order by cmd, policyname;
--   -- forventet: leads_select_firma (SELECT), leads_update_firma (UPDATE)
-- Bevis for adgang: rls-isolation-test.js --bekraeft (eget lead MED og UDEN
-- opkald synligt, intet fra det andet firma).
