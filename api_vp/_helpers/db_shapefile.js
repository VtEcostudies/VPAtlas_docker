const env = require('_helpers/env').env;
const moment =  require('moment');

module.exports = {
    shapeFile,
    procExec,
    tarZip
}

async function shapeFile(qry, usr='unknown', fyl='shapefile', dir='shapefile', ext='tar.gz') {
    console.log('db_shapefile::shapeFile | dir/file params:', usr, fyl, dir, ext)
    //console.log('QUERY BEFORE CLEANUP', JSON.stringify(qry));
    qry = qry.replace(/\n/g, ' '); //replace LF with spaces for pgsql2shp
    qry = qry.replace(/\r/g, ''); //remove CR for pgsql2shp
    qry = qry.replace(/["]/g,`\\"`); //escape double-quotes for pgsql2shp
    //console.log('db_shapefile::shapeFile pgsql2shp QUERY AFTER CLEANUP', qry);
    //console.log('QUERY AFTER CLEANUP', JSON.stringify(qry));
    let out = `${fyl}_${usr}` + moment.utc(Date.now()).format("_YYYY-MM-DD_hh-mm-ss");
    console.log('shapeFile | filename:', out);
    let cmd = `rm -f ${dir}/${fyl}_${usr}* && pgsql2shp -f ${dir}/${out} -h ${env.db_env.host} -u ${env.db_env.user} -P ${env.db_env.password} ${env.db_env.database} "${qry}"`;
    console.log('db_shapefile::shapeFile | cmd', cmd);
    return await new Promise((resolve, reject) => {
      procExec(cmd).then(async res => {
        tarZip(dir, out, ext).then(async res => {
          //console.log(`db_shapefile::shapeFile=>tarZip | success`, `${dir}/${out}`);
          resolve({all:`${dir}/${out}.${ext}`, filename:`${out}.${ext}`, subdir:dir});
        })
        .catch(async err => {
          console.log(`db_shapefile::shapeFile=>tarZip | error`, err);
          reject(err);
        })
      })
      .catch(async err => {
        console.log(`db_shapefile::shapeFile=>procExec | error`, err);
        reject(err);
      })
    })
  }

async function tarZip(dir='shapefile', fyl='vpmapped', ext='tar.gz') {
    let cmd = `cd ${dir} && tar -czf ${fyl}.${ext} ${fyl}.*`;
    console.log('db_shapefile::tarZip | cmd', cmd);
    return await procExec(cmd);
  }

async function procExec(cmd) {
    var cp = require('child_process');
    var ch = cp.exec(cmd);
    return await new Promise((resolve, reject) => {
      let info = {}; let iter = 0;
      let errs = {}; let erri = 0;
      ch.on('close', () => {
        //console.log('db_shapefile::procExec=>close | cmd:', cmd, '| info:', info, '| error:', errs);
        if (!erri) {resolve({'info': info, 'error': errs});}
        else {
          /*
          tar: Error exit delayed from previous errors.
          What this means is that tar hit errors which weren't bad enough for tar to fail immediately 
          on hitting the error. tar kept going. Then when tar ends it says that it had errors but 
          managed to run to completion.
          */
          if (errs[`${erri-1}`] == 'tar: Error exit delayed from previous errors.\r\n') {
            resolve({'info': info, 'error': errs});
          } else {
            reject({'info': info, 'error': errs});
          }
        }
      })
      ch.stdout.on('data', (data) => {
        //console.log('db_shapefile::procExec=>stdOUT=>data:', data);
        info[iter++] = data;
      });
      ch.stderr.on('data', derr => {
        console.log('db_shapefile::procExec=>stdERR=>data:', derr)
        errs[erri++] = derr;
      })
      ch.on('error', err => {
        console.log('db_shapefile::procExec=>error | child-process error:', err)
        reject({'info': info, 'error': err});
      })
    })
  }
  