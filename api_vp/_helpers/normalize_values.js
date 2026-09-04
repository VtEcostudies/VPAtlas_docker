/*
  normalize_values.js — one canonical vocabulary per controlled-value field, and
  the aliases that map onto it.

  WHY THIS EXISTS

  Several visit fields are controlled vocabularies in the UI but plain text in
  the database, and values reach them from three directions: the VPAtlas visit
  form, the Survey123 sync, and years of legacy imports. Nothing reconciled
  them, so the same answer is stored several ways -- "Leaf litter" 1074 times,
  "Leaflitter" 94 times, and once as the JSON-array-shaped string
  '["Leaf litter"]'.

  That is not cosmetic. The visit form ticks its checkboxes with an exact string
  match:

      document.querySelector(`.visitSubstrate[value="${s}"]`)

  so a visit recorded as "Leaflitter" opens with no substrate selected, and
  re-saving it silently drops the answer. Downstream it also breaks GIS
  symbology, definition queries and any group-by.

  ONE VOCABULARY, THREE USES

    1. Ingest -- the Survey123 sync normalises before writing, so new data
       cannot reintroduce a variant.
    2. Cleanup -- migration 023 rewrites the existing rows to the same
       canonical values.
    3. Assertion -- schema.test.js fails the build if a non-canonical value
       appears again.

  MATCHING IS DELIBERATELY FORGIVING
  Comparison folds case, whitespace, punctuation and JSON-array wrapping, so
  "Leaflitter", "leaf litter", "LEAF_LITTER" and '["Leaf litter"]' all resolve
  without needing to be enumerated. Explicit aliases cover only what fuzzing
  cannot reach -- genuinely different wordings such as "Prior knowledge of site"
  for "Prior Knowledge".

  UNRECOGNISED VALUES ARE LEFT ALONE, NOT DISCARDED. Silently dropping an answer
  nobody anticipated is worse than storing an odd one; the test surfaces it
  instead.
*/

/*
  Canonical vocabularies. These match the option values in
  survey/visit_create.html exactly -- that form's exact-match checkbox
  restoration is the reason any of this matters.
*/
const VOCABULARIES = {
    visitSubstrate:       ['Leaf litter', 'Mud', 'Sand/Gravel', 'Bedrock', 'Other'],
    visitPoolType:        ['Isolated Forest Depression', 'Isolated Non-Forest Depression',
                           'Floodplain Depression', 'Pool associated with larger wetland complex',
                           'Manmade', 'Other'],
    visitVernalPool:      ["Yes", "No", "Don't Know"],
    visitNavMethod:       ['GPS', 'Map', 'Map & Compass', 'Prior Knowledge', 'Other'],
    visitForestUpland:    ['Hardwood', 'Deciduous', 'Softwood', 'Coniferous', 'Mixed', 'Open/Field', 'Other'],
    visitForestCondition: ['Undisturbed', 'Recently Logged', 'Minor logging', 'Major logging', 'Old Growth', 'Other'],
    visitHydroPeriod:     ['Ephemeral', 'Dries annually', 'Dries every 5 years', 'Semi-permanent',
                           'Never dries', 'Permanent'],
    visitWaterLevelObs:   ['Full', 'More than 50%', 'Less than 50%', 'Dry'],
    visitCertainty:       ['Certain', 'Pretty Sure', 'Not Sure'],
    visitInletType:       ['No Inlet', 'Ephemeral Inlet', 'Permanent Inlet'],
    visitOutletType:      ['No Outlet', 'Ephemeral Outlet', 'Permanent Outlet'],
    visitFishSize:        ['Small', 'Medium', 'Large'],
    visitWoodFrogEggHow:  ['Counted', 'Estimated'],
    visitSpsEggHow:       ['Counted', 'Estimated'],
    visitJesaEggHow:      ['Counted', 'Estimated'],
    visitBssaEggHow:      ['Counted', 'Estimated'],
};

