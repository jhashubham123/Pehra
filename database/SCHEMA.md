# Pehra database schema (reference for the API)

Generated from `1_create_tables.sql` on a real Postgres 16. **The SQL file is the source of truth**; this page is a readable copy of it. Do not change the schema from API code. If a column is missing, tell the project owner so a separate ALTER script can be written.

## Rules that apply to every table

- Every tenant table has `society_id`. Always filter by it, taking the value from the logged-in user's token, never from the request.
- Links between tenant tables are composite foreign keys `(x_id, society_id)`, so a row can never point into another society.
- Phones are E.164 text, e.g. `+919876543210` (CHECK `^\+[1-9][0-9]{7,14}$`).
- Enums are `text` with CHECK constraints (listed below). Ids are `uuid` with `gen_random_uuid()`.
- `updated_at` is maintained by a trigger. Row Level Security is on with no policies, so only the server connection can read or write.

## Tables

### audit_log

| column | type | null | default |
|---|---|---|---|
| id | bigint | no |  |
| society_id | uuid | yes |  |
| actor_user_id | uuid | yes |  |
| actor_role | text | yes |  |
| action | text | no |  |
| entity_type | text | yes |  |
| entity_id | text | yes |  |
| metadata | jsonb | no | '{}'::jsonb |
| ip | inet | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `audit_log_pkey`: PRIMARY KEY (id)

Indexes:
- `CREATE INDEX audit_log_entity_idx ON public.audit_log USING btree (entity_type, entity_id)`
- `CREATE INDEX audit_log_society_idx ON public.audit_log USING btree (society_id, created_at DESC)`

