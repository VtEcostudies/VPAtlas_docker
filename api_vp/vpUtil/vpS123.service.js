const fetch = require('node-fetch')
const apiUrl = 'https://services1.arcgis.com/d3OaJoSAh2eh6OA9/ArcGIS/rest/services';

module.exports = {
    getData,
    getAttachments,
    getDirectAttachment, //query attachments directly attached to Surveys, ie. attachments to featureId==0
    getRepeatAttachments //query attachments to repeatTables
  };

/*
https://services1.arcgis.com/d3OaJoSAh2eh6OA9/ArcGIS/rest/services/
service_fae86d23c46e403aa0dae67596be6073
/FeatureServer/
0/ <-featureId
1 <-objectId
?f=pjson
*/
function getData(qry) {
  console.log('vpS123.service::getData | query', qry);
  var srvId = qry.serviceId?qry.serviceId:''; //test: 'service_e4f2a9746905471a9bb0d7a2d3d2c2a1'; //VPMonDataSheet
  var fetId = qry.featureId?qry.featureId:0; //S123 parent services, for getting data, have featureId==0 (we hope!)
  var objId = qry.objectId?qry.objectId:0;
  var args = 'f=pjson';

  return new Promise((resolve, reject) => {
    if (!srvId) reject({message:'Please provide an S123 serviceId'});
    if (!objId) reject({message:'Please provide an S123 objectId'});
    const url = `${apiUrl}/${srvId}/FeatureServer/${fetId}/${objId}?${args}`;
    console.log('vpS123.service::getData | NOTICE', url);
    fetch(url)
      .then(res => res.json()) //this step is necessary when using fetch. without it, result is garbage.
      .then(json => {
        if (json.error) {
          json.error.hint = json.error.message;
          json.error.objectId = objId;
          json.error.dataUrl = url;
          json.error.detail = json.error.details;
          console.log('vpS123.service::getData | ERROR', json);
          reject(json.error);
        } else {
          json.feature.attributes.dataUrl = url;
          console.log('vpS123.service::getData | SUCCESS', json.feature.attributes);
          resolve(json.feature.attributes);
        }
      })
      .catch(err => {
        console.log('vpS123.service::getData | ERROR', err.message);
        reject(err);
      })
  });
}
/*
Get attachments made directly to a survey feature's object.

https://services1.arcgis.com/d3OaJoSAh2eh6OA9/ArcGIS/rest/services/
service_fae86d23c46e403aa0dae67596be6073/
FeatureServer/[1,2,3,4,5,6,7,{8}]/
queryAttachments
?globalIds=8686c8e5-546d-486c-a85f-836554992a64
&returnUrl=true
&f=pjson

Finding attachments to repeatTables using globalIds DOES NOT WORK.

When an attachment is to a feature itself, use this function. You can use
globalId or objectId to query attachments.
*/
function getDirectAttachment (qry={}) {
  var srvId = qry.serviceId?qry.serviceId:''; //test: "service_e4f2a9746905471a9bb0d7a2d3d2c2a1"; //VPMonDataSheet
  var fetId = qry.featureId?qry.featureId:''; //S123 attachments can be on featureLayers with values > 0
  var objId = qry.objectId?qry.objectId:'';
  var gblId = qry.globalId?qry.globalId:'';//test: "8686c8e5-546d-486c-a85f-836554992a64";
  var args = '&returnUrl=true&f=pjson';

  return new Promise((resolve, reject) => {
    if (!srvId) reject({message:'Please provide an S123 serviceId'});
    if (!fetId) reject({message:'Please provide an S123 featureId'});
    if (!objId && !gblId) reject({message:'Please provide an S123 objectId or globalId'});
    const url = `${apiUrl}/${srvId}/FeatureServer/${fetId}/queryAttachments?objectIds=${objId}&globalIds=${gblId}&${args}`;
    console.log('vpS123.service::getDirectAttachment | URL', url);
    fetch(url)
      .then(res => res.json()) //this step is necessary when using fetch. without it, result is garbage.
      .then(json => {
        if (json.error) { //successful http query, incorrect query structure (eg. req attach from featureLayer==0 for service having none)
          json.error.hint = url;
          json.error.detail = json.error.details;
          console.log('vpS123.service::getDirectAttachment | ERROR', json);
          reject(json.error);
        } else {
          if (json.attachmentGroups.length) { //there are attachments
            console.log('vpS123.service::getDirectAttachment | SUCCESS', json.attachmentGroups);
            resolve(json.attachmentGroups);
          } else {
            console.log('vpS123.service::getDirectAttachment | NOT FOUND', json.attachmentGroups);
            reject({message:`No attachments found for ${gblId?"globalId:"+gblId:"objectId:"+objId}`, hint:url});
          }
        }
      })
      .catch(err => {
        console.log('vpS123.service::getDirectAttachment | ERROR', err.message);
        reject(err);
      })
  });
}

