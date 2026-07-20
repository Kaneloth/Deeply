-- ============================================================
-- Pulse Dating App — Supabase Schema
-- Run this entire script in your Supabase SQL Editor:
--   Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── Profiles ──────────────────────────────────────────────
create table public.profiles (
  id                uuid references auth.users on delete cascade primary key,
  name              text        not null default '',
  age               integer     not null default 18,
  bio               text,
  city              text,
  photo_url         text,
  sparks_balance    integer     not null default 10,
  integrity_score   integer     not null default 100,
  personality_tags  text[]      not null default '{}',
  is_verified       boolean     not null default false,
  created_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "Profiles viewable by authenticated users"
  on public.profiles for select using (auth.role() = 'authenticated');
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- ── Audio Prompts ─────────────────────────────────────────
create table public.audio_prompts (
  id               uuid        primary key default uuid_generate_v4(),
  user_id          uuid        not null references public.profiles on delete cascade,
  prompt_question  text        not null,
  audio_url        text        not null,
  duration_seconds integer,
  created_at       timestamptz not null default now()
);

alter table public.audio_prompts enable row level security;
create policy "Prompts viewable by authenticated users"
  on public.audio_prompts for select using (auth.role() = 'authenticated');
create policy "Users can manage own prompts"
  on public.audio_prompts for all using (auth.uid() = user_id);

-- ── Matches ───────────────────────────────────────────────
create table public.matches (
  id             uuid        primary key default uuid_generate_v4(),
  user1_id       uuid        not null references public.profiles,
  user2_id       uuid        not null references public.profiles,
  status         text        not null default 'pending', -- pending | matched | expired
  photo_revealed boolean     not null default false,
  chat_unlocked  boolean     not null default false,
  message_count  integer     not null default 0,
  message_limit  integer     not null default 20,
  expires_at     timestamptz not null,
  matched_at     timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.matches enable row level security;
create policy "Users can view their own matches"
  on public.matches for select
  using (auth.uid() = user1_id or auth.uid() = user2_id);

-- ── Messages ──────────────────────────────────────────────
create table public.messages (
  id         uuid        primary key default uuid_generate_v4(),
  match_id   uuid        not null references public.matches on delete cascade,
  sender_id  uuid        not null references public.profiles,
  content    text        not null,
  is_read    boolean     not null default false,
  is_unsent  boolean     not null default false,
  sent_at    timestamptz not null default now()
);

alter table public.messages enable row level security;
create policy "Users can view messages in their matches"
  on public.messages for select using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user1_id = auth.uid() or m.user2_id = auth.uid())
    )
  );

-- ── Sparks Transactions ───────────────────────────────────
create table public.sparks_transactions (
  id          uuid        primary key default uuid_generate_v4(),
  user_id     uuid        not null references public.profiles,
  amount      integer     not null,  -- positive = earn, negative = spend
  reason      text        not null,
  balance_after integer   not null,
  created_at  timestamptz not null default now()
);

alter table public.sparks_transactions enable row level security;
create policy "Users can view own transactions"
  on public.sparks_transactions for select using (auth.uid() = user_id);

-- ── Daily Earn Claims ─────────────────────────────────────
create table public.daily_earn_claims (
  id           uuid  primary key default uuid_generate_v4(),
  user_id      uuid  not null references public.profiles,
  claim_type   text  not null,
  claimed_date date  not null default current_date,
  unique (user_id, claim_type, claimed_date)
);

alter table public.daily_earn_claims enable row level security;
create policy "Users can view own claims"
  on public.daily_earn_claims for select using (auth.uid() = user_id);

-- ── Auto-create profile on signup ─────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, age)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce((new.raw_user_meta_data->>'age')::integer, 18)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Indexes for performance ───────────────────────────────
create index on public.matches (user1_id);
create index on public.matches (user2_id);
create index on public.messages (match_id, sent_at);
create index on public.sparks_transactions (user_id, created_at desc);
create index on public.daily_earn_claims (user_id, claimed_date);