### auth_sessions

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| user_id | uuid | no |  |
| refresh_token_hash | text | no |  |
| user_agent | text | yes |  |
| ip | inet | yes |  |
| expires_at | timestamp with time zone | no |  |
| revoked_at | timestamp with time zone | yes |  |
| last_used_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `auth_sessions_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
- `auth_sessions_pkey`: PRIMARY KEY (id)
- `auth_sessions_refresh_token_hash_key`: UNIQUE (refresh_token_hash)

Indexes:
- `CREATE UNIQUE INDEX auth_sessions_refresh_token_hash_key ON public.auth_sessions USING btree (refresh_token_hash)`
- `CREATE INDEX auth_sessions_user_idx ON public.auth_sessions USING btree (user_id) WHERE (revoked_at IS NULL)`

### device_pairing_codes

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| gate_id | uuid | no |  |
| staff_id | uuid | yes |  |
| code_hash | text | no |  |
| expires_at | timestamp with time zone | no |  |
| used_at | timestamp with time zone | yes |  |
| created_by_user_id | uuid | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `device_pairing_codes_created_by_user_id_fkey`: FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
- `device_pairing_codes_gate_id_society_id_fkey`: FOREIGN KEY (gate_id, society_id) REFERENCES gates(id, society_id)
- `device_pairing_codes_staff_id_society_id_fkey`: FOREIGN KEY (staff_id, society_id) REFERENCES society_staff(id, society_id)
- `device_pairing_codes_pkey`: PRIMARY KEY (id)

Indexes:
- `CREATE UNIQUE INDEX device_pairing_codes_open_uidx ON public.device_pairing_codes USING btree (code_hash) WHERE (used_at IS NULL)`

### domestic_staff

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| full_name | text | no |  |
| phone | text | yes |  |
| photo_path | text | yes |  |
| role | text | no |  |
| status | text | no | 'pending'::text |
| added_by_resident_id | uuid | yes |  |
| created_at | timestamp with time zone | no | now() |
| updated_at | timestamp with time zone | no | now() |

Constraints:
- `domestic_staff_full_name_check`: CHECK ((length(btrim(full_name)) > 0))
- `domestic_staff_phone_check`: CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{7,14}$'::text)))
- `domestic_staff_role_check`: CHECK ((role = ANY (ARRAY['maid'::text, 'cook'::text, 'driver'::text, 'nanny'::text, 'gardener'::text, 'other'::text])))
- `domestic_staff_status_check`: CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text, 'removed'::text])))
- `domestic_staff_added_by_resident_id_society_id_fkey`: FOREIGN KEY (added_by_resident_id, society_id) REFERENCES residents(id, society_id)
- `domestic_staff_society_id_fkey`: FOREIGN KEY (society_id) REFERENCES societies(id)
- `domestic_staff_pkey`: PRIMARY KEY (id)
- `domestic_staff_id_society_id_key`: UNIQUE (id, society_id)

Indexes:
- `CREATE UNIQUE INDEX domestic_staff_id_society_id_key ON public.domestic_staff USING btree (id, society_id)`

### domestic_staff_assignments

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| domestic_staff_id | uuid | no |  |
| flat_id | uuid | no |  |
| days_of_week | smallint[] | no |  |
| start_time | time without time zone | no |  |
| end_time | time without time zone | no |  |
| active | boolean | no | true |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `domestic_staff_assignments_check`: CHECK ((end_time > start_time))
- `domestic_staff_assignments_days_of_week_check`: CHECK ((((cardinality(days_of_week) >= 1) AND (cardinality(days_of_week) <= 7)) AND (days_of_week <@ ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint, (7)::smallint])))
- `domestic_staff_assignments_domestic_staff_id_society_id_fkey`: FOREIGN KEY (domestic_staff_id, society_id) REFERENCES domestic_staff(id, society_id)
- `domestic_staff_assignments_flat_id_society_id_fkey`: FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id)
- `domestic_staff_assignments_pkey`: PRIMARY KEY (id)
- `domestic_staff_assignments_domestic_staff_id_flat_id_key`: UNIQUE (domestic_staff_id, flat_id)

Indexes:
- `CREATE UNIQUE INDEX domestic_staff_assignments_domestic_staff_id_flat_id_key ON public.domestic_staff_assignments USING btree (domestic_staff_id, flat_id)`
- `CREATE INDEX domestic_staff_assignments_flat_idx ON public.domestic_staff_assignments USING btree (flat_id) WHERE active`

### flats

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| tower_id | uuid | no |  |
| floor | integer | no |  |
| number | text | no |  |
| label | text | no |  |
| created_at | timestamp with time zone | no | now() |
| updated_at | timestamp with time zone | no | now() |

Constraints:
- `flats_floor_check`: CHECK ((floor >= 0))
- `flats_label_check`: CHECK ((length(btrim(label)) > 0))
- `flats_number_check`: CHECK ((length(btrim(number)) > 0))
- `flats_tower_id_society_id_fkey`: FOREIGN KEY (tower_id, society_id) REFERENCES towers(id, society_id)
- `flats_pkey`: PRIMARY KEY (id)
- `flats_id_society_id_key`: UNIQUE (id, society_id)
- `flats_society_id_label_key`: UNIQUE (society_id, label)
- `flats_tower_id_number_key`: UNIQUE (tower_id, number)

Indexes:
- `CREATE UNIQUE INDEX flats_id_society_id_key ON public.flats USING btree (id, society_id)`
- `CREATE UNIQUE INDEX flats_society_id_label_key ON public.flats USING btree (society_id, label)`
- `CREATE INDEX flats_society_idx ON public.flats USING btree (society_id)`
- `CREATE UNIQUE INDEX flats_tower_id_number_key ON public.flats USING btree (tower_id, number)`

### gate_devices

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| gate_id | uuid | no |  |
| staff_id | uuid | no |  |
| user_device_id | uuid | yes |  |
| device_label | text | yes |  |
| status | text | no | 'active'::text |
| paired_at | timestamp with time zone | no | now() |
| last_seen_at | timestamp with time zone | yes |  |
| revoked_at | timestamp with time zone | yes |  |
| revoked_by_user_id | uuid | yes |  |

Constraints:
- `gate_devices_check`: CHECK (((status = 'revoked'::text) = (revoked_at IS NOT NULL)))
- `gate_devices_status_check`: CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
- `gate_devices_gate_id_society_id_fkey`: FOREIGN KEY (gate_id, society_id) REFERENCES gates(id, society_id)
- `gate_devices_revoked_by_user_id_fkey`: FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
- `gate_devices_staff_id_society_id_fkey`: FOREIGN KEY (staff_id, society_id) REFERENCES society_staff(id, society_id)
- `gate_devices_user_device_id_fkey`: FOREIGN KEY (user_device_id) REFERENCES user_devices(id) ON DELETE SET NULL
- `gate_devices_pkey`: PRIMARY KEY (id)
- `gate_devices_id_society_id_key`: UNIQUE (id, society_id)

Indexes:
- `CREATE UNIQUE INDEX gate_devices_device_uidx ON public.gate_devices USING btree (user_device_id) WHERE ((status = 'active'::text) AND (user_device_id IS NOT NULL))`
- `CREATE INDEX gate_devices_gate_idx ON public.gate_devices USING btree (gate_id) WHERE (status = 'active'::text)`
- `CREATE UNIQUE INDEX gate_devices_id_society_id_key ON public.gate_devices USING btree (id, society_id)`

### gates

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| name | text | no |  |
| status | text | no | 'active'::text |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `gates_name_check`: CHECK ((length(btrim(name)) > 0))
- `gates_status_check`: CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
- `gates_society_id_fkey`: FOREIGN KEY (society_id) REFERENCES societies(id)
- `gates_pkey`: PRIMARY KEY (id)
- `gates_id_society_id_key`: UNIQUE (id, society_id)
- `gates_society_id_name_key`: UNIQUE (society_id, name)

Indexes:
- `CREATE UNIQUE INDEX gates_id_society_id_key ON public.gates USING btree (id, society_id)`
- `CREATE UNIQUE INDEX gates_society_id_name_key ON public.gates USING btree (society_id, name)`

### notices

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| title | text | no |  |
| body | text | no |  |
| pinned | boolean | no | false |
| publish_at | timestamp with time zone | no | now() |
| expires_at | timestamp with time zone | yes |  |
| created_by_user_id | uuid | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `notices_check`: CHECK (((expires_at IS NULL) OR (expires_at > publish_at)))
- `notices_title_check`: CHECK ((length(btrim(title)) > 0))
- `notices_created_by_user_id_fkey`: FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
- `notices_society_id_fkey`: FOREIGN KEY (society_id) REFERENCES societies(id)
- `notices_pkey`: PRIMARY KEY (id)

Indexes:
- `CREATE INDEX notices_society_idx ON public.notices USING btree (society_id, publish_at DESC)`

### otp_requests

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| phone | text | no |  |
| code_hash | text | no |  |
| purpose | text | no | 'login'::text |
| expires_at | timestamp with time zone | no |  |
| attempts | smallint | no | 0 |
| max_attempts | smallint | no | 5 |
| consumed_at | timestamp with time zone | yes |  |
| request_ip | inet | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `otp_requests_phone_check`: CHECK ((phone ~ '^\+[1-9][0-9]{7,14}$'::text))
- `otp_requests_purpose_check`: CHECK ((purpose = 'login'::text))
- `otp_requests_pkey`: PRIMARY KEY (id)

Indexes:
- `CREATE INDEX otp_requests_phone_idx ON public.otp_requests USING btree (phone, created_at DESC)`

### residents

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| flat_id | uuid | no |  |
| user_id | uuid | yes |  |
| full_name | text | no |  |
| phone | text | yes |  |
| photo_path | text | yes |  |
| resident_type | text | no |  |
| relation_to_head | text | no | 'other'::text |
| is_head | boolean | no | false |
| receives_alerts | boolean | no | false |
| status | text | no | 'pending'::text |
| source | text | no |  |
| invite_code_used | text | yes |  |
| decided_by_user_id | uuid | yes |  |
| decided_at | timestamp with time zone | yes |  |
| decision_note | text | yes |  |
| moved_out_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone | no | now() |
| updated_at | timestamp with time zone | no | now() |

Constraints:
- `residents_check`: CHECK (((NOT receives_alerts) OR (phone IS NOT NULL)))
- `residents_check1`: CHECK (((NOT is_head) OR (relation_to_head = 'head'::text)))
- `residents_check2`: CHECK ((((status = ANY (ARRAY['active'::text, 'declined'::text, 'moved_out'::text])) = (decided_at IS NOT NULL)) OR (source = 'admin'::text)))
- `residents_full_name_check`: CHECK ((length(btrim(full_name)) > 0))
- `residents_phone_check`: CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{7,14}$'::text)))
- `residents_relation_to_head_check`: CHECK ((relation_to_head = ANY (ARRAY['head'::text, 'spouse'::text, 'son'::text, 'daughter'::text, 'parent'::text, 'sibling'::text, 'other'::text])))
- `residents_resident_type_check`: CHECK ((resident_type = ANY (ARRAY['owner'::text, 'tenant'::text, 'family_member'::text])))
- `residents_source_check`: CHECK ((source = ANY (ARRAY['admin'::text, 'self'::text])))
- `residents_status_check`: CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'declined'::text, 'moved_out'::text])))
- `residents_decided_by_user_id_fkey`: FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE SET NULL
- `residents_flat_id_society_id_fkey`: FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id)
- `residents_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
- `residents_pkey`: PRIMARY KEY (id)
- `residents_id_society_id_key`: UNIQUE (id, society_id)

