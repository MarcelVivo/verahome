-- =====================================================================
-- Vera Portal — Document Access Log
-- Zweck:
--   Jeder dokumentbezogene Oeffnen-/Download-Vorgang kann serverseitig
--   protokolliert werden. Admins sehen das Protokoll im Vera Portal.
--
-- Ausfuehren im Supabase SQL Editor.
-- Wiederholbar / idempotent.
-- =====================================================================

create table if not exists public.document_access_log (
  id                   uuid primary key default gen_random_uuid(),
  actor_id             uuid references public.profiles(id) on delete set null,
  bucket               text not null,
  file_path            text not null,
  action               text not null default 'open',
  document_file_id     uuid references public.document_files(id) on delete set null,
  property_document_id uuid references public.property_documents(id) on delete set null,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists document_access_log_actor_idx
  on public.document_access_log(actor_id, created_at desc);

create index if not exists document_access_log_file_idx
  on public.document_access_log(bucket, file_path, created_at desc);

alter table public.document_access_log enable row level security;
alter table public.document_access_log force row level security;

drop policy if exists document_access_log_admin_select on public.document_access_log;
create policy document_access_log_admin_select on public.document_access_log
  for select using (public.is_admin());

drop policy if exists document_access_log_self_insert on public.document_access_log;
create policy document_access_log_self_insert on public.document_access_log
  for insert with check (actor_id = auth.uid() or public.is_admin());

create or replace function public.log_document_access(
  p_bucket text,
  p_file_path text,
  p_action text default 'open'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_document_file_id uuid;
  v_property_document_id uuid;
  v_allowed boolean := false;
  v_id uuid;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
begin
  if v_actor is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if p_bucket = 'document-vault' then
    select id into v_document_file_id
    from public.document_files
    where file_path = p_file_path
      and archived_at is null
    limit 1;

    v_allowed := public.can_access_document_file_by_path(p_file_path);
  elsif p_bucket = 'property-documents' then
    select id into v_property_document_id
    from public.property_documents
    where file_path = p_file_path
    limit 1;

    v_allowed := public.can_access_property_document_by_path(p_file_path);
  else
    v_allowed := public.is_admin();
  end if;

  if not v_allowed then
    raise exception 'Keine Berechtigung fuer dieses Dokument.';
  end if;

  insert into public.document_access_log (
    actor_id,
    bucket,
    file_path,
    action,
    document_file_id,
    property_document_id,
    metadata
  ) values (
    v_actor,
    p_bucket,
    p_file_path,
    coalesce(nullif(p_action, ''), 'open'),
    v_document_file_id,
    v_property_document_id,
    jsonb_build_object('user_agent', v_headers ->> 'user-agent')
  ) returning id into v_id;

  return v_id;
end;
$$;