/*
Get repeatTable objectIds for a parentObjectId and a featureId using 'queryRelatedRecords'.

https://services1.arcgis.com/d3OaJoSAh2eh6OA9/ArcGIS/rest/services/service_71386df693ec4db8868d7a7c64c50761/FeatureServer/0
/queryRelatedRecords
?objectIds=1 <--the parent survey objectId
&relationshipId=8 <--the repeatTable featureId
&f=pjson

Sample result for parentObjectid==3 having 2 attachment objects:
{
  "fields" : [],
  "relatedRecordGroups" : [
    {
      "objectId" : 3,
      "relatedRecords" : [
        {"attributes" : {"objectid" : 4}}
        {"attributes" : {"objectid" : 5}}
      ]
    }
  ]
}
*/
function getRepeatAttachments (qry={}) {
  var srvId = qry.serviceId?qry.serviceId:''; //test: "service_e4f2a9746905471a9bb0d7a2d3d2c2a1"; //VPMonDataSheet
  var fetId = qry.featureId?qry.featureId:''; //S123 attachments can be on featureLayers with values > 0
  var objId = qry.objectId?qry.objectId:'';
  var args = 'f=pjson';

  return new Promise((resolve, reject) => {
    if (!srvId) reject({message:'Please provide an S123 serviceId'});
    if (!fetId) reject({message:'Please provide an S123 featureId'});
    if (!objId) reject({message:'Please provide an S123 objectId'});
    const url = `${apiUrl}/${srvId}/FeatureServer/0/queryRelatedRecords?objectIds=${objId}&relationshipId=${fetId}&${args}`;
    console.log('vpS123.service::getRepeatAttachments | URL', url);
    fetch(url)
      .then(res => res.json()) //this step is necessary when using fetch. without it, result is garbage.
      .then(async json => {
        if (json.error) { //successful http query, incorrect query structure (eg. req attach from featureLayer==0 for service having none)
          json.error.hint = url;
          json.error.detail = json.error.details;
          console.log(`vpS123.service::getRepeatAttachments | ERROR | parentObjectId:${objId} | featureId:${fetId}`, json);
          reject(json.error);
        } else {
          if (json.relatedRecordGroups && json.relatedRecordGroups.length) { //there are attachments
            const pObjId = json.relatedRecordGroups[0].objectId;
            const relRec = json.relatedRecordGroups[0].relatedRecords;
            var arrIds = []; //array of related objectIds
            for (i=0; i<relRec.length; i++) {
              arrIds.push(relRec[i].attributes.objectid);
            }
            console.log(`vpS123.service::getRepeatAttachments | SUCCESS | parentObjectId:${pObjId} | featureId:${fetId} | objectIds:`, arrIds);
            var arrInfo = [];
            for (let i=0; i<arrIds.length; i++) { //with await, here, the for entire for loop blocks until it's done
              await getFeatureAttachmentInfo(srvId, fetId, arrIds[i])
                .then(infos => {
                  arrInfo = arrInfo.concat(infos); //we expect an array of attachment infos
                })
                .catch(err => {console.log(err);})
            } //...which allows the resolve, below, to return an array of attachmentInfos
            resolve({parentObjectId:pObjId,featureId:fetId,objectIds:arrIds,attachmentInfos:arrInfo});
          } else {
            console.log('vpS123.service::getRepeatAttachments | NOT FOUND', json.relatedRecordGroups);
            reject({message:`No related records found for parentObjectId:${objId} | featureId:${fetId}`, hint:url});
          }
        }
      })
      .catch(err => {
        console.log(`vpS123.service::getRepeatAttachments | try-catch ERROR | parentObjectId:${objId} | featureId:${fetId}`, err.message);
        reject(err);
      })
  });
}

function getAttachments(req) {
  return getRepeatAttachments(req);
}

/*
{
  "attachmentInfos" : [
    {
      "id" : 1,
      "globalId" : "cca5310b-2155-42e9-8e10-3d871a4b9702",
      "parentGlobalId" : "17cc4b55-612a-48da-8dc3-7394d5ca165b",
      "name" : "055DF978-8366-4AD1-9662-DCE74D5BC2CE.jpeg",
      "contentType" : "image/jpeg",
      "size" : 855368,
      "keywords" : "surveyPhotoSpecies.POOL",
      "exifInfo" : null
    }
  ]
}
*/
function getFeatureAttachmentInfo(srvId, fetId, objId) {
  return new Promise((resolve, reject) => {
    const url = `${apiUrl}/${srvId}/FeatureServer/${fetId}/${objId}/attachments?f=pjson`;
    console.log('vpS123.service::getFeatureAttachmentInfo | URL', url);
    fetch(url)
      .then(res => res.json()) //this step is necessary when using fetch. without it, result is garbage.
      .then(json => {
        if (json.error) { //successful http query, incorrect query structure (eg. req attach from featureLayer==0 for service having none)
          json.error.hint = url;
          json.error.detail = json.error.details;
          console.log('vpS123.service::getFeatureAttachmentInfo | ERROR', json);
          reject(json.error);
        } else {
          var arr = json.attachmentInfos;
          for (i=0; i<arr.length; i++) { //iterate over infos
            arr[i].url = `${apiUrl}/${srvId}/FeatureServer/${fetId}/${objId}/attachments/${arr[i].id}`;
            arr[i].featureServerId = fetId;
          }
          console.log(`vpS123.service::getFeatureAttachmentInfo | FOUND ${arr.length} attachmentInfos`, arr);
          resolve(arr);
        }
      })
      .catch(err => {
        console.log(`vpS123.service::getFeatureAttachmentInfo | try-catch ERROR`, err.message);
        reject(err);
      })
  });
}
