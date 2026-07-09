-- =====================================================================
-- Vera Portal — Legacy Property Documents Scoped Access Hardening
-- Zweck:
--   Alte Objekt-Dokumente (property_documents / property-documents)
--   und Rundschreiben werden serverseitig nur fuer Admins oder objekt-
--   berechtigte Nutzer sichtbar.
--
-- Wichtig:
--   property_documents.visibility = 'public' bedeutet danach NICHT mehr
--   global oeffentlich, sondern fuer alle berechtigten Personen der
--   Liegenschaft sichtbar.
--
-- Ausfuehren im Supabase SQL Editor.
-- Wiederholbar / idempotent.
-- =====================================================================

create or replace function public.can_access_property_scope(p_property_id uuid)
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
      and p_property_id is not null
      and (
        exists (
          select 1
          from public.units u
          join public.tenancies t on t.unit_id = u.id
          where u.property_id = p_property_id
            and u.archived_at is null
            and t.tenant_profile_id = auth.uid()
            and t.status = 'active'
            and t.archived_at is null
        )
        or exists (
          select 1
          from public.ownerships o
          where o.owner_profile_id = auth.uid()
            and o.archived_at is null
            and (o.end_date is null or o.end_date >= current_date)
            and (
              o.property_id = p_property_id
              or o.unit_id in (
                select u.id
                from public.units u
                where u.property_id = p_property_id
                  and u.archived_at is null
              )
            )
        )
        or exists (
          select 1
          from public.property_permissions pp
          where pp.property_id = p_property_id
            and pp.profile_id = auth.uid()
            and pp.permission = 'hauswart'
        )
      )
    );
$$;

create or replace function public.can_access_property_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.property_documents pd
    where pd.id = p_document_id
      and (
        (pd.visibility = 'public' and public.can_access_property_scope(pd.property_id))
        or exists (
          select 1
          from public.property_document_access pda
          where pda.property_document_id = pd.id
            and pda.profile_id = auth.uid()
            and public.is_approved()
        )
        or public.has_property_permission(pd.property_id, 'hauswart')
      )
  );
$$;

create or replace function public.can_access_property_document_by_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.property_documents pd
    where pd.file_path = p_path
      and public.can_access_property_document(pd.id)
  );
$$;

drop policy if exists property_documents_select on public.property_documents;
drop policy if exists property_documents_select_hauswart on public.property_documents;
drop policy if exists property_documents_select_scoped on public.property_documents;
create policy property_documents_select_scoped on public.property_documents
  for select using (
    public.is_admin()
    or (
      property_documents.visibility = 'public'
      and public.can_access_property_scope(property_documents.property_id)
    )
    or exists (
      select 1
      from public.property_document_access pda
      where pda.property_document_id = property_documents.id
        and pda.profile_id = auth.uid()
        and public.is_approved()
    )
    or public.has_property_permission(property_documents.property_id, 'hauswart')
  );

drop policy if exists storage_property_documents_select on storage.objects;
drop policy if exists storage_property_documents_select_hauswart on storage.objects;
drop policy if exists storage_property_documents_select_scoped on storage.objects;
create policy storage_property_documents_select_scoped on storage.objects
  for select using (
    bucket_id = 'property-documents'
    and public.can_access_property_document_by_path(name)
  );

drop policy if exists property_announcements_select on public.property_announcements;
drop policy if exists property_announcements_select_hauswart on public.property_announcements;
drop policy if exists property_announcements_select_scoped on public.property_announcements;
create policy property_announcements_select_scoped on public.property_announcements
  for select using (
    property_announcements.archived_at is null
    and public.can_access_property_scope(property_announcements.property_id)
  );
