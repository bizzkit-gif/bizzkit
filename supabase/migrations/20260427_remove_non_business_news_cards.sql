delete from public.news_cards
where
  coalesce(title, '') ~* '(weather|storm|rainfall|snow|hurricane|cyclone|thunderstorm|heatwave|temperature|forecast|climate alert|air quality|pollen|wildfire|earthquake|flood warning)'
  or coalesce(summary, '') ~* '(weather|storm|rainfall|snow|hurricane|cyclone|thunderstorm|heatwave|temperature|forecast|climate alert|air quality|pollen|wildfire|earthquake|flood warning)'
  or coalesce(full_text, '') ~* '(weather|storm|rainfall|snow|hurricane|cyclone|thunderstorm|heatwave|temperature|forecast|climate alert|air quality|pollen|wildfire|earthquake|flood warning)';
