-- ─────────────────────────────────────────────────────────────
-- SignFlow — Supabase schema
-- Run in Supabase Dashboard → SQL Editor (idempotent).
-- All access goes through Next.js server routes using the service role key,
-- so RLS is enabled with NO public policies (anon/authenticated are denied).
-- ─────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

do $$ begin
  create type document_status as enum ('draft', 'pending_cosign', 'completed', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_event_type as enum ('created', 'sent', 'viewed', 'otp_verified', 'signed', 'completed');
exception when duplicate_object then null; end $$;

-- ── documents ────────────────────────────────────────────────
create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  ref_code          text not null unique,
  title             text not null,
  status            document_status not null default 'draft',
  signer1_name      text,
  signer1_email     text,
  signer2_name      text,
  signer2_email     text,
  sign_token        text not null unique,
  original_pdf_path text,
  final_pdf_path    text,
  stage1_sha256     text,
  final_sha256      text,
  stamp_config      jsonb,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists documents_stage1_sha256_idx on public.documents (stage1_sha256);
create index if not exists documents_final_sha256_idx  on public.documents (final_sha256);
create index if not exists documents_created_at_idx    on public.documents (created_at desc);

-- ── audit_events ─────────────────────────────────────────────
create table if not exists public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  event_type  audit_event_type not null,
  actor_email text,
  ip_address  text,
  user_agent  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_events_document_idx on public.audit_events (document_id, created_at);

-- ── otp_codes ────────────────────────────────────────────────
create table if not exists public.otp_codes (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  verified    boolean not null default false,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists otp_codes_document_idx on public.otp_codes (document_id, email, created_at desc);

-- ── Row Level Security (server routes use service_role → bypass) ──
alter table public.documents    enable row level security;
alter table public.audit_events enable row level security;
alter table public.otp_codes    enable row level security;

revoke all on public.documents    from anon, authenticated;
revoke all on public.audit_events from anon, authenticated;
revoke all on public.otp_codes    from anon, authenticated;

grant all on public.documents    to service_role;
grant all on public.audit_events to service_role;
grant all on public.otp_codes    to service_role;

-- ── Private storage bucket for PDFs & Team Roster JSON ──────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'application/json'])
on conflict (id) do update
  set allowed_mime_types = array['application/pdf', 'application/json'];

-- ── Housekeeping: purge expired OTP codes older than 1 day ────
create or replace function public.purge_expired_otps() returns void
language sql security invoker set search_path = public as $$
  delete from public.otp_codes where expires_at < now() - interval '1 day';
$$;
revoke all on function public.purge_expired_otps() from public, anon, authenticated;
grant execute on function public.purge_expired_otps() to service_role;
