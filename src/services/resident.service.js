const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { throwDatabaseError } = require('../utils/databaseError');
const { offset, pageResult } = require('../utils/pagination');
const auditService = require('./audit.service');

const listFields = `r.id, r.full_name, r.phone, r.photo_path, r.resident_type,
                    r.relation_to_head, r.is_head, r.receives_alerts, r.status,
                    r.flat_id, f.label as flat_label, t.name as tower_name`;

function filtersForResidents(auth, filters) {
  const values = [auth.societyId, filters.status];
  const clauses = ['r.society_id = $1', 'r.status = $2'];
  if (filters.flat_id) {
    values.push(filters.flat_id);
    clauses.push(`r.flat_id = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(r.full_name ilike $${values.length} or coalesce(r.phone, '') ilike $${values.length})`);
  }
  return { values, where: clauses.join(' and ') };
}

async function list(auth, filters) {
  if (filters.flat_id) {
    const flat = await query(
      'select id from flats where id = $1 and society_id = $2',
      [filters.flat_id, auth.societyId]
    );
    if (!flat.rows[0]) throw new ApiError(404, 'Flat not found in your society.');
  }
  const filter = filtersForResidents(auth, filters);
  const [count, result] = await Promise.all([
    query(`select count(*) from residents r where ${filter.where}`, filter.values),
    query(
      `select ${listFields}
         from residents r
         join flats f on f.id = r.flat_id and f.society_id = r.society_id
         join towers t on t.id = f.tower_id and t.society_id = f.society_id
        where ${filter.where}
        order by r.full_name
        limit $${filter.values.length + 1} offset $${filter.values.length + 2}`,
      [...filter.values, filters.limit, offset(filters)]
    ),
  ]);
  return pageResult(result.rows, count.rows[0].count, filters);
}

async function get(auth, id) {
  const { rows } = await query(
    `select r.*, f.label as flat_label, t.name as tower_name
       from residents r
       join flats f on f.id = r.flat_id and f.society_id = r.society_id
       join towers t on t.id = f.tower_id and t.society_id = f.society_id
      where r.id = $1 and r.society_id = $2`,
    [id, auth.societyId]
  );
  if (!rows[0]) throw new ApiError(404, 'Resident not found in your society.');
  return rows[0];
}

function phoneConflict(error, phone, fallback = 'Resident') {
  if (error.code === '23505' && error.constraint === 'residents_phone_uidx') {
    throw new ApiError(409, `Phone ${phone} already has a pending or active registration in this society.`);
  }
  if (error.code === '23505' && error.constraint === 'residents_one_head_uidx') {
    throw new ApiError(409, 'This flat already has an active head.');
  }
  throwDatabaseError(error, { alreadyExists: fallback });
}

async function registerFamily(auth, flatId, members) {
  return transaction(async (db) => {
    const flat = await db.query(
      'select id from flats where id = $1 and society_id = $2 for update',
      [flatId, auth.societyId]
    );
    if (!flat.rows[0]) throw new ApiError(404, 'Flat not found in your society.');

    const phones = members.map((member) => member.phone).filter(Boolean);
    if (new Set(phones).size !== phones.length) {
      const duplicate = phones.find((phone, index) => phones.indexOf(phone) !== index);
      throw new ApiError(409, `Phone ${duplicate} is duplicated in this family.`);
    }

    const hasHead = members.some((member) => member.is_head === true);
    if (members.filter((member) => member.is_head === true).length > 1) {
      throw new ApiError(409, 'Only one family member can be the head.');
    }
    if (hasHead) {
      const existingHead = await db.query(
        `select id from residents
          where society_id = $1 and flat_id = $2 and status = 'active' and is_head = true
          limit 1 for update`,
        [auth.societyId, flatId]
      );
      if (existingHead.rowCount) throw new ApiError(409, 'This flat already has an active head.');
    }

    const created = [];
    for (const member of members) {
      if (member.receives_alerts === true && !member.phone) {
        throw new ApiError(400, 'A phone number is required to receive alerts.');
      }
      if (member.phone) {
        const existingPhone = await db.query(
          `select 1 from residents
            where society_id = $1 and phone = $2 and status in ('pending', 'active')
            limit 1`,
          [auth.societyId, member.phone]
        );
        if (existingPhone.rowCount) {
          throw new ApiError(409, `Phone ${member.phone} already has a pending or active registration in this society.`);
        }
      }
      try {
        const { rows } = await db.query(
          `insert into residents (
             society_id, flat_id, full_name, phone, photo_path, resident_type, relation_to_head,
             is_head, receives_alerts, status, source, decided_by_user_id, decided_at
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 'admin', $10, now())
           returning id, full_name, phone, photo_path, resident_type, relation_to_head,
                     is_head, receives_alerts, status, flat_id`,
          [
            auth.societyId,
            flatId,
            member.full_name,
            member.phone || null,
            member.photo_path || null,
            member.resident_type,
            member.is_head ? 'head' : member.relation_to_head,
            member.is_head === true,
            member.receives_alerts ?? Boolean(member.phone),
            auth.userId,
          ]
        );
        created.push(rows[0]);
      } catch (error) {
        phoneConflict(error, member.phone, `Resident ${member.full_name}`);
      }
    }

    await auditService.log(db, {
      societyId: auth.societyId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'register_family',
      entityType: 'flat',
      entityId: flatId,
      metadata: { resident_ids: created.map((member) => member.id) },
    });
    return created;
  });
}

