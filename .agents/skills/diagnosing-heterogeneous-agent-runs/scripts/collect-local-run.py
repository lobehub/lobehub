#!/usr/bin/env python3
"""Collect a redacted, read-only evidence index for a local LobeHub hetero-agent run."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator


DEFAULT_STORAGE_ROOT = (
    Path.home() / "Library" / "Application Support" / "LobeHub" / "lobehub-storage"
)
DEFAULT_LOG_FILE = Path.home() / "Library" / "Logs" / "LobeHub" / "main.log"
HETERO_DIRS = ("bindings", "files", "runs", "tracing")
LOG_TIMESTAMP = re.compile(r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]")
LOG_SIGNAL = re.compile(
    r"HeterogeneousAgent|GatewayConnection|NetworkProxy|networkProxy|WebSocket|TLS|proxy",
    re.IGNORECASE,
)
SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|key)"
    r"(\s*[:=]\s*)([^\s,}]+)"
)
BEARER_TOKEN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
SPAWN_ARGUMENTS = re.compile(r"(Spawning agent:)\s+.*?(\s+\(cwd:.*\))$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read local LobeHub cache, hetero-agent traces, and Desktop logs without mutating them."
    )
    parser.add_argument(
        "target",
        nargs="?",
        default="latest",
        help="LobeHub topic ID, native/Desktop session ID, or 'latest'",
    )
    parser.add_argument(
        "--storage-root",
        type=Path,
        default=Path(os.environ.get("LOBEHUB_STORAGE_ROOT", DEFAULT_STORAGE_ROOT)),
        help="Path containing local-database.sqlite3 and heteroAgent/",
    )
    trace_root = os.environ.get("LOBEHUB_HETERO_TRACE_ROOT")
    parser.add_argument(
        "--trace-root",
        type=Path,
        default=Path(trace_root) if trace_root else None,
        help="Override the trace directory, for example <cwd>/.heerogeneous-tracing in development",
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        default=Path(os.environ.get("LOBEHUB_MAIN_LOG", DEFAULT_LOG_FILE)),
        help="Path to the Desktop main.log",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def walk_json(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def redact_log_line(line: str) -> str:
    line = SPAWN_ARGUMENTS.sub(r"\1 [command arguments omitted]\2", line)
    line = BEARER_TOKEN.sub("Bearer [REDACTED]", line)
    return SECRET_ASSIGNMENT.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", line)


def safe_error_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return redact_log_line(value[:2_000])


def safe_error_value(value: Any) -> str | None:
    if isinstance(value, str):
        return safe_error_text(value)
    if isinstance(value, list):
        messages = [message for item in value if (message := safe_error_value(item))]
        return safe_error_text("\n".join(messages)) if messages else None
    if isinstance(value, dict):
        for key in ("message", "error", "detail", "details", "reason"):
            if message := safe_error_value(value.get(key)):
                return message
    return None


def summarize_error(value: Any) -> dict[str, Any] | str | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        return redact_log_line(str(value)[:2_000])

    body = value.get("body") if isinstance(value.get("body"), dict) else {}
    details = body.get("details") if isinstance(body.get("details"), dict) else {}
    safe_details = {
        key: details[key]
        for key in ("subtype", "numTurns", "durationMs", "sessionId", "expectedEventType")
        if key in details
    }
    result = {
        "type": value.get("type"),
        "message": safe_error_text(value.get("message")),
        "bodyError": safe_error_text(body.get("error")),
        "bodyCode": body.get("code"),
        "details": safe_details or None,
    }
    return {key: item for key, item in result.items() if item is not None}


def collect_native_session_ids(value: Any) -> set[str]:
    session_ids: set[str] = set()
    for node in walk_json(value):
        for key, item in node.items():
            if key in {"heteroSessionId", "agentSessionId", "resumeSessionId", "sessionId"}:
                if isinstance(item, str) and item:
                    session_ids.add(item)
            elif key == "heteroSessionIdByWorkingDirectory" and isinstance(item, dict):
                session_ids.update(entry for entry in item.values() if isinstance(entry, str) and entry)
    return session_ids


def sqlite_read_only(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    connection.execute("PRAGMA query_only = ON")
    return connection


def entity_freshness(value: dict[str, Any]) -> datetime:
    for key in ("updatedAt", "completedAt", "createdAt"):
        if timestamp := parse_iso(value.get(key)):
            return timestamp
    return datetime.min


def collect_topic_cache(database: Path, topic_id: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "database": str(database),
        "errors": [],
        "messageCount": 0,
        "messageRoles": {},
        "nativeSessionIds": [],
        "topic": None,
    }
    if not database.is_file():
        result["readError"] = "local database not found"
        return result

    try:
        with sqlite_read_only(database) as connection:
            rows = connection.execute(
                "SELECT value FROM local_records WHERE instr(id, ?) > 0 OR instr(value, ?) > 0",
                (topic_id, topic_id),
            ).fetchall()
    except sqlite3.Error as error:
        result["readError"] = str(error)
        return result

    topic: dict[str, Any] | None = None
    messages: dict[str, dict[str, Any]] = {}
    native_ids: set[str] = set()
    for (raw_value,) in rows:
        try:
            value = json.loads(raw_value)
        except (TypeError, json.JSONDecodeError):
            continue
        for node in walk_json(value):
            if (
                node.get("id") == topic_id
                and node.get("role") is None
                and any(key in node for key in ("provider", "status", "metadata"))
            ):
                if topic is None or entity_freshness(node) > entity_freshness(topic):
                    topic = node
            if node.get("topicId") == topic_id and isinstance(node.get("id"), str):
                existing = messages.get(node["id"])
                if existing is None or entity_freshness(node) > entity_freshness(existing):
                    messages[node["id"]] = node

    if topic:
        native_ids.update(collect_native_session_ids(topic))
        metadata = topic.get("metadata") if isinstance(topic.get("metadata"), dict) else {}
        working_dirs = sorted(
            {
                value
                for key, value in metadata.items()
                if key == "workingDirectory" and isinstance(value, str)
            }
        )
        by_dir = metadata.get("heteroSessionBindingKeyByWorkingDirectory")
        binding_keys = (
            sorted(value for value in by_dir.values() if isinstance(value, str))
            if isinstance(by_dir, dict)
            else []
        )
        result["topic"] = {
            "id": topic_id,
            "status": topic.get("status"),
            "provider": topic.get("provider"),
            "createdAt": topic.get("createdAt"),
            "updatedAt": topic.get("updatedAt"),
            "completedAt": topic.get("completedAt"),
            "workingDirectories": working_dirs,
            "bindingKeys": binding_keys,
        }

    role_counts = Counter(
        message.get("role") for message in messages.values() if isinstance(message.get("role"), str)
    )
    persisted_errors = []
    for message in messages.values():
        native_ids.update(collect_native_session_ids(message))
        if message.get("error") is None:
            continue
        persisted_errors.append(
            {
                "messageId": message.get("id"),
                "role": message.get("role"),
                "createdAt": message.get("createdAt"),
                "updatedAt": message.get("updatedAt"),
                "error": summarize_error(message.get("error")),
            }
        )

    result["messageCount"] = len(messages)
    result["messageRoles"] = dict(sorted(role_counts.items()))
    result["errors"] = sorted(persisted_errors, key=lambda item: item.get("createdAt") or "")
    result["nativeSessionIds"] = sorted(native_ids)
    return result


def collect_inventory(hetero_root: Path, trace_root: Path) -> dict[str, Any]:
    inventory: dict[str, Any] = {"root": str(hetero_root)}
    for name in HETERO_DIRS:
        path = trace_root if name == "tracing" else hetero_root / name
        entry: dict[str, Any] = {"exists": path.is_dir(), "path": str(path)}
        if path.is_dir():
            try:
                children = list(path.iterdir())
                entry["entryCount"] = len(children)
                entry["modifiedAt"] = datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat()
                if name == "bindings":
                    entry["agentTypes"] = sorted(child.name for child in children if child.is_dir())
                elif name == "files":
                    entry["metadataFiles"] = sum(child.suffix == ".meta" for child in children)
                elif name == "tracing":
                    agent_types = {
                        meta.get("agentType")
                        for meta_path in path.rglob("meta.json")
                        if isinstance((meta := read_json(meta_path)).get("agentType"), str)
                    }
                    entry["agentTypes"] = sorted(agent_types)
            except OSError as error:
                entry["readError"] = str(error)
        inventory[name] = entry
    return inventory


def event_session_ids(event: dict[str, Any]) -> list[str]:
    session_ids: list[str] = []
    for key in ("session_id", "thread_id", "sessionId", "sessionID"):
        value = event.get(key)
        if isinstance(value, str) and value and value not in session_ids:
            session_ids.append(value)
    return session_ids


def terminal_error(event: dict[str, Any]) -> str | None:
    if event.get("type") == "result":
        candidates = (event.get("error"), event.get("result"), event.get("errors"))
    else:
        candidates = (event.get("message"), event.get("error"), event.get("result"))
    return next((message for value in candidates if (message := safe_error_value(value))), None)


def protocol_summary(stdout_path: Path) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    session_ids: set[str] = set()
    current_session_id: str | None = None
    try:
        with stdout_path.open(encoding="utf-8", errors="replace") as stream:
            for line_number, line in enumerate(stream, 1):
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, dict):
                    continue
                event_type = event.get("type")
                discovered_ids = event_session_ids(event)
                session_ids.update(discovered_ids)
                if event_type == "thread.started" and discovered_ids:
                    current_session_id = discovered_ids[0]
                elif current_session_id is None and discovered_ids:
                    current_session_id = discovered_ids[0]

                if event_type not in {"result", "error", "turn.failed", "turn.completed"}:
                    continue
                is_error = (
                    bool(event.get("is_error"))
                    if event_type == "result"
                    else event_type in {"error", "turn.failed"}
                )
                event_session_id = discovered_ids[0] if discovered_ids else current_session_id
                results.append(
                    {
                        "line": line_number,
                        "eventType": event_type,
                        "subtype": event.get("subtype") or event_type,
                        "isError": is_error,
                        "error": terminal_error(event) if is_error else None,
                        "durationMs": event.get("duration_ms"),
                        "numTurns": event.get("num_turns"),
                        "sessionId": event_session_id,
                    }
                )
    except OSError:
        pass
    return {"streamSessionIds": sorted(session_ids), "terminalResults": results}


def is_under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def discover_trace_dirs(
    trace_root: Path, target: str, identifiers: set[str]
) -> list[Path]:
    if not trace_root.is_dir():
        return []

    if target == "latest":
        pointer = trace_root / ".last-live-trace"
        try:
            candidate = Path(pointer.read_text(encoding="utf-8").strip())
        except OSError:
            return []
        return [candidate] if candidate.is_dir() and is_under(candidate, trace_root) else []

    matches: list[Path] = []
    needles = {target, *identifiers}
    for meta_path in trace_root.rglob("meta.json"):
        meta = read_json(meta_path)
        searchable = [
            str(meta_path.parent),
            str(meta.get("sessionId") or ""),
            str(meta.get("agentSessionId") or ""),
            str(meta.get("resumeSessionId") or ""),
            *(str(value) for value in meta.get("args", []) if isinstance(value, (str, int))),
        ]
        metadata_matches = any(
            needle and any(needle in value for value in searchable) for needle in needles
        )
        stdout_path = meta_path.parent / str(meta.get("stdoutFile") or "stdout.jsonl")
        stream_session_ids = set(protocol_summary(stdout_path)["streamSessionIds"])
        if metadata_matches or needles.intersection(stream_session_ids):
            matches.append(meta_path.parent)
    return sorted(set(matches), key=str)


def collect_trace(trace_dir: Path) -> dict[str, Any]:
    meta = read_json(trace_dir / "meta.json")
    exit_data = read_json(trace_dir / "exit.json")
    stdout_path = trace_dir / str(meta.get("stdoutFile") or "stdout.jsonl")
    stderr_path = trace_dir / str(meta.get("stderrFile") or "stderr.log")
    try:
        stderr_bytes = stderr_path.stat().st_size
    except OSError:
        stderr_bytes = None
    protocol = protocol_summary(stdout_path)
    return {
        "directory": str(trace_dir),
        "agentType": meta.get("agentType"),
        "command": meta.get("command"),
        "cwd": meta.get("cwd"),
        "createdAt": meta.get("createdAt"),
        "processSessionId": meta.get("sessionId"),
        "agentSessionId": meta.get("agentSessionId"),
        "resumeSessionId": meta.get("resumeSessionId"),
        "argumentCount": len(meta.get("args", [])) if isinstance(meta.get("args"), list) else None,
        "envKeys": sorted(meta.get("envKeys", [])) if isinstance(meta.get("envKeys"), list) else [],
        "attachmentCount": len(meta.get("attachments", []))
        if isinstance(meta.get("attachments"), list)
        else None,
        "exit": {
            "code": exit_data.get("code"),
            "signal": exit_data.get("signal"),
            "finishedAt": exit_data.get("finishedAt"),
        },
        "streamSessionIds": protocol["streamSessionIds"],
        "terminalResults": protocol["terminalResults"],
        "stderrBytes": stderr_bytes,
    }


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone().replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        return None


def collect_log_evidence(
    log_file: Path, identifiers: set[str], traces: list[dict[str, Any]]
) -> dict[str, Any]:
    result: dict[str, Any] = {"path": str(log_file), "exactMatches": [], "nearbySignals": []}
    if not log_file.is_file():
        result["readError"] = "main log not found"
        return result

    times = [
        parsed
        for trace in traces
        for parsed in (parse_iso(trace.get("createdAt")), parse_iso(trace.get("exit", {}).get("finishedAt")))
        if parsed is not None
    ]
    window_start = min(times) - timedelta(minutes=5) if times else None
    window_end = max(times) + timedelta(minutes=5) if times else None
    exact_matches: list[dict[str, Any]] = []
    nearby_signals: list[dict[str, Any]] = []

    try:
        with log_file.open(encoding="utf-8", errors="replace") as stream:
            for line_number, raw_line in enumerate(stream, 1):
                line = raw_line.rstrip("\n")
                if any(identifier and identifier in line for identifier in identifiers):
                    exact_matches.append({"line": line_number, "text": redact_log_line(line)})

                if window_start is None or window_end is None or not LOG_SIGNAL.search(line):
                    continue
                match = LOG_TIMESTAMP.match(line)
                if not match:
                    continue
                try:
                    timestamp = datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S.%f")
                except ValueError:
                    continue
                if window_start <= timestamp <= window_end:
                    nearby_signals.append({"line": line_number, "text": redact_log_line(line)})
    except OSError as error:
        result["readError"] = str(error)
        return result

    result["exactMatches"] = exact_matches[-200:]
    result["nearbySignals"] = nearby_signals[-300:]
    result["truncated"] = len(exact_matches) > 200 or len(nearby_signals) > 300
    return result


def main() -> int:
    args = parse_args()
    storage_root = args.storage_root.expanduser()
    hetero_root = storage_root / "heteroAgent"
    trace_root = args.trace_root.expanduser() if args.trace_root else hetero_root / "tracing"
    target = args.target.strip()
    if not target:
        print("target must not be empty", file=sys.stderr)
        return 2

    topic_cache: dict[str, Any] | None = None
    identifiers = set() if target == "latest" else {target}
    if target.startswith("tpc_"):
        topic_cache = collect_topic_cache(storage_root / "local-database.sqlite3", target)
        identifiers.update(topic_cache.get("nativeSessionIds", []))

    trace_dirs = discover_trace_dirs(trace_root, target, identifiers)
    traces = [collect_trace(trace_dir) for trace_dir in trace_dirs]
    for trace in traces:
        identifiers.update(
            value
            for value in (
                trace.get("processSessionId"),
                trace.get("agentSessionId"),
                trace.get("resumeSessionId"),
            )
            if isinstance(value, str) and value
        )

    report = {
        "target": target,
        "generatedAt": datetime.now().astimezone().isoformat(),
        "readOnly": True,
        "inventory": collect_inventory(hetero_root, trace_root),
        "topicCache": topic_cache,
        "traces": traces,
        "mainLog": collect_log_evidence(args.log_file.expanduser(), identifiers, traces),
        "privacy": {
            "omitted": [
                "message content",
                "stdin content",
                "tool output",
                "attachment bytes",
                "binding profile content",
                "environment values",
            ]
        },
    }
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
