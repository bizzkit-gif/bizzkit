create table if not exists public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_name text not null,
  company_registration_no text not null,
  country text not null,
  document_url text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kyc_submissions_business_idx on public.kyc_submissions (business_id);
create index if not exists kyc_submissions_status_idx on public.kyc_submissions (status);

create or replace function public.set_kyc_submissions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_kyc_submissions_updated_at on public.kyc_submissions;
create trigger trg_kyc_submissions_updated_at
before update on public.kyc_submissions
for each row
execute function public.set_kyc_submissions_updated_at();
