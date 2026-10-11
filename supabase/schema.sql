-- Nexo: schema do Supabase. Rode no SQL Editor do seu projeto.
create table if not exists nexo_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at timestamptz default now()
);
create table if not exists nexo_team_members (
  team_id uuid references nexo_teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (team_id, user_id)
);
create table if not exists nexo_records (
  team_id uuid references nexo_teams(id) on delete cascade,
  kind text not null check (kind in ('contact','template')),
  id text not null,
  data jsonb not null,
  updated_at bigint not null,          -- relógio do cliente (desempate last-write-wins)
  updated_by uuid default auth.uid(),
  server_ts timestamptz not null default clock_timestamp(),  -- cursor de pull
  primary key (team_id, kind, id)
);
create index if not exists nexo_records_pull on nexo_records (team_id, server_ts);

-- Last-write-wins: uma escrita mais antiga nunca sobrescreve uma mais nova
create or replace function nexo_lww() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then return old; end if;
  new.server_ts := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists nexo_lww on nexo_records;
create trigger nexo_lww before insert or update on nexo_records for each row execute function nexo_lww();

create or replace function nexo_is_member(t uuid) returns boolean language sql security definer stable
set search_path = public as $$ select exists (select 1 from nexo_team_members where team_id = t and user_id = auth.uid()) $$;

alter table nexo_teams enable row level security;
alter table nexo_team_members enable row level security;
alter table nexo_records enable row level security;
create policy "membros leem equipe" on nexo_teams for select using (nexo_is_member(id));
create policy "membros leem membros" on nexo_team_members for select using (nexo_is_member(team_id));
create policy "membros leem registros" on nexo_records for select using (nexo_is_member(team_id));
create policy "membros inserem registros" on nexo_records for insert with check (nexo_is_member(team_id));
create policy "membros atualizam registros" on nexo_records for update using (nexo_is_member(team_id)) with check (nexo_is_member(team_id));

-- Entrar em equipes só via estas funções (o código de convite é o segredo)
create or replace function nexo_create_team(team_name text) returns setof nexo_teams
language plpgsql security definer set search_path = public as $$
declare t nexo_teams;
begin
  if auth.uid() is null then raise exception 'login necessário'; end if;
  insert into nexo_teams(name) values (team_name) returning * into t;
  insert into nexo_team_members values (t.id, auth.uid());
  return next t;
end $$;

create or replace function nexo_join_team(code text) returns setof nexo_teams
language plpgsql security definer set search_path = public as $$
declare t nexo_teams;
begin
  if auth.uid() is null then raise exception 'login necessário'; end if;
  select * into t from nexo_teams where invite_code = code;
  if not found then raise exception 'código de convite inválido'; end if;
  insert into nexo_team_members values (t.id, auth.uid()) on conflict do nothing;
  return next t;
end $$;
