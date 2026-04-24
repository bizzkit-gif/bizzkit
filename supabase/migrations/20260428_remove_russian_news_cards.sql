delete from public.news_cards
where
  coalesce(title, '') ~* '(russia|russian|moscow|kremlin|putin|россия|русск|москва|кремл|путин|[А-Яа-яЁё])'
  or coalesce(summary, '') ~* '(russia|russian|moscow|kremlin|putin|россия|русск|москва|кремл|путин|[А-Яа-яЁё])'
  or coalesce(full_text, '') ~* '(russia|russian|moscow|kremlin|putin|россия|русск|москва|кремл|путин|[А-Яа-яЁё])';
