-- Nexo: schema do servidor próprio (PostgreSQL 14+). Idempotente: o servidor aplica no boot.
create extension if not exists pgcrypto;

create table if not exists nexo_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists nexo_sessions (
  token_hash text primary key,              -- sha256 do token; o token em si nunca é guardado
  user_id uuid not null references nexo_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists nexo_sessions_user on nexo_sessions(user_id);

create table if not exists nexo_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists nexo_team_members (
  team_id uuid not null references nexo_teams(id) on delete cascade,
  user_id uuid not null references nexo_users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create sequence if not exists nexo_records_seq;
create table if not exists nexo_records (
  team_id uuid not null references nexo_teams(id) on delete cascade,
  kind text not null check (kind in ('contact','template')),
  id text not null,
  data jsonb not null,
  updated_at bigint not null,               -- relógio do cliente: desempate last-write-wins
  updated_by uuid references nexo_users(id) on delete set null,
  seq bigint not null default nextval('nexo_records_seq'),  -- cursor de pull (ordem de commit por equipe)
  primary key (team_id, kind, id)
);
create index if not exists nexo_records_pull on nexo_records(team_id, seq);
