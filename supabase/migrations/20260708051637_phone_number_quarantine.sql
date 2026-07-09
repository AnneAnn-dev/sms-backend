-- Karantaene ved deprovisionering: nummeret reserveres til evt. win-back
-- i stedet for straks-genbrug (nummeret staar paa haandvaerkerens bil!).
-- last_firm_id: hvem havde nummeret — win-back kan genforene med ét opslag.
-- Bevidst INGEN foreign key paa last_firm_id: den er et historisk spor og
-- maa ikke blokere sletning af (test)firmaer.
alter table phone_numbers
  add column if not exists quarantined_until timestamptz,
  add column if not exists last_firm_id uuid;

comment on column phone_numbers.quarantined_until is
  'Nummeret er reserveret (ikke i puljen) indtil dette tidspunkt — win-back-karantaene';