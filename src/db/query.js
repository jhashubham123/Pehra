// Small helpers so services never touch the pool directly.
const pool = require('./pool');

// query('select * from users where id = $1', [id])  ->  { rows, rowCount }
function query(sql, params = []) {
  return pool.query(sql, params);
}

// Runs several queries as one all-or-nothing unit.
//   await transaction(async (db) => { await db.query(...); await db.query(...); });
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, transaction };
