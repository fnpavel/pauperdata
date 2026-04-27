#!/usr/bin/env python3
"""Backfill the processed Drive workbook manifest from local repository files."""

from __future__ import annotations

import json
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_ROOT.parent
PROCESSED_DRIVE_WORKBOOKS_PATH = PIPELINE_ROOT / "processed-drive-workbooks.json"

SCHEMA_VERSION = 1
IGNORED_DIRECTORY_NAMES = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
}
KNOWN_ARCHIVE_FOLDER_NAMES = [
    "dataGoogleDrive",
]


def iter_workbook_files(root: Path) -> list[Path]:
    workbook_files: list[Path] = []
    for path in root.rglob("*.xlsx"):
        if not path.is_file():
            continue
        if any(part in IGNORED_DIRECTORY_NAMES for part in path.relative_to(root).parts[:-1]):
            continue
        workbook_files.append(path)
    return sorted(workbook_files)


def detect_archive_root(workbook_files: list[Path]) -> Path:
    for folder_name in KNOWN_ARCHIVE_FOLDER_NAMES:
        candidate = PROJECT_ROOT / folder_name
        if candidate.is_dir() and any(candidate in path.parents for path in workbook_files):
            return candidate

    archive_root_counts: dict[Path, int] = {}
    for path in workbook_files:
        for parent in path.parents:
            if parent == PROJECT_ROOT:
                break
            relative_parent = parent.relative_to(PROJECT_ROOT)
            if any(part in IGNORED_DIRECTORY_NAMES for part in relative_parent.parts):
                continue
            archive_root_counts[parent] = archive_root_counts.get(parent, 0) + 1

    if not archive_root_counts:
        return PROJECT_ROOT

    return max(
        archive_root_counts.items(),
        key=lambda item: (item[1], -len(item[0].relative_to(PROJECT_ROOT).parts), item[0].as_posix()),
    )[0]


def build_processed_relative_paths(workbook_files: list[Path], archive_root: Path) -> list[str]:
    return sorted(path.relative_to(archive_root).as_posix() for path in workbook_files if archive_root in path.parents)


def main() -> int:
    workbook_files = iter_workbook_files(PROJECT_ROOT)
    archive_root = detect_archive_root(workbook_files)
    processed_relative_paths = build_processed_relative_paths(workbook_files, archive_root)

    payload = {
        "schema_version": SCHEMA_VERSION,
        "processed_relative_paths": processed_relative_paths,
    }
    PROCESSED_DRIVE_WORKBOOKS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    archive_root_label = archive_root.relative_to(PROJECT_ROOT).as_posix() if archive_root != PROJECT_ROOT else "."
    print(f"Backfilled {len(processed_relative_paths)} workbook path(s) into {PROCESSED_DRIVE_WORKBOOKS_PATH}.")
    print(f"Archive base folder: {archive_root_label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
