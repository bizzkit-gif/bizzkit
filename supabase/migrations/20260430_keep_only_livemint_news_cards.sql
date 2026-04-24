delete from public.news_cards
where
  coalesce(article_url, '') !~* 'livemint\.com'
  and coalesce(source_name, '') !~* 'livemint';
