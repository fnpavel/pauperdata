# Pipeline CLI Reference

## sync_drive_and_rebuild_all.py

### Commands
- `sync`: Download selected Drive workbooks, rebuild derived data, and optionally publish.
- `sync-local`: Rebuild from local archive workbooks instead of calling Google Drive.
- `list`: Show Drive or local archive workbook candidates.
- `download`: Download one specific Drive workbook without rebuilding.
- `exclude`: Exclude one local workbook from rebuild inputs.
- `include`: Remove one local workbook from the exclusion list.
- `override-date`: Save an effective event date override for one local workbook.
- `clear-override-date`: Remove a saved event date override.
- `rebuild`: Rebuild from the local archive.
- `rebuild-local`: Alias of the local archive rebuild path.

### Arguments
- `sync`
  - `--force-redownload`: Redownload one targeted workbook even if it already exists locally.
  - `--yes`: Skip the latest-event confirmation prompt.
  - `--skip-publish`: Rebuild locally without branch prep or git publish.
  - `--reimport-latest`: Replay the newest visible complete Drive workbooks, even if already processed.
  - `--limit N`: Process only the most recent `N` selected candidates.
- `sync-local`
  - `--match TEXT`: Select local workbooks by case-insensitive substring.
  - `--relative-path PATH`: Select one exact archive-relative workbook path.
  - `--year YYYY`: Select all local workbooks under one year folder.
  - `--month YYYY-MM`: Select all local workbooks under one month folder.
  - `--latest`: Select only the newest local workbook.
  - `--missing`: Select local workbooks missing their debug CSV output.
  - `--yes`: Skip the latest-event confirmation prompt.
- `list`
  - `--drive`: List Drive candidates instead of local archive candidates.
  - `--match TEXT`: Filter by case-insensitive substring.
  - `--relative-path PATH`: Filter by exact archive-relative path.
  - `--latest`: Show only the newest matching record.
  - `--limit N`: Show only the first `N` matching rows.
- `download`
  - `--match TEXT`: Select one Drive workbook by substring.
  - `--relative-path PATH`: Select one Drive workbook by exact path.
  - `--latest`: Select the newest matching Drive workbook.
  - `--redownload`: Replace the local copy if it already exists.
- `exclude` / `include`
  - `--match TEXT`: Select one local workbook by substring.
  - `--relative-path PATH`: Select one local workbook by exact path.
  - `--latest`: Select the newest matching local workbook.
- `override-date` / `clear-override-date`
  - `--match TEXT`: Select one local workbook by substring.
  - `--relative-path PATH`: Select one local workbook by exact path.
  - `--latest`: Select the newest matching local workbook.
  - `--date YYYY-MM-DD`: Set the effective event date for `override-date`.
- `rebuild` / `rebuild-local`
  - `--full`: Run the full rebuild path.
  - `--limit N`: Rebuild from only the most recent `N` local archive workbooks.

### Special Modes
- Normal sync:
  - Processes eligible unprocessed Drive workbooks, then rebuilds and optionally publishes.
- Bounded validation:
  - Use `--limit N` to constrain sync or rebuild to the most recent selected candidates.
- Replay mode:
  - Use `sync --reimport-latest` to reprocess the newest visible complete Drive workbooks.

---

## publish_pipeline_changes.py

### Arguments
- `--dry-run`: Show the planned git actions without changing branch state or pushing.

### Behavior Notes
- Must be run from the configured update branch.
- Refuses to publish if unrelated tracked changes or any untracked files exist.
- Commits generated data outputs plus `thumbnail.png` and `index.html`.
- Pushes the update branch, then fast-forwards `main`.

---

## discord_notify.py

### Arguments
- `--index-path PATH`: Override the `index.html` source used for thumbnail version detection.
- `--aliases-path PATH`: Override the `data/aliases.json` source used for payload text.
- `--pipeline-state-path PATH`: Override the publish-state file used for change detection.
- `--dashboard-base-url URL`: Override the live dashboard base URL.
- `--skip-change-detection`: Bypass publish/git change checks.
- `--skip-live-site-wait`: Skip polling the live site before sending.
- `--timeout-seconds N`: Set the live-site wait timeout.
- `--dry-run`: Print the payload instead of sending webhooks.
- `--debug`: Print diagnostics and force dry-run behavior.

### Behavior Notes
- Prefers `pipeline-state.json` as the notification basis.
- Skips when no relevant published data changes were recorded.
- Falls back to explicit git context only when publish state is unavailable.
- Live-site waiting is enabled unless `--skip-live-site-wait` is used.
- Sends to any configured `DISCORD_WEBHOOK_1..3` values.
