-- =====================================================================
-- VERA PORTAL — SCHEMA, AUTO-NUMBERING, RLS, STORAGE POLICIES
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > paste >
-- Run) on a fresh project. This is a single clean bootstrap script, not
-- a set of incremental migrations.
-- =====================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type public.profile_category as enum (
  'mieter', 'eigentuemer', 'partner', 'handwerker', 'admin', 'firma', 'aemter'
);

create type public.profile_status as enum (
  'pending',    -- self-registered, awaiting Julia's manual approval
  'active',     -- approved, full scoped access
  'suspended'   -- approved previously, access revoked
);

create type public.tenancy_status as enum ('upcoming', 'active', 'ended');

create type public.document_action as enum (
  'view_only',  -- just informational, nothing to do
  'sign',       -- e.g. move-out Übergabeprotokoll: confirm/sign
  'fill'        -- e.g. move-in Übergabeprotokoll: fill out
);

create type public.document_status as enum ('pending', 'completed');

-- ---------------------------------------------------------------------
-- PER-CATEGORY MEMBER-NUMBER SEQUENCES  (MI-00001 / EI-00001 / ...)
-- ---------------------------------------------------------------------
create sequence public.seq_member_mieter;
create sequence public.seq_member_eigentuemer;
create sequence public.seq_member_partner;
create sequence public.seq_member_handwerker;
create sequence public.seq_member_admin;
create sequence public.seq_member_firma;
create sequence public.seq_member_aemter;

create or replace function public.generate_member_number(cat public.profile_category)
returns text
language plpgsql
as $$
declare
  prefix text;
  n bigint;
begin
  case cat
    when 'mieter'      then prefix := 'MI'; n := nextval('public.seq_member_mieter');
    when 'eigentuemer' then prefix := 'EI'; n := nextval('public.seq_member_eigentuemer');
    when 'partner'     then prefix := 'PA'; n := nextval('public.seq_member_partner');
    when 'handwerker'  then prefix := 'HW'; n := nextval('public.seq_member_handwerker');
    when 'admin'       then prefix := 'AD'; n := nextval('public.seq_member_admin');
    when 'firma'       then prefix := 'FI'; n := nextval('public.seq_member_firma');
    when 'aemter'      then prefix := 'AM'; n := nextval('public.seq_member_aemter');
  end case;
  return prefix || '-' || lpad(n::text, 5, '0');
end;
$$;

-- ---------------------------------------------------------------------
-- PROFILES  (1:1 with auth.users) — the "Nutzerkartei"
-- ---------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  member_number    text unique,                       -- auto-assigned, e.g. 'MI-00001'
  category         public.profile_category not null,
  status           public.profile_status not null default 'pending',
  email            text not null,
  phone            text,
  first_name       text not null,
  last_name        text not null,
  address_type     text,
  address_street   text,
  address_zip      text,
  address_city     text,
  address2_type    text,
  address2_street  text,
  address2_zip     text,
  address2_city    text,
  address3_type    text,
  address3_street  text,
  address3_zip     text,
  address3_city    text,
  portal_invited_at timestamptz,
  portal_registered_at timestamptz,
  created_at       timestamptz not null default now(),
  approved_at      timestamptz,
  approved_by      uuid references public.profiles(id)
);

comment on table public.profiles is
  'Nutzerkartei: one row per registered user, auto-numbered per category, status controls portal access.';

-- ---------------------------------------------------------------------
-- PROPERTIES → UNITS → TENANCIES / OWNERSHIPS / JOB ASSIGNMENTS
-- ---------------------------------------------------------------------
create table public.properties (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,        -- e.g. "Hauptstrasse 39, Frick"
  street      text,
  zip         text,
  city        text,
  created_at  timestamptz not null default now()
);

create table public.units (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  label         text not null,      -- e.g. "3. OG rechts"
  created_at    timestamptz not null default now()
);

-- A tenancy is the scoping unit for a Mieter's document visibility.
create table public.tenancies (
  id                uuid primary key default gen_random_uuid(),
  unit_id           uuid not null references public.units(id) on delete cascade,
  tenant_profile_id uuid not null references public.profiles(id) on delete cascade,
  start_date        date not null,
  end_date          date,
  status            public.tenancy_status not null default 'active',
  created_at        timestamptz not null default now()
);

-- Eigentümer scoping.
create table public.ownerships (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid references public.properties(id) on delete cascade,
  unit_id           uuid references public.units(id) on delete cascade,
  owner_profile_id  uuid not null references public.profiles(id) on delete cascade,
  share_percent     numeric(5,2),
  start_date        date not null default current_date,
  end_date          date,
  created_at        timestamptz not null default now(),
  check (property_id is not null or unit_id is not null)
);

-- Partner/Handwerker scoping — kept as separate rows/categories on purpose
-- (Partner and Handwerker are distinct categories that may diverge in
-- access later); default behaviour today: both see only their own
-- assigned jobs.
create table public.job_assignments (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  property_id   uuid references public.properties(id),
  unit_id       uuid references public.units(id),
  title         text not null,
  description   text,
  status        text not null default 'open',   -- free-form for now, no UI yet
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- DOCUMENTS — each row individually scoped to ONE profile.
-- Move-out vs move-in Übergabeprotokoll = two separate rows
-- (action_type='sign' for the outgoing tenancy, 'fill' for the incoming
-- one), not conditional logic.
-- ---------------------------------------------------------------------
create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  category          text not null default 'sonstiges', -- e.g. 'uebergabeprotokoll','abrechnung','vertrag'
  -- Path INSIDE the 'documents' storage bucket only, e.g.
  -- '{profile_id}/{document_id}-{filename}' — do NOT include the bucket
  -- name here, storage.objects already has its own bucket_id column.
  file_path         text not null,
  owner_profile_id  uuid not null references public.profiles(id) on delete cascade,
  tenancy_id        uuid references public.tenancies(id),
  property_id       uuid references public.properties(id),
  unit_id           uuid references public.units(id),
  action_type       public.document_action not null default 'view_only',
  status            public.document_status not null default 'pending',
  completed_at      timestamptz,
  completed_by      uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id)
);

-- Reserved stub tables for the deferred CRM/messaging/calendar phase —
-- created now so the schema is forward-compatible, no UI built this round.
create table public.messages (
  id                    uuid primary key default gen_random_uuid(),
  sender_profile_id     uuid not null references public.profiles(id) on delete cascade,
  recipient_profile_id  uuid not null references public.profiles(id) on delete cascade,
  body                  text not null,
  created_at            timestamptz not null default now(),
  read_at               timestamptz
);

create table public.calendar_events (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- SIGNUP TRIGGER: auth.users -> profiles (auto member number).
-- New self-registered accounts go straight to 'active' as soon as the
-- user confirms their email (Supabase's own confirm-email step is the
-- only gate) — no separate manual approval step. 'pending'/'suspended'
-- remain available as statuses an admin can set later by hand (e.g. to
-- temporarily suspend an account), just no longer the default.
-- ---------------------------------------------------------------------
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

  -- SECURITY: never trust client input for the privileged 'admin' value.
  -- 'admin' can only ever be assigned by Julia editing the row manually
  -- in the Table Editor; self-registration can only ever produce one of
  -- the 6 non-admin categories, even if a crafted request claims otherwise.
  if requested_category in ('mieter','eigentuemer','partner','handwerker','firma','aemter') then
    safe_category := requested_category::public.profile_category;
  else
    safe_category := 'mieter';
  end if;

  insert into public.profiles (
    id, member_number, category, status, email, phone,
    first_name, last_name, address_street, address_zip, address_city
  ) values (
    new.id,
    public.generate_member_number(safe_category),
    safe_category,
    'active',
    new.email,
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'address_street',
    new.raw_user_meta_data->>'address_zip',
    new.raw_user_meta_data->>'address_city'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- HELPER FUNCTIONS (security definer — the standard Supabase/Postgres
-- pattern to avoid "infinite recursion detected in policy" when a
-- table's own RLS policy needs to check something about that same table)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and category = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

-- ---------------------------------------------------------------------
-- GUARD: prevent a non-admin from self-escalating via UPDATE on profiles
-- (category/status/member_number/approval fields are admin-only writes).
-- auth.uid() is null when there's no authenticated end-user session at
-- all — i.e. a direct SQL Editor / migration / service_role context,
-- not a client request. RLS already blocks anon/authenticated clients
-- from touching a row they don't own before this trigger even runs, so
-- this bypass only ever applies to trusted admin-console access.
-- ---------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.category is distinct from old.category
     or new.status is distinct from old.status
     or new.member_number is distinct from old.member_number
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.portal_invited_at is distinct from old.portal_invited_at then
    raise exception 'Nicht erlaubt: Kategorie/Status/Mitgliedsnummer können nur vom Admin geändert werden.';
  end if;
  return new;
end;
$$;

create trigger trg_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------
-- RPC: let a user mark their own sign/fill document done, instead of
-- granting a broad client-side UPDATE on documents (keeps title/
-- file_path/owner immutable from the client).
-- ---------------------------------------------------------------------
create or replace function public.complete_document(p_document_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.documents;
begin
  update public.documents
  set status = 'completed', completed_at = now(), completed_by = auth.uid()
  where id = p_document_id
    and owner_profile_id = auth.uid()
    and status = 'pending'
    and action_type in ('sign','fill')
  returning * into result;

  if result.id is null then
    raise exception 'Dokument nicht gefunden oder keine Berechtigung.';
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.properties       enable row level security;
alter table public.units            enable row level security;
alter table public.tenancies        enable row level security;
alter table public.ownerships       enable row level security;
alter table public.job_assignments  enable row level security;
alter table public.documents        enable row level security;
alter table public.messages         enable row level security;
alter table public.calendar_events  enable row level security;

alter table public.profiles         force row level security;
alter table public.properties       force row level security;
alter table public.units            force row level security;
alter table public.tenancies        force row level security;
alter table public.ownerships       force row level security;
alter table public.job_assignments  force row level security;
alter table public.documents        force row level security;
alter table public.messages         force row level security;
alter table public.calendar_events  force row level security;

-- profiles: everyone sees/edits only their own row (even while pending,
-- so the portal UI can show "pending" status); admin sees/edits all.
-- INSERT happens only via handle_new_user() (security definer trigger),
-- so no client-facing insert policy is granted.
create policy profiles_select_own_or_admin on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_own_or_admin on public.profiles
  for update using (id = auth.uid() or public.is_admin());

-- properties/units: visible to admin, or to a user with an active
-- tenancy/ownership referencing them. Requires is_approved() so a
-- pending user sees none of this yet.
create policy properties_scoped on public.properties
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.units u
      join public.tenancies t on t.unit_id = u.id
      where u.property_id = properties.id and t.tenant_profile_id = auth.uid() and public.is_approved()
    )
    or exists (
      select 1 from public.ownerships o
      where (o.property_id = properties.id or o.unit_id in (select id from public.units where property_id = properties.id))
        and o.owner_profile_id = auth.uid() and public.is_approved()
    )
  );

create policy units_scoped on public.units
  for select using (
    public.is_admin()
    or exists (select 1 from public.tenancies t where t.unit_id = units.id and t.tenant_profile_id = auth.uid() and public.is_approved())
    or exists (select 1 from public.ownerships o where o.unit_id = units.id and o.owner_profile_id = auth.uid() and public.is_approved())
  );

-- tenancies: a tenant sees only their own tenancy rows.
create policy tenancies_own_or_admin on public.tenancies
  for select using (
    public.is_admin() or (tenant_profile_id = auth.uid() and public.is_approved())
  );

-- ownerships: an owner sees only their own rows.
create policy ownerships_own_or_admin on public.ownerships
  for select using (
    public.is_admin() or (owner_profile_id = auth.uid() and public.is_approved())
  );

-- job_assignments: partner/handwerker see only their own assigned jobs.
create policy job_assignments_own_or_admin on public.job_assignments
  for select using (
    public.is_admin() or (profile_id = auth.uid() and public.is_approved())
  );

-- documents: strictly scoped to owner_profile_id; admin bypasses.
-- SELECT only from the client — status transitions go through the
-- complete_document() RPC above, not a raw UPDATE grant.
create policy documents_select_own_or_admin on public.documents
  for select using (
    public.is_admin() or (owner_profile_id = auth.uid() and public.is_approved())
  );
create policy documents_admin_write on public.documents
  for all using (public.is_admin()) with check (public.is_admin());

-- messages / calendar_events: reserved for later, same "own rows only"
-- default already in place.
create policy messages_own_or_admin on public.messages
  for select using (
    public.is_admin() or sender_profile_id = auth.uid() or recipient_profile_id = auth.uid()
  );
create policy calendar_events_own_or_admin on public.calendar_events
  for select using (public.is_admin() or profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- STORAGE: private "documents" bucket + storage.objects policies
-- (storage RLS is separate from table RLS — must be defined explicitly)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy storage_documents_select on storage.objects
  for select using (
    bucket_id = 'documents'
    and (
      public.is_admin()
      or exists (
        select 1 from public.documents d
        where d.file_path = storage.objects.name
          and d.owner_profile_id = auth.uid()
          and public.is_approved()
      )
    )
  );

create policy storage_documents_admin_write on storage.objects
  for insert with check (bucket_id = 'documents' and public.is_admin());
create policy storage_documents_admin_update on storage.objects
  for update using (bucket_id = 'documents' and public.is_admin());
create policy storage_documents_admin_delete on storage.objects
  for delete using (bucket_id = 'documents' and public.is_admin());

-- =====================================================================
-- VERA PORTAL DASHBOARD — ADDITIONS (Nutzer/Objekte/Mietverhältnisse
-- write access for admin, messages/calendar write access, fill-flow
-- storage for documents, get_admin_id() for the Nachrichten page).
--
-- Append this block via SQL Editor AFTER the original schema.sql has
-- already been run once. Safe to run once on top of the live project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ADMIN WRITE ACCESS: properties/units/tenancies/ownerships/job_assignments
-- currently have SELECT-only policies. Mirrors the existing
-- documents_admin_write "for all / is_admin()" pattern exactly. Multiple
-- permissive policies on the same command are OR'd by Postgres, so this
-- adds admin INSERT/UPDATE/DELETE without touching the existing scoped
-- SELECT policies at all.
-- ---------------------------------------------------------------------
create policy properties_admin_write on public.properties
  for all using (public.is_admin()) with check (public.is_admin());

create policy units_admin_write on public.units
  for all using (public.is_admin()) with check (public.is_admin());

create policy tenancies_admin_write on public.tenancies
  for all using (public.is_admin()) with check (public.is_admin());

create policy ownerships_admin_write on public.ownerships
  for all using (public.is_admin()) with check (public.is_admin());

create policy job_assignments_admin_write on public.job_assignments
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- MESSAGES: add the missing INSERT policy. A sender may only insert a
-- row as themselves, and only while approved (blocks pending/suspended
-- accounts from messaging even though they could theoretically read
-- their own thread once one exists).
-- ---------------------------------------------------------------------
create policy messages_insert_own on public.messages
  for insert with check (sender_profile_id = auth.uid() and public.is_approved());

-- ---------------------------------------------------------------------
-- CALENDAR_EVENTS: add the missing INSERT/UPDATE/DELETE policies.
-- Admin can manage anyone's events (e.g. booking an appointment with a
-- tenant); a regular user can only manage their own.
-- ---------------------------------------------------------------------
create policy calendar_events_insert on public.calendar_events
  for insert with check (
    public.is_admin() or (profile_id = auth.uid() and public.is_approved())
  );

create policy calendar_events_update on public.calendar_events
  for update using (
    public.is_admin() or (profile_id = auth.uid() and public.is_approved())
  ) with check (
    public.is_admin() or (profile_id = auth.uid() and public.is_approved())
  );

create policy calendar_events_delete on public.calendar_events
  for delete using (
    public.is_admin() or (profile_id = auth.uid() and public.is_approved())
  );

-- ---------------------------------------------------------------------
-- DOCUMENTS "fill" FLOW: a nullable free-text column the tenant fills in
-- (e.g. Zählerstände/Bemerkungen for a move-in Übergabeprotokoll) that
-- gets saved at the same moment the document is marked completed.
-- ---------------------------------------------------------------------
alter table public.documents add column if not exists fill_content text;

-- complete_document() gets a second, optional parameter. Function
-- identity in Postgres is name + parameter type LIST, so adding a
-- parameter is a different signature, not an in-place replace — the old
-- 1-arg version is dropped first so the client never ends up with two
-- ambiguous overloads of the same RPC name. Name is kept unchanged
-- (no client-side rename needed anywhere) — only the signature grows.
drop function if exists public.complete_document(uuid);

create or replace function public.complete_document(
  p_document_id uuid,
  p_fill_content text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.documents;
begin
  update public.documents
  set status = 'completed',
      completed_at = now(),
      completed_by = auth.uid(),
      fill_content = coalesce(p_fill_content, fill_content)
  where id = p_document_id
    and owner_profile_id = auth.uid()
    and status = 'pending'
    and action_type in ('sign','fill')
  returning * into result;

  if result.id is null then
    raise exception 'Dokument nicht gefunden oder keine Berechtigung.';
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- NACHRICHTEN: a non-admin can only ever SELECT their own profiles row,
-- so there is no client-safe way for them to discover Julia's profile
-- id to address a message to her. Smallest-privilege fix: one
-- security-definer RPC that returns just the single admin's uuid —
-- nothing else about that row is exposed, and nothing about anyone
-- else's profiles row is exposed either. Deliberately NOT loosening
-- profiles_select_own_or_admin.
-- ---------------------------------------------------------------------
create or replace function public.get_admin_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
  where category = 'admin' and status = 'active'
  order by (email = 'welcome@verahome.ch') desc, created_at asc
  limit 1;
$$;

-- Lets a recipient mark a message they received as read, without
-- granting a raw UPDATE on messages (which would also let them edit
-- body/sender/recipient). Same pattern as complete_document() above.
-- Powers the "ungelesene Nachrichten" quick-stat on the Übersicht page.
create or replace function public.mark_message_read(p_message_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.messages;
begin
  update public.messages
  set read_at = now()
  where id = p_message_id
    and recipient_profile_id = auth.uid()
    and read_at is null
  returning * into result;

  if result.id is null then
    raise exception 'Nachricht nicht gefunden oder keine Berechtigung.';
  end if;
  return result;
end;
$$;

-- =====================================================================
-- OBJEKTE — PHOTOS, PDF DOCUMENTS, VISIBILITY (public marketing site +
-- per-document sharing). Append via SQL Editor AFTER the schema so far
-- has already been run. Safe to run once on top of the live project.
-- =====================================================================

create type public.property_visibility as enum ('public', 'private');

alter table public.properties
  add column if not exists visibility public.property_visibility not null default 'private';

alter table public.properties
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

-- Multiple photos per property; exactly one may be flagged as the
-- cover/profile image (enforced below via a partial unique index, not
-- just UI discipline), sortable via sort_order.
create table public.property_images (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  -- path INSIDE the 'property-images' storage bucket only, e.g.
  -- '{property_id}/{image_id}-{filename}'.
  file_path     text not null,
  is_cover      boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id)
);

create unique index property_images_one_cover_per_property
  on public.property_images (property_id)
  where (is_cover);

create table public.unit_images (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references public.units(id) on delete cascade,
  file_path     text not null,
  is_cover      boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id)
);

create unique index unit_images_one_cover_per_unit
  on public.unit_images (unit_id)
  where (is_cover);

-- Pläne/Grundbucheintrag/etc. visibility here is INDEPENDENT of the
-- property's own visibility — a document on a private property can be
-- public, and vice versa. 'restricted' means only the profiles listed
-- in property_document_access, not an automatic tenant/owner shortcut.
create type public.property_document_visibility as enum ('public', 'restricted');

create table public.property_documents (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  title         text not null,
  category      text not null default 'sonstiges', -- 'plaene','grundbucheintrag','sonstiges'
  -- path INSIDE the 'property-documents' storage bucket only.
  file_path     text not null,
  visibility    public.property_document_visibility not null default 'restricted',
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id)
);

-- Many-to-many grant list, only meaningful when
-- property_documents.visibility = 'restricted'.
create table public.property_document_access (
  property_document_id  uuid not null references public.property_documents(id) on delete cascade,
  profile_id             uuid not null references public.profiles(id) on delete cascade,
  created_at             timestamptz not null default now(),
  primary key (property_document_id, profile_id)
);

-- Atomically move the "cover" flag from whichever image currently has
-- it (if any) to a new one, inside one transaction, so the partial
-- unique index above is never violated by two independent client-side
-- UPDATE calls racing each other.
create or replace function public.set_cover_image(p_property_id uuid, p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt: nur Admin kann das Titelbild ändern.';
  end if;

  update public.property_images set is_cover = false
    where property_id = p_property_id and is_cover = true;

  update public.property_images set is_cover = true
    where id = p_image_id and property_id = p_property_id;
end;
$$;

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

alter table public.property_images         enable row level security;
alter table public.unit_images             enable row level security;
alter table public.property_documents       enable row level security;
alter table public.property_document_access enable row level security;

alter table public.property_images         force row level security;
alter table public.unit_images             force row level security;
alter table public.property_documents       force row level security;
alter table public.property_document_access force row level security;

-- properties: ADD a public-read branch alongside the existing
-- properties_scoped policy (multiple permissive policies on the same
-- command are OR'd together, same as properties_admin_write was added
-- earlier without touching properties_scoped). This clause never
-- references auth.uid(), so an anonymous request (auth.uid() is null)
-- still matches "visibility = 'public'" unaffected by the other
-- OR-branches involving auth.uid().
create policy properties_public_read on public.properties
  for select using (
    visibility = 'public'
    or exists (
      select 1 from public.units u
      where u.property_id = properties.id and u.visibility = 'public'
    )
  );

create policy units_public_read on public.units
  for select using (visibility = 'public');

-- property_images: admin sees everything; anyone (including anonymous)
-- sees images belonging to a public property. Deliberately NOT
-- extended to "connected tenant/owner of a private property" this
-- round — no portal property-detail page exists yet for non-admins.
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

create policy property_images_admin_write on public.property_images
  for all using (public.is_admin()) with check (public.is_admin());

create policy unit_images_select on public.unit_images
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.units u
      where u.id = unit_images.unit_id and u.visibility = 'public'
    )
  );

