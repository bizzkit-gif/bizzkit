delete from public.news_cards
where
  char_length(coalesce(summary, '')) < 120
  or lower(coalesce(summary, '')) = lower(coalesce(title, ''))
  or lower(coalesce(summary, '')) like lower(coalesce(title, '')) || '%'
  or lower(coalesce(summary, '')) like '%' || lower(coalesce(title, '')) || '%';
