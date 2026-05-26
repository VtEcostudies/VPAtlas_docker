/*
  scrub.js — strip private values out of API responses that are reachable
  without authentication.

  The four public GeoJSON endpoints (mapped, visit, survey, review under
  /pools/...) `SELECT vpmapped.*` and friends, which pulls in landowner /
  surveyor emails (mappedLandownerEmail, surveyUserEmail, the
  visitLandowner JSONB's visitLandownerEmail key, etc.) and any user-name
  column whose value happens to be an email (some legacy users have
  email-as-username). Any one of those leaks a third-party email to an
  unauthenticated caller; that is what these helpers exist to prevent.

  Design choice: scrub by VALUE, not by name. A regex sweep catches
  email-shaped values regardless of which column they ride in on — so a
  future schema change that adds another *Email column, or a username
  column that's been populated with email addresses, doesn't need a code
  change to be protected. The cost is one O(n) walk over the response
  object before it's serialized, which is negligible next to the SQL.

  Email matching is intentionally strict (full-string match, no spaces,
  requires a TLD of ≥2 chars). Free-text fields like notes that mention
  "contact me at foo@bar.com" are NOT scrubbed; the host string would
  fail the full-string match. If we ever need to scrub embedded emails in
  free-text we add a separate sweep.
*/

// Strict full-string match — used to identify a string value that IS an
// email (in which case we drop the whole property). Won't false-fire on
// phone numbers / URLs.
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

// Global substring match — used to redact emails embedded in longer text
// (mappedComments / visitLocationComments / reviewQANotes etc. where a
// data-entry person wrote "data entered for Jane Doe, jane@doe.org").
// Slightly broader than EMAIL_RE because it has to match inside arbitrary
// surrounding punctuation.
const EMBEDDED_EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

const REDACTION = '[email redacted]';

function looksLikeEmail(s) {
    return typeof s === 'string' && EMAIL_RE.test(s.trim());
}

function redactEmbeddedEmails(s) {
    return typeof s === 'string' ? s.replace(EMBEDDED_EMAIL_RE, REDACTION) : s;
}

// Mutates `obj` in place. Two passes per string value:
//   1. If the WHOLE value is an email, drop the property entirely. The
//      reader doesn't get a redaction marker — they don't see the field
//      at all (handles mappedLandownerEmail, surveyUserEmail, alias[]
//      elements, the visitLandowner JSONB's visitLandownerEmail key, and
//      any user-name column whose value happens to be an email).
//   2. Otherwise, if the value CONTAINS an email substring, replace each
//      occurrence with "[email redacted]" so notes-style fields stay
//      readable but emit nothing exploitable.
// Recurses into nested objects and arrays.
function scrubEmails(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
        // In-place compaction: drop email-string elements, recurse into
        // non-email object/array elements, redact embedded emails inside
        // any remaining string elements.
        let w = 0;
        for (let r = 0; r < obj.length; r++) {
            const v = obj[r];
            if (looksLikeEmail(v)) continue;
            if (v && typeof v === 'object') scrubEmails(v);
            else if (typeof v === 'string') obj[w] = redactEmbeddedEmails(v);
            else obj[w] = v;
            w++;
        }
        obj.length = w;
        return obj;
    }
    if (typeof obj !== 'object') return obj;
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (looksLikeEmail(v)) {
            delete obj[k];
        } else if (v && typeof v === 'object') {
            scrubEmails(v);
        } else if (typeof v === 'string') {
            const redacted = redactEmbeddedEmails(v);
            if (redacted !== v) obj[k] = redacted;
        }
    }
    return obj;
}

module.exports = { scrubEmails, looksLikeEmail, redactEmbeddedEmails };