Indexes:
- `CREATE INDEX residents_flat_idx ON public.residents USING btree (flat_id)`
- `CREATE UNIQUE INDEX residents_id_society_id_key ON public.residents USING btree (id, society_id)`
- `CREATE UNIQUE INDEX residents_one_head_uidx ON public.residents USING btree (flat_id) WHERE (is_head AND (status = 'active'::text))`
- `CREATE INDEX residents_pending_idx ON public.residents USING btree (society_id, created_at) WHERE (status = 'pending'::text)`
- `CREATE INDEX residents_phone_idx ON public.residents USING btree (phone)`
- `CREATE UNIQUE INDEX residents_phone_uidx ON public.residents USING btree (society_id, phone) WHERE ((phone IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'active'::text])))`
- `CREATE INDEX residents_user_idx ON public.residents USING btree (user_id)`

### societies

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| name | text | no |  |
| slug | text | no |  |
| address_line | text | yes |  |
| city | text | yes |  |
| state | text | yes |  |
| pincode | text | yes |  |
| invite_code | text | no |  |
| invite_code_rotated_at | timestamp with time zone | no | now() |
| status | text | no | 'active'::text |
| approval_wait_seconds | integer | no | 60 |
| overstay_minutes | integer | no | 120 |
| photo_retention_days | integer | no | 90 |
| settings | jsonb | no | '{}'::jsonb |
| created_at | timestamp with time zone | no | now() |
| updated_at | timestamp with time zone | no | now() |
| deleted_at | timestamp with time zone | yes |  |

