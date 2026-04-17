-- Enforce one business profile per auth owner.
-- 1) Cleanup duplicates (keep most recently updated row per owner_id)
-- 2) Add unique index on owner_id

begin;

create temporary table if not exists tmp_duplicate_business_ids on commit drop as
with ranked as (
  select
    b.id,
    b.owner_id,
    row_number() over (
      partition by b.owner_id
      order by b.updated_at desc nulls last, b.created_at desc nulls last, b.id desc
    ) as rn
  from public.businesses b
  where b.owner_id is not null
)
select id
from ranked
where rn > 1;

-- Child records referencing duplicate businesses.
delete from public.post_likes
where post_id in (
  select p.id
  from public.posts p
  where p.business_id in (select id from tmp_duplicate_business_ids)
);

delete from public.post_likes
where business_id in (select id from tmp_duplicate_business_ids);

delete from public.saved_businesses
where business_id in (select id from tmp_duplicate_business_ids);

delete from public.push_subscriptions
where business_id in (select id from tmp_duplicate_business_ids);

delete from public.kyc_submissions
where business_id in (select id from tmp_duplicate_business_ids);

delete from public.products
where business_id in (select id from tmp_duplicate_business_ids);

delete from public.conference_attendees
where business_id in (select id from tmp_duplicate_business_ids);

delete from public.conference_attendees
where conference_id in (
  select c.id
  from public.conferences c
  where c.organizer_id in (select id from tmp_duplicate_business_ids)
);

delete from public.conferences
where organizer_id in (select id from tmp_duplicate_business_ids);

delete from public.messages
where chat_id in (
  select ch.id
  from public.chats ch
  where ch.participant_a in (select id from tmp_duplicate_business_ids)
     or ch.participant_b in (select id from tmp_duplicate_business_ids)
);

delete from public.chats
where participant_a in (select id from tmp_duplicate_business_ids)
   or participant_b in (select id from tmp_duplicate_business_ids);

delete from public.connections
where from_biz_id in (select id from tmp_duplicate_business_ids)
   or to_biz_id in (select id from tmp_duplicate_business_ids);

delete from public.posts
where business_id in (select id from tmp_duplicate_business_ids);

delete from public.businesses
where id in (select id from tmp_duplicate_business_ids);

create unique index if not exists businesses_owner_id_unique
  on public.businesses(owner_id)
  where owner_id is not null;

commit;
