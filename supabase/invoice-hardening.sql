-- =====================================================================
-- Vera Portal — Rechnungen haerten
-- Zweck:
--   Rechnungen bleiben nachvollziehbar, archivierte Rechnungen sind fuer
--   normale Nutzer unsichtbar, Positionen koennen nur im Entwurf geaendert
--   werden, Senden/Stornieren laufen ueber kontrollierte RPC-Funktionen.
--
-- Ausfuehren im Supabase SQL Editor. Wiederholbar / idempotent.
-- =====================================================================

alter table public.invoices add column if not exists archived_at timestamptz;
alter table public.invoices add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.invoices add column if not exists archived_reason text;

create index if not exists invoices_archived_at_idx on public.invoices(archived_at);

create or replace function public.issue_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.invoices;
begin
  update public.invoices
  set status = 'offen'
  where id = p_invoice_id
    and status = 'entwurf'
    and archived_at is null
    and (issuer_profile_id = auth.uid() or public.is_admin())
  returning * into result;

  if result.id is null then
    raise exception 'Rechnung nicht gefunden, bereits gesendet oder keine Berechtigung.';
  end if;

  return result;
end;
$$;

create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text default null)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.invoices;
begin
  update public.invoices
  set status = 'storniert',
      note = case
        when nullif(trim(coalesce(p_reason, '')), '') is null then note
        when note is null or length(trim(note)) = 0 then 'Storno: ' || trim(p_reason)
        else note || E'\nStorno: ' || trim(p_reason)
      end
  where id = p_invoice_id
    and status in ('entwurf', 'offen')
    and archived_at is null
    and (issuer_profile_id = auth.uid() or public.is_admin())
  returning * into result;

  if result.id is null then
    raise exception 'Rechnung nicht gefunden, nicht stornierbar oder keine Berechtigung.';
  end if;

  return result;
end;
$$;

create or replace function public.archive_invoice(p_invoice_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.invoices
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Rechnung archiviert')
  where id = p_invoice_id
    and archived_at is null
    and status in ('entwurf', 'bezahlt', 'storniert')
    and (issuer_profile_id = auth.uid() or public.is_admin());

  if not found then
    raise exception 'Rechnung nicht gefunden, offene Rechnung nicht archivierbar oder keine Berechtigung.';
  end if;
end;
$$;

create or replace function public.mark_invoice_paid(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare result public.invoices;
begin
  update public.invoices
  set status = 'bezahlt', paid_at = now(), paid_by = auth.uid()
  where id = p_invoice_id
    and status = 'offen'
    and archived_at is null
    and (issuer_profile_id = auth.uid() or public.is_admin())
  returning * into result;

  if result.id is null then
    raise exception 'Rechnung nicht gefunden, bereits bezahlt oder keine Berechtigung.';
  end if;

  return result;
end;
$$;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select using (
    public.is_admin()
    or (
      archived_at is null
      and (issuer_profile_id = auth.uid() or recipient_profile_id = auth.uid())
    )
  );

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update using (
    public.is_admin()
    or (archived_at is null and issuer_profile_id = auth.uid() and public.is_approved())
  ) with check (
    public.is_admin()
    or (archived_at is null and issuer_profile_id = auth.uid() and public.is_approved())
  );

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete using (false);

drop policy if exists invoice_line_items_select on public.invoice_line_items;
create policy invoice_line_items_select on public.invoice_line_items
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and (
          public.is_admin()
          or (i.archived_at is null and (i.issuer_profile_id = auth.uid() or i.recipient_profile_id = auth.uid()))
        )
    )
  );

drop policy if exists invoice_line_items_write on public.invoice_line_items;
create policy invoice_line_items_write on public.invoice_line_items
  for all using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.archived_at is null
        and i.status = 'entwurf'
        and (public.is_admin() or (i.issuer_profile_id = auth.uid() and public.is_approved()))
    )
  ) with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.archived_at is null
        and i.status = 'entwurf'
        and (public.is_admin() or (i.issuer_profile_id = auth.uid() and public.is_approved()))
    )
  );

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'audit_table_change'
  ) then
    drop trigger if exists trg_audit_invoice_line_items on public.invoice_line_items;
    create trigger trg_audit_invoice_line_items
      after insert or update or delete on public.invoice_line_items
      for each row execute function public.audit_table_change();
  end if;
end;
$$;
