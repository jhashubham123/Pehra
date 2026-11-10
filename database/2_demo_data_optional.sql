-- PEHRA · DEMO DATA (dev only). Run AFTER 1_create_tables.sql. Do not run in production.
-- Demo data that matches the app designs (Sunrise Heights, flat B-402, Ravi Kumar waiting
-- at the gate, and so on). DEVELOPMENT ONLY: never run this against a real society.
-- All phone numbers are fake (+91 90000 000xx).

set search_path = public;

-- Society ------------------------------------------------------------------------------
insert into societies (id, name, slug, address_line, city, state, pincode, invite_code)
values ('a0000000-0000-4000-8000-000000000001', 'Sunrise Heights', 'sunrise-heights',
        'Sector 21, Baner', 'Pune', 'Maharashtra', '411045', 'SUN-4829');

insert into towers (id, society_id, name, floors) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A', 12),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'B', 12),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'C', 12),
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'D', 12);

-- Towers A, B, C have 4 flats a floor (101..1204); tower D has 5 (101..1205).
insert into flats (society_id, tower_id, floor, number, label)
select t.society_id, t.id, fl, (fl * 100 + n)::text, t.name || '-' || (fl * 100 + n)
from towers t
cross join generate_series(1, 12) as fl
cross join generate_series(1, case when t.name = 'D' then 5 else 4 end) as n
where t.society_id = 'a0000000-0000-4000-8000-000000000001';

insert into gates (id, society_id, name) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Main Gate'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Back Gate');

-- Users and staff ----------------------------------------------------------------------
insert into users (id, phone, full_name, phone_verified_at, language) values
  ('b0000000-0000-4000-8000-000000000001', '+919000000001', 'Rakesh Gupta',  now(), 'en'),
  ('b0000000-0000-4000-8000-000000000002', '+919000000002', 'Suresh Yadav',  now(), 'hi'),
  ('b0000000-0000-4000-8000-000000000003', '+919000000003', 'Vikram Sharma', now(), 'en'),
  ('b0000000-0000-4000-8000-000000000004', '+919000000004', 'Anita Sharma',  now(), 'en'),
  ('b0000000-0000-4000-8000-000000000005', '+919000000005', 'Rajesh Verma',  now(), 'en'),
  ('b0000000-0000-4000-8000-000000000006', '+919000000011', 'Meera Joshi',   now(), 'en');

insert into society_staff (id, society_id, user_id, role, full_name, phone, shift, status) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'admin', 'Rakesh Gupta', '+919000000001', null,  'active'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000002', 'guard', 'Suresh Yadav', '+919000000002', 'day', 'active'),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   null,                                   'guard', 'Ramesh Patil', '+919000000006', 'night', 'invited'),
  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001',
   null,                                   'guard', 'Dinesh Singh', '+919000000007', 'day',  'invited');

insert into user_devices (id, user_id, platform, push_token, app_version, last_seen_at) values
  ('50000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002',
   'android', 'demo-fcm-token-suresh', '0.1.0', now());

insert into gate_devices (society_id, gate_id, staff_id, user_device_id, device_label) values
  ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'Main Gate phone');

insert into device_pairing_codes (society_id, gate_id, staff_id, code_hash, expires_at, created_by_user_id)
values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
        'c0000000-0000-4000-8000-000000000004', 'demo-hash-not-a-real-code',
        now() + interval '10 minutes', 'b0000000-0000-4000-8000-000000000001');

-- Residents ----------------------------------------------------------------------------
insert into residents (id, society_id, flat_id, user_id, full_name, phone, resident_type,
                       relation_to_head, is_head, receives_alerts, status, source, decided_at) values
  -- B-402: Vikram (head), Anita (spouse), Kabir (child, no phone)
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'B-402'),
   'b0000000-0000-4000-8000-000000000003', 'Vikram Sharma', '+919000000003', 'owner',         'head',   true,  true,  'active', 'admin', now()),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'B-402'),
   'b0000000-0000-4000-8000-000000000004', 'Anita Sharma',  '+919000000004', 'family_member', 'spouse', false, true,  'active', 'admin', now()),
  ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'B-402'),
   null,                                   'Kabir Sharma',  null,            'family_member', 'son',    false, false, 'active', 'admin', now()),
  -- C-301: Rajesh (head), Sunita (spouse), Aarav (child)
  ('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'C-301'),
   'b0000000-0000-4000-8000-000000000005', 'Rajesh Verma',  '+919000000005', 'owner',         'head',   true,  true,  'active', 'admin', now()),
  ('f0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'C-301'),
   null,                                   'Sunita Verma',  '+919000000008', 'family_member', 'spouse', false, true,  'active', 'admin', now()),
  ('f0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'C-301'),
   null,                                   'Aarav Verma',   null,            'family_member', 'son',    false, false, 'active', 'admin', now()),
  -- A-1002: Meera Joshi (head)
  ('f0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'A-1002'),
   'b0000000-0000-4000-8000-000000000006', 'Meera Joshi',   '+919000000011', 'owner',         'head',   true,  true,  'active', 'admin', now());

-- A self-registered request waiting for the admin (Admin > Requests)
insert into residents (id, society_id, flat_id, full_name, phone, resident_type, relation_to_head,
                       status, source, invite_code_used)
values ('f0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'D-1105'),
        'Manoj Khanna', '+919000000009', 'tenant', 'head', 'pending', 'self', 'SUN-4829');

