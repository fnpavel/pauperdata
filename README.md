# Pauper MTG Analytics Dashboard

A browser-based dashboard for exploring Pauper tournament data with focused views for events, decks, and players.

This repository includes both a front-end dashboard and a full data pipeline that builds the dataset from Google Drive sources.

## Data Pipeline

The repository includes a local + GitHub Actions pipeline that keeps the dashboard data in sync with a shared Google Drive workbook archive.

### What The Pipeline Does

1. Reads workbook metadata from Google Drive or from the local `dataGoogleDrive/` archive.
2. Extracts workbook sheets to staged CSV files for inspection and import.
3. Rebuilds event data and matchup data under `data/`.
4. Regenerates derived Elo outputs under `data/precalculated-elo/`.
5. Refreshes `thumbnail.png` and updates the cache-bust token in `index.html`.
6. Optionally commits and publishes the generated output.
7. Optionally sends a Discord notification after a successful publish.

### Main Paths

#### Normal Sync

Use this when you want the pipeline to look for new Drive workbooks and process only workbooks that are both:
- not already listed in `pipeline/processed-drive-workbooks.json`
- old enough to pass the recent-file safety cutoff

Command:

```powershell
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py sync --yes --skip-publish
```

Notes:
- `sync` is incremental by default.
- `--skip-publish` keeps the run local and avoids branch switching or git pushes.

#### Full Rebuild

Use this when you want to rebuild the generated dataset from the local workbook archive without calling Google Drive.

Command:

```powershell
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py rebuild --full
```

Notes:
- This path rebuilds events, matchups, Elo, and the thumbnail.
- The full rebuild path also runs the Elo builder with full-rebuild pruning enabled.

#### Bounded Validation Mode

Use `--limit N` when you want a smaller validation run.

Examples:

```powershell
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py list --drive --limit 5
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py sync --yes --skip-publish --limit 5
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py rebuild --full --limit 5
```

Behavior:
- `sync --limit N` limits the run to the most recent eligible sync candidates.
- `rebuild --limit N` limits the rebuild to the most recent local archive workbooks after excludes.
- If `--limit` is omitted, default behavior is unchanged.

#### Replay Validation Mode

Use `--reimport-latest` when validation should replay the newest visible Drive workbooks even if they were already processed before.

Example:

```powershell
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py sync --yes --skip-publish --reimport-latest --limit 5
```

Behavior:
- Ignores `pipeline/processed-drive-workbooks.json` for selection.
- Reimports from the newest visible complete Drive workbooks.
- Excludes `[Incomplete]` workbooks by default.
- Reuses the existing include-relative-path rebuild path so event and matchup rows are replaced instead of duplicated.

### Thumbnail Generation

Thumbnail generation is part of the rebuild path, not a separate publish step.

- Script: `pipeline/update-thumbnail.mjs`
- Outputs:
  - `thumbnail.png`
  - updated thumbnail version token inside `index.html`

If thumbnail generation fails, the pipeline logs the failure and keeps the rebuilt data instead of failing the whole run.

### Publish Step

Publish is handled by `pipeline/publish_pipeline_changes.py`.

What it does:
- requires the repo to be on the configured data branch
- refuses to publish if unrelated tracked changes or untracked files are present
- stages generated data files plus `thumbnail.png` and `index.html`
- commits on the data branch
- fast-forwards the main branch

Dry-run example:

```powershell
.venv\Scripts\python.exe pipeline\publish_pipeline_changes.py --dry-run
```

### Discord Notification Step

Discord notification is handled by `pipeline/discord_notify.py`.

What it does:
- prefers publish context from `pipeline/pipeline-state.json`
- skips when no relevant published data changes were recorded
- can fall back to explicit workflow git comparison context if needed
- waits for the live site to serve the expected thumbnail version unless skipped

Dry-run example:

```powershell
.venv\Scripts\python.exe pipeline\discord_notify.py --dry-run --skip-live-site-wait
```

### GitHub Actions

Main workflow:
- `.github/workflows/drive-data-sync-pipeline.yml`

Manual workflow inputs include:
- inspect mode
- sync mode
- full rebuild mode
- optional `max_workbooks` limit for validation runs
- publish toggle
- Discord toggle

### Common Local Validation Commands

Inspect:

```powershell
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py list --drive --limit 5
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py list --latest --limit 5
```

Bounded sync validation:

```powershell
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py sync --yes --skip-publish --limit 5
```

Replay validation:

```powershell
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py sync --yes --skip-publish --reimport-latest --limit 5
```

Bounded rebuild validation:

```powershell
.venv\Scripts\python.exe pipeline\sync_drive_and_rebuild_all.py rebuild --full --limit 5
```

Publish simulation:

