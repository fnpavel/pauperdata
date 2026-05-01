#!/usr/bin/env python3
"""Sync missing Google Drive workbooks, rebuild project data, and refresh the site thumbnail."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from pipeline_common import (
    PROCESSED_DRIVE_WORKBOOKS_PATH,
    PIPELINE_OVERRIDES_PATH,
    archive_relative_path_candidates,
    build_drive_service,
    current_branch,
    download_drive_file,
    get_drive_request_metrics,
    inspect_workbook_readiness,
    list_archive_relative_paths,
    list_drive_files,
    load_json_file,
    load_state,
    load_settings,
    log,
    reset_drive_request_metrics,
    resolve_archive_relative_path,
    run_git,
    run_subprocess,
    save_state,
)

PIPELINE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SUMMARY_PATH = PIPELINE_ROOT / "pipeline-run-summary.json"
EXTRACT_SCRIPT = PIPELINE_ROOT / "extract_input_csv.py"
REBUILD_SCRIPT = PIPELINE_ROOT / "rebuild_event_matchup_data.py"
MATCHUP_SPLIT_BUILD_SCRIPT = PIPELINE_ROOT / "build-matchup-split-data.mjs"
ELO_BUILD_SCRIPT = PIPELINE_ROOT / "build-elo-data.mjs"
PUBLISH_SCRIPT = PIPELINE_ROOT / "publish_pipeline_changes.py"
ELO_MANIFEST_PATH = PROJECT_ROOT / "data" / "elo-data" / "manifest.js"
THUMBNAIL_UPDATE_SCRIPT = PIPELINE_ROOT / "update-thumbnail.mjs"
THUMBNAIL_OUTPUT_PATH = PROJECT_ROOT / "thumbnail.png"
EVENTS_PATH = PROJECT_ROOT / "data" / "events.json"

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
DATE_PREFIX_PATTERN = re.compile(
    r"^(?P<day>\d{1,2})\s+(?P<month>[A-Za-z]+)\s+[' _]?(?P<year>\d{2})\b"
)

COMMAND_NAMES = {
    "sync",
    "sync-local",
    "list",
    "download",
    "exclude",
    "include",
    "override-date",
    "clear-override-date",
    "rebuild",
    "rebuild-local",
}


@dataclass
class PipelineOverrides:
    excluded_relative_paths: set[str]
    metadata_overrides_by_relative_path: dict[str, dict[str, str]]


@dataclass(frozen=True)
class LocalArchiveRecord:
    relative_path: str
    archive_path: Path
    workbook_name: str
    modified_time: datetime


@dataclass(frozen=True)
class DriveArchiveRecord:
    drive_file: Any
    relative_path: str
    workbook_name: str
    modified_time: datetime
    local_exists: bool


@dataclass(frozen=True)
class CandidateEventInfo:
    relative_path: str
    workbook_name: str
    event_id: str
    source_event_name: str
    event_date: str


PROCESSED_DRIVE_WORKBOOKS_SCHEMA_VERSION = 1


def normalize_relative_path(value: object) -> str:
    return str(value or "").replace("\\", "/").lstrip("./").strip()


def normalize_whitespace(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def slugify(value: object) -> str:
    return re.sub(
        r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", normalize_whitespace(value).lower())
    )


def normalize_year_selector(value: object) -> str:
    raw_value = normalize_whitespace(value)
    if not re.fullmatch(r"\d{4}", raw_value):
        raise SystemExit(
            f"Invalid year selector '{raw_value}'. Expected YYYY, for example 2026."
        )
    return raw_value


def normalize_month_selector(value: object) -> str:
    raw_value = normalize_whitespace(value).replace("/", "-")
    match = re.fullmatch(r"(?P<year>\d{4})-(?P<month>\d{1,2})", raw_value)
    if not match:
        raise SystemExit(
            f"Invalid month selector '{raw_value}'. Expected YYYY-MM, for example 2026-04."
        )
    month_value = int(match.group("month"))
    if month_value < 1 or month_value > 12:
        raise SystemExit(
            f"Invalid month selector '{raw_value}'. Expected a month between 01 and 12."
        )
    return f"{match.group('year')}-{month_value:02d}"


def resolve_candidate_event_info(
    relative_path: str,
    workbook_name: str,
    overrides: PipelineOverrides,
) -> CandidateEventInfo | None:
    normalized_relative_path = normalize_relative_path(relative_path)
    if not normalized_relative_path or "[Incomplete]" in workbook_name:
        return None

    base_name = Path(workbook_name).stem
    date_match = DATE_PREFIX_PATTERN.match(base_name)
    if not date_match:
        return None

    month_name = date_match.group("month")
    if month_name not in MONTH_NUMBERS:
        return None

    parsed_date = f"20{date_match.group('year')}-{MONTH_NUMBERS[month_name]}-{date_match.group('day').zfill(2)}"

    if "Championship Week Finals" in base_name:
        event_display_name = "Championship Week Finals"
    elif "Showcase" in base_name:
        event_display_name = "Showcase"
    elif "Challenge 64" in base_name:
        event_display_name = "Challenge 64"
    elif "Super Qualifier" in base_name:
        event_display_name = "Super"
    elif "Qualifier" in base_name:
        event_display_name = "Qualifier"
    elif "Challenge 32" in base_name:
        event_display_name = "Challenge"
    else:
        return None

    override_date = (
        overrides.metadata_overrides_by_relative_path.get(
            normalized_relative_path, {}
        ).get("date")
        or ""
    ).strip()
    event_date = override_date or parsed_date
    try:
        date.fromisoformat(event_date)
    except ValueError as exc:
        raise SystemExit(
            f"Invalid override date '{event_date}' for '{normalized_relative_path}'. Expected YYYY-MM-DD."
        ) from exc

    source_event_name = f"MTGO {event_display_name} ({event_date})"
    event_id = f"online-{slugify(event_display_name)}-{event_date}"
    return CandidateEventInfo(
        relative_path=normalized_relative_path,
        workbook_name=workbook_name,
        event_id=event_id,
        source_event_name=source_event_name,
        event_date=event_date,
    )


def load_latest_online_event() -> dict[str, str] | None:
    if not EVENTS_PATH.exists():
        return None

    try:
        payload = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, list):
        return None

    online_rows = [
        row
        for row in payload
        if isinstance(row, dict)
        and normalize_whitespace(row.get("event_type")).lower() == "online"
        and normalize_whitespace(row.get("event_id"))
        and normalize_whitespace(row.get("date"))
    ]
    if not online_rows:
        return None

    latest_event = max(
        online_rows,
        key=lambda row: (
            normalize_whitespace(row.get("date")),
            normalize_whitespace(row.get("event_id")),
        ),
    )
    return {
        "event_id": normalize_whitespace(latest_event.get("event_id")),
        "date": normalize_whitespace(latest_event.get("date")),
        "source_event_name": normalize_whitespace(
            latest_event.get("source_event_name")
            or latest_event.get("display_name")
            or latest_event.get("event_id")
        ),
    }


def confirm_duplicate_latest_event(
    candidates: list[CandidateEventInfo],
    *,
    assume_yes: bool,
) -> None:
    latest_event = load_latest_online_event()
    if latest_event is None:
        return

    duplicates = [
        candidate
        for candidate in candidates
        if candidate.event_id == latest_event["event_id"]
    ]
    if not duplicates:
        return

    log("The selected workbook(s) resolve to the current latest online event.")
    log(f"- latest event id: {latest_event['event_id']}")
    log(f"- latest event name: {latest_event['source_event_name']}")
    log(f"- latest event date: {latest_event['date']}")
    for candidate in duplicates:
        log(f"- selected workbook: {candidate.workbook_name}")
        log(f"  relative path: {candidate.relative_path}")
        log(f"  resolved event: {candidate.source_event_name}")

    if assume_yes:
        log("Proceeding because --yes was provided.")
        return

    if not sys.stdin.isatty():
        raise SystemExit(
            "Sync cancelled because a selected workbook matches the current latest online event.\n"
            "Re-run interactively to confirm, or pass --yes if you want to proceed without prompting."
        )

    response = input("Proceed with syncing anyway? [y/N]: ").strip().lower()
    if response not in {"y", "yes"}:
        raise SystemExit("Sync cancelled by user.")


class PipelineHelpFormatter(argparse.RawTextHelpFormatter):
    """Preserve multi-line examples in CLI help output."""


def parse_args() -> argparse.Namespace:
    raw_args = list(sys.argv[1:])
    if not raw_args:
        raw_args = ["sync"]
    elif raw_args[0].startswith("-") and raw_args[0] not in {"-h", "--help"}:
        raw_args = ["sync", *raw_args]

    parser = argparse.ArgumentParser(
        description=(
            "Sync Google Drive workbooks into the local archive, rebuild event and matchup data, "
            "regenerate Elo, and refresh the site thumbnail.\n\n"
            "Run '<command> --help' for command-specific examples."
        ),
        epilog=(
            "Examples:\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync --force-redownload\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local --latest\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py download --match "18 April"\n'
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild-local --full"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    sync_parser = subparsers.add_parser(
        "sync",
        help="Download missing Drive workbooks and run the normal incremental rebuild.",
        description=(
            "Download missing workbooks from Google Drive into the local archive, then extract, rebuild, "
            "regenerate Elo, refresh the Discord log, and refresh the site thumbnail.\n\n"
            "If a selected workbook resolves to the same event as the current latest online event, the "
            "script will ask before continuing unless you pass --yes."
        ),
        epilog=(
            "Examples:\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync --force-redownload\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync --yes"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    sync_parser.add_argument(
        "--ignore_cutoff",
        action="store_true",
        help="Ignore cutoff validation and force execution"
    )
    sync_parser.add_argument(
        "--force-redownload",
        action="store_true",
        help=(
            "Redownload and process one workbook even if it already exists in the local archive. "
            "This prefers the last archive-matched workbook from pipeline state, then falls back "
            "to the latest Drive workbook."
        ),
    )
    sync_parser.add_argument(
        "--yes",
        action="store_true",
        help="Proceed without prompting if a selected workbook resolves to the current latest online event.",
    )
    sync_parser.add_argument(
        "--skip-publish",
        action="store_true",
        help=(
            "Run the full sync, extraction, rebuild, thumbnail refresh, and manifest update without "
            "switching branches or publishing git changes."
        ),
    )

    sync_local_parser = subparsers.add_parser(
        "sync-local",
        help=(
            "Select workbook inputs directly from the local dataGoogleDrive archive, then run the normal "
            "extract and incremental rebuild flow."
        ),
        description=(
            "Use local workbooks already present in dataGoogleDrive instead of calling Google Drive.\n\n"
            "With no selector, this command defaults to local workbooks that are missing a matching "
            "extracted CSV under the configured extracted-output root.\n\n"
            "If a selected workbook resolves to the same event as the current latest online event, the "
            "script will ask before continuing unless you pass --yes."
        ),
        epilog=(
            "Examples:\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local --latest\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local --year 2026\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local --month 2026-04\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local --match "18 April"\n'
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local --relative-path "2026/04 - April/18 April _26 Pauper Challenge 32 Matchups.xlsx"\n'
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local --latest --yes"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    sync_local_group = sync_local_parser.add_mutually_exclusive_group(required=False)
    sync_local_group.add_argument(
        "--match",
        default="",
        help="Case-insensitive substring against the local workbook name or relative path.",
    )
    sync_local_group.add_argument(
        "--relative-path",
        default="",
        help="Exact archive-relative POSIX path such as 2026/04 - April/example.xlsx.",
    )
    sync_local_group.add_argument(
        "--year",
        default="",
        help="Sync all local workbooks under one year folder, for example 2026.",
    )
    sync_local_group.add_argument(
        "--month",
        default="",
        help="Sync all local workbooks under one month folder, for example 2026-04.",
    )
    sync_local_group.add_argument(
        "--latest",
        action="store_true",
        help="Sync only the newest local workbook from dataGoogleDrive, even if it was already extracted before.",
    )
    sync_local_group.add_argument(
        "--missing",
        action="store_true",
        help=(
            "Sync local workbooks that do not yet have a matching extracted CSV. "
            "This is the default when no selector is provided."
        ),
    )
    sync_local_parser.add_argument(
        "--yes",
        action="store_true",
        help="Proceed without prompting if a selected workbook resolves to the current latest online event.",
    )

    list_parser = subparsers.add_parser(
        "list",
        help="List local archive entries, or query Drive entries with --drive.",
        description=(
            "List local archive workbooks by default, or list Drive-backed workbooks with --drive.\n\n"
            "This is the safest command to use first when you want to find an exact selector."
        ),
        epilog=(
            "Examples:\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py list\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py list --latest\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py list --match "18 April"\n'
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py list --drive --match "18 April"'
        ),
        formatter_class=PipelineHelpFormatter,
    )
    add_selection_arguments(list_parser, require_selector=False, allow_latest=True)
    list_parser.add_argument(
        "--drive",
        action="store_true",
        help="List Drive-backed entries instead of only the local workbook archive.",
    )
    list_parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="How many rows to print. Defaults to 20.",
    )

    download_parser = subparsers.add_parser(
        "download",
        help="Download one specific Drive workbook into the local archive without rebuilding.",
        description=(
            "Download one specific workbook from Google Drive into dataGoogleDrive without running the rebuild.\n\n"
            "Use 'list --drive' first if you need to confirm the selector. After download, run "
            "'rebuild --full' or 'rebuild-local --full' when you want the generated dataset refreshed."
        ),
        epilog=(
            "Examples:\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py download --latest\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py download --match "18 April \'26 Pauper Challenge 32 Matchups"\n'
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py download --relative-path "2026/04 - April/18 April _26 Pauper Challenge 32 Matchups.xlsx"\n'
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py download --match "18 April" --redownload'
        ),
        formatter_class=PipelineHelpFormatter,
    )
    add_selection_arguments(download_parser, require_selector=True, allow_latest=True)
    download_parser.add_argument(
        "--redownload",
        action="store_true",
        help="Replace the local archive copy if the selected workbook already exists.",
    )

    exclude_parser = subparsers.add_parser(
        "exclude",
        help="Exclude one local archive workbook from future rebuilds without deleting the .xlsx file.",
        description=(
            "Soft-delete one local workbook from future rebuilds.\n\n"
            "The .xlsx file stays in dataGoogleDrive; only the rebuild pipeline stops using it."
        ),
        epilog=(
            "Examples:\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py exclude --match "17 April"\n'
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py exclude --relative-path "2026/04 - April/17 April _26 Pauper Challenge 32 Matchups.xlsx"\n'
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild --full"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    add_selection_arguments(exclude_parser, require_selector=True, allow_latest=True)

    include_parser = subparsers.add_parser(
        "include",
        help="Remove a local archive workbook from the exclude list.",
        description=(
            "Undo a previous exclude so the local workbook is used again during rebuilds."
        ),
        epilog=(
            "Examples:\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py include --match "17 April"\n'
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild --full"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    add_selection_arguments(include_parser, require_selector=True, allow_latest=True)

    override_parser = subparsers.add_parser(
        "override-date",
        help="Override the effective event date for one local archive workbook.",
        description=(
            "Override the event date used when importing one local workbook.\n\n"
            "This changes the effective date in generated data without renaming the .xlsx file on disk."
        ),
        epilog=(
            "Examples:\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py override-date --match "18 April" --date 2026-04-19\n'
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py clear-override-date --match "18 April"\n'
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild-local --full"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    add_selection_arguments(override_parser, require_selector=True, allow_latest=True)
    override_parser.add_argument(
        "--date",
        required=True,
        help="Replacement event date in YYYY-MM-DD format.",
    )

    clear_override_parser = subparsers.add_parser(
        "clear-override-date",
        help="Remove a previously saved event-date override.",
        description=(
            "Remove a saved date override so the workbook goes back to using the date parsed from its filename."
        ),
        epilog=(
            "Examples:\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py clear-override-date --match "18 April"\n'
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild-local --full"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    add_selection_arguments(
        clear_override_parser, require_selector=True, allow_latest=True
    )

    rebuild_parser = subparsers.add_parser(
        "rebuild",
        help="Rebuild all online data from the local archive, honoring excludes and date overrides.",
        description=(
            "Fully rebuild online event data, matchup data, Elo, and the site thumbnail from local workbooks.\n\n"
            "This honors pipeline-overrides.json and does not call Google Drive."
        ),
        epilog=(
            "Examples:\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild --full\n"
            '  python .\\pipeline\\sync_drive_and_rebuild_all.py exclude --match "17 April"\n'
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild --full"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    rebuild_parser.add_argument(
        "--full",
        action="store_true",
        help="Accepted for readability. This command always performs a full online rebuild.",
    )

    rebuild_local_parser = subparsers.add_parser(
        "rebuild-local",
        help="Explicit alias for rebuilding all online data from the local workbook archive.",
        description=(
            "Alias for the full local rebuild path.\n\n"
            "This is functionally the same as 'rebuild --full', but named to make the source of truth explicit."
        ),
        epilog=(
            "Examples:\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild-local --full\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py sync-local --latest\n"
            "  python .\\pipeline\\sync_drive_and_rebuild_all.py rebuild-local --full"
        ),
        formatter_class=PipelineHelpFormatter,
    )
    rebuild_local_parser.add_argument(
        "--full",
        action="store_true",
        help="Accepted for readability. This command always performs a full online rebuild.",
    )

    return parser.parse_args(raw_args)


def add_selection_arguments(
    parser: argparse.ArgumentParser,
    *,
    require_selector: bool,
    allow_latest: bool,
) -> None:
    selector_group = parser.add_mutually_exclusive_group(required=require_selector)
    selector_group.add_argument(
        "--match",
        default="",
        help="Case-insensitive substring against the workbook name or relative path.",
    )
    selector_group.add_argument(
        "--relative-path",
        default="",
        help="Exact archive-relative POSIX path such as 2026/04 - April/example.xlsx.",
    )
    if allow_latest:
        selector_group.add_argument(
            "--latest",
            action="store_true",
            help="Target the most recent entry in the selected scope.",
        )


def default_overrides() -> PipelineOverrides:
    return PipelineOverrides(
        excluded_relative_paths=set(), metadata_overrides_by_relative_path={}
    )


def load_pipeline_overrides() -> PipelineOverrides:
    payload = load_json_file(PIPELINE_OVERRIDES_PATH, default={})
    if not isinstance(payload, dict):
        raise SystemExit(
            f"Pipeline overrides file must contain a JSON object: {PIPELINE_OVERRIDES_PATH}"
        )

    overrides = default_overrides()
    raw_excluded = payload.get("excluded_relative_paths")
    if isinstance(raw_excluded, list):
        for item in raw_excluded:
            normalized_path = normalize_relative_path(item)
            if normalized_path:
                overrides.excluded_relative_paths.add(normalized_path)

    raw_metadata = payload.get("metadata_overrides_by_relative_path")
    if isinstance(raw_metadata, dict):
        for key, value in raw_metadata.items():
            normalized_path = normalize_relative_path(key)
            if not normalized_path or not isinstance(value, dict):
                continue
            normalized_override: dict[str, str] = {}
            override_date = str(value.get("date") or "").strip()
            if override_date:
                normalized_override["date"] = override_date
            if normalized_override:
                overrides.metadata_overrides_by_relative_path[normalized_path] = (
                    normalized_override
                )

    return overrides


def save_pipeline_overrides(overrides: PipelineOverrides) -> None:
    payload = {
        "schema_version": 1,
        "excluded_relative_paths": sorted(overrides.excluded_relative_paths),
        "metadata_overrides_by_relative_path": {
            relative_path: dict(
                overrides.metadata_overrides_by_relative_path[relative_path]
            )
            for relative_path in sorted(overrides.metadata_overrides_by_relative_path)
        },
    }
    PIPELINE_OVERRIDES_PATH.write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )


def load_elo_manifest_snapshot() -> dict[str, object]:
    if not ELO_MANIFEST_PATH.exists():
        return {}

    raw_text = ELO_MANIFEST_PATH.read_text(encoding="utf-8")
    prefix = "export const eloManifest = "
    if not raw_text.startswith(prefix):
        return {}

    manifest_text = raw_text[len(prefix) :].strip()
    if manifest_text.endswith(";"):
        manifest_text = manifest_text[:-1]

    try:
        manifest = json.loads(manifest_text)
    except json.JSONDecodeError:
        return {}

    return {
        "manifest_path": str(ELO_MANIFEST_PATH),
        "generated_at": manifest.get("generatedAt"),
        "last_updated_at": manifest.get("lastUpdatedAt"),
        "last_updated_date": manifest.get("lastUpdatedDate"),
        "total_match_count": manifest.get("totalMatchCount"),
        "years": manifest.get("years"),
        "match_counts_by_year": manifest.get("matchCountsByYear"),
    }


def load_thumbnail_snapshot() -> dict[str, object]:
    if not THUMBNAIL_OUTPUT_PATH.exists():
        return {}

    stats = THUMBNAIL_OUTPUT_PATH.stat()
    return {
        "thumbnail_path": str(THUMBNAIL_OUTPUT_PATH),
        "updated_at": datetime.fromtimestamp(stats.st_mtime).isoformat(
            timespec="seconds"
        ),
        "size_bytes": stats.st_size,
    }


def list_local_archive_records(archive_root: Path) -> list[LocalArchiveRecord]:
    if not archive_root.exists():
        return []

    records: list[LocalArchiveRecord] = []
    for path in archive_root.rglob("*.xlsx"):
        if not path.is_file():
            continue
        stats = path.stat()
        records.append(
            LocalArchiveRecord(
                relative_path=path.relative_to(archive_root).as_posix(),
                archive_path=path,
                workbook_name=path.name,
                modified_time=datetime.fromtimestamp(stats.st_mtime),
            )
        )

    return sorted(
        records,
        key=lambda record: (record.modified_time, record.relative_path),
        reverse=True,
    )


def build_drive_records(
    drive_files: list[object], settings, archive_paths: set[str]
) -> list[DriveArchiveRecord]:
    records: list[DriveArchiveRecord] = []
    for drive_file in reversed(drive_files):
        archive_relative = resolve_archive_relative_path(
            drive_file, settings.archive_root, archive_paths
        ).as_posix()
        records.append(
            DriveArchiveRecord(
                drive_file=drive_file,
                relative_path=archive_relative,
                workbook_name=drive_file.export_name,
                modified_time=drive_file.modified_time,
                local_exists=archive_relative in archive_paths,
            )
        )
    return records


def is_drive_file_excluded(drive_file: object, overrides: PipelineOverrides) -> bool:
    return any(
        candidate.as_posix() in overrides.excluded_relative_paths
        for candidate in archive_relative_path_candidates(drive_file)
    )


def match_drive_file_by_relative_path(relative_path: str, drive_files: list[object]):
    normalized_relative_path = normalize_relative_path(relative_path)
    if not normalized_relative_path:
        return None

    for drive_file in drive_files:
        if any(
            candidate.as_posix() == normalized_relative_path
            for candidate in archive_relative_path_candidates(drive_file)
        ):
            return drive_file

    return None


def resolve_force_redownload_target(
    drive_files: list[object], state: dict[str, object]
) -> tuple[object | None, str]:
    state_relative_path = str(
        state.get("downloaded_relative_path")
        or state.get("archive_relative_path")
        or ""
    ).strip()
    if state_relative_path:
        matched_drive_file = match_drive_file_by_relative_path(
            state_relative_path, drive_files
        )
        if matched_drive_file is not None:
            return matched_drive_file, "state"

    if drive_files:
        return drive_files[-1], "latest"

    return None, ""


def select_local_records(
    records: list[LocalArchiveRecord],
    *,
    match: str,
    relative_path: str,
    latest: bool,
) -> list[LocalArchiveRecord]:
    selected = list(records)
    normalized_relative_path = normalize_relative_path(relative_path)
    if normalized_relative_path:
        selected = [
            record
            for record in selected
            if record.relative_path == normalized_relative_path
        ]
    elif match.strip():
        needle = match.casefold()
        selected = [
            record
            for record in selected
            if needle in record.relative_path.casefold()
            or needle in record.workbook_name.casefold()
        ]

    if latest:
        return selected[:1]
    return selected


def build_extracted_csv_path(extracted_root: Path, relative_path: str) -> Path:
    return extracted_root / Path(relative_path).with_suffix(".csv")


def is_local_record_missing_extracted_csv(settings, record: LocalArchiveRecord) -> bool:
    return not build_extracted_csv_path(
        settings.extracted_root, record.relative_path
    ).exists()


def record_matches_year(record: LocalArchiveRecord, year_value: str) -> bool:
    return record.relative_path.startswith(f"{year_value}/")


def record_matches_month(record: LocalArchiveRecord, month_value: str) -> bool:
    year_value, month_number = month_value.split("-", 1)
    relative_parts = Path(record.relative_path).parts
    if len(relative_parts) < 2:
        return False
    return relative_parts[0] == year_value and relative_parts[1].startswith(
        f"{month_number} -"
    )


def resolve_local_sync_selection(
    records: list[LocalArchiveRecord],
    *,
    settings,
    overrides: PipelineOverrides,
    match: str,
    relative_path: str,
    year: str,
    month: str,
    latest: bool,
    missing: bool,
) -> tuple[list[LocalArchiveRecord], str, list[LocalArchiveRecord]]:
    available_records = [
        record
        for record in records
        if record.relative_path not in overrides.excluded_relative_paths
    ]
    missing_records = [
        record
        for record in available_records
        if is_local_record_missing_extracted_csv(settings, record)
    ]

    if normalize_relative_path(relative_path):
        return (
            select_local_records(
                available_records,
                match="",
                relative_path=relative_path,
                latest=False,
            ),
            "relative-path",
            missing_records,
        )

    if match.strip():
        return (
            select_local_records(
                available_records,
                match=match,
                relative_path="",
                latest=False,
            ),
            "match",
            missing_records,
        )

    if year.strip():
        normalized_year = normalize_year_selector(year)
        return (
            [
                record
                for record in available_records
                if record_matches_year(record, normalized_year)
            ],
            f"year:{normalized_year}",
            missing_records,
        )

    if month.strip():
        normalized_month = normalize_month_selector(month)
        return (
            [
                record
                for record in available_records
                if record_matches_month(record, normalized_month)
            ],
            f"month:{normalized_month}",
            missing_records,
        )

    if latest:
        return available_records[:1], "latest", missing_records

    return missing_records, "missing", missing_records


def build_candidate_events_from_drive_files(
    selected_files: list[object],
    *,
    settings,
    archive_paths: set[str],
    overrides: PipelineOverrides,
) -> list[CandidateEventInfo]:
    candidates: list[CandidateEventInfo] = []
    for drive_file in selected_files:
        relative_path = resolve_archive_relative_path(
            drive_file, settings.archive_root, archive_paths
        ).as_posix()
        candidate = resolve_candidate_event_info(
            relative_path, drive_file.export_name, overrides
        )
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def build_candidate_events_from_local_records(
    records: list[LocalArchiveRecord],
    overrides: PipelineOverrides,
) -> list[CandidateEventInfo]:
    candidates: list[CandidateEventInfo] = []
    for record in records:
        candidate = resolve_candidate_event_info(
            record.relative_path, record.workbook_name, overrides
        )
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def select_drive_records(
    records: list[DriveArchiveRecord],
    *,
    match: str,
    relative_path: str,
    latest: bool,
) -> list[DriveArchiveRecord]:
    selected = list(records)
    normalized_relative_path = normalize_relative_path(relative_path)
    if normalized_relative_path:
        selected = [
            record
            for record in selected
            if record.relative_path == normalized_relative_path
        ]
    elif match.strip():
        needle = match.casefold()
        selected = [
            record
            for record in selected
            if needle in record.relative_path.casefold()
            or needle in record.workbook_name.casefold()
        ]

    if latest:
        return selected[:1]
    return selected


def format_timestamp(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def describe_local_record(record: LocalArchiveRecord) -> str:
    return f"- {record.workbook_name} [{record.relative_path}] modified {format_timestamp(record.modified_time)}"


def describe_drive_record(record: DriveArchiveRecord) -> str:
    local_label = "yes" if record.local_exists else "no"
    return (
        f"- {record.workbook_name} [{record.relative_path}] modified {format_timestamp(record.modified_time)} "
        f"(local: {local_label})"
    )


def require_single_local_record(
    records: list[LocalArchiveRecord],
    *,
    action_label: str,
) -> LocalArchiveRecord:
    if not records:
        raise SystemExit(
            f"No local archive workbook matched the requested selector for '{action_label}'."
        )
    if len(records) > 1:
        preview = "\n".join(describe_local_record(record) for record in records[:10])
        suffix = "\n..." if len(records) > 10 else ""
        raise SystemExit(
            f"Multiple local archive workbooks matched '{action_label}'. Narrow the selector.\n{preview}{suffix}"
        )
    return records[0]


def require_single_drive_record(
    records: list[DriveArchiveRecord],
    *,
    action_label: str,
) -> DriveArchiveRecord:
    if not records:
        raise SystemExit(
            f"No Drive workbook matched the requested selector for '{action_label}'."
        )
    if len(records) > 1:
        preview = "\n".join(describe_drive_record(record) for record in records[:10])
        suffix = "\n..." if len(records) > 10 else ""
        raise SystemExit(
            f"Multiple Drive workbooks matched '{action_label}'. Narrow the selector.\n{preview}{suffix}"
        )
    return records[0]


def write_summary(payload: dict[str, object]) -> None:
    SUMMARY_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def load_processed_drive_workbooks_manifest() -> dict[str, object]:
    manifest = load_json_file(
        PROCESSED_DRIVE_WORKBOOKS_PATH,
        default={
            "schema_version": PROCESSED_DRIVE_WORKBOOKS_SCHEMA_VERSION,
            "processed_relative_paths": [],
        },
    )

    schema_version = manifest.get("schema_version")
    if schema_version != PROCESSED_DRIVE_WORKBOOKS_SCHEMA_VERSION:
        raise SystemExit(
            f"Unsupported processed Drive workbooks manifest schema in '{PROCESSED_DRIVE_WORKBOOKS_PATH}'. "
            f"Expected {PROCESSED_DRIVE_WORKBOOKS_SCHEMA_VERSION}, got {schema_version!r}."
        )

    processed_relative_paths = manifest.get("processed_relative_paths")
    if not isinstance(processed_relative_paths, list):
        raise SystemExit(
            f"Processed Drive workbooks manifest is invalid: "
            f"'{PROCESSED_DRIVE_WORKBOOKS_PATH}' must contain a list at 'processed_relative_paths'."
        )

    normalized_paths = sorted(
        {
            normalize_relative_path(path)
            for path in processed_relative_paths
            if normalize_relative_path(path)
        }
    )
    return {
        "schema_version": PROCESSED_DRIVE_WORKBOOKS_SCHEMA_VERSION,
        "processed_relative_paths": normalized_paths,
    }


def build_processed_relative_paths_set(manifest: dict[str, object]) -> set[str]:
    raw_paths = manifest.get("processed_relative_paths", [])
    if not isinstance(raw_paths, list):
        return set()
    return {
        normalized_path
        for path in raw_paths
        if (normalized_path := normalize_relative_path(path))
    }


def save_processed_drive_workbooks_manifest(processed_paths: set[str]) -> None:
    normalized_paths = sorted(
        normalize_relative_path(path)
        for path in processed_paths
        if normalize_relative_path(path)
    )
    payload = {
        "schema_version": PROCESSED_DRIVE_WORKBOOKS_SCHEMA_VERSION,
        "processed_relative_paths": normalized_paths,
    }
    PROCESSED_DRIVE_WORKBOOKS_PATH.write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )


def update_state_after_download(
    state: dict[str, object],
    downloaded_files: list[dict[str, str]],
    pending_files: list[dict[str, object]],
    *,
    new_workbook_detected_at: str | None,
) -> None:
    latest_download = downloaded_files[-1] if downloaded_files else None
    state.update(
        {
            "sync_downloaded_at": datetime.now().isoformat(timespec="seconds"),
            "downloaded_files": [
                {
                    "drive_file_id": item["drive_file_id"],
                    "workbook_name": item["workbook_name"],
                    "download_path": item["archive_path"],
                    "relative_path": item["relative_path"],
                    "mime_type": item["mime_type"],
                    "modified_time": item["modified_time"],
                    "modified_date": item["modified_date"],
                }
                for item in downloaded_files
            ],
            "downloaded_files_count": len(downloaded_files),
            "copied_archive_files": [item["archive_path"] for item in downloaded_files],
            "copied_archive_files_count": len(downloaded_files),
            "pending_files": pending_files,
            "pending_files_count": len(pending_files),
            "drive_sync_summary_path": str(SUMMARY_PATH),
            "last_new_workbook_detected_at": new_workbook_detected_at,
        }
    )
    if latest_download is not None:
        state.update(
            {
                "downloaded_drive_file_id": latest_download["drive_file_id"],
                "downloaded_workbook_name": latest_download["workbook_name"],
                "downloaded_workbook_path": latest_download["archive_path"],
                "downloaded_relative_path": latest_download["relative_path"],
                "downloaded_mime_type": latest_download["mime_type"],
                "downloaded_modified_time": latest_download["modified_time"],
                "downloaded_modified_date": latest_download["modified_date"],
                "archive_relative_path": latest_download["relative_path"],
                "archive_workbook_name": Path(latest_download["archive_path"]).name,
                "archive_workbook_path": latest_download["archive_path"],
                "archive_updated_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
    save_state(state)


def download_selected_workbooks(
    service,
    settings,
    selected_files: list[object],
    archive_paths: set[str],
) -> tuple[list[dict[str, str]], list[dict[str, object]], set[str]]:
    downloaded_files: list[dict[str, str]] = []
    pending_files: list[dict[str, object]] = []

    for drive_file in selected_files:
        archive_relative = resolve_archive_relative_path(
            drive_file, settings.archive_root, archive_paths
        )
        archive_path = settings.archive_root / archive_relative
        temp_download_path = settings.download_root / archive_relative
        log("Downloading candidate workbook:")
        log(f"- name: {drive_file.export_name}")
        log(f"- temp target: {temp_download_path}")
        download_drive_file(service, drive_file, temp_download_path)

        readiness = inspect_workbook_readiness(temp_download_path)
        if not readiness["is_ready"]:
            pending_record = {
                "drive_file_id": drive_file.file_id,
                "workbook_name": drive_file.export_name,
                "relative_path": archive_relative.as_posix(),
                "modified_time": drive_file.modified_time.isoformat(),
                "modified_date": drive_file.modified_time.date().isoformat(),
                "issues": readiness["issues"],
            }
            pending_files.append(pending_record)
            log(
                "Workbook is not ready yet. Waiting for the next poll before extraction."
            )
            for issue in readiness["issues"]:
                log(f"- pending reason: {issue}")
            try:
                temp_download_path.unlink(missing_ok=True)
            except OSError:
                pass
            continue

        archive_path.parent.mkdir(parents=True, exist_ok=True)
        temp_download_path.replace(archive_path)
        archive_paths.add(archive_relative.as_posix())
        downloaded_files.append(
            {
                "drive_file_id": drive_file.file_id,
                "workbook_name": drive_file.export_name,
                "archive_path": str(archive_path),
                "relative_path": archive_relative.as_posix(),
                "mime_type": drive_file.mime_type,
                "modified_time": drive_file.modified_time.isoformat(),
                "modified_date": drive_file.modified_time.date().isoformat(),
            }
        )

    return downloaded_files, pending_files, archive_paths


def prepare_local_selected_workbooks(
    selected_records: list[LocalArchiveRecord],
) -> tuple[list[dict[str, str]], list[dict[str, object]]]:
    prepared_files: list[dict[str, str]] = []
    pending_files: list[dict[str, object]] = []

    for record in selected_records:
        log("Inspecting local workbook candidate:")
        log(f"- name: {record.workbook_name}")
        log(f"- archive path: {record.archive_path}")

        readiness = inspect_workbook_readiness(record.archive_path)
        if not readiness["is_ready"]:
            pending_record = {
                "drive_file_id": f"local:{record.relative_path}",
                "workbook_name": record.workbook_name,
                "relative_path": record.relative_path,
                "modified_time": record.modified_time.isoformat(),
                "modified_date": record.modified_time.date().isoformat(),
                "issues": readiness["issues"],
            }
            pending_files.append(pending_record)
            log("Workbook is not ready yet. Skipping it for this local sync run.")
            for issue in readiness["issues"]:
                log(f"- pending reason: {issue}")
            continue

        prepared_files.append(
            {
                "drive_file_id": f"local:{record.relative_path}",
                "workbook_name": record.workbook_name,
                "archive_path": str(record.archive_path),
                "relative_path": record.relative_path,
                "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "modified_time": record.modified_time.isoformat(),
                "modified_date": record.modified_time.date().isoformat(),
            }
        )

    return prepared_files, pending_files


def local_git_branch_exists(branch_name: str) -> bool:
    try:
        run_git("rev-parse", "--verify", branch_name)
    except RuntimeError:
        return False
    return True


def git_worktree_has_tracked_changes() -> bool:
    return bool(run_git("status", "--short", "--untracked-files=no").strip())


def prepare_data_updates_branch(settings) -> None:
    if git_worktree_has_tracked_changes():
        raise SystemExit(
            "Refusing to switch and reset the publish branches because the git worktree has tracked changes.\n"
            "Commit or stash those changes first, then run the sync again."
        )

    starting_branch = current_branch()
    log("Preparing the publish branch for the incoming data update...")
    log(f"- starting branch: {starting_branch}")

    run_git("checkout", settings.main_branch)
    run_git("pull", "--ff-only", settings.remote, settings.main_branch)

    if local_git_branch_exists(settings.data_branch):
        run_git("checkout", settings.data_branch)
    else:
        run_git("checkout", "-b", settings.data_branch, settings.main_branch)

    run_git("reset", "--hard", settings.main_branch)
    log(f"- active branch: {settings.data_branch}")
    log(f"- copied from: {settings.main_branch}")


def publish_pipeline_changes() -> None:
    log("Publishing the refreshed data and merging it back into main...")
    run_subprocess(
        [sys.executable, str(PUBLISH_SCRIPT)], cwd=PIPELINE_ROOT, stream_output=True
    )


def run_pipeline_rebuild(
    *,
    full_rebuild_online: bool,
) -> None:
    if full_rebuild_online:
        log(
            "Rebuilding the project event and matchup data from the full workbook archive..."
        )
        rebuild_command = [sys.executable, str(REBUILD_SCRIPT), "--full-rebuild-online"]
    else:
        log(
            "Rebuilding the project event and matchup data from the newly synced workbooks..."
        )
        rebuild_command = [sys.executable, str(REBUILD_SCRIPT)]

    run_subprocess(rebuild_command, cwd=PIPELINE_ROOT, stream_output=True)

    log("Rebuilding the split matchup archive from the refreshed matchup source...")
    run_subprocess(
        ["node", str(MATCHUP_SPLIT_BUILD_SCRIPT)], cwd=PROJECT_ROOT, stream_output=True
    )

    log("Regenerating Elo data from the refreshed matchup archive...")
    run_subprocess(
        ["node", str(ELO_BUILD_SCRIPT)], cwd=PROJECT_ROOT, stream_output=True
    )

    log("Refreshing the site thumbnail from the rebuilt project data...")
    try:
        run_subprocess(
            ["node", str(THUMBNAIL_UPDATE_SCRIPT)], cwd=PROJECT_ROOT, stream_output=True
        )
    except RuntimeError as exc:
        log("Thumbnail refresh failed, but the data rebuild completed successfully.")
        log(str(exc))


def finalize_pipeline_state(
    summary: dict[str, object],
    state: dict[str, object],
    *,
    pipeline_started_at: datetime,
    pipeline_started_monotonic: float,
    include_drive_metrics: bool,
) -> None:
    elo_snapshot = load_elo_manifest_snapshot()
    thumbnail_snapshot = load_thumbnail_snapshot()
    pipeline_finished_at = datetime.now()
    pipeline_duration_seconds = round(
        time.perf_counter() - pipeline_started_monotonic, 3
    )

    summary["generated_at"] = pipeline_finished_at.isoformat(timespec="seconds")
    summary["pipeline_timing"] = {
        "started_at": pipeline_started_at.isoformat(timespec="seconds"),
        "finished_at": pipeline_finished_at.isoformat(timespec="seconds"),
        "duration_seconds": pipeline_duration_seconds,
    }
    summary["elo"] = elo_snapshot
    summary["thumbnail"] = thumbnail_snapshot
    write_summary(summary)

    state.update(
        {
            "data_refresh_completed_at": datetime.now().isoformat(timespec="seconds"),
            "elo_manifest_path": str(ELO_MANIFEST_PATH),
            "elo_manifest_snapshot": elo_snapshot,
            "thumbnail_snapshot": thumbnail_snapshot,
            "thumbnail_path": str(THUMBNAIL_OUTPUT_PATH),
            "thumbnail_updated_at": thumbnail_snapshot.get("updated_at"),
            "last_pipeline_duration_seconds": pipeline_duration_seconds,
        }
    )
    if include_drive_metrics:
        state["last_drive_request_metrics"] = summary.get("drive_request_metrics", {})
    save_state(state)


def run_sync_command(args: argparse.Namespace) -> int:
    pipeline_started_at = datetime.now()
    pipeline_started_monotonic = time.perf_counter()
    settings = load_settings()
    state = load_state()
    overrides = load_pipeline_overrides()

    reset_drive_request_metrics()
    service = build_drive_service(settings.credentials_path)
    drive_files = list_drive_files(service, settings.drive_folder_id)
    processed_manifest = load_processed_drive_workbooks_manifest()
    processed_paths = build_processed_relative_paths_set(processed_manifest)
    archive_paths = list_archive_relative_paths(settings.archive_root)
    current_utc_time = datetime.now(timezone.utc)
    # Cutoff time for to avoid downloading files that were modified very recently, 
    # which may still be in the process of being edited and saved by the user.
    # This cutoff can be overridden with the --ignore_cutoff flag for testing or exceptional cases
    if args.ignore_cutoff:
        print("Ignore cutoff mode enabled: skipping 10-minute cutoff")
        cutoff = current_utc_time
    else:
        cutoff = current_utc_time - timedelta(minutes=10)
    excluded_drive_files_count = sum(
        1 for drive_file in drive_files if is_drive_file_excluded(drive_file, overrides)
    )
    unprocessed_files = [
        drive_file
        for drive_file in drive_files
        if not is_drive_file_excluded(drive_file, overrides)
        and not any(
            candidate.as_posix() in processed_paths
            for candidate in archive_relative_path_candidates(drive_file)
        )
    ]
    missing_files = [
        drive_file
        for drive_file in unprocessed_files
        if drive_file.modified_time <= cutoff
    ]
    too_recent_files = [
        drive_file
        for drive_file in unprocessed_files
        if drive_file.modified_time > cutoff
    ]
    new_workbook_detected_at = (
        datetime.now().isoformat(timespec="seconds") if missing_files else None
    )
    selected_files = list(missing_files)
    forced_file = None
    forced_file_source = ""

    if too_recent_files:
        log(
            "Skipping Drive workbook(s) modified less than 30 minutes ago for this sync run."
        )
        for drive_file in too_recent_files:
            relative_path = resolve_archive_relative_path(
                drive_file, settings.archive_root, archive_paths
            )
            log(f"- workbook: {drive_file.export_name}")
            log(f"  drive file id: {drive_file.file_id}")
            log(f"  relative path: {relative_path.as_posix()}")
            log(f"  modified time: {drive_file.modified_time.isoformat()}")
            log(f"  current cutoff: {cutoff.isoformat()}")

    if args.force_redownload:
        forced_file, forced_file_source = resolve_force_redownload_target(
            drive_files, state
        )
        if forced_file is not None and is_drive_file_excluded(forced_file, overrides):
            log(
                "Force redownload is enabled, but the selected workbook is excluded by pipeline overrides."
            )
            forced_file = None
            forced_file_source = ""
        elif forced_file is not None and all(
            existing_drive_file.file_id != forced_file.file_id
            for existing_drive_file in selected_files
        ):
            selected_files.append(forced_file)

    if forced_file is not None:
        forced_relative = resolve_archive_relative_path(
            forced_file, settings.archive_root, archive_paths
        )
        log("Force redownload is enabled.")
        log(f"- selected workbook: {forced_file.export_name}")
        log(f"- relative path: {forced_relative.as_posix()}")
        log(f"- target source: {forced_file_source}")

    confirm_duplicate_latest_event(
        build_candidate_events_from_drive_files(
            selected_files,
            settings=settings,
            archive_paths=archive_paths,
            overrides=overrides,
        ),
        assume_yes=args.yes,
    )

    downloaded_files, pending_files, archive_paths = download_selected_workbooks(
        service,
        settings,
        selected_files,
        archive_paths,
    )

    summary: dict[str, object] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "command": "sync",
        "drive_file_count": len(drive_files),
        "excluded_drive_files_count": excluded_drive_files_count,
        "local_archive_file_count": len(archive_paths),
        "force_redownload": args.force_redownload,
        "force_redownload_source": forced_file_source,
        "minimum_drive_file_age_minutes": 30,
        "processed_manifest_path": str(PROCESSED_DRIVE_WORKBOOKS_PATH),
        "processed_manifest_entries_count": len(processed_paths),
        "selected_file_count": len(selected_files),
        "missing_file_count": len(missing_files),
        "too_recent_file_count": len(too_recent_files),
        "too_recent_files": [
            {
                "workbook_name": drive_file.export_name,
                "drive_file_id": drive_file.file_id,
                "relative_path": resolve_archive_relative_path(
                    drive_file,
                    settings.archive_root,
                    archive_paths,
                ).as_posix(),
                "modified_time": drive_file.modified_time.isoformat(),
            }
            for drive_file in too_recent_files
        ],
        "downloaded_files_count": len(downloaded_files),
        "downloaded_files": downloaded_files,
        "pending_files_count": len(pending_files),
        "pending_files": pending_files,
        "drive_request_metrics": get_drive_request_metrics(),
        "new_workbook_detected_at": new_workbook_detected_at,
        "pipeline_overrides_path": str(PIPELINE_OVERRIDES_PATH),
        "excluded_relative_paths_count": len(overrides.excluded_relative_paths),
        "metadata_overrides_count": len(overrides.metadata_overrides_by_relative_path),
    }
    if forced_file is not None:
        summary["force_redownload_relative_path"] = resolve_archive_relative_path(
            forced_file,
            settings.archive_root,
            archive_paths,
        ).as_posix()
    write_summary(summary)

    update_state_after_download(
        state,
        downloaded_files,
        pending_files,
        new_workbook_detected_at=new_workbook_detected_at,
    )

    log(f"Sync complete. Downloaded {len(downloaded_files)} Drive workbook(s).")
    log(f"- summary: {SUMMARY_PATH}")
    if not downloaded_files:
        pipeline_finished_at = datetime.now()
        pipeline_duration_seconds = round(
            time.perf_counter() - pipeline_started_monotonic, 3
        )
        summary["generated_at"] = pipeline_finished_at.isoformat(timespec="seconds")
        summary["pipeline_timing"] = {
            "started_at": pipeline_started_at.isoformat(timespec="seconds"),
            "finished_at": pipeline_finished_at.isoformat(timespec="seconds"),
            "duration_seconds": pipeline_duration_seconds,
        }
        write_summary(summary)

        state = load_state()
        state.update(
            {
                "last_drive_request_metrics": summary["drive_request_metrics"],
                "last_pipeline_duration_seconds": pipeline_duration_seconds,
            }
        )
        save_state(state)

        if pending_files:
            log(
                f"Found {len(pending_files)} new workbook(s), but none are ready for extraction yet."
            )
        elif too_recent_files:
            log(
                f"Found {len(too_recent_files)} unprocessed Drive workbook(s), but all were modified less than 30 minutes ago."
            )
        elif args.force_redownload and forced_file is None:
            log("No workbook was selected for forced redownload.")
        else:
            log("No unprocessed Drive workbooks were found.")
        return 0

    if not args.skip_publish:
        prepare_data_updates_branch(settings)

    log("Extracting CSVs for the newly synced workbooks...")
    run_subprocess(
        [sys.executable, str(EXTRACT_SCRIPT)], cwd=PIPELINE_ROOT, stream_output=True
    )

    run_pipeline_rebuild(
        full_rebuild_online=False,
    )

    state = load_state()
    finalize_pipeline_state(
        summary,
        state,
        pipeline_started_at=pipeline_started_at,
        pipeline_started_monotonic=pipeline_started_monotonic,
        include_drive_metrics=True,
    )

    processed_paths.update(
        normalize_relative_path(item["relative_path"])
        for item in downloaded_files
        if normalize_relative_path(item.get("relative_path"))
    )
    save_processed_drive_workbooks_manifest(processed_paths)

    if args.skip_publish:
        log("Sync and rebuild complete.")
        log(
            "Skipped branch switching and git publish because --skip-publish was provided."
        )
        return 0

    publish_pipeline_changes()

    log("Sync, rebuild, and publish complete.")
    log(
        "This entrypoint refreshed the data pipeline and merged the published result back into main."
    )
    return 0


def run_local_sync_command(args: argparse.Namespace) -> int:
    pipeline_started_at = datetime.now()
    pipeline_started_monotonic = time.perf_counter()
    settings = load_settings()
    state = load_state()
    overrides = load_pipeline_overrides()

    local_records = list_local_archive_records(settings.archive_root)
    selected_records, selection_mode, missing_records = resolve_local_sync_selection(
        local_records,
        settings=settings,
        overrides=overrides,
        match=args.match,
        relative_path=args.relative_path,
        year=args.year,
        month=args.month,
        latest=args.latest,
        missing=args.missing,
    )
    confirm_duplicate_latest_event(
        build_candidate_events_from_local_records(selected_records, overrides),
        assume_yes=args.yes,
    )
    prepared_files, pending_files = prepare_local_selected_workbooks(selected_records)
    selection_detected_at = (
        datetime.now().isoformat(timespec="seconds") if selected_records else None
    )

    summary: dict[str, object] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "command": "sync-local",
        "selection_mode": selection_mode,
        "local_archive_file_count": len(local_records),
        "excluded_local_files_count": len(overrides.excluded_relative_paths),
        "missing_local_file_count": len(missing_records),
        "selected_file_count": len(selected_records),
        "selected_relative_paths": [
            record.relative_path for record in selected_records
        ],
        "downloaded_files_count": len(prepared_files),
        "downloaded_files": prepared_files,
        "pending_files_count": len(pending_files),
        "pending_files": pending_files,
        "new_workbook_detected_at": selection_detected_at,
        "pipeline_overrides_path": str(PIPELINE_OVERRIDES_PATH),
        "metadata_overrides_count": len(overrides.metadata_overrides_by_relative_path),
    }
    write_summary(summary)

    update_state_after_download(
        state,
        prepared_files,
        pending_files,
        new_workbook_detected_at=selection_detected_at,
    )

    log(
        f"Local sync selection complete. Prepared {len(prepared_files)} workbook(s) from dataGoogleDrive."
    )
    log(f"- selection mode: {selection_mode}")
    log(f"- summary: {SUMMARY_PATH}")

    if not prepared_files:
        pipeline_finished_at = datetime.now()
        pipeline_duration_seconds = round(
            time.perf_counter() - pipeline_started_monotonic, 3
        )
        summary["generated_at"] = pipeline_finished_at.isoformat(timespec="seconds")
        summary["pipeline_timing"] = {
            "started_at": pipeline_started_at.isoformat(timespec="seconds"),
            "finished_at": pipeline_finished_at.isoformat(timespec="seconds"),
            "duration_seconds": pipeline_duration_seconds,
        }
        write_summary(summary)

        state = load_state()
        state["last_pipeline_duration_seconds"] = pipeline_duration_seconds
        save_state(state)

        if pending_files:
            log(
                f"Found {len(pending_files)} selected local workbook(s), but none are ready for extraction yet."
            )
        elif selection_mode == "missing":
            log("No missing local workbooks were found.")
        else:
            log("No local workbooks matched the requested selector.")
        return 0

    prepare_data_updates_branch(settings)

    log("Extracting CSVs for the selected local workbooks...")
    run_subprocess(
        [sys.executable, str(EXTRACT_SCRIPT)], cwd=PIPELINE_ROOT, stream_output=True
    )

    run_pipeline_rebuild(
        full_rebuild_online=False,
    )

    state = load_state()
    finalize_pipeline_state(
        summary,
        state,
        pipeline_started_at=pipeline_started_at,
        pipeline_started_monotonic=pipeline_started_monotonic,
        include_drive_metrics=False,
    )

    publish_pipeline_changes()

    log("Local sync, rebuild, and publish complete.")
    log(
        "This entrypoint refreshed the pipeline from local archive inputs and merged the published result back into main."
    )
    return 0


def run_list_command(args: argparse.Namespace) -> int:
    settings = load_settings()
    overrides = load_pipeline_overrides()

    if args.drive:
        reset_drive_request_metrics()
        service = build_drive_service(settings.credentials_path)
        drive_files = list_drive_files(service, settings.drive_folder_id)
        archive_paths = list_archive_relative_paths(settings.archive_root)
        records = build_drive_records(drive_files, settings, archive_paths)
        selected_records = select_drive_records(
            records,
            match=args.match,
            relative_path=args.relative_path,
            latest=args.latest,
        )
        if not selected_records:
            log("No Drive workbooks matched the requested selector.")
            return 0

        limit = max(1, int(args.limit))
        log("Drive workbook entries:")
        for record in selected_records[:limit]:
            excluded = (
                "yes"
                if record.relative_path in overrides.excluded_relative_paths
                else "no"
            )
            override_date = (
                overrides.metadata_overrides_by_relative_path.get(
                    record.relative_path, {}
                ).get("date")
                or "--"
            )
            log(describe_drive_record(record))
            log(f"  excluded: {excluded}")
            log(f"  override-date: {override_date}")
        if len(selected_records) > limit:
            log(
                f"... showing {limit} of {len(selected_records)} matching Drive entries."
            )
        return 0

    records = list_local_archive_records(settings.archive_root)
    selected_records = select_local_records(
        records,
        match=args.match,
        relative_path=args.relative_path,
        latest=args.latest,
    )
    if not selected_records:
        log("No local archive workbooks matched the requested selector.")
        return 0

    limit = max(1, int(args.limit))
    log("Local archive entries:")
    for record in selected_records[:limit]:
        excluded = (
            "yes" if record.relative_path in overrides.excluded_relative_paths else "no"
        )
        override_date = (
            overrides.metadata_overrides_by_relative_path.get(
                record.relative_path, {}
            ).get("date")
            or "--"
        )
        log(describe_local_record(record))
        log(f"  excluded: {excluded}")
        log(f"  override-date: {override_date}")
    if len(selected_records) > limit:
        log(f"... showing {limit} of {len(selected_records)} matching local entries.")
    return 0


def run_download_command(args: argparse.Namespace) -> int:
    settings = load_settings()
    state = load_state()
    overrides = load_pipeline_overrides()

    reset_drive_request_metrics()
    service = build_drive_service(settings.credentials_path)
    drive_files = list_drive_files(service, settings.drive_folder_id)
    archive_paths = list_archive_relative_paths(settings.archive_root)
    records = build_drive_records(drive_files, settings, archive_paths)
    selected_record = require_single_drive_record(
        select_drive_records(
            records,
            match=args.match,
            relative_path=args.relative_path,
            latest=args.latest,
        ),
        action_label="download",
    )

    if selected_record.local_exists and not args.redownload:
        log("The selected workbook already exists in the local archive.")
        log(f"- workbook: {selected_record.workbook_name}")
        log(f"- relative path: {selected_record.relative_path}")
        log("Use download --redownload if you want to replace the local copy.")
        return 0

    downloaded_files, pending_files, archive_paths = download_selected_workbooks(
        service,
        settings,
        [selected_record.drive_file],
        archive_paths,
    )

    summary: dict[str, object] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "command": "download",
        "selected_file_count": 1,
        "selected_relative_path": selected_record.relative_path,
        "selected_workbook_name": selected_record.workbook_name,
        "downloaded_files_count": len(downloaded_files),
        "downloaded_files": downloaded_files,
        "pending_files_count": len(pending_files),
        "pending_files": pending_files,
        "local_archive_file_count": len(archive_paths),
        "drive_request_metrics": get_drive_request_metrics(),
        "pipeline_overrides_path": str(PIPELINE_OVERRIDES_PATH),
        "excluded_relative_paths_count": len(overrides.excluded_relative_paths),
        "metadata_overrides_count": len(overrides.metadata_overrides_by_relative_path),
    }
    write_summary(summary)

    update_state_after_download(
        state,
        downloaded_files,
        pending_files,
        new_workbook_detected_at=datetime.now().isoformat(timespec="seconds"),
    )

    if downloaded_files:
        log("Specific workbook download complete.")
        log(f"- workbook: {selected_record.workbook_name}")
        log(f"- relative path: {selected_record.relative_path}")
        log(
            "Next: run sync_drive_and_rebuild_all.py rebuild --full to regenerate the dataset from the archive."
        )
    elif pending_files:
        log("The selected workbook was found, but it is not ready for extraction yet.")
    return 0


def run_exclude_command(args: argparse.Namespace) -> int:
    settings = load_settings()
    overrides = load_pipeline_overrides()
    record = require_single_local_record(
        select_local_records(
            list_local_archive_records(settings.archive_root),
            match=args.match,
            relative_path=args.relative_path,
            latest=args.latest,
        ),
        action_label="exclude",
    )

    already_excluded = record.relative_path in overrides.excluded_relative_paths
    overrides.excluded_relative_paths.add(record.relative_path)
    save_pipeline_overrides(overrides)

    if already_excluded:
        log("That workbook was already excluded.")
    else:
        log("Excluded workbook from future rebuilds.")
    log(f"- workbook: {record.workbook_name}")
    log(f"- relative path: {record.relative_path}")
    log(
        "Next: run sync_drive_and_rebuild_all.py rebuild --full to remove it from generated data."
    )
    return 0


def run_include_command(args: argparse.Namespace) -> int:
    settings = load_settings()
    overrides = load_pipeline_overrides()
    record = require_single_local_record(
        select_local_records(
            list_local_archive_records(settings.archive_root),
            match=args.match,
            relative_path=args.relative_path,
            latest=args.latest,
        ),
        action_label="include",
    )

    removed = record.relative_path in overrides.excluded_relative_paths
    overrides.excluded_relative_paths.discard(record.relative_path)
    save_pipeline_overrides(overrides)

    if removed:
        log("Removed workbook from the exclude list.")
    else:
        log("That workbook was not excluded.")
    log(f"- workbook: {record.workbook_name}")
    log(f"- relative path: {record.relative_path}")
    log(
        "Next: run sync_drive_and_rebuild_all.py rebuild --full to bring it back into generated data."
    )
    return 0


def run_override_date_command(args: argparse.Namespace) -> int:
    settings = load_settings()
    overrides = load_pipeline_overrides()
    record = require_single_local_record(
        select_local_records(
            list_local_archive_records(settings.archive_root),
            match=args.match,
            relative_path=args.relative_path,
            latest=args.latest,
        ),
        action_label="override-date",
    )

    override_date = args.date.strip()
    try:
        date.fromisoformat(override_date)
    except ValueError as exc:
        raise SystemExit(
            f"Invalid --date value '{override_date}'. Expected YYYY-MM-DD."
        ) from exc

    override_payload = dict(
        overrides.metadata_overrides_by_relative_path.get(record.relative_path, {})
    )
    override_payload["date"] = override_date
    overrides.metadata_overrides_by_relative_path[record.relative_path] = (
        override_payload
    )
    save_pipeline_overrides(overrides)

    log("Saved event-date override.")
    log(f"- workbook: {record.workbook_name}")
    log(f"- relative path: {record.relative_path}")
    log(f"- override date: {override_date}")
    log(
        "Next: run sync_drive_and_rebuild_all.py rebuild --full to regenerate the event with the new date."
    )
    return 0


def run_clear_override_date_command(args: argparse.Namespace) -> int:
    settings = load_settings()
    overrides = load_pipeline_overrides()
    record = require_single_local_record(
        select_local_records(
            list_local_archive_records(settings.archive_root),
            match=args.match,
            relative_path=args.relative_path,
            latest=args.latest,
        ),
        action_label="clear-override-date",
    )

    override_payload = dict(
        overrides.metadata_overrides_by_relative_path.get(record.relative_path, {})
    )
    had_override = "date" in override_payload
    override_payload.pop("date", None)
    if override_payload:
        overrides.metadata_overrides_by_relative_path[record.relative_path] = (
            override_payload
        )
    else:
        overrides.metadata_overrides_by_relative_path.pop(record.relative_path, None)
    save_pipeline_overrides(overrides)

    if had_override:
        log("Cleared event-date override.")
    else:
        log("That workbook did not have a saved event-date override.")
    log(f"- workbook: {record.workbook_name}")
    log(f"- relative path: {record.relative_path}")
    log(
        "Next: run sync_drive_and_rebuild_all.py rebuild --full to regenerate the event with the original date."
    )
    return 0


def run_rebuild_command(args: argparse.Namespace) -> int:
    _ = args.full
    pipeline_started_at = datetime.now()
    pipeline_started_monotonic = time.perf_counter()
    settings = load_settings()
    state = load_state()

    run_pipeline_rebuild(
        full_rebuild_online=True,
    )

    summary: dict[str, object] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "command": str(args.command),
        "full_rebuild_online": True,
        "pipeline_overrides_path": str(PIPELINE_OVERRIDES_PATH),
    }
    finalize_pipeline_state(
        summary,
        state,
        pipeline_started_at=pipeline_started_at,
        pipeline_started_monotonic=pipeline_started_monotonic,
        include_drive_metrics=False,
    )

    log("Full rebuild complete.")
    log(
        "This refreshed event data, matchup data, Elo data, and the site thumbnail from the local archive."
    )
    log(
        "Next: run publish_pipeline_changes.py to review with --dry-run or publish the changes."
    )
    return 0


def main() -> int:
    args = parse_args()

    if args.command == "sync":
        return run_sync_command(args)
    if args.command == "sync-local":
        return run_local_sync_command(args)
    if args.command == "list":
        return run_list_command(args)
    if args.command == "download":
        return run_download_command(args)
    if args.command == "exclude":
        return run_exclude_command(args)
    if args.command == "include":
        return run_include_command(args)
    if args.command == "override-date":
        return run_override_date_command(args)
    if args.command == "clear-override-date":
        return run_clear_override_date_command(args)
    if args.command in {"rebuild", "rebuild-local"}:
        return run_rebuild_command(args)

    raise SystemExit(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
