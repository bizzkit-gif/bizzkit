create extension if not exists pgcrypto;

create table if not exists public.news_cards (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'local')),
  city text,
  country text,
  title text not null,
  summary text not null,
  source_name text not null,
  article_url text not null,
  image_url text,
  industry text not null default 'Other',
  published_at timestamptz not null,
  dedupe_hash text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_news_cards_scope_published_at
  on public.news_cards (scope, published_at desc);

create index if not exists idx_news_cards_locality
  on public.news_cards (city, country, published_at desc);

alter table public.news_cards enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'news_cards'
      and policyname = 'news_cards_select_authenticated'
  ) then
    create policy news_cards_select_authenticated
      on public.news_cards
      for select
      to authenticated
      using (true);
  end if;
end;
$$;
