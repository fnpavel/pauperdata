#!/usr/bin/env python3
"""Import Google Drive workbook data into the current MTG Tracker dataset.

Pipeline:
1. Extract the `Input` sheet from each workbook into a staged CSV.
2. Apply the old "below top 32" UNKNOWN-deck normalization.
3. Rebuild split event JSON under `data/events` and then regenerate normalized JSON outputs.

This keeps the current CSV staging flow, which makes it easy to swap the
workbook source later for the Google Drive API without rewriting the rest of
the pipeline.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable

try:
    import pandas as pd
except ImportError as exc:  # pragma: no cover - dependency guidance
    raise SystemExit(
        "This importer requires pandas and openpyxl. "
        "Install them with: pip install pandas openpyxl"
    ) from exc


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_ROOT = PROJECT_ROOT / "dataGoogleDrive"
DEFAULT_CSV_ROOT = PROJECT_ROOT / "data" / "staging" / "google-drive-input"
DEFAULT_MATCHUP_CSV_ROOT = PROJECT_ROOT / "data" / "staging" / "google-drive-matchup-input"
DEFAULT_JS_DATA_PATH = PROJECT_ROOT / "js" / "data.js"
DEFAULT_EVENT_DATA_ROOT = PROJECT_ROOT / "data" / "events"
DEFAULT_SUMMARY_PATH = PROJECT_ROOT / "data" / "import-summary.json"
DEFAULT_MATCHUP_DATA_ROOT = PROJECT_ROOT / "data" / "matchups"
LEGACY_MATCHUP_JSON_PATH = PROJECT_ROOT / "data" / "matchups.json"
DEFAULT_NORMALIZED_BUILDER = PROJECT_ROOT / "scripts" / "automatedpipeline" / "build-normalized-dataset.mjs"
DEFAULT_PIPELINE_OVERRIDES_PATH = PROJECT_ROOT / "scripts" / "automatedpipeline" / "pipeline-overrides.json"

MONTH_NUMBERS = {
    "January": "01",
    "February": "02",
    "March": "03",
    "April": "04",
    "May": "05",
    "June": "06",
    "July": "07",
    "August": "08",
    "September": "09",
    "October": "10",
    "November": "11",
    "December": "12",
}

DATE_PREFIX_PATTERN = re.compile(r"^(?P<day>\d{1,2})\s+(?P<month>[A-Za-z]+)\s+[' _]?(?P<year>\d{2})\b")
MATCHUP_ROUND_HEADER_PATTERN = re.compile(r"^Round\s+(?P<round>\d+)$", re.IGNORECASE)
MATCHUP_SCORE_PATTERN = re.compile(r"(?P<wins>\d+)\s*[-:]\s*(?P<losses>\d+)(?:\s*[-:]\s*(?P<draws>\d+))?")
WORD_EXCEPTIONS = {
    "mtgo": "MTGO",
    "ny": "NY",
}
EVENT_DISPLAY_NAME_OVERRIDES = {
    "MTGO Challenge": "Challenge",
    "MTGO Challenge 64": "Challenge 64",
    "MTGO Qualifier": "Qualifier",
    "MTGO Showcase": "Showcase",
    "MTGO Super": "Super",
    "Paupergeddon Pisa": "Paupergeddon Pisa",
    "Upstate NY Pauper Open": "Upstate NY Pauper Open",
}


@dataclass(frozen=True)
class EventMetadata:
    date: str
    event_type: str
    event: str


@dataclass(frozen=True)
class MatchupBuildResult:
    event_summary: dict[str, object]
    rounds: list[dict[str, object]]
    matches: list[dict[str, object]]


MANUAL_METADATA_OVERRIDES: dict[str, EventMetadata] = {
    # Example for later:
    # "2024/August _24/US Pauper 2K Matchups.xlsx": EventMetadata(
    #     date="2024-08-17",
    #     event_type="online",
    #     event="MTGO Pauper 2K (2024-08-17)",
    # )
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import Google Drive workbooks into the MTG Tracker dataset.")
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--csv-root", type=Path, default=DEFAULT_CSV_ROOT)
    parser.add_argument("--matchup-csv-root", type=Path, default=DEFAULT_MATCHUP_CSV_ROOT)
    parser.add_argument("--event-data-root", type=Path, default=DEFAULT_EVENT_DATA_ROOT)
    parser.add_argument("--js-data-path", type=Path, default=DEFAULT_JS_DATA_PATH)
    parser.add_argument("--matchup-data-root", type=Path, default=DEFAULT_MATCHUP_DATA_ROOT)
    parser.add_argument("--summary-path", type=Path, default=DEFAULT_SUMMARY_PATH)
    parser.add_argument("--normalized-builder", type=Path, default=DEFAULT_NORMALIZED_BUILDER)
    parser.add_argument(
        "--include-relative-path",
        action="append",
        default=[],
        help="Import only the workbook(s) matching these source-root-relative POSIX paths.",
    )
    parser.add_argument(
        "--modified-since",
        type=str,
        help="Only import workbooks with a filesystem modified time later than this ISO timestamp.",
    )
    parser.add_argument(
        "--modified-date-after",
        type=str,
        help="Only import workbooks with a filesystem modified date after this YYYY-MM-DD value.",
    )
    parser.add_argument(
        "--pipeline-overrides-path",
        type=Path,
        default=DEFAULT_PIPELINE_OVERRIDES_PATH,
        help="Optional JSON file that can exclude local archive paths or override workbook metadata.",
    )
    parser.add_argument("--include-incomplete", action="store_true", help="Import workbooks marked [Incomplete].")
    parser.add_argument(
        "--replace-existing-online",
        action="store_true",
        help="Rebuild online event and matchup data from the selected workbooks instead of preserving existing online rows.",
    )
    parser.add_argument("--skip-normalized-build", action="store_true", help="Skip rebuilding events.json/results.json/aliases.json.")
    parser.add_argument("--quiet", action="store_true")
    return parser.parse_args()


def log(message: str, *, quiet: bool = False) -> None:
    if not quiet:
        print(message)


def find_workbooks(source_root: Path) -> list[Path]:
    return sorted(path for path in source_root.rglob("*.xlsx") if path.is_file())


def relative_posix(path: Path, base: Path) -> str:
    return path.relative_to(base).as_posix()


def normalize_relative_path(value: object) -> str:
    return str(value or "").replace("\\", "/").lstrip("./").strip()


def load_pipeline_overrides(path: Path | None) -> tuple[set[str], dict[str, dict[str, str]]]:
    if path is None or not path.exists():
        return set(), {}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Pipeline overrides file is not valid JSON: {path}\n{exc}") from exc

    if not isinstance(payload, dict):
        raise SystemExit(f"Pipeline overrides file must contain a JSON object: {path}")

    excluded_relative_paths: set[str] = set()
    raw_excluded_relative_paths = payload.get("excluded_relative_paths")
    if isinstance(raw_excluded_relative_paths, list):
        for item in raw_excluded_relative_paths:
            normalized_path = normalize_relative_path(item)
            if normalized_path:
                excluded_relative_paths.add(normalized_path)

    metadata_overrides_by_relative_path: dict[str, dict[str, str]] = {}
    raw_metadata_overrides = payload.get("metadata_overrides_by_relative_path")
    if isinstance(raw_metadata_overrides, dict):
        for key, value in raw_metadata_overrides.items():
            normalized_path = normalize_relative_path(key)
            if not normalized_path or not isinstance(value, dict):
                continue

            normalized_override: dict[str, str] = {}
            override_date = normalize_whitespace(value.get("date"))
            if override_date:
                normalized_override["date"] = override_date
            if normalized_override:
                metadata_overrides_by_relative_path[normalized_path] = normalized_override

    return excluded_relative_paths, metadata_overrides_by_relative_path


def parse_iso_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_modified_after(path: Path, cutoff: datetime) -> bool:
    modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return modified_at > cutoff


def is_modified_date_after(path: Path, cutoff: date) -> bool:
    modified_date = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).date()
    return modified_date > cutoff


def normalize_headers(columns: Iterable[object]) -> list[str]:
    normalized: list[str] = []
    seen: Counter[str] = Counter()

    for index, column in enumerate(columns):
        header = "" if column is None else str(column).strip()
        if not header or header.startswith("Unnamed"):
            header = "Rank" if index == 0 else f"Column{index + 1}"

        seen[header] += 1
        if seen[header] > 1:
            header = f"{header}_{seen[header]}"

        normalized.append(header)

    return normalized


def clean_string(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def normalize_identity_key(value: object) -> str:
    return re.sub(r"\s+", " ", clean_string(value)).strip().lower()


def normalize_whitespace(value: object) -> str:
    return re.sub(r"\s+", " ", clean_string(value)).strip()


def title_case_word(word: str) -> str:
    lower_word = word.lower()
    if lower_word in WORD_EXCEPTIONS:
        return WORD_EXCEPTIONS[lower_word]
    if word.isdigit():
        return word
    return f"{lower_word[:1].upper()}{lower_word[1:]}"


def to_display_title_case(value: object) -> str:
    return " ".join(title_case_word(segment) for segment in normalize_whitespace(value).split(" ") if segment)


def strip_event_date_suffix(event_name: object) -> str:
    return re.sub(r"\s*\(\d{4}-\d{2}-\d{2}\)$", "", normalize_whitespace(event_name))


def get_event_display_name(event_name: object) -> str:
    base_name = strip_event_date_suffix(event_name)
    if base_name in EVENT_DISPLAY_NAME_OVERRIDES:
        return EVENT_DISPLAY_NAME_OVERRIDES[base_name]

    if base_name.upper().startswith("MTGO "):
        return to_display_title_case(base_name[5:])

    return to_display_title_case(base_name)


def slugify(value: object) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", normalize_whitespace(value).lower()))


def build_event_id(event_name: object, event_type: object, event_date: object) -> str:
    return f"{normalize_whitespace(event_type).lower()}-{slugify(get_event_display_name(event_name))}-{normalize_whitespace(event_date)}"


def build_matchup_headers(columns: Iterable[object]) -> list[str]:
    headers = [clean_string(column) for column in columns]
    enriched = list(headers)

    index = 2
    while index < len(enriched):
        header = clean_string(enriched[index])
        round_match = MATCHUP_ROUND_HEADER_PATTERN.match(header)
        if round_match:
            round_label = f"Round {int(round_match.group('round'))}"
            enriched[index] = f"{round_label} Opponent"
            if index + 1 < len(enriched):
                result_header = clean_string(enriched[index + 1])
                if not result_header or result_header.startswith("Unnamed"):
                    enriched[index + 1] = f"{round_label} Result"
            index += 2
            continue
        index += 1

    return normalize_headers(enriched)


def extract_matchup_sheet(workbook_path: Path, source_root: Path) -> pd.DataFrame:
    workbook = pd.ExcelFile(workbook_path, engine="openpyxl")
    if "Match Up Input" not in workbook.sheet_names:
        raise ValueError("Workbook does not contain a Match Up Input sheet.")

    dataframe = workbook.parse("Match Up Input")
    dataframe.columns = build_matchup_headers(dataframe.columns)

    if "Player" not in dataframe.columns:
        raise ValueError("Match Up Input sheet does not contain a Player column.")

    player_series = dataframe["Player"].astype("string")
    dataframe = dataframe[player_series.notna() & player_series.str.strip().ne("")].copy()
    dataframe["Source"] = workbook_path.name
    dataframe["SourcePath"] = relative_posix(workbook_path, source_root)
    return dataframe


def parse_optional_int(value: object) -> int | None:
    if value is None or pd.isna(value):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def parse_match_result(raw_result: object) -> dict[str, object]:
    normalized_result = normalize_whitespace(raw_result)
    upper_result = normalized_result.upper()

    if not normalized_result:
        return {
            "normalized_result": "",
            "result_type": "unknown",
            "games_won": None,
            "games_lost": None,
            "games_drawn": None,
            "has_numeric_score": False,
            "is_bye": False,
        }

    if "BYE" in upper_result:
        return {
            "normalized_result": normalized_result,
            "result_type": "bye",
            "games_won": None,
            "games_lost": None,
            "games_drawn": None,
            "has_numeric_score": False,
            "is_bye": True,
        }

    score_match = MATCHUP_SCORE_PATTERN.search(normalized_result)
    if score_match:
        games_won = int(score_match.group("wins"))
        games_lost = int(score_match.group("losses"))
        games_drawn = score_match.group("draws")
        result_type = "draw"
        if games_won > games_lost:
            result_type = "win"
        elif games_lost > games_won:
            result_type = "loss"

        return {
            "normalized_result": normalized_result,
            "result_type": result_type,
            "games_won": games_won,
            "games_lost": games_lost,
            "games_drawn": int(games_drawn) if games_drawn is not None else None,
            "has_numeric_score": True,
            "is_bye": False,
        }

    if upper_result in {"W", "WIN", "WON"}:
        result_type = "win"
    elif upper_result in {"L", "LOSS", "LOST"}:
        result_type = "loss"
    elif upper_result in {"D", "DRAW", "ID", "INTENTIONAL DRAW"}:
        result_type = "draw"
    else:
        result_type = "unknown"

    return {
        "normalized_result": normalized_result,
        "result_type": result_type,
        "games_won": None,
        "games_lost": None,
        "games_drawn": None,
        "has_numeric_score": False,
        "is_bye": False,
    }


def extract_input_sheet(workbook_path: Path, source_root: Path) -> pd.DataFrame:
    workbook = pd.ExcelFile(workbook_path, engine="openpyxl")
    if "Input" not in workbook.sheet_names:
        raise ValueError("Workbook does not contain an Input sheet.")

    dataframe = workbook.parse("Input", usecols="A:K")
    dataframe.columns = normalize_headers(dataframe.columns)

    if dataframe.shape[1] < 2:
        raise ValueError("Input sheet does not contain the expected player columns.")

    player_series = dataframe.iloc[:, 1].astype("string")
    dataframe = dataframe[player_series.notna() & player_series.str.strip().ne("")].copy()
    dataframe["Source"] = workbook_path.name
    dataframe["SourcePath"] = relative_posix(workbook_path, source_root)
    return dataframe


def write_staging_csv(dataframe: pd.DataFrame, workbook_path: Path, source_root: Path, csv_root: Path) -> Path:
    relative_csv_path = workbook_path.relative_to(source_root).with_suffix(".csv")
    output_path = csv_root / relative_csv_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dataframe.to_csv(output_path, index=False)
    return output_path


def normalize_below_top32(csv_path: Path) -> None:
    dataframe = pd.read_csv(csv_path)
    dataframe.columns = normalize_headers(dataframe.columns)

    if "Rank" not in dataframe.columns or "Deck" not in dataframe.columns:
        return

    dataframe["Rank"] = pd.to_numeric(dataframe["Rank"], errors="coerce").fillna(0).astype(int)
    below_top32 = dataframe[dataframe["Rank"] > 32]
    if below_top32.empty:
        return

    unknown_proportion = below_top32["Deck"].fillna("").astype(str).str.strip().str.upper().eq("UNKNOWN").mean()
    if unknown_proportion > 0.5:
        dataframe.loc[dataframe["Rank"] > 32, "Deck"] = "UNKNOWN"
        dataframe.to_csv(csv_path, index=False)


def apply_metadata_override(metadata: EventMetadata, metadata_override: dict[str, str] | None) -> EventMetadata:
    if not metadata_override:
        return metadata

    override_date = normalize_whitespace(metadata_override.get("date"))
    if not override_date:
        return metadata

    try:
        date.fromisoformat(override_date)
    except ValueError as exc:
        raise ValueError(f"Invalid override date '{override_date}'. Expected YYYY-MM-DD.") from exc

    base_event_name = strip_event_date_suffix(metadata.event) or metadata.event
    return EventMetadata(
        date=override_date,
        event_type=metadata.event_type,
        event=f"{base_event_name} ({override_date})",
    )


def resolve_event_metadata(
    relative_workbook_path: str,
    workbook_name: str,
    include_incomplete: bool,
    metadata_override: dict[str, str] | None = None,
) -> EventMetadata | None:
    if relative_workbook_path in MANUAL_METADATA_OVERRIDES:
        return apply_metadata_override(MANUAL_METADATA_OVERRIDES[relative_workbook_path], metadata_override)

    if not include_incomplete and "[Incomplete]" in workbook_name:
        return None

    base_name = Path(workbook_name).stem
    date_match = DATE_PREFIX_PATTERN.match(base_name)
    if not date_match:
        return None

    month_name = date_match.group("month")
    if month_name not in MONTH_NUMBERS:
        return None

    event_date = f"20{date_match.group('year')}-{MONTH_NUMBERS[month_name]}-{date_match.group('day').zfill(2)}"

    if "Championship Week Finals" in base_name:
        event_base = "MTGO Championship Week Finals"
    elif "Showcase" in base_name:
        event_base = "MTGO Showcase"
    elif "Challenge 64" in base_name:
        event_base = "MTGO Challenge 64"
    elif "Super Qualifier" in base_name:
        event_base = "MTGO Super"
    elif "Qualifier" in base_name:
        event_base = "MTGO Qualifier"
    elif "Challenge 32" in base_name:
        event_base = "MTGO Challenge"
    else:
        return None

    return apply_metadata_override(
        EventMetadata(date=event_date, event_type="online", event=f"{event_base} ({event_date})"),
        metadata_override,
    )


def resolve_skip_reason(relative_workbook_path: str, workbook_name: str, include_incomplete: bool) -> str:
    if relative_workbook_path in MANUAL_METADATA_OVERRIDES:
        return ""
    if not include_incomplete and "[Incomplete]" in workbook_name:
        return "Workbook is marked as incomplete."
    if not DATE_PREFIX_PATTERN.match(Path(workbook_name).stem):
        return "Could not parse an event date from the workbook name."
    return "Could not map workbook name to a supported event type."


def get_win_rate_column(columns: Iterable[str]) -> str | None:
    for column in columns:
        lowered = column.strip().lower()
        if lowered in {"winrate", "win rate"}:
            return column
    return None


def clean_player_name(value: object) -> str:
    return "" if value is None else str(value).strip()


def build_dataset_rows_from_dataframe(
    dataframe: pd.DataFrame,
    metadata: EventMetadata,
    *,
    source_label: str = "dataframe",
) -> list[dict[str, object]]:
    required_columns = {"Rank", "Name", "Deck", "Wins", "Losses"}
    missing_columns = sorted(required_columns.difference(dataframe.columns))
    if missing_columns:
        raise ValueError(f"{source_label} is missing required columns: {', '.join(missing_columns)}")

    win_rate_column = get_win_rate_column(dataframe.columns)

    dataframe["Rank"] = pd.to_numeric(dataframe["Rank"], errors="coerce")
    dataframe["Wins"] = pd.to_numeric(dataframe["Wins"], errors="coerce")
    dataframe["Losses"] = pd.to_numeric(dataframe["Losses"], errors="coerce")
    if win_rate_column:
        dataframe[win_rate_column] = pd.to_numeric(dataframe[win_rate_column], errors="coerce")
    else:
        dataframe["Winrate"] = pd.NA
        win_rate_column = "Winrate"

    dataframe["Player"] = dataframe["Name"].map(clean_player_name)
    dataframe["Deck"] = dataframe["Deck"].fillna("").astype(str).str.strip()

    required_mask = (
        dataframe["Rank"].notna()
        & dataframe["Player"].astype(str).str.strip().ne("")
        & dataframe["Deck"].astype(str).str.strip().ne("")
    )
    dataframe = dataframe.loc[required_mask].copy()

    dataframe["Rank"] = dataframe["Rank"].astype(int)
    dataframe["Wins"] = dataframe["Wins"].fillna(0).astype(int)
    dataframe["Losses"] = dataframe["Losses"].fillna(0).astype(int)
    dataframe["Win Rate"] = dataframe[win_rate_column]

    totals = dataframe["Wins"] + dataframe["Losses"]
    fallback_mask = dataframe["Win Rate"].isna() & totals.gt(0)
    dataframe.loc[fallback_mask, "Win Rate"] = dataframe.loc[fallback_mask, "Wins"] / totals.loc[fallback_mask]
    dataframe["Win Rate"] = dataframe["Win Rate"].fillna(0).astype(float)

    rows: list[dict[str, object]] = []
    for row in dataframe[["Rank", "Player", "Deck", "Wins", "Losses", "Win Rate"]].to_dict(orient="records"):
        rows.append(
            {
                "Date": metadata.date,
                "EventType": metadata.event_type,
                "Event": metadata.event,
                "Rank": int(row["Rank"]),
                "Player": str(row["Player"]),
                "Deck": str(row["Deck"]),
                "Wins": int(row["Wins"]),
                "Losses": int(row["Losses"]),
                "Win Rate": float(row["Win Rate"]),
            }
        )

    return rows


def build_dataset_rows_from_csv(csv_path: Path, metadata: EventMetadata) -> list[dict[str, object]]:
    dataframe = pd.read_csv(csv_path)
    dataframe.columns = normalize_headers(dataframe.columns)
    return build_dataset_rows_from_dataframe(dataframe, metadata, source_label=f"CSV '{csv_path}'")


def build_matchup_dataset(
    dataframe: pd.DataFrame,
    metadata: EventMetadata,
    relative_workbook_path: str,
    input_rows: list[dict[str, object]],
) -> MatchupBuildResult:
    event_id = build_event_id(metadata.event, metadata.event_type, metadata.date)
    event_display_name = get_event_display_name(metadata.event)
    source_workbook = Path(relative_workbook_path).name

    input_lookup: dict[str, dict[str, object]] = {}
    for input_row in input_rows:
        player = normalize_whitespace(input_row.get("Player"))
        player_key = normalize_identity_key(player)
        if not player_key:
            continue

        input_lookup[player_key] = {
            "player": player,
            "deck": normalize_whitespace(input_row.get("Deck")),
            "rank": parse_optional_int(input_row.get("Rank")),
            "wins": parse_optional_int(input_row.get("Wins")),
            "losses": parse_optional_int(input_row.get("Losses")),
            "final_standing": parse_optional_int(input_row.get("Rank")),
        }

    participant_lookup: dict[str, dict[str, object]] = {}
    matchup_rows = dataframe.to_dict(orient="records")

    for row in matchup_rows:
        player = normalize_whitespace(row.get("Player"))
        player_key = normalize_identity_key(player)
        if not player_key:
            continue

        input_snapshot = input_lookup.get(player_key, {})
        final_standing = parse_optional_int(row.get("Final Standing"))
        participant_lookup[player_key] = {
            "player": player or str(input_snapshot.get("player") or ""),
            "deck": normalize_whitespace(row.get("Archetype")) or str(input_snapshot.get("deck") or ""),
            "rank": parse_optional_int(input_snapshot.get("rank")),
            "wins": parse_optional_int(input_snapshot.get("wins")),
            "losses": parse_optional_int(input_snapshot.get("losses")),
            "final_standing": final_standing if final_standing is not None else parse_optional_int(input_snapshot.get("final_standing")),
        }

    round_columns: list[tuple[int, str, str]] = []
    for column in dataframe.columns:
        column_match = re.match(r"^Round\s+(?P<round>\d+)\s+Opponent$", clean_string(column), flags=re.IGNORECASE)
        if not column_match:
            continue

        round_number = int(column_match.group("round"))
        round_label = f"Round {round_number}"
        result_column = f"{round_label} Result"
        if result_column in dataframe.columns:
            round_columns.append((round_number, column, result_column))

    round_columns.sort(key=lambda item: item[0])

    def get_participant_snapshot(player_key: str, observations: list[dict[str, object]]) -> dict[str, object]:
        snapshot = dict(participant_lookup.get(player_key, input_lookup.get(player_key, {})))
        if snapshot.get("player") and snapshot.get("deck"):
            return snapshot

        for observation in observations:
            if observation.get("player_key") == player_key:
                if not snapshot.get("player"):
                    snapshot["player"] = observation.get("player", "")
                if not snapshot.get("deck"):
                    snapshot["deck"] = observation.get("deck", "")
                if snapshot.get("rank") is None:
                    snapshot["rank"] = observation.get("rank")
                if snapshot.get("final_standing") is None:
                    snapshot["final_standing"] = observation.get("final_standing")
            if observation.get("opponent_key") == player_key:
                if not snapshot.get("player"):
                    snapshot["player"] = observation.get("opponent", "")
                if not snapshot.get("deck"):
                    snapshot["deck"] = observation.get("opponent_deck", "")
                if snapshot.get("rank") is None:
                    snapshot["rank"] = observation.get("opponent_rank")
                if snapshot.get("final_standing") is None:
                    snapshot["final_standing"] = observation.get("opponent_final_standing")
        return snapshot

    round_rows: list[dict[str, object]] = []
    match_groups: dict[str, list[dict[str, object]]] = {}
    bye_round_count = 0
    unresolved_round_count = 0

    for row in matchup_rows:
        player = normalize_whitespace(row.get("Player"))
        player_key = normalize_identity_key(player)
        if not player_key:
            continue

        participant_snapshot = participant_lookup.get(player_key, input_lookup.get(player_key, {}))
        deck = str(participant_snapshot.get("deck") or "")
        rank = parse_optional_int(participant_snapshot.get("rank"))
        final_standing = parse_optional_int(participant_snapshot.get("final_standing"))

        for round_number, opponent_column, result_column in round_columns:
            opponent = normalize_whitespace(row.get(opponent_column))
            raw_result = normalize_whitespace(row.get(result_column))
            if not opponent and not raw_result:
                continue

            parsed_result = parse_match_result(raw_result)
            opponent_key = normalize_identity_key(opponent)
            opponent_snapshot = participant_lookup.get(opponent_key, input_lookup.get(opponent_key, {}))
            pair_key = ""
            if opponent_key and not parsed_result["is_bye"]:
                left_key, right_key = sorted([player_key, opponent_key])
                pair_key = f"{event_id}|||{round_number}|||{left_key}|||{right_key}"

            round_record = {
                "event_id": event_id,
                "date": metadata.date,
                "event_type": metadata.event_type,
                "event": metadata.event,
                "event_display_name": event_display_name,
                "round": round_number,
                "player": player,
                "player_key": player_key,
                "deck": deck,
                "rank": rank,
                "final_standing": final_standing,
                "opponent": opponent,
                "opponent_key": opponent_key,
                "opponent_deck": str(opponent_snapshot.get("deck") or ""),
                "opponent_rank": parse_optional_int(opponent_snapshot.get("rank")),
                "opponent_final_standing": parse_optional_int(opponent_snapshot.get("final_standing")),
                "raw_result": raw_result,
                "normalized_result": parsed_result["normalized_result"],
                "result_type": parsed_result["result_type"],
                "games_won": parsed_result["games_won"],
                "games_lost": parsed_result["games_lost"],
                "games_drawn": parsed_result["games_drawn"],
                "has_numeric_score": parsed_result["has_numeric_score"],
                "is_bye": parsed_result["is_bye"],
                "pair_key": pair_key,
                "source_workbook": source_workbook,
                "source_path": relative_workbook_path,
            }
            round_rows.append(round_record)

            if parsed_result["is_bye"]:
                bye_round_count += 1
                continue

            if not opponent_key:
                unresolved_round_count += 1
                continue

            match_groups.setdefault(pair_key, []).append(round_record)

    matches: list[dict[str, object]] = []
    paired_match_count = 0
    single_sided_match_count = 0
    conflicting_match_count = 0

    def choose_preferred_observation(
        current_observation: dict[str, object],
        candidate_observation: dict[str, object],
    ) -> dict[str, object]:
        current_numeric = bool(current_observation.get("has_numeric_score"))
        candidate_numeric = bool(candidate_observation.get("has_numeric_score"))
        if current_numeric != candidate_numeric:
            return candidate_observation if candidate_numeric else current_observation

        current_completeness = int(bool(current_observation.get("opponent"))) + int(bool(current_observation.get("normalized_result")))
        candidate_completeness = int(bool(candidate_observation.get("opponent"))) + int(bool(candidate_observation.get("normalized_result")))
        if candidate_completeness > current_completeness:
            return candidate_observation
        return current_observation

    def resolve_outcome_from_observation(
        observation: dict[str, object] | None,
        *,
        from_player_a_perspective: bool,
    ) -> str:
        if not observation:
            return "unknown"

        result_type = str(observation.get("result_type") or "unknown")
        if result_type == "draw":
            return "draw"
        if result_type == "win":
            return "player_a_win" if from_player_a_perspective else "player_b_win"
        if result_type == "loss":
            return "player_b_win" if from_player_a_perspective else "player_a_win"
        return "unknown"

    for pair_key, observations in sorted(
        match_groups.items(),
        key=lambda item: (
            int(item[1][0].get("round") or 0),
            str(item[1][0].get("date") or ""),
            str(item[1][0].get("event") or ""),
            item[0],
        ),
    ):
        observations_by_player: dict[str, dict[str, object]] = {}
        duplicate_observation_count = 0

        for observation in observations:
            player_key = str(observation.get("player_key") or "")
            if player_key in observations_by_player:
                duplicate_observation_count += 1
                observations_by_player[player_key] = choose_preferred_observation(
                    observations_by_player[player_key],
                    observation,
                )
            else:
                observations_by_player[player_key] = observation

        player_keys = sorted(
            {
                str(key)
                for key in (
                    observations[0].get("player_key"),
                    observations[0].get("opponent_key"),
                )
                if key
            }
        )
        if len(player_keys) != 2:
            continue

        player_a_key, player_b_key = player_keys
        observation_a = observations_by_player.get(player_a_key)
        observation_b = observations_by_player.get(player_b_key)
        snapshot_a = get_participant_snapshot(player_a_key, observations)
        snapshot_b = get_participant_snapshot(player_b_key, observations)

        games_a = None
        games_b = None
        games_drawn = None
        score_conflict = False
        directional_conflict = False
        score_source = ""

        if observation_a and observation_a.get("has_numeric_score"):
            games_a = parse_optional_int(observation_a.get("games_won"))
            games_b = parse_optional_int(observation_a.get("games_lost"))
            games_drawn = parse_optional_int(observation_a.get("games_drawn"))
            score_source = "player_a"

        if observation_b and observation_b.get("has_numeric_score"):
            inferred_games_a = parse_optional_int(observation_b.get("games_lost"))
            inferred_games_b = parse_optional_int(observation_b.get("games_won"))
            inferred_games_drawn = parse_optional_int(observation_b.get("games_drawn"))
            if games_a is None and games_b is None:
                games_a = inferred_games_a
                games_b = inferred_games_b
                games_drawn = inferred_games_drawn
                score_source = "player_b"
            elif games_a != inferred_games_a or games_b != inferred_games_b:
                score_conflict = True

        outcome = "unknown"
        if games_a is not None and games_b is not None:
            if games_a > games_b:
                outcome = "player_a_win"
            elif games_b > games_a:
                outcome = "player_b_win"
            else:
                outcome = "draw"

        directional_outcome = resolve_outcome_from_observation(observation_a, from_player_a_perspective=True)
        inverse_directional_outcome = resolve_outcome_from_observation(observation_b, from_player_a_perspective=False)

        if directional_outcome != "unknown" and inverse_directional_outcome != "unknown" and directional_outcome != inverse_directional_outcome:
            directional_conflict = True

        if outcome == "unknown":
            if directional_outcome != "unknown":
                outcome = directional_outcome
            elif inverse_directional_outcome != "unknown":
                outcome = inverse_directional_outcome

        pairing_quality = "paired" if observation_a and observation_b else "single-sided"
        if duplicate_observation_count > 0 or score_conflict or directional_conflict:
            pairing_quality = "conflict"

        if pairing_quality == "paired":
            paired_match_count += 1
        elif pairing_quality == "single-sided":
            single_sided_match_count += 1
        else:
            conflicting_match_count += 1

        winner_key = ""
        winner = ""
        if outcome == "player_a_win":
            winner_key = player_a_key
            winner = str(snapshot_a.get("player") or "")
        elif outcome == "player_b_win":
            winner_key = player_b_key
            winner = str(snapshot_b.get("player") or "")

        matches.append(
            {
                "event_id": event_id,
                "date": metadata.date,
                "event_type": metadata.event_type,
                "event": metadata.event,
                "event_display_name": event_display_name,
                "round": int(observations[0].get("round") or 0),
                "pair_key": pair_key,
                "player_a": str(snapshot_a.get("player") or ""),
                "player_a_key": player_a_key,
                "deck_a": str(snapshot_a.get("deck") or ""),
                "rank_a": parse_optional_int(snapshot_a.get("rank")),
                "final_standing_a": parse_optional_int(snapshot_a.get("final_standing")),
                "player_b": str(snapshot_b.get("player") or ""),
                "player_b_key": player_b_key,
                "deck_b": str(snapshot_b.get("deck") or ""),
                "rank_b": parse_optional_int(snapshot_b.get("rank")),
                "final_standing_b": parse_optional_int(snapshot_b.get("final_standing")),
                "games_a": games_a,
                "games_b": games_b,
                "games_drawn": games_drawn,
                "outcome": outcome,
                "winner_key": winner_key,
                "winner": winner,
                "pairing_quality": pairing_quality,
                "observation_count": len(observations),
                "unique_observation_count": len(observations_by_player),
                "duplicate_observation_count": duplicate_observation_count,
                "score_source": score_source,
                "source_workbook": source_workbook,
                "source_path": relative_workbook_path,
            }
        )

    event_summary = {
        "event_id": event_id,
        "date": metadata.date,
        "event_type": metadata.event_type,
        "event": metadata.event,
        "event_display_name": event_display_name,
        "source_workbook": source_workbook,
        "source_path": relative_workbook_path,
        "player_count": len(participant_lookup),
        "input_player_count": len(input_lookup),
        "round_observation_count": len(round_rows),
        "match_count": len(matches),
        "paired_match_count": paired_match_count,
        "single_sided_match_count": single_sided_match_count,
        "conflicting_match_count": conflicting_match_count,
        "bye_round_count": bye_round_count,
        "unresolved_round_count": unresolved_round_count,
    }

    round_rows.sort(
        key=lambda row: (
            str(row.get("date") or ""),
            str(row.get("event") or ""),
            int(row.get("round") or 0),
            str(row.get("player") or ""),
            str(row.get("opponent") or ""),
        )
    )
    matches.sort(
        key=lambda row: (
            str(row.get("date") or ""),
            str(row.get("event") or ""),
            int(row.get("round") or 0),
            str(row.get("player_a") or ""),
            str(row.get("player_b") or ""),
        )
    )

    return MatchupBuildResult(event_summary=event_summary, rounds=round_rows, matches=matches)


def load_existing_matchup_payload(matchup_json_path: Path) -> dict[str, object]:
    manifest_path = matchup_json_path / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        events_file = str(manifest.get("events_file") or "events.json")
        events_path = matchup_json_path / events_file
        events = json.loads(events_path.read_text(encoding="utf-8-sig")) if events_path.exists() else []
        rounds: list[dict[str, object]] = []
        matches: list[dict[str, object]] = []

        for year in list(manifest.get("years") or []):
            round_file = str((manifest.get("round_files_by_year") or {}).get(year) or "")
            match_file = str((manifest.get("match_files_by_year") or {}).get(year) or "")
            round_path = matchup_json_path / round_file if round_file else None
            match_path = matchup_json_path / match_file if match_file else None

            if round_path and round_path.exists():
                rounds.extend(json.loads(round_path.read_text(encoding="utf-8-sig")))
            if match_path and match_path.exists():
                matches.extend(json.loads(match_path.read_text(encoding="utf-8-sig")))

        return {
            "last_updated_date": str(manifest.get("last_updated_date") or ""),
            "events": list(events or []),
            "rounds": rounds,
            "matches": matches,
        }

    if LEGACY_MATCHUP_JSON_PATH.exists():
        payload = json.loads(LEGACY_MATCHUP_JSON_PATH.read_text(encoding="utf-8-sig"))
        return {
            "last_updated_date": str(payload.get("last_updated_date") or ""),
            "events": list(payload.get("events") or []),
            "rounds": list(payload.get("rounds") or []),
            "matches": list(payload.get("matches") or []),
        }

    return {
        "last_updated_date": "",
        "events": [],
        "rounds": [],
        "matches": [],
    }


def get_matchup_record_year(record: dict[str, object]) -> str:
    raw_date = str(record.get("date") or record.get("Date") or "").strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_date):
        return raw_date[:4]
    return "unknown"


def write_compact_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")


def write_compact_json_if_changed(path: Path, payload: object) -> bool:
    if path.exists():
        try:
            existing_payload = json.loads(path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            pass
        else:
            if existing_payload == payload:
                return False

    write_compact_json(path, payload)
    return True


def write_matchup_split_payload(
    matchup_json_path: Path,
    last_updated_date: str,
    events: list[dict[str, object]],
    rounds: list[dict[str, object]],
    matches: list[dict[str, object]],
) -> None:
    matchup_json_path.mkdir(parents=True, exist_ok=True)

    rounds_by_year: dict[str, list[dict[str, object]]] = {}
    matches_by_year: dict[str, list[dict[str, object]]] = {}

    for row in rounds:
        rounds_by_year.setdefault(get_matchup_record_year(row), []).append(row)

    for row in matches:
        matches_by_year.setdefault(get_matchup_record_year(row), []).append(row)

    years = sorted(set(rounds_by_year.keys()) | set(matches_by_year.keys()))
    desired_file_names = {"events.json", "manifest.json"}
    desired_file_names.update(f"rounds-{year}.json" for year in years)
    desired_file_names.update(f"matches-{year}.json" for year in years)

    for existing_file in matchup_json_path.glob("*.json"):
        if (
            existing_file.name == "manifest.json"
            or existing_file.name == "events.json"
            or existing_file.name.startswith("matches-")
            or existing_file.name.startswith("rounds-")
        ) and existing_file.name not in desired_file_names:
            existing_file.unlink()

    write_compact_json_if_changed(matchup_json_path / "events.json", events)

    for year in years:
        write_compact_json_if_changed(
            matchup_json_path / f"rounds-{year}.json",
            rounds_by_year.get(year, []),
        )
        write_compact_json_if_changed(
            matchup_json_path / f"matches-{year}.json",
            matches_by_year.get(year, []),
        )

    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "generated_from": "scripts/automatedpipeline/import-google-drive-folder.py",
        "last_updated_date": last_updated_date,
        "event_count": len(events),
        "round_count": len(rounds),
        "match_count": len(matches),
        "years": years,
        "events_file": "events.json",
        "round_files_by_year": {year: f"rounds-{year}.json" for year in years},
        "match_files_by_year": {year: f"matches-{year}.json" for year in years},
        "round_counts_by_year": {year: len(rounds_by_year.get(year, [])) for year in years},
        "match_counts_by_year": {year: len(matches_by_year.get(year, [])) for year in years},
    }
    write_compact_json_if_changed(matchup_json_path / "manifest.json", manifest)


def load_existing_js_dataset(js_data_path: Path) -> tuple[str, list[dict[str, object]]]:
    content = js_data_path.read_text(encoding="utf-8-sig")

    date_match = re.search(r'export const lastUpdatedDate = "([^"]+)";', content)
    data_match = re.search(r'export const cleanedData = (\[[\s\S]*\]);\s*$', content)
    if not date_match or not data_match:
        raise ValueError(f"Could not parse existing dataset from '{js_data_path}'.")

    return date_match.group(1), json.loads(data_match.group(1))


def load_existing_event_dataset(
    event_data_root: Path,
    legacy_js_data_path: Path | None = None,
) -> tuple[str, list[dict[str, object]]]:
    manifest_path = event_data_root / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        years = [str(year) for year in manifest.get("years", []) if str(year).strip()]
        rows: list[dict[str, object]] = []
        for year in years:
            relative_path = str(manifest.get("event_files_by_year", {}).get(year, "")).strip()
            if not relative_path:
                continue
            file_path = event_data_root / relative_path
            if not file_path.exists():
                continue
            payload = json.loads(file_path.read_text(encoding="utf-8-sig"))
            if isinstance(payload, list):
                rows.extend(payload)
        return str(manifest.get("last_updated_date") or ""), rows

    if legacy_js_data_path and legacy_js_data_path.exists():
        return load_existing_js_dataset(legacy_js_data_path)

    raise ValueError(
        f"Could not find an existing event dataset under '{event_data_root}'"
        + (f" or '{legacy_js_data_path}'." if legacy_js_data_path else ".")
    )


def write_event_split_payload(event_data_root: Path, last_updated_date: str, rows: list[dict[str, object]]) -> None:
    event_data_root.mkdir(parents=True, exist_ok=True)

    rows_by_year: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        year = str(row.get("Date") or "")[:4]
        if not year:
            continue
        rows_by_year.setdefault(year, []).append(row)

    years = sorted(rows_by_year.keys())
    desired_file_names = {"manifest.json"}
    desired_file_names.update(f"events-{year}.json" for year in years)

    for existing_file in event_data_root.iterdir():
        if existing_file.is_file() and (
            existing_file.name == "manifest.json" or existing_file.name.startswith("events-")
        ) and existing_file.name not in desired_file_names:
            existing_file.unlink()

    for year in years:
        write_compact_json_if_changed(
            event_data_root / f"events-{year}.json",
            rows_by_year.get(year, []),
        )

    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "generated_from": "scripts/automatedpipeline/import-google-drive-folder.py",
        "last_updated_date": last_updated_date,
        "row_count": len(rows),
        "years": years,
        "event_files_by_year": {year: f"events-{year}.json" for year in years},
        "event_counts_by_year": {year: len(rows_by_year.get(year, [])) for year in years},
    }
    write_compact_json_if_changed(event_data_root / "manifest.json", manifest)


def run_normalized_builder(builder_path: Path) -> None:
    subprocess.run(["node", str(builder_path)], check=True)


def main() -> int:
    args = parse_args()

    source_root = args.source_root.resolve()
    csv_root = args.csv_root.resolve()
    matchup_csv_root = args.matchup_csv_root.resolve()
    event_data_root = args.event_data_root.resolve()
    js_data_path = args.js_data_path.resolve()
    matchup_data_root = args.matchup_data_root.resolve()
    summary_path = args.summary_path.resolve()
    normalized_builder = args.normalized_builder.resolve()
    pipeline_overrides_path = args.pipeline_overrides_path.resolve() if args.pipeline_overrides_path else None

    if not source_root.exists():
        raise SystemExit(f"Google Drive source folder was not found at: {source_root}")

    workbooks = find_workbooks(source_root)
    if not workbooks:
        raise SystemExit(f"No .xlsx files were found under: {source_root}")

    excluded_relative_paths, metadata_overrides_by_relative_path = load_pipeline_overrides(pipeline_overrides_path)

    include_relative_paths = {path.strip() for path in args.include_relative_path if path.strip()}
    if include_relative_paths:
        workbooks = [
            path
            for path in workbooks
            if relative_posix(path, source_root) in include_relative_paths
        ]
        if not workbooks and not args.replace_existing_online:
            log("No workbooks matched the requested relative paths. Dataset unchanged.", quiet=args.quiet)
            return 0

    modified_since: datetime | None = None
    modified_date_after: date | None = None
    if args.modified_since:
        modified_since = parse_iso_timestamp(args.modified_since)
        workbooks = [path for path in workbooks if is_modified_after(path, modified_since)]
        if not workbooks and not args.replace_existing_online:
            log("No workbooks are newer than the requested cutoff. Dataset unchanged.", quiet=args.quiet)
            return 0
    if args.modified_date_after:
        modified_date_after = date.fromisoformat(args.modified_date_after)
        workbooks = [path for path in workbooks if is_modified_date_after(path, modified_date_after)]
        if not workbooks and not args.replace_existing_online:
            log("No workbooks have a modified date after the requested cutoff. Dataset unchanged.", quiet=args.quiet)
            return 0

    excluded_workbook_count = 0
    if excluded_relative_paths:
        filtered_workbooks: list[Path] = []
        for path in workbooks:
            relative_workbook_path = relative_posix(path, source_root)
            if relative_workbook_path in excluded_relative_paths:
                excluded_workbook_count += 1
                continue
            filtered_workbooks.append(path)
        workbooks = filtered_workbooks

    if not workbooks and not args.replace_existing_online:
        if excluded_workbook_count:
            log("All matching workbooks are excluded by pipeline overrides. Dataset unchanged.", quiet=args.quiet)
        else:
            log("No workbooks matched the current import filters. Dataset unchanged.", quiet=args.quiet)
        return 0

    for staging_root in (csv_root, matchup_csv_root):
        if staging_root.exists():
            shutil.rmtree(staging_root)
        staging_root.mkdir(parents=True, exist_ok=True)

    imported_workbooks: list[dict[str, object]] = []
    skipped: list[dict[str, str]] = []
    skipped_matchups: list[dict[str, str]] = []
    imported_matchup_workbooks = 0

    for index, workbook_path in enumerate(workbooks, start=1):
        relative_workbook_path = relative_posix(workbook_path, source_root)
        try:
            metadata = resolve_event_metadata(
                relative_workbook_path,
                workbook_path.name,
                args.include_incomplete,
                metadata_overrides_by_relative_path.get(relative_workbook_path),
            )
        except ValueError as exc:
            skipped.append({"relative_path": relative_workbook_path, "reason": str(exc)})
            continue
        if metadata is None:
            skipped.append(
                {
                    "relative_path": relative_workbook_path,
                    "reason": resolve_skip_reason(relative_workbook_path, workbook_path.name, args.include_incomplete),
                }
            )
            continue

        try:
            dataframe = extract_input_sheet(workbook_path, source_root)
        except Exception as exc:  # pragma: no cover - runtime IO safeguard
            skipped.append({"relative_path": relative_workbook_path, "reason": str(exc)})
            continue

        csv_path = write_staging_csv(dataframe, workbook_path, source_root, csv_root)
        normalize_below_top32(csv_path)

        try:
            input_rows = build_dataset_rows_from_csv(csv_path, metadata)
        except Exception as exc:  # pragma: no cover - runtime IO safeguard
            skipped.append({"relative_path": relative_workbook_path, "reason": str(exc)})
            continue

        workbook_record: dict[str, object] = {
            "workbook_path": workbook_path,
            "relative_path": relative_workbook_path,
            "metadata": metadata,
            "event_id": build_event_id(metadata.event, metadata.event_type, metadata.date),
            "csv_path": csv_path,
            "input_rows": input_rows,
        }

        try:
            matchup_dataframe = extract_matchup_sheet(workbook_path, source_root)
            matchup_csv_path = write_staging_csv(matchup_dataframe, workbook_path, source_root, matchup_csv_root)
            workbook_record["matchup_csv_path"] = matchup_csv_path
            workbook_record["matchup_result"] = build_matchup_dataset(
                matchup_dataframe,
                metadata,
                relative_workbook_path,
                input_rows,
            )
            imported_matchup_workbooks += 1
        except Exception as exc:
            skipped_matchups.append({"relative_path": relative_workbook_path, "reason": str(exc)})

        imported_workbooks.append(workbook_record)

        if not args.quiet and index % 25 == 0:
            print(f"Processed {index} of {len(workbooks)} workbooks...")

    _, existing_rows = load_existing_event_dataset(event_data_root, js_data_path)
    existing_matchup_payload = load_existing_matchup_payload(matchup_data_root)
    offline_rows = [row for row in existing_rows if row.get("EventType") == "offline"]
    existing_online_rows = [row for row in existing_rows if row.get("EventType") == "online"]

    online_rows: list[dict[str, object]] = []
    seen_keys: set[tuple[object, ...]] = set()
    duplicate_dataset_rows = 0

    for workbook_record in imported_workbooks:
        for row in workbook_record["input_rows"]:
            key = (
                row["Date"],
                row["EventType"],
                row["Event"],
                row["Rank"],
                row["Player"],
                row["Deck"],
                row["Wins"],
                row["Losses"],
            )
            if key in seen_keys:
                duplicate_dataset_rows += 1
                continue
            seen_keys.add(key)
            online_rows.append(row)

    replaced_event_keys = {
        (row["Date"], row["EventType"], row["Event"])
        for row in online_rows
    }
    if args.replace_existing_online:
        preserved_existing_online_rows = []
    else:
        preserved_existing_online_rows = [
            row
            for row in existing_online_rows
            if (row.get("Date"), row.get("EventType"), row.get("Event")) not in replaced_event_keys
        ]

    combined_rows = sorted(
        [*preserved_existing_online_rows, *online_rows, *offline_rows],
        key=lambda row: (
            str(row["Date"]),
            str(row["EventType"]),
            str(row["Event"]),
            int(row["Rank"]),
            str(row["Player"]),
        ),
    )

    last_updated_date = date.today().isoformat()
    write_event_split_payload(event_data_root, last_updated_date, combined_rows)

    reimported_matchup_event_ids = {
        str(workbook_record.get("event_id") or "")
        for workbook_record in imported_workbooks
        if workbook_record.get("event_id")
    }
    new_matchup_events = [
        workbook_record["matchup_result"].event_summary
        for workbook_record in imported_workbooks
        if workbook_record.get("matchup_result")
    ]
    new_matchup_rounds = [
        round_row
        for workbook_record in imported_workbooks
        if workbook_record.get("matchup_result")
        for round_row in workbook_record["matchup_result"].rounds
    ]
    new_matchup_matches = [
        match_row
        for workbook_record in imported_workbooks
        if workbook_record.get("matchup_result")
        for match_row in workbook_record["matchup_result"].matches
    ]

    if args.replace_existing_online:
        preserved_matchup_events = []
        preserved_matchup_rounds = []
        preserved_matchup_matches = []
    else:
        preserved_matchup_events = [
            event_summary
            for event_summary in existing_matchup_payload["events"]
            if str(event_summary.get("event_id") or "") not in reimported_matchup_event_ids
        ]
        preserved_matchup_rounds = [
            round_row
            for round_row in existing_matchup_payload["rounds"]
            if str(round_row.get("event_id") or "") not in reimported_matchup_event_ids
        ]
        preserved_matchup_matches = [
            match_row
            for match_row in existing_matchup_payload["matches"]
            if str(match_row.get("event_id") or "") not in reimported_matchup_event_ids
        ]

    combined_matchup_events = sorted(
        [*preserved_matchup_events, *new_matchup_events],
        key=lambda row: (
            str(row.get("date") or ""),
            str(row.get("event") or ""),
            str(row.get("source_path") or ""),
        ),
    )
    combined_matchup_rounds = sorted(
        [*preserved_matchup_rounds, *new_matchup_rounds],
        key=lambda row: (
            str(row.get("date") or ""),
            str(row.get("event") or ""),
            int(row.get("round") or 0),
            str(row.get("player") or ""),
            str(row.get("opponent") or ""),
        ),
    )
    combined_matchup_matches = sorted(
        [*preserved_matchup_matches, *new_matchup_matches],
        key=lambda row: (
            str(row.get("date") or ""),
            str(row.get("event") or ""),
            int(row.get("round") or 0),
            str(row.get("player_a") or ""),
            str(row.get("player_b") or ""),
        ),
    )

    write_matchup_split_payload(
        matchup_data_root,
        last_updated_date,
        combined_matchup_events,
        combined_matchup_rounds,
        combined_matchup_matches,
    )

    if not args.skip_normalized_build:
        run_normalized_builder(normalized_builder)

    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_root": source_root.as_posix(),
        "workbook_count": len(workbooks),
        "imported_workbooks": len(imported_workbooks),
        "skipped_workbooks": len(skipped),
        "csv_written": len(imported_workbooks),
        "matchup_csv_written": imported_matchup_workbooks,
        "online_rows": len(online_rows),
        "preserved_existing_online_rows": len(preserved_existing_online_rows),
        "preserved_offline_rows": len(offline_rows),
        "combined_rows": len(combined_rows),
        "duplicate_dataset_rows": duplicate_dataset_rows,
        "matchup_events": len(combined_matchup_events),
        "matchup_rounds": len(combined_matchup_rounds),
        "matchup_matches": len(combined_matchup_matches),
        "preserved_existing_matchup_events": len(preserved_matchup_events),
        "preserved_existing_matchup_rounds": len(preserved_matchup_rounds),
        "preserved_existing_matchup_matches": len(preserved_matchup_matches),
        "skipped_matchup_workbooks": len(skipped_matchups),
        "modified_since": args.modified_since,
        "modified_date_after": args.modified_date_after,
        "pipeline_overrides_path": str(pipeline_overrides_path) if pipeline_overrides_path else "",
        "excluded_relative_paths_count": len(excluded_relative_paths),
        "excluded_workbooks": excluded_workbook_count,
        "metadata_overrides_count": len(metadata_overrides_by_relative_path),
        "replace_existing_online": args.replace_existing_online,
        "skipped": skipped,
        "skipped_matchups": skipped_matchups,
    }
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    log("Google Drive import completed.", quiet=args.quiet)
    log(f"- workbooks discovered: {len(workbooks)}", quiet=args.quiet)
    log(f"- workbooks imported: {len(imported_workbooks)}", quiet=args.quiet)
    log(f"- workbooks skipped: {len(skipped)}", quiet=args.quiet)
    log(f"- workbooks excluded by overrides: {excluded_workbook_count}", quiet=args.quiet)
    log(f"- csv files written: {len(imported_workbooks)}", quiet=args.quiet)
    log(f"- matchup csv files written: {imported_matchup_workbooks}", quiet=args.quiet)
    log(f"- online rows imported: {len(online_rows)}", quiet=args.quiet)
    log(f"- offline rows preserved: {len(offline_rows)}", quiet=args.quiet)
    log(f"- combined rows written to data/events: {len(combined_rows)}", quiet=args.quiet)
    log(f"- matchup events written: {len(combined_matchup_events)}", quiet=args.quiet)
    log(f"- matchup rounds written: {len(combined_matchup_rounds)}", quiet=args.quiet)
    log(f"- matchup matches written: {len(combined_matchup_matches)}", quiet=args.quiet)
    log(f"- matchup data root: {matchup_data_root}", quiet=args.quiet)
    log(f"- summary: {summary_path}", quiet=args.quiet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
