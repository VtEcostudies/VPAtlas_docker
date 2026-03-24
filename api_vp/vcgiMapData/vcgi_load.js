/*
  Project: VPAtlas

  File: vcgi_load.js

  Notes:

  A node command-line utiility to put geoJSON layer files into PostGIS db tables.

  New for VPAtlas with VPMon, like parcelmap layers, load geoJSON boundaries for
  state, county, town, and biophysical regions, into postGIS and serve via API
  to UI.

  Specifics:

  Download geoJSON file for eg. towns with:

    https://opendata.arcgis.com/datasets/0e4a5d2d58ac40bf87cd8aa950138ae8_39.geojson

  Insert geoJSON data into PostGIS for eg. counties with:

    'node vcgi_load county'

  To-Do:

  - Consder adding geoJSON download to this processing.
  - This doesn't work for towns yet. Use 'vcgi_town_load.js' instead.
    Convert towns to generic model in the future.

*/
const db = require('../_helpers/db_postgres');
const query = db.query;
const https = require('https'); //https://nodejs.org/api/http.html
const fs = require('fs');
var geoFile = null;
var geoTabl = null;
var nameTbl = null;
var nameCol = null;
var idColum = null;
var propFld = null;
const update = 1; //flag whether to update parcel data in the db

/*
  Command-Line Arguments Processing
  - Space-delimited args of the form action=value
  - example: 'node vcgi_load town'
*/
for (var i=2; i<process.argv.length; i++) {
  var all = process.argv[i].split('='); //the ith command-line argument
  var act = all[0]; //action, left of action=argument
  var arg = all[1]; //argument, right of action=argument
  console.log(`command-line argument ${i}`, all);
	switch (act) {
/*
		case "town":
      geoFile = 'vcgi_town_polygons.geojson'; //'Polygon_VT_Town.geojson';
      geoTabl = 'geo_town';
      propFld = 'TOWNNAME';
      nameTbl = 'vptown';
      nameCol = 'townName';
      idColum = 'townId';
			break;
*/
    case "county":
      geoFile = 'vcgi_county_polygons.geojson';
      geoTabl = 'geo_county';
      propFld = 'CNTYNAME';
      nameTbl = 'vpcounty';
      nameCol = 'countyName';
      idColum = 'countyId';
			break;
    case "biophysical":
      geoFile = 'vce_biophysical_polygons.geojson';
      geoTabl = 'geo_biophysical';
      propFld = 'name';
      nameTbl = 'vpbiophysical';
      nameCol = 'biophysicalName';
      idColum = 'biophysicalId';
			break;
    case "state":
      geoFile = 'vcgi_state_polygon.geojson';
      geoTabl = 'geo_state';
      propFld = 'name';
      nameTbl = 'vpstate'; //null
      idColum = 'stateId'; //id
			break;
    default:
      console.log('Invalid command-line argument. To load all for a type, use node vcgi_load.js town | county | biophysical | state.')
      break;
    }
}

if (geoFile) {loadItem(geoFile, geoTabl, propFld, nameTbl, nameCol, idColum);}
else {console.log(`No item specified. Please request one of: town, county, biophysical, or state.`);}

function loadItem(geoFile, geoTabl, propFld, nameTbl, nameCol, idColum) {
  console.log(`Reading file ${geoFile} into ${geoTabl} using geoJSON property '${propFld}' in ${nameTbl}`);

  // read item geoJSON file
  fs.readFile(`./other_geoJSON/${geoFile}`, 'utf-8', async (err, data) => {
      if (err) {
          throw err;
      }

      // parse geoJSON object read from file
      const item = JSON.parse(data.toString());

      //console.dir(item);

      console.log(`Readfile results check | Name:${item.name} | CRS:${item.crs} item.crs| Type:${item.type} | features:`, item.features.length);

      for (i=0; i<item.features.length; i++) {
          var feat = item.features[i];
          var name = feat.properties[propFld]; //here's the trick...
          await getItem(nameTbl, nameCol, name)
            .then(item => {
                console.log('getItem result:', item);
                var geoData = {
                  "type":feat.geometry.type,
                  "coordinates":feat.geometry.coordinates
                };
                if (item.crs) {
                  geoData.crs = item.crs;
                }
                insertGeoItem(geoTabl, item[idColum], geoData)
                  .then(res => {
                    //Success. Nothing to say.
                  })
                  .catch(err => {
                    fs.writeFile(`./other_geoJSON/error_insertGeoItem_${name}.txt`, JSON.stringify(err), (err) => {
                      console.log('ERROR | fs.writeFile |', err);
                    });
                  });
            })
            .catch(err => {
              console.log(`ERROR | getItem | rowCount:${err.rows?err.rows.length:0} |`, err);
              fs.writeFile(`./other_geoJSON/error_getItem_${name}.txt`, JSON.stringify(err), (err) => {
                console.log('ERROR | fs.writeFile |', err);
              });
            });
      }
  });
}

/*
  Get array of items (well, a node-pg result set).
*/
function getItems(nameTbl, nameCol, nameVal='') {
    var where = '';
    var value = [];
    if (nameVal) {where = `where upper("${nameCol}") = upper($1)`; value = [nameVal];}
    const text = `select * from ${nameTbl} ${where};`;
    return query(text, value);
}

/*
  Get one item by name.
  Returns single object for item, or error.
*/
function getItem(nameTbl, nameCol, nameVal='') {
  return new Promise((resolve, reject) => {
    if (nameTbl == null) {
      resolve({id:1, name:"Vermont"});
    } else {
      getItems(nameTbl, nameCol, nameVal)
        .then(res => {
          if (res.rows && 1 == res.rows.length) {resolve(res.rows[0]);}
          else {reject({error:true, message:"Wrong number of rows.", rows:res.rows});}
        })
        .catch(err => {
          reject(err);
        });
    } //end else
  })
}

/*
  Insert Polygon Geometry for one type.
  geoTabl is the table name (geo_town, geo_county, geo_biophysical, geo_state)
  id is the foregin key value
  data is a geoJSON feature
*/
function insertGeoItem(geoTabl, id, geoData) {

  //console.log('insertGeoItem', geoData);
  //console.log(`insertGeoItem into ${geoTabl} for ${id} with ${geoData.type}`);

  var sql_insert = `
  insert into ${geoTabl} ("geoId","geoPolygon")
  VALUES ($1, ST_GeomFromGeoJSON($2))`;

  console.log('insertGeoItem', geoTabl, sql_insert, [id]);

  return new Promise((resolve, reject) => {
    query(sql_insert, [id, geoData])
      .then(res => {
        resolve(res);
      })
      .catch(err => {
        console.log('ERROR | insertGeoItem |', err.message);
        reject(err);
      })
  });
}
