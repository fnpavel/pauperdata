#!/usr/bin/env python3
"""Extract the workbook Input sheet into inspectable CSV files."""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Iterable

try:
    import pandas as pd
except ImportError as exc:
    raise SystemExit(
        "This step requires pandas and openpyxl.\n"
        "Install them with:\n"
        "  python -m pip install pandas openpyxl"
    ) from exc

from pipeline_common import load_settings, log, require_state_keys, relative_posix, save_state


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


def main() -> int:
    settings = load_settings()
    state = require_state_keys("downloaded_workbook_path", "downloaded_workbook_name", "archive_relative_path")
    downloaded_files = state.get("downloaded_files")
    if isinstance(downloaded_files, list) and downloaded_files:
        files_to_extract = downloaded_files
    else:
        files_to_extract = [
            {
                "download_path": str(state.get("archive_workbook_path") or state["downloaded_workbook_path"]),
                "relative_path": str(state["archive_relative_path"]),
            }
        ]

    extracted_files: list[dict[str, object]] = []
    for file_info in files_to_extract:
        workbook_path = Path(str(file_info["download_path"]))
        if not workbook_path.exists():
            raise SystemExit(f"Workbook was not found: {workbook_path}")

        workbook = pd.ExcelFile(workbook_path, engine="openpyxl")
        if "Input" not in workbook.sheet_names:
            raise SystemExit(f"Workbook does not contain an Input sheet: {workbook_path}")

        relative_path = str(file_info["relative_path"])
        dataframe = workbook.parse("Input", usecols="A:K")
        dataframe.columns = normalize_headers(dataframe.columns)
        player_series = dataframe.iloc[:, 1].astype("string")
        dataframe = dataframe[player_series.notna() & player_series.str.strip().ne("")].copy()
        dataframe["Source"] = workbook_path.name
        dataframe["SourcePath"] = relative_path

        csv_path = settings.extracted_root / Path(relative_path).with_suffix(".csv")
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        dataframe.to_csv(csv_path, index=False)
        extracted_files.append(
            {
                "workbook_path": str(workbook_path),
                "csv_path": str(csv_path),
                "csv_relative_path": relative_posix(csv_path, settings.extracted_root),
                "rows": int(len(dataframe)),
            }
        )

    state.update(
        {
            "csv_extracted_at": datetime.now().isoformat(timespec="seconds"),
            "extracted_csv_path": str(extracted_files[-1]["csv_path"]),
            "extracted_csv_relative_path": str(extracted_files[-1]["csv_relative_path"]),
            "extracted_csv_rows": int(extracted_files[-1]["rows"]),
            "extracted_csv_files": extracted_files,
            "extracted_csv_files_count": len(extracted_files),
        }
    )
    save_state(state)

    log(f"Extracted Input sheets to CSV for {len(extracted_files)} workbook(s).")
    log(f"- latest csv: {extracted_files[-1]['csv_path']}")
    log("Next: open the CSVs if you want to inspect them, then run rebuild_event_matchup_data.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
