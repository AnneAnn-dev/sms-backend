-- Skelner "set" (claimet) fra "behandlet" — lukker dead-letter-hullet:
-- et event, der claimes men fejler i efterbehandlingen, kan nu genkendes
-- og genbehandles, naar Frisbii retry'er, i stedet for at blive tabt.
alter table frisbii_webhook_events
  add column if not exists processed_at timestamptz,
  add column if not exists error text;

comment on column frisbii_webhook_events.processed_at is
  'NULL = claimet men ikke faerdigbehandlet (kandidat til genbehandling ved retry)';