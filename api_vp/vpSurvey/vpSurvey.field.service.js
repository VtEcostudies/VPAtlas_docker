/*
  vpSurvey.field.service.js — Field survey API (LoonWeb pattern)

  Explicit parent + child table inserts instead of JSON-column triggers.
  The old create() stuffs JSON into vpsurvey columns and lets DB triggers
  decompose it into child tables. This module inserts parent and children
  directly, with validation and clear error reporting.
*/
const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');

// Column lists loaded at startup — one per table
var parentColumns = [];
var amphibColumns = [];
var macroColumns = [];

// Load columns for each table we touch
pgUtil.getColumns('vpsurvey', parentColumns)
  .catch(err => console.log('field.service getColumns vpsurvey error:', err.message));
pgUtil.getColumns('vpsurvey_amphib', amphibColumns)
  .catch(err => console.log('field.service getColumns vpsurvey_amphib error:', err.message));
pgUtil.getColumns('vpsurvey_macro', macroColumns)
  .catch(err => console.log('field.service getColumns vpsurvey_macro error:', err.message));

module.exports = {
  validate,
  getById,
  create,
  update,
};

// =============================================================================
// VALIDATION
// =============================================================================
function validate(body) {
  let errors = [];
  if (!body.surveyPoolId) errors.push('surveyPoolId is required');
  if (!body.surveyDate) errors.push('surveyDate is required');
  if (!body.surveyUserEmail) errors.push('surveyUserEmail is required');
  if (!body.surveyTypeId) errors.push('surveyTypeId (field visit number) is required');

  // Amphib observers must have email if present
  if (body.amphib && Array.isArray(body.amphib)) {
    body.amphib.forEach((obs, i) => {
      if (!obs.surveyAmphibObsEmail) {
        errors.push(`amphib[${i}].surveyAmphibObsEmail is required`);
      }
    });
  }

  return errors;
}

// =============================================================================
// GET BY ID — joins child tables directly (no JSON column dependency)
// =============================================================================
async function getById(surveyId) {
  // Parent + mapped pool + type info
  let parentRes = await query(`
    SELECT vpsurvey.*,
      "townName", "countyName",
      def_survey_type."surveyTypeName",
      "mappedPoolId" AS "poolId",
      "mappedPoolStatus" AS "poolStatus",
      SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
      SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
      COALESCE(surveyuser.handle, surveyuser.username) AS "surveyUserLogin"
    FROM vpsurvey
    INNER JOIN vpmapped ON "mappedPoolId"="surveyPoolId"
    INNER JOIN def_survey_type ON vpsurvey."surveyTypeId"=def_survey_type."surveyTypeId"
    LEFT JOIN vpuser AS surveyuser ON "surveyUserId"=surveyuser."id"
    LEFT JOIN vptown ON "mappedTownId"="townId"
    LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
    WHERE "surveyId"=$1
  `, [surveyId]);

  if (!parentRes.rows.length) return null;
  let survey = parentRes.rows[0];

  // Amphib child rows
  let amphibRes = await query(`
    SELECT * FROM vpsurvey_amphib
    WHERE "surveyAmphibSurveyId"=$1
    ORDER BY "surveyAmphibObsEmail"
  `, [surveyId]);
  survey.amphib = amphibRes.rows;

  // Macro child row
  let macroRes = await query(`
    SELECT * FROM vpsurvey_macro
    WHERE "surveyMacroSurveyId"=$1
  `, [surveyId]);
  survey.macro = macroRes.rows[0] || null;

  return survey;
}

