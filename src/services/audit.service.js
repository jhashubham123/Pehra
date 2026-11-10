// Writes an audit event using the caller's transaction.
async function log(db, {
  societyId,
  actorUserId,
  actorRole,
  action,
  entityType,
  entityId,
  metadata = {},
}) {
  await db.query(
    `insert into audit_log (society_id, actor_user_id, actor_role, action, entity_type, entity_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      societyId,
      actorUserId,
      actorRole,
      action,
      entityType,
      entityId == null ? null : String(entityId),
      JSON.stringify(metadata),
    ]
  );
}

module.exports = { log };
