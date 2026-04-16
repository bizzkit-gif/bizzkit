-- Likes on posts (skip errors if your project already created this in the dashboard)
create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, business_id)
);

create index if not exists post_likes_post_id_idx on public.post_likes (post_id);
create index if not exists post_likes_business_id_idx on public.post_likes (business_id);

alter table public.post_likes enable row level security;

drop policy if exists "post_likes_select_all" on public.post_likes;
create policy "post_likes_select_all"
  on public.post_likes for select
  to authenticated, anon
  using (true);

drop policy if exists "post_likes_insert_own_business" on public.post_likes;
create policy "post_likes_insert_own_business"
  on public.post_likes for insert
  to authenticated
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
  );

drop policy if exists "post_likes_delete_own_business" on public.post_likes;
create policy "post_likes_delete_own_business"
  on public.post_likes for delete
  to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
  );
