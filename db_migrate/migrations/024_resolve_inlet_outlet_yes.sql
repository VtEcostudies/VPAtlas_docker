-- =============================================================================
-- 024_resolve_inlet_outlet_yes.sql
-- =============================================================================
-- Resolves the two rows migration 023 deliberately left alone.
--
-- visitInletType and visitOutletType each held one row reading "Yes", from an
-- older form that asked WHETHER an inlet or outlet existed rather than what type
-- it was. 023 preserved them rather than guessing, and _schema/schema.test.js
-- reported them as a known exception awaiting a decision.
--
-- That decision is Ephemeral: an inlet or outlet recorded only as present, with
-- no permanence noted, is the ephemeral case. The matching alias is in
-- _helpers/normalize_values.js so the Survey123 ingest resolves it the same way,
-- and the known-exception entries have been removed from schema.test.js, which
-- will now fail if a "Yes" reappears.
-- =============================================================================

UPDATE vpvisit SET "visitInletType"  = 'Ephemeral Inlet'  WHERE "visitInletType"  = 'Yes';
UPDATE vpvisit SET "visitOutletType" = 'Ephemeral Outlet' WHERE "visitOutletType" = 'Yes';
