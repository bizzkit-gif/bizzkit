-- Session invite / calendar reminder contact & preferences (email + WhatsApp via Edge Functions).
alter table public.businesses
  add column if not exists phone_whatsapp text,
  add column if not exists notify_session_invite_email boolean not null default true,
  add column if not exists notify_session_invite_whatsapp boolean not null default false,
  add column if not exists notify_session_calendar_reminders boolean not null default true;

comment on column public.businesses.phone_whatsapp is 'E.164-style number for WhatsApp session invites/reminders (e.g. +971501234567)';
comment on column public.businesses.notify_session_invite_email is 'Receive session invites by email';
comment on column public.businesses.notify_session_invite_whatsapp is 'Receive session invites on WhatsApp (requires phone_whatsapp)';
comment on column public.businesses.notify_session_calendar_reminders is 'When on, session reminders are also sent by email + WhatsApp (in addition to chat)';
