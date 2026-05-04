#!/usr/bin/env python3
"""Rebuild the project data from the local workbook archive.

This wrapper exists to keep the rebuild contract small: choose the workbook scope
here, then delegate import/replacement logic to the importer script.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from pipeline_common import (
    PIPELINE_OVERRIDES_PATH,
    current_branch,
    load_settings,
    load_state,
    log,
    run_subprocess,
    save_state,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SUMMARY_PATH = PROJECT_ROOT / "data" / "import-summary.json"
ALIASES_PATH = PROJECT_ROOT / "data" / "aliases.json"
PIPELINE_ROOT = Path(__file__).resolve().parent
REBUILD_STAGING_ROOT = PIPELINE_ROOT / "output" / "rebuild-staging"
REBUILD_INPUT_CSV_ROOT = REBUILD_STAGING_ROOT / "google-drive-input"
REBUILD_MATCHUP_CSV_ROOT = REBUILD_STAGING_ROOT / "google-drive-matchup-input"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rebuild the project event and matchup data from the workbook archive.")
    parser.add_argument(
        "--include-relative-path",
        action="append",
        default=[],
        help="Limit the rebuild to these source-root-relative workbook paths.",
    )
    parser.add_argument(
        "--full-rebuild-online",
        action="store_true",
        help=(
            "Rebuild all online event and matchup data from the local workbook archive instead of preserving "
            "existing online rows that were not reimported in this run."
        ),
    )
    return parser.parse_args()


def resolve_incremental_cutoff(state: dict[str, object]) -> str | None:
    """Choose the best incremental cutoff from aliases, state, or prior summary.

    Returning `None` is intentional: it tells the rebuild path there is no safe
    incremental marker, so it must fall back to a full-archive import scope.
    """
    if ALIASES_PATH.exists():
        try:
            aliases = json.loads(ALIASES_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            aliases = {}
        last_updated_date = aliases.get("last_updated_date")
        if last_updated_date:
            return str(last_updated_date)

    if state.get("last_imported_modified_time"):
        return str(state["last_imported_modified_time"])

    if SUMMARY_PATH.exists():
        try:
            summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            summary = {}
        generated_at = summary.get("generated_at")
        if generated_at:
            return str(generated_at)

    return None


def resolve_next_cutoff(
    state: dict[str, object], summary: dict[str, object], previous_cutoff: str | None
) -> str:
    """Compute the next persisted cutoff after a rebuild finishes.

    Prefers durable data-derived markers over wall-clock time so later incremental
    rebuilds replay cleanly instead of drifting on timing alone.
    """
    if ALIASES_PATH.exists():
        try:
            aliases = json.loads(ALIASES_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            aliases = {}
        last_updated_date = aliases.get("last_updated_date")
        if last_updated_date:
            return str(last_updated_date)
    imported_workbooks = int(summary.get("imported_workbooks") or 0)
    if imported_workbooks > 0 and state.get("downloaded_modified_date"):
        return str(state["downloaded_modified_date"])
    if previous_cutoff:
        return previous_cutoff
    return datetime.now().astimezone().isoformat()


def main() -> int:
    """Run the importer-facing rebuild wrapper and persist the next rebuild marker.

    - Full rebuild replaces selected online rows; incremental rebuild prefers the exact paths recorded by sync.
    - Writes rebuild state after the importer summary is available.
    """
    args = parse_args()
    settings = load_settings()
    state = load_state()

    if not settings.import_script.exists():
        raise SystemExit(f"Importer script was not found: {settings.import_script}")

    try:
        branch = current_branch()
        log(f"Current git branch: {branch}")
        if branch != settings.data_branch:
            log(
                f"Note: publishing is easiest if you run rebuild and publish from '{settings.data_branch}'."
            )
    except Exception:
        log("Could not read the current git branch. Continuing with the import step.")

    command = [sys.executable, str(settings.import_script)]
    command.extend(
        [
            "--csv-root",
            str(REBUILD_INPUT_CSV_ROOT),
            "--matchup-csv-root",
            str(REBUILD_MATCHUP_CSV_ROOT),
            "--pipeline-overrides-path",
            str(PIPELINE_OVERRIDES_PATH),
        ]
    )
    include_relative_paths = [
        str(relative_path).strip()
        for relative_path in args.include_relative_path
        if str(relative_path).strip()
    ]
    for relative_path in include_relative_paths:
        command.extend(["--include-relative-path", relative_path])
    if args.full_rebuild_online:
        # Full rebuild means "replace online-derived rows from the selected archive
        # scope", not "blindly append new rows on top of the existing dataset".
        if include_relative_paths:
            log(
                f"Rebuilding project data from {len(include_relative_paths)} selected local workbook(s), "
                "honoring pipeline overrides."
            )
        else:
            log("Rebuilding project data from the full local workbook archive, honoring pipeline overrides.")
        command.append("--replace-existing-online")
    else:
        # Incremental rebuild prefers the exact workbook paths recorded by sync so
        # reimports replace only the affected event IDs instead of touching the full archive.
        downloaded_files = state.get("downloaded_files")
        if isinstance(downloaded_files, list) and downloaded_files:
            relative_paths = [
                str(file_info.get("relative_path", "")).strip()
                for file_info in downloaded_files
                if str(file_info.get("relative_path", "")).strip()
            ]
            if relative_paths:
                log(f"Rebuilding project data from {len(relative_paths)} newly synced workbook(s).")
                for relative_path in relative_paths:
                    command.extend(["--include-relative-path", relative_path])
            else:
                cutoff = resolve_incremental_cutoff(state)
                if cutoff:
                    log(f"Rebuilding project data from workbooks with a modified date after: {cutoff}")
                    command.extend(["--modified-date-after", cutoff])
                else:
                    log("No previous rebuild marker found, so this run will rebuild from the full workbook archive.")
        else:
            cutoff = resolve_incremental_cutoff(state)
            if cutoff:
                log(f"Rebuilding project data from workbooks with a modified date after: {cutoff}")
                command.extend(["--modified-date-after", cutoff])
            else:
                log("No previous rebuild marker found, so this run will rebuild from the full workbook archive.")

    result = run_subprocess(
        command,
        cwd=settings.import_script.parent.parent.parent,
        stream_output=True,
    )
    if result.stdout.strip():
        log(result.stdout.strip())
    if result.stderr.strip():
        log(result.stderr.strip())

    summary: dict[str, object] = {}
    if SUMMARY_PATH.exists():
        try:
            summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            summary = {}

    state.update(
        {
            "rebuild_completed_at": datetime.now().isoformat(timespec="seconds"),
            "import_summary_path": str(SUMMARY_PATH),
            "imported_workbooks_count": summary.get("imported_workbooks"),
            "combined_rows_count": summary.get("combined_rows"),
            "last_imported_modified_time": resolve_next_cutoff(
                state,
                summary,
                resolve_incremental_cutoff(state),
            ),
        }
    )
    save_state(state)

    log("Project data rebuilt.")
    log("This step refreshed:")
    log(f"- {REBUILD_INPUT_CSV_ROOT}")
    log(f"- {REBUILD_MATCHUP_CSV_ROOT}")
    log("- data/events")
    log("- data/events.json")
    log("- data/results.json")
    log("- data/aliases.json")
    log("- data/matchups/")
    log("Next: if the changes look right, run publish_pipeline_changes.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
