const { query, transaction } = require('../db/query');
const ApiError = require('../utils/ApiError');
const { throwDatabaseError } = require('../utils/databaseError');
const { offset, pageResult } = require('../utils/pagination');
const auditService = require('./audit.service');

async function list(auth, { status, page, limit }) {
  const base = status === 'pending'
    ? `from v_pending_join_requests p
       join residents r on r.id = p.resident_id and r.society_id = p.society_id
       join flats f on f.id = r.flat_id and f.society_id = r.society_id
       join towers t on t.id = f.tower_id and t.society_id = f.society_id
       where p.society_id = $1`
    : `from residents r
       join flats f on f.id = r.flat_id and f.society_id = r.society_id
       join towers t on t.id = f.tower_id and t.society_id = f.society_id
       where r.society_id = $1 and r.status = 'declined'`;
  const [count, result] = await Promise.all([
    query(`select count(*) ${base}`, [auth.societyId]),
    query(
      `select r.id, r.full_name, r.phone, r.resident_type, r.relation_to_head,
              r.flat_id, f.label as flat_label, t.name as tower_name,
              r.invite_code_used, r.created_at,
              exists (
                select 1 from residents h
                 where h.society_id = r.society_id and h.flat_id = r.flat_id
                   and h.status = 'active' and h.is_head = true
              ) as flat_has_head
         ${base}
        order by r.created_at desc
        limit $2 offset $3`,
      [auth.societyId, limit, offset({ page, limit })]
    ),
  ]);
  return pageResult(result.rows, count.rows[0].count, { page, limit });
}

async function loadRequest(db, societyId, id) {
  const { rows } = await db.query(
    'select * from residents where id = $1 and society_id = $2 for update',
    [id, societyId]
  );
  if (!rows[0]) throw new ApiError(404, 'Join request not found in your society.');
  if (rows[0].status !== 'pending') throw new ApiError(409, 'This request was already handled.');
  return rows[0];
}

async function requestHandledError(db, societyId, id) {
  const exists = await db.query('select 1 from residents where id = $1 and society_id = $2', [id, societyId]);
  if (exists.rowCount) throw new ApiError(409, 'This request was already handled.');
  throw new ApiError(404, 'Join request not found in your society.');
}

async function approve(auth, id, body) {
  return transaction(async (db) => {
    const resident = await loadRequest(db, auth.societyId, id);
    const isHead = body.is_head ?? body.relation_to_head === 'head';
    const relation = isHead
      ? 'head'
      : body.relation_to_head ?? (resident.relation_to_head === 'head' ? 'other' : resident.relation_to_head);
    if (body.receives_alerts && !resident.phone) {
      throw new ApiError(400, 'A phone number is required to receive alerts.');
    }

    await db.query('select id from flats where id = $1 and society_id = $2 for update', [
      resident.flat_id,
      auth.societyId,
    ]);
    if (isHead) {
      const existingHead = await db.query(
        `select id from residents
          where society_id = $1 and flat_id = $2 and status = 'active' and is_head = true
          limit 1 for update`,
        [auth.societyId, resident.flat_id]
      );
      if (existingHead.rowCount) throw new ApiError(409, 'This flat already has an active head.');
    }

    try {
      const { rows } = await db.query(
        `update residents
            set status = 'active', is_head = $3, relation_to_head = $4,
                receives_alerts = $5, decided_by_user_id = $6, decided_at = now()
          where id = $1 and society_id = $2 and status = 'pending'
          returning *`,
        [id, auth.societyId, isHead, relation, body.receives_alerts, auth.userId]
      );
      if (!rows[0]) await requestHandledError(db, auth.societyId, id);
      await auditService.log(db, {
        societyId: auth.societyId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'approve',
        entityType: 'resident',
        entityId: id,
        metadata: { is_head: isHead },
      });
      return rows[0];
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'residents_one_head_uidx') {
        throw new ApiError(409, 'This flat already has an active head.');
      }
      throwDatabaseError(error, { alreadyExists: 'Resident' });
    }
  });
}

async function decline(auth, id, { reason }) {
  return transaction(async (db) => {
    await loadRequest(db, auth.societyId, id);
    const { rows } = await db.query(
      `update residents
          set status = 'declined', decision_note = $3,
              decided_by_user_id = $4, decided_at = now()
        where id = $1 and society_id = $2 and status = 'pending'
        returning *`,
      [id, auth.societyId, reason, auth.userId]
    );
    if (!rows[0]) await requestHandledError(db, auth.societyId, id);
    await auditService.log(db, {
      societyId: auth.societyId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'decline',
      entityType: 'resident',
      entityId: id,
      metadata: { reason },
    });
    return rows[0];
  });
}

module.exports = { list, approve, decline };
