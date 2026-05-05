const express = require('express');
const router = express.Router();
const service = require('./vpTrack.service');

// All track endpoints require auth (no /unless exception in jwt.js).
// Visibility:
//   - Regular users see only their own tracks.
//   - Admins see all tracks.
//   - Tracks are never public.
//
// req.user is populated by _helpers/jwt.js from the JWT token.

router.get('/', list);
router.get('/:id', getById);
router.post('/', create);
router.delete('/:id', _delete);

module.exports = router;

function isAdmin(req) {
    return req.user && req.user.userrole === 'admin';
}

function list(req, res, next) {
    if (!req.user) return res.sendStatus(401);
    if (req.query.scope === 'all' && isAdmin(req)) {
        service.listAll(parseInt(req.query.limit) || 500)
            .then(result => res.json({ rowCount: result.rowCount, rows: result.rows }))
            .catch(err => next(err));
        return;
    }
    service.listForUser(req.user.id, parseInt(req.query.limit) || 200)
        .then(result => res.json({ rowCount: result.rowCount, rows: result.rows }))
        .catch(err => next(err));
}

function getById(req, res, next) {
    if (!req.user) return res.sendStatus(401);
    let trackId = parseInt(req.params.id);
    if (!trackId) return res.status(400).json({ message: 'invalid track id' });
    service.getById(trackId)
        .then(result => {
            if (!result.rowCount) return res.sendStatus(404);
            let row = result.rows[0];
            if (row.userId !== req.user.id && !isAdmin(req)) return res.sendStatus(403);
            res.json(row);
        })
        .catch(err => next(err));
}

function create(req, res, next) {
    if (!req.user) return res.sendStatus(401);
    service.create(req.user.id, req.body)
        .then(result => res.json(result.rows[0]))
        .catch(err => {
            console.log('vpTrack.routes.create | error:', err.message || err);
            next(err);
        });
}

function _delete(req, res, next) {
    if (!req.user) return res.sendStatus(401);
    let trackId = parseInt(req.params.id);
    if (!trackId) return res.status(400).json({ message: 'invalid track id' });
    service.delete(trackId, req.user.id, isAdmin(req))
        .then(result => {
            if (!result.rowCount) return res.sendStatus(404);
            res.json({ trackId: result.rows[0].trackId });
        })
        .catch(err => next(err));
}
