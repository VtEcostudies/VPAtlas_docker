# Changelog — Snapshot 2026-05-14

## v3.5.265 – v3.5.266

### Explore — Review filter, defensive fallback instead of cache-key bump

- **Yesterday's wrong fix.** The 05-13 build shipped `POOL_CACHE_KEY` bumped from `pool_cache_v2` → `pool_cache_v3` to invalidate stale client caches missing the new `_maxVisitUpdatedAt` / `_maxReviewUpdatedAt` fields read by the timestamp-based Review filter. That contradicts a locked decision the user made when **Reset App** was added to the profile page: client-side cache invalidation runs through the Reset App button, not source-side suffix bumps. A code bump forces every active user to refetch the ~98 MB `/pools` payload on next visit — heavy-handed and not what deploys should do.
- **The right fix.** Reverted `POOL_CACHE_KEY` back to `pool_cache_v2` in [js/cache_keys.js](ui_vp/uiVPAtlas/js/cache_keys.js) (with a long comment block flagging it as a locked decision). The Review filter in [explore/js/url_state.js](ui_vp/uiVPAtlas/explore/js/url_state.js) now falls back: `let visitAt = r._maxVisitUpdatedAt || r.visitUpdatedAt` (same for review). Fresh-deduped rows still get the correct max-of-JOIN-rows answer; older cached rows from the prior dedupe path use the single-row timestamp — non-deterministic but non-empty. The freshness-fingerprint refetch in `pool_list.js` heals the cache to the new schema on the next stats-change, no user intervention required.
- **Orphaned `pool_cache_v3` entries.** Clients that ran the 05-13 build wrote into `pool_cache_v3`; that entry sits unused until the next Reset App. Harmless — IDB has plenty of headroom and it'll get wiped on logout/login or Reset.

### Project guide — new "Locked decisions" section at the top of CLAUDE.md

- **Why.** Several long-standing decisions (cache-key policy, patch-only versioning, changelog workflow, precache workflow, api rebuild rule) lived as scattered memory entries and in workflow sub-sections halfway down [CLAUDE.md](CLAUDE.md). When the cache-key rule got violated yesterday, the user observed that key decisions need a single scannable list that's consulted on every change. Memory file index entries help, but the full content only loads when relevant — which is fine for trivia, not for guardrails.
- **The change.** A new top-of-file section in [CLAUDE.md](CLAUDE.md) — `🔒 Locked decisions — re-read before every non-trivial change` — lists each rule as a one-line bullet with date + short rationale, cross-referenced to the existing workflow sections. CLAUDE.md is auto-loaded into every conversation in this repo, so the list sits in active context for the whole session.
- **How to extend.** When the user says "we decided X" / "don't do Y" / "from now on Z," append a bullet here in the same change. Date it. Cross-reference a memory file if the rationale runs long.

### Service worker / build

- **Two patch versions** — `manifest.json` 3.5.264 → 3.5.266 (Review-filter defensive fallback + CLAUDE.md Locked decisions section; second bump regenerated `sw.js` after the `urlsToCache.js` edit for today's partial).
- **`urlsToCache.js`** picked up the new `/docs/CHANGELOG-2026-05-14-partial.md` entry.
