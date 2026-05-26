const express = require('express');
const router = express.Router();
const routes = require('../_helpers/routes');
const convert = require('json-2-csv');
const service = require('./vpVisit.service');
const uploads = require('./vpVisit.upload.service');
const s123svc = require('./vpVisit.s123.service');
const visitNewSvc = require('./vpVisitNew.service');
const photoSvc = require('./vpVisitPhoto.service');
const multer = require('multer');
const upFile = multer({ dest: 'vpvisit/uploads/' });
const upPhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const { scrubEmails } = require('../_helpers/scrub');
const fs = require('fs');

// routes NOTE: routes with names for same method (ie. GET) must be above routes
// for things like /:id, or they are missed/skipped.
router.get('/csv', getCsv);
router.get('/geojson', getGeoJson);
router.get('/shapefile', getShapeFile);
router.get('/columns', getColumns);
router.get('/routes', getRoutes);
router.get('/count', getCount);
router.get('/overview', getOverview);
router.get('/summary', getSummary);
router.get('/', getAll);
router.get('/page/:page', getPage);
router.get('/s123', getS123);
router.get('/s123/attachments', getS123attachments);
router.get('/s123/services', getS123Services);
router.get('/s123/uploads', getS123Uploads);
router.get('/:id/photos', getPhotos);
router.post('/:id/photos', upPhoto.array('photos', 20), uploadPhotos);
router.get('/:id', getById);
router.get('/pool/:poolId', getByPoolId);
//router.get('/upload/history', getUploadHistory);
router.post('/s123', postS123);
router.post('/s123/attachments', postS123Attachments);
router.post('/s123/all', postS123All);
router.post('/new', createPoolAndVisit);
router.post('/', create);
router.post('/upload', upFile.single('visitUploadFile'), upload);
router.put('/:id', update);
router.delete('/:id', _delete);

module.exports = router;

function getColumns(req, res, next) {
    service.getColumns()
        .then(columns => res.json(columns))
        .catch(err => next(err));
}

function getRoutes(req, res, next) {
    res.json(routes(router));
}

