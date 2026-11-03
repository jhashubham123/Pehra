// Guard phones are tied to a gate with a short code that only an admin can create.
const env = require('../config/env');
const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { randomDigits, hmac } = require('../utils/crypto');
const tokenService = require('./token.service');
const profileService = require('./profile.service');

const hashCode = (code) => hmac(`pairing:${code}`);

// Admin: "Generate code" for a gate.
async function createPairingCode(auth, { gate_id: gateId, staff_id: staffId }) {
  const gate = await query(
    `select id, name from gates where id = $1 and society_id = $2 and status = 'active'`,
    [gateId, auth.societyId]
  );
  if (!gate.rows[0]) throw new ApiError(404, 'Gate not found in your society.');

  if (staffId) {
    const staff = await query(
      `select id from society_staff where id = $1 and society_id = $2 and role = 'guard' and status in ('invited','active')`,
      [staffId, auth.societyId]
    );
    if (!staff.rows[0]) throw new ApiError(404, 'Guard not found in your society.');
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomDigits(6);
    try {
      const { rows } = await query(
        `insert into device_pairing_codes (society_id, gate_id, staff_id, code_hash, expires_at, created_by_user_id)
         values ($1, $2, $3, $4, now() + make_interval(mins => $5), $6)
         returning expires_at`,
        [auth.societyId, gateId, staffId || null, hashCode(code), env.pairingCodeMinutes, auth.userId]
      );
      return { code, gate: gate.rows[0], expires_at: rows[0].expires_at }; // shown once, never stored in plain text
    } catch (err) {
      if (err.code !== '23505') throw err; // 23505 = another open code has the same hash, try again
    }
  }
  throw new ApiError(500, 'Could not create a code. Please try again.');
}

// Guard: types the code on the phone at the gate.
async function pairDevice(auth, body) {
  await transaction(async (db) => {
    const found = await db.query(
      `select id, society_id, gate_id, staff_id from device_pairing_codes
        where code_hash = $1 and used_at is null and expires_at > now() for update`,
      [hashCode(body.code)]
    );
    const code = found.rows[0];
    // same message for "wrong" and "other society" so nobody can probe codes
    if (!code || code.society_id !== auth.societyId) throw new ApiError(400, 'Invalid or expired code.');
    if (code.staff_id && code.staff_id !== auth.profileId) {
      throw new ApiError(403, 'This code was made for a different guard.');
    }

    const device = await db.query(
      `insert into user_devices (user_id, platform, push_token, last_seen_at)
       values ($1, $2, $3, now())
       on conflict (push_token) do update
          set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now(), revoked_at = null
       returning id`,
      [auth.userId, body.platform, body.push_token]
    );
    const deviceId = device.rows[0].id;

    // this phone and this guard each keep only one active pairing
    await db.query(
      `update gate_devices set status = 'revoked', revoked_at = now(), revoked_by_user_id = $3
        where status = 'active' and (user_device_id = $1 or staff_id = $2)`,
      [deviceId, auth.profileId, auth.userId]
    );
    await db.query(
      `insert into gate_devices (society_id, gate_id, staff_id, user_device_id, device_label)
       values ($1, $2, $3, $4, $5)`,
      [auth.societyId, code.gate_id, auth.profileId, deviceId, body.device_label || null]
    );
    await db.query(`update device_pairing_codes set used_at = now() where id = $1`, [code.id]);
  });

  // reload the guard's profile: it now includes the gate, and the new token carries gate_id
  const profiles = await profileService.loadProfiles(auth.userId);
  const profile = profileService.findProfile(profiles, 'guard', auth.societyId);
  return { ...tokenService.accessTokenResponse(auth.userId, profile), active_profile: profile };
}

module.exports = { createPairingCode, pairDevice };
