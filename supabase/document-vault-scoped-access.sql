-- =====================================================================
-- Vera Portal — Document Vault Scoped Access Hardening
-- Zweck:
--   Dokumente aus document_files/document-vault sind nicht nur ueber
--   explizite document_shares sichtbar, sondern auch fuer Nutzer, die
--   durch aktive Miete, aktuelle Eigentuemerschaft oder Hauswart-
--   Berechtigung zum Objekt/zur Einheit berechtigt sind.
--
-- Ausfuehren im Supabase SQL Editor.
-- Wiederholbar / idempotent.
-- =====================================================================

create or replace function public.can_access_document_scope(
  p_property_id uuid,
  p_unit_id uuid,
  p_contact_profile_id uuid,
  p_is_private_admin boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or (
      auth.uid() is not null
      and public.is_approved()
      and coalesce(p_is_private_admin, false) = false
      and (
        p_contact_profile_id = auth.uid()
        or (
          p_unit_id is not null
          and exists (
            select 1
            from public.tenancies t
            where t.unit_id = p_unit_id
              and t.tenant_profile_id = auth.uid()
              and t.status = 'active'
              and t.archived_at is null
          )
        )
        or (
          p_unit_id is not null
          and exists (
            select 1
            from public.ownerships o
            where o.unit_id = p_unit_id
              and o.owner_profile_id = auth.uid()
              and o.archived_at is null
              and (o.end_date is null or o.end_date >= current_date)
          )
        )
        or (
          p_unit_id is not null
          and exists (
            select 1
            from public.units u
            join public.property_permissions pp on pp.property_id = u.property_id
            where u.id = p_unit_id
              and pp.profile_id = auth.uid()
              and pp.permission = 'hauswart'
          )
        )
        or (
          p_property_id is not null
          and exists (
            select 1
            from public.units u
            join public.tenancies t on t.unit_id = u.id
            where u.property_id = p_property_id
              and u.archived_at is null
              and t.tenant_profile_id = auth.uid()
              and t.status = 'active'
              and t.archived_at is null
          )
        )
        or (
          p_property_id is not null
          and exists (
            select 1
            from public.ownerships o
            where o.owner_profile_id = auth.uid()
              and o.archived_at is null
              and (o.end_date is null or o.end_date >= current_date)
              and (
                o.property_id = p_property_id
                or o.unit_id in (
                  select u.id from public.units u
                  where u.property_id = p_property_id and u.archived_at is null
                )
              )
          )
        )
        or (
          p_property_id is not null
          and exists (
            select 1
            from public.property_permissions pp
            where pp.property_id = p_property_id
              and pp.profile_id = auth.uid()
              and pp.permission = 'hauswart'
          )
        )
      )
    );
$$;

create or replace function public.can_access_document_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.document_files f
    where f.id = p_file_id
      and f.archived_at is null
      and (
        exists (
          select 1 from public.document_shares ds
          where ds.file_id = f.id and ds.profile_id = auth.uid()
        )
        or public.can_access_document_scope(
          f.property_id,
          f.unit_id,
          f.contact_profile_id,
          f.is_private_admin
        )
      )
  );
$$;

create or replace function public.can_access_document_file_by_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.document_files f
    where f.file_path = p_path
      and f.archived_at is null
      and public.can_access_document_file(f.id)
  );
$$;

drop policy if exists document_files_scoped_select on public.document_files;
create policy document_files_scoped_select on public.document_files
  for select using (
    document_files.archived_at is null
    and (
      public.is_admin()
      or exists (
        select 1 from public.document_shares ds
        where ds.file_id = document_files.id and ds.profile_id = auth.uid()
      )
      or public.can_access_document_scope(
        document_files.property_id,
        document_files.unit_id,
        document_files.contact_profile_id,
        document_files.is_private_admin
      )
    )
  );

drop policy if exists storage_document_vault_select on storage.objects;
create policy storage_document_vault_select on storage.objects
  for select using (
    bucket_id = 'document-vault'
    and public.can_access_document_file_by_path(name)
  );

create or replace function public.get_my_shared_documents()
returns table(
  share_id uuid,
  file_id uuid,
  title text,
  file_path text,
  mime_type text,
  size_bytes bigint,
  needs_confirmation boolean,
  confirmed_at timestamptz,
  folder_path text,
  shared_at timestamptz
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
    select
      ds.id as s_id,
      df.id as f_id,
      df.title as f_title,
      df.file_path as f_path,
      df.mime_type as f_mime,
      df.size_bytes as f_size,
      coalesce(ds.needs_confirmation, false) as f_needs_confirmation,
      ds.confirmed_at as s_confirmed_at,
      df.folder_id as f_folder_id,
      coalesce(ds.created_at, df.created_at) as s_created_at
    from public.document_files df
    left join public.document_shares ds
      on ds.file_id = df.id and ds.profile_id = me
    where df.archived_at is null
      and (
        ds.id is not null
        or public.can_access_document_scope(
          df.property_id,
          df.unit_id,
          df.contact_profile_id,
          df.is_private_admin
        )
      )
    order by coalesce(ds.created_at, df.created_at) desc
  loop
    v_path := null;
    v_folder_id := r.f_folder_id;
    while v_folder_id is not null loop
      select name, parent_id into v_name, v_folder_id
      from public.document_folders
      where id = v_folder_id;
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
