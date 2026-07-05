alter table public.units
  add column if not exists visibility public.property_visibility not null default 'private',
  add column if not exists offer_type text,
  add column if not exists living_area_m2 numeric(8,2),
  add column if not exists rooms numeric(4,1),
  add column if not exists floor text,
  add column if not exists rent_chf numeric(10,2),
  add column if not exists extra_costs_chf numeric(10,2),
  add column if not exists available_from text,
  add column if not exists teaser text,
  add column if not exists description text,
  add column if not exists features text;

create table if not exists public.unit_images (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references public.units(id) on delete cascade,
  file_path     text not null,
  is_cover      boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id)
);

create unique index if not exists unit_images_one_cover_per_unit
  on public.unit_images (unit_id)
  where (is_cover);

create or replace function public.set_unit_cover_image(p_unit_id uuid, p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt: nur Admin kann das Titelbild ändern.';
  end if;

  update public.unit_images set is_cover = false
    where unit_id = p_unit_id and is_cover = true;

  update public.unit_images set is_cover = true
    where id = p_image_id and unit_id = p_unit_id;
end;
$$;

alter table public.unit_images enable row level security;
alter table public.unit_images force row level security;

drop policy if exists properties_public_read on public.properties;
create policy properties_public_read on public.properties
  for select using (
    visibility = 'public'
    or exists (
      select 1 from public.units u
      where u.property_id = properties.id and u.visibility = 'public'
    )
  );

drop policy if exists units_public_read on public.units;
create policy units_public_read on public.units
  for select using (visibility = 'public');

drop policy if exists property_images_select on public.property_images;
create policy property_images_select on public.property_images
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.properties p
      where p.id = property_images.property_id and p.visibility = 'public'
    )
    or exists (
      select 1 from public.units u
      where u.property_id = property_images.property_id and u.visibility = 'public'
    )
  );

drop policy if exists unit_images_select on public.unit_images;
create policy unit_images_select on public.unit_images
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.units u
      where u.id = unit_images.unit_id and u.visibility = 'public'
    )
  );

drop policy if exists unit_images_admin_write on public.unit_images;
create policy unit_images_admin_write on public.unit_images
  for all using (public.is_admin()) with check (public.is_admin());
