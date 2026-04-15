create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  endpoint text not null unique,
  auth text not null,
  p256dh text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_business_idx on public.push_subscriptions (business_id);

create or replace function public.set_push_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_push_subscriptions_updated_at on public.push_subscriptions;
create trigger trg_push_subscriptions_updated_at
before update on public.push_subscriptions
for each row
execute function public.set_push_subscriptions_updated_at();

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
on public.push_subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = push_subscriptions.business_id
      and b.owner_id = auth.uid()
  )
);

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
on public.push_subscriptions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = push_subscriptions.business_id
      and b.owner_id = auth.uid()
  )
);

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
on public.push_subscriptions
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = push_subscriptions.business_id
      and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = push_subscriptions.business_id
      and b.owner_id = auth.uid()
  )
);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
on public.push_subscriptions
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = push_subscriptions.business_id
      and b.owner_id = auth.uid()
  )
);