create policy unit_images_admin_write on public.unit_images
  for all using (public.is_admin()) with check (public.is_admin());

-- property_documents: admin, publicly visible, or an explicit grant
-- row for the current user.
create policy property_documents_select on public.property_documents
  for select using (
    public.is_admin()
    or visibility = 'public'
    or exists (
      select 1 from public.property_document_access pda
      where pda.property_document_id = property_documents.id
        and pda.profile_id = auth.uid()
        and public.is_approved()
    )
  );

create policy property_documents_admin_write on public.property_documents
  for all using (public.is_admin()) with check (public.is_admin());

-- property_document_access: a user may see only their own grant rows
-- (needed so the exists() above resolves correctly for a non-admin,
-- same pattern properties_scoped already relies on for
-- tenancies/ownerships); admin manages the full grant list.
create policy property_document_access_own_or_admin on public.property_document_access
  for select using (
    public.is_admin() or profile_id = auth.uid()
  );

create policy property_document_access_admin_write on public.property_document_access
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- STORAGE: 'property-images' — PUBLIC bucket. Photos are low-sensitivity
-- marketing content, same trust level as every other static image on
-- the site, so reads go through getPublicUrl() directly — no SELECT
-- policy needed at all (Supabase serves public-bucket objects through
-- the /object/public/ endpoint without evaluating storage.objects RLS).
-- Writes are NOT free just because the bucket is public — INSERT/
-- UPDATE/DELETE still go through RLS, so admin-only write policies are
-- still required.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('property-images', 'property-images', true)
on conflict (id) do nothing;

create policy storage_property_images_admin_insert on storage.objects
  for insert with check (bucket_id = 'property-images' and public.is_admin());
create policy storage_property_images_admin_update on storage.objects
  for update using (bucket_id = 'property-images' and public.is_admin());
create policy storage_property_images_admin_delete on storage.objects
  for delete using (bucket_id = 'property-images' and public.is_admin());

-- ---------------------------------------------------------------------
-- STORAGE: 'property-documents' — PRIVATE bucket. Grundbucheintrag etc.
-- can be sensitive regardless of the row's own public/restricted flag,
-- so this is always served via createSignedUrl(), never a raw public
-- URL. Mirrors storage_documents_select, just checking
-- property_documents/property_document_access instead of documents.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('property-documents', 'property-documents', false)
on conflict (id) do nothing;

create policy storage_property_documents_select on storage.objects
  for select using (
    bucket_id = 'property-documents'
    and (
      public.is_admin()
      or exists (
        select 1 from public.property_documents pd
        where pd.file_path = storage.objects.name
          and pd.visibility = 'public'
      )
      or exists (
        select 1 from public.property_documents pd
        join public.property_document_access pda on pda.property_document_id = pd.id
        where pd.file_path = storage.objects.name
          and pda.profile_id = auth.uid()
          and public.is_approved()
      )
    )
  );

create policy storage_property_documents_admin_insert on storage.objects
  for insert with check (bucket_id = 'property-documents' and public.is_admin());
create policy storage_property_documents_admin_update on storage.objects
  for update using (bucket_id = 'property-documents' and public.is_admin());
create policy storage_property_documents_admin_delete on storage.objects
  for delete using (bucket_id = 'property-documents' and public.is_admin());

-- =====================================================================
-- MELDUNGEN — Schadensmeldung + Reklamation, unified as one table with a
-- report_type discriminator (both share the same shape: submitter,
-- optional property/unit scope, description, photos, status, admin
-- note, optional link into job_assignments). Append via SQL Editor
-- AFTER everything above has already run.
-- =====================================================================

create type public.issue_report_type as enum ('schaden', 'reklamation');
create type public.issue_report_status as enum ('offen', 'in_bearbeitung', 'erledigt', 'abgelehnt');

create table public.issue_reports (
  id                    uuid primary key default gen_random_uuid(),
  report_type           public.issue_report_type not null,
  reporter_profile_id    uuid not null references public.profiles(id) on delete cascade,
  property_id            uuid references public.properties(id),
  unit_id                uuid references public.units(id),
  title                  text not null,
  description            text not null,
  status                 public.issue_report_status not null default 'offen',
  admin_note             text,
  resolved_at            timestamptz,
  created_at             timestamptz not null default now()
);

create table public.issue_report_photos (
  id                uuid primary key default gen_random_uuid(),
  issue_report_id    uuid not null references public.issue_reports(id) on delete cascade,
  -- path INSIDE the 'issue-report-photos' storage bucket, e.g.
  -- '{issue_report_id}/{photo_id}-{filename}'.
  file_path         text not null,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

-- Light link from job_assignments back to the originating report, so
-- "turn a damage report into a Handwerker job" doesn't duplicate data.
alter table public.job_assignments
  add column if not exists source_issue_report_id uuid references public.issue_reports(id);

-- Admin-only, atomic "convert report -> job assignment": the report's
-- status flips to in_bearbeitung in the same transaction as the job
-- is created.
create or replace function public.convert_issue_report_to_job(
  p_issue_report_id uuid,
  p_assignee_profile_id uuid,
  p_title text,
  p_description text default null
)
returns public.job_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  report public.issue_reports;
  result public.job_assignments;
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt: nur Admin kann Meldungen in Aufträge umwandeln.';
  end if;

  select * into report from public.issue_reports where id = p_issue_report_id;
  if report.id is null then
    raise exception 'Meldung nicht gefunden.';
  end if;

  insert into public.job_assignments
    (profile_id, property_id, unit_id, title, description, status, source_issue_report_id)
  values
    (p_assignee_profile_id, report.property_id, report.unit_id, p_title, p_description, 'open', p_issue_report_id)
  returning * into result;

  update public.issue_reports set status = 'in_bearbeitung' where id = p_issue_report_id;
  return result;
end;
$$;

alter table public.issue_reports        enable row level security;
alter table public.issue_report_photos  enable row level security;
alter table public.issue_reports        force row level security;
alter table public.issue_report_photos  force row level security;

create policy issue_reports_select_own_or_admin on public.issue_reports
  for select using (public.is_admin() or (reporter_profile_id = auth.uid() and public.is_approved()));
create policy issue_reports_insert_own on public.issue_reports
  for insert with check (reporter_profile_id = auth.uid() and public.is_approved());
create policy issue_reports_admin_write on public.issue_reports
  for all using (public.is_admin()) with check (public.is_admin());

create policy issue_report_photos_select_own_or_admin on public.issue_report_photos
  for select using (
    public.is_admin()
    or exists (select 1 from public.issue_reports r where r.id = issue_report_photos.issue_report_id
      and r.reporter_profile_id = auth.uid() and public.is_approved())
  );
-- Insert/delete of photos only while the report is still 'offen' — once
-- admin starts working the ticket, the evidence shouldn't be alterable.
create policy issue_report_photos_insert_own on public.issue_report_photos
  for insert with check (
    exists (select 1 from public.issue_reports r where r.id = issue_report_photos.issue_report_id
      and r.reporter_profile_id = auth.uid() and r.status = 'offen' and public.is_approved())
  );
create policy issue_report_photos_delete_own on public.issue_report_photos
  for delete using (
    exists (select 1 from public.issue_reports r where r.id = issue_report_photos.issue_report_id
      and r.reporter_profile_id = auth.uid() and r.status = 'offen' and public.is_approved())
  );
create policy issue_report_photos_admin_write on public.issue_report_photos
  for all using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('issue-report-photos', 'issue-report-photos', false)
on conflict (id) do nothing;

create policy storage_issue_report_photos_select on storage.objects
  for select using (
    bucket_id = 'issue-report-photos' and (
      public.is_admin()
      or exists (select 1 from public.issue_reports r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and r.reporter_profile_id = auth.uid() and public.is_approved())
    )
  );
create policy storage_issue_report_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'issue-report-photos' and (
      public.is_admin()
      or exists (select 1 from public.issue_reports r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and r.reporter_profile_id = auth.uid() and r.status = 'offen' and public.is_approved())
    )
  );
create policy storage_issue_report_photos_delete on storage.objects
  for delete using (
    bucket_id = 'issue-report-photos' and (
      public.is_admin()
      or exists (select 1 from public.issue_reports r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and r.reporter_profile_id = auth.uid() and r.status = 'offen' and public.is_approved())
    )
  );

-- =====================================================================
-- RECHNUNGEN — full invoice generator with line items, sequential
-- human-readable numbering, draft/offen/bezahlt/storniert lifecycle.
-- Bidirectional: admin invoices anyone; Partner/Handwerker/Ämter invoice
-- the admin. Mieter/Eigentümer are recipients only, enforced at the DB
-- level (enforce_invoice_rules), not just hidden in the UI. Append
-- AFTER the Meldungen block above (references issue_reports).
-- =====================================================================

create type public.invoice_category as enum (
  'miete', 'nebenkosten', 'schaden_reparatur', 'handwerkerrechnung',
  'amtsrechnung', 'eigentuemerabrechnung', 'sonstiges'
);
create type public.invoice_status as enum ('entwurf', 'offen', 'bezahlt', 'storniert');

create table public.invoice_number_counters (
  year          int primary key,
  last_number   int not null default 0
);

-- Pure internal bookkeeping for generate_invoice_number()/the
-- assign_invoice_number() trigger (both run in a security-definer
-- context that bypasses RLS regardless) — no client, not even admin,
-- has any legitimate reason to read or write this table directly, so
-- RLS is enabled with zero policies: a hard default-deny for anyone
-- going through the anon/authenticated REST API.
alter table public.invoice_number_counters enable row level security;
alter table public.invoice_number_counters force row level security;

create or replace function public.generate_invoice_number()
returns text
language plpgsql
as $$
declare
  y int := extract(year from current_date)::int;
  n int;
begin
  insert into public.invoice_number_counters(year, last_number) values (y, 1)
  on conflict (year) do update set last_number = invoice_number_counters.last_number + 1
  returning last_number into n;
  return y::text || '-' || lpad(n::text, 5, '0');
end;
$$;

create table public.invoices (
  id                     uuid primary key default gen_random_uuid(),
  invoice_number          text unique,   -- assigned by trigger below, never client-supplied
  issuer_profile_id       uuid not null references public.profiles(id) on delete cascade,
  recipient_profile_id    uuid not null references public.profiles(id) on delete cascade,
  category                public.invoice_category not null default 'sonstiges',
  status                  public.invoice_status not null default 'entwurf',
  issue_date              date not null default current_date,
  due_date                date,
  currency                text not null default 'CHF',
  subtotal                numeric(12,2) not null default 0,  -- recomputed by trigger
  total                   numeric(12,2) not null default 0,  -- = subtotal today; separate for future tax/discount
  note                    text,
  property_id             uuid references public.properties(id),
  unit_id                 uuid references public.units(id),
  tenancy_id              uuid references public.tenancies(id),
  source_issue_report_id  uuid references public.issue_reports(id),
  created_at              timestamptz not null default now(),
  created_by              uuid references public.profiles(id),
  paid_at                 timestamptz,
  paid_by                 uuid references public.profiles(id)
);

create table public.invoice_line_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  description   text not null,
  quantity      numeric(10,2) not null default 1,
  unit_price    numeric(12,2) not null default 0,
  line_total    numeric(12,2) generated always as (quantity * unit_price) stored,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create or replace function public.assign_invoice_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.invoice_number is null then
    new.invoice_number := public.generate_invoice_number();
  end if;
  return new;
end;
$$;
create trigger trg_assign_invoice_number
  before insert on public.invoices
  for each row execute function public.assign_invoice_number();

-- Category+ownership enforcement: only admin/partner/handwerker/aemter
-- may ever be an issuer; a non-admin issuer may only bill the admin;
-- nobody may create an invoice under someone else's identity. This is
-- DB-enforced (not just hidden in the UI) since a crafted direct REST
-- call with a valid JWT would otherwise bypass a UI-only restriction.
create or replace function public.enforce_invoice_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  issuer_category public.profile_category;
begin
  select category into issuer_category from public.profiles where id = new.issuer_profile_id;
  if issuer_category is null then
    raise exception 'Rechnungssteller ungültig.';
  end if;
  if issuer_category not in ('admin','partner','handwerker','aemter') then
    raise exception 'Diese Nutzerkategorie darf keine Rechnungen stellen.';
  end if;
  if issuer_category <> 'admin' and new.recipient_profile_id <> public.get_admin_id() then
    raise exception 'Nicht-Admin-Rechnungssteller können nur an den Admin fakturieren.';
  end if;
  if auth.uid() is not null and not public.is_admin() and new.issuer_profile_id <> auth.uid() then
    raise exception 'Sie können nur Rechnungen unter Ihrer eigenen Identität erstellen.';
  end if;
  return new;
end;
$$;
create trigger trg_enforce_invoice_rules
  before insert or update on public.invoices
  for each row execute function public.enforce_invoice_rules();

-- subtotal/total recompute, DB-enforced (not client-trusted) — Postgres
-- generated columns can't sum child rows, so this is a trigger instead.
create or replace function public.recompute_invoice_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  new_subtotal numeric(12,2);
begin
  select coalesce(sum(line_total),0) into new_subtotal
  from public.invoice_line_items where invoice_id = target_invoice_id;
  update public.invoices set subtotal = new_subtotal, total = new_subtotal where id = target_invoice_id;
  return null;
end;
$$;
create trigger trg_recompute_invoice_totals
  after insert or update or delete on public.invoice_line_items
  for each row execute function public.recompute_invoice_totals();

