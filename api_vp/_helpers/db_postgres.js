/*
  https://node-postgres.com/
  Adapted for Docker: reads DB config from environment variables via config.js
*/
const config = require('../config');
const moment = require('moment');
const types = require('pg').types;
const { Pool } = require('pg');
const connPool = new Pool(config.db);

//https://stackoverflow.com/questions/37300997/multi-row-insert-with-pg-promise
const pgp = require('pg-promise')({
    capSQL: true // capitalize all generated SQL
});
const pgpDb = pgp(config.db);

console.log(`postgres config |`, {
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user
});

/*
 * Fix date display error.
 * Override pg default behavior which adjusts date-only values for local TZ.
 * date OID=1082, timestamp OID=1114
 */
parseDate = function(val) {
   return val;
}

types.setTypeParser(1082, parseDate);

module.exports = {
  query: (text, params) => connPool.query(text, params),
  pgp: pgp,
  pgpDb: pgpDb
};
