"""Build a compact event-update log and optionally post it to Discord."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from itertools import groupby
from pathlib import Path
from typing import Any
from urllib import error, request

from pipeline_common import LEARNING_ROOT, PROJECT_ROOT, load_settings, load_state, log, save_state

EVENTS_PATH = PROJECT_ROOT / "data" / "events.json"
RESULTS_PATH = PROJECT_ROOT / "data" / "results.json"
MATCHUP_EVENTS_PATH = PROJECT_ROOT / "data" / "matchups" / "events.json"
ELO_MANIFEST_PATH = PROJECT_ROOT / "data" / "elo-data" / "manifest.js"

DEFAULT_STARTING_RATING = 1500.0
DEFAULT_K_FACTOR = 16.0
DEFAULT_TOP_MOVER_COUNT = 3
UNKNOWN_DECK_VALUES = {"", "unknown", "no show"}
JS_EXPORT_PREFIX_RE = re.compile(r"^export const (?P<name>[A-Za-z0-9_]+) = ", re.MULTILINE)
DISCORD_USERNAME = "MTG Tracker Pipeline"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a compact event-update log from the latest imported event(s) and optionally post it to Discord."
        )
    )
    parser.add_argument(
        "--event-id",
        action="append",
        default=[],
        help="Explicit event_id to summarize. Repeat for multiple events. Defaults to the latest imported workbook(s).",
    )
    parser.add_argument(
        "--top-movers",
        type=int,
        default=DEFAULT_TOP_MOVER_COUNT,
        help=f"How many Elo gainers and losers to include per event. Defaults to {DEFAULT_TOP_MOVER_COUNT}.",
    )
    parser.add_argument(
        "--log-path",
        default="",
        help="Optional override for the generated JSON log path.",
    )
    parser.add_argument(
        "--post-discord",
        action="store_true",
        help="Post the generated summary to the configured Discord webhook and fail if delivery fails.",
    )
    parser.add_argument(
        "--post-discord-if-configured",
        action="store_true",
        help="Post to Discord only when a webhook URL is configured. Delivery errors are logged but do not fail.",
    )
    return parser.parse_args()


def normalize_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_relative_path(value: object) -> str:
    return normalize_text(value).replace("\\", "/").lstrip("./")


def normalize_player_lookup(value: object) -> str:
    return normalize_text(value).casefold()


def is_valid_deck_name(value: object) -> bool:
    return normalize_text(value).casefold() not in UNKNOWN_DECK_VALUES


def load_json_array(path: Path) -> list[dict[str, Any]]:
    raw_value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw_value, list):
        raise SystemExit(f"Expected a JSON array in {path}")
    return [row for row in raw_value if isinstance(row, dict)]


def load_exported_const_json(path: Path, expected_name: str) -> Any:
    raw_text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    match = JS_EXPORT_PREFIX_RE.match(raw_text)
    if not match or match.group("name") != expected_name:
        raise SystemExit(f"Unexpected export format in {path}")

    payload_text = raw_text[match.end():].strip()
    if payload_text.endswith(";"):
        payload_text = payload_text[:-1]

    return json.loads(payload_text)


def resolve_target_event_ids(
    explicit_event_ids: list[str],
    state: dict[str, Any],
    matchup_events: list[dict[str, Any]],
    normalized_events: list[dict[str, Any]],
) -> list[str]:
    explicit = [normalize_text(value) for value in explicit_event_ids if normalize_text(value)]
    if explicit:
        return list(dict.fromkeys(explicit))

    event_ids: list[str] = []
    event_ids_by_source_path: dict[str, list[str]] = defaultdict(list)
    for row in matchup_events:
        source_path = normalize_relative_path(row.get("source_path"))
        event_id = normalize_text(row.get("event_id"))
        if source_path and event_id:
            event_ids_by_source_path[source_path].append(event_id)

    downloaded_files = state.get("downloaded_files")
    if isinstance(downloaded_files, list):
        for item in downloaded_files:
            if not isinstance(item, dict):
                continue
            source_path = normalize_relative_path(item.get("relative_path"))
            event_ids.extend(event_ids_by_source_path.get(source_path, []))

    if not event_ids:
        source_path = normalize_relative_path(state.get("downloaded_relative_path"))
        if source_path:
            event_ids.extend(event_ids_by_source_path.get(source_path, []))

    if event_ids:
        return list(dict.fromkeys(event_ids))

    if normalized_events:
        latest_event = sorted(
            normalized_events,
            key=lambda row: (
                normalize_text(row.get("date")),
                normalize_text(row.get("event_id")),
            ),
            reverse=True,
        )[0]
        latest_event_id = normalize_text(latest_event.get("event_id"))
        if latest_event_id:
            return [latest_event_id]

    raise SystemExit("No event IDs could be resolved for the Discord update log.")


def get_match_date(match: dict[str, Any]) -> str:
    return normalize_text(match.get("date") or match.get("Date"))


def get_calendar_year(date_string: str = "") -> str:
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_string):
        return date_string[:4]

    try:
        parsed = datetime.fromisoformat(date_string)
    except ValueError:
        return ""
    return str(parsed.year)


def get_sort_value(match: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        value = normalize_text(match.get(key))
        if value:
            return value
    return ""


def get_round_value(match: dict[str, Any]) -> float:
    try:
        round_value = float(match.get("round"))
    except (TypeError, ValueError):
        return math.inf
    return round_value if math.isfinite(round_value) else math.inf


def get_result_score(match: dict[str, Any]) -> float | None:
    outcome = normalize_text(match.get("outcome")).lower()
    if outcome == "player_a_win":
        return 1.0
    if outcome == "player_b_win":
        return 0.0
    if outcome == "draw":
        return 0.5

    result_type = normalize_text(match.get("result_type")).lower()
    if result_type == "win":
        return 1.0
    if result_type == "loss":
        return 0.0
    if result_type == "draw":
        return 0.5

    try:
        games_a = float(match.get("games_a"))
        games_b = float(match.get("games_b"))
    except (TypeError, ValueError):
        games_a = None
        games_b = None

    if games_a is not None and games_b is not None:
        if games_a > games_b:
            return 1.0
        if games_a < games_b:
            return 0.0
        return 0.5

    return None


def is_rated_match(match: dict[str, Any]) -> bool:
    player_key = normalize_text(match.get("player_a_key") or match.get("player_key"))
    opponent_key = normalize_text(match.get("player_b_key") or match.get("opponent_key"))
    result_type = normalize_text(match.get("result_type")).lower()
    outcome = normalize_text(match.get("outcome")).lower()
    pairing_quality = normalize_text(match.get("pairing_quality")).lower()

    if not player_key or not opponent_key or player_key == opponent_key:
        return False

    if match.get("is_bye") or result_type in {"bye", "unknown"} or outcome == "unknown":
        return False

    if pairing_quality == "conflict":
        return False

    return get_result_score(match) is not None


def compare_match_key(indexed_match: tuple[int, dict[str, Any]]) -> tuple[Any, ...]:
    index, match = indexed_match
    return (
        get_match_date(match),
        get_sort_value(match, ["event_id", "eventId", "event"]),
        get_round_value(match),
        get_sort_value(match, ["pair_key", "pairKey"]),
        index,
    )


def calculate_elo_rating_delta(rating_a: float, rating_b: float, score_a: float) -> float:
    expected_score_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    return DEFAULT_K_FACTOR * (score_a - expected_score_a)


def build_batch_key(match: dict[str, Any]) -> tuple[str, str, str, float]:
    return (
        get_calendar_year(get_match_date(match)) or "unknown-year",
        get_match_date(match),
        get_sort_value(match, ["event_id", "eventId", "event"]),
        get_round_value(match),
    )


def ensure_season_player_state(
    season_states: dict[str, dict[str, dict[str, Any]]],
    season_key: str,
    player_key: str,
    player_name: str,
) -> dict[str, Any]:
    season_bucket = season_states.setdefault(season_key, {})
    player_state = season_bucket.setdefault(
        player_key,
        {
            "rating": DEFAULT_STARTING_RATING,
            "display_name": player_name or player_key,
        },
    )
    if player_name:
        player_state["display_name"] = player_name
    return player_state


def ensure_event_player_aggregate(
    event_aggregates: dict[str, dict[str, dict[str, Any]]],
    event_id: str,
    player_key: str,
    player_name: str,
) -> dict[str, Any]:
    event_bucket = event_aggregates.setdefault(event_id, {})
    aggregate = event_bucket.setdefault(
        player_key,
        {
            "player_key": player_key,
            "player": player_name or player_key,
            "deck": "",
            "delta": 0.0,
            "rating_before": None,
            "rating_after": None,
            "match_count": 0,
            "result_rank": None,
            "wins": None,
            "losses": None,
        },
    )
    if player_name:
        aggregate["player"] = player_name
    return aggregate


def update_player_aggregate(
    aggregate: dict[str, Any],
    *,
    deck_name: str,
    rating_before: float,
    rating_after: float,
    delta: float,
) -> None:
    if aggregate["rating_before"] is None:
        aggregate["rating_before"] = rating_before
    aggregate["rating_after"] = rating_after
    aggregate["delta"] += delta
    aggregate["match_count"] += 1
    if is_valid_deck_name(deck_name):
        aggregate["deck"] = normalize_text(deck_name)


def load_elo_matches_for_years(years: list[str]) -> list[dict[str, Any]]:
    if not ELO_MANIFEST_PATH.exists():
        raise SystemExit(f"Missing Elo manifest: {ELO_MANIFEST_PATH}")

    manifest = load_exported_const_json(ELO_MANIFEST_PATH, "eloManifest")
    if not isinstance(manifest, dict):
        raise SystemExit(f"Expected an object in {ELO_MANIFEST_PATH}")

    files_by_year = manifest.get("filesByYear") or {}
    if not isinstance(files_by_year, dict):
        files_by_year = {}

    matches: list[dict[str, Any]] = []
    for year in years:
        relative_path = normalize_text(files_by_year.get(year) or f"./{year}.js")
        if not relative_path:
            continue
        year_path = (ELO_MANIFEST_PATH.parent / relative_path).resolve()
        year_matches = load_exported_const_json(year_path, "eloMatches")
        if isinstance(year_matches, list):
            matches.extend(match for match in year_matches if isinstance(match, dict))

    return matches


def build_result_row_lookup(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for row in rows:
        player_lookup = normalize_player_lookup(row.get("player"))
        if player_lookup and player_lookup not in lookup:
            lookup[player_lookup] = row
    return lookup


def build_elo_aggregates(
    target_event_ids: list[str],
    event_rows_by_id: dict[str, dict[str, Any]],
    result_rows_by_event: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    target_years = sorted(
        {
            normalize_text((event_rows_by_id.get(event_id) or {}).get("year"))
            or get_calendar_year(normalize_text((event_rows_by_id.get(event_id) or {}).get("date")))
            for event_id in target_event_ids
        }
        - {""}
    )
    all_matches = load_elo_matches_for_years(target_years)
    sorted_matches = [
        match
        for _, match in sorted(
            ((index, match) for index, match in enumerate(all_matches) if is_rated_match(match)),
            key=compare_match_key,
        )
    ]

    event_aggregates: dict[str, dict[str, dict[str, Any]]] = {event_id: {} for event_id in target_event_ids}
    season_states: dict[str, dict[str, dict[str, Any]]] = {}

    for _, grouped_matches in groupby(sorted_matches, key=build_batch_key):
        batch_matches = list(grouped_matches)
        pending_updates: list[dict[str, Any]] = []

        for match in batch_matches:
            season_key = get_calendar_year(get_match_date(match)) or "unknown-year"
            player_key = normalize_text(match.get("player_a_key") or match.get("player_key"))
            opponent_key = normalize_text(match.get("player_b_key") or match.get("opponent_key"))
            player_name = normalize_text(match.get("player_a") or match.get("player"))
            opponent_name = normalize_text(match.get("player_b") or match.get("opponent"))
            player_state = ensure_season_player_state(season_states, season_key, player_key, player_name)
            opponent_state = ensure_season_player_state(season_states, season_key, opponent_key, opponent_name)
            player_rating_before = float(player_state["rating"])
            opponent_rating_before = float(opponent_state["rating"])
            player_score = get_result_score(match)
            if player_score is None:
                continue

            delta = calculate_elo_rating_delta(player_rating_before, opponent_rating_before, player_score)
            pending_updates.append(
                {
                    "match": match,
                    "player_state": player_state,
                    "opponent_state": opponent_state,
                    "player_rating_before": player_rating_before,
                    "opponent_rating_before": opponent_rating_before,
                    "player_rating_after": player_rating_before + delta,
                    "opponent_rating_after": opponent_rating_before - delta,
                    "player_delta": delta,
                }
            )

        for update in pending_updates:
            update["player_state"]["rating"] = update["player_rating_after"]
            update["opponent_state"]["rating"] = update["opponent_rating_after"]

            event_id = normalize_text(update["match"].get("event_id") or update["match"].get("eventId"))
            if event_id not in event_aggregates:
                continue

            player_aggregate = ensure_event_player_aggregate(
                event_aggregates,
                event_id,
                normalize_text(update["match"].get("player_a_key") or update["match"].get("player_key")),
                normalize_text(update["match"].get("player_a") or update["match"].get("player")),
            )
            update_player_aggregate(
                player_aggregate,
                deck_name=normalize_text(update["match"].get("deck_a")),
                rating_before=update["player_rating_before"],
                rating_after=update["player_rating_after"],
                delta=update["player_delta"],
            )

            opponent_aggregate = ensure_event_player_aggregate(
                event_aggregates,
                event_id,
                normalize_text(update["match"].get("player_b_key") or update["match"].get("opponent_key")),
                normalize_text(update["match"].get("player_b") or update["match"].get("opponent")),
            )
            update_player_aggregate(
                opponent_aggregate,
                deck_name=normalize_text(update["match"].get("deck_b")),
                rating_before=update["opponent_rating_before"],
                rating_after=update["opponent_rating_after"],
                delta=-update["player_delta"],
            )

    enriched_aggregates: dict[str, list[dict[str, Any]]] = {}
    for event_id in target_event_ids:
        player_lookup = build_result_row_lookup(result_rows_by_event.get(event_id, []))
        enriched_rows: list[dict[str, Any]] = []
        for aggregate in event_aggregates.get(event_id, {}).values():
            result_row = player_lookup.get(normalize_player_lookup(aggregate["player"]))
            if result_row:
                if is_valid_deck_name(result_row.get("deck")):
                    aggregate["deck"] = normalize_text(result_row.get("deck"))
                aggregate["result_rank"] = result_row.get("rank")
                aggregate["wins"] = result_row.get("wins")
                aggregate["losses"] = result_row.get("losses")

            enriched_rows.append(
                {
                    "player": aggregate["player"],
                    "player_key": aggregate["player_key"],
                    "deck": aggregate["deck"] or None,
                    "delta": round(float(aggregate["delta"]), 3),
                    "rating_before": round(float(aggregate["rating_before"] or DEFAULT_STARTING_RATING), 3),
                    "rating_after": round(float(aggregate["rating_after"] or DEFAULT_STARTING_RATING), 3),
                    "match_count": int(aggregate["match_count"]),
                    "result_rank": int(aggregate["result_rank"]) if aggregate["result_rank"] not in (None, "") else None,
                    "wins": int(aggregate["wins"]) if aggregate["wins"] not in (None, "") else None,
                    "losses": int(aggregate["losses"]) if aggregate["losses"] not in (None, "") else None,
                }
            )

        enriched_aggregates[event_id] = enriched_rows

    return enriched_aggregates


def format_record(row: dict[str, Any] | None) -> str | None:
    if not row:
        return None
    wins = row.get("wins")
    losses = row.get("losses")
    if wins in (None, "") or losses in (None, ""):
        return None
    return f"{wins}-{losses}"


def summarize_most_popular_deck(rows: list[dict[str, Any]]) -> dict[str, Any]:
    valid_rows = [row for row in rows if is_valid_deck_name(row.get("deck"))]
    deck_counts = Counter(normalize_text(row.get("deck")) for row in valid_rows)
    if not deck_counts:
        return {
            "deck_names": [],
            "copy_count": 0,
        }

    copy_count = max(deck_counts.values())
    deck_names = sorted(deck_name for deck_name, count in deck_counts.items() if count == copy_count)
    return {
        "deck_names": deck_names,
        "copy_count": copy_count,
    }


def build_rank_entry(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "player": normalize_text(row.get("player")),
        "deck": normalize_text(row.get("deck")) or None,
        "rank": int(row.get("rank")) if row.get("rank") not in (None, "") else None,
        "wins": int(row.get("wins")) if row.get("wins") not in (None, "") else None,
        "losses": int(row.get("losses")) if row.get("losses") not in (None, "") else None,
        "record": format_record(row),
    }


def row_has_rank(row: dict[str, Any], rank: int) -> bool:
    try:
        return int(row.get("rank")) == rank
    except (TypeError, ValueError):
        return False


def select_top_movers(rows: list[dict[str, Any]], count: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    gainers = sorted(
        [row for row in rows if float(row.get("delta") or 0) > 0],
        key=lambda row: (-float(row["delta"]), normalize_player_lookup(row.get("player"))),
    )[:count]
    losers = sorted(
        [row for row in rows if float(row.get("delta") or 0) < 0],
        key=lambda row: (float(row["delta"]), normalize_player_lookup(row.get("player"))),
    )[:count]
    return gainers, losers


def format_mover_row(row: dict[str, Any]) -> str:
    deck_name = normalize_text(row.get("deck"))
    deck_suffix = f" / {deck_name}" if deck_name else ""
    return f"{row['player']}{deck_suffix} ({row['delta']:+.1f})"


def format_rank_text(entry: dict[str, Any] | None) -> str:
    if not entry:
        return "--"
    parts = [normalize_text(entry.get("player")) or "--"]
    deck_name = normalize_text(entry.get("deck"))
    if deck_name:
        parts.append(deck_name)
    record = normalize_text(entry.get("record"))
    if record:
        parts.append(record)
    return " / ".join(parts)


def format_most_popular_deck_text(summary: dict[str, Any]) -> str:
    deck_names = summary.get("deck_names") or []
    copy_count = int(summary.get("copy_count") or 0)
    if not deck_names or copy_count <= 0:
        return "--"

    deck_label = ", ".join(deck_names)
    copy_label = "copy" if copy_count == 1 else "copies"
    suffix = "each" if len(deck_names) > 1 else ""
    return f"{deck_label} ({copy_count} {copy_label}{f' {suffix}' if suffix else ''})"


def build_discord_message(event_summaries: list[dict[str, Any]]) -> str:
    header = "New data added." if len(event_summaries) == 1 else f"New data added for {len(event_summaries)} events."
    sections = [header]

    for summary in event_summaries:
        gainers = summary["elo"]["top_gainers"]
        losers = summary["elo"]["top_losers"]
        sections.append(
            "\n".join(
                [
                    "",
                    f"{summary['display_name']} - {summary['date']} ({summary['total_players']} players)",
                    f"Winner: {format_rank_text(summary.get('winner'))}",
                    f"Runner-up: {format_rank_text(summary.get('runner_up'))}",
                    f"Most popular deck: {format_most_popular_deck_text(summary.get('most_popular_deck', {}))}",
                    "Elo up: " + (", ".join(format_mover_row(row) for row in gainers) if gainers else "--"),
                    "Elo down: " + (", ".join(format_mover_row(row) for row in losers) if losers else "--"),
                ]
            )
        )

    return "\n".join(sections).strip()


def post_to_discord(webhook_url: str, message: str) -> dict[str, Any]:
    payload = json.dumps({"username": DISCORD_USERNAME, "content": message}).encode("utf-8")
    discord_request = request.Request(
        webhook_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(discord_request, timeout=15) as response:
        return {
            "status": int(getattr(response, "status", 0) or 0),
            "reason": getattr(response, "reason", ""),
        }


def main() -> int:
    args = parse_args()
    settings = load_settings()
    state = load_state()
    log_path = Path(args.log_path).expanduser().resolve() if args.log_path else settings.discord_log_path
    log_path.parent.mkdir(parents=True, exist_ok=True)

    normalized_events = load_json_array(EVENTS_PATH)
    matchup_events = load_json_array(MATCHUP_EVENTS_PATH)
    result_rows = load_json_array(RESULTS_PATH)

    target_event_ids = resolve_target_event_ids(args.event_id, state, matchup_events, normalized_events)
    event_rows_by_id = {
        normalize_text(row.get("event_id")): row
        for row in normalized_events
        if normalize_text(row.get("event_id"))
    }
    matchup_events_by_id = {
        normalize_text(row.get("event_id")): row
        for row in matchup_events
        if normalize_text(row.get("event_id"))
    }
    result_rows_by_event: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in result_rows:
        event_id = normalize_text(row.get("event_id"))
        if event_id:
            result_rows_by_event[event_id].append(row)

    elo_aggregates = build_elo_aggregates(target_event_ids, event_rows_by_id, result_rows_by_event)
    top_movers = max(1, int(args.top_movers))
    event_summaries: list[dict[str, Any]] = []

    for event_id in target_event_ids:
        event_row = event_rows_by_id.get(event_id, {})
        matchup_row = matchup_events_by_id.get(event_id, {})
        event_result_rows = sorted(
            result_rows_by_event.get(event_id, []),
            key=lambda row: (
                int(row.get("rank")) if row.get("rank") not in (None, "") else 10**9,
                normalize_player_lookup(row.get("player")),
            ),
        )
        winner = build_rank_entry(next((row for row in event_result_rows if row_has_rank(row, 1)), None))
        runner_up = build_rank_entry(next((row for row in event_result_rows if row_has_rank(row, 2)), None))
        most_popular_deck = summarize_most_popular_deck(event_result_rows)
        gainers, losers = select_top_movers(elo_aggregates.get(event_id, []), top_movers)

        event_summaries.append(
            {
                "event_id": event_id,
                "date": normalize_text(event_row.get("date") or matchup_row.get("date")),
                "display_name": normalize_text(event_row.get("display_name") or matchup_row.get("event_display_name") or matchup_row.get("event") or event_id),
                "source_event_name": normalize_text(event_row.get("source_event_name") or matchup_row.get("event")),
                "event_type": normalize_text(event_row.get("event_type") or matchup_row.get("event_type")),
                "total_players": int(event_row.get("total_players") or matchup_row.get("player_count") or len(event_result_rows) or 0),
                "source_path": normalize_relative_path(matchup_row.get("source_path")),
                "source_workbook": normalize_text(matchup_row.get("source_workbook")),
                "winner": winner,
                "runner_up": runner_up,
                "most_popular_deck": most_popular_deck,
                "elo": {
                    "top_gainers": gainers,
                    "top_losers": losers,
                    "tracked_player_count": len(elo_aggregates.get(event_id, [])),
                },
            }
        )

    message = build_discord_message(event_summaries)
    output_payload: dict[str, Any] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "log_path": str(log_path),
        "event_count": len(event_summaries),
        "event_ids": [summary["event_id"] for summary in event_summaries],
        "discord_webhook_configured": bool(settings.discord_webhook_urls),
        "discord_webhook_count": len(settings.discord_webhook_urls),
        "discord_post_requested": bool(args.post_discord or args.post_discord_if_configured),
        "discord_posted": False,
        "discord_message": message,
        "events": event_summaries,
    }

    fatal_discord_delivery = bool(args.post_discord)
    should_attempt_discord = bool(args.post_discord or (args.post_discord_if_configured and settings.discord_webhook_urls))
    if should_attempt_discord:
        if not settings.discord_webhook_urls:
            raise SystemExit("Discord posting was requested, but no discord webhook is configured.")

        responses: list[dict[str, Any]] = []
        errors_by_webhook: list[dict[str, str]] = []
        for webhook_url in settings.discord_webhook_urls:
            try:
                response_summary = post_to_discord(webhook_url, message)
            except error.URLError as exc:
                errors_by_webhook.append(
                    {
                        "webhook_url": webhook_url,
                        "error": str(exc.reason or exc),
                    }
                )
                if fatal_discord_delivery:
                    output_payload["discord_errors"] = errors_by_webhook
                    log_path.write_text(json.dumps(output_payload, indent=2) + "\n", encoding="utf-8")
                    raise SystemExit(f"Discord delivery failed: {exc.reason or exc}") from exc
            else:
                responses.append(
                    {
                        "webhook_url": webhook_url,
                        **response_summary,
                    }
                )

        output_payload["discord_posted"] = len(responses) > 0 and len(errors_by_webhook) == 0
        output_payload["discord_post_partial"] = len(responses) > 0 and len(errors_by_webhook) > 0
        output_payload["discord_response"] = responses[0] if len(responses) == 1 else None
        output_payload["discord_responses"] = responses
        output_payload["discord_posted_at"] = datetime.now().isoformat(timespec="seconds") if responses else None
        if errors_by_webhook:
            output_payload["discord_errors"] = errors_by_webhook
            log("Discord delivery failed for one or more configured webhooks.")
    elif args.post_discord_if_configured and not settings.discord_webhook_urls:
        output_payload["discord_skip_reason"] = "webhook_not_configured"

    log_path.write_text(json.dumps(output_payload, indent=2) + "\n", encoding="utf-8")

    state.update(
        {
            "phase_04_discord_update_built_at": datetime.now().isoformat(timespec="seconds"),
            "discord_update_log_path": str(log_path),
            "discord_update_event_ids": output_payload["event_ids"],
            "discord_update_event_count": output_payload["event_count"],
            "discord_update_message_preview": message,
            "discord_webhook_configured": bool(settings.discord_webhook_urls),
            "discord_last_posted": output_payload["discord_posted"],
            "discord_last_posted_at": output_payload.get("discord_posted_at"),
        }
    )
    save_state(state)

    log(f"Wrote Discord update log: {log_path}")
    log(f"- events: {len(event_summaries)}")
    if output_payload["discord_posted"]:
        log(f"- Discord: posted to {len(settings.discord_webhook_urls)} webhook(s)")
    elif output_payload.get("discord_post_partial"):
        log("- Discord: partially posted")
    elif args.post_discord_if_configured and not settings.discord_webhook_urls:
        log("- Discord: skipped (webhook not configured)")
    elif args.post_discord or args.post_discord_if_configured:
        log("- Discord: not posted")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
