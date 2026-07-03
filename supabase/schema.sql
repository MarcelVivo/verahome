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
  address_street   text,
  address_zip      text,
  address_city     text,
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
     or new.approved_by is distinct from old.approved_by then
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

alter table public.property_images         enable row level security;
alter table public.property_documents       enable row level security;
alter table public.property_document_access enable row level security;

alter table public.property_images         force row level security;
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
  );

create policy property_images_admin_write on public.property_images
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
