-- Estado durable del entorno ficticio del reto. El token se configura fuera del código.
create table public.reto02_state (
 id text primary key check (id = 'demo'),
 state jsonb not null default '{"files":{},"sessions":[],"dailyTokens":0}',
 version bigint not null default 0 check (version >= 0),
 token_hash text not null check (length(token_hash)=64),
 lock_owner uuid,
 locked_until timestamptz,
 updated_at timestamptz not null default now(),
 check (jsonb_typeof(state)='object')
);
alter table public.reto02_state enable row level security;
revoke all on public.reto02_state from anon, authenticated;
grant select on public.reto02_state to anon;
grant update (state,version,lock_owner,locked_until,updated_at) on public.reto02_state to anon;
-- Capacidad de 256 bits que solo tiene el backend. Sin la cabecera, no hay filas accesibles.
create policy reto02_backend_read on public.reto02_state for select to anon
using (token_hash = encode(sha256(convert_to(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-reto-token',''),'UTF8')),'hex'));
create policy reto02_backend_write on public.reto02_state for update to anon
using (token_hash = encode(sha256(convert_to(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-reto-token',''),'UTF8')),'hex'))
with check (token_hash = encode(sha256(convert_to(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-reto-token',''),'UTF8')),'hex'));

create view public.reto02_contracts with (security_invoker=true) as
select c->>'id_contrato' as id_contrato,c->>'cliente' as cliente,c->>'nit_cliente' as nit_cliente,
       nullif(c->>'valor','')::numeric as valor,c->>'moneda' as moneda,
       nullif(c->>'fecha_fin','')::date as fecha_fin,c as datos
from public.reto02_state s cross join lateral jsonb_array_elements(coalesce(s.state->'contracts','[]')) c;
create view public.reto02_documents with (security_invoker=true) as
select f.key as ruta,f.value as contenido
from public.reto02_state s cross join lateral jsonb_each_text(coalesce(s.state->'files','{}')) f
where f.key like 'sharepoint/Contratos/%';
revoke all on public.reto02_contracts,public.reto02_documents from anon,authenticated;
grant select on public.reto02_contracts,public.reto02_documents to anon;
