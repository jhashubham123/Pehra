-- PEHRA · full database setup. Paste into Supabase > SQL Editor > New query > Run. Run ONCE on a fresh project.

-- ===== 20261030000001_helpers.sql =====
-- 0001 · Helpers
-- Plain Postgres only (13+). No extensions, no Supabase-specific objects, so these
-- migrations run unchanged on Supabase, RDS, Neon, Cloud SQL or a self-hosted server.

-- Keeps updated_at honest without relying on application code.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===== 20261030000002_society_structure.sql =====
-- 0002 · Society structure: societies, towers, flats
--
-- Multi-tenancy rule used everywhere in this schema:
--   every tenant-owned table carries society_id, and every relationship to another
--   tenant-owned table is a COMPOSITE foreign key (child_id, society_id) -> (id, society_id).
--   That makes it impossible, at the database level, for a row in society A to point at
--   a row in society B, even if the API has a bug.

create table societies (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) > 0),
  slug                    text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  address_line            text,
  city                    text,
  state                   text,
  pincode                 text check (pincode is null or pincode ~ '^[0-9]{6}$'),

  -- Residents type this to ask to join (e.g. SUN-4829). Admin can rotate it.
  invite_code             text not null unique check (invite_code ~ '^[A-Z0-9-]{4,20}$'),
  invite_code_rotated_at  timestamptz not null default now(),

  status                  text not null default 'active' check (status in ('active', 'suspended')),

  -- Per-society policy knobs (typed columns for the ones the code depends on)
  approval_wait_seconds   integer not null default 60  check (approval_wait_seconds between 15 and 600),
  overstay_minutes        integer not null default 120 check (overstay_minutes between 5 and 1440),
  photo_retention_days    integer not null default 90  check (photo_retention_days between 7 and 365),
  settings                jsonb   not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create trigger trg_societies_updated before update on societies
  for each row execute function set_updated_at();

create table towers (
  id          uuid primary key default gen_random_uuid(),
  society_id  uuid not null references societies (id),
  name        text not null check (length(btrim(name)) > 0),   -- 'A', 'B', 'Wing 3'
  floors      integer not null check (floors between 1 and 120),
  created_at  timestamptz not null default now(),
  unique (society_id, name),
  unique (id, society_id)                                       -- target for composite FKs
);

create table flats (
  id          uuid primary key default gen_random_uuid(),
  society_id  uuid not null,
  tower_id    uuid not null,
  floor       integer not null check (floor >= 0),
  number      text not null check (length(btrim(number)) > 0),  -- '402'
  label       text not null check (length(btrim(label)) > 0),   -- 'B-402', shown everywhere
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tower_id, number),
  unique (society_id, label),
  unique (id, society_id),
  foreign key (tower_id, society_id) references towers (id, society_id)
);

create index flats_society_idx on flats (society_id);

create trigger trg_flats_updated before update on flats
  for each row execute function set_updated_at();

-- ===== 20261030000003_identity.sql =====
-- 0003 · Identity: users, staff (admins and guards), residents, OTP, sessions, push tokens
--
-- Design choice for portability: identity lives in OUR tables, not in Supabase Auth.
-- The Node API sends the OTP, verifies it, and issues its own JWT/refresh tokens.
-- Nothing here references auth.users, so moving off Supabase never touches identity.
--
-- Phone numbers are stored in E.164 (+919876543210). The API normalises before saving.