-- Daily help ---------------------------------------------------------------------------
insert into domestic_staff (id, society_id, full_name, phone, role, status, added_by_resident_id) values
  ('30000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'Lata Devi', '+919000000012', 'maid', 'active', 'f0000000-0000-4000-8000-000000000001');

insert into domestic_staff_assignments (society_id, domestic_staff_id, flat_id, days_of_week, start_time, end_time) values
  ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'B-402'), array[1,2,3,4,5,6]::smallint[], '08:00', '11:00');

-- Visitors, passes, visits -------------------------------------------------------------
insert into visitors (id, society_id, full_name, phone) values
  ('10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Ravi Kumar',  '+919000000010'),
  ('10000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Pawan Kumar',  '+919000000013');

insert into visit_passes (id, society_id, flat_id, created_by_resident_id, guest_name, guest_phone, category,
                          valid_from, valid_until, max_entries, entries_used, vehicle_number, code, status) values
  -- Neha Gupta, invited by Vikram (Resident > Guest pass): still unused
  ('20000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'B-402'),
   'f0000000-0000-4000-8000-000000000001', 'Neha Gupta', '+919000000014', 'guest',
   now() + interval '1 hour', now() + interval '3 hours', 1, 0, 'MH 12 EF 7310', '573108', 'active'),
  -- Pawan Kumar, invited by Meera: already used
  ('20000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'A-1002'),
   'f0000000-0000-4000-8000-000000000007', 'Pawan Kumar', '+919000000013', 'guest',
   now() - interval '2 hours', now() + interval '4 hours', 1, 1, 'MH 12 AB 4821', '482001', 'used');

insert into visits (id, society_id, gate_id, flat_id, visitor_id, visitor_name, visitor_company, purpose,
                    entry_type, pass_id, domestic_staff_id, status, requested_at, decided_at,
                    decided_by_resident_id, entered_at, exited_at, vehicle_number,
                    logged_by_staff_id, entered_by_staff_id, exited_by_staff_id) values
  -- 1. Waiting right now: Ravi Kumar at B-402 (Guard > Waiting for reply)
  ('40000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'B-402'), '10000000-0000-4000-8000-000000000001',
   'Ravi Kumar', 'Delhivery', 'delivery', 'walk_in', null, null, 'pending',
   now() - interval '22 seconds', null, null, null, null, null,
   'c0000000-0000-4000-8000-000000000002', null, null),
  -- 2. Pawan Kumar came in on a pass and is still inside
  ('40000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'A-1002'), '10000000-0000-4000-8000-000000000002',
   'Pawan Kumar', null, 'guest', 'pre_approved', '20000000-0000-4000-8000-000000000002', null, 'entered',
   now() - interval '28 minutes', now() - interval '28 minutes', null,
   now() - interval '28 minutes', null, 'MH 12 AB 4821',
   'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', null),
  -- 3. Amazon delivery to C-301: approved, entered, left
  ('40000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'C-301'), null,
   'Amazon delivery', 'Amazon', 'delivery', 'walk_in', null, null, 'exited',
   now() - interval '70 minutes', now() - interval '69 minutes', 'f0000000-0000-4000-8000-000000000004',
   now() - interval '68 minutes', now() - interval '60 minutes', null,
   'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002'),
  -- 4. A sales visit that Anita denied
  ('40000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'B-402'), null,
   'Unknown caller', null, 'other', 'walk_in', null, null, 'denied',
   now() - interval '2 hours', now() - interval '119 minutes', 'f0000000-0000-4000-8000-000000000002',
   null, null, null,
   'c0000000-0000-4000-8000-000000000002', null, null),
  -- 5. A cab at C-301 that has stayed far too long (overstay warning)
  ('40000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'C-301'), null,
   'Sanjay Mehta', null, 'cab', 'walk_in', null, null, 'entered',
   now() - interval '4 hours', now() - interval '239 minutes', 'f0000000-0000-4000-8000-000000000004',
   now() - interval '238 minutes', null, 'MH 14 CD 9087',
   'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', null),
  -- 6. Lata Devi (maid, B-402) came in on her daily pass
  ('40000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', (select id from public.flats where society_id = 'a0000000-0000-4000-8000-000000000001' and label = 'B-402'), null,
   'Lata Devi', null, 'staff', 'staff', null, '30000000-0000-4000-8000-000000000001', 'entered',
   now() - interval '40 minutes', now() - interval '40 minutes', null,
   now() - interval '40 minutes', null, null,
   'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', null);

-- The alert trail for visit 1: app alerts sent, automatic call due in ~38 seconds
insert into visit_notifications (society_id, visit_id, resident_id, channel, step, status, scheduled_for, sent_at, viewed_at) values
  ('a0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'push', 1, 'delivered', now() - interval '22 seconds', now() - interval '21 seconds', now() - interval '12 seconds'),
  ('a0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002',
   'push', 1, 'delivered', now() - interval '22 seconds', now() - interval '21 seconds', null),
  ('a0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'voice_call', 2, 'scheduled', now() + interval '38 seconds', null, null);

-- A notice and one audit entry --------------------------------------------------------
insert into notices (society_id, title, body, created_by_user_id) values
  ('a0000000-0000-4000-8000-000000000001', 'Water tank cleaning',
   'Water supply will be off on Sunday from 10 AM to 1 PM for tank cleaning.', 'b0000000-0000-4000-8000-000000000001');

insert into audit_log (society_id, actor_user_id, actor_role, action, entity_type, entity_id, metadata) values
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'admin',
   'society.created', 'society', 'a0000000-0000-4000-8000-000000000001', '{"source": "seed"}');
