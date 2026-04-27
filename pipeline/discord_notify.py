#!/usr/bin/env python3
"""Send a Pauper Dashboard update notification to Discord.

This script replaces the Discord notification part of the old GitHub Actions
workflow. It can be run after the data publish step succeeds.

Expected files:
- index.html
- data/aliases.json

Expected environment variables:
- DISCORD_WEBHOOK_1
- DISCORD_WEBHOOK_2
- DISCORD_WEBHOOK_3

Optional environment variables:
- EVENT_NAME
- BEFORE_SHA
- CURRENT_SHA
- DASHBOARD_BASE_URL
- WAIT_FOR_LIVE_SITE
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Iterable


DEFAULT_DASHBOARD_BASE_URL = "https://fnpavel.github.io/pauperdata/"
DEFAULT_USERNAME = "Pauper Dashboard Updates"
DATA_PATTERNS = ("data/**",)


def log(message: str) -> None:
    print(message, flush=True)


def run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def get_changed_files(event_name: str, before_sha: str, current_sha: str) -> list[str]:
    if event_name == "workflow_dispatch":
        return ["<manual-dispatch>"]

    if not before_sha or set(before_sha) == {"0"}:
        output = run_git("ls-tree", "-r", "--name-only", current_sha)
    else:
        output = run_git("diff", "--name-only", before_sha, current_sha)

    return [line.strip() for line in output.splitlines() if line.strip()]


def should_notify(changed_files: Iterable[str], patterns: Iterable[str] = DATA_PATTERNS) -> bool:
    changed_files = list(changed_files)
    if "<manual-dispatch>" in changed_files:
        return True

    return any(
        fnmatch.fnmatch(path, pattern)
        for path in changed_files
        for pattern in patterns
    )


def read_thumbnail_version(index_path: Path) -> str:
    html = index_path.read_text(encoding="utf-8")
    match = re.search(r'thumbnail\.png\?v=([^"]+)', html)

    if not match:
        raise RuntimeError(f"Could not find thumbnail version in {index_path}.")

    return match.group(1).strip()


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "pauper-dashboard-discord-notify",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_status(url: str) -> int:
    request = urllib.request.Request(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "pauper-dashboard-discord-notify",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read(1)
        return response.status


def wait_for_live_site(base_url: str, thumbnail_version: str, timeout_seconds: int = 600) -> None:
    base_url = base_url.rstrip("/") + "/"
    index_url = base_url
    expected_token = f"thumbnail.png?v={thumbnail_version}"
    expected_thumbnail_url = f"{base_url}thumbnail.png?v={thumbnail_version}"
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        try:
            index_html = fetch_text(index_url)
            index_ready = expected_token in index_html
            thumbnail_status = fetch_status(expected_thumbnail_url)
            thumbnail_ready = thumbnail_status == 200
        except urllib.error.HTTPError as exc:
            log(f"Live-site check not ready yet: HTTP {exc.code}")
        except urllib.error.URLError as exc:
            log(f"Live-site check not ready yet: {exc}")
        else:
            log(
                f"live_index_has_version={index_ready} "
                f"live_thumbnail_status={thumbnail_status}"
            )
            if index_ready and thumbnail_ready:
                log("Live site is serving the expected thumbnail version.")
                return

        time.sleep(10)

    raise TimeoutError(
        f"Timed out waiting for the live site to serve thumbnail version {thumbnail_version}."
    )


def build_payload(aliases_path: Path, thumbnail_version: str, dashboard_base_url: str) -> dict[str, str]:
    if not aliases_path.exists():
        raise FileNotFoundError(f"Aliases file not found: {aliases_path}")

    aliases = json.loads(aliases_path.read_text(encoding="utf-8"))

    event_type = str(aliases.get("last_updated_event_type") or "").strip()
    event_date = str(aliases.get("last_updated_event_date") or "").strip()

    if not event_type or not event_date:
        raise RuntimeError(
            "aliases.json is missing last_updated_event_type or last_updated_event_date."
        )

    try:
        formatted_date = datetime.strptime(event_date, "%Y-%m-%d").strftime("%d %B %Y")
    except ValueError as exc:
        raise RuntimeError(
            f"Invalid last_updated_event_date in aliases.json: {event_date}"
        ) from exc

    dashboard_url = f"{dashboard_base_url.rstrip('/')}/?v={thumbnail_version}"

    if event_type.lower() == "challenge":
        message = (
            f"Dashboard was updated with the {event_type} of {formatted_date}. "
            f"\nData provided by Kirblinxy.\n{dashboard_url}"
        )
    else:
        message = (
            f"Dashboard was updated with the {event_type} of {formatted_date}.\n"
            f"{dashboard_url}"
        )

    return {
        "username": DEFAULT_USERNAME,
        "content": message,
    }


def send_to_discord(webhook_url: str, payload: dict[str, str]) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        webhook_url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "pauper-dashboard-discord-notify",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()
        if response.status >= 400:
            raise RuntimeError(f"Discord webhook returned HTTP {response.status}")


def collect_webhooks() -> list[str]:
    return [
        value.strip()
        for key in ("DISCORD_WEBHOOK_1", "DISCORD_WEBHOOK_2", "DISCORD_WEBHOOK_3")
        if (value := os.environ.get(key, "")).strip()
    ]

def mask_secret(value: str) -> str:
    if not value:
        return "<missing>"
    if len(value) <= 8:
        return "<set>"
    return f"{value[:4]}...{value[-4:]}"


def debug_environment(args: argparse.Namespace) -> None:
    log("Debug environment:")
    log(f"- cwd: {Path.cwd()}")
    log(f"- index_path: {Path(args.index_path).resolve()} exists={Path(args.index_path).exists()}")
    log(f"- aliases_path: {Path(args.aliases_path).resolve()} exists={Path(args.aliases_path).exists()}")
    log(f"- dashboard_base_url: {args.dashboard_base_url}")
    log(f"- EVENT_NAME/GITHUB_EVENT_NAME: {os.environ.get('EVENT_NAME') or os.environ.get('GITHUB_EVENT_NAME') or '<missing>'}")
    log(f"- BEFORE_SHA: {os.environ.get('BEFORE_SHA') or '<missing>'}")
    log(f"- CURRENT_SHA/GITHUB_SHA: {os.environ.get('CURRENT_SHA') or os.environ.get('GITHUB_SHA') or '<missing>'}")

    for key in ("DISCORD_WEBHOOK_1", "DISCORD_WEBHOOK_2", "DISCORD_WEBHOOK_3"):
        log(f"- {key}: {mask_secret(os.environ.get(key, ''))}")

    try:
        branch = run_git("branch", "--show-current").strip()
        commit = run_git("log", "-1", "--oneline").strip()
        log(f"- git_branch: {branch or '<detached>'}")
        log(f"- git_commit: {commit}")
    except Exception as exc:
        log(f"- git_info_error: {exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Notify Discord about a Pauper Dashboard update.")
    parser.add_argument("--index-path", default="index.html")
    parser.add_argument("--aliases-path", default="data/aliases.json")
    parser.add_argument("--dashboard-base-url", default=os.environ.get("DASHBOARD_BASE_URL", DEFAULT_DASHBOARD_BASE_URL))
    parser.add_argument("--skip-change-detection", action="store_true")
    parser.add_argument("--skip-live-site-wait", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--debug", action="store_true", help="Print Docker/CI diagnostics and the computed payload without sending.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.debug:
        args.dry_run = True
        args.skip_live_site_wait = True
        debug_environment(args)

    event_name = os.environ.get("EVENT_NAME") or os.environ.get("GITHUB_EVENT_NAME") or ""
    before_sha = os.environ.get("BEFORE_SHA") or ""
    current_sha = os.environ.get("CURRENT_SHA") or os.environ.get("GITHUB_SHA") or "HEAD"

    if not args.skip_change_detection:
        changed_files = get_changed_files(event_name, before_sha, current_sha)
        log("Changed files:")
        for path in changed_files:
            log(f"- {path}")

        if not should_notify(changed_files):
            log("No data changes detected. Discord notification skipped.")
            return 0

    thumbnail_version = read_thumbnail_version(Path(args.index_path))
    log(f"thumbnail_version={thumbnail_version}")

    if not args.skip_live_site_wait:
        wait_for_live_site(
            base_url=args.dashboard_base_url,
            thumbnail_version=thumbnail_version,
            timeout_seconds=args.timeout_seconds,
        )

    payload = build_payload(
        aliases_path=Path(args.aliases_path),
        thumbnail_version=thumbnail_version,
        dashboard_base_url=args.dashboard_base_url,
    )

    if args.dry_run:
        log(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    webhooks = collect_webhooks()
    if not webhooks:
        raise RuntimeError("No Discord webhooks found. Set DISCORD_WEBHOOK_1, DISCORD_WEBHOOK_2, or DISCORD_WEBHOOK_3.")

    for index, webhook_url in enumerate(webhooks, start=1):
        send_to_discord(webhook_url, payload)
        log(f"Sent Discord notification to webhook {index}.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