create table users (
  id                 uuid primary key default gen_random_uuid(),
  phone              text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  full_name          text,
  photo_path         text,                         -- object key in storage, never a URL
  language           text not null default 'en' check (language in ('en', 'hi')),
  status             text not null default 'active' check (status in ('active', 'blocked')),
  phone_verified_at  timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();

-- Admins and guards. Created by an admin BEFORE the person ever signs in, so user_id is
-- nullable and gets linked at first login by matching the phone number.
create table society_staff (
  id                  uuid primary key default gen_random_uuid(),
  society_id          uuid not null references societies (id),
  user_id             uuid references users (id) on delete set null,
  role                text not null check (role in ('admin', 'guard')),
  full_name           text not null check (length(btrim(full_name)) > 0),
  phone               text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  photo_path          text,
  shift               text check (shift in ('day', 'night', 'general')),
  status              text not null default 'invited'
                        check (status in ('invited', 'active', 'suspended', 'removed')),
  created_by_user_id  uuid references users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (society_id, phone, role),
  unique (id, society_id),
  check (role = 'guard' or shift is null)
);

create index society_staff_user_idx  on society_staff (user_id);
create index society_staff_phone_idx on society_staff (phone);

create trigger trg_society_staff_updated before update on society_staff
  for each row execute function set_updated_at();

-- People who live in a flat. A row may exist with no login at all (a child, a grandparent
-- with no phone): they are stored so guards can recognise them. user_id is linked when a
-- member with a phone signs in.
create table residents (
  id                   uuid primary key default gen_random_uuid(),
  society_id           uuid not null,
  flat_id              uuid not null,
  user_id              uuid references users (id) on delete set null,

  full_name            text not null check (length(btrim(full_name)) > 0),
  phone                text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  photo_path           text,

  resident_type        text not null check (resident_type in ('owner', 'tenant', 'family_member')),
  relation_to_head     text not null default 'other'
                         check (relation_to_head in ('head', 'spouse', 'son', 'daughter',
                                                     'parent', 'sibling', 'other')),
  is_head              boolean not null default false,
  receives_alerts      boolean not null default false,

  status               text not null default 'pending'
                         check (status in ('pending', 'active', 'declined', 'moved_out')),
  source               text not null check (source in ('admin', 'self')),
  invite_code_used     text,                       -- recorded for the admin's review screen
  decided_by_user_id   uuid references users (id) on delete set null,
  decided_at           timestamptz,
  decision_note        text,                       -- reason shown to the resident on decline
  moved_out_at         timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (id, society_id),
  foreign key (flat_id, society_id) references flats (id, society_id),

  -- someone must be reachable to receive an alert
  check (not receives_alerts or phone is not null),
  check (not is_head or relation_to_head = 'head'),
  check ((status in ('active', 'declined', 'moved_out')) = (decided_at is not null) or source = 'admin')
);

-- one head of family per flat, among active residents
create unique index residents_one_head_uidx on residents (flat_id) where is_head and status = 'active';
-- one pending-or-active registration per phone per society (stops duplicate sign-ups)
create unique index residents_phone_uidx on residents (society_id, phone)
  where phone is not null and status in ('pending', 'active');

create index residents_flat_idx   on residents (flat_id);
create index residents_user_idx   on residents (user_id);
create index residents_phone_idx  on residents (phone);
create index residents_pending_idx on residents (society_id, created_at) where status = 'pending';

create trigger trg_residents_updated before update on residents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Auth support tables (used only by the Node API)
-- ---------------------------------------------------------------------------------------

-- One row per OTP sent. Only a hash of the code is stored.
create table otp_requests (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash     text not null,
  purpose       text not null default 'login' check (purpose in ('login')),
  expires_at    timestamptz not null,
  attempts      smallint not null default 0,
  max_attempts  smallint not null default 5,
  consumed_at   timestamptz,
  request_ip    inet,
  created_at    timestamptz not null default now()
);

create index otp_requests_phone_idx on otp_requests (phone, created_at desc);

-- Refresh-token sessions. Only a hash of the refresh token is stored.
create table auth_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users (id) on delete cascade,
  refresh_token_hash  text not null unique,
  user_agent          text,
  ip                  inet,
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  last_used_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index auth_sessions_user_idx on auth_sessions (user_id) where revoked_at is null;

-- Push-notification tokens (FCM). A user can have several phones.
create table user_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  platform      text not null check (platform in ('android', 'ios')),
  push_token    text not null unique,
  app_version   text,
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index user_devices_user_idx on user_devices (user_id) where revoked_at is null;

-- ===== 20261030000004_gates_devices.sql =====
-- 0004 · Gates and paired guard devices

create table gates (
  id          uuid primary key default gen_random_uuid(),
  society_id  uuid not null references societies (id),
  name        text not null check (length(btrim(name)) > 0),   -- 'Main Gate'
  status      text not null default 'active' check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now(),
  unique (society_id, name),
  unique (id, society_id)
);

-- A phone that has been paired to a gate by a guard using an admin-issued code.
create table gate_devices (
  id                  uuid primary key default gen_random_uuid(),
  society_id          uuid not null,
  gate_id             uuid not null,
  staff_id            uuid not null,                 -- the guard who paired it
  user_device_id      uuid references user_devices (id) on delete set null,
  device_label        text,
  status              text not null default 'active' check (status in ('active', 'revoked')),
  paired_at           timestamptz not null default now(),
  last_seen_at        timestamptz,
  revoked_at          timestamptz,
  revoked_by_user_id  uuid references users (id) on delete set null,
  unique (id, society_id),
  foreign key (gate_id, society_id)  references gates (id, society_id),
  foreign key (staff_id, society_id) references society_staff (id, society_id),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index gate_devices_gate_idx on gate_devices (gate_id) where status = 'active';
-- a physical phone is paired to at most one gate at a time
create unique index gate_devices_device_uidx on gate_devices (user_device_id)
  where status = 'active' and user_device_id is not null;

-- Short-lived 6-digit codes an admin generates in the portal (the "482 916" screen).
-- The API stores a keyed hash of the code, never the code itself.
create table device_pairing_codes (
  id                  uuid primary key default gen_random_uuid(),
  society_id          uuid not null,
  gate_id             uuid not null,
  staff_id            uuid,                          -- optional: code meant for one guard
  code_hash           text not null,
  expires_at          timestamptz not null,
  used_at             timestamptz,
  created_by_user_id  uuid references users (id) on delete set null,
  created_at          timestamptz not null default now(),
  foreign key (gate_id, society_id)  references gates (id, society_id),
  foreign key (staff_id, society_id) references society_staff (id, society_id)
);

-- while a code is unused its hash must be unique, so a lookup by code is unambiguous
create unique index device_pairing_codes_open_uidx on device_pairing_codes (code_hash)
  where used_at is null;

-- ===== 20261030000005_visitors_passes_help.sql =====
-- 0005 · Visitors, blocks, guest passes, daily help

-- Remembered visitor identities, so a returning person is recognised and can be blocked.
create table visitors (
  id          uuid primary key default gen_random_uuid(),
  society_id  uuid not null references societies (id),
  full_name   text not null check (length(btrim(full_name)) > 0),
  phone       text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  photo_path  text,
  created_at  timestamptz not null default now(),
  unique (id, society_id)
);

create index visitors_phone_idx on visitors (society_id, phone) where phone is not null;

-- "Always deny this person". flat_id null means blocked for the whole society (admin only).
create table visitor_blocks (
  id                  uuid primary key default gen_random_uuid(),
  society_id          uuid not null references societies (id),
  flat_id             uuid,
  visitor_id          uuid,
  phone               text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  reason              text,
  created_by_user_id  uuid references users (id) on delete set null,
  created_at          timestamptz not null default now(),
  lifted_at           timestamptz,
  foreign key (flat_id, society_id)    references flats (id, society_id),
  foreign key (visitor_id, society_id) references visitors (id, society_id),
  check (visitor_id is not null or phone is not null)
);

create index visitor_blocks_active_idx on visitor_blocks (society_id) where lifted_at is null;

-- Pre-approved guest passes (QR + 6-digit code) created by residents.
create table visit_passes (
  id                      uuid primary key default gen_random_uuid(),
  society_id              uuid not null,
  flat_id                 uuid not null,
  created_by_resident_id  uuid not null,
  guest_name              text not null check (length(btrim(guest_name)) > 0),
  guest_phone             text check (guest_phone is null or guest_phone ~ '^\+[1-9][0-9]{7,14}$'),
  category                text not null default 'guest'
                            check (category in ('guest', 'delivery', 'cab', 'service')),
  valid_from              timestamptz not null,
  valid_until             timestamptz not null,
  max_entries             integer check (max_entries is null or max_entries > 0),  -- null = any time in window
  entries_used            integer not null default 0 check (entries_used >= 0),
  vehicle_number          text,
  code                    text not null check (code ~ '^[0-9]{6}$'),
  status                  text not null default 'active'
                            check (status in ('active', 'used', 'expired', 'cancelled')),
  cancelled_at            timestamptz,
  created_at              timestamptz not null default now(),
  unique (id, society_id),
  foreign key (flat_id, society_id)                 references flats (id, society_id),
  foreign key (created_by_resident_id, society_id)  references residents (id, society_id),
  check (valid_until > valid_from),
  check (max_entries is null or entries_used <= max_entries),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

-- The guard types a code without choosing a flat, so active codes are unique per society.
create unique index visit_passes_code_uidx on visit_passes (society_id, code) where status = 'active';
create index visit_passes_flat_idx on visit_passes (flat_id, valid_until desc);

-- Maids, cooks, drivers: people who come every day on a schedule.
create table domestic_staff (
  id                      uuid primary key default gen_random_uuid(),
  society_id              uuid not null references societies (id),
  full_name               text not null check (length(btrim(full_name)) > 0),
  phone                   text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  photo_path              text,
  role                    text not null check (role in ('maid', 'cook', 'driver', 'nanny', 'gardener', 'other')),
  status                  text not null default 'pending'
                            check (status in ('pending', 'active', 'suspended', 'removed')),
  added_by_resident_id    uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (id, society_id),
  foreign key (added_by_resident_id, society_id) references residents (id, society_id)
);

create trigger trg_domestic_staff_updated before update on domestic_staff
  for each row execute function set_updated_at();

-- Which flats a helper works in, and when. Attendance is derived from visits, not stored twice.
create table domestic_staff_assignments (
  id                 uuid primary key default gen_random_uuid(),
  society_id         uuid not null,
  domestic_staff_id  uuid not null,
  flat_id            uuid not null,
  days_of_week       smallint[] not null
                       check (cardinality(days_of_week) between 1 and 7
                              and days_of_week <@ array[1,2,3,4,5,6,7]::smallint[]),   -- 1 = Monday
  start_time         time not null,
  end_time           time not null,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (domestic_staff_id, flat_id),
  foreign key (domestic_staff_id, society_id) references domestic_staff (id, society_id),
  foreign key (flat_id, society_id)           references flats (id, society_id),
  check (end_time > start_time)
);

create index domestic_staff_assignments_flat_idx on domestic_staff_assignments (flat_id) where active;

-- ===== 20261030000006_visits.sql =====
-- 0006 · Visits (the core table) and the notification trail behind each approval request
--
-- Lifecycle
--   walk-in      pending -> approved -> entered -> exited
--                pending -> denied | not_reached | cancelled
--   pre-approved approved -> entered -> exited         (never pending)
--
-- Two family members may tap Approve/Deny at the same moment. The API must decide with
--   update visits set status = 'approved', ... where id = $1 and status = 'pending'
-- and treat 0 rows updated as "someone already answered". First answer wins.

create table visits (
  id                      uuid primary key default gen_random_uuid(),
  society_id              uuid not null,
  gate_id                 uuid not null,
  flat_id                 uuid not null,

  visitor_id              uuid,
  visitor_name            text not null check (length(btrim(visitor_name)) > 0),
  visitor_phone           text check (visitor_phone is null or visitor_phone ~ '^\+[1-9][0-9]{7,14}$'),
  visitor_company         text,                      -- 'Amazon', 'Swiggy'
  photo_path              text,                      -- object key; purged after retention window
  photo_purged_at         timestamptz,
  vehicle_number          text,

  purpose                 text not null check (purpose in ('guest', 'delivery', 'cab', 'service', 'staff', 'other')),
  entry_type              text not null check (entry_type in ('walk_in', 'pre_approved', 'staff')),
  pass_id                 uuid,
  domestic_staff_id       uuid,

  status                  text not null
                            check (status in ('pending', 'approved', 'denied', 'not_reached',
                                              'cancelled', 'entered', 'exited')),
  requested_at            timestamptz not null default now(),
  decided_at              timestamptz,
  decided_by_resident_id  uuid,
  decision_note           text,
  leave_at_gate           boolean not null default false,   -- resident chose "leave at gate"

  entered_at              timestamptz,
  exited_at               timestamptz,
  logged_by_staff_id      uuid not null,             -- guard who created the entry
  entered_by_staff_id     uuid,
  exited_by_staff_id      uuid,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (id, society_id),
  foreign key (gate_id, society_id)                  references gates (id, society_id),
  foreign key (flat_id, society_id)                  references flats (id, society_id),
  foreign key (visitor_id, society_id)               references visitors (id, society_id),
  foreign key (pass_id, society_id)                  references visit_passes (id, society_id),
  foreign key (domestic_staff_id, society_id)        references domestic_staff (id, society_id),
  foreign key (decided_by_resident_id, society_id)   references residents (id, society_id),
  foreign key (logged_by_staff_id, society_id)       references society_staff (id, society_id),
  foreign key (entered_by_staff_id, society_id)      references society_staff (id, society_id),
  foreign key (exited_by_staff_id, society_id)       references society_staff (id, society_id),

  -- state machine guard rails (the API enforces transitions; the database refuses nonsense)
  check ((status in ('entered', 'exited')) = (entered_at is not null)),
  check ((status = 'exited') = (exited_at is not null)),
  check (exited_at is null or exited_at >= entered_at),
  check (entry_type <> 'pre_approved' or pass_id is not null),
  check (entry_type <> 'staff' or domestic_staff_id is not null),
  check (entry_type = 'walk_in' or status not in ('pending', 'denied', 'not_reached')),
  check (status <> 'approved' or decided_at is not null or entry_type <> 'walk_in')
);

-- hot paths: "who is inside now", "what is waiting", "my flat's history", society timeline
create index visits_inside_idx   on visits (society_id, entered_at desc) where status = 'entered';
create index visits_pending_idx  on visits (society_id, requested_at)    where status = 'pending';
create index visits_flat_idx     on visits (flat_id, requested_at desc);
create index visits_society_idx  on visits (society_id, requested_at desc);
create index visits_photo_idx    on visits (requested_at) where photo_path is not null;

create trigger trg_visits_updated before update on visits
  for each row execute function set_updated_at();

-- Every alert, call and escalation step for a walk-in request. The Node worker polls rows
-- that are 'scheduled' and due. Step 1 = app alert, step 2 = automatic voice call, 3 = manual.
create table visit_notifications (
  id            uuid primary key default gen_random_uuid(),
  society_id    uuid not null,
  visit_id      uuid not null,
  resident_id   uuid,                                -- recipient, when it targets one person
  channel       text not null check (channel in ('push', 'sms', 'voice_call', 'manual_call')),
  step          smallint not null check (step between 1 and 5),
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'sent', 'delivered', 'answered', 'failed', 'cancelled')),
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  viewed_at     timestamptz,                         -- "Vikram viewed it 12 seconds ago"
  provider_ref  text,                                -- FCM message id / call SID
  error         text,
  created_at    timestamptz not null default now(),
  foreign key (visit_id, society_id)    references visits (id, society_id),
  foreign key (resident_id, society_id) references residents (id, society_id)
);

create index visit_notifications_due_idx   on visit_notifications (scheduled_for) where status = 'scheduled';
create index visit_notifications_visit_idx on visit_notifications (visit_id);

-- ===== 20261030000007_ops.sql =====
-- 0007 · SOS alerts, notices, audit log

create table sos_alerts (
  id                       uuid primary key default gen_random_uuid(),
  society_id               uuid not null,
  gate_id                  uuid,
  raised_by_staff_id       uuid,
  raised_by_resident_id    uuid,
  kind                     text not null check (kind in ('fire', 'medical', 'intruder', 'other')),
  status                   text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  note                     text,
  raised_at                timestamptz not null default now(),
  acknowledged_by_user_id  uuid references users (id) on delete set null,
  acknowledged_at          timestamptz,
  resolved_by_user_id      uuid references users (id) on delete set null,
  resolved_at              timestamptz,
  foreign key (society_id)                           references societies (id),
  foreign key (gate_id, society_id)                  references gates (id, society_id),
  foreign key (raised_by_staff_id, society_id)       references society_staff (id, society_id),
  foreign key (raised_by_resident_id, society_id)    references residents (id, society_id),
  check (raised_by_staff_id is not null or raised_by_resident_id is not null),
  check ((status = 'resolved') = (resolved_at is not null))
);

create index sos_alerts_open_idx on sos_alerts (society_id, raised_at desc) where status <> 'resolved';

create table notices (
  id                  uuid primary key default gen_random_uuid(),
  society_id          uuid not null references societies (id),
  title               text not null check (length(btrim(title)) > 0),
  body                text not null,
  pinned              boolean not null default false,
  publish_at          timestamptz not null default now(),
  expires_at          timestamptz,
  created_by_user_id  uuid references users (id) on delete set null,
  created_at          timestamptz not null default now(),
  check (expires_at is null or expires_at > publish_at)
);

create index notices_society_idx on notices (society_id, publish_at desc);

-- Append-only record of sensitive actions (approve/decline resident, rotate invite code,
-- revoke a device, block a visitor ...). No foreign keys on purpose: the trail must
-- survive deletion of the things it describes.
create table audit_log (
  id             bigint generated always as identity primary key,
  society_id     uuid,
  actor_user_id  uuid,
  actor_role     text,
  action         text not null,
  entity_type    text,
  entity_id      text,
  metadata       jsonb not null default '{}'::jsonb,
  ip             inet,
  created_at     timestamptz not null default now()
);

create index audit_log_society_idx on audit_log (society_id, created_at desc);
create index audit_log_entity_idx  on audit_log (entity_type, entity_id);

-- ===== 20261030000008_views_and_security.sql =====
-- 0008 · Convenience views and the security baseline

-- Everyone currently inside, with their flat and how long they have been there.
create view v_inside_now as
select v.id            as visit_id,
       v.society_id,
       v.gate_id,
       f.label         as flat_label,
       v.visitor_name,
       v.purpose,
       v.vehicle_number,
       v.entered_at,
       now() - v.entered_at                                                 as inside_for,
       (now() - v.entered_at) > make_interval(mins => s.overstay_minutes)   as is_overstay
from visits v
join flats f      on f.id = v.flat_id and f.society_id = v.society_id
join societies s  on s.id = v.society_id
where v.status = 'entered';

-- Join requests waiting for an admin.
create view v_pending_join_requests as
select r.id            as resident_id,
       r.society_id,
       r.full_name,
       r.phone,
       r.resident_type,
       f.label         as flat_label,
       r.invite_code_used,
       r.created_at
from residents r
join flats f on f.id = r.flat_id and f.society_id = r.society_id
where r.status = 'pending';

-- Visit photos past each society's retention window. The nightly job deletes the stored
-- object, then sets photo_path = null and photo_purged_at = now().
create view v_visit_photos_due_for_purge as
select v.id as visit_id, v.society_id, v.photo_path
from visits v
join societies s on s.id = v.society_id
where v.photo_path is not null
  and v.requested_at < now() - make_interval(days => s.photo_retention_days);

-- ---------------------------------------------------------------------------------------
-- Security baseline: deny by default
--
-- Supabase publishes every table in the public schema through its auto-generated REST API.
-- We do not use that API. The Flutter apps talk only to our Node API, and Node connects
-- with a privileged server-side connection string. So:
--   1. Row Level Security is switched ON for every table, with NO policies = nobody using
--      the public anon/authenticated keys can read or write anything.
--   2. Those two roles also lose all table privileges, as a second lock.
-- If you later add Supabase-direct access for something (for example Realtime), add
-- narrow policies for just that table.
-- ---------------------------------------------------------------------------------------

do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

-- Role names below exist on Supabase only; on plain Postgres this block does nothing.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables    in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables    from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end
$$;
