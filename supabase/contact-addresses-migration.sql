alter table public.profiles add column if not exists address_type text;
alter table public.profiles add column if not exists address2_type text;
alter table public.profiles add column if not exists address2_street text;
alter table public.profiles add column if not exists address2_zip text;
alter table public.profiles add column if not exists address2_city text;
alter table public.profiles add column if not exists address3_type text;
alter table public.profiles add column if not exists address3_street text;
alter table public.profiles add column if not exists address3_zip text;
alter table public.profiles add column if not exists address3_city text;

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
  );
  return new;
end;
$$;
