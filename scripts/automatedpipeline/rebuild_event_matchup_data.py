#!/usr/bin/env python3
"""Phase 4: rebuild the real project data from dataGoogleDrive."""

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

SUMMARY_PATH = Path(__file__).resolve().parents[2] / "data" / "import-summary.json"
ALIASES_PATH = Path(__file__).resolve().parents[2] / "data" / "aliases.json"
PIPELINE_ROOT = Path(__file__).resolve().parent
REBUILD_STAGING_ROOT = PIPELINE_ROOT / "output" / "rebuild-staging"
REBUILD_INPUT_CSV_ROOT = REBUILD_STAGING_ROOT / "google-drive-input"
REBUILD_MATCHUP_CSV_ROOT = REBUILD_STAGING_ROOT / "google-drive-matchup-input"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rebuild the project event and matchup data from the workbook archive.")
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
    if ALIASES_PATH.exists():
        try:
            aliases = json.loads(ALIASES_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            aliases = {}
        last_updated_date = aliases.get("last_updated_date")
        if last_updated_date:
            return str(last_updated_date)

    if state.get("phase_04_last_imported_modified_time"):
        return str(state["phase_04_last_imported_modified_time"])

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
                f"Note: phase 5 is easiest if you run phases 4 and 5 from '{settings.data_branch}'."
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
    if args.full_rebuild_online:
        log("Rebuilding project data from the full local workbook archive, honoring pipeline overrides.")
        command.append("--replace-existing-online")
    else:
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
            "phase_04_rebuilt_at": datetime.now().isoformat(timespec="seconds"),
            "import_summary_path": str(SUMMARY_PATH),
            "imported_workbooks_count": summary.get("imported_workbooks"),
            "combined_rows_count": summary.get("combined_rows"),
            "phase_04_last_imported_modified_time": resolve_next_cutoff(
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
    log("Next: if the changes look right, run 05-publish-to-git.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
