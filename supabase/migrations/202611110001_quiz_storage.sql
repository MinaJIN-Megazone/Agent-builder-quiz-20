create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.quiz_settings (
  singleton boolean primary key default true check (singleton),
  event_ends_at timestamptz,
  retention_days integer not null default 7 check (retention_days between 1 and 90)
);

insert into private.quiz_settings (singleton, event_ends_at, retention_days)
values (true, null, 7)
on conflict (singleton) do nothing;

create table if not exists private.quiz_participants (
  id uuid primary key default gen_random_uuid(),
  full_name varchar(60) not null check (char_length(btrim(full_name)) between 1 and 60),
  department varchar(80) not null check (char_length(btrim(department)) between 1 and 80),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists private.quiz_results (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references private.quiz_participants(id) on delete cascade,
  score integer not null check (score between 0 and 1000),
  duration_ms integer not null check (duration_ms >= 0),
  submitted_at timestamptz not null default clock_timestamp()
);

alter table private.quiz_settings enable row level security;
alter table private.quiz_participants enable row level security;
alter table private.quiz_results enable row level security;

revoke all on table private.quiz_settings, private.quiz_participants, private.quiz_results from public, anon, authenticated;
grant all on table private.quiz_settings, private.quiz_participants, private.quiz_results to service_role;

create or replace function public.start_quiz(_name text, _department text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant_id uuid;
  v_created_at timestamptz;
  v_event_ends_at timestamptz;
begin
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(_name, ''))) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;

  if pg_catalog.char_length(pg_catalog.btrim(coalesce(_department, ''))) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'invalid_department';
  end if;

  select event_ends_at into v_event_ends_at
  from private.quiz_settings
  where singleton = true;

  if v_event_ends_at is not null and pg_catalog.clock_timestamp() >= v_event_ends_at then
    raise exception using errcode = 'P0001', message = 'event_closed';
  end if;

  insert into private.quiz_participants (full_name, department)
  values (pg_catalog.btrim(_name), pg_catalog.btrim(_department))
  returning id, created_at into v_participant_id, v_created_at;

  return pg_catalog.jsonb_build_object('participant_id', v_participant_id, 'started_at', v_created_at);
end;
$$;

create or replace function public.submit_quiz(
  _participant_id uuid,
  _answers jsonb,
  _answer_key integer[],
  _points integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant private.quiz_participants%rowtype;
  v_event_ends_at timestamptz;
  v_score integer := 0;
  v_correct_count integer := 0;
  v_answer integer;
  v_correctness jsonb := '[]'::jsonb;
  v_submitted_at timestamptz;
  i integer;
begin
  if pg_catalog.jsonb_typeof(_answers) is distinct from 'array'
    or pg_catalog.jsonb_array_length(_answers) <> 20
    or coalesce(pg_catalog.array_length(_answer_key, 1), 0) <> 20
    or coalesce(pg_catalog.array_length(_points, 1), 0) <> 20 then
    raise exception using errcode = 'P0001', message = 'invalid_answers';
  end if;

  if (select coalesce(sum(point_value), 0) from pg_catalog.unnest(_points) as point_values(point_value)) <> 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_scoring_config';
  end if;

  for i in 1..20 loop
    if _answer_key[i] not between 0 and 3 or _points[i] not between 20 and 140 then
      raise exception using errcode = 'P0001', message = 'invalid_scoring_config';
    end if;

    if pg_catalog.jsonb_typeof(_answers -> (i - 1)) is distinct from 'number' then
      raise exception using errcode = 'P0001', message = 'invalid_answers';
    end if;

    v_answer := (_answers ->> (i - 1))::integer;
    if v_answer not between 0 and 3 then
      raise exception using errcode = 'P0001', message = 'invalid_answers';
    end if;

    if v_answer = _answer_key[i] then
      v_score := v_score + _points[i];
      v_correct_count := v_correct_count + 1;
      v_correctness := v_correctness || 'true'::jsonb;
    else
      v_correctness := v_correctness || 'false'::jsonb;
    end if;
  end loop;

  select event_ends_at into v_event_ends_at
  from private.quiz_settings
  where singleton = true;

  if v_event_ends_at is not null and pg_catalog.clock_timestamp() >= v_event_ends_at then
    raise exception using errcode = 'P0001', message = 'event_closed';
  end if;

  select * into v_participant
  from private.quiz_participants
  where id = _participant_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'participant_not_found';
  end if;

  v_submitted_at := pg_catalog.clock_timestamp();
  insert into private.quiz_results (participant_id, score, duration_ms, submitted_at)
  values (
    v_participant.id,
    v_score,
    greatest(0, (extract(epoch from (v_submitted_at - v_participant.created_at)) * 1000)::integer),
    v_submitted_at
  );

  return pg_catalog.jsonb_build_object(
    'score', v_score,
    'correct_count', v_correct_count,
    'correctness', v_correctness,
    'correct_answers', _answer_key,
    'submitted_at', v_submitted_at,
    'duration_ms', greatest(0, (extract(epoch from (v_submitted_at - v_participant.created_at)) * 1000)::integer)
  );
end;
$$;

create or replace function public.get_public_leaderboard()
returns table (rank bigint, name text, score integer, submitted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.row_number() over (order by r.score desc, r.submitted_at asc, r.id asc),
    p.full_name::text,
    r.score,
    r.submitted_at
  from private.quiz_results as r
  join private.quiz_participants as p on p.id = r.participant_id
  order by r.score desc, r.submitted_at asc, r.id asc;
$$;

create or replace function public.cleanup_expired_quiz_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_ends_at timestamptz;
  v_retention_days integer;
  v_deleted integer;
begin
  select event_ends_at, retention_days into v_event_ends_at, v_retention_days
  from private.quiz_settings
  where singleton = true;

  if v_event_ends_at is null
    or pg_catalog.clock_timestamp() < v_event_ends_at + pg_catalog.make_interval(days => v_retention_days) then
    return 0;
  end if;

  delete from private.quiz_participants;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.start_quiz(text, text) from public, anon, authenticated;
revoke all on function public.submit_quiz(uuid, jsonb, integer[], integer[]) from public, anon, authenticated;
revoke all on function public.get_public_leaderboard() from public, anon, authenticated;
revoke all on function public.cleanup_expired_quiz_data() from public, anon, authenticated;

grant execute on function public.start_quiz(text, text) to service_role;
grant execute on function public.submit_quiz(uuid, jsonb, integer[], integer[]) to service_role;
grant execute on function public.get_public_leaderboard() to service_role;
grant execute on function public.cleanup_expired_quiz_data() to service_role;