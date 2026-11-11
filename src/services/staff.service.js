const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { offset, pageResult } = require('../utils/pagination');
const auditService = require('./audit.service');

const staffSelect = `select ss.id, ss.full_name, ss.phone, ss.role, ss.shift, ss.status,
                            ss.photo_path, ss.user_id is not null as has_logged_in,
                            gd.id is not null as paired, gd.gate_id, g.name as gate_name,
                            coalesce(ud.last_seen_at, gd.last_seen_at) as device_last_seen_at,
                            ss.created_at
                       from society_staff ss
                       left join lateral (
                         select id, gate_id, user_device_id, last_seen_at
                           from gate_devices
                          where staff_id = ss.id and society_id = ss.society_id and status = 'active'
                          order by paired_at desc limit 1
                       ) gd on true
                       left join gates g on g.id = gd.gate_id and g.society_id = ss.society_id
                       left join user_devices ud on ud.id = gd.user_device_id`;

function staffItem(row, includeCreatedAt = false) {
  const { created_at: createdAt, ...item } = row;
  return includeCreatedAt ? { ...item, created_at: createdAt } : item;
}

function staffWhere(societyId, filters) {
  const values = [societyId, filters.status];
  const clauses = ['ss.society_id = $1', 'ss.status = any($2::text[])'];
  if (filters.role) {
    values.push(filters.role);
    clauses.push(`ss.role = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(ss.full_name ilike $${values.length} or ss.phone ilike $${values.length})`);
  }
  return { values, where: clauses.join(' and ') };
}

async function list(auth, filters) {
  const filter = staffWhere(auth.societyId, filters);
  const [count, result] = await Promise.all([
    query(`select count(*) from society_staff ss where ${filter.where}`, filter.values),
    query(
      `${staffSelect}
        where ${filter.where}
        order by ss.full_name, ss.id
        limit $${filter.values.length + 1} offset $${filter.values.length + 2}`,
      [...filter.values, filters.limit, offset(filters)]
    ),
  ]);
  return pageResult(result.rows.map((row) => staffItem(row)), count.rows[0].count, filters);
}

async function getStaffRow(db, societyId, id) {
  const { rows } = await db.query(
    `${staffSelect} where ss.id = $1 and ss.society_id = $2`,
    [id, societyId]
  );
  return rows[0] || null;
}

async function get(auth, id) {
  const row = await getStaffRow({ query }, auth.societyId, id);
  if (!row) throw new ApiError(404, 'Staff member not found in your society.');
  return staffItem(row, true);
}

function duplicatePhoneError(error) {
  if (error.code === '23505' && error.constraint === 'society_staff_society_id_phone_role_key') {
    throw new ApiError(409, 'This number is already added as a guard.');
  }
  throw error;
}

async function create(auth, body) {
  try {
    return await transaction(async (db) => {
      const existing = await db.query(
        `select id, status from society_staff
          where society_id = $1 and phone = $2 and role = $3
          for update`,
        [auth.societyId, body.phone, body.role]
      );
      let staffId;
      if (existing.rows[0]) {
        if (existing.rows[0].status !== 'removed') {
          throw new ApiError(409, 'This number is already added as a guard.');
        }
        staffId = existing.rows[0].id;
        await db.query(
          `update society_staff
              set full_name = $3, shift = $4, photo_path = $5, status = 'invited',
                  user_id = null, updated_at = now()
            where id = $1 and society_id = $2`,
          [staffId, auth.societyId, body.full_name, body.shift || null, body.photo_path || null]
        );
      } else {
        const { rows } = await db.query(
          `insert into society_staff
             (society_id, user_id, role, full_name, phone, shift, photo_path, status, created_by_user_id)
           values ($1, null, $2, $3, $4, $5, $6, 'invited', $7)
           returning id`,
          [
            auth.societyId,
            body.role,
            body.full_name,
            body.phone,
            body.shift || null,
            body.photo_path || null,
            auth.userId,
          ]
        );
        staffId = rows[0].id;
      }

      await auditService.log(db, {
        societyId: auth.societyId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        entityType: 'staff',
        entityId: staffId,
        metadata: { role: body.role, reactivated: Boolean(existing.rows[0]) },
      });
      return staffItem(await getStaffRow(db, auth.societyId, staffId));
    });
  } catch (error) {
    duplicatePhoneError(error);
  }
}