-- Only issuer or admin can ever mark an invoice paid — the recipient
-- gets no UPDATE grant at all (see invoices_update policy below), so
-- "mark my own rent invoice paid" is impossible by construction.
create or replace function public.mark_invoice_paid(p_invoice_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public as $$
declare result public.invoices;
begin
  update public.invoices
  set status = 'bezahlt', paid_at = now(), paid_by = auth.uid()
  where id = p_invoice_id and status = 'offen'
    and (issuer_profile_id = auth.uid() or public.is_admin())
  returning * into result;
  if result.id is null then
    raise exception 'Rechnung nicht gefunden, bereits bezahlt oder keine Berechtigung.';
  end if;
  return result;
end;
$$;

alter table public.invoices           enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoices           force row level security;
alter table public.invoice_line_items force row level security;

create policy invoices_select on public.invoices
  for select using (
    public.is_admin() or issuer_profile_id = auth.uid() or recipient_profile_id = auth.uid()
  );
create policy invoices_insert on public.invoices
  for insert with check (public.is_admin() or (issuer_profile_id = auth.uid() and public.is_approved()));
create policy invoices_update on public.invoices
  for update using (public.is_admin() or (issuer_profile_id = auth.uid() and public.is_approved()))
  with check (public.is_admin() or (issuer_profile_id = auth.uid() and public.is_approved()));
create policy invoices_delete on public.invoices
  for delete using (public.is_admin() or (issuer_profile_id = auth.uid() and status = 'entwurf' and public.is_approved()));

create policy invoice_line_items_select on public.invoice_line_items
  for select using (
    exists (select 1 from public.invoices i where i.id = invoice_line_items.invoice_id
      and (public.is_admin() or i.issuer_profile_id = auth.uid() or i.recipient_profile_id = auth.uid()))
  );
create policy invoice_line_items_write on public.invoice_line_items
  for all using (
    exists (select 1 from public.invoices i where i.id = invoice_line_items.invoice_id
      and (public.is_admin() or (i.issuer_profile_id = auth.uid() and public.is_approved() and i.status in ('entwurf','offen'))))
  ) with check (
    exists (select 1 from public.invoices i where i.id = invoice_line_items.invoice_id
      and (public.is_admin() or (i.issuer_profile_id = auth.uid() and public.is_approved() and i.status in ('entwurf','offen'))))
  );

-- =====================================================================
-- NEBENKOSTENABRECHNUNG — admin enters total costs + per-tenancy share
-- (percent OR direct amount) + advance payments; publishing generates
-- one invoices row per tenant automatically (category='nebenkosten').
-- Append AFTER the Rechnungen block above (references invoices(id)).
-- =====================================================================

create type public.utility_statement_status as enum ('entwurf', 'veroeffentlicht');

create table public.utility_statements (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  period_start   date not null,
  period_end     date not null,
  total_costs    numeric(12,2) not null,
  status         public.utility_statement_status not null default 'entwurf',
  published_at   timestamptz,
  published_by   uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  check (period_end > period_start)
);

create table public.utility_statement_shares (
  id                        uuid primary key default gen_random_uuid(),
  utility_statement_id       uuid not null references public.utility_statements(id) on delete cascade,
  tenancy_id                 uuid not null references public.tenancies(id) on delete cascade,
  share_percent              numeric(5,2),   -- one of share_percent OR share_amount, whichever admin finds easier
  share_amount               numeric(12,2),
  advance_paid               numeric(12,2) not null default 0,   -- Akontozahlungen
  computed_share_amount      numeric(12,2),  -- resolved at publish time
  balance                    numeric(12,2),  -- computed_share_amount - advance_paid; +=Nachzahlung, -=Guthaben
  generated_invoice_id       uuid references public.invoices(id),
  created_at                 timestamptz not null default now(),
  unique (utility_statement_id, tenancy_id),
  check (share_percent is not null or share_amount is not null)
);

create or replace function public.publish_utility_statement(p_statement_id uuid)
returns public.utility_statements
language plpgsql security definer set search_path = public as $$
declare
  stmt public.utility_statements;
  share record;
  new_invoice_id uuid;
  computed numeric(12,2);
  bal numeric(12,2);
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt: nur Admin kann Abrechnungen veröffentlichen.';
  end if;

  select * into stmt from public.utility_statements where id = p_statement_id;
  if stmt.id is null then raise exception 'Abrechnung nicht gefunden.'; end if;
  if stmt.status <> 'entwurf' then raise exception 'Abrechnung wurde bereits veröffentlicht.'; end if;

  for share in
    select s.*, t.tenant_profile_id, t.unit_id
    from public.utility_statement_shares s
    join public.tenancies t on t.id = s.tenancy_id
    where s.utility_statement_id = p_statement_id
  loop
    computed := coalesce(share.share_amount, round(stmt.total_costs * share.share_percent / 100, 2));
    bal := computed - share.advance_paid;

    insert into public.invoices
      (issuer_profile_id, recipient_profile_id, category, status, property_id, unit_id, tenancy_id, note)
    values
      (auth.uid(), share.tenant_profile_id, 'nebenkosten', 'offen', stmt.property_id, share.unit_id, share.tenancy_id,
       'Nebenkostenabrechnung ' || to_char(stmt.period_start,'DD.MM.YYYY') || ' – ' || to_char(stmt.period_end,'DD.MM.YYYY'))
    returning id into new_invoice_id;

    insert into public.invoice_line_items (invoice_id, description, quantity, unit_price, sort_order) values
      (new_invoice_id, 'Ihr Anteil Nebenkosten', 1, computed, 0),
      (new_invoice_id, 'Bereits geleistete Akontozahlungen', 1, -share.advance_paid, 1);

    update public.utility_statement_shares
    set computed_share_amount = computed, balance = bal, generated_invoice_id = new_invoice_id
    where id = share.id;
  end loop;

  update public.utility_statements
  set status = 'veroeffentlicht', published_at = now(), published_by = auth.uid()
  where id = p_statement_id
  returning * into stmt;
  return stmt;
end;
$$;

alter table public.utility_statements       enable row level security;
alter table public.utility_statement_shares enable row level security;
alter table public.utility_statements       force row level security;
alter table public.utility_statement_shares force row level security;

-- Tenants only ever see the PUBLISHED, final numbers — never a draft.
create policy utility_statements_select on public.utility_statements
  for select using (
    public.is_admin()
    or (status = 'veroeffentlicht' and exists (
      select 1 from public.utility_statement_shares s
      join public.tenancies t on t.id = s.tenancy_id
      where s.utility_statement_id = utility_statements.id
        and t.tenant_profile_id = auth.uid() and public.is_approved()
    ))
  );
create policy utility_statements_admin_write on public.utility_statements
  for all using (public.is_admin()) with check (public.is_admin());

create policy utility_statement_shares_select on public.utility_statement_shares
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.tenancies t
      join public.utility_statements us on us.id = utility_statement_shares.utility_statement_id
      where t.id = utility_statement_shares.tenancy_id and t.tenant_profile_id = auth.uid()
        and us.status = 'veroeffentlicht' and public.is_approved()
    )
  );
create policy utility_statement_shares_admin_write on public.utility_statement_shares
  for all using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- WASCHPLAN — fixed recurring weekly schedule per property. Editable by
-- Admin, or by a profile Admin has delegated "waschplan" rights to for
-- that property (new lightweight property_permissions grant table).
-- All tenants of the property get read-only access regardless of who
-- can edit. Append AFTER the Nebenkosten block above.
-- =====================================================================

create table public.property_permissions (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  -- text + check instead of an enum: easy to extend with more permission
  -- kinds later without ALTER TYPE's transactional restrictions.
  permission    text not null default 'waschplan' check (permission in ('waschplan')),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  unique (property_id, profile_id, permission)
);

create or replace function public.has_property_permission(p_property_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.property_permissions
    where property_id = p_property_id and profile_id = auth.uid() and permission = p_permission
  );
$$;

create type public.weekday as enum ('mo', 'di', 'mi', 'do', 'fr', 'sa', 'so');

create table public.laundry_schedule_slots (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  weekday       public.weekday not null,
  start_time    time not null,
  end_time      time not null,
  unit_id       uuid references public.units(id),   -- optional structured reference
  label         text,                                -- free text, e.g. "Whg. Müller"
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  check (end_time > start_time)
);

alter table public.property_permissions     enable row level security;
alter table public.laundry_schedule_slots   enable row level security;
alter table public.property_permissions     force row level security;
alter table public.laundry_schedule_slots   force row level security;

-- Mirrors property_document_access_own_or_admin exactly.
create policy property_permissions_select on public.property_permissions
  for select using (public.is_admin() or profile_id = auth.uid());
create policy property_permissions_admin_write on public.property_permissions
  for all using (public.is_admin()) with check (public.is_admin());

-- SELECT mirrors properties_scoped's tenancy exists() subquery, plus the
-- coordinator's own permission grant.
create policy laundry_schedule_slots_select on public.laundry_schedule_slots
  for select using (
    public.is_admin()
    or public.has_property_permission(laundry_schedule_slots.property_id, 'waschplan')
    or exists (
      select 1 from public.units u
      join public.tenancies t on t.unit_id = u.id
      where u.property_id = laundry_schedule_slots.property_id
        and t.tenant_profile_id = auth.uid() and public.is_approved()
    )
  );
create policy laundry_schedule_slots_write on public.laundry_schedule_slots
  for all using (public.is_admin() or public.has_property_permission(laundry_schedule_slots.property_id, 'waschplan'))
  with check (public.is_admin() or public.has_property_permission(laundry_schedule_slots.property_id, 'waschplan'));

-- A Waschplan-coordinator might have no tenancy/ownership at all in the
-- property they were delegated (e.g. admin picks any trusted user) — so
-- properties_scoped alone wouldn't let them see the property's own row
-- (needed just to show its label). Added as a separate permissive policy,
-- same "add alongside, don't touch the existing one" pattern as
-- properties_admin_write/properties_public_read before it.
create policy properties_waschplan_coordinator_read on public.properties
  for select using (public.has_property_permission(properties.id, 'waschplan'));

-- =====================================================================
-- RECHNUNGEN — ZAHLUNGSINFORMATIONEN (Bankverbindung des Rechnungsstellers)
-- Append AFTER the RECHNUNGEN block (references invoices/profiles).
-- =====================================================================

alter table public.profiles
  add column if not exists iban text,
  add column if not exists bank_name text,
  add column if not exists bank_account_holder text;

-- profiles_update_own_or_admin + protect_profile_columns() already allow
-- a user to write these three new columns on their own row (they are not
-- in protect_profile_columns()'s guarded list) — no new write policy.
--
-- A new READ policy IS required. profiles_select_own_or_admin only
-- covers id = auth.uid() or is_admin() — is_admin() checks the VIEWER's
-- own category, not the target row's, so in the single most common case
-- (admin issues Miete, mieter is recipient) the mieter cannot read the
-- admin's profiles row at all today. That already silently degrades
-- invoice-detail.html's issuer name/address (falls back to the
-- hard-coded office name/address whenever the fetch is blocked) — a
-- fallback that's impossible for a real per-issuer IBAN. Fix: grant read
-- access between any two profiles that are counterparties on at least
-- one invoice, in either direction. Added as a separate permissive
-- policy alongside profiles_select_own_or_admin (same "OR it in, don't
-- touch the existing policy" convention used throughout this file).
create policy profiles_select_invoice_counterparty on public.profiles
  for select using (
    public.is_approved() and exists (
      select 1 from public.invoices i
      where (i.issuer_profile_id = profiles.id and i.recipient_profile_id = auth.uid())
         or (i.recipient_profile_id = profiles.id and i.issuer_profile_id = auth.uid())
    )
  );

-- =====================================================================
-- DAUERAUFTRAG — recurring invoice templates. NOT a fully unattended
-- cron job. Each active template appears in a "Fällige Daueraufträge"
-- reminder list once its due-date for the CURRENT calendar month has
-- arrived; the issuer/admin must explicitly click "Jetzt erstellen &
-- senden" to generate + send that occurrence, via
-- generate_recurring_invoice_occurrence() below. Append AFTER the
-- Bankangaben block above (references invoices/profiles).
-- =====================================================================

create table public.recurring_invoices (
  id                     uuid primary key default gen_random_uuid(),
  issuer_profile_id       uuid not null references public.profiles(id) on delete cascade,
  recipient_profile_id    uuid not null references public.profiles(id) on delete cascade,
  category                public.invoice_category not null default 'sonstiges',
  note                    text,
  -- text + check instead of an enum, same reasoning as
  -- property_permissions.permission: cheap to extend later without
  -- ALTER TYPE's transactional restrictions.
  due_rule                text not null default 'ende_monat'
                            check (due_rule in ('ende_monat', 'tag_des_monats')),
  -- only meaningful/non-null when due_rule = 'tag_des_monats'; capped at
  -- 28 so the rule is valid in every calendar month, including February.
  due_day                 int check (due_day between 1 and 28),
  active                  boolean not null default true,
  -- 'YYYY-MM' of the period this template was last generated for —
  -- prevents double-generation in the same month and makes "is this
  -- due" a plain string comparison.
  last_generated_period   text,
  created_at              timestamptz not null default now(),
  created_by              uuid references public.profiles(id),
  check (
    (due_rule = 'ende_monat' and due_day is null) or
    (due_rule = 'tag_des_monats' and due_day is not null)
  )
);

create table public.recurring_invoice_line_items (
  id                    uuid primary key default gen_random_uuid(),
  recurring_invoice_id  uuid not null references public.recurring_invoices(id) on delete cascade,
  description           text not null,
  quantity              numeric(10,2) not null default 1,
  unit_price            numeric(12,2) not null default 0,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now()
);

-- Same category/ownership enforcement as enforce_invoice_rules() on
-- invoices — RLS alone (issuer_profile_id = auth.uid()) would let ANY
-- approved user, including a mieter, insert a row naming themselves
-- issuer; this closes that the same way it's already closed for real
-- invoices.
create or replace function public.enforce_recurring_invoice_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  issuer_category public.profile_category;
begin
  select category into issuer_category from public.profiles where id = new.issuer_profile_id;
  if issuer_category is null then
    raise exception 'Rechnungssteller ungültig.';
  end if;
  if issuer_category not in ('admin','partner','handwerker','aemter') then
    raise exception 'Diese Nutzerkategorie darf keine Daueraufträge erstellen.';
  end if;
  if issuer_category <> 'admin' and new.recipient_profile_id <> public.get_admin_id() then
    raise exception 'Nicht-Admin-Rechnungssteller können nur an den Admin fakturieren.';
  end if;
  if auth.uid() is not null and not public.is_admin() and new.issuer_profile_id <> auth.uid() then
    raise exception 'Sie können nur Daueraufträge unter Ihrer eigenen Identität erstellen.';
  end if;
  return new;
end;
$$;
create trigger trg_enforce_recurring_invoice_rules
  before insert or update on public.recurring_invoices
  for each row execute function public.enforce_recurring_invoice_rules();

-- Atomically generates exactly one occurrence of a recurring template
-- for the CURRENT calendar month:
--   1. re-checks ownership + active + not-already-generated-this-period
--      + that the due date has actually arrived — ALL server-side,
--      never trusting the client's own "is this due" computation, which
--      is only a display filter, not access control;
--   2. inserts the real invoices row with status = 'offen' DIRECTLY —
--      landing on this confirm list and clicking the button IS the
--      "yes, send it now" step, per the confirmed simpler model;
--   3. copies the template's line items across (trg_recompute_invoice_totals
--      then fires as usual and fills subtotal/total);
--   4. stamps last_generated_period so this occurrence can't repeat.
-- The email send is a separate follow-up client call to the
-- send-invoice-email Edge Function, kept OUT of this RPC so a
-- slow/failed email can never roll back an otherwise-successful invoice.
create or replace function public.generate_recurring_invoice_occurrence(p_recurring_invoice_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  rec public.recurring_invoices;
  occurrence_date date;
  current_period text := to_char(current_date, 'YYYY-MM');
  new_invoice_id uuid;
  result public.invoices;
begin
  select * into rec from public.recurring_invoices
  where id = p_recurring_invoice_id
    and active = true
    and (issuer_profile_id = auth.uid() or public.is_admin());

  if rec.id is null then
    raise exception 'Dauerauftrag nicht gefunden, inaktiv oder keine Berechtigung.';
  end if;

  if rec.last_generated_period = current_period then
    raise exception 'Für diesen Zeitraum wurde bereits eine Rechnung erstellt.';
  end if;

  if rec.due_rule = 'ende_monat' then
    occurrence_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  else
    occurrence_date := make_date(extract(year from current_date)::int, extract(month from current_date)::int, rec.due_day);
  end if;

  if current_date < occurrence_date then
    raise exception 'Noch nicht fällig (fällig am %).', to_char(occurrence_date, 'DD.MM.YYYY');
  end if;

  insert into public.invoices
    (issuer_profile_id, recipient_profile_id, category, status, due_date, note, created_by)
  values
    (rec.issuer_profile_id, rec.recipient_profile_id, rec.category, 'offen', occurrence_date, rec.note, auth.uid())
  returning id into new_invoice_id;

  insert into public.invoice_line_items (invoice_id, description, quantity, unit_price, sort_order)
  select new_invoice_id, description, quantity, unit_price, sort_order
  from public.recurring_invoice_line_items
  where recurring_invoice_id = rec.id
  order by sort_order;

  update public.recurring_invoices set last_generated_period = current_period where id = rec.id;

  select * into result from public.invoices where id = new_invoice_id;
  return result;
end;
$$;

alter table public.recurring_invoices           enable row level security;
alter table public.recurring_invoice_line_items enable row level security;
alter table public.recurring_invoices           force row level security;
alter table public.recurring_invoice_line_items force row level security;

-- Mirrors invoices_select/_insert/_update/_delete, minus a recipient
-- branch: unlike real invoices, the recipient is never meant to see the
-- billing TEMPLATE, only the invoices it eventually produces.
create policy recurring_invoices_select on public.recurring_invoices
  for select using (public.is_admin() or (issuer_profile_id = auth.uid() and public.is_approved()));
create policy recurring_invoices_insert on public.recurring_invoices
  for insert with check (public.is_admin() or (issuer_profile_id = auth.uid() and public.is_approved()));
create policy recurring_invoices_update on public.recurring_invoices
  for update using (public.is_admin() or (issuer_profile_id = auth.uid() and public.is_approved()))
  with check (public.is_admin() or (issuer_profile_id = auth.uid() and public.is_approved()));
create policy recurring_invoices_delete on public.recurring_invoices
  for delete using (public.is_admin() or (issuer_profile_id = auth.uid() and public.is_approved()));

create policy recurring_invoice_line_items_select on public.recurring_invoice_line_items
  for select using (
    exists (select 1 from public.recurring_invoices ri where ri.id = recurring_invoice_line_items.recurring_invoice_id
      and (public.is_admin() or ri.issuer_profile_id = auth.uid()))
  );
create policy recurring_invoice_line_items_write on public.recurring_invoice_line_items
  for all using (
    exists (select 1 from public.recurring_invoices ri where ri.id = recurring_invoice_line_items.recurring_invoice_id
      and (public.is_admin() or (ri.issuer_profile_id = auth.uid() and public.is_approved())))
  ) with check (
    exists (select 1 from public.recurring_invoices ri where ri.id = recurring_invoice_line_items.recurring_invoice_id
      and (public.is_admin() or (ri.issuer_profile_id = auth.uid() and public.is_approved())))
  );

-- =====================================================================
-- SIDEBAR UNREAD BADGES — per-user "last seen per section" + one
-- fetch-all-counts RPC + one mark-seen RPC. messages is deliberately
-- NOT tracked via section_views: it already has real per-row read
-- tracking (messages.read_at via mark_message_read()), so its badge is
-- just "count of unread rows addressed to me".
-- =====================================================================

create table public.section_views (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  section        text not null check (section in ('invoices','meldungen','documents','calendar','waschplan')),
  last_seen_at   timestamptz not null default now(),
  primary key (profile_id, section)
);

alter table public.section_views enable row level security;
alter table public.section_views force row level security;

-- Defense-in-depth / Table Editor inspection only — all real reads and
-- writes go through the two security-definer RPCs below.
create policy section_views_select_own on public.section_views
  for select using (public.is_admin() or profile_id = auth.uid());

-- updated_at + backfill: NOTE backfill happens BEFORE default/not-null
-- are set, so existing rows get updated_at = created_at, never "now"
-- (a "now" backfill would make every pre-existing report/slot look
-- freshly changed to every viewer on day one).
alter table public.issue_reports add column if not exists updated_at timestamptz;
update public.issue_reports set updated_at = created_at where updated_at is null;
alter table public.issue_reports alter column updated_at set not null;
alter table public.issue_reports alter column updated_at set default now();

alter table public.laundry_schedule_slots add column if not exists updated_at timestamptz;
update public.laundry_schedule_slots set updated_at = created_at where updated_at is null;
alter table public.laundry_schedule_slots alter column updated_at set not null;
alter table public.laundry_schedule_slots alter column updated_at set default now();

create or replace function public.touch_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_issue_reports_touch_updated_at
  before update on public.issue_reports
  for each row execute function public.touch_updated_at();

create trigger trg_laundry_schedule_slots_touch_updated_at
  before update on public.laundry_schedule_slots
  for each row execute function public.touch_updated_at();

-- Six rows out, always all present, one round-trip. Every predicate is
-- scoped to auth.uid() and excludes the current user's OWN action from
-- counting as "new for them":
--  - invoices:  recipient's own unread invoices (issuer<>me is a cheap
--               extra guard).
--  - meldungen: admin sees reports filed by someone else since last
--               seen; a reporter sees their OWN report only once it has
--               genuinely changed after creation (updated_at >
--               created_at) — and since only admin can ever update an
--               issue_reports row (issue_reports_admin_write is the
--               only update policy), this change can only ever be
--               someone else's action, never the reporter's own.
--  - documents: owners have no insert/update policy on documents at all
--               (only documents_admin_write), so this can never be a
--               self-action either.
--  - calendar:  a user CAN self-insert their own events, and there's no
--               created_by column to exclude that — accepted as a minor
--               known edge case (a self-created event may show as
--               briefly "new" until the next markSectionSeen), not
--               worth a schema change for.
--  - waschplan: reuses the exact laundry_schedule_slots_select
--               relevance predicate, plus created_by is distinct from
--               me to exclude a coordinator's own new/edited slot from
--               their own badge.
create or replace function public.get_unread_counts()
returns table(section text, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  am_admin boolean;
  c_messages int;
  c_invoices int;
  c_meldungen int;
  c_documents int;
  c_calendar int;
  c_waschplan int;
begin
  if me is null then
    return;
  end if;

  am_admin := public.is_admin();

  select count(*) into c_messages
  from public.messages
  where recipient_profile_id = me and read_at is null;

  select count(*) into c_invoices
  from public.invoices
  where recipient_profile_id = me
    and issuer_profile_id <> me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'invoices'),
      '-infinity'::timestamptz
    );

  if am_admin then
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  end if;

  select count(*) into c_documents
  from public.documents
  where owner_profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    );

  select count(*) into c_calendar
  from public.calendar_events
  where profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'calendar'),
      '-infinity'::timestamptz
    );

  select count(*) into c_waschplan
  from public.laundry_schedule_slots l
  where l.updated_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'waschplan'),
      '-infinity'::timestamptz
    )
    and l.created_by is distinct from me
    and (
      am_admin
      or public.has_property_permission(l.property_id, 'waschplan')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = l.property_id
          and t.tenant_profile_id = me and public.is_approved()
      )
    );

  return query values
    ('messages',  c_messages),
    ('invoices',  c_invoices),
    ('meldungen', c_meldungen),
    ('documents', c_documents),
    ('calendar',  c_calendar),
    ('waschplan', c_waschplan);
