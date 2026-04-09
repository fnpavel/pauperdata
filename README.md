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
- `dataGoogleDrive/` - Google Drive related data/assets

## Running Locally

This project is a static front-end app.

1. Open `index.html` directly in your browser, or
2. Serve the folder with any simple local static server

Note: the dashboard loads some assets from external CDNs, including Chart.js, plugins, Google Fonts, and Google Analytics. If those files are not already cached by your browser or available locally on your machine, an internet connection will be needed.


## Main Views

### Event Analysis

- Results for a single tournament
- Aggregate for multiple events across a date range

### Player Analysis

- Track player's performance over time (deck, top conversion, win rate, event wins, etc)

## Data Observation

- All data is sourced from the community.
- MTGO data comes from [Kirblinxy's](https://www.youtube.com/user/Kirblinxy) efforts rewatching MTGO replays.
- Offline data has multiple sources.

## License

This project is licensed under the MIT License.

See [LICENSE](./LICENSE) for the full text.