```powershell
.venv\Scripts\python.exe pipeline\publish_pipeline_changes.py --dry-run
```

Discord simulation:

```powershell
.venv\Scripts\python.exe pipeline\discord_notify.py --dry-run --skip-live-site-wait
```

### Important Environment Variables

Used by the GitHub Actions wrapper:
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_DRIVE_FOLDER_ID`
- `PIPELINE_REMOTE`
- `PIPELINE_DATA_BRANCH`
- `PIPELINE_MAIN_BRANCH`
- `PIPELINE_COMMIT_MESSAGE_TEMPLATE`

Used by the local pipeline config:
- `GOOGLE_SERVICE_ACCOUNT_FILE`
- `GOOGLE_DRIVE_FOLDER_ID`

Used by Discord notification:
- `DISCORD_WEBHOOK_1`
- `DISCORD_WEBHOOK_2`
- `DISCORD_WEBHOOK_3`
- `PIPELINE_STATE_PATH`
- `EVENT_NAME`
- `BEFORE_SHA`
- `CURRENT_SHA`
- `DASHBOARD_BASE_URL`

### Known Failure Modes

- Drive download timeout
  - Large or older combined workbook files can still hit repeated chunk timeouts.
- Already-processed workbooks
  - Normal `sync` intentionally ignores workbooks listed in `pipeline/processed-drive-workbooks.json`.
- Incomplete workbooks
  - `[Incomplete]` workbooks may be visible in inspect output but are skipped by replay validation mode by default.
- Dirty worktree during publish
  - Publish refuses to continue when unrelated tracked changes or untracked files are present.
- Wrong branch for publish
  - Publish requires the configured data branch.
- Thumbnail generation failure
  - The pipeline continues, but the thumbnail and cache-bust token may be stale until the next successful run.

## What It Includes

- `Event Analysis` with `Single Event` and `Multiple Events` modes
- `Player Analysis` for player performance, deck usage, and finish history
- Meta share, win rate, conversion, and deck evolution charts
- Sortable data tables and drilldown-style hover/click details
- Light and dark theme support

## Project Structure

- `index.html` - app shell and dashboard layout
- `css/` - layout, components, charts, tables, and responsive styles
- `js/` - chart logic, filters, analytics modules, and utilities
- `data/` - local dataset files

## Running Locally

This project is a static front-end app thus serve the folder with any simple local static server

Note: the dashboard loads some assets from external CDNs, including Chart.js, plugins, Google Fonts, and Google Analytics. If those files are not already cached by your browser or available locally on your machine, an internet connection will be needed.


## Main Views

### Event Analysis

- Results for a single tournament
- Aggregate for multiple events across a date range

### Player Analysis

- Track player performance over time (deck usage, top conversion, win rate, event wins, Elo, and finish history)

### Deck Matchup

- Head-to-head deck matchup matrix across the selected dataset window
- Pairing-level win-rate and sample-size exploration

### Player Matchup

- Head-to-head player matchup matrix
- Focused player-vs-player drilldowns across the selected range

### Leaderboards

- Elo-based player leaderboards with seasonal and multi-year modes
- Player drilldowns, timelines, threshold filters, and CSV export

## Data Observation

- All data is sourced from the community.
- MTGO data comes from [Kirblinxy's](https://www.youtube.com/user/Kirblinxy) efforts rewatching MTGO replays.
- Offline data has multiple sources.

## Leaderboards & Elo System

- The leaderboard uses player-vs-player Elo, not deck-vs-deck Elo.
- Default Elo parameters come from `DEFAULT_RANKINGS_OPTIONS`:
  - Starting Rating: `1500` (`startingRating`)
  - K-Factor: `16` (`kFactor`)
- The K-Factor was chosen to match the Elo used by the Vintage community data efforts.
- `UNKNOWN` decks are always included in Elo calculations because the ladder rates players even when deck metadata is missing.
- The Data Quality toggle does not affect Elo. That toggle is used for event-analysis quality filtering, while Elo is computed directly from the matchup archive.

### Leaderboard Modes

- `Single-year (seasonal)`
  - Rankings are scoped to one calendar year.
  - Elo resets on January 1 and tracks that season only.
- `Multi-year (continuous / carry across range)`
  - One continuous Elo trajectory is kept for each player across the full selected year range.
  - Ratings carry forward from the first selected year through the last.
- `Multi-year (reset each year)`
  - Elo resets on January 1 of each year within the selected range.
  - This keeps seasons separate and makes per-season comparisons easier.

## License

This project is licensed under the MIT License.

See [LICENSE](./LICENSE) for the full text.

## Documentation Notes

Recent pipeline, documentation, and code changes in this repository were generated primarily with AI assistance.

Those changes were then reviewed and validated through local checks, workflow-oriented validation runs, and targeted testing before being kept in the repository.