/*
  Wordings that fuzzy matching cannot reach on its own. Keys are compared after
  the same folding applied to incoming values.
*/
const ALIASES = {
    visitPoolType: {
        // Prod holds the shorter legacy wording.
        'associatedwithwetlandcomplex': 'Pool associated with larger wetland complex',
    },
    visitNavMethod: {
        'priorknowledgeofsite': 'Prior Knowledge',
        'mapandcompass': 'Map & Compass',
        'mapcompass': 'Map & Compass',
    },
    visitInletType:  { 'no': 'No Inlet',  'none': 'No Inlet',  'permanent': 'Permanent Inlet',  'ephemeral': 'Ephemeral Inlet',  'yes': 'Ephemeral Inlet' },
    visitOutletType: { 'no': 'No Outlet', 'none': 'No Outlet', 'permanent': 'Permanent Outlet', 'ephemeral': 'Ephemeral Outlet', 'yes': 'Ephemeral Outlet' },
    visitWoodFrogEggHow: { 'estimate': 'Estimated', 'count': 'Counted' },
    visitSpsEggHow:      { 'estimate': 'Estimated', 'count': 'Counted' },
    visitJesaEggHow:     { 'estimate': 'Estimated', 'count': 'Counted' },
    visitBssaEggHow:     { 'estimate': 'Estimated', 'count': 'Counted' },
};

/*
  EQUIVALENT VALUES -- distinct spellings that are deliberately NOT merged.

  visitForestUpland stores Deciduous (590 rows) and Coniferous (49) from the
  legacy vocabulary, while the current visit form offers Hardwood and Softwood.
  These are the same forest types under different names, but both spellings stay
  in the data: rewriting 639 rows to match today's form labels would destroy the
  distinction if the vocabulary changes again, and the older terms are what the
  original observers recorded.

  Instead the pairs are declared equivalent. The map reads STORED VALUE -> the
  form control that should be activated for it, so a visit recorded as
  "Deciduous" opens with Hardwood selected. Without this those 639 visits open
  with no forest type selected at all, and re-saving one silently drops the
  answer -- the same failure as "Leaflitter", seven times larger.

  The reverse direction matters just as much: when a form control is submitted
  and the record already held an equivalent value, the ORIGINAL is preserved
  rather than overwritten. Opening a Deciduous visit and saving it unchanged
  must not silently rewrite it to Hardwood.
*/
const EQUIVALENTS = {
    visitForestUpland: {
        'Deciduous':  'Hardwood',
        'Coniferous': 'Softwood',
    },
    /*
      Many-to-one, and deliberately lossy in one direction only. The form offers
      a single "Recently Logged" option while the data distinguishes Minor
      logging (526 rows) from Major logging (70). Both activate that one control,
      and preserveEquivalent keeps whichever was stored when the record is saved
      unchanged -- so the finer distinction survives every edit that does not
      actually change the answer.

      A NEW record chosen as "Recently Logged" stores exactly that, since the
      form cannot express which level was meant. That is the accepted trade:
      historical precision is kept, future precision is not invented.
    */
    visitForestCondition: {
        'Minor logging': 'Recently Logged',
        'Major logging': 'Recently Logged',
    },
};

// The form control to activate for a stored value.
function controlValueFor(field, stored) {
    const map = EQUIVALENTS[field];
    if (!map || stored === null || stored === undefined) return stored;
    return map[stored] !== undefined ? map[stored] : stored;
}

/*
  Resolve a submitted control value against what was already stored. Returns the
  original when the two are equivalent, so an unchanged edit does not rewrite the
  historical spelling.
*/
function preserveEquivalent(field, submitted, original) {
    if (!original || submitted === original) return submitted;
    return controlValueFor(field, original) === submitted ? original : submitted;
}

/*
  Fields backed by a database CHECK constraint, where an unrecognised value would
  make the whole row fail to insert. For these -- and only these -- a value the
  vocabulary does not cover becomes NULL rather than being preserved.

  It is the lesser evil in a narrow case. Everywhere else an odd value is kept so
  a human can decide, but visitFishSize is written by the Survey123 sync, and a
  rejected row there means a failed sync rather than one odd cell. The column is
  100% NULL today, so nothing existing is at stake.
*/
const STRICT_FIELDS = new Set(['visitFishSize']);

/*
  Multi-select fields. The stored value is a delimited LIST of vocabulary
  members, not a single one, so "Leaf litter, Bedrock" is a legitimate answer
  rather than an unrecognised variant. Survey123 sends these JSON-array-wrapped
  and with more than one member -- prod holds '["Leaf litter","Bedrock"]',
  '["Leaf litter","Mud"]' and '["Leaf litter","Sand/Gravel"]' -- so each member
  is normalised independently and the result rejoined.
*/
const MULTI_FIELDS = new Set(['visitSubstrate']);

