# house-ranking (Cloudflare Worker + D1)

- Production Worker: https://house-ranking.nikkukyuu.workers.dev (script `house-ranking`). Because the account is at the Free-plan D1 limit (10), production tables live **additively** in the existing D1 `stb-ranking` (`ecdbefd9-bbdf-422b-be2a-285825c8db1a`) with a `house_` prefix (`house_players`, `house_tokens`, `house_wins`, `house_scores`, `house_bests`, `house_medals`, `house_closed`). The `stb-ranking` Worker is never modified.
- Test Worker: https://house-ranking-test.nikkukyuu.workers.dev (script `house-ranking-test`, D1 `house-ranking-test` / `c95aeabd-c5cf-44fa-800d-efda67ca7d25`). Same `house_` table names.
- Source: `worker.js` (table names in `T`; `SEAL_SECRET` is a Worker secret, placeholder in git). Schema: `schema.sql`. No cron trigger (Free plan is at the 5-cron limit); `closePeriods` runs lazily on `GET /ranking` and `GET /medals`.
- Record: 3 consecutive COM wins. Value = sum of search times (exploration start → match end, ms, lower is better). Rolling: after win 3, 4, 5… the last 3 wins in the current streak are summed; a new all-time / period best is stored if it improves. A loss resets the streak. Human-vs-human matches are never recorded.
- Endpoints: GET /health, POST /register, POST /nickname, POST /me, POST /match/start, POST /match/submit, GET /ranking?period=day|week|month|year|alltime[&key][&id], GET /medals?ids=
- Anti-cheat: single-use token per COM match, min 500 ms wall clock, min 200 ms search time per win, score encrypted+HMAC-signed, ms ≤ wall+2s, 40 tokens/h/player & 80/h/IP, 10 registrations/h/IP. Tokens (`house_tokens`) may be deleted; player/score rows may not.
- Client: on localhost / 127.0.0.1 the game talks to the **test** Worker automatically; otherwise production. Never point a committed default at the test Worker only.

## ⚠️ PRODUCTION DATA SAFETY

**Never DELETE / DROP / TRUNCATE / bulk-UPDATE in a production ranking DB. Never write test rows to production.**

Schema changes on the shared `stb-ranking` D1 must be additive `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS` with `house_` names only. Never ALTER/DROP/DELETE/UPDATE stb tables or triggers (`players`, `scores`, `medals`, `closed`, `tokens`, `protect_*`).

See the ranking-production-safety skill. Test only against `house-ranking-test`. Production may only be read by agents (except the house Worker itself writing to `house_*` tables at runtime). Triggers: `protect_triggers.sql`.
