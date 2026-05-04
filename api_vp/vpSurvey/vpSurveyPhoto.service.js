/*
  vpSurveyPhoto.service.js — Read-only access to vpsurvey_photos.

  Mirrors vpVisitPhoto.service.getByVisitId for the survey/monitoring side.
  Photos are inserted by the S123 import path; this module only fetches them
  for display in survey_view.html.
*/

const db = require('_helpers/db_postgres');
const query = db.query;

module.exports = {
    getBySurveyId
};

async function getBySurveyId(surveyId) {
    let text = `SELECT * FROM vpsurvey_photos
                WHERE "surveyPhotoSurveyId" = $1
                ORDER BY "surveyPhotoSpecies", "surveyPhotoUrl"`;
    return await query(text, [surveyId]);
}
