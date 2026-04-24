alter table public.news_cards
add column if not exists full_text text not null default '';
