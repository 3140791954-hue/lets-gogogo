create table if not exists public.app_users (
    id uuid primary key default gen_random_uuid(),
    username text not null,
    username_key text not null unique,
    password_hash text not null,
    data jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.app_users enable row level security;

-- No public policies are created. The server accesses this table only with
-- SUPABASE_SERVICE_ROLE_KEY, which must never be exposed in browser code.
