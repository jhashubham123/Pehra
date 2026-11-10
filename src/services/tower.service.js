const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { throwDatabaseError } = require('../utils/databaseError');
const { offset, pageResult } = require('../utils/pagination');
const auditService = require('./audit.service');

async function list(auth, pagination) {
  const [count, result] = await Promise.all([
    query('select count(*) from towers where society_id = $1', [auth.societyId]),
    query(
      `select t.id, t.name, t.floors, count(f.id)::int as flat_count
         from towers t
         left join flats f on f.tower_id = t.id and f.society_id = t.society_id
        where t.society_id = $1
        group by t.id
        order by t.name
        limit $2 offset $3`,
      [auth.societyId, pagination.limit, offset(pagination)]
    ),
  ]);
  return pageResult(result.rows, count.rows[0].count, pagination);
}

async function create(auth, body) {
  try {
    return await transaction(async (db) => {
      const { rows } = await db.query(
        `insert into towers (society_id, name, floors)
         values ($1, $2, $3)
         returning id, name, floors`,
        [auth.societyId, body.name, body.floors]
      );
      await auditService.log(db, {
        societyId: auth.societyId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        entityType: 'tower',
        entityId: rows[0].id,
        metadata: { name: body.name },
      });
      return { ...rows[0], flat_count: 0 };
    });
  } catch (error) {
    throwDatabaseError(error, { alreadyExists: `Tower ${body.name}` });
  }
}

async function update(auth, id, changes) {
  try {
    return await transaction(async (db) => {
      const tower = await db.query(
        `select id, name, floors from towers
          where id = $1 and society_id = $2
          for update`,
        [id, auth.societyId]
      );
      if (!tower.rows[0]) throw new ApiError(404, 'Tower not found in your society.');
      if (changes.floors !== undefined) {
        const highest = await db.query(
          'select coalesce(max(floor), 0) as floor from flats where society_id = $1 and tower_id = $2',
          [auth.societyId, id]
        );
        if (changes.floors < Number(highest.rows[0].floor)) {
          throw new ApiError(409, 'Floors cannot be set below the highest existing flat floor.');
        }
      }

      const values = [id, auth.societyId];
      const assignments = Object.entries(changes).map(([field, value]) => {
        values.push(value);
        return `${field} = $${values.length}`;
      });
      const { rows } = await db.query(
        `update towers set ${assignments.join(', ')}
          where id = $1 and society_id = $2
          returning id, name, floors`,
        values
      );
      return rows[0];
    });
  } catch (error) {
    throwDatabaseError(error, { alreadyExists: `Tower ${changes.name || 'name'}` });
  }
}

async function remove(auth, id) {
  return transaction(async (db) => {
    const tower = await db.query(
      'select id, name from towers where id = $1 and society_id = $2 for update',
      [id, auth.societyId]
    );
    if (!tower.rows[0]) throw new ApiError(404, 'Tower not found in your society.');
    const flats = await db.query(
      'select 1 from flats where society_id = $1 and tower_id = $2 limit 1',
      [auth.societyId, id]
    );
    if (flats.rowCount) throw new ApiError(409, 'Remove its flats first.');

    await db.query('delete from towers where id = $1 and society_id = $2', [id, auth.societyId]);
    await auditService.log(db, {
      societyId: auth.societyId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'delete',
      entityType: 'tower',
      entityId: id,
      metadata: { name: tower.rows[0].name },
    });
    return null;
  });
}

async function generateFlats(auth, towerId, { floors_to: floorsTo, flats_per_floor: flatsPerFloor }) {
  return transaction(async (db) => {
    const tower = await db.query(
      'select id, name, floors from towers where id = $1 and society_id = $2 for update',
      [towerId, auth.societyId]
    );
    if (!tower.rows[0]) throw new ApiError(404, 'Tower not found in your society.');
    if (floorsTo > tower.rows[0].floors) {
      throw new ApiError(400, 'floors_to cannot exceed the tower floor count.');
    }

    const { rowCount } = await db.query(
      `insert into flats (society_id, tower_id, floor, number, label)
       select $1, t.id, f.floor, (f.floor * 100 + n.number)::text,
              t.name || '-' || (f.floor * 100 + n.number)::text
         from towers t
         cross join generate_series(1, $3::integer) as f(floor)
         cross join generate_series(1, $4::integer) as n(number)
        where t.id = $2 and t.society_id = $1
       on conflict do nothing`,
      [auth.societyId, towerId, floorsTo, flatsPerFloor]
    );
    if (rowCount > 0) {
      await auditService.log(db, {
        societyId: auth.societyId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'generate_flats',
        entityType: 'tower',
        entityId: towerId,
        metadata: {
          generated: rowCount,
          floors_to: floorsTo,
          flats_per_floor: flatsPerFloor,
        },
      });
    }
    const requested = floorsTo * flatsPerFloor;
    return { created: rowCount, skipped: requested - rowCount };
  });
}

module.exports = { list, create, update, remove, generateFlats };