Constraints:
- `societies_approval_wait_seconds_check`: CHECK (((approval_wait_seconds >= 15) AND (approval_wait_seconds <= 600)))
- `societies_invite_code_check`: CHECK ((invite_code ~ '^[A-Z0-9-]{4,20}$'::text))
- `societies_name_check`: CHECK ((length(btrim(name)) > 0))
- `societies_overstay_minutes_check`: CHECK (((overstay_minutes >= 5) AND (overstay_minutes <= 1440)))
- `societies_photo_retention_days_check`: CHECK (((photo_retention_days >= 7) AND (photo_retention_days <= 365)))
- `societies_pincode_check`: CHECK (((pincode IS NULL) OR (pincode ~ '^[0-9]{6}$'::text)))
- `societies_slug_check`: CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
- `societies_status_check`: CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
- `societies_pkey`: PRIMARY KEY (id)
- `societies_invite_code_key`: UNIQUE (invite_code)
- `societies_slug_key`: UNIQUE (slug)

Indexes:
- `CREATE UNIQUE INDEX societies_invite_code_key ON public.societies USING btree (invite_code)`
- `CREATE UNIQUE INDEX societies_slug_key ON public.societies USING btree (slug)`

### society_staff

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| user_id | uuid | yes |  |
| role | text | no |  |
| full_name | text | no |  |
| phone | text | no |  |
| photo_path | text | yes |  |
| shift | text | yes |  |
| status | text | no | 'invited'::text |
| created_by_user_id | uuid | yes |  |
| created_at | timestamp with time zone | no | now() |
| updated_at | timestamp with time zone | no | now() |

