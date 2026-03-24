/*
  A place for db queries, etc. common to all db services.
*/

module.exports = {
    visitHasIndicator: visitHasIndicator,
    surveyHasIndicator: surveyHasIndicator
}

function visitHasIndicator() {
text = `
("visitWoodFrogAdults">0 OR
"visitWoodFrogLarvae">0 OR
"visitWoodFrogEgg">0 OR
"visitSpsAdults">0 OR
"visitSpsLarvae">0 OR
"visitSpsEgg">0 OR
"visitJesaAdults">0 OR
"visitJesaLarvae">0 OR
"visitJesaEgg">0 OR
"visitBssaAdults">0 OR
"visitBssaLarvae">0 OR
"visitBssaEgg">0 OR
"visitFairyShrimp">0 OR
"visitFingerNailClams">0)`
return text;
}

function surveyHasIndicator() {
  return `(
    COALESCE("surveyAmphibJson"->'1'->>'surveyAmphibEdgeWOFR', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'1'->>'surveyAmphibEdgeSPSA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'1'->>'surveyAmphibEdgeJESA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'1'->>'surveyAmphibEdgeBLSA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'1'->>'surveyAmphibInteriorWOFR', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'1'->>'surveyAmphibInteriorSPSA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'1'->>'surveyAmphibInteriorJESA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'1'->>'surveyAmphibInteriorBLSA', '0')::int > 0 OR
    
    COALESCE("surveyAmphibJson"->'2'->>'surveyAmphibEdgeWOFR', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'2'->>'surveyAmphibEdgeSPSA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'2'->>'surveyAmphibEdgeJESA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'2'->>'surveyAmphibEdgeBLSA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'2'->>'surveyAmphibInteriorWOFR', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'2'->>'surveyAmphibInteriorSPSA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'2'->>'surveyAmphibInteriorJESA', '0')::int > 0 OR
    COALESCE("surveyAmphibJson"->'2'->>'surveyAmphibInteriorBLSA', '0')::int > 0)`
  }
  
function visitIndicatorSum() {
text = `
((
"visitWoodFrogAdults"+
"visitWoodFrogLarvae"+
"visitWoodFrogEgg"+
"visitSpsAdults"+
"visitSpsLarvae"+
"visitSpsEgg"+
"visitJesaAdults"+
"visitJesaLarvae"+
"visitJesaEgg"+
"visitBssaAdults"+
"visitBssaLarvae"+
"visitBssaEgg"+
"visitFairyShrimp"+
"visitFingerNailClams"
)>0)`;
return text;
}
