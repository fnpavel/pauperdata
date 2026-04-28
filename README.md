# Pauper MTG Analytics Dashboard

A browser-based dashboard for exploring Pauper tournament data with focused views for events, decks, and players.

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

## Data Pipeline

- Source
  - Tournament source files are generated outside this repository as XLSX workbooks by Kirblinxy and stored in a shared Google Drive folder.

- Processing flow
  - The pipeline downloads new XLSX files from Google Drive.
  - Relevant workbook sheets are extracted to CSV.
  - CSV outputs are transformed into normalized JSON datasets.
  - Those datasets are appended into or merged with the site data files under `data/`.

- Build step
  - Node-based build scripts generate derived datasets from the normalized data, including Elo and matchup outputs.

- Deployment
  - Generated changes are committed back to the repository, typically through the data-updates flow.
  - GitHub Actions then runs the follow-up automation:
    - Build/rebuild steps
    - Thumbnail generation
    - GitHub Pages deployment

- Automation behavior
  - The pipeline runs on a schedule.
  - It tracks processed workbooks and avoids reprocessing when no new files are detected.

## License

This project is licensed under the MIT License.

See [LICENSE](./LICENSE) for the full text.
