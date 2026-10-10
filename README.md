# Financial Home

A private household finance dashboard, served as a static site on GitHub Pages:
<https://roquecorona.github.io/financial_home/>

**This repository holds code only.** There is no financial data here. The data lives in a Supabase Postgres
database (schema `finance`), readable only by signed-in, allow-listed household members (row-level security via
`finance.is_member()`). The key in `js/data/supabase-config.js` is the public *publishable* key, which is designed to
ship in browser code; it grants nothing without a member session.

## How it works

1. Sign in with Supabase Auth (email + password, or an emailed sign-in link). `rpc finance.whoami()` checks the allow-list.
2. `DB.init()` downloads every finance table (1,000 rows per page) into an in-memory SQLite database (sql.js), cached in
   IndexedDB per user so repeat visits open instantly and refresh in the background.
3. The API handlers (`js/api/*.js`, ported from the original Python app) run synchronous SQL against that local copy.
4. Edits are written to Supabase first, then mirrored into the local copy.

See `ARCHITECTURE.md` for the contract between the data layer, the API handlers and the UI.

## Layout

| Path | What |
|---|---|
| `index.html`, `manifest.webmanifest` | Entry page (relative paths; served under `/financial_home/`) |
| `js/data/` | Supabase config, SQLite schema, `DB` data layer, auth + login screen |
| `js/api/` | `API` router and the ported handlers |
| `static/` | Styles, fonts, icons, UI scripts and pages |
| `vendor/` | Pinned libraries: sql.js 1.10.3, @supabase/supabase-js 2.57.4, Chart.js 4.4.9 (see `vendor/VERSIONS.txt`) |
| `tests/` | Parity harness: JS handlers vs. the Python reference on a local snapshot (the snapshot is never committed) |

## Local development

```
python3 tests/dev_server.py 8770      # then open http://localhost:8770/?local=1  (local snapshot, dev only)
bash tests/run_all.sh                 # compare every case in tests/cases.txt against the Python reference
```

`?local=1` works only on localhost and needs a snapshot file outside the repo.

## Deploy

Pushing to `main` runs `.github/workflows/pages.yml`, which publishes the static files to GitHub Pages.
