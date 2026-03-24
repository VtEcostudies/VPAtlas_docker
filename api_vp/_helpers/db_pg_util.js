/*
  https://node-postgres.com/
*/
const db = require('_helpers/db_postgres');
const query = db.query;

module.exports = {
  getColumns: (tableName, columns) => getColumns(tableName, columns),
  whereClause: (params, columns, clause) => whereClause(params, columns, clause),
  parseColumns: (body, idx, cValues, staticColumns) => parseColumns(body, idx, cValues, staticColumns)
}

/*
    Load just columns from the db and return array of columns.

    CORRECTION: it DOES NOT WORK to return an array.

    HOWEVER: it does work to pass and array as an argument to
    this function, by reference, and update that array here.

    OPTIONS: (1) Pass an empty array to be filled here, or
    (2) Use the object returned from here.

 */
async function getColumns(tableName, columns=[], retcols=[]) {

    const text = `select * from ${tableName} limit 0;`;

    return new Promise(async (resolve, reject) => {
      await query(text)
        .then(res => {
            res.fields.forEach(fld => {
                columns.push(String(fld.name)); //cumulative list of all tables
                retcols.push(String(fld.name)); //just the current table's columns for return
            });
            //console.log(`${tableName} columns:`, columns);
            resolve({tableName:tableName, tableColumns:retcols}); //return just the current table's columns
        })
        .catch(err => {
            reject(err);
        });
    });
}

/*
    Parse route query params into valid pg-Postgres where clause parameter list.
    This returns an object having where-clause text and values, which looks like
    the following:

    text: WHERE "column1" = $1 AND "column2" LIKE $2 AND ...

    values: []

    We created a home-grown syntax for sending a logical comparison operator to
    this API using the pipe ("|") when an operator other than "=" is desired. An
    example is:

    GET http://vpatlas.org/pools/mapped/page?mappedPoolId|LIKE='AAA' (roughly)

    TO-DO: find a way to enable the IN operator. As currently implemented, IN
    can't work because node-postgres automatically applies single quotes around
    parameter values. If we receive an http request like

    GET http://vpatlas.org/pools/mapped/page?mappedPoolStatus|IN=(Potential,Probable)

    Parsing here leads pg-postgres to send the values like

    ['(Potential,Probable)', ...]

    ...when what's needed is

    [('Potential','Probable'), ...]

    Arguments:
       params: a valid express query param object
       staticColumns: array of valid columns in the table

    NOTE: Through mistakes made in trying to send operators using the field 'logical',
    discovered a way to send IN params: send the same field N times. The express parser
    puts the N different values for a repeated argument into a sub-array of values for us.

    Another problem: the NULL value is only processed with 'IS' OR 'IS NOT' operator.
    Perhaps we can look for NULL values and alter the operator when found.
 */
function whereClause(params={}, staticColumns=[], clause='WHERE') {
    var where = '';
    var values = [];
    var idx = 1;
    //console.log('dg_pg_util::whereClause | params', params);
    if (Object.keys(params).length) {
        prev_log_opr = false; //keep track of logical operator in the previous argument in a multi-arg list
        for (var key in params) {
            console.log('key', key, 'params[key]', params[key]);
            var col = key.split("|")[0];
            var opr = key.split("|")[1];
            opr = opr ? opr : '='; //default operator is '='
            opr = opr==='!' ? '!=' : opr; //turn '!' operator into its intended operator: '!='
            if (!Array.isArray(params[key]) && params[key].toLowerCase()=='null') { //null value requires special operators
              opr = opr==='!=' ? ' IS NOT NULL' : ' IS NULL';
            }
            console.log('db_pg_util::whereClause | column:', col, '| operator:', opr);
            if (staticColumns.includes(col) || 'logical'===col.substring(0,7)) {
                if (where == '') where = clause; //'WHERE', or 'AND' depending on caller
                if ('logical' != col.substring(0,7)) {
                  if (Array.isArray(params[key])) { //search token has multiple values, passed as array
                    if ('=' == opr) {opr = 'IN'}; //an array of values must use 'IN' operator, unless API sent one, eg. 'NOT IN'
                    params[key].forEach((item, index) => {
                      if (item.toLowerCase()=='null') {}//values.push(null);}
                      else {values.push(item);}
                    });
                  } else { //not an array of values
                    if (params[key].toLowerCase()=='null') {}//values.push(null);}
                    else {values.push(params[key]);}
                  }
                }
                if (idx > 1 && 'logical' != col.substring(0,7) && !prev_log_opr) where += ` AND `; //if multiple args and no logical, must add AND, the default logical operator
                prev_log_opr = false;
                if (col.includes(`."`)) {
                  where += ` ${col} ${opr} $${idx++}`; //columns with table spec have double-quotes already
                } else if ('logical'===col.substring(0,7)) {
                  where += ` ${params[key]} `; //append logical operator (AND, OR)
                  prev_log_opr = params[key]; //flag a logical operator for the next loop-iteration
                } else if (Array.isArray(params[key])) { //break array of values into list like '($2,$3,...)'
                    where += ` "${col}" ${opr} (`; //() around array of args
                    params[key].forEach((item, index) => {
                      where += index>0 ? ',' : '';
                      where += `$${idx++}`;
                    });
                    where += `)`;
                } else {
                  if (params[key].toLowerCase()=='null') {where += ` "${col}" ${opr}`;}
                  else {where += ` "${col}" ${opr} $${idx++}`;} //add double-quotes to plain columns
                }
            }
        }
        console.log('where clause:', where, 'values:', values);
    }
    return { 'text': where, 'values': values };
}

/*
    Parse {column:value, ...} pairs from incoming http req.body object into structures used by postgres

    This wlgcs for postgres INSERT and UPDATE queries by allowing for injection of a starting index and
    pre-populated array of values.

    Arguments:

    body: an express req.body object
    idx: positive integer starting value for the returned 'numbered' value list
    cValue: empty or pre-populated array of query values
    staticColumns: array of valid columns in the table

    returns object having:
    {
        'named': "username,email,zipcode,..."
        'numbered': $1,$2,$3,...
        'values': ['jdoh','jdoh@dohsynth.com','91837',...]
    }
 */
function parseColumns(body={}, idx=1, cValues=[], staticColumns=[]) {
    var cNames = ''; // "username,email,zipcode,..."
    var cNumbr = ''; // "$1,$2,$3,..."

    //console.log(`db_pg_util.parseColumns`, body, idx, cValues, staticColumns);

    if (Object.keys(body).length) {
        for (var key in body) {
            if (staticColumns.includes(key)) { //test for key (db column) in staticColumns, a file-scope array of db columns generated at server startup
                cValues.push(body[key]);
                cNames += `"${key}",`;
                cNumbr += `$${idx++},`;
            }
        }
        //remove leading and trailing commas
        cNames = cNames.replace(/(^,)|(,$)/g, "");
        cNumbr = cNumbr.replace(/(^,)|(,$)/g, "");
    }

    return { 'named': cNames, 'numbered': cNumbr, 'values': cValues };
}
