-- READ ONLY. Run against the real project BEFORE and AFTER document-privacy.sql.
-- Inspect results locally; routine definitions can contain sensitive configuration.
select current_database(), current_user, now();
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'public' and c.relname in
  ('profiles','document_files','document_folders','document_shares','property_documents','property_document_access','documents'))
  or (n.nspname = 'storage' and c.relname = 'objects');
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where (schemaname = 'storage' and tablename = 'objects')
  or (schemaname = 'public' and tablename in
    ('document_files','document_folders','document_shares','property_documents','property_document_access','documents','profiles'))
order by schemaname, tablename, policyname;
select p.oid::regprocedure as routine, p.prosecdef, p.proacl, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (p.proname in ('is_admin','is_approved','complete_document','can_access_document_scope',
    'can_access_property_scope','can_access_document_file','can_access_document_file_by_path',
    'can_access_property_document','can_access_property_document_by_path','document_privacy_ready')
    or p.prosrc ~ '(document_files|document_shares|property_documents|documents|document_access_log|document_access_allowed)')
order by p.proname;
select id, public from storage.buckets where id in ('documents','document-vault','property-documents');
-- Review workload only: no broad grants are silently converted to personal ones.
select count(*) as active_files,
  count(*) filter(where not exists (select 1 from public.document_shares s where s.file_id = f.id)) as files_without_personal_grants,
  count(*) filter(where f.contact_profile_id is not null) as contact_filings
from public.document_files f where f.archived_at is null;
select visibility, count(*) from public.property_documents group by visibility;
select file_path, count(*) from public.document_files group by file_path having count(*) > 1;
