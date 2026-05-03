const express = require('express');
const router = express.Router();
const routes = require('../_helpers/routes');
const userService = require('./vpUser.service.pg');
const sendmail = require('./sendmail');

// routes
router.get('/routes', getRoutes);
router.post('/authenticate', authenticate);
router.post('/register', register);
router.post('/check', check);
router.post('/reset', reset);
router.get('/test', test); //send a test email to req.query.email
//router.post('/test', test); //send a test email to req.query.email
router.post('/verify', verify); //verify a valid reset token
router.post('/confirm', confirm);
router.post('/new_email/:id', new_email);
router.get('/columns', getColumns);
router.get('/roles', getRoles);
router.get('/', getAll);
router.get('/page/:page', getPage);
router.get('/:id', getById);
router.put('/:id', update);
router.delete('/:id', _delete);

module.exports = router;

function getRoutes(req, res, next) {
    res.json(routes(router));
}

function authenticate(req, res, next) {
    console.log(`vpUser.routes.pg.authenticate | req.body:`, req.body);
    userService.authenticate(req.body)
        .then(ret => {
          console.log('vpUser.routes.pg.js::authenticate | SUCCESS |', ret);
          res.json(ret);
        })
        .catch(err => {
          console.dir('vpUser.routes.pg.js::authenticate | ERROR', err);
          next(err)
        });
}

function register(req, res, next) {
    console.log(`users.pg.routes.register | req.body:`, req.body);
    userService.register(req.body)
        .then(user => res.json(user))
        .catch(err => next(err));
}

function check(req, res, next) {
    console.log(`users.pg.routes.check | req.body:`, req.body);
    userService.check(req.body)
        .then(user => res.json(user))
        .catch(err => next(err));
}

function getColumns(req, res, next) {
    console.log(`vpUser.routes.pg.js::getColumns() | req.query`, req.query);
    if (req.user.role != 'admin') throw('Requesting User is not authorized to GET vpuser columns.');
    userService.getColumns(req.query)
        .then(users => res.json(users))
        .catch(err => next(err));
}

function getRoles(req, res, next) {
    console.log(`vpUser.routes.pg.js::getRoles() | req.query`, req.query);
    if (req.user.role != 'admin') throw('Requesting User is not authorized to GET User Roles.');
    userService.getRoles(req.query)
        .then(users => res.json(users))
        .catch(err => next(err));
}

function getAll(req, res, next) {
    console.log(`vpUser.routes.pg.js::getAll() | req.user`, req.user);
    if (req.user.role != 'admin') throw('Requesting User is not authorized to GET All Users.');
    userService.getAll(req.query)
        .then(users => res.json(users))
        .catch(err => next(err));
}

function getPage(req, res, next) {
    console.log(`vpUser.routes.pg.js::getPage() | req.user`, req.user);
    if (req.user.role != 'admin') throw('Requesting User is not authorized to GET All Users.');
    console.log('getPage req.query', req.query);
    userService.getPage(req.params.page, req.query)
        .then(users => res.json(users))
        .catch(err => next(err));
}

function getById(req, res, next) {
    console.log(`vpUser.routes.pg.js::getById() | req.user`, req.user);
    if (req.user.role != 'admin' && req.user.sub != req.params.id) {
        throw(`Requesting User is not authorized to GET Users by ID unless it's their own.`);
    }
    userService.getById(req.params.id)
        .then(user => user ? res.json(user) : res.sendStatus(404))
        .catch(err => next(err));
}

function update(req, res, next) {
    console.log(`vpUser.routes.pg.js::update() | req.user`, req.user);
    if (req.user.role != 'admin' && req.user.sub != req.params.id) {
        throw(`Requesting User is not authorized to PUT Users by ID unless it's their own.`);
    }
    console.log(`update id ${req.params.id} req.body:`, req.body);
    userService.update(req.params.id, req.body, req.user)
        .then(() => res.json({}))
        .catch(err => next(err));
}

function reset(req, res, next) {
    console.log(`vpUser.routes.pg.js::reset() | req.body`, req.body);
    userService.reset(req.body.email)
        .then(ret => res.json(ret))
        .catch(err => next(err));
}

//reachable by GET, so easy to test email in browser
function test(req, res, next) {
    console.log(`vpUser.routes.pg.js::test() | req.body:`, req.body);
    console.log(`vpUser.routes.pg.js::test() | req.query:`, req.query);
    userService.test(req.query.email)
        .then(ret => res.json(ret))
        .catch(err => next(err));
}

//to make this easy to test, make reachable by GET
function verify(req, res, next) {
    console.log(`vpUser.routes.pg.js::verify() | req.body:`, req.body);
    userService.verify(req.body.token)
        .then(ret => res.json(ret))
        .catch(err => next(err));
}

//can only be reached by POST, so we have control and put data in body
function confirm(req, res, next) {
    console.log(`vpUser.routes.pg.js::confirm() | req.body:`, req.body);
    userService.confirm(req.body.token, req.body.password)
        .then(ret => res.json(ret))
        .catch(err => next(err));
}

//can only be reached by POST, so we have control and put data in body
function new_email(req, res, next) {
    console.log(`vpUser.routes.pg.js::new_email() | req.body:`, req.body);
    if (req.user.role != 'admin' && req.user.sub != req.params.id) {
        throw(`Requesting User is not authorized to PUT Users by ID unless it's their own.`);
    }
    userService.new_email(req.params.id, req.body.email)
        .then(ret => res.json(ret))
        .catch(err => next(err));
}

function _delete(req, res, next) {
    console.log(`vpUser.routes.pg.js::delete() | req.user`, req.user);
    if (req.user.role != 'admin') throw('Requesting User is not authorized to DELETE Users.');
    userService.delete(req.params.id)
        .then(() => res.json({}))
        .catch(err => next(err));
}