async function update(auth, id, changes) {
  return transaction(async (db) => {
    const found = await db.query(
      `select * from residents
        where id = $1 and society_id = $2`,
      [id, auth.societyId]
    );
    if (!found.rows[0]) throw new ApiError(404, 'Resident not found in your society.');
    let resident = found.rows[0];
    if (resident.status !== 'active') throw new ApiError(409, 'Only active residents can be edited.');

    const flat = await db.query('select id from flats where id = $1 and society_id = $2 for update', [
      resident.flat_id,
      auth.societyId,
    ]);
    if (!flat.rows[0]) throw new ApiError(404, 'Flat not found in your society.');
    const lockedResident = await db.query(
      'select * from residents where id = $1 and society_id = $2 for update',
      [id, auth.societyId]
    );
    if (!lockedResident.rows[0]) throw new ApiError(404, 'Resident not found in your society.');
    resident = lockedResident.rows[0];
    if (resident.status !== 'active') throw new ApiError(409, 'Only active residents can be edited.');

    const receivesAlerts = changes.receives_alerts ?? resident.receives_alerts;
    const phone = changes.phone === undefined ? resident.phone : changes.phone;
    if (receivesAlerts && !phone) {
      throw new ApiError(400, 'A phone number is required to receive alerts.');
    }
    if (phone && phone !== resident.phone) {
      const existingPhone = await db.query(
        `select 1 from residents
          where society_id = $1 and phone = $2 and id <> $3
            and status in ('pending', 'active')
          limit 1`,
        [auth.societyId, phone, id]
      );
      if (existingPhone.rowCount) {
        throw new ApiError(409, `Phone ${phone} already has a pending or active registration in this society.`);
      }
    }

    const isHead = changes.is_head ?? (
      changes.relation_to_head === undefined
        ? resident.is_head
        : changes.relation_to_head === 'head'
    );
    const relationToHead = isHead
      ? 'head'
      : changes.relation_to_head ?? (resident.relation_to_head === 'head' ? 'other' : resident.relation_to_head);

    if (isHead) {
      await db.query(
        `update residents
            set is_head = false, relation_to_head = 'other'
          where society_id = $1 and flat_id = $2 and status = 'active'
            and is_head = true and id <> $3`,
        [auth.societyId, resident.flat_id, id]
      );
    }

    try {
      const { rows } = await db.query(
        `update residents
            set full_name = $3, phone = $4, photo_path = $5, resident_type = $6,
                relation_to_head = $7, receives_alerts = $8, is_head = $9
          where id = $1 and society_id = $2 and status = 'active'
          returning *`,
        [
          id,
          auth.societyId,
          changes.full_name ?? resident.full_name,
          phone,
          changes.photo_path === undefined ? resident.photo_path : changes.photo_path,
          changes.resident_type ?? resident.resident_type,
          relationToHead,
          receivesAlerts,
          isHead,
        ]
      );
      await auditService.log(db, {
        societyId: auth.societyId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'edit_resident',
        entityType: 'resident',
        entityId: id,
        metadata: { changed_fields: Object.keys(changes) },
      });
      return rows[0];
    } catch (error) {
      phoneConflict(error, phone, 'Resident');
    }
  });
}

async function moveOut(auth, id, { note }) {
  return transaction(async (db) => {
    const found = await db.query(
      'select id, status from residents where id = $1 and society_id = $2 for update',
      [id, auth.societyId]
    );
    if (!found.rows[0]) throw new ApiError(404, 'Resident not found in your society.');
    if (found.rows[0].status !== 'active') throw new ApiError(409, 'Only active residents can move out.');
    const { rows } = await db.query(
      `update residents
          set status = 'moved_out', moved_out_at = now(), is_head = false,
              relation_to_head = case when relation_to_head = 'head' then 'other' else relation_to_head end,
              receives_alerts = false, decision_note = coalesce($3, decision_note)
        where id = $1 and society_id = $2 and status = 'active'
        returning *`,
      [id, auth.societyId, note || null]
    );
    await auditService.log(db, {
      societyId: auth.societyId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'move_out',
      entityType: 'resident',
      entityId: id,
      metadata: note ? { note } : {},
    });
    return rows[0];
  });
}

module.exports = { list, get, registerFamily, update, moveOut };
