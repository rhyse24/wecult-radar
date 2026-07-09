-- WeCult Büyüme Radarı tabloları (Supabase SQL Editor'da bir kez çalıştır).
-- Bu tablolara SADECE service_role erişir (GitHub Actions secret'ı);
-- RLS açık + policy YOK = anon/authenticated hiçbir şey okuyamaz-yazamaz.

create table if not exists public.radar_seen (
  id text primary key,
  source text not null,
  first_seen timestamptz not null default now()
);

create table if not exists public.radar_opportunities (
  id text primary key,
  source text not null,
  venue text not null default '',
  url text not null,
  title text not null,
  klass text not null,
  score int not null,
  lang text not null default 'en',
  tr_summary text not null default '',
  item_text text not null default '',
  created_at timestamptz,
  notified boolean not null default false,
  inserted_at timestamptz not null default now()
);

create index if not exists radar_opps_pending
  on public.radar_opportunities (notified, score desc);

alter table public.radar_seen enable row level security;
alter table public.radar_opportunities enable row level security;

-- Eski kayıt buduma (radar_seen sonsuz büyümesin): 60 günden eski görülmüşleri sil.
-- pg_cron kuruluysa (projede zaten kullanılıyor):
-- select cron.schedule('radar-prune', '0 4 * * 0',
--   $$delete from public.radar_seen where first_seen < now() - interval '60 days';
--     delete from public.radar_opportunities where inserted_at < now() - interval '90 days';$$);
