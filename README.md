# wecult-radar

Community listening radar for [WeCult](https://wecult.app): scans public
communities (Reddit RSS, Hacker News, Google News) for people looking for a
movie/TV/game/book tracker app, scores intent with AI, drafts reply
suggestions, and delivers everything to a private Telegram chat where a
**human** reviews, edits and posts from their own account.

**This tool never posts, comments, votes or messages anywhere. It only reads
public feeds at a polite rate.** Auto-posting is deliberately out of scope.

- Runs on GitHub Actions (cron). Kill switch: repo variable `RADAR_ENABLED`.
- Reads: Reddit RSS endpoints, HN Algolia API, Google News RSS.
- Scoring/drafting: Groq (batched, free-tier friendly).
- State (seen ids, opportunity queue): Supabase — no lead data in this repo.

## Jobs

- `npm run scan` — collect → freshness gate → dedupe → AI score → high scores
  get instant Telegram messages with 2 reply drafts (target language + Turkish
  explanation), mid scores queue for the daily digest.
- `npm run digest` — send the daily queue summary, draft replies for the top items.
- `npm run dry` — no Supabase/Telegram writes; prints to stdout. Uses Groq only
  if `GROQ_API_KEY` is set.

## Setup (secrets)

`GROQ_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID` as Actions secrets; repo variable `RADAR_ENABLED=true`.
Create tables with `docs/RADAR_TABLES.sql`. Fork PR workflows should stay
disabled (Settings → Actions).

Cron pacing: campaign mode is every 30 min; switch the first cron line in
`.github/workflows/radar.yml` to `17 */2 * * *` for steady-state.
