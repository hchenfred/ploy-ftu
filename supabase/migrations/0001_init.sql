-- Milestone 1: full schema for the Ploy FTU (all 5 tables + storage bucket).
-- Apply by pasting into the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- One onboarding run. `status` tracks the 3-step progress bar.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'site'
    check (status in ('site', 'goal', 'building', 'live')),
  goal_type text
    check (goal_type in ('local_customers', 'capture_and_follow_up', 'inbound_leads', 'paid_growth')),
  goal_label text,
  goal_custom_text text
);

-- What we know about the business, and where each fact came from
-- (field_sources: field -> 'scraped' | 'inferred' | 'asked').
create table if not exists business_profiles (
  session_id uuid primary key references sessions(id) on delete cascade,
  url text,
  name text,
  category text,
  summary text,
  brand jsonb not null default '{}',
  content jsonb not null default '{}',
  field_sources jsonb not null default '{}',
  suggested_goals jsonb,
  updated_at timestamptz not null default now()
);

-- The "first win": a page, inquiry form or ad set. Public once slug + published_at are set.
create table if not exists artifacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  type text not null check (type in ('page', 'inquiry_form', 'ad_creative')),
  goal_type text not null,
  data jsonb not null,
  image_paths text[] not null default '{}',
  slug text unique,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- Form entries from published pages (stands in for PloyDB).
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifacts(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- Append-only funnel log behind /metrics. Written by server code only, never by the LLM.
create table if not exists events (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  name text not null,
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists events_name_created_idx on events (name, created_at);
create index if not exists events_session_idx on events (session_id);

-- Lock everything down: no policies, so only the server (service role key) can read/write.
alter table sessions          enable row level security;
alter table business_profiles enable row level security;
alter table artifacts         enable row level security;
alter table submissions       enable row level security;
alter table events            enable row level security;

-- Private bucket for uploaded product photos and copies of fal images (used from Milestone 3).
insert into storage.buckets (id, name, public)
values ('assets', 'assets', false)
on conflict (id) do nothing;
