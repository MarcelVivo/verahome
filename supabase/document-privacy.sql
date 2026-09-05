-- Vera Portal: filing is NOT an access grant. Apply after existing migrations.
-- Idempotent. No files, assignments or explicit grants are removed.
begin;

-- Archived accounts must not retain admin mutations or approved-user privileges.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid()
    and category = 'admin' and status = 'active' and archived_at is null);
$$;
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid()
    and status = 'active' and archived_at is null);
$$;

-- This internal predicate is shared by RLS, storage and the admin reader list.
create or replace function public.document_reader_allowed(p_file_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.status = 'active' and p.archived_at is null
    and (p.category = 'admin' or exists (
      select 1 from public.document_files f
      join public.document_shares s on s.file_id = f.id
      where f.id = p_file_id and f.archived_at is null and s.profile_id = p.id
    ))
  );
$$;
revoke all on function public.document_reader_allowed(uuid, uuid) from public, anon, authenticated;

create or replace function public.document_access_allowed(p_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.document_reader_allowed(p_file_id, auth.uid());
$$;

create or replace function public.can_access_document_file(p_file_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.document_access_allowed(p_file_id);
$$;

create or replace function public.can_access_document_file_by_path(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.document_access_allowed(null) or exists (
    select 1 from public.document_files f
    where f.file_path = p_path and public.document_access_allowed(f.id)
  );
$$;

-- Compatibility with older callers: neither contact nor building grants access.
create or replace function public.can_access_document_scope(
  p_property_id uuid, p_unit_id uuid, p_contact_profile_id uuid, p_is_private_admin boolean
)
returns boolean language sql stable security definer set search_path = public as $$
  select public.document_access_allowed(null);
$$;

alter table public.document_files enable row level security;
drop policy if exists document_files_privacy_guard on public.document_files;
create policy document_files_privacy_guard on public.document_files as restrictive
  for select using (public.document_access_allowed(id));
drop policy if exists document_files_explicit_read on public.document_files;
create policy document_files_explicit_read on public.document_files
  for select using (public.document_access_allowed(id));

-- Restrictive guards also constrain legacy permissive policies (combined by OR).
drop policy if exists document_shares_privacy_guard on public.document_shares;
create policy document_shares_privacy_guard on public.document_shares as restrictive
  for select using (public.document_access_allowed(null) or
    (profile_id = auth.uid() and public.document_access_allowed(file_id)));

create or replace function public.get_my_shared_documents()
returns table(
  share_id uuid, file_id uuid, title text, file_path text, mime_type text,
  size_bytes bigint, needs_confirmation boolean, confirmed_at timestamptz,
  folder_path text, shared_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, f.id, f.title, f.file_path, f.mime_type, f.size_bytes,
    s.needs_confirmation, s.confirmed_at, ''::text, s.created_at
  from public.document_shares s join public.document_files f on f.id = s.file_id
  where s.profile_id = auth.uid() and f.archived_at is null
    and public.document_access_allowed(f.id)
  order by s.created_at desc;
$$;
-- Internal folder names may contain other people's personal data; don't expose them.

create or replace function public.confirm_document_share(p_share_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.document_shares s set confirmed_at = now()
  where s.id = p_share_id and s.profile_id = auth.uid() and s.confirmed_at is null
    and public.document_access_allowed(s.file_id);
end;
$$;

create or replace function public.get_document_readers(p_file_id uuid)
returns table(profile_id uuid, display_name text, reason text, can_read boolean, has_share boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.document_access_allowed(null) then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  if not exists (select 1 from public.document_files where id = p_file_id) then
    raise exception 'Dokument nicht gefunden.';
  end if;
  return query
    select p.id, trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')),
      case when p.category = 'admin' and p.status = 'active' and p.archived_at is null
        then 'Verwaltung' else 'Persönliche Freigabe' end,
      public.document_reader_allowed(p_file_id, p.id),
      exists (select 1 from public.document_shares s where s.file_id = p_file_id and s.profile_id = p.id)
    from public.profiles p
    where (p.category = 'admin' and p.status = 'active' and p.archived_at is null)
      or exists (select 1 from public.document_shares s where s.file_id = p_file_id and s.profile_id = p.id)
    order by p.last_name, p.first_name, p.id;
end;
$$;

create or replace function public.revoke_document_reader(p_file_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.document_access_allowed(null) then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  perform 1 from public.document_files where id = p_file_id for update;
  delete from public.document_shares where file_id = p_file_id and profile_id = p_profile_id;
end;
$$;

-- Replacing a personal grant is atomic; errors retain the previous permissions.
create or replace function public.replace_document_readers(p_file_id uuid, p_profile_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.document_access_allowed(null) then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  perform 1 from public.document_files where id = p_file_id and archived_at is null for update;
  if not found then raise exception 'Dokument nicht gefunden oder archiviert.'; end if;
  if p_profile_ids is null or exists (
    select 1 from unnest(p_profile_ids) recipient
    where not exists (select 1 from public.profiles p where p.id = recipient and p.status = 'active' and p.archived_at is null)
  ) then raise exception 'Bitte aktive Kontakte auswählen.'; end if;
  delete from public.document_shares where file_id = p_file_id and not (profile_id = any(p_profile_ids));
  insert into public.document_shares(file_id, profile_id, created_by, needs_confirmation)
    select p_file_id, recipient, auth.uid(), false from unnest(p_profile_ids) recipient
    on conflict (file_id, profile_id) do nothing;
end;
$$;

-- Legacy house information: public means current members of THIS property.
-- A restricted legacy document still requires an explicit personal grant.
create or replace function public.can_access_property_scope(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.document_access_allowed(null) or exists (
    select 1 from public.profiles p where p.id = auth.uid()
    and p.status = 'active' and p.archived_at is null and (
      exists (select 1 from public.units u join public.tenancies t on t.unit_id = u.id
        where u.property_id = p_property_id and u.archived_at is null
        and t.tenant_profile_id = p.id and t.status = 'active' and t.archived_at is null
        and t.start_date <= current_date and (t.end_date is null or t.end_date >= current_date))
      or exists (select 1 from public.ownerships o where o.owner_profile_id = p.id
        and o.archived_at is null and o.start_date <= current_date
        and (o.end_date is null or o.end_date >= current_date)
        and ((o.property_id = p_property_id and o.unit_id is null) or exists (
          select 1 from public.units u where u.id = o.unit_id and u.property_id = p_property_id and u.archived_at is null)))
      or exists (select 1 from public.property_permissions pp where pp.property_id = p_property_id
        and pp.profile_id = p.id and pp.permission = 'hauswart')
    )
  );
$$;

create or replace function public.property_document_access_allowed(p_document_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.document_access_allowed(null) or exists (
    select 1 from public.property_documents d join public.profiles p on p.id = auth.uid()
    where d.id = p_document_id and p.status = 'active' and p.archived_at is null
    and ((d.visibility = 'public' and public.can_access_property_scope(d.property_id))
      or exists (select 1 from public.property_document_access a
        where a.property_document_id = d.id and a.profile_id = p.id))
  );
$$;
create or replace function public.can_access_property_document(p_document_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.property_document_access_allowed(p_document_id);
$$;
create or replace function public.can_access_property_document_by_path(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.document_access_allowed(null) or exists (
    select 1 from public.property_documents d where d.file_path = p_path
    and public.property_document_access_allowed(d.id)
  );
$$;
drop policy if exists property_documents_privacy_guard on public.property_documents;
create policy property_documents_privacy_guard on public.property_documents as restrictive
  for select using (public.property_document_access_allowed(id));
drop policy if exists property_documents_explicit_read on public.property_documents;
create policy property_documents_explicit_read on public.property_documents
  for select using (public.property_document_access_allowed(id));

-- Guard all three document buckets; unrelated storage policies remain unchanged.
create or replace function public.document_storage_access_allowed(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_bucket
    when 'document-vault' then public.document_access_allowed(null) or exists (
      select 1 from public.document_files f where f.file_path = p_path and public.document_access_allowed(f.id))
    when 'property-documents' then public.document_access_allowed(null) or exists (
      select 1 from public.property_documents d where d.file_path = p_path and public.property_document_access_allowed(d.id))
    when 'documents' then public.document_access_allowed(null) or exists (
      select 1 from public.documents d join public.profiles p on p.id = d.owner_profile_id
      where d.file_path = p_path and p.id = auth.uid() and p.status = 'active' and p.archived_at is null)
    else true end;
$$;
drop policy if exists storage_documents_privacy_guard on storage.objects;
create policy storage_documents_privacy_guard on storage.objects as restrictive
  for select using (public.document_storage_access_allowed(bucket_id, name));

update storage.buckets set public = false where id in ('documents', 'document-vault', 'property-documents');

-- Frontend rollout gate: no confidential uploads/shares before DB activation.
create or replace function public.document_privacy_ready()
returns boolean language sql stable security definer set search_path = public as $$
  select public.document_access_allowed(null)
    and (select count(*) = 3 from storage.buckets
      where id in ('documents','document-vault','property-documents') and not public)
    and not exists (
      select 1 from (values
        ('public','document_files','document_files_privacy_guard'),
        ('public','property_documents','property_documents_privacy_guard'),
        ('storage','objects','storage_documents_privacy_guard')
      ) required(schema_name, table_name, policy_name)
      where not exists (select 1 from pg_policies p
        where p.schemaname = required.schema_name and p.tablename = required.table_name
          and p.policyname = required.policy_name and p.permissive = 'RESTRICTIVE')
    )
    and (select bool_and(c.relrowsecurity) from pg_class c
      where c.oid in ('public.document_files'::regclass, 'public.property_documents'::regclass, 'storage.objects'::regclass));
$$;
notify pgrst, 'reload schema';
commit;