end;
$$;

-- Upsert "I've seen this section as of now". 'messages' is rejected —
-- its badge clears itself via mark_message_read() instead.
create or replace function public.mark_section_seen(p_section text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if p_section not in ('invoices','meldungen','documents','calendar','waschplan') then
    raise exception 'Unbekannte oder nicht unterstützte Sektion: %', p_section;
  end if;

  insert into public.section_views (profile_id, section, last_seen_at)
  values (auth.uid(), p_section, now())
  on conflict (profile_id, section) do update set last_seen_at = now();
end;
$$;

-- =====================================================================
-- ZWEITER ADMIN — is_admin()/RLS sind bereits rollenbasiert (category =
-- 'admin'), ein zweites Admin-Profil bekommt also automatisch überall
-- dieselben Rechte. Die einzige Stelle, die bislang GENAU EIN Admin-Konto
-- voraussetzt, ist get_admin_id() — sie bestimmt, an wen Mieter/Partner/
-- Handwerker ihre Nachrichten und Nicht-Admin-Rechnungen automatisch
-- adressiert bekommen. is_primary_admin macht diese Auswahl explizit
-- und deterministisch (statt eines unspezifizierten "limit 1" über
-- mehrere Admin-Zeilen), damit weiterhin klar EIN Konto der Standard-
-- Ansprechpartner bleibt, auch wenn mehrere Admin-Konten existieren.
-- =====================================================================

alter table public.profiles
  add column if not exists is_primary_admin boolean not null default false;

update public.profiles
set is_primary_admin = (email = 'welcome@verahome.ch')
where category = 'admin';

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

-- =====================================================================
-- INTERNE ADMIN-TICKETS — einfaches Ticket-System NUR zwischen den
-- Admin-Konten (z.B. Julia meldet einen Änderungswunsch an Marcel).
-- Bewusst symmetrisch: beide Admins haben dieselben Rechte, also reicht
-- eine einzige is_admin()-Regel für alles — keine Ersteller/Admin-
-- Unterscheidung wie bei issue_reports nötig. updated_by (zusätzlich zu
-- created_by) verhindert, dass die eigene Status-Änderung im
-- Sidebar-Badge fälschlich als "neu für mich selbst" auftaucht.
-- =====================================================================

create type public.admin_ticket_status as enum ('offen', 'in_bearbeitung', 'erledigt');

create table public.admin_tickets (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references public.profiles(id) on delete cascade,
  updated_by       uuid references public.profiles(id),
  title            text not null,
  description      text not null,
  status           public.admin_ticket_status not null default 'offen',
  resolution_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.admin_ticket_photos (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.admin_tickets(id) on delete cascade,
  file_path   text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.admin_tickets       enable row level security;
alter table public.admin_tickets       force row level security;
alter table public.admin_ticket_photos enable row level security;
alter table public.admin_ticket_photos force row level security;

create policy admin_tickets_all on public.admin_tickets
  for all using (public.is_admin()) with check (public.is_admin());
create policy admin_ticket_photos_all on public.admin_ticket_photos
  for all using (public.is_admin()) with check (public.is_admin());

create trigger trg_admin_tickets_touch_updated_at
  before update on public.admin_tickets
  for each row execute function public.touch_updated_at();

insert into storage.buckets (id, name, public)
values ('admin-ticket-photos', 'admin-ticket-photos', false)
on conflict (id) do nothing;

create policy storage_admin_ticket_photos_select on storage.objects
  for select using (bucket_id = 'admin-ticket-photos' and public.is_admin());
create policy storage_admin_ticket_photos_insert on storage.objects
  for insert with check (bucket_id = 'admin-ticket-photos' and public.is_admin());
create policy storage_admin_ticket_photos_delete on storage.objects
  for delete using (bucket_id = 'admin-ticket-photos' and public.is_admin());

-- Badge-Integration: neue Sektion "tickets" in section_views zulassen.
alter table public.section_views drop constraint section_views_section_check;
alter table public.section_views add constraint section_views_section_check
  check (section in ('invoices','meldungen','documents','calendar','waschplan','tickets'));

create or replace function public.mark_section_seen(p_section text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if p_section not in ('invoices','meldungen','documents','calendar','waschplan','tickets') then
    raise exception 'Unbekannte oder nicht unterstützte Sektion: %', p_section;
  end if;

  insert into public.section_views (profile_id, section, last_seen_at)
  values (auth.uid(), p_section, now())
  on conflict (profile_id, section) do update set last_seen_at = now();
end;
$$;

create or replace function public.get_unread_counts()
returns table(section text, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  am_admin boolean;
  c_messages int;
  c_invoices int;
  c_meldungen int;
  c_documents int;
  c_calendar int;
  c_waschplan int;
  c_tickets int;
begin
  if me is null then
    return;
  end if;

  am_admin := public.is_admin();

  select count(*) into c_messages
  from public.messages
  where recipient_profile_id = me and read_at is null;

  select count(*) into c_invoices
  from public.invoices
  where recipient_profile_id = me
    and issuer_profile_id <> me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'invoices'),
      '-infinity'::timestamptz
    );

  if am_admin then
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  end if;

  select count(*) into c_documents
  from public.documents
  where owner_profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    );

  select count(*) into c_calendar
  from public.calendar_events
  where profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'calendar'),
      '-infinity'::timestamptz
    );

  select count(*) into c_waschplan
  from public.laundry_schedule_slots l
  where l.updated_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'waschplan'),
      '-infinity'::timestamptz
    )
    and l.created_by is distinct from me
    and (
      am_admin
      or public.has_property_permission(l.property_id, 'waschplan')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = l.property_id
          and t.tenant_profile_id = me and public.is_approved()
      )
    );

  if am_admin then
    select count(*) into c_tickets
    from public.admin_tickets
    where (
      (created_by <> me and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
      or
      (updated_by is distinct from me and updated_at > created_at and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
    );
  else
    c_tickets := 0;
  end if;

  return query values
    ('messages',  c_messages),
    ('invoices',  c_invoices),
    ('meldungen', c_meldungen),
    ('documents', c_documents),
    ('calendar',  c_calendar),
    ('waschplan', c_waschplan),
    ('tickets',   c_tickets);
end;
$$;

-- =====================================================================
-- RUNDSCHREIBEN — objektweite Ankündigungen, die automatisch alle
-- aktuellen Mieter UND Eigentümer eines Objekts erreichen. Anders als
-- bei documents/property_documents gibt es KEINE manuell gepflegte
-- Empfängerliste — die Sichtbarkeit wird live aus tenancies/ownerships
-- abgeleitet (gleiches Prinzip wie laundry_schedule_slots_select),
-- damit ein neuer Mieter automatisch Zugriff bekommt und ein
-- ausgezogener Mieter ihn automatisch wieder verliert.
-- =====================================================================

create table public.property_announcements (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  title        text not null,
  body         text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id)
);

alter table public.property_announcements enable row level security;
alter table public.property_announcements force row level security;

create policy property_announcements_select on public.property_announcements
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.units u
      join public.tenancies t on t.unit_id = u.id
      where u.property_id = property_announcements.property_id
        and t.tenant_profile_id = auth.uid() and t.status = 'active' and public.is_approved()
    )
    or exists (
      select 1 from public.ownerships o
      where (
        o.property_id = property_announcements.property_id
        or o.unit_id in (select id from public.units where property_id = property_announcements.property_id)
      )
      and o.owner_profile_id = auth.uid()
      and (o.end_date is null or o.end_date >= current_date)
      and public.is_approved()
    )
  );

create policy property_announcements_admin_write on public.property_announcements
  for all using (public.is_admin()) with check (public.is_admin());

