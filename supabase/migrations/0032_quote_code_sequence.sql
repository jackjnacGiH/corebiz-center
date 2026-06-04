-- Quote numbers become QT-<8-digit running number>, globally unique, generated
-- by a Postgres sequence (atomic — can never collide). Starts at 1000001
-- → first quote is QT-01000001.
create sequence if not exists public.quote_code_seq as bigint start with 1000001 increment by 1;

-- Default so a quote inserted without an explicit code gets the next number.
alter table public.quotes
  alter column code set default ('QT-' || lpad(nextval('public.quote_code_seq')::text, 8, '0'));

-- Hard guarantee of no duplicates (existing codes are already distinct).
create unique index if not exists quotes_code_unique_idx on public.quotes (code);

-- The inserting (authenticated/staff) role must be able to advance the sequence.
grant usage, select on sequence public.quote_code_seq to authenticated;
