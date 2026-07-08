-- Zweiten Vera-Portal-Admin vorbereiten.
--
-- Wichtig:
-- 1) Zuerst in Supabase Authentication einen Invite fuer
--    kontakt@marcelspahr.ch erstellen ODER die Edge Function
--    admin-create-user mit category "admin" verwenden.
-- 2) Danach diesen SQL-Block im Supabase SQL Editor ausfuehren.
--
-- Ziel:
-- - Marcel Spahr bekommt volle Portal-Adminrechte.
-- - welcome@verahome.ch bleibt Hauptadmin fuer interne Empfaenger
--   wie Nachrichten-/Rechnungs-Default und Kontakt-E-Mail-Fluesse.

alter table public.profiles
  add column if not exists is_primary_admin boolean not null default false;

create or replace function public.get_admin_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
  where category = 'admin' and status = 'active'
  order by (email = 'welcome@verahome.ch') desc, is_primary_admin desc, created_at asc
  limit 1;
$$;

update public.profiles
set is_primary_admin = (email = 'welcome@verahome.ch')
where category = 'admin';

update public.profiles
set
  first_name = 'Marcel',
  last_name = 'Spahr',
  category = 'admin',
  status = 'active',
  is_primary_admin = false,
  member_number = null
where lower(email) = 'kontakt@marcelspahr.ch';

select
  id,
  first_name,
  last_name,
  email,
  category,
  status,
  is_primary_admin
from public.profiles
where category = 'admin'
order by is_primary_admin desc, created_at asc;
