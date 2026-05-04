/*
    api.js - All VPAtlas API calls as ES6 module
    Replaces Angular's 9 separate services with a single module.
    Pattern from LoonWeb explore/js/api.js
*/
let config = appConfig; // from config.js global
import { getLocal } from './storage.js';

console.log('api.js=>config.api.fqdn', config.api.fqdn);

// Safe JSON parse - handles non-JSON responses
async function safeJsonParse(res, context='') {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error(`api.js=>safeJsonParse(${context}) status:${res.status} — not JSON:`, text.substring(0, 200));
        throw {
            name: 'APIError',
            message: `${res.status} ${res.statusText} — ${context}`,
            detail: text.substring(0, 200),
            status: res.status
        };
    }
}

// Build auth header with JWT token
async function authHeader() {
    let header = { 'Content-Type': 'application/json' };
    try {
        let token = await getLocal('auth_token');
        if (token) { header.Authorization = `Bearer ${token}`; }
    } catch(err) {}
    return header;
}

// Core fetch - GET
export async function fetchApiRoute(route, searchTerm=false) {
    var url = `${config.api.fqdn}/${route}`;
    if (searchTerm) { url += `?${searchTerm}`; }
    try {
        let header = await authHeader();
        let res = await fetch(url, { method: 'GET', headers: header });
        let json = await safeJsonParse(res, `GET ${route}`);
        if (!res.ok) throw json;
        json.query = url;
        return json;
    } catch (err) {
        err.query = url;
        throw err;
    }
}

// Core fetch - POST
export async function postApiRoute(route, jsonBody, searchTerm=false) {
    var url = `${config.api.fqdn}/${route}`;
    if (searchTerm) { url += `?${searchTerm}`; }
    try {
        let header = await authHeader();
        let res = await fetch(url, {
            method: 'POST',
            headers: header,
            body: JSON.stringify(jsonBody)
        });
        let json = await safeJsonParse(res, `POST ${route}`);
        if (!res.ok) throw json;
        json.query = url;
        return json;
    } catch(err) {
        err.query = url;
        throw err;
    }
}

// Core fetch - PUT
export async function putApiRoute(route, jsonBody) {
    var url = `${config.api.fqdn}/${route}`;
    try {
        let header = await authHeader();
        let res = await fetch(url, {
            method: 'PUT',
            headers: header,
            body: JSON.stringify(jsonBody)
        });
        let json = await safeJsonParse(res, `PUT ${route}`);
        if (!res.ok) throw json;
        json.query = url;
        return json;
    } catch(err) {
        err.query = url;
        throw err;
    }
}

// Core fetch - DELETE
export async function deleteApiRoute(route) {
    var url = `${config.api.fqdn}/${route}`;
    try {
        let header = await authHeader();
        let res = await fetch(url, { method: 'DELETE', headers: header });
        let json = await safeJsonParse(res, `DELETE ${route}`);
        if (!res.ok) throw json;
        json.query = url;
        return json;
    } catch(err) {
        err.query = url;
        throw err;
    }
}

// =============================================================================
// AUTH
// =============================================================================
export async function authenticate(body) { return postApiRoute('users/authenticate', body); }
export async function register(body) { return postApiRoute('users/register', body); }
export async function resetPassword(body) { return postApiRoute('users/reset', body); }
export async function verifyUser(body) { return postApiRoute('users/verify', body); }
export async function confirmUser(body) { return postApiRoute('users/confirm', body); }

// =============================================================================
// USERS
// =============================================================================
export async function fetchUsers(searchTerm) { return fetchApiRoute('users', searchTerm); }
export async function fetchUserById(id) { return fetchApiRoute(`users/${id}`); }
export async function updateUser(id, body) { return putApiRoute(`users/${id}`, body); }
export async function deleteUser(id) { return deleteApiRoute(`users/${id}`); }

// =============================================================================
// VT INFO (towns, counties)
// =============================================================================
export async function fetchTowns(searchTerm) { return fetchApiRoute('vtinfo/towns', searchTerm); }
export async function fetchCounties(searchTerm) { return fetchApiRoute('vtinfo/counties', searchTerm); }

// =============================================================================
// MAPPED POOLS
// =============================================================================
export async function fetchMappedPools(searchTerm) { return fetchApiRoute('pools/mapped', searchTerm); }
export async function fetchMappedPoolById(id) { return fetchApiRoute(`pools/mapped/${id}`); }
export async function fetchMappedPoolPage(page, searchTerm) { return fetchApiRoute(`pools/mapped/page/${page}`, searchTerm); }
export async function fetchMappedPoolGeoJson(searchTerm) { return fetchApiRoute('pools/mapped/geojson', searchTerm); }
export async function fetchMappedPoolStats(searchTerm) { return fetchApiRoute('pools/mapped/stats', searchTerm); }
export async function createMappedPool(body) { return postApiRoute('pools/mapped', body); }
export async function updateMappedPool(id, body) { return putApiRoute(`pools/mapped/${id}`, body); }