-- Rundschreiben zählen als Teil des bestehenden "documents"-Badges mit
-- (kein eigener Nav-Punkt) — dieselbe mark_section_seen('documents'),
-- die documents.html beim Öffnen schon aufruft, löscht damit beide
-- Signale gemeinsam. Kein Ausschluss der eigenen Aktion nötig: nur
-- Admins dürfen Rundschreiben erstellen (RLS oben), Mieter/Eigentümer
-- können sich also nie selbst benachrichtigen.
create or replace function public.get_unread_counts()
returns table(section text, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  am_admin boolean;
  c_messages int;
  c_invoices int;
  c_meldungen int;
  c_documents int;
  c_announcements int;
  c_calendar int;
  c_waschplan int;
  c_tickets int;
begin
  if me is null then
    return;
  end if;

  am_admin := public.is_admin();

  select count(*) into c_messages
  from public.messages
  where recipient_profile_id = me and read_at is null;

  select count(*) into c_invoices
  from public.invoices
  where recipient_profile_id = me
    and issuer_profile_id <> me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'invoices'),
      '-infinity'::timestamptz
    );

  if am_admin then
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  end if;

  select count(*) into c_documents
  from public.documents
  where owner_profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    );

  select count(*) into c_announcements
  from public.property_announcements pa
  where created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    )
    and (
      exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = pa.property_id
          and t.tenant_profile_id = me and t.status = 'active' and public.is_approved()
      )
      or exists (
        select 1 from public.ownerships o
        where (o.property_id = pa.property_id or o.unit_id in (select id from public.units where property_id = pa.property_id))
          and o.owner_profile_id = me
          and (o.end_date is null or o.end_date >= current_date)
          and public.is_approved()
      )
    );

  c_documents := c_documents + c_announcements;

  select count(*) into c_calendar
  from public.calendar_events
  where profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'calendar'),
      '-infinity'::timestamptz
    );

  select count(*) into c_waschplan
  from public.laundry_schedule_slots l
  where l.updated_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'waschplan'),
      '-infinity'::timestamptz
    )
    and l.created_by is distinct from me
    and (
      am_admin
      or public.has_property_permission(l.property_id, 'waschplan')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = l.property_id
          and t.tenant_profile_id = me and public.is_approved()
      )
    );

  if am_admin then
    select count(*) into c_tickets
    from public.admin_tickets
    where (
      (created_by <> me and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
      or
      (updated_by is distinct from me and updated_at > created_at and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
    );
  else
    c_tickets := 0;
  end if;

  return query values
    ('messages',  c_messages),
    ('invoices',  c_invoices),
    ('meldungen', c_meldungen),
    ('documents', c_documents),
    ('calendar',  c_calendar),
    ('waschplan', c_waschplan),
    ('tickets',   c_tickets);
end;
$$;

-- =====================================================================
-- HAUSWART — BLOCK 1 (Enum-Wert allein, MUSS separat von Block 2
-- ausgeführt werden — ALTER TYPE ... ADD VALUE darf laut Postgres nicht
-- in derselben Transaktion verwendet werden, in der der neue Wert schon
-- referenziert wird).
-- =====================================================================

alter type public.profile_category add value if not exists 'hauswart' after 'handwerker';

-- =====================================================================
-- HAUSWART — BLOCK 2 (erst NACH Block 1 ausführen): Sequenz+Präfix,
-- Registrierungs-Freischaltung, property_permissions-Erweiterung,
-- additive Lücken-Fixes (Rundschreiben/Waschplan/Objekt-Dokumente auch
-- für reine Hauswart-Berechtigung sichtbar), neue Rapporte-Tabellen +
-- RLS + Storage, Badge-Integration.
-- =====================================================================

create sequence public.seq_member_hauswart;

create or replace function public.generate_member_number(cat public.profile_category)
returns text
language plpgsql
as $$
declare
  prefix text;
  n bigint;
begin
  case cat
    when 'mieter'      then prefix := 'MI'; n := nextval('public.seq_member_mieter');
    when 'eigentuemer' then prefix := 'EI'; n := nextval('public.seq_member_eigentuemer');
    when 'partner'     then prefix := 'PA'; n := nextval('public.seq_member_partner');
    when 'handwerker'  then prefix := 'HW'; n := nextval('public.seq_member_handwerker');
    when 'hauswart'    then prefix := 'HA'; n := nextval('public.seq_member_hauswart');
    when 'admin'       then prefix := 'AD'; n := nextval('public.seq_member_admin');
    when 'firma'       then prefix := 'FI'; n := nextval('public.seq_member_firma');
    when 'aemter'      then prefix := 'AM'; n := nextval('public.seq_member_aemter');
  end case;
  return prefix || '-' || lpad(n::text, 5, '0');
end;
$$;

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
    id, member_number, category, status, email, phone,
    first_name, last_name, address_street, address_zip, address_city
  ) values (
    new.id,
    public.generate_member_number(safe_category),
    safe_category,
    'active',
    new.email,
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'address_street',
    new.raw_user_meta_data->>'address_zip',
    new.raw_user_meta_data->>'address_city'
  );
  return new;
end;
$$;

alter table public.property_permissions drop constraint property_permissions_permission_check;
alter table public.property_permissions add constraint property_permissions_permission_check
  check (permission in ('waschplan', 'hauswart'));

-- Lücken-Fixes (additive Policies, nichts Bestehendes verändert):
create policy property_documents_select_hauswart on public.property_documents
  for select using (public.has_property_permission(property_documents.property_id, 'hauswart'));

create policy storage_property_documents_select_hauswart on storage.objects
  for select using (
    bucket_id = 'property-documents'
    and exists (
      select 1 from public.property_documents pd
      where pd.file_path = storage.objects.name
        and public.has_property_permission(pd.property_id, 'hauswart')
    )
  );

create policy property_announcements_select_hauswart on public.property_announcements
  for select using (public.has_property_permission(property_announcements.property_id, 'hauswart'));

create policy laundry_schedule_slots_select_hauswart on public.laundry_schedule_slots
  for select using (public.has_property_permission(laundry_schedule_slots.property_id, 'hauswart'));

create policy properties_hauswart_read on public.properties
  for select using (public.has_property_permission(properties.id, 'hauswart'));

-- =====================================================================
-- RAPPORTE — eigene Tabelle (nicht issue_reports wiederverwendet, da
-- die Melde-Berechtigung anders ist: Melder braucht zusätzlich eine
-- property_permissions-Zeile mit permission='hauswart' für genau das
-- gemeldete Objekt — direkt in der INSERT-Policy prüfbar).
-- =====================================================================

create type public.hauswart_report_status as enum ('offen', 'in_bearbeitung', 'erledigt', 'abgelehnt');

create table public.hauswart_reports (
  id                   uuid primary key default gen_random_uuid(),
  reporter_profile_id  uuid not null references public.profiles(id) on delete cascade,
  property_id          uuid not null references public.properties(id) on delete cascade,
  title                text not null,
  description          text not null,
  status               public.hauswart_report_status not null default 'offen',
  admin_note           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.hauswart_report_photos (
  id                   uuid primary key default gen_random_uuid(),
  hauswart_report_id   uuid not null references public.hauswart_reports(id) on delete cascade,
  file_path            text not null,
  sort_order           int not null default 0,
  created_at           timestamptz not null default now()
);

alter table public.hauswart_reports        enable row level security;
alter table public.hauswart_report_photos  enable row level security;
alter table public.hauswart_reports        force row level security;
alter table public.hauswart_report_photos  force row level security;

create policy hauswart_reports_select_own_or_admin on public.hauswart_reports
  for select using (public.is_admin() or (reporter_profile_id = auth.uid() and public.is_approved()));
create policy hauswart_reports_insert_own on public.hauswart_reports
  for insert with check (
    reporter_profile_id = auth.uid()
    and public.is_approved()
    and public.has_property_permission(property_id, 'hauswart')
  );
create policy hauswart_reports_admin_write on public.hauswart_reports
  for all using (public.is_admin()) with check (public.is_admin());

create policy hauswart_report_photos_select_own_or_admin on public.hauswart_report_photos
  for select using (
    public.is_admin()
    or exists (select 1 from public.hauswart_reports r where r.id = hauswart_report_photos.hauswart_report_id
      and r.reporter_profile_id = auth.uid() and public.is_approved())
  );
create policy hauswart_report_photos_insert_own on public.hauswart_report_photos
  for insert with check (
    exists (select 1 from public.hauswart_reports r where r.id = hauswart_report_photos.hauswart_report_id
      and r.reporter_profile_id = auth.uid() and r.status = 'offen' and public.is_approved())
  );
create policy hauswart_report_photos_delete_own on public.hauswart_report_photos
  for delete using (
    exists (select 1 from public.hauswart_reports r where r.id = hauswart_report_photos.hauswart_report_id
      and r.reporter_profile_id = auth.uid() and r.status = 'offen' and public.is_approved())
  );
create policy hauswart_report_photos_admin_write on public.hauswart_report_photos
  for all using (public.is_admin()) with check (public.is_admin());

create trigger trg_hauswart_reports_touch_updated_at
  before update on public.hauswart_reports
  for each row execute function public.touch_updated_at();

insert into storage.buckets (id, name, public)
values ('hauswart-report-photos', 'hauswart-report-photos', false)
on conflict (id) do nothing;

create policy storage_hauswart_report_photos_select on storage.objects
  for select using (
    bucket_id = 'hauswart-report-photos' and (
      public.is_admin()
      or exists (select 1 from public.hauswart_reports r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and r.reporter_profile_id = auth.uid() and public.is_approved())
    )
  );
create policy storage_hauswart_report_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'hauswart-report-photos' and (
      public.is_admin()
      or exists (select 1 from public.hauswart_reports r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and r.reporter_profile_id = auth.uid() and r.status = 'offen' and public.is_approved())
    )
  );
create policy storage_hauswart_report_photos_delete on storage.objects
  for delete using (
    bucket_id = 'hauswart-report-photos' and (
      public.is_admin()
      or exists (select 1 from public.hauswart_reports r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and r.reporter_profile_id = auth.uid() and r.status = 'offen' and public.is_approved())
    )
  );

-- Badge-Integration: neue Sektion "rapporte", exakt nach dem
-- "tickets"-Muster.
alter table public.section_views drop constraint section_views_section_check;
alter table public.section_views add constraint section_views_section_check
  check (section in ('invoices','meldungen','documents','calendar','waschplan','tickets','rapporte'));

create or replace function public.mark_section_seen(p_section text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if p_section not in ('invoices','meldungen','documents','calendar','waschplan','tickets','rapporte') then
    raise exception 'Unbekannte oder nicht unterstützte Sektion: %', p_section;
  end if;

  insert into public.section_views (profile_id, section, last_seen_at)
  values (auth.uid(), p_section, now())
  on conflict (profile_id, section) do update set last_seen_at = now();
end;
$$;

create or replace function public.get_unread_counts()
returns table(section text, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  am_admin boolean;
  c_messages int;
  c_invoices int;
  c_meldungen int;
  c_documents int;
  c_announcements int;
  c_calendar int;
  c_waschplan int;
  c_tickets int;
  c_rapporte int;
begin
  if me is null then
    return;
  end if;

  am_admin := public.is_admin();

  select count(*) into c_messages
  from public.messages
  where recipient_profile_id = me and read_at is null;

  select count(*) into c_invoices
  from public.invoices
  where recipient_profile_id = me
    and issuer_profile_id <> me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'invoices'),
      '-infinity'::timestamptz
    );

  if am_admin then
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  end if;

  select count(*) into c_documents
  from public.documents
  where owner_profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    );

  select count(*) into c_announcements
  from public.property_announcements pa
  where created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    )
    and (
      exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = pa.property_id
          and t.tenant_profile_id = me and t.status = 'active' and public.is_approved()
      )
      or exists (
        select 1 from public.ownerships o
        where (o.property_id = pa.property_id or o.unit_id in (select id from public.units where property_id = pa.property_id))
          and o.owner_profile_id = me
          and (o.end_date is null or o.end_date >= current_date)
          and public.is_approved()
      )
      or public.has_property_permission(pa.property_id, 'hauswart')
    );

  c_documents := c_documents + c_announcements;

  select count(*) into c_calendar
  from public.calendar_events
  where profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'calendar'),
      '-infinity'::timestamptz
    );

  select count(*) into c_waschplan
  from public.laundry_schedule_slots l
  where l.updated_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'waschplan'),
      '-infinity'::timestamptz
    )
    and l.created_by is distinct from me
    and (
      am_admin
      or public.has_property_permission(l.property_id, 'waschplan')
      or public.has_property_permission(l.property_id, 'hauswart')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = l.property_id
          and t.tenant_profile_id = me and public.is_approved()
      )
    );

  if am_admin then
    select count(*) into c_tickets
    from public.admin_tickets
    where (
      (created_by <> me and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
      or
      (updated_by is distinct from me and updated_at > created_at and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
    );
  else
    c_tickets := 0;
  end if;

  if am_admin then
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  end if;

  return query values
    ('messages',  c_messages),
    ('invoices',  c_invoices),
    ('meldungen', c_meldungen),
    ('documents', c_documents),
    ('calendar',  c_calendar),
    ('waschplan', c_waschplan),
    ('tickets',   c_tickets),
    ('rapporte',  c_rapporte);
end;
$$;

-- =====================================================================
-- TERMINBUCHUNG (ersetzt Calendly) — erste Funktion im Projekt, bei der
-- ein NICHT eingeloggter Website-Besucher tatsächlich in die Datenbank
-- schreibt. Verfügbarkeit + gesperrte Tage sind öffentlich lesbar
-- (jeder Besucher braucht sie, um freie Zeiten zu berechnen); die
-- eigentlichen Buchungen (mit Name/E-Mail/Telefon) sind für niemanden
-- ausser Admin lesbar — anonyme Besucher bekommen nur reine Zeitstempel
-- über get_available_slots() zurück, nie Personendaten. Die Buchung
-- selbst läuft ausschliesslich über create_booking() (security
-- definer), die Verfügbarkeit/gesperrte Tage/Überschneidungen
-- serverseitig neu prüft — nie dem Client vertrauen, gleiche Konvention
-- wie überall sonst in diesem Projekt.
-- =====================================================================

create table public.booking_availability (
  id          uuid primary key default gen_random_uuid(),
  weekday     public.weekday not null,
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  check (end_time > start_time)
);
alter table public.booking_availability enable row level security;
alter table public.booking_availability force row level security;
create policy booking_availability_select_public on public.booking_availability
  for select using (true);
create policy booking_availability_admin_write on public.booking_availability
  for all using (public.is_admin()) with check (public.is_admin());

create table public.booking_blocked_dates (
  id           uuid primary key default gen_random_uuid(),
  blocked_date date not null unique,
  reason       text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id)
);
alter table public.booking_blocked_dates enable row level security;
alter table public.booking_blocked_dates force row level security;
create policy booking_blocked_dates_select_public on public.booking_blocked_dates
  for select using (true);
create policy booking_blocked_dates_admin_write on public.booking_blocked_dates
  for all using (public.is_admin()) with check (public.is_admin());

create type public.booking_status as enum ('bestaetigt', 'storniert');

create table public.bookings (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  phone       text,
  message     text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      public.booking_status not null default 'bestaetigt',
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.bookings enable row level security;
alter table public.bookings force row level security;
create policy bookings_admin_all on public.bookings
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.get_available_slots(p_date date)
returns setof timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  wd public.weekday;
  win record;
  slot_start timestamptz;
  slot_end timestamptz;
begin
  if p_date < current_date then
    return;
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = p_date) then
    return;
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from p_date)::int + 1];

  for win in
    select start_time, end_time from public.booking_availability where weekday = wd
  loop
    slot_start := p_date + win.start_time;
    while slot_start + duration <= p_date + win.end_time loop
      slot_end := slot_start + duration;
      if slot_start > now() and not exists (
        select 1 from public.bookings b
        where b.status = 'bestaetigt' and b.starts_at < slot_end and b.ends_at > slot_start
      ) then
        return next slot_start;
      end if;
      slot_start := slot_end;
    end loop;
  end loop;
  return;
end;
$$;

create or replace function public.create_booking(
  p_name text, p_email text, p_phone text, p_message text, p_starts_at timestamptz
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  slot_end timestamptz := p_starts_at + duration;
  wd public.weekday;
  slot_date date := p_starts_at::date;
  result public.bookings;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Name fehlt.';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'E-Mail fehlt.';
  end if;
  if p_starts_at < now() then
    raise exception 'Termin liegt in der Vergangenheit.';
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = slot_date) then
    raise exception 'An diesem Tag sind keine Termine verfügbar.';
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from slot_date)::int + 1];
  if not exists (
    select 1 from public.booking_availability
    where weekday = wd and start_time <= p_starts_at::time and end_time >= slot_end::time
  ) then
    raise exception 'Dieser Zeitpunkt liegt ausserhalb der Verfügbarkeit.';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.status = 'bestaetigt' and b.starts_at < slot_end and b.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Termin ist leider bereits vergeben.';
  end if;

  insert into public.bookings (name, email, phone, message, starts_at, ends_at)
  values (trim(p_name), trim(p_email), nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_message,'')),''), p_starts_at, slot_end)
  returning * into result;

  return result;
end;
$$;

-- Badge-Integration: neue Sektion "termine", exakt nach dem
-- "tickets"/"rapporte"-Muster.
alter table public.section_views drop constraint section_views_section_check;
alter table public.section_views add constraint section_views_section_check
  check (section in ('invoices','meldungen','documents','calendar','waschplan','tickets','rapporte','termine'));

create or replace function public.mark_section_seen(p_section text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if p_section not in ('invoices','meldungen','documents','calendar','waschplan','tickets','rapporte','termine') then
    raise exception 'Unbekannte oder nicht unterstützte Sektion: %', p_section;
  end if;

  insert into public.section_views (profile_id, section, last_seen_at)
  values (auth.uid(), p_section, now())
  on conflict (profile_id, section) do update set last_seen_at = now();
end;
$$;

create or replace function public.get_unread_counts()
returns table(section text, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  am_admin boolean;
  c_messages int;
  c_invoices int;
  c_meldungen int;
  c_documents int;
  c_announcements int;
  c_calendar int;
  c_waschplan int;
  c_tickets int;
  c_rapporte int;
  c_termine int;
begin
  if me is null then
    return;
  end if;

  am_admin := public.is_admin();

  select count(*) into c_messages
  from public.messages
  where recipient_profile_id = me and read_at is null;

  select count(*) into c_invoices
  from public.invoices
  where recipient_profile_id = me
    and issuer_profile_id <> me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'invoices'),
      '-infinity'::timestamptz
    );

  if am_admin then
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  end if;

  select count(*) into c_documents
  from public.documents
  where owner_profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    );

  select count(*) into c_announcements
  from public.property_announcements pa
  where created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    )
    and (
      exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = pa.property_id
          and t.tenant_profile_id = me and t.status = 'active' and public.is_approved()
      )
      or exists (
        select 1 from public.ownerships o
        where (o.property_id = pa.property_id or o.unit_id in (select id from public.units where property_id = pa.property_id))
          and o.owner_profile_id = me
          and (o.end_date is null or o.end_date >= current_date)
          and public.is_approved()
      )
      or public.has_property_permission(pa.property_id, 'hauswart')
    );

  c_documents := c_documents + c_announcements;

  select count(*) into c_calendar
  from public.calendar_events
  where profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'calendar'),
      '-infinity'::timestamptz
    );

  select count(*) into c_waschplan
  from public.laundry_schedule_slots l
  where l.updated_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'waschplan'),
      '-infinity'::timestamptz
    )
    and l.created_by is distinct from me
    and (
      am_admin
      or public.has_property_permission(l.property_id, 'waschplan')
      or public.has_property_permission(l.property_id, 'hauswart')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = l.property_id
          and t.tenant_profile_id = me and public.is_approved()
      )
    );

  if am_admin then
    select count(*) into c_tickets
    from public.admin_tickets
    where (
      (created_by <> me and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
      or
      (updated_by is distinct from me and updated_at > created_at and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
    );
  else
    c_tickets := 0;
  end if;

  if am_admin then
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  end if;

  if am_admin then
    select count(*) into c_termine
    from public.bookings
    where status = 'bestaetigt'
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'termine'),
        '-infinity'::timestamptz
      );
  else
    c_termine := 0;
  end if;

  return query values
    ('messages',  c_messages),
    ('invoices',  c_invoices),
    ('meldungen', c_meldungen),
    ('documents', c_documents),
    ('calendar',  c_calendar),
    ('waschplan', c_waschplan),
    ('tickets',   c_tickets),
    ('rapporte',  c_rapporte),
    ('termine',   c_termine);
end;
$$;

-- Nachtrag: Buchungen brauchen einen Bezug zum Objekt, um das es bei der
-- Besichtigung/dem Beratungsgespräch geht (optional — ein
-- Beratungsgespräch muss sich nicht auf ein bestimmtes Objekt beziehen).
-- on delete set null statt cascade: eine gelöschte Liegenschaft darf eine
-- vergangene Buchung nicht mit wegreissen, sie wird nur "objektlos".
alter table public.bookings
  add column if not exists property_id uuid references public.properties(id) on delete set null;

-- create or replace kann keine neue Parameterliste an eine bestehende
-- Funktion "anhängen" (Postgres würde sie sonst als zusätzliche,
-- überladene Funktion daneben anlegen) — die alte 5-Parameter-Version
-- muss darum zuerst explizit entfernt werden.
drop function if exists public.create_booking(text, text, text, text, timestamptz);

create or replace function public.create_booking(
  p_name text, p_email text, p_phone text, p_message text, p_starts_at timestamptz, p_property_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  slot_end timestamptz := p_starts_at + duration;
  wd public.weekday;
  slot_date date := p_starts_at::date;
  result public.bookings;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Name fehlt.';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'E-Mail fehlt.';
  end if;
  if p_starts_at < now() then
    raise exception 'Termin liegt in der Vergangenheit.';
  end if;
  if p_property_id is not null and not exists (
    select 1 from public.properties where id = p_property_id and visibility = 'public'
  ) then
    raise exception 'Objekt nicht gefunden.';
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = slot_date) then
    raise exception 'An diesem Tag sind keine Termine verfügbar.';
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from slot_date)::int + 1];
  if not exists (
    select 1 from public.booking_availability
    where weekday = wd and start_time <= p_starts_at::time and end_time >= slot_end::time
  ) then
    raise exception 'Dieser Zeitpunkt liegt ausserhalb der Verfügbarkeit.';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.status = 'bestaetigt' and b.starts_at < slot_end and b.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Termin ist leider bereits vergeben.';
  end if;

  insert into public.bookings (name, email, phone, message, starts_at, ends_at, property_id)
  values (trim(p_name), trim(p_email), nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_message,'')),''), p_starts_at, slot_end, p_property_id)
  returning * into result;

  return result;
end;
$$;

