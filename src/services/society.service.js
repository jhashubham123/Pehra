const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { throwDatabaseError } = require('../utils/databaseError');
const auditService = require('./audit.service');
const { makeInviteCode } = require('./inviteCode.service');

async function getSociety(auth) {
  const { rows } = await query(
    `select s.id, s.name, s.slug, s.address_line, s.city, s.state, s.pincode,
            s.invite_code, s.approval_wait_seconds, s.overstay_minutes, s.photo_retention_days,
            (select count(*)::int from towers t where t.society_id = s.id) as towers,
            (select count(*)::int from flats f where f.society_id = s.id) as flats,
            (select count(*)::int from residents r where r.society_id = s.id and r.status = 'active') as active_residents,
            (select count(*)::int from residents r where r.society_id = s.id and r.status = 'pending') as pending_requests,
            (select count(*)::int from society_staff st where st.society_id = s.id and st.role = 'guard' and st.status = 'active') as active_guards
       from societies s
      where s.id = $1 and s.deleted_at is null`,
    [auth.societyId]
  );
  if (!rows[0]) throw new ApiError(404, 'Society not found.');
  return rows[0];
}

async function updateSociety(auth, changes) {
  const columns = {
    name: 'name',
    address_line: 'address_line',
    city: 'city',
    state: 'state',
    pincode: 'pincode',
    approval_wait_seconds: 'approval_wait_seconds',
    overstay_minutes: 'overstay_minutes',
    photo_retention_days: 'photo_retention_days',
  };
  const values = [auth.societyId];
  const assignments = Object.entries(changes).map(([field, value]) => {
    values.push(value);
    return `${columns[field]} = $${values.length}`;
  });
  try {
    const { rows } = await query(
      `update societies set ${assignments.join(', ')}
        where id = $1 and deleted_at is null
        returning id, name, slug, address_line, city, state, pincode, invite_code,
                  approval_wait_seconds, overstay_minutes, photo_retention_days`,
      values
    );
    if (!rows[0]) throw new ApiError(404, 'Society not found.');
    return rows[0];
  } catch (error) {
    throwDatabaseError(error, { alreadyExists: 'Society' });
  }
}

async function rotateInviteCode(auth) {
  const society = await query(
    'select name from societies where id = $1 and deleted_at is null',
    [auth.societyId]
  );
  if (!society.rows[0]) throw new ApiError(404, 'Society not found.');

  for (let attempt = 0; attempt < 10; attempt++) {
    const inviteCode = makeInviteCode(society.rows[0].name);
    try {
      return await transaction(async (db) => {
        const { rows } = await db.query(
          `update societies
              set invite_code = $2, invite_code_rotated_at = now()
            where id = $1 and deleted_at is null
            returning id`,
          [auth.societyId, inviteCode]
        );
        if (!rows[0]) throw new ApiError(404, 'Society not found.');
        await auditService.log(db, {
          societyId: auth.societyId,
          actorUserId: auth.userId,
          actorRole: auth.role,
          action: 'rotate_invite_code',
          entityType: 'society',
          entityId: auth.societyId,
        });
        return { invite_code: inviteCode };
      });
    } catch (error) {
      if (error.code !== '23505' || error.constraint !== 'societies_invite_code_key') {
        throwDatabaseError(error, { alreadyExists: 'Society invite code' });
      }
    }
  }
  throw new ApiError(500, 'Could not create a society code. Please try again.');
}

module.exports = { getSociety, updateSociety, rotateInviteCode };