async function lockActiveAdmins(db, societyId) {
  const result = await db.query(
    `select id from society_staff
      where society_id = $1 and role = 'admin' and status = 'active'
      order by id for update`,
    [societyId]
  );
  if (result.rowCount <= 1) {
    throw new ApiError(409, 'The last active admin of a society cannot be removed or suspended.');
  }
}

async function lockSociety(db, societyId) {
  await db.query('select id from societies where id = $1 for update', [societyId]);
}

async function ensureCanDeactivate(auth, db, row) {
  if (row.role !== 'admin') return;
  if (row.id === auth.profileId) {
    throw new ApiError(409, 'An admin cannot remove or suspend themselves.');
  }
  if (row.status === 'active') await lockActiveAdmins(db, auth.societyId);
}

async function revokeStaffDevices(db, auth, staffId) {
  const { rows } = await db.query(
    `update gate_devices
        set status = 'revoked', revoked_at = now(), revoked_by_user_id = $3
      where staff_id = $1 and society_id = $2 and status = 'active'
      returning id, gate_id`,
    [staffId, auth.societyId, auth.userId]
  );
  for (const device of rows) {
    await auditService.log(db, {
      societyId: auth.societyId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'revoke',
      entityType: 'gate_device',
      entityId: device.id,
      metadata: { staff_id: staffId, gate_id: device.gate_id },
    });
  }
}

async function update(auth, id, changes) {
  try {
    return await transaction(async (db) => {
      await lockSociety(db, auth.societyId);
      const found = await db.query(
        `select id, user_id, role, phone, status
           from society_staff
          where id = $1 and society_id = $2
          for update`,
        [id, auth.societyId]
      );
      const row = found.rows[0];
      if (!row) throw new ApiError(404, 'Staff member not found in your society.');

      if (row.role === 'admin' && changes.shift !== undefined) {
        throw new ApiError(400, 'Shift cannot be set for an admin.');
      }
      if (changes.phone !== undefined && changes.phone !== row.phone && row.status !== 'invited') {
        throw new ApiError(400, 'Phone can only be changed before the staff member logs in.');
      }
      if (changes.status === 'active') {
        if (row.status !== 'suspended') {
          throw new ApiError(409, 'Only a logged-in suspended staff member can be reactivated.');
        }
        if (!row.user_id) {
          throw new ApiError(409, 'Staff member must log in before being activated.');
        }
      }
      if (changes.status === 'suspended') {
        await ensureCanDeactivate(auth, db, row);
      }

      const fields = ['full_name', 'phone', 'shift', 'photo_path', 'status'];
      const assignments = [];
      const values = [id, auth.societyId];
      for (const field of fields) {
        if (changes[field] !== undefined) {
          values.push(changes[field]);
          assignments.push(`${field} = $${values.length}`);
        }
      }
      if (assignments.length) {
        assignments.push('updated_at = now()');
        await db.query(
          `update society_staff set ${assignments.join(', ')}
            where id = $1 and society_id = $2`,
          values
        );
      }

      if (changes.status === 'suspended') {
        await revokeStaffDevices(db, auth, id);
      }
      if (changes.status === 'suspended') {
        await auditService.log(db, {
          societyId: auth.societyId,
          actorUserId: auth.userId,
          actorRole: auth.role,
          action: 'suspend',
          entityType: 'staff',
          entityId: id,
        });
      }
      if (changes.status !== 'suspended' || Object.keys(changes).some((field) => field !== 'status')) {
        await auditService.log(db, {
          societyId: auth.societyId,
          actorUserId: auth.userId,
          actorRole: auth.role,
          action: 'update',
          entityType: 'staff',
          entityId: id,
          metadata: { changed_fields: Object.keys(changes) },
        });
      }
      return staffItem(await getStaffRow(db, auth.societyId, id));
    });
  } catch (error) {
    duplicatePhoneError(error);
  }
}

