-- =====================================================================
-- Vera Portal — E-Signatur (DeepSign) fuer Dokumente aus dem
-- Dokumenten-Tresor (document_files).
-- Zweck:
--   Ein Admin waehlt ein bestehendes PDF im Dokumenten-Tresor aus und
--   schickt es ueber die DeepSign-API (api.sign.deepbox.swiss) an eine
--   oder mehrere Personen zur elektronischen Unterschrift. Der eigentliche
--   Signiervorgang findet bei DeepSign statt (E-Mail an die Signierenden);
--   dieses Schema haelt nur den Status/Verlauf im Portal nach.
--
--   Die eigentliche API-Anbindung sitzt in den Edge Functions
--   deepsign-create-request und deepsign-refresh-status (separat
--   deploybar, siehe supabase/functions/). Ohne konfigurierte
--   DEEPSIGN_*-Secrets in den Supabase Edge-Function-Settings bleiben
--   diese Tabellen leer -- das Schema hier ist unabhaengig davon sicher
--   anwendbar.
--
-- Ausfuehren im Supabase SQL Editor. Wiederholbar / idempotent.
-- =====================================================================

create table if not exists public.document_signature_requests (
  id                   uuid primary key default gen_random_uuid(),
  file_id              uuid not null references public.document_files(id) on delete cascade,
  deepsign_document_id text,
  status               text not null default 'draft',
  signature_mode       text not null default 'advanced',
  comment              text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz,
  error_message        text,
  constraint document_signature_requests_status_check
    check (status in ('draft', 'in_progress', 'signed', 'rejected', 'withdrawn', 'error')),
  constraint document_signature_requests_mode_check
    check (signature_mode in ('timestamp', 'advanced', 'qualified'))
);

create index if not exists document_signature_requests_file_idx
  on public.document_signature_requests(file_id);
create index if not exists document_signature_requests_deepsign_id_idx
  on public.document_signature_requests(deepsign_document_id);

create table if not exists public.document_signature_signees (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.document_signature_requests(id) on delete cascade,
  profile_id   uuid references public.profiles(id) on delete set null,
  email        text not null,
  sign_order   int,
  status       text not null default 'pending',
  signed_at    timestamptz,
  constraint document_signature_signees_status_check
    check (status in ('pending', 'signed', 'rejected'))
);

create index if not exists document_signature_signees_request_idx
  on public.document_signature_signees(request_id);

alter table public.document_signature_requests enable row level security;
alter table public.document_signature_requests force row level security;
alter table public.document_signature_signees enable row level security;
alter table public.document_signature_signees force row level security;

-- Admin-only fuer jetzt: das Anstossen/Verwalten von Signaturanfragen
-- bleibt Admin-Aufgabe, analog zu document_files_admin_all. Die
-- eigentliche Unterschrift geschieht ausserhalb des Portals (E-Mail von
-- DeepSign direkt an die signierende Person) -- ein Portal-Login der
-- Signierenden ist dafuer nicht noetig, daher (noch) keine
-- Self-Select-Policy fuer Signees.
drop policy if exists document_signature_requests_admin_all on public.document_signature_requests;
create policy document_signature_requests_admin_all on public.document_signature_requests
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists document_signature_signees_admin_all on public.document_signature_signees;
create policy document_signature_signees_admin_all on public.document_signature_signees
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_document_signature_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_document_signature_requests on public.document_signature_requests;
create trigger trg_touch_document_signature_requests
  before update on public.document_signature_requests
  for each row execute function public.touch_document_signature_requests_updated_at();

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'audit_table_change'
  ) then
    drop trigger if exists trg_audit_document_signature_requests on public.document_signature_requests;
    create trigger trg_audit_document_signature_requests
      after insert or update or delete on public.document_signature_requests
      for each row execute function public.audit_table_change();
  end if;
end;
$$;
