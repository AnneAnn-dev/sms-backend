-- ─────────────────────────────────────────────────────────────────────────────
-- S35 (21/10-26): en indlogget bruger kunne flytte en af sine opgaver til et
-- andet firma — og skrive i alle kolonner paa leads uden om serveren.
--
-- MAALT 21/10 i begge miljoeer:
--   * UPDATE-politikkerne paa leads er permissive (én, der godkender, er nok).
--     leads_update_firma kraever, at det NYE firm_id er brugerens eget. Men
--     de gamle leads_update_eget_firma (og paa staging leads_update_own)
--     kraever kun, at call_id er brugerens eget opkald — de ser ikke paa
--     firm_id. Saa kunne firm_id saettes til et andet firmas id.
--   * authenticated havde UPDATE paa ALLE kolonner (information_schema.
--     column_privileges), ogsaa firm_id, id, call_id, kunde_id, telefon,
--     created_at.
--   * firm_id is null = 0 i begge miljoeer, saa de gamle call_id-politikker
--     er ikke laengere den eneste vej til nogen opgave (leads_update_firma
--     daekker alle siden 7/10).
--
-- RETTELSEN:
--   1. De gamle UPDATE-politikker paa call_id fjernes. leads_update_firma
--      (firm_id i mine_firmaer() baade foer og efter) er den eneste tilbage.
--   2. Bred UPDATE-ret fjernes og gives kun paa de kolonner, browseren
--      faktisk skriver. Maalt i static/dashboard.html (git grep 21/10):
--        seen_at                                   (openModal)
--        name, address, address_mail, notes,
--        is_urgent, task, titel                    (lukModal)
--        status                                    (afslut / genaabn)
--        startet_at, sidst_roert                   (opgave_handling(), som er
--                                                   SECURITY INVOKER og kaldes
--                                                   af authenticated: flyt til
--                                                   i gang)
--      tilbud/ skriver ikke direkte i leads — kun via serveren.
--      Alt andet (firm_id, id, call_id, kunde_id, telefon, created_at, ...)
--      skrives kun af serveren (service_role, som ikke er beroert).
--
-- Triggere (updated_at, leads_forloeb_noter) kraever ikke kolonneret: de
-- aendrer NEW, og Postgres tjekker kun kolonnerne i selve UPDATE-saetningen.
--
-- FAIL-CLOSED FOR NYE KOLONNER: en kolonne, der tilfoejes senere, kan IKKE
-- skrives fra browseren, foer den staar i en grant. Det er meningen. Faar
-- dashboardet "permission denied for table leads" (42501) efter en ny
-- kolonne, mangler den her.
--
-- De gamle SELECT-politikker paa call_id (leads_select_eget_firma,
-- leads_select_own) roeres ikke: de giver kun adgang til ens egne opkalds
-- opgaver. De fjernes senere, naar det er bevist, at intet bruger dem.
--
-- Kan rulles tilbage — koer:
--   grant update on table public.leads to authenticated;
--   create policy leads_update_eget_firma on public.leads for update to authenticated
--     using (call_id in (select calls.id from calls where calls.firm_id in
--            (select firm_users.firm_id from firm_users where firm_users.user_id = auth.uid())))
--     with check (call_id in (select calls.id from calls where calls.firm_id in
--            (select firm_users.firm_id from firm_users where firm_users.user_id = auth.uid())));
--   (leads_update_own fandtes kun paa staging: using/with check
--    call_id in (select user_call_ids()).)
-- Rollen paa politikkerne ovenfor er ikke maalt (pg_policies.roles) — tjek
-- den, foer en tilbagerulning koeres.
-- ─────────────────────────────────────────────────────────────────────────────

-- Stop, hvis forudsaetningen ikke laengere holder.
do $$
declare n integer;
begin
  select count(*) into n from public.leads where firm_id is null;
  if n > 0 then
    raise exception 'STOP: % opgave(r) uden firm_id. De har kun de gamle call_id-politikker. Giv dem firm_id foer migrationen koeres.', n;
  end if;
end $$;

drop policy if exists leads_update_eget_firma on public.leads;
drop policy if exists leads_update_own        on public.leads;

revoke update on table public.leads from authenticated;
revoke update on table public.leads from anon;

grant update (
  seen_at,
  name, address, address_mail, notes, is_urgent, task, titel,
  status,
  startet_at, sidst_roert
) on table public.leads to authenticated;

-- Kontrol: authenticated kan kun skrive de kolonner, der staar ovenfor.
-- (Var en kolonne ogsaa givet enkeltvis tidligere, ville table-revoke ikke
-- fjerne den — det fanges her i stedet for at antages.)
do $$
declare ekstra text;
begin
  select string_agg(column_name, ', ' order by column_name) into ekstra
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'leads'
     and grantee in ('authenticated', 'anon') and privilege_type = 'UPDATE'
     and not (grantee = 'authenticated' and column_name in (
       'seen_at','name','address','address_mail','notes','is_urgent','task','titel',
       'status','startet_at','sidst_roert'));
  if ekstra is not null then
    raise exception 'STOP: authenticated/anon kan stadig skrive: %', ekstra;
  end if;
end $$;

-- Kontrol: praecis én UPDATE-politik tilbage, og den kraever eget firma
-- baade foer og efter.
do $$
declare n integer;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'leads' and cmd = 'UPDATE';
  if n <> 1 then
    raise exception 'STOP: forventede 1 UPDATE-politik paa leads, fandt %', n;
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'leads'
                    and policyname = 'leads_update_firma' and cmd = 'UPDATE'
                    and with_check is not null) then
    raise exception 'STOP: leads_update_firma mangler eller har ingen with_check';
  end if;
end $$;
