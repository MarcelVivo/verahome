-- Zweiten Vera-Portal-Admin vorbereiten / reparieren.
--
-- Wichtig:
-- 1) Diesen SQL-Block zuerst ausfuehren. Er repariert den Auth-Trigger,
--    damit Supabase den Invite speichern kann.
-- 2) Danach in Supabase Authentication den Invite fuer
--    kontakt@marcelspahr.ch erstellen.
-- 3) Danach diesen SQL-Block nochmals ausfuehren. Dann wird Marcel zum
--    Admin hochgestuft.
--
-- Ziel:
-- - Marcel Spahr bekommt volle Portal-Adminrechte.
-- - welcome@verahome.ch bleibt Hauptadmin fuer interne Empfaenger
--   wie Nachrichten-/Rechnungs-Default und Kontakt-E-Mail-Fluesse.

alter type public.profile_category add value if not exists 'hauswart' after 'handwerker';

alter table public.profiles add column if not exists email2 text;
alter table public.profiles add column if not exists email3 text;
alter table public.profiles add column if not exists phone2 text;
alter table public.profiles add column if not exists phone3 text;
alter table public.profiles add column if not exists company_name text;
alter table public.profiles add column if not exists address_type text;
alter table public.profiles add column if not exists address2_type text;
alter table public.profiles add column if not exists address2_street text;
alter table public.profiles add column if not exists address2_zip text;
alter table public.profiles add column if not exists address2_city text;
alter table public.profiles add column if not exists address3_type text;
alter table public.profiles add column if not exists address3_street text;
alter table public.profiles add column if not exists address3_zip text;
alter table public.profiles add column if not exists address3_city text;

alter table public.profiles
  add column if not exists is_primary_admin boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_category text;
  safe_category public.profile_category;
begin
  requested_category := new.raw_user_meta_data->>'category';

  -- Auth-Invites aus dem Supabase Dashboard enthalten oft keine
  -- Metadaten. Dann wird zuerst ein normaler Mieter-Datensatz angelegt;
  -- der zweite Lauf dieses Scripts setzt Marcel danach auf Admin.
  if requested_category in ('mieter','eigentuemer','partner','handwerker','hauswart','firma','aemter') then
    safe_category := requested_category::public.profile_category;
  else
    safe_category := 'mieter';
  end if;

  insert into public.profiles (
    id, member_number, category, status, email, email2, email3, phone, phone2, phone3,
    first_name, last_name, company_name,
    address_type, address_street, address_zip, address_city,
    address2_type, address2_street, address2_zip, address2_city,
    address3_type, address3_street, address3_zip, address3_city
  ) values (
    new.id,
    public.generate_member_number(safe_category),
    safe_category,
    'active',
    new.email,
    new.raw_user_meta_data->>'email2',
    new.raw_user_meta_data->>'email3',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'phone2',
    new.raw_user_meta_data->>'phone3',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'address_type',
    new.raw_user_meta_data->>'address_street',
    new.raw_user_meta_data->>'address_zip',
    new.raw_user_meta_data->>'address_city',
    new.raw_user_meta_data->>'address2_type',
    new.raw_user_meta_data->>'address2_street',
    new.raw_user_meta_data->>'address2_zip',
    new.raw_user_meta_data->>'address2_city',
    new.raw_user_meta_data->>'address3_type',
    new.raw_user_meta_data->>'address3_street',
    new.raw_user_meta_data->>'address3_zip',
    new.raw_user_meta_data->>'address3_city'
  )
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

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