async function remove(auth, id) {
  return transaction(async (db) => {
    await lockSociety(db, auth.societyId);
    const found = await db.query(
      `select id, role, status from society_staff
        where id = $1 and society_id = $2
        for update`,
      [id, auth.societyId]
    );
    const row = found.rows[0];
    if (!row) throw new ApiError(404, 'Staff member not found in your society.');
    if (row.status === 'removed') throw new ApiError(409, 'Staff member is already removed.');
    await ensureCanDeactivate(auth, db, row);

    await db.query(
      `update society_staff set status = 'removed', updated_at = now()
        where id = $1 and society_id = $2`,
      [id, auth.societyId]
    );
    await revokeStaffDevices(db, auth, id);
    await auditService.log(db, {
      societyId: auth.societyId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'remove',
      entityType: 'staff',
      entityId: id,
    });
    return staffItem(await getStaffRow(db, auth.societyId, id));
  });
}

async function listGateDevices(auth, filters) {
  if (filters.gate_id) {
    const gate = await query(
      'select id from gates where id = $1 and society_id = $2',
      [filters.gate_id, auth.societyId]
    );
    if (!gate.rows[0]) throw new ApiError(404, 'Gate not found in your society.');
  }
  const values = [auth.societyId, filters.status];
  const clauses = ['gd.society_id = $1', 'gd.status = $2'];
  if (filters.gate_id) {
    values.push(filters.gate_id);
    clauses.push(`gd.gate_id = $${values.length}`);
  }
  const { rows } = await query(
    `select gd.id, gd.gate_id, g.name as gate_name, gd.staff_id,
            ss.full_name as staff_name, gd.device_label, ud.platform,
            gd.paired_at, gd.last_seen_at, gd.status
       from gate_devices gd
       join gates g on g.id = gd.gate_id and g.society_id = gd.society_id
       join society_staff ss on ss.id = gd.staff_id and ss.society_id = gd.society_id
       left join user_devices ud on ud.id = gd.user_device_id
      where ${clauses.join(' and ')}
      order by gd.paired_at desc, gd.id`,
    values
  );
  return rows;
}

async function revokeGateDevice(auth, id) {
  return transaction(async (db) => {
    const { rows } = await db.query(
      `update gate_devices
          set status = 'revoked', revoked_at = now(), revoked_by_user_id = $3
        where id = $1 and society_id = $2 and status = 'active'
        returning id, gate_id, staff_id`,
      [id, auth.societyId, auth.userId]
    );
    const device = rows[0];
    if (!device) {
      const existing = await db.query(
        `select id from gate_devices where id = $1 and society_id = $2`,
        [id, auth.societyId]
      );
      if (!existing.rows[0]) throw new ApiError(404, 'Gate device not found in your society.');
      throw new ApiError(409, 'Already unpaired');
    }

    // Future guard endpoints must check society_staff.status = 'active' and an active gate_devices row at request time, not only the token.
    await auditService.log(db, {
      societyId: auth.societyId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'revoke',
      entityType: 'gate_device',
      entityId: device.id,
      metadata: { staff_id: device.staff_id, gate_id: device.gate_id },
    });
    const { rows: details } = await db.query(
      `select gd.id, gd.gate_id, g.name as gate_name, gd.staff_id,
              ss.full_name as staff_name, gd.device_label, ud.platform,
              gd.paired_at, gd.last_seen_at, gd.status
         from gate_devices gd
         join gates g on g.id = gd.gate_id and g.society_id = gd.society_id
         join society_staff ss on ss.id = gd.staff_id and ss.society_id = gd.society_id
         left join user_devices ud on ud.id = gd.user_device_id
        where gd.id = $1 and gd.society_id = $2`,
      [device.id, auth.societyId]
    );
    return details[0];
  });
}

module.exports = { list, create, get, update, remove, listGateDevices, revokeGateDevice };
