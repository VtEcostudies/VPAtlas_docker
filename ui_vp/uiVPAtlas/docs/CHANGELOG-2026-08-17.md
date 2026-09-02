# Changelog — Snapshot 2026-08-17

## v3.5.365 – v3.5.366

### Password reset and registration email — restored (prod outage since cutover)

- **The bug.** Requesting a password reset on vpatlas.org returned HTTP 400 with the message `Missing credentials for "PLAIN"`. Account registration was broken the same way, through the same code path. Nothing on the page explained what had gone wrong, and retrying never helped.
- **The cause.** Not a code bug — a server misconfiguration that had been silently in place since the docker cutover. The production stack's `.env` file was a symlink pointing at a directory that does not exist on the host (`/home/ubuntu/VPAtlas_docker`; the real one is spelled `…_developement`). Docker Compose interpolates the mail credential from that file, so the API container started with an **empty** `EMAIL_PASSWORD` and could not log in to its own mailbox. The production API log shows 51 failed sends and zero successful ones.
- **The fix.** The symlink was re-pointed at the real file and the API container recreated. Verified against Gmail end-to-end: reset request → email delivered → token confirmed → login with the new password.
- **Why it went unnoticed.** Everything looked healthy. The stack came up, the API served data, and the only symptom was an error message on a page most users never visit. Nothing in the deploy output or the startup log mentioned that outbound mail was dead.

### Password reset no longer locks you out when email fails

- **The gap.** `reset()` in [api_vp/users/vpUser.service.pg.js](api_vp/users/vpUser.service.pg.js) flipped your account to `status='reset'` and stored a reset token **before** trying to send the email, and never undid that when the send failed. So every failed attempt left the account demanding a token that was never delivered — logging in normally then returned *"Please complete the password reset process using your emailed reset token."* **12 accounts were stranded this way** and have been restored to normal status; their passwords were never altered, so the original password works again.
- **The fix.** The order is inverted: look the user up, send the email, and only write the token and status change once the mail is actually out the door. A mail failure now leaves your account exactly as it was.
- **Same protection for registration and email-change.** Registration used to leave a half-created account behind when its confirmation email failed — unusable, un-confirmable, and blocking any retry with "email has already registered". It now rolls the account back so you can simply register again. An email-change request that fails to send likewise clears its pending address instead of leaving it parked.

### Password reset now accepts your email in any capitalization

- **The gap.** The reset lookup matched your address **exactly**, while logging in has always matched case-insensitively. Someone registered as `Jane@example.com` who typed `jane@example.com` on the reset page was told *"email … NOT found"* — indistinguishable from having no account at all.
- **The fix.** Reset now matches case-insensitively, consistent with login.

### Clearer message when the server can't send mail

- **The gap.** Server-side mail failures reached the user as raw plumbing: `Missing credentials for "PLAIN"`. Nothing about that string suggests the problem is on our end and that the user's account is fine.
- **The fix.** Mail failures now read: *"We couldn't send the password reset email right now — this is a problem on our end, not with your account. Nothing has been changed. Please try again shortly, and contact a VPAtlas administrator if it keeps failing."* The underlying error code is still logged server-side for diagnosis.

### Guardrails so this can't repeat silently

- **Startup warning.** [api_vp/users/sendmail.js](api_vp/users/sendmail.js) now prints a banner at startup when mail credentials are missing, and refuses to attempt a send with a diagnosable error instead of falling through to an SMTP-layer message.
- **Deploy preflight.** [deploy/deploy-prod.sh](deploy/deploy-prod.sh) validates the production `.env` before recreating the API container and aborts the deploy if `EMAIL_PASSWORD`, `APP_EMAIL`, or `DB_PASSWORD` is empty or set to a placeholder. It reports presence and length only, never values. Also available on its own as `deploy-prod.sh preflight` for a read-only check.
- **The check that failed.** The setup step tested whether a `.env` symlink *existed* — which was true even while it dangled — and reported "symlink already present" every time. It now tests whether the file actually **resolves**, converts the symlink to a real file so production can't be broken by changes in an unrelated checkout, and fails loudly with recovery instructions when there's nothing to read.

### Service worker / build

- `manifest.json` 3.5.364 → 3.5.366 via `node sw-build.js patch` (3.5.365 locally while verifying, 3.5.366 on the prod ship). **API + UI** rebuild (`api_vp/**` changed).
- [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js): added `/docs/CHANGELOG-2026-08-17.md`; [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) `DOCS` array updated to match.
