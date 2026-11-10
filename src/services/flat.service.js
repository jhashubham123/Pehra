const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { throwDatabaseError } = require('../utils/databaseError');
const { offset, pageResult } = require('../utils/pagination');
const auditService = require('./audit.service');

function listFilters(auth, filters) {
  const values = [auth.societyId];
  const where = ['f.society_id = $1'];
  if (filters.tower_id) {
    values.push(filters.tower_id);
    where.push(`f.tower_id = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    where.push(`f.label ilike $${values.length}`);
  }
  return { values, where: where.join(' and ') };
}

async function list(auth, filters) {
  if (filters.tower_id) {
    const tower = await query(
      'select id from towers where id = $1 and society_id = $2',
      [filters.tower_id, auth.societyId]
    );
    if (!tower.rows[0]) throw new ApiError(404, 'Tower not found in your society.');
  }
  const filter = listFilters(auth, filters);
  const count = await query(
    `select count(*) from flats f where ${filter.where}`,
    filter.values
  );
  const values = [...filter.values, filters.limit, offset(filters)];
  const result = await query(
    `select f.id, f.label, f.tower_id, t.name as tower_name, f.floor, f.number,
            (select count(*) from residents r
              where r.society_id = f.society_id and r.flat_id = f.id and r.status = 'active')::int as active_resident_count,
            (select r.full_name from residents r
              where r.society_id = f.society_id and r.flat_id = f.id
                and r.status = 'active' and r.is_head = true
              limit 1) as head_name
       from flats f
       join towers t on t.id = f.tower_id and t.society_id = f.society_id
      where ${filter.where}
      order by t.name, f.floor, f.number
      limit $${values.length - 1} offset $${values.length}`,
    values
  );
  return pageResult(result.rows, count.rows[0].count, filters);
}

async function create(auth, body) {
  let label;
  try {
    return await transaction(async (db) => {
      const tower = await db.query(
        'select id, name, floors from towers where id = $1 and society_id = $2 for update',
        [body.tower_id, auth.societyId]
      );
      if (!tower.rows[0]) throw new ApiError(404, 'Tower not found in your society.');
      if (body.floor > tower.rows[0].floors) {
        throw new ApiError(400, 'Floor cannot exceed the tower floor count.');
      }
      label = `${tower.rows[0].name}-${body.number}`;
      const { rows } = await db.query(
        `insert into flats (society_id, tower_id, floor, number, label)
         values ($1, $2, $3, $4, $5)
         returning id, label, tower_id, floor, number`,
        [auth.societyId, body.tower_id, body.floor, body.number, label]
      );
      await auditService.log(db, {
        societyId: auth.societyId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        entityType: 'flat',
        entityId: rows[0].id,
        metadata: { label },
      });
      return { ...rows[0], tower_name: tower.rows[0].name, active_resident_count: 0, head_name: null };
    });
  } catch (error) {
    throwDatabaseError(error, { alreadyExists: label ? `Flat ${label}` : `Flat ${body.number}` });
  }
}

async function update(auth, id, changes) {
  try {
    return await transaction(async (db) => {
      const found = await db.query(
        `select id, tower_id, floor, number from flats
          where id = $1 and society_id = $2
          for update`,
        [id, auth.societyId]
      );
      if (!found.rows[0]) throw new ApiError(404, 'Flat not found in your society.');
      const flat = found.rows[0];
      const tower = await db.query(
        'select name, floors from towers where id = $1 and society_id = $2 for update',
        [flat.tower_id, auth.societyId]
      );
      if (!tower.rows[0]) throw new ApiError(404, 'Tower not found in your society.');
      const floor = changes.floor ?? flat.floor;
      const number = changes.number ?? flat.number;
      if (floor > tower.rows[0].floors) throw new ApiError(400, 'Floor cannot exceed the tower floor count.');
      const label = `${tower.rows[0].name}-${number}`;
      const { rows } = await db.query(
        `update flats set floor = $3, number = $4, label = $5
          where id = $1 and society_id = $2
          returning id, label, tower_id, floor, number`,
        [id, auth.societyId, floor, number, label]
      );
      return { ...rows[0], tower_name: tower.rows[0].name };
    });
  } catch (error) {
    throwDatabaseError(error, { alreadyExists: 'Flat' });
  }
}

async function remove(auth, id) {
  return transaction(async (db) => {
    const flat = await db.query(
      'select id, label from flats where id = $1 and society_id = $2 for update',
      [id, auth.societyId]
    );
    if (!flat.rows[0]) throw new ApiError(404, 'Flat not found in your society.');
    const [residents, visits] = await Promise.all([
      db.query('select 1 from residents where society_id = $1 and flat_id = $2 limit 1', [auth.societyId, id]),
      db.query('select 1 from visits where society_id = $1 and flat_id = $2 limit 1', [auth.societyId, id]),
    ]);
    if (residents.rowCount || visits.rowCount) {
      throw new ApiError(409, 'This flat has residents or visit records and cannot be deleted.');
    }
    await db.query('delete from flats where id = $1 and society_id = $2', [id, auth.societyId]);
    await auditService.log(db, {
      societyId: auth.societyId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'delete',
      entityType: 'flat',
      entityId: id,
      metadata: { label: flat.rows[0].label },
    });
    return null;
  });
}

module.exports = { list, create, update, remove };
