const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { throwDatabaseError } = require('../utils/databaseError');
const { offset, pageResult } = require('../utils/pagination');
const auditService = require('./audit.service');

async function list(auth, pagination) {
  const [count, result] = await Promise.all([
    query('select count(*) from gates where society_id = $1', [auth.societyId]),
    query(
      `select g.id, g.name, g.status, count(gd.id)::int as active_device_count
         from gates g
         left join gate_devices gd
           on gd.gate_id = g.id and gd.society_id = g.society_id and gd.status = 'active'
        where g.society_id = $1
        group by g.id
        order by g.name
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
        `insert into gates (society_id, name) values ($1, $2)
         returning id, name, status`,
        [auth.societyId, body.name]
      );
      await auditService.log(db, {
        societyId: auth.societyId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        entityType: 'gate',
        entityId: rows[0].id,
        metadata: { name: body.name },
      });
      return { ...rows[0], active_device_count: 0 };
    });
  } catch (error) {
    throwDatabaseError(error, { alreadyExists: `Gate ${body.name}` });
  }
}

async function update(auth, id, changes) {
  const values = [id, auth.societyId];
  const assignments = Object.entries(changes).map(([field, value]) => {
    values.push(value);
    return `${field} = $${values.length}`;
  });
  try {
    const { rows } = await query(
      `update gates set ${assignments.join(', ')}
        where id = $1 and society_id = $2
        returning id, name, status`,
      values
    );
    if (!rows[0]) throw new ApiError(404, 'Gate not found in your society.');
    return rows[0];
  } catch (error) {
    throwDatabaseError(error, { alreadyExists: `Gate ${changes.name || 'name'}` });
  }
}

module.exports = { list, create, update };