// =============================================================================
// POOL VISITS
// =============================================================================
export async function fetchVisitSummary() { return fetchApiRoute('pools/visit/summary'); }
export async function fetchVisits(searchTerm) { return fetchApiRoute('pools/visit', searchTerm); }
export async function fetchVisitById(id) { return fetchApiRoute(`pools/visit/${id}`); }
export async function fetchVisitsByPool(poolId) { return fetchApiRoute(`pools/visit/pool/${poolId}`); }
export async function fetchVisitPage(page, searchTerm) { return fetchApiRoute(`pools/visit/page/${page}`, searchTerm); }
export async function createVisit(body) { return postApiRoute('pools/visit', body); }
export async function createPoolAndVisit(body) { return postApiRoute('pools/visit/new', body); }
export async function updateVisit(id, body) { return putApiRoute(`pools/visit/${id}`, body); }
export async function fetchVisitPhotos(visitId) { return fetchApiRoute(`pools/visit/${visitId}/photos`); }

// =============================================================================
// COMBINED POOLS (mapped + visits)
// =============================================================================
export async function fetchPools(searchTerm) { return fetchApiRoute('pools', searchTerm); }
export async function fetchPoolPage(page, searchTerm) { return fetchApiRoute(`pools/page/${page}`, searchTerm); }
export async function fetchPoolGeoJson(searchTerm) { return fetchApiRoute('pools/geojson', searchTerm); }

// =============================================================================
// REVIEWS
// =============================================================================
export async function fetchReviews(searchTerm) { return fetchApiRoute('review', searchTerm); }
export async function fetchReviewById(id) { return fetchApiRoute(`review/${id}`); }
export async function fetchReviewsByVisit(visitId) { return fetchApiRoute('review', `reviewVisitId=${visitId}`); }
export async function createReview(body) { return postApiRoute('review', body); }
export async function updateReview(id, body) { return putApiRoute(`review/${id}`, body); }

// =============================================================================
// SURVEYS (vpsurvey / monitoring)
// =============================================================================
export async function fetchSurveySummary() { return fetchApiRoute('survey/summary'); }
export async function fetchSurveys(searchTerm) { return fetchApiRoute('survey', searchTerm); }
export async function fetchSurveyById(id) { return fetchApiRoute(`survey/${id}`); }
export async function fetchSurveysByPool(poolId) { return fetchApiRoute(`survey/pool/${poolId}`); }
export async function fetchSurveyTypes() { return fetchApiRoute('survey/types'); }
export async function fetchSurveyYears() { return fetchApiRoute('survey/years'); }
export async function fetchSurveyObservers() { return fetchApiRoute('survey/observers'); }
export async function fetchSurveyGeoJson(searchTerm) { return fetchApiRoute('survey/geojson', searchTerm); }
export async function createSurvey(body) { return postApiRoute('survey', body); }
export async function updateSurvey(id, body) { return putApiRoute(`survey/${id}`, body); }
// Field survey endpoints — explicit parent + child inserts (no JSON triggers)
export async function fetchFieldSurveyById(id) { return fetchApiRoute(`survey/field/${id}`); }
export async function createFieldSurvey(body) { return postApiRoute('survey/field', body); }
export async function updateFieldSurvey(id, body) { return putApiRoute(`survey/field/${id}`, body); }
export async function fetchSurveyPhotos(surveyId) { return fetchApiRoute(`survey/${surveyId}/photos`); }

// =============================================================================
// PARCELS (VCGI)
// =============================================================================
export async function fetchParcelByTownId(townId) { return fetchApiRoute(`parcel/townId/${townId}`); }
export async function fetchParcelByTownName(townName) { return fetchApiRoute(`parcel/townName/${townName}`); }

// =============================================================================
// S123 IMPORT — Visits
// =============================================================================
export async function fetchVisitS123Services() { return fetchApiRoute('pools/visit/s123/services'); }
export async function fetchVisitS123Uploads(serviceId) { return fetchApiRoute('pools/visit/s123/uploads', `visitServiceId=${serviceId}`); }
export async function postVisitS123All(serviceId, update, offset, limit) {
    return postApiRoute('pools/visit/s123/all', {}, `serviceId=${serviceId}&update=${update}&offset=${offset}&limit=${limit}`);
}

// =============================================================================
// S123 IMPORT — Surveys
// =============================================================================
export async function fetchSurveyS123Services() { return fetchApiRoute('survey/s123/services'); }
export async function fetchSurveyS123Uploads(serviceId) { return fetchApiRoute('survey/s123/uploads', `surveyServiceId=${serviceId}`); }
export async function postSurveyS123All(serviceId, update, offset, limit) {
    return postApiRoute('survey/s123/all', {}, `serviceId=${serviceId}&update=${update}&offset=${offset}&limit=${limit}`);
}
export async function postSurveyS123Abort() { return postApiRoute('survey/s123/abort', {}); }

// =============================================================================
// AWS S3
// =============================================================================
export async function fetchS3Info(bucketName) { return fetchApiRoute(`aws/s3/${bucketName}`); }
