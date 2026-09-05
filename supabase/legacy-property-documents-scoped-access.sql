-- Superseded by document-privacy.sql (filing and access are separate).
-- Run the complete document-privacy.sql migration, including storage guards.
do $$ begin
  if to_regprocedure('public.document_access_allowed(uuid)') is null then
    raise exception 'Bitte zuerst supabase/document-privacy.sql ausführen.';
  end if;
end $$;
