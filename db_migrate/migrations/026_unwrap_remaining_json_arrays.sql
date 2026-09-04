-- =============================================================================
-- 026_unwrap_remaining_json_arrays.sql
-- =============================================================================
-- Unwraps any controlled-vocabulary value still stored as a JSON-array-shaped
-- string, regardless of whether the value inside is a recognised vocabulary
-- term.
--
-- WHY THIS WAS MISSED
--   Migration 023's cleanup is generated, and the generator only emitted an
--   UPDATE when the normalised result landed on a canonical value -- a
--   deliberate rule, so an unanticipated answer is preserved for a human rather
--   than guessed at. But it conflated two separate things: resolving a value to
--   a vocabulary (a judgement) and unwrapping a JSON array (a format fix).
--
--   Production carries one visitPoolType stored as '["Artificial"]'. "Artificial"
--   is not a pool type anyone has decided on, so 023 left the whole value alone
--   -- wrapper included. The wrapper is a storage defect either way and should
--   never have waited on that decision.
--
--   _schema/build_normalize_sql.js now emits this pass unconditionally, so the
--   class does not recur.
--
-- NOTE
--   The published GeoJSON, shapefile and OGC outputs were already correct: the
--   canonical views unwrap array-shaped strings on the way out. This fixes the
--   value at rest, which is what _schema/schema.test.js checks.
-- =============================================================================

UPDATE vpvisit SET "visitPoolType" = btrim(regexp_replace("visitPoolType", '[\[\]"]', '', 'g'))
  WHERE "visitPoolType" ~ '^\s*\[';

UPDATE vpvisit SET "visitSubstrate" = btrim(regexp_replace("visitSubstrate", '[\[\]"]', '', 'g'))
  WHERE "visitSubstrate" ~ '^\s*\[';
