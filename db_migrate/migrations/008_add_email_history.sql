-- 008_add_email_history.sql
-- Track historical emails for users + add deferred-confirm columns for the
-- email-change flow.
--
-- Prior behavior wrote the new email immediately on request, leaving accounts
-- bound to unverified addresses if the user never clicked the link. The new
-- columns let us hold the new email as "pending" until the user confirms via
-- a JWT-bearing link sent to that new address. On confirm we archive the
-- previous email to vpuser_email_history and promote pending -> email.

CREATE TABLE IF NOT EXISTS vpuser_email_history (
    id           SERIAL PRIMARY KEY,
    "userId"     INTEGER NOT NULL REFERENCES vpuser(id) ON DELETE CASCADE,
    email        TEXT    NOT NULL,
    "changedAt"  TIMESTAMP NOT NULL DEFAULT now(),
    "changedBy"  INTEGER REFERENCES vpuser(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vpuser_email_history_userId
    ON vpuser_email_history ("userId");
CREATE INDEX IF NOT EXISTS idx_vpuser_email_history_email_lower
    ON vpuser_email_history (LOWER(email));

ALTER TABLE vpuser ADD COLUMN IF NOT EXISTS "pendingEmail" TEXT;
ALTER TABLE vpuser ADD COLUMN IF NOT EXISTS "pendingEmailToken" TEXT;
ALTER TABLE vpuser ADD COLUMN IF NOT EXISTS "pendingEmailRequestedAt" TIMESTAMP;
