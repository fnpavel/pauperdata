#!/usr/bin/env python3
"""Commit the pipeline data update on the configured data-updates branch, then fast-forward main."""

from __future__ import annotations

import argparse
from datetime import datetime

from pipeline_common import (
    DEFAULT_COMMIT_PATHS,
    PROJECT_ROOT,
    build_commit_message,
    current_branch,
    load_settings,
    load_state,
    log,
    run_git,
    save_state,
    tracked_changed_files,
)

THUMBNAIL_COMMIT_PATH = PROJECT_ROOT / "thumbnail.png"
INDEX_COMMIT_PATH = PROJECT_ROOT / "index.html"

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Commit the generated data update and publish it to git.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without changing git state.")
    return parser.parse_args()


def untracked_files() -> set[str]:
    output = run_git("ls-files", "--others", "--exclude-standard")
    return {line.strip() for line in output.splitlines() if line.strip()}


def main() -> int:
    """Publish generated pipeline outputs from the data branch into main.

    - Refuses wrong-branch, unrelated-change, or untracked-file publishes.
    - Records explicit publish results in pipeline state so Discord can trust the outcome.
    - `--dry-run` shows the exact git path without mutating repository state.
    """
    args = parse_args()
    settings = load_settings()
    state = load_state()
    # Publish is intentionally narrow: only generated pipeline outputs plus the
    # derived thumbnail/index changes are allowed through this step.
    commit_paths = [
        str(path.relative_to(PROJECT_ROOT)) for path in [*DEFAULT_COMMIT_PATHS, THUMBNAIL_COMMIT_PATH, INDEX_COMMIT_PATH]
    ]

    branch = current_branch()
    if branch != settings.data_branch:
        raise SystemExit(
            f"Please switch to '{settings.data_branch}' before running the publish step.\n"
            "This keeps the publish step easy to understand and avoids moving uncommitted data changes across branches."
        )

    all_changed = tracked_changed_files()
    allowed_changed = tracked_changed_files(*commit_paths)
    unrelated_changes = sorted(all_changed.difference(allowed_changed))
    if unrelated_changes:
        raise SystemExit(
            "Refusing to publish because there are tracked changes outside the data files:\n"
            + "\n".join(f"- {path}" for path in unrelated_changes)
        )

    untracked = sorted(untracked_files())
    if untracked:
        raise SystemExit(
            "Refusing to publish because there are untracked files in the worktree:\n"
            + "\n".join(f"- {path}" for path in untracked)
        )

    if not allowed_changed:
        # Downstream notification logic reads these state keys, so "nothing to
        # publish" still needs an explicit state update instead of an early silent exit.
        state.update(
            {
                "published_at": None,
                "published_commit_message": "",
                "published_changed_files": [],
                "published_changed_files_count": 0,
                "published_any_changes": False,
                "main_publish_completed": False,
            }
        )
        save_state(state)
        log("No tracked data changes were found to publish.")
        return 0

    staged_paths = sorted(allowed_changed)
    commit_message = build_commit_message(settings.commit_message_template, state)
    if args.dry_run:
        log("Dry run: the publish step would publish the following data changes.")
        log(f"- branch: {branch}")
        log(f"- files: {', '.join(staged_paths)}")
        log(f"- commit message: {commit_message}")
        log(f"- allowed scopes: {', '.join(commit_paths)}")
        log(f"- would run: git add --all -- {' '.join(staged_paths)}")
        log(f"- would run: git commit -m {commit_message}")
        log(f"- would run: git push --force-with-lease {settings.remote} {settings.data_branch}")
        log(f"- would run: git checkout {settings.main_branch}")
        log(f"- would run: git pull --ff-only {settings.remote} {settings.main_branch}")
        log(f"- would run: git merge --ff-only {settings.data_branch}")
        log(f"- would run: git push {settings.remote} {settings.main_branch}")
        log(f"- would run: git checkout {settings.data_branch}")
        return 0

    run_git("add", "--all", "--", *staged_paths)
    run_git("commit", "-m", commit_message)
    run_git("push", "--force-with-lease", settings.remote, settings.data_branch)

    main_publish_completed = False
    try:
        run_git("checkout", settings.main_branch)
        run_git("pull", "--ff-only", settings.remote, settings.main_branch)
        run_git("merge", "--ff-only", settings.data_branch)
        run_git("push", settings.remote, settings.main_branch)
        main_publish_completed = True
    finally:
        run_git("checkout", settings.data_branch)

    state.update(
        {
            "published_at": datetime.now().isoformat(timespec="seconds"),
            "published_commit_message": commit_message,
            "published_changed_files": staged_paths,
            "published_changed_files_count": len(staged_paths),
            "published_any_changes": True,
            "main_publish_completed": main_publish_completed,
        }
    )
    save_state(state)

    if not main_publish_completed:
        raise SystemExit(
            f"Published to '{settings.data_branch}', but '{settings.main_branch}' was not updated.\n"
            "Review the git state and finish the fast-forward manually before considering the publish complete."
        )

    log("Git publish complete.")
    log(f"- committed on: {settings.data_branch}")
    log(f"- merged into: {settings.main_branch}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
