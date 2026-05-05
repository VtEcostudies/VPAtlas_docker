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

// express-jwt 6.x overwrites req.user with the decoded JWT payload after
// our isRevoked callback runs (see node_modules/express-jwt/lib/index.js
// at the end of async.waterfall). So req.user always looks like
//   { sub: <userId>, role: <userrole>, iat: ... }
// even though our jwt.js tries to put the vpuser row there. The DB row
// survives only at req.dbUser. Authoritative user id = JWT subject;
// authoritative role = JWT role (which authenticate signed with the
// vpuser.userrole at login time).
function getAuthUserId(req) {
    if (req.user && (req.user.sub != null)) return req.user.sub;
    if (req.dbUser && (req.dbUser.id != null)) return req.dbUser.id;
    return null;
}
function isAdmin(req) {
    if (req.user && req.user.role === 'admin') return true;
    if (req.dbUser && req.dbUser.userrole === 'admin') return true;
    return false;
}

function requireAuthedUser(req, res) {
    let uid = getAuthUserId(req);
    if (uid == null) {
        let userKeys = req.user ? Object.keys(req.user) : null;
        let dbKeys = req.dbUser ? Object.keys(req.dbUser) : null;
        let detail = `req.user keys=[${userKeys ? userKeys.join(',') : 'null'}], req.dbUser keys=[${dbKeys ? dbKeys.join(',') : 'null'}]`;
        console.log('vpTrack.routes::requireAuthedUser BLOCKED |', detail);
        res.status(401).json({
            name: 'UnauthorizedError',
            message: 'Your session has expired. Please sign out and sign back in.',
            detail
        });
        return false;
    }
    return true;
}

function list(req, res, next) {
    if (!requireAuthedUser(req, res)) return;
    let uid = getAuthUserId(req);
    if (req.query.scope === 'all' && isAdmin(req)) {
        service.listAll(parseInt(req.query.limit) || 500)
            .then(result => res.json({ rowCount: result.rowCount, rows: result.rows }))
            .catch(err => next(err));
        return;
    }
    service.listForUser(uid, parseInt(req.query.limit) || 200)
        .then(result => res.json({ rowCount: result.rowCount, rows: result.rows }))
        .catch(err => next(err));
}

function getById(req, res, next) {
    if (!requireAuthedUser(req, res)) return;
    let trackId = parseInt(req.params.id);
    if (!trackId) return res.status(400).json({ message: 'invalid track id' });
    let uid = getAuthUserId(req);
    service.getById(trackId)
        .then(result => {
            if (!result.rowCount) return res.sendStatus(404);
            let row = result.rows[0];
            if (row.userId !== uid && !isAdmin(req)) return res.sendStatus(403);
            res.json(row);
        })
        .catch(err => next(err));
}

function create(req, res, next) {
    if (!requireAuthedUser(req, res)) return;
    let uid = getAuthUserId(req);
    service.create(uid, req.body)
        .then(result => res.json(result.rows[0]))
        .catch(err => {
            console.log('vpTrack.routes.create | error:', err.message || err);
            next(err);
        });
}

function _delete(req, res, next) {
    if (!requireAuthedUser(req, res)) return;
    let trackId = parseInt(req.params.id);
    if (!trackId) return res.status(400).json({ message: 'invalid track id' });
    let uid = getAuthUserId(req);
    service.delete(trackId, uid, isAdmin(req))
        .then(result => {
            if (!result.rowCount) return res.sendStatus(404);
            res.json({ trackId: result.rows[0].trackId });
        })
        .catch(err => next(err));
}
