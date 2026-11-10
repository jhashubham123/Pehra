// First steps for a brand-new person: create a society (become its admin) or ask to join one.
const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { randomDigits, randomToken } = require('../utils/crypto');
const { makeInviteCode } = require('./inviteCode.service');
const tokenService = require('./token.service');
const profileService = require('./profile.service');
const authService = require('./auth.service');
const auditService = require('./audit.service');

function makeSlug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'society';
  const suffix = randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || randomDigits(4);
  return `${base.slice(0, 50).replace(/-+$/, '')}-${suffix}`;
}

// Society president opens the app for the first time.
async function registerSociety(auth, body) {
  const user = await authService.getUser(auth.userId);
  let inviteCode;
  let societyId;
  for (let attempt = 0; attempt < 10; attempt++) {
    inviteCode = makeInviteCode(body.society_name);
    try {
      societyId = await transaction(async (db) => {
        const society = await db.query(
          `insert into societies (name, slug, address_line, city, state, pincode, invite_code)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [
            body.society_name,
            makeSlug(body.society_name),
            body.address_line || null,
            body.city || null,
            body.state || null,
            body.pincode || null,
            inviteCode,
          ]
        );
        const id = society.rows[0].id;

        await db.query(
          `insert into society_staff (society_id, user_id, role, full_name, phone, status, created_by_user_id)
           values ($1, $2, 'admin', $3, $4, 'active', $2)`,
          [id, user.id, body.admin_name, user.phone]
        );
        const gate = await db.query(
          `insert into gates (society_id, name) values ($1, 'Main Gate') returning id`,
          [id]
        );
        await auditService.log(db, {
          societyId: id,
          actorUserId: user.id,
          actorRole: 'admin',
          action: 'create',
          entityType: 'gate',
          entityId: gate.rows[0].id,
          metadata: { name: 'Main Gate' },
        });
        await db.query(`update users set full_name = coalesce(full_name, $2) where id = $1`, [user.id, body.admin_name]);
        return id;
      });
      break;
    } catch (error) {
      if (error.code !== '23505' || error.constraint !== 'societies_invite_code_key') throw error;
    }
  }
  if (!societyId) throw new ApiError(500, 'Could not create a society code. Please try again.');

  const profiles = await profileService.loadProfiles(user.id);
  const profile = profileService.findProfile(profiles, 'admin', societyId);
  return {
    ...tokenService.accessTokenResponse(user.id, profile),
    active_profile: profile,
    society: { id: societyId, name: body.society_name, invite_code: inviteCode },
  };
}

// A resident types the society code + flat number. Admin approves later.
async function joinAsResident(auth, body) {
  const user = await authService.getUser(auth.userId);

  const society = await query(
    `select id, name from societies where invite_code = $1 and status = 'active' and deleted_at is null`,
    [body.invite_code]
  );
  if (!society.rows[0]) throw new ApiError(404, 'Society code not found. Check it with your admin.');
  const { id: societyId, name: societyName } = society.rows[0];

  const flat = await query(`select id, label from flats where society_id = $1 and upper(label) = $2`, [
    societyId,
    body.flat_label,
  ]);
  if (!flat.rows[0]) throw new ApiError(404, `Flat ${body.flat_label} was not found in ${societyName}.`);

  try {
    await query(
      `insert into residents (society_id, flat_id, user_id, full_name, phone, resident_type,
                              relation_to_head, status, source, invite_code_used)
       values ($1, $2, $3, $4, $5, $6, $7, 'pending', 'self', $8)`,
      [
        societyId,
        flat.rows[0].id,
        user.id,
        body.full_name,
        user.phone,
        body.resident_type,
        body.relation_to_head || 'other',
        body.invite_code,
      ]
    );
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'You already have a request or registration in this society.');
    throw err;
  }
  await query(`update users set full_name = coalesce(full_name, $2) where id = $1`, [user.id, body.full_name]);

  const profiles = await profileService.loadProfiles(user.id);
  const profile = profileService.findProfile(profiles, 'resident', societyId);
  return {
    ...tokenService.accessTokenResponse(user.id, profile),
    active_profile: profile,
    message: 'Request sent. You can use the app once the admin approves.',
  };
}

module.exports = { registerSociety, joinAsResident };