-- =====================================================================
-- ADMIN-KALENDER "Termine": Wochenübersicht mit Bestätigen/Verschieben
-- und manuell setzbaren Zeit-Blockern.
--
-- Neue Buchungen sind ab jetzt erst "angefragt" (nicht mehr sofort
-- "bestaetigt") — der Admin bestätigt sie explizit im Kalender, was
-- eine Bestätigungs-Mail an die anfragende Person auslöst
-- (send-booking-confirmation Edge Function). Ein "angefragter" Termin
-- blockiert den Slot bereits genau wie ein bestätigter, damit niemand
-- zweimal denselben Slot anfragen kann, solange der Admin noch nicht
-- reagiert hat.
--
-- WICHTIG: Die folgende Zeile muss EINZELN ausgeführt werden (separat
-- vom Rest dieses Blocks) — Postgres erlaubt es nicht, einen frisch per
-- ALTER TYPE hinzugefügten Enum-Wert in derselben Transaktion schon zu
-- verwenden. Im Supabase SQL Editor: diese eine Zeile markieren, "Run"
-- klicken, dann erst den Rest ab "create table public.booking_blocks".
alter type public.booking_status add value if not exists 'angefragt';

-- Vom Admin manuell gesperrte Zeiträume (z.B. "Dienstag 14-16 Uhr
-- geblockt, kein öffentlicher Termin") — unabhängig von den ganztägigen
-- booking_blocked_dates oben. Nur der Admin liest/schreibt hier direkt;
-- get_available_slots()/create_booking() lesen das als security-definer
-- Funktion mit, ganz ohne eigene public-Policy nötig.
create table public.booking_blocks (
  id         uuid primary key default gen_random_uuid(),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  check (ends_at > starts_at)
);
alter table public.booking_blocks enable row level security;
alter table public.booking_blocks force row level security;
create policy booking_blocks_admin_all on public.booking_blocks
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.get_available_slots(p_date date)
returns setof timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  wd public.weekday;
  win record;
  slot_start timestamptz;
  slot_end timestamptz;
begin
  if p_date < current_date then
    return;
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = p_date) then
    return;
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from p_date)::int + 1];

  for win in
    select start_time, end_time from public.booking_availability where weekday = wd
  loop
    slot_start := p_date + win.start_time;
    while slot_start + duration <= p_date + win.end_time loop
      slot_end := slot_start + duration;
      if slot_start > now()
        and not exists (
          select 1 from public.bookings b
          where b.status in ('bestaetigt','angefragt') and b.starts_at < slot_end and b.ends_at > slot_start
        )
        and not exists (
          select 1 from public.booking_blocks k
          where k.starts_at < slot_end and k.ends_at > slot_start
        )
      then
        return next slot_start;
      end if;
      slot_start := slot_end;
    end loop;
  end loop;
  return;
end;
$$;

create or replace function public.create_booking(
  p_name text, p_email text, p_phone text, p_message text, p_starts_at timestamptz, p_property_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  slot_end timestamptz := p_starts_at + duration;
  wd public.weekday;
  slot_date date := p_starts_at::date;
  result public.bookings;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Name fehlt.';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'E-Mail fehlt.';
  end if;
  if p_starts_at < now() then
    raise exception 'Termin liegt in der Vergangenheit.';
  end if;
  if p_property_id is not null and not exists (
    select 1 from public.properties where id = p_property_id and visibility = 'public'
  ) then
    raise exception 'Objekt nicht gefunden.';
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = slot_date) then
    raise exception 'An diesem Tag sind keine Termine verfügbar.';
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from slot_date)::int + 1];
  if not exists (
    select 1 from public.booking_availability
    where weekday = wd and start_time <= p_starts_at::time and end_time >= slot_end::time
  ) then
    raise exception 'Dieser Zeitpunkt liegt ausserhalb der Verfügbarkeit.';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.status in ('bestaetigt','angefragt') and b.starts_at < slot_end and b.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Termin ist leider bereits vergeben.';
  end if;

  if exists (
    select 1 from public.booking_blocks k
    where k.starts_at < slot_end and k.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Zeitpunkt ist gesperrt.';
  end if;

  insert into public.bookings (name, email, phone, message, starts_at, ends_at, property_id)
  values (trim(p_name), trim(p_email), nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_message,'')),''), p_starts_at, slot_end, p_property_id)
  returning * into result;

  return result;
end;
$$;

-- Neue Buchungen starten neu als "angefragt", nicht direkt "bestaetigt"
-- (siehe Hinweis oben) — der Tabellen-Default muss dafür ebenfalls
-- angepasst werden (create_booking() selbst setzt status nie explizit,
-- verlässt sich auf diesen Default).
alter table public.bookings alter column status set default 'angefragt';

-- Badge "Termine" soll auch bei neu eingegangenen (noch unbestätigten)
-- Anfragen anspringen, nicht nur bei bereits bestätigten.
create or replace function public.get_unread_counts()
returns table(section text, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  am_admin boolean;
  c_messages int;
  c_invoices int;
  c_meldungen int;
  c_documents int;
  c_announcements int;
  c_calendar int;
  c_waschplan int;
  c_tickets int;
  c_rapporte int;
  c_termine int;
begin
  if me is null then
    return;
  end if;

  am_admin := public.is_admin();

  select count(*) into c_messages
  from public.messages
  where recipient_profile_id = me and read_at is null;

  select count(*) into c_invoices
  from public.invoices
  where recipient_profile_id = me
    and issuer_profile_id <> me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'invoices'),
      '-infinity'::timestamptz
    );

  if am_admin then
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  end if;

  select count(*) into c_documents
  from public.documents
  where owner_profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    );

  select count(*) into c_announcements
  from public.property_announcements pa
  where created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    )
    and (
      exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = pa.property_id
          and t.tenant_profile_id = me and t.status = 'active' and public.is_approved()
      )
      or exists (
        select 1 from public.ownerships o
        where (o.property_id = pa.property_id or o.unit_id in (select id from public.units where property_id = pa.property_id))
          and o.owner_profile_id = me
          and (o.end_date is null or o.end_date >= current_date)
          and public.is_approved()
      )
      or public.has_property_permission(pa.property_id, 'hauswart')
    );

  c_documents := c_documents + c_announcements;

  select count(*) into c_calendar
  from public.calendar_events
  where profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'calendar'),
      '-infinity'::timestamptz
    );

  select count(*) into c_waschplan
  from public.laundry_schedule_slots l
  where l.updated_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'waschplan'),
      '-infinity'::timestamptz
    )
    and l.created_by is distinct from me
    and (
      am_admin
      or public.has_property_permission(l.property_id, 'waschplan')
      or public.has_property_permission(l.property_id, 'hauswart')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = l.property_id
          and t.tenant_profile_id = me and public.is_approved()
      )
    );

  if am_admin then
    select count(*) into c_tickets
    from public.admin_tickets
    where (
      (created_by <> me and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
      or
      (updated_by is distinct from me and updated_at > created_at and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
    );
  else
    c_tickets := 0;
  end if;

  if am_admin then
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  end if;

  if am_admin then
    select count(*) into c_termine
    from public.bookings
    where status in ('bestaetigt','angefragt')
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'termine'),
        '-infinity'::timestamptz
      );
  else
    c_termine := 0;
  end if;

  return query values
    ('messages',  c_messages),
    ('invoices',  c_invoices),
    ('meldungen', c_meldungen),
    ('documents', c_documents),
    ('calendar',  c_calendar),
    ('waschplan', c_waschplan),
    ('tickets',   c_tickets),
    ('rapporte',  c_rapporte),
    ('termine',   c_termine);
end;
$$;

-- Admin trägt intern Termine direkt ein (Meeting mit Eigentümer,
-- Handwerker-Termin an einem Objekt, …), ganz ohne den öffentlichen
-- Anfrage-Prozess und ohne dass die betroffene Person zwingend eine
-- E-Mail-Adresse braucht (ein Handwerker hat oft keine im System) —
-- der Admin fügt die Zeile per direktem Insert ein (bookings_admin_all
-- Policy erlaubt das bereits), status gleich 'bestaetigt'.
alter table public.bookings alter column email drop not null;

-- =====================================================================
-- TERMINE MIT TEILNEHMERN (appointments): bewusst getrennt von
-- "bookings" (das bleibt exklusiv für den öffentlichen
-- Anfrage-Prozess/die Verfügbarkeitsprüfung). Ein Termin zwischen z.B.
-- Handwerker und Mieter, bei dem der Admin selbst NICHT teilnimmt, darf
-- die eigene Zeit des Admins nicht blockieren — nur wenn
-- admin_participates = true, zählt der Termin als "Admin ist
-- beschäftigt" und wird unten in get_available_slots()/create_booking()
-- zusätzlich mitgeprüft.
-- =====================================================================
create type public.appointment_participant_status as enum ('eingeladen', 'bestaetigt');

create table public.appointments (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  -- freies Label ('architekt','eigentuemer','mieter','handwerker','amt',
  -- 'andere', …) — rein informativ für die private Notiz (Punkt 1),
  -- keine Fremdschlüssel-Bindung an profile_category nötig.
  category           text,
  note               text,
  property_id        uuid references public.properties(id) on delete set null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  admin_participates boolean not null default true,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.appointments enable row level security;
alter table public.appointments force row level security;

create table public.appointment_participants (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  status         public.appointment_participant_status not null default 'eingeladen',
  created_at     timestamptz not null default now(),
  primary key (appointment_id, profile_id)
);
alter table public.appointment_participants enable row level security;
alter table public.appointment_participants force row level security;

create policy appointments_admin_all on public.appointments
  for all using (public.is_admin()) with check (public.is_admin());
-- Ein Teilnehmer darf die Termine sehen, an denen er beteiligt ist —
-- gleiches Muster wie property_document_access weiter oben.
create policy appointments_participant_select on public.appointments
  for select using (
    exists (
      select 1 from public.appointment_participants ap
      where ap.appointment_id = appointments.id and ap.profile_id = auth.uid()
    )
  );

create policy appointment_participants_admin_all on public.appointment_participants
  for all using (public.is_admin()) with check (public.is_admin());
create policy appointment_participants_self_select on public.appointment_participants
  for select using (profile_id = auth.uid());
-- Ein Teilnehmer darf ausschliesslich seine eigene Zeile bestätigen
-- (with check verhindert, dass er sie auf eine fremde profile_id
-- "umbiegt" statt sie nur zu bestätigen).
create policy appointment_participants_self_confirm on public.appointment_participants
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create or replace function public.get_available_slots(p_date date)
returns setof timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  wd public.weekday;
  win record;
  slot_start timestamptz;
  slot_end timestamptz;
begin
  if p_date < current_date then
    return;
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = p_date) then
    return;
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from p_date)::int + 1];

  for win in
    select start_time, end_time from public.booking_availability where weekday = wd
  loop
    slot_start := p_date + win.start_time;
    while slot_start + duration <= p_date + win.end_time loop
      slot_end := slot_start + duration;
      if slot_start > now()
        and not exists (
          select 1 from public.bookings b
          where b.status in ('bestaetigt','angefragt') and b.starts_at < slot_end and b.ends_at > slot_start
        )
        and not exists (
          select 1 from public.booking_blocks k
          where k.starts_at < slot_end and k.ends_at > slot_start
        )
        and not exists (
          select 1 from public.appointments a
          where a.admin_participates and a.starts_at < slot_end and a.ends_at > slot_start
        )
      then
        return next slot_start;
      end if;
      slot_start := slot_end;
    end loop;
  end loop;
  return;
end;
$$;

create or replace function public.create_booking(
  p_name text, p_email text, p_phone text, p_message text, p_starts_at timestamptz, p_property_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  slot_end timestamptz := p_starts_at + duration;
  wd public.weekday;
  slot_date date := p_starts_at::date;
  result public.bookings;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Name fehlt.';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'E-Mail fehlt.';
  end if;
  if p_starts_at < now() then
    raise exception 'Termin liegt in der Vergangenheit.';
  end if;
  if p_property_id is not null and not exists (
    select 1 from public.properties where id = p_property_id and visibility = 'public'
  ) then
    raise exception 'Objekt nicht gefunden.';
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = slot_date) then
    raise exception 'An diesem Tag sind keine Termine verfügbar.';
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from slot_date)::int + 1];
  if not exists (
    select 1 from public.booking_availability
    where weekday = wd and start_time <= p_starts_at::time and end_time >= slot_end::time
  ) then
    raise exception 'Dieser Zeitpunkt liegt ausserhalb der Verfügbarkeit.';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.status in ('bestaetigt','angefragt') and b.starts_at < slot_end and b.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Termin ist leider bereits vergeben.';
  end if;

  if exists (
    select 1 from public.booking_blocks k
    where k.starts_at < slot_end and k.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Zeitpunkt ist gesperrt.';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.admin_participates and a.starts_at < slot_end and a.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Zeitpunkt ist bereits belegt.';
  end if;

  insert into public.bookings (name, email, phone, message, starts_at, ends_at, property_id)
  values (trim(p_name), trim(p_email), nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_message,'')),''), p_starts_at, slot_end, p_property_id)
  returning * into result;

  return result;
end;
$$;

-- =====================================================================
-- ORDNER-ABLAGESYSTEM (document_folders/document_files/document_shares):
-- ersetzt den alten "Dokument zuweisen"-Workflow auf der Dokumente-Seite
-- komplett. Bewusst NEUE, separate Tabellen statt die alte "documents"
-- Tabelle umzubauen — die alte Tabelle/ihr Storage-Bucket bleiben
-- unangetastet (kein Datenverlust), nur die UI nutzt sie nicht mehr.
--
-- Freigabe ist ein Schnappschuss: wer einen Ordner teilt, bekommt für
-- jede DATEI darin (rekursiv, zum Zeitpunkt des Teilens) eine eigene
-- Zeile in document_shares — es gibt keine "lebende" Ordner-Freigabe,
-- die automatisch neue Dateien mit einschliesst. Das vermeidet
-- rekursive RLS-Policies, für die es in diesem Schema kein Vorbild
-- gibt; die Zugriffsprüfung bleibt eine einzige, einfache
-- Existenzprüfung auf document_shares.
-- =====================================================================
create table public.document_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  parent_id   uuid references public.document_folders(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  unit_id     uuid references public.units(id) on delete set null,
  contact_profile_id uuid references public.profiles(id) on delete set null,
  is_private_admin boolean not null default false,
  archive_category text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.document_folders add column if not exists property_id uuid references public.properties(id) on delete set null;
alter table public.document_folders add column if not exists unit_id uuid references public.units(id) on delete set null;
alter table public.document_folders add column if not exists contact_profile_id uuid references public.profiles(id) on delete set null;
alter table public.document_folders add column if not exists is_private_admin boolean not null default false;
alter table public.document_folders add column if not exists archive_category text;
create index if not exists document_folders_property_idx on public.document_folders(property_id);
create index if not exists document_folders_unit_idx on public.document_folders(unit_id);
create index if not exists document_folders_contact_idx on public.document_folders(contact_profile_id);
create index if not exists document_folders_archive_category_idx on public.document_folders(archive_category);
alter table public.document_folders enable row level security;
alter table public.document_folders force row level security;
create policy document_folders_admin_all on public.document_folders
  for all using (public.is_admin()) with check (public.is_admin());

create table public.document_files (
  id                 uuid primary key default gen_random_uuid(),
  folder_id          uuid references public.document_folders(id) on delete cascade,
  property_id        uuid references public.properties(id) on delete set null,
  unit_id            uuid references public.units(id) on delete set null,
  contact_profile_id uuid references public.profiles(id) on delete set null,
  is_private_admin   boolean not null default false,
  archive_category   text,
  title              text not null,
  file_path          text not null,
  mime_type          text,
  size_bytes         bigint,
  needs_confirmation boolean not null default false,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);
alter table public.document_files add column if not exists property_id uuid references public.properties(id) on delete set null;
alter table public.document_files add column if not exists unit_id uuid references public.units(id) on delete set null;
alter table public.document_files add column if not exists contact_profile_id uuid references public.profiles(id) on delete set null;
alter table public.document_files add column if not exists is_private_admin boolean not null default false;
alter table public.document_files add column if not exists archive_category text;
create index if not exists document_files_property_idx on public.document_files(property_id);
create index if not exists document_files_unit_idx on public.document_files(unit_id);
create index if not exists document_files_contact_idx on public.document_files(contact_profile_id);
create index if not exists document_files_private_admin_idx on public.document_files(is_private_admin) where is_private_admin = true;
create index if not exists document_files_archive_category_idx on public.document_files(archive_category);
alter table public.document_files enable row level security;
alter table public.document_files force row level security;
create policy document_files_admin_all on public.document_files
  for all using (public.is_admin()) with check (public.is_admin());

create table public.document_shares (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references public.document_files(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  confirmed_at timestamptz,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  unique (file_id, profile_id)
);
alter table public.document_shares enable row level security;
alter table public.document_shares force row level security;
create policy document_shares_admin_all on public.document_shares
  for all using (public.is_admin()) with check (public.is_admin());
-- Nutzer duerfen ihre eigenen Freigabe-Zeilen lesen (get_my_shared_documents()
-- unten reicht fuer die UI, aber das schadet nicht und folgt dem Muster
-- von property_document_access_own_or_admin). Bewusst KEINE Update-Policy
-- fuer Nutzer -- das Bestaetigen laeuft ausschliesslich ueber die RPC
-- unten, sonst koennte ein Nutzer file_id seiner eigenen Zeile auf eine
-- fremde Datei "ummuenzen" und sich so Zugriff verschaffen.
create policy document_shares_self_select on public.document_shares
  for select using (profile_id = auth.uid());

create or replace function public.confirm_document_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.document_shares
  set confirmed_at = now()
  where id = p_share_id and profile_id = auth.uid() and confirmed_at is null;
end;
$$;

create or replace function public.can_access_document_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.document_shares
    where file_id = p_file_id and profile_id = auth.uid()
  );
$$;

-- Fuer die Storage-Policy (storage.objects kennt nur den Pfad, keine
-- file_id) -- gleiches Muster wie storage_documents_select, das ueber
-- file_path zurueck auf die Metadatentabelle joint.
create or replace function public.can_access_document_file_by_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.document_files f
    join public.document_shares ds on ds.file_id = f.id
    where f.file_path = p_path and ds.profile_id = auth.uid()
  );
$$;