// =============================================================================
// CREATE — explicit parent + child inserts
// =============================================================================
async function create(body) {
  // 1. Separate parent fields from child arrays
  let { amphib, macro, ...parentBody } = body;

  // Exclude JSON columns — we're not using triggers
  delete parentBody.surveyAmphibJson;
  delete parentBody.surveyMacroJson;
  delete parentBody.surveyYearJson;
  delete parentBody.surveyPhotoJson;

  // 2. Insert parent row
  let parentCols = pgUtil.parseColumns(parentBody, 1, [], parentColumns);
  let parentText = `INSERT INTO vpsurvey (${parentCols.named}) VALUES (${parentCols.numbered}) RETURNING "surveyId"`;
  console.log('field.service=>create parent:', parentText, parentCols.values);

  let parentRes = await query(parentText, parentCols.values);
  let surveyId = parentRes.rows[0].surveyId;
  console.log('field.service=>create surveyId:', surveyId);

  // 3. Insert year row
  let surveyYear = body.surveyDate ? new Date(body.surveyDate).getFullYear() : new Date().getFullYear();
  await query(
    `INSERT INTO vpsurvey_year ("surveyYearSurveyId", "surveyYear") VALUES ($1, $2)`,
    [surveyId, surveyYear]
  ).catch(err => console.log('field.service=>create year insert error:', err.message));

  // 4. Insert amphib rows (one per observer)
  let amphibResults = [];
  if (amphib && Array.isArray(amphib)) {
    for (let obs of amphib) {
      obs.surveyAmphibSurveyId = surveyId;
      let amphibRes = await insertAmphib(obs);
      amphibResults.push(amphibRes);
    }
  }

  // 5. Insert macro row
  let macroResult = null;
  if (macro && Object.keys(macro).length) {
    macro.surveyMacroSurveyId = surveyId;
    macroResult = await insertMacro(macro);
  }

  return {
    surveyId,
    parent: { rowCount: parentRes.rowCount },
    amphib: amphibResults,
    macro: macroResult,
  };
}

// =============================================================================
// UPDATE — explicit parent update + delete/re-insert children
// =============================================================================
async function update(id, body) {
  let { amphib, macro, ...parentBody } = body;

  // Exclude JSON columns
  delete parentBody.surveyAmphibJson;
  delete parentBody.surveyMacroJson;
  delete parentBody.surveyYearJson;
  delete parentBody.surveyPhotoJson;

  // 1. Update parent row
  let parentCols = pgUtil.parseColumns(parentBody, 2, [id], parentColumns);
  let parentText = `UPDATE vpsurvey SET (${parentCols.named}) = (${parentCols.numbered}) WHERE "surveyId"=$1 RETURNING "surveyId"`;
  console.log('field.service=>update parent:', parentText, parentCols.values);

  let parentRes = await query(parentText, parentCols.values);
  let surveyId = parentRes.rows[0].surveyId;

  // 2. Delete old children, then re-insert (LoonWeb pattern — clean slate)
  await query(`DELETE FROM vpsurvey_amphib WHERE "surveyAmphibSurveyId"=$1`, [surveyId]);
  await query(`DELETE FROM vpsurvey_macro WHERE "surveyMacroSurveyId"=$1`, [surveyId]);

  // 3. Re-insert amphib
  let amphibResults = [];
  if (amphib && Array.isArray(amphib)) {
    for (let obs of amphib) {
      obs.surveyAmphibSurveyId = surveyId;
      let amphibRes = await insertAmphib(obs);
      amphibResults.push(amphibRes);
    }
  }

  // 4. Re-insert macro
  let macroResult = null;
  if (macro && Object.keys(macro).length) {
    macro.surveyMacroSurveyId = surveyId;
    macroResult = await insertMacro(macro);
  }

  // 5. Update year
  let surveyYear = body.surveyDate ? new Date(body.surveyDate).getFullYear() : new Date().getFullYear();
  await query(
    `INSERT INTO vpsurvey_year ("surveyYearSurveyId", "surveyYear") VALUES ($1, $2)
     ON CONFLICT ON CONSTRAINT "vpsurvey_year_unique_surveyId_surveyYear" DO NOTHING`,
    [surveyId, surveyYear]
  ).catch(err => console.log('field.service=>update year upsert error:', err.message));

  return {
    surveyId,
    parent: { rowCount: parentRes.rowCount },
    amphib: amphibResults,
    macro: macroResult,
  };
}

// =============================================================================
// CHILD INSERT HELPERS
// =============================================================================
async function insertAmphib(obs) {
  let cols = pgUtil.parseColumns(obs, 1, [], amphibColumns);
  let text = `INSERT INTO vpsurvey_amphib (${cols.named}) VALUES (${cols.numbered}) RETURNING *`;
  console.log('field.service=>insertAmphib:', text, cols.values);
  return await query(text, cols.values);
}

async function insertMacro(macro) {
  let cols = pgUtil.parseColumns(macro, 1, [], macroColumns);
  let text = `INSERT INTO vpsurvey_macro (${cols.named}) VALUES (${cols.numbered}) RETURNING *`;
  console.log('field.service=>insertMacro:', text, cols.values);
  return await query(text, cols.values);
}
