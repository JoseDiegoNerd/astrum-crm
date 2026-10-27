-- Ambiente mínimo do Supabase para rodar as migrations no PGlite (sem Docker).
-- Reproduz só o que as migrations usam: papéis, auth.users e auth.uid()/auth.jwt().
-- No CI os mesmos testes também rodam contra o Postgres real do `supabase start`.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                  uuid primary key,
  email               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  raw_app_meta_data   jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
