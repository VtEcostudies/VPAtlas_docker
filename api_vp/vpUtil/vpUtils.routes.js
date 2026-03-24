const express = require('express');
const router = express.Router();
const routes = require('../_helpers/routes');
const service = require('./vpUtils.service');
const sendmail = require('../users/sendmail');
var emailTimer = {}; //a list of send-to emails timed to be sent from the VPAtlas email account (vpatlas@vtecostudies.org)

// routes
router.get('/where', testWhereClause);
router.get('/routes', getRoutes);
router.get('/untar', getUntar);
router.post('/timer', setEmailTimer);
router.put('/timer', setEmailTimer);
router.get('/timer', getEmailTimer);
router.delete('/timer', deleteEmailTimer);

module.exports = router;

function testWhereClause(req, res, next) {
    console.log('vpUtils.routes.testWhereClause req.query', req.query);
    service.testWhereClause(req)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getRoutes(req, res, next) {
    res.json(routes(router));
}

function getUntar(req, res, next) {
    let filename = 'untar_win.bat';
    let fileSpec = './' + filename;
    res.setHeader('Content-disposition', `attachment; filename=${fileSpec}`);
    res.setHeader('Content-type', 'application/x-bat');
    res.download(fileSpec);
}

/*
second: 1
minute: 60
hour: 3,600
day: 86,400
week: 604,800
max timer milliseconds: 2,147,483,647 (about 25 days)
*/
function setEmailTimer(req, res, next) {
    let intEmail = req.query.email;
    let interval = req.query.interval;
    interval = parseInt(interval);

    console.log('setEmailTimer', intEmail, interval);

    if (intEmail) {
        if (emailTimer[intEmail]) {clearInterval(emailTimer[intEmail].handle);}
        delete emailTimer[intEmail]; //always delete and reset
        if (interval > 0) {
            emailTimer[intEmail] = {
                handle: (setInterval(cbEmailTimer, interval*1000, intEmail, interval)), 
                interval: interval
            };
            cbEmailTimer(intEmail, interval); //call it at time=0 to get immediate feedback
            res.json({message:`Set email timer for ${intEmail} at ${interval} seconds.`});
        } else {
            res.json({message:`Removed email timer for ${intEmail}.`});
        }
    } else {
        res.json({message:`Missing query parameter 'email='`});
    }
}

function getEmailTimer(req, res, next) {
    console.log('getEmailTimer | emailTimer:', emailTimer);
    let emailTimerList = [emailTimer];
    for (const email in emailTimer) {
        //emailTimerList[email] = {
        emailTimerList.push({
            email: email,
            interval: emailTimer[email].interval, 
            idleTimeout: emailTimer[email].handle._idleTimeout,
            idleStart: emailTimer[email].handle._idleStart,
            repeat: emailTimer[email].handle._repeat,
            destroyed: emailTimer[email].handle._destroyed
        });
    }
    res.json(emailTimerList);
}

function deleteEmailTimer(req, res, next) {
    let before = Object.keys(emailTimer).length;
    console.log('deleteEmailTimer | emailTimer:', emailTimer);
    let intEmail = req.query.email;
    if (intEmail) {
        if (emailTimer[intEmail]) {clearInterval(emailTimer[intEmail].handle);}
        delete emailTimer[intEmail];
    } else {
        for (const email in emailTimer) {
            clearInterval(emailTimer[email].handle);
            delete emailTimer[email];
        }
    }
    let msg = `Removed email timer(s)`;
    if (intEmail) msg += ` for ${intEmail}`;
    res.json({message: msg, before: before, after: Object.keys(emailTimer).length});
}

function cbEmailTimer(intEmail, interval) {
    console.log(`Email timer callback function called for ${intEmail}`);

    sendmail.test(intEmail, interval)
      .then(ret => {console.log(ret);})
      .catch(err => {console.log(err);});
}