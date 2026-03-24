module.exports = errorHandler;

function errorHandler(err, req, res, next) {
    var ret;
try {
    //This doesn't work. Need to find a way to determine when res.header has been set...
    //console.log('errorHandler | http status:', res.status);
    console.log('errorHandler | http code:', res.code);
    console.log('errorHandler | err.code:', err.code);
    console.log('errorHandler | error.name:', err.name);
    console.log('errorHandler | error.message:', err.message);

    /*
    NOTE: setting res.status here causes error - can't set headers already sent to client.
    https://stackoverflow.com/questions/7042340/error-cant-set-headers-after-they-are-sent-to-the-client
    */

    if (typeof (err) === 'string') {
        // custom application console.error();
        console.log('errorHandler | typeof===string | error:', err);
        ret = { message: err };
        next(res.status(400).json(ret));
    } else if (typeof (err) === 'object') {
      console.log('errorHandler | typeof===object | error.message:', err.message);
      if (err.name === 'UnauthorizedError') { //jwt authentication error
        next(res.status(401).json(err));
      } else {
        //ret = { message: err.message }; //hmm. not sure why I did this. UX display issues?
        next(res.status(400).json(err));
      }
    } else {
      console.log('errorHandler | Other Error | error:', err)
      ret = {
        name: err.name,
        code: err.code,
        severity: err.severity,
        message: err.message,
        hint: err.hint,
        detail: err.detail,
        table: err.table,
        constraint: err.constraint,
        column: err.column,
        dataType: err.dataType,
        where: err.where,
        file: err.file,
        line: err.line,
        routine: err.routine
      };
      //console.log(`errorHandler::errorHandler()`);
      //console.dir(ret);
      //console.dir(err);
      // default to 500 server error
      //NOTE: this does not throw error. we assume that this is the same http error code as already set elsewhere.
      next(res.status(500).json(ret));
    }
  } catch(tcErr) {
    console.log('errorHandler try-catch error:', tcErr);
    next(res.status(500).json(tcErr));
  }
}
