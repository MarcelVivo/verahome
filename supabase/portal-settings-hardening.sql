-- =====================================================================
-- Vera Portal Hardening — Portal-Editor nur fuer den Owner-Admin,
-- kontrolliertes Speichern von Portal-Einstellungen und Audit-Log.
-- =====================================================================

create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  entity_table text,
  entity_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_log_admin_select on public.audit_log;
drop policy if exists audit_log_system_insert on public.audit_log;

create policy audit_log_admin_select on public.audit_log
  for select using (public.is_admin());

create policy audit_log_system_insert on public.audit_log
  for insert with check (public.is_admin());

create or replace function public.is_portal_owner_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.category = 'admin'
      and lower(p.email) = 'kontakt@marcelspahr.ch'
      and p.status = 'active'
  );
$$;

create or replace function public.can_write_portal_setting(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_key in ('portal_ui_settings', 'portal_dashboard_modules')
      then public.is_portal_owner_admin()
    when p_key in ('outbound_email_mode', 'homepage_content', 'homepage_services')
      then public.is_admin()
    else public.is_admin()
  end;
$$;

create or replace function public.set_portal_setting(p_key text, p_value jsonb)
returns public.portal_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.portal_settings;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if not public.can_write_portal_setting(p_key) then
    raise exception 'Keine Berechtigung fuer diese Einstellung.';
  end if;

  insert into public.portal_settings (key, value, updated_by, updated_at)
  values (p_key, coalesce(p_value, '{}'::jsonb), auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
  returning * into result;

  insert into public.audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (
    auth.uid(),
    'portal_setting.updated',
    'portal_settings',
    p_key,
    jsonb_build_object('key', p_key)
  );

  return result;
end;
$$;

drop policy if exists portal_settings_admin_write on public.portal_settings;
drop policy if exists portal_settings_guarded_write on public.portal_settings;

create policy portal_settings_guarded_write on public.portal_settings
  for all
  using (public.can_write_portal_setting(key))
  with check (public.can_write_portal_setting(key));
