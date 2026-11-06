-- Ejecutar DESPUÉS de schema.sql. No modifica el snapshot compartido anterior.
alter table public.reto02_state drop constraint reto02_state_id_check;
alter table public.reto02_state add constraint reto02_state_id_check
check (id = 'demo' or id ~ '^v_[a-f0-9]{64}$');
grant insert (id,state,token_hash) on public.reto02_state to anon;
-- La fila demo solo resulta visible si se posee la capacidad real del backend.
-- Impide que un cliente se invente su propio token/hash para crear espacios.
create policy reto02_backend_insert on public.reto02_state for insert to anon
with check (id ~ '^v_[a-f0-9]{64}$' and token_hash =
  (select s.token_hash from public.reto02_state s where s.id='demo'));

create table public.reto02_limits (
 bucket text not null check (length(bucket) <= 160),
 window_start timestamptz not null,
 hits integer not null check (hits >= 1),
 token_hash text not null,
 primary key (bucket,window_start)
);
alter table public.reto02_limits enable row level security;
revoke all on public.reto02_limits from anon,authenticated;
grant select,insert,delete on public.reto02_limits to anon;
grant update (hits) on public.reto02_limits to anon;
create policy reto02_limits_read on public.reto02_limits for select to anon
using (token_hash = (select s.token_hash from public.reto02_state s where s.id='demo'));
create policy reto02_limits_insert on public.reto02_limits for insert to anon
with check (token_hash = (select s.token_hash from public.reto02_state s where s.id='demo'));
create policy reto02_limits_update on public.reto02_limits for update to anon
using (token_hash = (select s.token_hash from public.reto02_state s where s.id='demo'))
with check (token_hash = (select s.token_hash from public.reto02_state s where s.id='demo'));
create policy reto02_limits_cleanup on public.reto02_limits for delete to anon
using (window_start < now()-interval '2 days' and token_hash = (select s.token_hash from public.reto02_state s where s.id='demo'));

create function public.reto02_create_workspace(p_id text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare h text;
begin
 if p_id !~ '^v_[a-f0-9]{64}$' then raise exception 'Invalid workspace'; end if;
 select token_hash into h from public.reto02_state where id='demo' for update;
 if h is null then raise exception 'Unauthorized'; end if;
 if exists(select 1 from public.reto02_state where id=p_id) then return true; end if;
 if (select count(*) from public.reto02_state where id<>'demo') >= 50 then
   raise exception 'Demo workspace capacity reached';
 end if;
 insert into public.reto02_state(id,state,token_hash)
 values(p_id,'{"files":{},"sessions":[],"dailyTokens":0}',h);
 return true;
end; $$;
revoke all on function public.reto02_create_workspace(text) from public,anon,authenticated;
grant execute on function public.reto02_create_workspace(text) to anon;

create function public.reto02_take_rate(p_bucket text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare h text; w timestamptz; n integer;
begin
 if length(p_bucket)>160 or p_limit<1 or p_limit>1000000 or p_seconds not in (60,86400) then raise exception 'Invalid rate'; end if;
 select token_hash into h from public.reto02_state where id='demo';
 if h is null then raise exception 'Unauthorized'; end if;
 w := to_timestamp(floor(extract(epoch from now())/p_seconds)*p_seconds);
 delete from public.reto02_limits where window_start < now()-interval '2 days';
 insert into public.reto02_limits(bucket,window_start,hits,token_hash) values(p_bucket,w,1,h)
 on conflict(bucket,window_start) do update set hits=public.reto02_limits.hits+1
 returning hits into n;
 return n<=p_limit;
end; $$;
revoke all on function public.reto02_take_rate(text,integer,integer) from public,anon,authenticated;
grant execute on function public.reto02_take_rate(text,integer,integer) to anon;
