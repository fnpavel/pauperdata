#!/usr/bin/env python3
"""GitHub Actions entrypoint for the Drive sync and rebuild pipeline."""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
from pathlib import Path

from pipeline_env import ManagedPipelineConfig, load_automation_settings

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PIPELINE_ENTRYPOINT = PROJECT_ROOT / "scripts" / "automatedpipeline" / "sync_drive_and_rebuild_all.py"


def resolve_pipeline_command(argv: list[str]) -> list[str]:
    if argv:
        return argv

    command_text = str(os.environ.get("PIPELINE_COMMAND", "sync")).strip()
    return shlex.split(command_text) if command_text else ["sync"]


def main() -> int:
    command_parts = resolve_pipeline_command(sys.argv[1:])
    settings = load_automation_settings()

    print("Preparing temporary pipeline configuration for CI...")
    print(f"- command: {' '.join(command_parts)}")
    print(f"- remote: {settings.remote}")
    print(f"- data branch: {settings.data_branch}")
    print(f"- main branch: {settings.main_branch}")

    with ManagedPipelineConfig(settings):
        result = subprocess.run(
            [sys.executable, str(PIPELINE_ENTRYPOINT), *command_parts],
            cwd=str(PROJECT_ROOT),
            text=True,
            check=False,
        )

    return int(result.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