Constraints:
- `society_staff_check`: CHECK (((role = 'guard'::text) OR (shift IS NULL)))
- `society_staff_full_name_check`: CHECK ((length(btrim(full_name)) > 0))
- `society_staff_phone_check`: CHECK ((phone ~ '^\+[1-9][0-9]{7,14}$'::text))
- `society_staff_role_check`: CHECK ((role = ANY (ARRAY['admin'::text, 'guard'::text])))
- `society_staff_shift_check`: CHECK ((shift = ANY (ARRAY['day'::text, 'night'::text, 'general'::text])))
- `society_staff_status_check`: CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'suspended'::text, 'removed'::text])))
- `society_staff_created_by_user_id_fkey`: FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
- `society_staff_society_id_fkey`: FOREIGN KEY (society_id) REFERENCES societies(id)
- `society_staff_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
- `society_staff_pkey`: PRIMARY KEY (id)
- `society_staff_id_society_id_key`: UNIQUE (id, society_id)
- `society_staff_society_id_phone_role_key`: UNIQUE (society_id, phone, role)

Indexes:
- `CREATE UNIQUE INDEX society_staff_id_society_id_key ON public.society_staff USING btree (id, society_id)`
- `CREATE INDEX society_staff_phone_idx ON public.society_staff USING btree (phone)`
- `CREATE UNIQUE INDEX society_staff_society_id_phone_role_key ON public.society_staff USING btree (society_id, phone, role)`
- `CREATE INDEX society_staff_user_idx ON public.society_staff USING btree (user_id)`

### sos_alerts

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| gate_id | uuid | yes |  |
| raised_by_staff_id | uuid | yes |  |
| raised_by_resident_id | uuid | yes |  |
| kind | text | no |  |
| status | text | no | 'open'::text |
| note | text | yes |  |
| raised_at | timestamp with time zone | no | now() |
| acknowledged_by_user_id | uuid | yes |  |
| acknowledged_at | timestamp with time zone | yes |  |
| resolved_by_user_id | uuid | yes |  |
| resolved_at | timestamp with time zone | yes |  |

Constraints:
- `sos_alerts_check`: CHECK (((raised_by_staff_id IS NOT NULL) OR (raised_by_resident_id IS NOT NULL)))
- `sos_alerts_check1`: CHECK (((status = 'resolved'::text) = (resolved_at IS NOT NULL)))
- `sos_alerts_kind_check`: CHECK ((kind = ANY (ARRAY['fire'::text, 'medical'::text, 'intruder'::text, 'other'::text])))
- `sos_alerts_status_check`: CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text])))
- `sos_alerts_acknowledged_by_user_id_fkey`: FOREIGN KEY (acknowledged_by_user_id) REFERENCES users(id) ON DELETE SET NULL
- `sos_alerts_gate_id_society_id_fkey`: FOREIGN KEY (gate_id, society_id) REFERENCES gates(id, society_id)
- `sos_alerts_raised_by_resident_id_society_id_fkey`: FOREIGN KEY (raised_by_resident_id, society_id) REFERENCES residents(id, society_id)
- `sos_alerts_raised_by_staff_id_society_id_fkey`: FOREIGN KEY (raised_by_staff_id, society_id) REFERENCES society_staff(id, society_id)
- `sos_alerts_resolved_by_user_id_fkey`: FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
- `sos_alerts_society_id_fkey`: FOREIGN KEY (society_id) REFERENCES societies(id)
- `sos_alerts_pkey`: PRIMARY KEY (id)

Indexes:
- `CREATE INDEX sos_alerts_open_idx ON public.sos_alerts USING btree (society_id, raised_at DESC) WHERE (status <> 'resolved'::text)`

### towers

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| name | text | no |  |
| floors | integer | no |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `towers_floors_check`: CHECK (((floors >= 1) AND (floors <= 120)))
- `towers_name_check`: CHECK ((length(btrim(name)) > 0))
- `towers_society_id_fkey`: FOREIGN KEY (society_id) REFERENCES societies(id)
- `towers_pkey`: PRIMARY KEY (id)
- `towers_id_society_id_key`: UNIQUE (id, society_id)
- `towers_society_id_name_key`: UNIQUE (society_id, name)

Indexes:
- `CREATE UNIQUE INDEX towers_id_society_id_key ON public.towers USING btree (id, society_id)`
- `CREATE UNIQUE INDEX towers_society_id_name_key ON public.towers USING btree (society_id, name)`

### user_devices

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| user_id | uuid | no |  |
| platform | text | no |  |
| push_token | text | no |  |
| app_version | text | yes |  |
| last_seen_at | timestamp with time zone | yes |  |
| revoked_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `user_devices_platform_check`: CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text])))
- `user_devices_user_id_fkey`: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
- `user_devices_pkey`: PRIMARY KEY (id)
- `user_devices_push_token_key`: UNIQUE (push_token)

Indexes:
- `CREATE UNIQUE INDEX user_devices_push_token_key ON public.user_devices USING btree (push_token)`
- `CREATE INDEX user_devices_user_idx ON public.user_devices USING btree (user_id) WHERE (revoked_at IS NULL)`

### users

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| phone | text | no |  |
| full_name | text | yes |  |
| photo_path | text | yes |  |
| language | text | no | 'en'::text |
| status | text | no | 'active'::text |
| phone_verified_at | timestamp with time zone | yes |  |
| last_login_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone | no | now() |
| updated_at | timestamp with time zone | no | now() |

Constraints:
- `users_language_check`: CHECK ((language = ANY (ARRAY['en'::text, 'hi'::text])))
- `users_phone_check`: CHECK ((phone ~ '^\+[1-9][0-9]{7,14}$'::text))
- `users_status_check`: CHECK ((status = ANY (ARRAY['active'::text, 'blocked'::text])))
- `users_pkey`: PRIMARY KEY (id)
- `users_phone_key`: UNIQUE (phone)

Indexes:
- `CREATE UNIQUE INDEX users_phone_key ON public.users USING btree (phone)`

### visit_notifications

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| visit_id | uuid | no |  |
| resident_id | uuid | yes |  |
| channel | text | no |  |
| step | smallint | no |  |
| status | text | no | 'scheduled'::text |
| scheduled_for | timestamp with time zone | no | now() |
| sent_at | timestamp with time zone | yes |  |
| viewed_at | timestamp with time zone | yes |  |
| provider_ref | text | yes |  |
| error | text | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `visit_notifications_channel_check`: CHECK ((channel = ANY (ARRAY['push'::text, 'sms'::text, 'voice_call'::text, 'manual_call'::text])))
- `visit_notifications_status_check`: CHECK ((status = ANY (ARRAY['scheduled'::text, 'sent'::text, 'delivered'::text, 'answered'::text, 'failed'::text, 'cancelled'::text])))
- `visit_notifications_step_check`: CHECK (((step >= 1) AND (step <= 5)))
- `visit_notifications_resident_id_society_id_fkey`: FOREIGN KEY (resident_id, society_id) REFERENCES residents(id, society_id)
- `visit_notifications_visit_id_society_id_fkey`: FOREIGN KEY (visit_id, society_id) REFERENCES visits(id, society_id)
- `visit_notifications_pkey`: PRIMARY KEY (id)

Indexes:
- `CREATE INDEX visit_notifications_due_idx ON public.visit_notifications USING btree (scheduled_for) WHERE (status = 'scheduled'::text)`
- `CREATE INDEX visit_notifications_visit_idx ON public.visit_notifications USING btree (visit_id)`

### visit_passes

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| flat_id | uuid | no |  |
| created_by_resident_id | uuid | no |  |
| guest_name | text | no |  |
| guest_phone | text | yes |  |
| category | text | no | 'guest'::text |
| valid_from | timestamp with time zone | no |  |
| valid_until | timestamp with time zone | no |  |
| max_entries | integer | yes |  |
| entries_used | integer | no | 0 |
| vehicle_number | text | yes |  |
| code | text | no |  |
| status | text | no | 'active'::text |
| cancelled_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `visit_passes_category_check`: CHECK ((category = ANY (ARRAY['guest'::text, 'delivery'::text, 'cab'::text, 'service'::text])))
- `visit_passes_check`: CHECK ((valid_until > valid_from))
- `visit_passes_check1`: CHECK (((max_entries IS NULL) OR (entries_used <= max_entries)))
- `visit_passes_check2`: CHECK (((status = 'cancelled'::text) = (cancelled_at IS NOT NULL)))
- `visit_passes_code_check`: CHECK ((code ~ '^[0-9]{6}$'::text))
- `visit_passes_entries_used_check`: CHECK ((entries_used >= 0))
- `visit_passes_guest_name_check`: CHECK ((length(btrim(guest_name)) > 0))
- `visit_passes_guest_phone_check`: CHECK (((guest_phone IS NULL) OR (guest_phone ~ '^\+[1-9][0-9]{7,14}$'::text)))
- `visit_passes_max_entries_check`: CHECK (((max_entries IS NULL) OR (max_entries > 0)))
- `visit_passes_status_check`: CHECK ((status = ANY (ARRAY['active'::text, 'used'::text, 'expired'::text, 'cancelled'::text])))
- `visit_passes_created_by_resident_id_society_id_fkey`: FOREIGN KEY (created_by_resident_id, society_id) REFERENCES residents(id, society_id)
- `visit_passes_flat_id_society_id_fkey`: FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id)
- `visit_passes_pkey`: PRIMARY KEY (id)
- `visit_passes_id_society_id_key`: UNIQUE (id, society_id)

Indexes:
- `CREATE UNIQUE INDEX visit_passes_code_uidx ON public.visit_passes USING btree (society_id, code) WHERE (status = 'active'::text)`
- `CREATE INDEX visit_passes_flat_idx ON public.visit_passes USING btree (flat_id, valid_until DESC)`
- `CREATE UNIQUE INDEX visit_passes_id_society_id_key ON public.visit_passes USING btree (id, society_id)`

### visitor_blocks

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| flat_id | uuid | yes |  |
| visitor_id | uuid | yes |  |
| phone | text | yes |  |
| reason | text | yes |  |
| created_by_user_id | uuid | yes |  |
| created_at | timestamp with time zone | no | now() |
| lifted_at | timestamp with time zone | yes |  |

Constraints:
- `visitor_blocks_check`: CHECK (((visitor_id IS NOT NULL) OR (phone IS NOT NULL)))
- `visitor_blocks_phone_check`: CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{7,14}$'::text)))
- `visitor_blocks_created_by_user_id_fkey`: FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
- `visitor_blocks_flat_id_society_id_fkey`: FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id)
- `visitor_blocks_society_id_fkey`: FOREIGN KEY (society_id) REFERENCES societies(id)
- `visitor_blocks_visitor_id_society_id_fkey`: FOREIGN KEY (visitor_id, society_id) REFERENCES visitors(id, society_id)
- `visitor_blocks_pkey`: PRIMARY KEY (id)

Indexes:
- `CREATE INDEX visitor_blocks_active_idx ON public.visitor_blocks USING btree (society_id) WHERE (lifted_at IS NULL)`

### visitors

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| full_name | text | no |  |
| phone | text | yes |  |
| photo_path | text | yes |  |
| created_at | timestamp with time zone | no | now() |

Constraints:
- `visitors_full_name_check`: CHECK ((length(btrim(full_name)) > 0))
- `visitors_phone_check`: CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{7,14}$'::text)))
- `visitors_society_id_fkey`: FOREIGN KEY (society_id) REFERENCES societies(id)
- `visitors_pkey`: PRIMARY KEY (id)
- `visitors_id_society_id_key`: UNIQUE (id, society_id)

Indexes:
- `CREATE UNIQUE INDEX visitors_id_society_id_key ON public.visitors USING btree (id, society_id)`
- `CREATE INDEX visitors_phone_idx ON public.visitors USING btree (society_id, phone) WHERE (phone IS NOT NULL)`

### visits

| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| society_id | uuid | no |  |
| gate_id | uuid | no |  |
| flat_id | uuid | no |  |
| visitor_id | uuid | yes |  |
| visitor_name | text | no |  |
| visitor_phone | text | yes |  |
| visitor_company | text | yes |  |
| photo_path | text | yes |  |
| photo_purged_at | timestamp with time zone | yes |  |
| vehicle_number | text | yes |  |
| purpose | text | no |  |
| entry_type | text | no |  |
| pass_id | uuid | yes |  |
| domestic_staff_id | uuid | yes |  |
| status | text | no |  |
| requested_at | timestamp with time zone | no | now() |
| decided_at | timestamp with time zone | yes |  |
| decided_by_resident_id | uuid | yes |  |
| decision_note | text | yes |  |
| leave_at_gate | boolean | no | false |
| entered_at | timestamp with time zone | yes |  |
| exited_at | timestamp with time zone | yes |  |
| logged_by_staff_id | uuid | no |  |
| entered_by_staff_id | uuid | yes |  |
| exited_by_staff_id | uuid | yes |  |
| created_at | timestamp with time zone | no | now() |
| updated_at | timestamp with time zone | no | now() |

Constraints:
- `visits_check`: CHECK (((status = ANY (ARRAY['entered'::text, 'exited'::text])) = (entered_at IS NOT NULL)))
- `visits_check1`: CHECK (((status = 'exited'::text) = (exited_at IS NOT NULL)))
- `visits_check2`: CHECK (((exited_at IS NULL) OR (exited_at >= entered_at)))
- `visits_check3`: CHECK (((entry_type <> 'pre_approved'::text) OR (pass_id IS NOT NULL)))
- `visits_check4`: CHECK (((entry_type <> 'staff'::text) OR (domestic_staff_id IS NOT NULL)))
- `visits_check5`: CHECK (((entry_type = 'walk_in'::text) OR (status <> ALL (ARRAY['pending'::text, 'denied'::text, 'not_reached'::text]))))
- `visits_check6`: CHECK (((status <> 'approved'::text) OR (decided_at IS NOT NULL) OR (entry_type <> 'walk_in'::text)))
- `visits_entry_type_check`: CHECK ((entry_type = ANY (ARRAY['walk_in'::text, 'pre_approved'::text, 'staff'::text])))
- `visits_purpose_check`: CHECK ((purpose = ANY (ARRAY['guest'::text, 'delivery'::text, 'cab'::text, 'service'::text, 'staff'::text, 'other'::text])))
- `visits_status_check`: CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'not_reached'::text, 'cancelled'::text, 'entered'::text, 'exited'::text])))
- `visits_visitor_name_check`: CHECK ((length(btrim(visitor_name)) > 0))
- `visits_visitor_phone_check`: CHECK (((visitor_phone IS NULL) OR (visitor_phone ~ '^\+[1-9][0-9]{7,14}$'::text)))
- `visits_decided_by_resident_id_society_id_fkey`: FOREIGN KEY (decided_by_resident_id, society_id) REFERENCES residents(id, society_id)
- `visits_domestic_staff_id_society_id_fkey`: FOREIGN KEY (domestic_staff_id, society_id) REFERENCES domestic_staff(id, society_id)
- `visits_entered_by_staff_id_society_id_fkey`: FOREIGN KEY (entered_by_staff_id, society_id) REFERENCES society_staff(id, society_id)
- `visits_exited_by_staff_id_society_id_fkey`: FOREIGN KEY (exited_by_staff_id, society_id) REFERENCES society_staff(id, society_id)
- `visits_flat_id_society_id_fkey`: FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id)
- `visits_gate_id_society_id_fkey`: FOREIGN KEY (gate_id, society_id) REFERENCES gates(id, society_id)
- `visits_logged_by_staff_id_society_id_fkey`: FOREIGN KEY (logged_by_staff_id, society_id) REFERENCES society_staff(id, society_id)
- `visits_pass_id_society_id_fkey`: FOREIGN KEY (pass_id, society_id) REFERENCES visit_passes(id, society_id)
- `visits_visitor_id_society_id_fkey`: FOREIGN KEY (visitor_id, society_id) REFERENCES visitors(id, society_id)
- `visits_pkey`: PRIMARY KEY (id)
- `visits_id_society_id_key`: UNIQUE (id, society_id)

Indexes:
- `CREATE INDEX visits_flat_idx ON public.visits USING btree (flat_id, requested_at DESC)`
- `CREATE UNIQUE INDEX visits_id_society_id_key ON public.visits USING btree (id, society_id)`
- `CREATE INDEX visits_inside_idx ON public.visits USING btree (society_id, entered_at DESC) WHERE (status = 'entered'::text)`
- `CREATE INDEX visits_pending_idx ON public.visits USING btree (society_id, requested_at) WHERE (status = 'pending'::text)`
- `CREATE INDEX visits_photo_idx ON public.visits USING btree (requested_at) WHERE (photo_path IS NOT NULL)`
- `CREATE INDEX visits_society_idx ON public.visits USING btree (society_id, requested_at DESC)`

## Views

### v_inside_now
```sql
 SELECT v.id AS visit_id, v.society_id, v.gate_id, f.label AS flat_label, v.visitor_name, v.purpose, v.vehicle_number, v.entered_at, (now() - v.entered_at) AS inside_for, ((now() - v.entered_at) > make_interval(mins => s.overstay_minutes)) AS is_overstay FROM ((visits v JOIN flats f ON (((f.id = v.flat_id) AND (f.society_id = v.society_id)))) JOIN societies s ON ((s.id = v.society_id))) WHERE (v.status = 'entered'::text);
```

### v_pending_join_requests
```sql
 SELECT r.id AS resident_id, r.society_id, r.full_name, r.phone, r.resident_type, f.label AS flat_label, r.invite_code_used, r.created_at FROM (residents r JOIN flats f ON (((f.id = r.flat_id) AND (f.society_id = r.society_id)))) WHERE (r.status = 'pending'::text);
```

### v_visit_photos_due_for_purge
```sql
 SELECT v.id AS visit_id, v.society_id, v.photo_path FROM (visits v JOIN societies s ON ((s.id = v.society_id))) WHERE ((v.photo_path IS NOT NULL) AND (v.requested_at < (now() - make_interval(days => s.photo_retention_days))));
```