function getS123(req, res, next) {
    s123svc.getData(req)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getS123Services(req, res, next) {
    s123svc.getServices(req)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getS123Uploads(req, res, next) {
    s123svc.getUploads(req)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function postS123(req, res, next) {
    s123svc.getUpsertData(req)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function postS123All(req, res, next) {
    s123svc.getUpsertAll(req)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getS123attachments(req, res, next) {
    s123svc.getAttachments(req)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function postS123Attachments(req, res, next) {
    s123svc.getUpsertAttachments(req)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getCount(req, res, next) {
    service.getCount(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getStats(req, res, next) {
    service.getStats(req.query)
        .then(stats => res.json(stats))
        .catch(err => next(err));
}

function getOverview(req, res, next) {
    service.getOverview(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getSummary(req, res, next) {
    service.getSummary()
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getAll(req, res, next) {
    service.getAll(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getPage(req, res, next) {
    console.log('getPage req.query', req.query);
    service.getPage(req.params.page, req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getById(req, res, next) {
    service.getById(req.params.id)
        .then(item => {
          item ? res.json({'rowCount': item.rows.length, 'rows': item.rows}) : res.sendStatus(404);
        })
        .catch(err => next(err));
}

function getByPoolId(req, res, next) {
    service.getByPoolId(req.params.poolId)
        .then(item => {
            item ? res.json({'rowCount': item.rows.length, 'rows': item.rows}) : res.sendStatus(404)
        })
        .catch(err => next(err));
}

function getCsv(req, res, next) {
    console.log('vpVisit.routes | getCsv', req.query);
    service.getCsv(req.query)
        .then(items => {
            if (items.rows) {
              convert.json2csv(items.rows, (err, csv) => {
                if (err) next(err);
                if (req.query.download) {
                      var file = csv;
                      res.setHeader('Content-disposition', 'attachment; filename=vp_visit.csv');
                      res.setHeader('Content-type', 'text/csv');
                      res.send(file); //res.send not res.json
                } else {
                  res.send(csv);
                }
              });
            }
            else {res.json(items);}
        })
        .catch(err => next(err));
}

/*
  Here's how to use http to query same param for list of values:

  http://localhost:4000/mapped/geojson?mappedPoolStatus|NOT IN=Confirmed&mappedPoolStatus|NOT IN=Probable
  http://localhost:4000/mapped/geojson?mappedPoolStatus|IN=Confirmed&mappedPoolStatus|IN=Probable
*/
function getGeoJson(req, res, next) {
    console.log('vpVisit.routes::getGeoJson | req.query:', req.query);
    console.log('vpVisit.routes::getGeoJson | req.user:', req.user);

    var statusParam = req.query.mappedPoolStatus || req.query['mappedPoolStatus|IN'] || req.query['mappedPoolStatus|NOT IN'];

    if (!statusParam && (!req.user || (req.user && req.user.userrole != 'admin'))) {
      req.query['mappedPoolStatus|NOT IN'] = [ 'Eliminated', 'Duplicate' ];
    }

    service.getGeoJson(req.query)
        .then(items => {
            if (items.rows && items.rows[0].geojson) {
              // Public endpoint — strip emails from every feature's
              // properties (mappedLandownerEmail, the visitLandowner JSONB's
              // visitLandownerEmail key, and any user column whose value
              // happens to be an email address). Walks nested objects.
              scrubEmails(items.rows[0].geojson);
              if (req.query.download) {
                    var file = JSON.stringify(items.rows[0].geojson);
                    res.setHeader('Content-disposition', 'attachment; filename=vp_visit.geojson');
                    res.setHeader('Content-type', 'application/json');
                    res.send(file); //res.send not res.json
              } else {res.json(items.rows[0].geojson);}
            }
            else {res.json(items);}
        })
        .catch(err => next(err));
}

function getShapeFile(req, res, next) {
    console.log('vpVisit.routes::getShapeFile | req.query:', req.query);
    //console.log('vpMapped.routes::getShapeFile | req.user:', req.user);
    //console.log('vpMapped.routes::getShapeFile | req.dbUser:', req.dbUser);

    var statusParam = req.query.mappedPoolStatus || req.query['mappedPoolStatus|IN'] || req.query['mappedPoolStatus|NOT IN'];
    var excludeHidden = 0;

    if (!statusParam && (!req.user || (req.user && req.user.userrole != 'admin'))) {
        excludeHidden = 1;
    }

    service.getShapeFile(req.query, excludeHidden)
        .then(shpObj => {
            let fileSpec = `${process.cwd()}/${shpObj.all}`;
            console.log('vpVisit.routes::getShapeFile result', process.cwd(), shpObj.all);
            if (req.query.download) {
                res.setHeader('Content-disposition', `attachment; filename=${shpObj.filename}`);
                res.setHeader('Content-type', 'application/x-tar');
                res.download(fileSpec); //res.sendFile does the same
            } else {
                fs.readFile(fileSpec, (err, data) => {
                    if (err) {next(err);}
                    else {
                        res.setHeader('Content-type', 'application/x-tar');
                        res.send(data);
                    }
                })
            }
        })
        .catch(ret => {
            console.log('vpVisit.routes::getShapeFile ERROR | ret:', ret);
            let errs = ''; Object.keys(ret.error).map(key => {errs += ret.error[key]; errs += '|';})
            let err = new Error(errs);
            console.log('vpVisit.routes::getShapeFile ERROR | Constructed error object:', err);
            next(err);
        })
}

function createPoolAndVisit(req, res, next) {
    console.log('createPoolAndVisit req.body:');
    console.dir(req.body);
    visitNewSvc.createPoolAndVisit(req.body, req.user)
        .then((result) => res.json(result))
        .catch(err => {
            console.log('vpVisit.routes.createPoolAndVisit | error:', err);
            next(err);
        });
}

// Stamp the authenticated user's stable id onto every write that didn't
// already include one. Without this, rows can land with NULL ownership
// and end up orphaned from "My Visits" — which used to happen on every
// app upload before the frontend started sending these fields. Names
// (visitUserName, visitObserverUserName) are mutable and have drifted
// over the years; ids are forever.
function injectAuthUserId(body, jwtUser) {
    if (!jwtUser || jwtUser.sub == null) return body;
    let uid = Number(jwtUser.sub);
    if (!Number.isFinite(uid)) return body;
    if (body.visitUserId == null)         body.visitUserId = uid;
    if (body.visitObserverUserId == null) body.visitObserverUserId = uid;
    return body;
}

function create(req, res, next) {
    injectAuthUserId(req.body, req.user);
    console.log(`create req.body:`);
    console.dir(req.body);
    service.create(req.body)
        .then((item) => res.json(item))
        .catch(err => {
            console.log('vpVisit.routes.create | error: ' , err);
            if (err.code == 23505 && err.constraint == 'vpvisit_pkey') {
                err.name = 'UniquenessConstraintViolation';
                err.message = `Visit ID '${req.body.visitId}' is already taken. Please choose a different Visit ID.`;
            }
            next(err);
        });
}

function update(req, res, next) {
    injectAuthUserId(req.body, req.user);
    console.log('vpVisit.routes.update', req.body);
    service.update(req.params.id, req.body)
        .then((item) => res.json(item))
        .catch(err => {
            console.log('vpVisit.routes.update | error: ' , err);
            if (err.code == 23505 && err.constraint == 'vpvisit_pkey') {
                err.name = 'UniquenessConstraintViolation';
                err.message = `Visit ID '${req.body.visitId}' is already taken. Please choose a different Visit ID.`;
            }
            next(err);
        });
}

// DELETE /pools/visit/:id — gated to admin OR (owner AND not yet reviewed).
//
// req.user is the decoded JWT payload {sub, role, iat} (express-jwt 6.x
// overwrites whatever isRevoked sets — see vpTrack.routes.js for the same
// dance). req.dbUser is the looked-up vpuser row. Either is fine for the
// owner match; we accept whichever has an id.
async function _delete(req, res, next) {
    try {
        let visitId = parseInt(req.params.id);
        if (!visitId) return res.status(400).json({ message: 'invalid visit id' });

        let userId = (req.user && req.user.sub != null) ? Number(req.user.sub)
                   : (req.dbUser && req.dbUser.id != null) ? Number(req.dbUser.id)
                   : null;
        let isAdmin = (req.user && req.user.role === 'admin')
                   || (req.dbUser && req.dbUser.userrole === 'admin');
        if (userId == null && !isAdmin) {
            return res.status(401).json({
                name: 'UnauthorizedError',
                message: 'Sign in to delete a visit.'
            });
        }

        let row = await service.getDeleteEligibility(visitId);
        if (!row) return res.sendStatus(404);

        let isOwner = userId != null && (row.visitUserId === userId || row.visitObserverUserId === userId);
        if (!isAdmin) {
            if (!isOwner) {
                return res.status(403).json({
                    name: 'ForbiddenError',
                    message: 'You can only delete visits you submitted.'
                });
            }
            if (row.isReviewed) {
                return res.status(403).json({
                    name: 'ForbiddenError',
                    message: 'This visit has already been reviewed and can no longer be deleted. Contact an admin if you need it removed.'
                });
            }
        }

        await service.delete(visitId);
        res.json({ visitId });
    } catch (err) {
        console.log('vpVisit.routes::_delete error', err && err.message || err);
        next(err);
    }
}

function upload(req, res, next) {
    console.log('vpVisit.routes::upload() | req.file:', req.file);
    console.log('vpVisit.routes::upload() | req.body', req.body);
    console.log('vpVisit.routes::upload() | req.query', req.query);
    uploads.upload(req)
        .then((item) => {res.json(item);})
        .catch(err => {
            console.log('vpVisit.routes::upload() | error: ', err.code, '|', err.message, '|', err.detail);
            next(err);
        });
}

function getUploadHistory(req, res, next) {
    uploads.history(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

// --- Photo routes ---

function getPhotos(req, res, next) {
    photoSvc.getByVisitId(req.params.id)
        .then(result => res.json(result.rows || []))
        .catch(err => next(err));
}

function uploadPhotos(req, res, next) {
    let visitId = req.params.id;
    let photoType = req.body.photoType || 'pool';
    let files = req.files || [];
    console.log(`uploadPhotos | visitId=${visitId} type=${photoType} files=${files.length}`);

    if (!files.length) {
        return res.status(400).json({ message: 'No files provided' });
    }

    Promise.all(files.map(file => photoSvc.upload(visitId, photoType, file)))
        .then(results => res.json(results))
        .catch(err => {
            console.log('uploadPhotos error:', err);
            next(err);
        });
}