// Split a stored multi-select value into its members.
function splitMembers(value) {
    return String(value).split(',').map(x => x.trim()).filter(Boolean);
}

/*
  Strip a JSON-array wrapper. Survey123 sends multi-select answers as
  '["Leaf litter"]' and occasionally with more than one member. A multi-member
  answer becomes a comma-delimited string rather than being truncated to its
  first element -- the same treatment reviewReasons gets, and for the same
  reason: neither a GeoJSON property nor a DBF column can hold an array.

  Worth being precise about the difference, since it caused confusion: a real
  JSON array in the payload (what reviewReasons was) breaks an ArcGIS feature
  layer outright, because there is no field type for it. A *string* that merely
  looks like an array does not break anything -- it is still a string. It just
  displays as literal ["Other"] and fails every filter and symbology rule that
  expects "Other".
*/
function unwrapJsonArray(value) {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    if (!t.startsWith('[')) return value;
    try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) {
            return parsed.filter(x => x !== null && x !== '').join(', ');
        }
    } catch (e) { /* not JSON after all; leave it be */ }
    return value;
}

// Fold case, whitespace and punctuation so near-misses collapse together.
function fold(s) {
    return String(s).toLowerCase().replace(/[\s_\-'".]/g, '').replace(/&/g, 'and');
}

/*
  Resolve one value against its field's vocabulary. Returns the canonical
  spelling, null for an empty value, or the original when nothing matches.
*/
function normalizeField(field, value) {
    if (value === null || value === undefined) return null;

    let v = unwrapJsonArray(value);
    if (typeof v !== 'string') return v;
    v = v.trim();
    if (v === '') return null;

    const vocab = VOCABULARIES[field];
    if (!vocab) return v;

    // Multi-select: normalise each member, drop empties, rejoin.
    if (MULTI_FIELDS.has(field)) {
        const members = splitMembers(v).map(m => resolveOne(field, vocab, m)).filter(Boolean);
        return members.length ? [...new Set(members)].join(', ') : null;
    }

    return resolveOne(field, vocab, v);
}

// Resolve a single member against a vocabulary.
function resolveOne(field, vocab, v) {
    const folded = fold(v);
    for (const canonical of vocab) {
        if (fold(canonical) === folded) return canonical;
    }
    const alias = (ALIASES[field] || {})[folded];
    if (alias) return alias;

    // Unrecognised. Preserved so a human can decide -- except where a CHECK
    // constraint would reject the whole row.
    return STRICT_FIELDS.has(field) ? null : v;
}

/*
  Is a stored value acceptable? For a multi-select that means every member is a
  vocabulary term. Used by the schema contract test to tell a legitimate
  multi-answer from an unrecognised variant.
*/
function isCanonical(field, value) {
    const vocab = VOCABULARIES[field];
    if (!vocab || value === null || value === undefined) return true;
    if (MULTI_FIELDS.has(field)) return splitMembers(value).every(m => vocab.includes(m));
    return vocab.includes(value);
}

/*
  visitLocatePool arrived as text and holds seven spellings of three states:
  Yes/1/true, No/0/false, and -1 or empty meaning "not recorded". Migration 023
  converts the column to a nullable boolean; this is the same mapping in JS, for
  the ingest path.
*/
function normalizeTristate(value) {
    if (value === null || value === undefined) return null;
    const v = String(value).trim().toLowerCase();
    if (v === '' || v === '-1' || v === 'null') return null;
    if (['1', 'true', 'yes', 't', 'y'].includes(v)) return true;
    if (['0', 'false', 'no', 'f', 'n'].includes(v)) return false;
    return null;
}

// Normalise every controlled field present on a visit-shaped object, in place.
function normalizeVisit(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    for (const field of Object.keys(VOCABULARIES)) {
        if (field in obj) obj[field] = normalizeField(field, obj[field]);
    }
    if ('visitLocatePool' in obj) obj.visitLocatePool = normalizeTristate(obj.visitLocatePool);
    return obj;
}

module.exports = {
    VOCABULARIES, ALIASES, STRICT_FIELDS,
    EQUIVALENTS, controlValueFor, preserveEquivalent,
    MULTI_FIELDS, isCanonical, splitMembers,
    normalizeField, normalizeTristate, normalizeVisit,
    unwrapJsonArray, fold,
};
