/*
  vpVisitNew.service.js — Atomic pool+visit creation.

  POST /pools/visit/new

  Replaces the database trigger approach (generate_new_pool_id +
  insert_mapped_pool_from_visit_data) with an explicit, transactional
  API route that:
    1. Generates the next NEW{n} pool ID
    2. INSERTs into vpmapped
    3. INSERTs into vpvisit with the generated pool ID
    4. Returns both mappedPoolId and visitId

  All three steps run in a single Postgres transaction.
*/

const db = require('_helpers/db_postgres');
const pgUtil = require('_helpers/db_pg_util');

// Column lists populated on startup (same pattern as other services)
var mappedColumns = [];
var visitColumns = [];

pgUtil.getColumns('vpmapped', mappedColumns)
  .then(res => console.log('vpVisitNew | vpmapped columns loaded:', mappedColumns.length))
  .catch(err => console.log('vpVisitNew | vpmapped getColumns error:', err.message));

pgUtil.getColumns('vpvisit', visitColumns)
  .then(res => console.log('vpVisitNew | vpvisit columns loaded:', visitColumns.length))
  .catch(err => console.log('vpVisitNew | vpvisit getColumns error:', err.message));

module.exports = { createPoolAndVisit };

/*
  createPoolAndVisit(body, user)

  Body contains visit fields (visitDate, visitLatitude, etc.) plus optional
  mapped pool overrides (mappedPoolStatus, mappedMethod, etc.).

  Fields starting with "mapped" go to vpmapped; the rest go to vpvisit.
  If no mapped fields are provided, sensible defaults are derived from the
  visit data — matching what the old trigger did.
*/
async function createPoolAndVisit(body, user) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // --- Step 1: Generate next pool ID ---
    const idRes = await client.query(`
      SELECT COALESCE(MAX(TO_NUMBER(substr("mappedPoolId",4,10), '99999')), 0) + 1 AS next_id
      FROM vpmapped
      WHERE "mappedPoolId" ~ '^NEW[0-9]'
    `);
    const nextId = idRes.rows[0].next_id;
    const poolId = `NEW${nextId}`;

    // --- Step 2: Build mapped pool record ---
    const observer = body.visitObserverUserName || body.visitUserName || user?.username || '';
    const mappedBody = {
      mappedPoolId:               poolId,
      mappedByUser:               observer,
      mappedDateText:             body.visitDate || new Date().toLocaleDateString('sv-SE'),
      mappedLatitude:             body.visitLatitude,
      mappedLongitude:            body.visitLongitude,
      mappedMethod:               'Visit',
      mappedLocationUncertainty:  body.visitLocationUncertainty || body.mappedLocationUncertainty || null,
      mappedObserverUserName:     observer,
      mappedPoolStatus:           body.mappedPoolStatus || 'Potential',
    };
    if (!mappedBody.mappedByUser) {
      throw Object.assign(new Error('Cannot create new pool: observer/user name is required'), { code: 'MISSING_USER' });
    }

    // Allow explicit mapped overrides from body
    for (const key of Object.keys(body)) {
      if (key.startsWith('mapped') && key !== 'mappedPoolId') {
        mappedBody[key] = body[key];
      }
    }

    // Look up userId
    if (mappedBody.mappedByUser && !mappedBody.mappedUserId) {
      const userRes = await client.query(
        `SELECT id FROM vpuser WHERE username = $1`, [mappedBody.mappedByUser]
      );
      if (userRes.rows.length) mappedBody.mappedUserId = userRes.rows[0].id;
    }

    const mappedCols = pgUtil.parseColumns(mappedBody, 1, [], mappedColumns);
    const mappedText = `INSERT INTO vpmapped (${mappedCols.named}) VALUES (${mappedCols.numbered}) RETURNING "mappedPoolId"`;
    console.log('vpVisitNew | INSERT vpmapped:', mappedText, mappedCols.values);
    const mappedRes = await client.query(mappedText, mappedCols.values);
    const createdPoolId = mappedRes.rows[0].mappedPoolId;

    // --- Step 3: Build visit record ---
    const visitBody = {};
    for (const key of Object.keys(body)) {
      if (key.startsWith('visit')) {
        visitBody[key] = body[key];
      }
    }
    visitBody.visitPoolId = createdPoolId;

    const visitCols = pgUtil.parseColumns(visitBody, 1, [], visitColumns);
    const visitText = `INSERT INTO vpvisit (${visitCols.named}) VALUES (${visitCols.numbered}) RETURNING "visitId", "visitPoolId"`;
    console.log('vpVisitNew | INSERT vpvisit:', visitText, visitCols.values);
    const visitRes = await client.query(visitText, visitCols.values);

    await client.query('COMMIT');

    return {
      mappedPoolId: createdPoolId,
      visitId: visitRes.rows[0].visitId,
      visitPoolId: visitRes.rows[0].visitPoolId
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
