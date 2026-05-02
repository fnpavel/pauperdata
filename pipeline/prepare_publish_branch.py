#!/usr/bin/env python3
"""Prepare the configured publish branch for the pipeline."""

from __future__ import annotations

from pipeline_common import prepare_publish_branch
from pipeline_env import load_automation_settings


def main() -> int:
    settings = load_automation_settings()
    prepare_publish_branch(
        remote_name=settings.remote,
        base_branch=settings.main_branch,
        data_branch=settings.data_branch,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
