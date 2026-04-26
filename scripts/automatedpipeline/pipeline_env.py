#!/usr/bin/env python3
"""Helpers for running the data pipeline from GitHub Actions."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PIPELINE_ROOT = PROJECT_ROOT / "scripts" / "automatedpipeline"
PIPELINE_CONFIG_PATH = PIPELINE_ROOT / "pipeline-config.json"


def _read_env(name: str, *, default: str = "", required: bool = False) -> str:
    value = str(os.environ.get(name, default)).strip()
    if required and not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def _read_service_account_payload() -> dict[str, Any]:
    raw_value = _read_env("GOOGLE_SERVICE_ACCOUNT_JSON", required=True)
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise SystemExit("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.") from exc

    if not isinstance(payload, dict):
        raise SystemExit("GOOGLE_SERVICE_ACCOUNT_JSON must decode to a JSON object.")

    required_keys = ("type", "client_email", "private_key")
    missing_keys = [key for key in required_keys if not str(payload.get(key, "")).strip()]
    if missing_keys:
        raise SystemExit(
            "GOOGLE_SERVICE_ACCOUNT_JSON is missing required keys: "
            + ", ".join(missing_keys)
        )

    return payload


@dataclass(frozen=True)
class AutomationSettings:
    drive_folder_id: str
    remote: str
    data_branch: str
    main_branch: str
    commit_message_template: str
    service_account_payload: dict[str, Any]


def load_automation_settings() -> AutomationSettings:
    return AutomationSettings(
        drive_folder_id=_read_env("GOOGLE_DRIVE_FOLDER_ID", required=True),
        remote=_read_env("PIPELINE_REMOTE", default="origin"),
        data_branch=_read_env("PIPELINE_DATA_BRANCH", default="data-updates"),
        main_branch=_read_env("PIPELINE_MAIN_BRANCH", default="main"),
        commit_message_template=_read_env(
            "PIPELINE_COMMIT_MESSAGE_TEMPLATE",
            default="chore(data): import {workbook_name}",
        ),
        service_account_payload=_read_service_account_payload(),
    )


class ManagedPipelineConfig:
    """Temporarily writes the pipeline config file expected by the pipeline scripts."""

    def __init__(self, settings: AutomationSettings) -> None:
        self.settings = settings
        self._temp_dir_obj: tempfile.TemporaryDirectory[str] | None = None
        self._original_config_text: str | None = None
        self._had_original_config = PIPELINE_CONFIG_PATH.exists()
        self.credentials_path: Path | None = None

    def __enter__(self) -> "ManagedPipelineConfig":
        PIPELINE_ROOT.mkdir(parents=True, exist_ok=True)

        if self._had_original_config:
            self._original_config_text = PIPELINE_CONFIG_PATH.read_text(encoding="utf-8")

        self._temp_dir_obj = tempfile.TemporaryDirectory(prefix="pauper-dashboard-pipeline-")
        temp_dir = Path(self._temp_dir_obj.name)
        self.credentials_path = temp_dir / "google-service-account.json"
        self.credentials_path.write_text(
            json.dumps(self.settings.service_account_payload, indent=2) + "\n",
            encoding="utf-8",
        )

        config_payload = {
            "credentials_path": str(self.credentials_path),
            "drive_folder_id": self.settings.drive_folder_id,
            "remote": self.settings.remote,
            "data_branch": self.settings.data_branch,
            "main_branch": self.settings.main_branch,
            "commit_message_template": self.settings.commit_message_template,
        }
        PIPELINE_CONFIG_PATH.write_text(
            json.dumps(config_payload, indent=2) + "\n",
            encoding="utf-8",
        )
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._had_original_config and self._original_config_text is not None:
            PIPELINE_CONFIG_PATH.write_text(self._original_config_text, encoding="utf-8")
        else:
            PIPELINE_CONFIG_PATH.unlink(missing_ok=True)

        if self._temp_dir_obj is not None:
            self._temp_dir_obj.cleanup()