-- Flache Liste aller fuer den eingeloggten Nutzer freigegebenen Dateien,
-- inkl. eines lesbaren Ordner-Pfads ("Vertraege / 2026") als Text --
-- dafuer wird pro Zeile einmal die parent_id-Kette nach oben durchlaufen
-- (kein rekursives CTE, es gibt kein Vorbild dafuer in diesem Schema;
-- eine einfache Schleife passt zum Stil von get_available_slots() oben).
-- Rein kosmetisch: sicherheitsrelevant ist nur die Existenz der
-- document_shares-Zeile, nicht dieser Pfad-Text.
create or replace function public.get_my_shared_documents()
returns table(
  share_id uuid, file_id uuid, title text, file_path text, mime_type text,
  size_bytes bigint, needs_confirmation boolean, confirmed_at timestamptz,
  folder_path text, shared_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r record;
  v_folder_id uuid;
  v_path text;
  v_name text;
begin
  if me is null then
    return;
  end if;

  for r in
    select ds.id as s_id, df.id as f_id, df.title as f_title, df.file_path as f_path,
           df.mime_type as f_mime, df.size_bytes as f_size, df.needs_confirmation as f_needs_confirmation,
           ds.confirmed_at as s_confirmed_at, df.folder_id as f_folder_id, ds.created_at as s_created_at
    from public.document_shares ds
    join public.document_files df on df.id = ds.file_id
    where ds.profile_id = me
    order by ds.created_at desc
  loop
    v_path := null;
    v_folder_id := r.f_folder_id;
    while v_folder_id is not null loop
      select name, parent_id into v_name, v_folder_id from public.document_folders where id = v_folder_id;
      v_path := case when v_path is null then v_name else v_name || ' / ' || v_path end;
    end loop;

    share_id := r.s_id;
    file_id := r.f_id;
    title := r.f_title;
    file_path := r.f_path;
    mime_type := r.f_mime;
    size_bytes := r.f_size;
    needs_confirmation := r.f_needs_confirmation;
    confirmed_at := r.s_confirmed_at;
    folder_path := coalesce(v_path, '');
    shared_at := r.s_created_at;
    return next;
  end loop;
end;
$$;

insert into storage.buckets (id, name, public)
values ('document-vault', 'document-vault', false)
on conflict (id) do nothing;

create policy storage_document_vault_select on storage.objects
  for select using (
    bucket_id = 'document-vault'
    and public.can_access_document_file_by_path(name)
  );
create policy storage_document_vault_admin_write on storage.objects
  for insert with check (bucket_id = 'document-vault' and public.is_admin());
create policy storage_document_vault_admin_update on storage.objects
  for update using (bucket_id = 'document-vault' and public.is_admin());
create policy storage_document_vault_admin_delete on storage.objects
  for delete using (bucket_id = 'document-vault' and public.is_admin());

-- get_unread_counts(): neue Version angehaengt, einzige Aenderung ist
-- der c_documents-Block (jetzt document_shares statt der alten
-- documents-Tabelle; fuer Admin immer 0, da Admin selbst teilt statt
-- zugeteilt zu bekommen) -- alles andere ist eine exakte Kopie der
-- vorherigen Version.
create or replace function public.get_unread_counts()
returns table(section text, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  am_admin boolean;
  c_messages int;
  c_invoices int;
  c_meldungen int;
  c_documents int;
  c_announcements int;
  c_calendar int;
  c_waschplan int;
  c_tickets int;
  c_rapporte int;
  c_termine int;
begin
  if me is null then
    return;
  end if;

  am_admin := public.is_admin();

  select count(*) into c_messages
  from public.messages
  where recipient_profile_id = me and read_at is null;

  select count(*) into c_invoices
  from public.invoices
  where recipient_profile_id = me
    and issuer_profile_id <> me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'invoices'),
      '-infinity'::timestamptz
    );

  if am_admin then
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  end if;

  if am_admin then
    c_documents := 0;
  else
    select count(*) into c_documents
    from public.document_shares ds
    where ds.profile_id = me
      and ds.created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
        '-infinity'::timestamptz
      );
  end if;

  select count(*) into c_announcements
  from public.property_announcements pa
  where created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    )
    and (
      exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = pa.property_id
          and t.tenant_profile_id = me and t.status = 'active' and public.is_approved()
      )
      or exists (
        select 1 from public.ownerships o
        where (o.property_id = pa.property_id or o.unit_id in (select id from public.units where property_id = pa.property_id))
          and o.owner_profile_id = me
          and (o.end_date is null or o.end_date >= current_date)
          and public.is_approved()
      )
      or public.has_property_permission(pa.property_id, 'hauswart')
    );

  c_documents := c_documents + c_announcements;

  select count(*) into c_calendar
  from public.calendar_events
  where profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'calendar'),
      '-infinity'::timestamptz
    );

  select count(*) into c_waschplan
  from public.laundry_schedule_slots l
  where l.updated_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'waschplan'),
      '-infinity'::timestamptz
    )
    and l.created_by is distinct from me
    and (
      am_admin
      or public.has_property_permission(l.property_id, 'waschplan')
      or public.has_property_permission(l.property_id, 'hauswart')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = l.property_id
          and t.tenant_profile_id = me and public.is_approved()
      )
    );

  if am_admin then
    select count(*) into c_tickets
    from public.admin_tickets
    where (
      (created_by <> me and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
      or
      (updated_by is distinct from me and updated_at > created_at and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
    );
  else
    c_tickets := 0;
  end if;

  if am_admin then
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  end if;

  if am_admin then
    select count(*) into c_termine
    from public.bookings
    where status in ('bestaetigt','angefragt')
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'termine'),
        '-infinity'::timestamptz
      );
  else
    c_termine := 0;
  end if;

  return query values
    ('messages',  c_messages),
    ('invoices',  c_invoices),
    ('meldungen', c_meldungen),
    ('documents', c_documents),
    ('calendar',  c_calendar),
    ('waschplan', c_waschplan),
    ('tickets',   c_tickets),
    ('rapporte',  c_rapporte),
    ('termine',   c_termine);
end;
$$;


-- Bestaetigungspflicht gehoert an die FREIGABE (document_shares), nicht
-- an die Datei (document_files) -- beim Hochladen weiss man ja noch
-- nicht, wer die Datei bekommt oder ob bei diesem Empfaenger ueberhaupt
-- eine Bestaetigung noetig ist. document_files.needs_confirmation
-- bleibt unbenutzt stehen (kein Datenverlust, einfach nicht mehr
-- gelesen/geschrieben) statt es destruktiv zu entfernen.
alter table public.document_shares add column if not exists needs_confirmation boolean not null default false;

create or replace function public.get_my_shared_documents()
returns table(
  share_id uuid, file_id uuid, title text, file_path text, mime_type text,
  size_bytes bigint, needs_confirmation boolean, confirmed_at timestamptz,
  folder_path text, shared_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r record;
  v_folder_id uuid;
  v_path text;
  v_name text;
begin
  if me is null then
    return;
  end if;

  for r in
    select ds.id as s_id, df.id as f_id, df.title as f_title, df.file_path as f_path,
           df.mime_type as f_mime, df.size_bytes as f_size, ds.needs_confirmation as s_needs_confirmation,
           ds.confirmed_at as s_confirmed_at, df.folder_id as f_folder_id, ds.created_at as s_created_at
    from public.document_shares ds
    join public.document_files df on df.id = ds.file_id
    where ds.profile_id = me
    order by ds.created_at desc
  loop
    v_path := null;
    v_folder_id := r.f_folder_id;
    while v_folder_id is not null loop
      select name, parent_id into v_name, v_folder_id from public.document_folders where id = v_folder_id;
      v_path := case when v_path is null then v_name else v_name || ' / ' || v_path end;
    end loop;

    share_id := r.s_id;
    file_id := r.f_id;
    title := r.f_title;
    file_path := r.f_path;
    mime_type := r.f_mime;
    size_bytes := r.f_size;
    needs_confirmation := r.s_needs_confirmation;
    confirmed_at := r.s_confirmed_at;
    folder_path := coalesce(v_path, '');
    shared_at := r.s_created_at;
    return next;
  end loop;
end;
$$;

-- =====================================================================
-- NACHRICHTEN-ANHÄNGE: Datei, Sprachnachricht, Standort (GPS oder
-- Objekt-Adresse), Dokument/Ordner aus dem Ordner-Ablagesystem.
-- Bewusst EINE Spaltenerweiterung auf "messages" statt einer neuen
-- Tabelle -- jede Nachricht traegt hoechstens einen Anhang (Text ODER
-- genau eine Anhang-Aktion pro Sendevorgang). Anhang-Metadaten werden
-- beim Senden denormalisiert (Label/Pfad direkt auf die Zeile
-- geschrieben), damit beim Rendern keine RLS-blockierten Joins nötig
-- sind -- ein Empfänger hat z.B. kein direktes SELECT auf
-- document_files/document_folders, sieht die Nachricht aber trotzdem
-- korrekt beschriftet.
-- =====================================================================
alter table public.messages alter column body drop not null;
alter table public.messages add column if not exists attachment_type text
  check (attachment_type in ('file','voice','location_gps','location_property','document_file','document_folder'));
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_mime_type text;
alter table public.messages add column if not exists attachment_size_bytes bigint;
alter table public.messages add column if not exists attachment_duration_seconds int;
alter table public.messages add column if not exists attachment_lat double precision;
alter table public.messages add column if not exists attachment_lng double precision;
alter table public.messages add column if not exists attachment_label text;
alter table public.messages add column if not exists attachment_document_file_id uuid references public.document_files(id) on delete set null;
alter table public.messages add column if not exists attachment_document_folder_id uuid references public.document_folders(id) on delete set null;

-- Anders als bei allen bisherigen Buckets duerfen hier NICHT nur
-- Admins schreiben -- ein Chat ohne beidseitige Anhänge waere sinnlos
-- (z.B. Mieter schickt Foto eines Schadens). Insert-Policy nutzt das
-- Praefix-Muster von storage_issue_report_photos_*/
-- storage_hauswart_report_photos_* (eigenes {profile_id}/...-Praefix),
-- Select-Policy das Join-back-Muster von storage_documents_select
-- (ueber attachment_path zurueck auf messages, sichtbar fuer
-- Sender/Empfaenger/Admin).
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

create policy storage_message_attachments_insert on storage.objects
  for insert with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );
create policy storage_message_attachments_select on storage.objects
  for select using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.messages m
      where m.attachment_path = storage.objects.name
        and (m.sender_profile_id = auth.uid() or m.recipient_profile_id = auth.uid() or public.is_admin())
    )
  );

-- Kategorisiert Einheiten (Wohnung/Garage/etc.) fuer die
-- Spalten-Ansicht der Objekte-Seite -- text + check statt enum, damit
-- der Wertebereich spaeter ohne ALTER TYPE-Transaktionsprobleme
-- erweitert werden kann (gleiches Muster wie
-- property_permissions.permission/recurring_invoices.due_rule).
-- Bestehende Einheiten fallen auf den Default "sonstiges", nichts
-- verschwindet -- koennen danach einzeln umkategorisiert werden.
alter table public.units add column if not exists unit_type text not null default 'sonstiges'
  check (unit_type in ('wohnung','garage','studio','lager','gewerbe','sonstiges'));

-- Gastronomie ergaenzt -- check-Constraints lassen sich nicht per
-- ALTER TABLE aendern, deshalb droppen + mit erweitertem Wertebereich
-- neu anlegen (der Default-Name entspricht dem Postgres-Muster
-- "<tabelle>_<spalte>_check" fuer inline in ADD COLUMN definierte
-- Constraints).
alter table public.units drop constraint if exists units_unit_type_check;
alter table public.units add constraint units_unit_type_check
  check (unit_type in (
    'wohnung',
    'zimmer',
    'parkplatz',
    'haus',
    'einfamilienhaus',
    'reihenhaus',
    'doppelhaushaelfte',
    'villa',
    'maisonette',
    'attika',
    'penthouse',
    'triplex',
    'dachwohnung',
    'etagenwohnung',
    'loft',
    'einliegerwohnung',
    'zimmer_moebliert',
    'wohnung_moebliert',
    'studio',
    'garage',
    'tiefgaragenplatz',
    'aussenparkplatz',
    'hobbyraum',
    'lager',
    'gewerbe',
    'gastronomie',
    'sonstiges'
  ));

-- Fix eingebaute Geräte pro Liegenschaft oder Einheit
-- (z.B. Waschmaschine/Tumbler/Lift auf Liegenschaftsebene,
-- Kochherd/Kühlschrank/Backofen auf Einheitsebene).
create table if not exists public.property_appliances (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  unit_id        uuid references public.units(id) on delete cascade,
  category       text not null,
  label          text not null,
  manufacturer   text,
  model          text,
  serial_number  text,
  installed_at   date,
  maintenance_at date,
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id)
);

alter table public.property_appliances enable row level security;
alter table public.property_appliances force row level security;

drop policy if exists property_appliances_admin_all on public.property_appliances;
create policy property_appliances_admin_all on public.property_appliances
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists property_appliances_scoped_select on public.property_appliances;
create policy property_appliances_scoped_select on public.property_appliances
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.units u
      join public.tenancies t on t.unit_id = u.id
      where u.property_id = property_appliances.property_id
        and (property_appliances.unit_id is null or property_appliances.unit_id = u.id)
        and t.tenant_profile_id = auth.uid()
        and t.status = 'active'
        and public.is_approved()
    )
    or exists (
      select 1 from public.ownerships o
      where o.owner_profile_id = auth.uid()
        and public.is_approved()
        and (
          o.property_id = property_appliances.property_id
          or (property_appliances.unit_id is not null and o.unit_id = property_appliances.unit_id)
        )
    )
    or public.has_property_permission(property_appliances.property_id, 'hauswart')
  );

-- =====================================================================
-- WASCHPLAN-AUSBAU: pro Objekt waehlbar, wie viele Waschmaschinen/
-- Tumbler es gibt (1 oder 2 -- das ist die Kapazitaet pro Halbtag) und
-- ob der Admin die Slots fix zuweist ("fixed", bisheriges Verhalten)
-- oder die Mieter sich selbst in einen Kalender eintragen
-- ("self_service", neu). Zeiten sind bewusst nicht mehr frei waehlbar
-- (immer 07:00-13:00 / 13:00-19:00), damit Kapazitaet ueberhaupt
-- zaehlbar ist.
-- =====================================================================
alter table public.properties add column if not exists laundry_mode text not null default 'fixed'
  check (laundry_mode in ('fixed', 'self_service'));
alter table public.properties add column if not exists laundry_machine_count int not null default 2
  check (laundry_machine_count in (1, 2, 3, 4));

-- Falls die Spalte bereits mit dem engeren Wertebereich (1,2) angelegt
-- wurde: Check-Constraints lassen sich nicht per ALTER TABLE aendern,
-- deshalb droppen + mit erweitertem Wertebereich neu anlegen (gleiches
-- Muster wie units_unit_type_check/Gastronomie oben).
alter table public.properties drop constraint if exists properties_laundry_machine_count_check;
alter table public.properties add constraint properties_laundry_machine_count_check
  check (laundry_machine_count in (1, 2, 3, 4));

-- Bestehende freie Zeiten (falls vorhanden) bleiben unangetastet -- die
-- Constraint gilt "not valid", damit ein historischer Slot ausserhalb
-- des 07-13/13-19 Rasters die Migration nicht blockiert. Neue/geaenderte
-- Zeilen muessen sich daran halten; Admin-UI bietet ohnehin nur noch
-- Vormittag/Nachmittag als Auswahl an.
alter table public.laundry_schedule_slots drop constraint if exists laundry_schedule_slots_period_check;
alter table public.laundry_schedule_slots add constraint laundry_schedule_slots_period_check
  check (
    (start_time = '07:00' and end_time = '13:00')
    or (start_time = '13:00' and end_time = '19:00')
  ) not valid;

