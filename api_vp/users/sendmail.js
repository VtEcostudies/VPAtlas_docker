const nodemailer = require('nodemailer');
const config = require('../config');
const os = require("os");

// Build UI base URL from config
const uiFqdn = (config.ui.host === 'localhost')
  ? `${config.ui.protocol}://${config.ui.host}:${config.ui.port}`
  : `${config.ui.protocol}://${config.ui.host}`;

/*
  Loud startup warning when outbound mail can't possibly work.

  A missing EMAIL_PASSWORD is silent until the first user tries to register or
  reset — then nodemailer says `Missing credentials for "PLAIN"` from deep in
  the SMTP stack. That is exactly what happened in prod: a dangling .env
  symlink emptied EMAIL_PASSWORD and every registration/reset email failed for
  weeks with nothing in the startup log to hint at it.
*/
if (!config.vceEmail || !config.vcePassW) {
  console.warn('*'.repeat(78));
  console.warn('sendmail.js | OUTBOUND EMAIL IS DISABLED — credentials missing.');
  console.warn(`sendmail.js | APP_EMAIL=${config.vceEmail ? 'set' : 'MISSING'} EMAIL_PASSWORD=${config.vcePassW ? 'set' : 'MISSING'}`);
  console.warn('sendmail.js | Registration and password-reset emails WILL FAIL.');
  console.warn('sendmail.js | Fix: set APP_EMAIL / EMAIL_PASSWORD in the compose project .env and recreate api_vp.');
  console.warn('*'.repeat(78));
}

module.exports = {
    test: (userMail, interval) => reset(userMail, interval, 'test'), //use 'token' to pass 'interval'
    register: (userMail, token) => reset(userMail, token, 'registration'),
    reset: (userMail, token) => reset(userMail, token, 'reset'),
    new_email: (userMail, token) => reset(userMail, token, 'email')
};

/*
Send registration or reset email with token.
*/
function reset(userMail, token, type='registration') {

  // Fail before we reach the SMTP layer so callers get a diagnosable code
  // instead of nodemailer's `Missing credentials for "PLAIN"`.
  if (!config.vceEmail || !config.vcePassW) {
    const err = new Error('Outbound email is not configured on this server (APP_EMAIL / EMAIL_PASSWORD missing).');
    err.name = 'Mail Configuration Error';
    err.code = 'EMAILCONFIG';
    console.log('sendmail.js | refusing to send:', err.message);
    return Promise.reject(err);
  }

  var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.vceEmail,
      pass: config.vcePassW
    },
    from: config.vceEmail
  });

  var htm = `<a href=${uiFqdn}/explore/login.html?token=${token}>Confirm VPAtlas Registration</a>`;
  var sub = 'VPAtlas Registration';
  if (type == 'reset') {
    htm = `<a href=${uiFqdn}/explore/confirm_reset.html?token=${token}>Confirm VPAtlas Password Change</a>`;
    sub = 'VPAtlas Password Reset';
  }
  if (type == 'email') {
    htm = `<a href=${uiFqdn}/explore/confirm_email.html?token=${token}>Confirm VPAtlas Email Change</a>`;
    sub = 'VPAtlas Email Change';
  }
  if (type == 'test') { //use 'token' to pass 'interval'
    htm = `This is a test email sent from VPAtlas at ${os.hostname()} to verify it's able to send mail. 
    If you don't get the next email in ${token} seconds, you'll need to re-enable less secure apps
    in Google Workspace for the user vpatlas@vtecostudies.org.`;
    sub = 'VPAtlas Email Test';
  }

  var mailOptions = {
    from: config.vceEmail,
    to: userMail,
    subject: sub,
    html: htm
  };

  /*
  To make sendmail work, log-in to the sending gmail account and turn-on 'less secure app access':
  - https://myaccount.google.com/lesssecureapps
  */
  return new Promise(function(resolve, reject) {
      transporter.sendMail(mailOptions, function(err, info) {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        console.log('Email sent: ' + info.response);
        resolve(info);
      }
    });
  });

}