-- Kapazitaet ("max. 2 Wohnungen pro Halbtag, bzw. 1 bei nur einer
-- Waschmaschine") laesst sich nicht als einfache Check-Constraint
-- ausdruecken (haengt von COUNT(*) anderer Zeilen ab), deshalb ein
-- Trigger -- gleiches Prinzip wie trg_laundry_schedule_slots_touch_updated_at
-- weiter oben, nur vor INSERT/UPDATE statt danach.
create or replace function public.check_laundry_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_count int;
begin
  select laundry_machine_count into v_capacity from public.properties where id = new.property_id;

  select count(*) into v_count
  from public.laundry_schedule_slots
  where property_id = new.property_id
    and weekday = new.weekday
    and start_time = new.start_time
    and end_time = new.end_time
    and id is distinct from new.id;

  if v_count >= coalesce(v_capacity, 2) then
    raise exception 'Für diesen Halbtag sind bereits alle Waschmaschinen/Tumbler vergeben.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_laundry_schedule_slots_capacity on public.laundry_schedule_slots;
create trigger trg_laundry_schedule_slots_capacity
  before insert or update on public.laundry_schedule_slots
  for each row execute function public.check_laundry_slot_capacity();

-- Selbsteintrag-Kalender fuer den "self_service"-Modus: Mieter tragen
-- sich selbst in einen Halbtag ein (First-come-first-served), statt
-- dass der Admin fix zuweist. Eigene Tabelle statt Wiederverwendung von
-- laundry_schedule_slots, weil die Semantik grundverschieden ist (ein
-- konkretes Datum statt ein wiederkehrender Wochentag).
create table if not exists public.laundry_bookings (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references public.properties(id) on delete cascade,
  unit_id           uuid references public.units(id),
  tenant_profile_id uuid not null references public.profiles(id) on delete cascade,
  booking_date      date not null,
  period            text not null check (period in ('vormittag', 'nachmittag')),
  created_at        timestamptz not null default now(),
  unique (property_id, booking_date, period, tenant_profile_id)
);

alter table public.laundry_bookings enable row level security;
alter table public.laundry_bookings force row level security;

-- SELECT mirrort laundry_schedule_slots_select 1:1 -- alle Mieter des
-- Objekts sehen den vollen Kalender (wie bisher schon fremde Whg.-Labels
-- im fixen Modus sichtbar sind), Waschplan-Koordinatoren/Admin ebenso.
-- drop+create statt "if not exists" (das kennt CREATE POLICY nicht),
-- damit dieser Block gefahrlos mehrfach ausgefuehrt werden kann.
drop policy if exists laundry_bookings_select on public.laundry_bookings;
create policy laundry_bookings_select on public.laundry_bookings
  for select using (
    public.is_admin()
    or public.has_property_permission(laundry_bookings.property_id, 'waschplan')
    or exists (
      select 1 from public.units u
      join public.tenancies t on t.unit_id = u.id
      where u.property_id = laundry_bookings.property_id
        and t.tenant_profile_id = auth.uid() and public.is_approved()
    )
  );
drop policy if exists laundry_bookings_admin_all on public.laundry_bookings;
create policy laundry_bookings_admin_all on public.laundry_bookings
  for all using (public.is_admin()) with check (public.is_admin());
-- Absagen laeuft direkt (kein RPC noetig, keine Kapazitaetspruefung
-- beim Loeschen); das Eintragen selbst NUR ueber create_laundry_booking()
-- unten (security definer, bypasst RLS), damit die Kapazitaetspruefung
-- atomar bleibt -- deshalb bewusst keine Insert-Policy fuer Mieter hier.
drop policy if exists laundry_bookings_self_delete on public.laundry_bookings;
create policy laundry_bookings_self_delete on public.laundry_bookings
  for delete using (tenant_profile_id = auth.uid());

-- Analog zu create_booking() oben: security-definer RPC statt direktem
-- Insert, damit "First come, first served" unter Nebenlaeufigkeit
-- tatsaechlich haelt (pg_advisory_xact_lock serialisiert konkurrierende
-- Eintragungen fuer denselben Objekt/Datum/Halbtag-Schluessel).
create or replace function public.create_laundry_booking(
  p_property_id uuid, p_booking_date date, p_period text
)
returns public.laundry_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_count int;
  v_unit_id uuid;
  result public.laundry_bookings;
begin
  if p_period not in ('vormittag', 'nachmittag') then
    raise exception 'Ungültiger Zeitraum.';
  end if;
  if p_booking_date < current_date then
    raise exception 'Datum liegt in der Vergangenheit.';
  end if;

  select laundry_machine_count into v_capacity
  from public.properties
  where id = p_property_id and laundry_mode = 'self_service';
  if v_capacity is null then
    raise exception 'Für dieses Objekt ist kein Waschplan-Kalender aktiv.';
  end if;

  select u.id into v_unit_id
  from public.units u
  join public.tenancies t on t.unit_id = u.id
  where u.property_id = p_property_id and t.tenant_profile_id = auth.uid()
    and t.status in ('active', 'upcoming')
  limit 1;

  if v_unit_id is null and not public.is_admin() then
    raise exception 'Sie sind keinem Mietverhältnis in diesem Objekt zugeordnet.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_property_id::text || p_booking_date::text || p_period));

  if exists (
    select 1 from public.laundry_bookings
    where property_id = p_property_id and booking_date = p_booking_date and period = p_period
      and tenant_profile_id = auth.uid()
  ) then
    raise exception 'Sie sind für diesen Zeitraum bereits eingetragen.';
  end if;

  select count(*) into v_count
  from public.laundry_bookings
  where property_id = p_property_id and booking_date = p_booking_date and period = p_period;

  if v_count >= v_capacity then
    raise exception 'Dieser Zeitraum ist bereits ausgebucht.';
  end if;

  insert into public.laundry_bookings (property_id, unit_id, tenant_profile_id, booking_date, period)
  values (p_property_id, v_unit_id, auth.uid(), p_booking_date, p_period)
  returning * into result;

  return result;
end;
$$;

-- Parkplatz als weitere Einheitstyp-Kachel ergänzt (gleiches Muster
-- wie Gastronomie oben) -- Check-Constraints lassen sich nicht per
-- ALTER TABLE aendern, deshalb droppen + mit erweitertem Wertebereich
-- neu anlegen.
alter table public.units drop constraint if exists units_unit_type_check;
alter table public.units add constraint units_unit_type_check
  check (unit_type in ('wohnung','garage','parkplatz','studio','lager','gewerbe','gastronomie','sonstiges'));

-- Firmenname zusaetzlich zu Vorname/Nachname (= Kontaktperson bei der
-- Firma) fuer Kontakte der Kategorie "firma". Nullable, da nur bei
-- dieser einen Kategorie relevant. handle_new_user() neu angelegt
-- (create or replace ist gefahrlos wiederholbar), damit auch per
-- admin-create-user eingeladene Firmen-Kontakte den Firmennamen aus
-- den Metadaten uebernehmen.
alter table public.profiles add column if not exists company_name text;

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
    id, member_number, category, status, email, phone,
    first_name, last_name, company_name, address_street, address_zip, address_city
  ) values (
    new.id,
    public.generate_member_number(safe_category),
    safe_category,
    'active',
    new.email,
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'address_street',
    new.raw_user_meta_data->>'address_zip',
    new.raw_user_meta_data->>'address_city'
  );
  return new;
end;
$$;

-- "Haus" als weitere Einheitstyp-Kachel ergaenzt (gleiches Muster wie
-- Parkplatz/Gastronomie oben) -- Check-Constraints lassen sich nicht
-- per ALTER TABLE aendern, deshalb droppen + mit erweitertem
-- Wertebereich neu anlegen.
alter table public.units drop constraint if exists units_unit_type_check;
alter table public.units add constraint units_unit_type_check
  check (unit_type in ('wohnung','haus','garage','parkplatz','studio','lager','gewerbe','gastronomie','sonstiges'));

-- ---------------------------------------------------------------------
-- Lesebestaetigung fuer Rundschreiben (property_announcements): eine
-- Zeile pro Nutzer, der eine Mitteilung geoeffnet hat. profiles.id ist
-- identisch mit auth.uid(), darum kann die RLS direkt darauf vergleichen.
-- ---------------------------------------------------------------------
create table public.property_announcement_reads (
  id               uuid primary key default gen_random_uuid(),
  announcement_id  uuid not null references public.property_announcements(id) on delete cascade,
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  read_at          timestamptz not null default now(),
  unique (announcement_id, profile_id)
);

alter table public.property_announcement_reads enable row level security;
alter table public.property_announcement_reads force row level security;

create policy property_announcement_reads_select on public.property_announcement_reads
  for select using (public.is_admin() or profile_id = auth.uid());

create policy property_announcement_reads_insert on public.property_announcement_reads
  for insert with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- Mietzins & Kaution direkt am Mietverhaeltnis (bisher stand der
-- Mietzins nur an der Einheit, was bei Mieterwechsel/-erhoehung keine
-- Historie zulaesst). tenancy_rent_changes haelt spaetere Anpassungen
-- (Index-/Staffelmiete) fest, damit die urspruengliche Miete beim
-- Einzug nachvollziehbar bleibt.
-- ---------------------------------------------------------------------
alter table public.tenancies add column if not exists rent_chf numeric(10,2);
alter table public.tenancies add column if not exists deposit_chf numeric(10,2);
alter table public.tenancies add column if not exists deposit_reference text;
alter table public.tenancies add column if not exists deposit_returned_at date;

create table public.tenancy_rent_changes (
  id              uuid primary key default gen_random_uuid(),
  tenancy_id      uuid not null references public.tenancies(id) on delete cascade,
  rent_chf        numeric(10,2) not null,
  effective_date  date not null,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id)
);

alter table public.tenancy_rent_changes enable row level security;
alter table public.tenancy_rent_changes force row level security;

create policy tenancy_rent_changes_select on public.tenancy_rent_changes
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.tenancies t
      where t.id = tenancy_rent_changes.tenancy_id
        and t.tenant_profile_id = auth.uid() and public.is_approved()
    )
  );

create policy tenancy_rent_changes_admin_write on public.tenancy_rent_changes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Owner-Reporting: aggregierte Mieteinnahmen/Kosten pro Objekt/Einheit
-- fuer die Eigentuemer-Rolle. Bewusst als SECURITY DEFINER-Funktion statt
-- direkter Tabellenzugriffe -- der Eigentuemer soll den TOTAL sehen,
-- nicht jede einzelne Mieter-Rechnung im Detail (RLS auf invoices bleibt
-- unveraendert restriktiv). "Kosten" = bezahlte Handwerker-/Schaden-
-- Rechnungen mit Bezug zum Objekt; das ist die einzige Kostenart, die
-- heute ueberhaupt strukturiert erfasst wird (kein Auftrags-Budget).
-- ---------------------------------------------------------------------
create or replace function public.get_owner_property_report(p_year int default null)
returns table (
  property_id    uuid,
  property_label text,
  unit_id        uuid,
  unit_label     text,
  income         numeric,
  costs          numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  yr int := coalesce(p_year, extract(year from current_date)::int);
begin
  if not public.is_approved() then
    return;
  end if;

  return query
  select
    coalesce(o.property_id, un.property_id) as property_id,
    prop.label as property_label,
    o.unit_id as unit_id,
    un.label as unit_label,
    coalesce((
      select sum(i.total) from public.invoices i
      where i.status = 'bezahlt' and i.category = 'miete'
        and extract(year from i.issue_date) = yr
        and (
          (o.unit_id is not null and i.unit_id = o.unit_id) or
          (o.unit_id is null and i.property_id = o.property_id)
        )
    ), 0) as income,
    coalesce((
      select sum(i.total) from public.invoices i
      where i.status = 'bezahlt' and i.category in ('schaden_reparatur','handwerkerrechnung')
        and extract(year from i.issue_date) = yr
        and (
          (o.unit_id is not null and i.unit_id = o.unit_id) or
          (o.unit_id is null and i.property_id = o.property_id)
        )
    ), 0) as costs
  from public.ownerships o
  left join public.units un on un.id = o.unit_id
  left join public.properties prop on prop.id = coalesce(o.property_id, un.property_id)
  where o.owner_profile_id = auth.uid()
    and (o.end_date is null or o.end_date >= current_date);
end;
$$;

grant execute on function public.get_owner_property_report(int) to authenticated;

-- ---------------------------------------------------------------------
-- Zwei weitere Telefonfelder pro Kontakt (z.B. Mobile + Festnetz +
-- Geschaeft) -- handle_new_user() neu definiert, damit auch per
-- admin-create-user eingeladene Kontakte alle drei direkt mitbekommen.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists phone2 text;
alter table public.profiles add column if not exists phone3 text;

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
    id, member_number, category, status, email, phone, phone2, phone3,
    first_name, last_name, company_name, address_street, address_zip, address_city
  ) values (
    new.id,
    public.generate_member_number(safe_category),
    safe_category,
    'active',
    new.email,
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'phone2',
    new.raw_user_meta_data->>'phone3',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'address_street',
    new.raw_user_meta_data->>'address_zip',
    new.raw_user_meta_data->>'address_city'
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Mehrfach-Kategorien pro Kontakt: eine Person kann z.B. gleichzeitig
-- Mieter UND Eigentuemer sein. profiles.category bleibt als "primaere"
-- Kategorie bestehen (Mitgliedsnummer-Praefix, is_admin()-Check,
-- Rechnungssteller-Default) -- profile_role_assignments ist die neue,
-- vollstaendige Quelle fuer "welchen Kategorien gehoert dieser Kontakt
-- an", genutzt von der Kontakte-Liste (mehrere Spalten pro Kontakt
-- moeglich). "admin" bleibt bewusst nie Teil dieser Zuordnung -- die
-- einzige Rolle, die nicht als Zusatzrolle vergeben wird.
-- Zusaetzlich zwei weitere Kontakt-E-Mails (email2/email3) neben der
-- bestehenden Login-Adresse profiles.email -- Supabase Auth kennt nur
-- eine Login-Mail pro Konto, darum bleiben das reine Kontaktfelder.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists email2 text;
alter table public.profiles add column if not exists email3 text;

-- Bis zu drei Adressen pro Kontakt. Die erste Adresse nutzt weiterhin
-- die bestehenden address_street/zip/city-Felder, damit bestehende
-- Rechnungs- und Anzeige-Logik unveraendert funktioniert.
alter table public.profiles add column if not exists address_type text;
alter table public.profiles add column if not exists address2_type text;
alter table public.profiles add column if not exists address2_street text;
alter table public.profiles add column if not exists address2_zip text;
alter table public.profiles add column if not exists address2_city text;
alter table public.profiles add column if not exists address3_type text;
alter table public.profiles add column if not exists address3_street text;
alter table public.profiles add column if not exists address3_zip text;
alter table public.profiles add column if not exists address3_city text;

create table if not exists public.profile_role_assignments (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  category    public.profile_category not null,
  primary key (profile_id, category)
);

alter table public.profile_role_assignments enable row level security;
alter table public.profile_role_assignments force row level security;

create policy profile_role_assignments_select on public.profile_role_assignments
  for select using (public.is_admin() or profile_id = auth.uid());

create policy profile_role_assignments_admin_write on public.profile_role_assignments
  for all using (public.is_admin()) with check (public.is_admin());

-- Einmaliges Backfill: jeder bestehende Kontakt behaelt seine bisherige
-- (einzige) Kategorie als erste Rollen-Zuordnung, damit die Kontakte-
-- Liste nach dem Update nahtlos weiter funktioniert.
insert into public.profile_role_assignments (profile_id, category)
select id, category from public.profiles
where category <> 'admin'
on conflict do nothing;

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

-- ---------------------------------------------------------------------
-- Einheitstypen deutlich erweitert (Reihenhaus, Doppelhaushaelfte,
-- Maisonette, Attika, Villa, Penthouse, Triplex, Dachwohnung,
-- Etagenwohnung, Loft, Einliegerwohnung, moeblierte Zimmer/Wohnungen,
-- Tiefgaragenplatz, Hobbyraum). "haus" -> "einfamilienhaus" und
-- "parkplatz" -> "aussenparkplatz" umbenannt -- bestehende Einheiten
-- zuerst migrieren, dann den Wertebereich der Check-Constraint ersetzen
-- (Check-Constraints lassen sich nicht per ALTER TABLE aendern, nur
-- droppen + neu anlegen, siehe gleiches Muster weiter oben).
-- ---------------------------------------------------------------------
update public.units set unit_type = 'einfamilienhaus' where unit_type = 'haus';
update public.units set unit_type = 'aussenparkplatz' where unit_type = 'parkplatz';

alter table public.units drop constraint if exists units_unit_type_check;
alter table public.units add constraint units_unit_type_check
  check (unit_type in (
    'wohnung','einfamilienhaus','reihenhaus','doppelhaushaelfte','villa','maisonette','attika',
    'penthouse','triplex','dachwohnung','etagenwohnung','loft','einliegerwohnung',
    'zimmer_moebliert','wohnung_moebliert','studio',
    'garage','tiefgaragenplatz','aussenparkplatz',
    'hobbyraum','lager','gewerbe','gastronomie','sonstiges'
  ));

-- ---------------------------------------------------------------------
-- Globaler E-Mail-Modus fuer Testphasen. Admins koennen im Vera Portal
-- zwischen "live" und "test" wechseln. Edge Functions pruefen diesen
-- Wert vor jedem Resend-Aufruf; im Testmodus werden Daten gespeichert,
-- aber keine echten E-Mails versendet.
-- ---------------------------------------------------------------------
create table if not exists public.portal_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (key ~ '^[a-z0-9_:-]+$')
);

alter table public.portal_settings enable row level security;
alter table public.portal_settings force row level security;

drop policy if exists portal_settings_admin_select on public.portal_settings;
drop policy if exists portal_settings_admin_write on public.portal_settings;
drop policy if exists portal_settings_public_homepage_select on public.portal_settings;
drop policy if exists portal_settings_authenticated_portal_ui_select on public.portal_settings;

create policy portal_settings_admin_select on public.portal_settings
  for select using (public.is_admin());

create policy portal_settings_public_homepage_select on public.portal_settings
  for select using (key in ('homepage_services', 'homepage_content'));

create policy portal_settings_authenticated_portal_ui_select on public.portal_settings
  for select using (auth.role() = 'authenticated' and key in ('portal_ui_settings', 'portal_dashboard_modules'));

create policy portal_settings_admin_write on public.portal_settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.portal_settings (key, value)
values ('outbound_email_mode', '{"mode":"live"}'::jsonb)
on conflict (key) do nothing;

insert into public.portal_settings (key, value)
values ('homepage_content', '{"de":{}}'::jsonb)
on conflict (key) do nothing;

insert into public.portal_settings (key, value)
values ('portal_ui_settings', '{"navItems":[]}'::jsonb)
on conflict (key) do nothing;

insert into public.portal_settings (key, value)
values ('portal_dashboard_modules', '{"modules":[]}'::jsonb)
on conflict (key) do nothing;

insert into public.portal_settings (key, value)
values ('homepage_services', '{
  "items": [
    {"key":"stockwerkeigentum","visible":true,"title":"Stockwerkeigentum","text":"Eigentümerversammlungen, Budgetierung, Jahresrechnungen, Unterhaltsplanung, Versicherungswesen.","badge":"Kernleistung"},
    {"key":"mietverwaltung","visible":true,"title":"Liegenschafts Verwaltung","text":"Mietermanagement, Inkasso, Nebenkostenabrechnungen, Unterhaltskoordination, Wiedervermietungen.","badge":"Kernleistung"},
    {"key":"erstvermietung","visible":true,"title":"Erstvermietung","text":"Mietzinsfestlegung, Vermarktung, Bonitätsprüfung, Vertragsabwicklung und Übergabe.","badge":"Kernleistung"},
    {"key":"bauleitung","visible":true,"title":"Bauleitung","text":"Ausschreibungen, Offertvergleiche, Terminplanung, Kostenkontrolle, Qualitätsüberwachung.","badge":""},
    {"key":"immobilienverkauf","visible":true,"title":"Immobilienverkauf","text":"Marktwertschätzung, Verkaufsstrategie, Vermarktung und Begleitung, in Kooperation mit erfahrener Maklerin.","badge":"Kooperation"},
    {"key":"projektentwicklung","visible":false,"title":"Projektentwicklung","text":"Machbarkeitsanalysen, Begleitung von Neubauprojekten, Koordination mit Behörden.","badge":"Aufbauphase"}
  ]
}'::jsonb)
on conflict (key) do nothing;
