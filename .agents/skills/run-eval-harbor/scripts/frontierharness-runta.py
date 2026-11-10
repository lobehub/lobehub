#!/usr/bin/env python3
"""Run FrontierHarness suites on two shared Runta runtimes."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import tomllib

SUITES = {
    "terminal-bench": {
        "runner": "harbor",
        "agent": "lh.agent:LhInstalledAgent",
        "source": "/work/terminal-bench/terminal-bench",
    },
    "datacurve": {
        "runner": "pier",
        "agent": "lh.pier_agent:LhPierInstalledAgent",
        "source": "/work/deep-swe/tasks",
    },
}
CA_OVERLAY = """services:
  main:
    volumes:
      - /etc/ssl/certs/ca-certificates.crt:/etc/ssl/certs/runta-ca-bundle.crt:ro
      - /usr/local/share/ca-certificates/runta-egress.crt:/usr/local/share/ca-certificates/runta-egress.crt:ro
    environment:
      CURL_CA_BUNDLE: /etc/ssl/certs/runta-ca-bundle.crt
      SSL_CERT_FILE: /etc/ssl/certs/runta-ca-bundle.crt
      REQUESTS_CA_BUNDLE: /etc/ssl/certs/runta-ca-bundle.crt
      PIP_CERT: /etc/ssl/certs/runta-ca-bundle.crt
      GIT_SSL_CAINFO: /etc/ssl/certs/runta-ca-bundle.crt
      NODE_EXTRA_CA_CERTS: /usr/local/share/ca-certificates/runta-egress.crt
      UV_NATIVE_TLS: "1"
"""
NETWORK_SCRIPT = r"""
import pathlib, re, sys, tomllib
root = pathlib.Path(sys.argv[1])
for path in root.glob("*/task.toml"):
    source = path.read_text()
    before = tomllib.loads(source)
    section = re.search(r"(?ms)^\[agent\]\s*\n(?P<body>.*?)(?=^\[|\Z)", source)
    if section is None:
        raise SystemExit(f"missing [agent] section: {path}")
    body = section.group("body")
    setting = 'network_mode = "public"'
    if re.search(r"(?m)^network_mode\s*=.*$", body):
        body = re.sub(r"(?m)^network_mode\s*=.*$", setting, body, count=1)
    else:
        body = setting + "\n" + body
    updated = source[:section.start("body")] + body + source[section.end("body"):]
    after = tomllib.loads(updated)
    if before.get("environment") != after.get("environment") or before.get("verifier") != after.get("verifier"):
        raise SystemExit(f"refusing to change verifier/environment policy: {path}")
    path.write_text(updated)
"""


def command(args: list[str], *, capture: bool = False, check: bool = True) -> str:
    result = subprocess.run(args, check=False, text=True, capture_output=capture)
    if check and result.returncode:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(
            f"command failed ({result.returncode}): {shlex.join(args)}\n{detail}"
        )
    return result.stdout if capture else ""


def retry(args: list[str], *, capture: bool = False) -> str:
    error: Exception | None = None
    for attempt in range(3):
        try:
            return command(args, capture=capture)
        except RuntimeError as caught:
            error = caught
            if attempt < 2:
                time.sleep(2)
    assert error is not None
    raise error


def remote(runtime: str, script: str, *, capture: bool = False) -> str:
    return retry(["runta", "exec", runtime, "--", "sh", "-lc", script], capture=capture)


def quote(value: str | Path) -> str:
    return shlex.quote(str(value))


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def runtime_name(run_id: str, suffix: str) -> str:
    raw = re.sub(r"[^a-zA-Z0-9-]", "-", f"fh-{run_id}-{suffix}")
    if len(raw) <= 52:
        return raw
    digest = hashlib.sha256(f"{run_id}-{suffix}".encode()).hexdigest()[:16]
    return f"fh-{suffix}-{digest}"


def runtime_states() -> dict[str, str]:
    data = json.loads(command(["runta", "ps", "-a", "--json"], capture=True))
    rows = data if isinstance(data, list) else data.get("runtimes", [])
    return {
        row.get("display_name", row.get("name")): row.get("status", "") for row in rows
    }


def ensure_runtime(name: str, checkpoint: str, idle_timeout: int) -> None:
    state = runtime_states().get(name)
    if state == "paused":
        retry(["runta", "resume", name])
    elif state == "shutdown":
        retry(["runta", "boot", name])
    elif state != "running":
        if state:
            raise RuntimeError(f"runtime {name} is in unsupported state: {state}")
        retry(
            [
                "runta",
                "checkpoint",
                "restore",
                checkpoint,
                name,
                "--idle-mode",
                "suspend-and-wakeup",
                "--idle-timeout",
                str(idle_timeout),
            ]
        )
    for _ in range(90):
        if runtime_states().get(name) == "running":
            return
        time.sleep(2)
    raise RuntimeError(f"runtime {name} did not become ready")


def discover_tasks(
    root: Path, selected: list[str] | None = None
) -> dict[str, list[dict[str, str]]]:
    tasks: dict[str, list[dict[str, str]]] = {suite: [] for suite in SUITES}
    wanted = set(selected or [])
    for path in sorted(root.glob("*/task.toml")):
        name = tomllib.loads(path.read_text()).get("task", {}).get("name", "")
        suite, separator, _ = name.partition("/")
        if separator and suite in tasks and (not wanted or name in wanted):
            tasks[suite].append({"id": name, "dir": path.parent.name})
    found = {row["id"] for rows in tasks.values() for row in rows}
    missing = wanted - found
    if missing:
        raise RuntimeError(f"tasks not found: {', '.join(sorted(missing))}")
    if not wanted:
        missing_suites = [suite for suite, rows in tasks.items() if not rows]
        if missing_suites:
            raise RuntimeError(f"no tasks found for: {', '.join(missing_suites)}")
    return {suite: rows for suite, rows in tasks.items() if rows}


def suite_config(
    run_id: str, suite: str, tasks: list[dict[str, str]], model: str, concurrency: int
) -> dict[str, Any]:
    details = SUITES[suite]
    agent_env = {
        "LH_AGENT_ID": "${LH_AGENT_ID}",
        "LOBEHUB_CLI_API_KEY": "${LOBEHUB_CLI_API_KEY}",
        "LOBEHUB_WORKSPACE_ID": "${LOBEHUB_WORKSPACE_ID}",
        "LH_CLI_SOURCE": "host-dir:/work/lh-cli",
    }
    common: dict[str, Any] = {
        "job_name": f"{run_id}-{suite}",
        "jobs_dir": f"/work/jobs/{suite}",
        "n_concurrent_trials": concurrency,
        "retry": {"max_retries": 0},
        "tasks": [
            {"path": f"/work/fh-suite-tasks/{suite}/{row['dir']}"} for row in tasks
        ],
    }
    if suite == "terminal-bench":
        common.update(
            {
                "environment": {
                    "type": "docker",
                    "extra_docker_compose": ["/work/runta-ca-overlay.yaml"],
                },
                "agents": [
                    {"name": details["agent"], "model_name": model, "env": agent_env}
                ],
            }
        )
    else:
        agent_env.update(
            {
                "CURL_CA_BUNDLE": "/etc/ssl/certs/runta-ca-bundle.crt",
                "SSL_CERT_FILE": "/etc/ssl/certs/runta-ca-bundle.crt",
                "NODE_EXTRA_CA_CERTS": "/usr/local/share/ca-certificates/runta-egress.crt",
            }
        )
        common.update(
            {
                "environment": {
                    "type": "docker",
                    "mounts": [
                        {
                            "type": "bind",
                            "source": "/etc/ssl/certs/ca-certificates.crt",
                            "target": "/etc/ssl/certs/runta-ca-bundle.crt",
                            "read_only": True,
                        },
                        {
                            "type": "bind",
                            "source": "/usr/local/share/ca-certificates/runta-egress.crt",
                            "target": "/usr/local/share/ca-certificates/runta-egress.crt",
                            "read_only": True,
                        },
                    ],
                },
                "agents": [
                    {
                        "import_path": details["agent"],
                        "model_name": model,
                        "env": agent_env,
                    }
                ],
            }
        )
    return common


def unit_status(runtime: str, suite: str) -> dict[str, str]:
    unit = f"fh-suite-{suite}.service"
    output = remote(
        runtime,
        "systemctl show "
        + quote(unit)
        + " --no-pager --property=LoadState,ActiveState,SubState,Result,ExecMainStatus 2>/dev/null || true",
        capture=True,
    )
    return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)


def launch(runtime: str, suite: str) -> None:
    state = unit_status(runtime, suite)
    if state.get("LoadState") == "loaded":
        return
    runner = SUITES[suite]["runner"]
    state_dir = f"/work/fh-suite-state/{suite}"
    inner = (
        "set -u; set -a; . /work/fh-input/runtime.env || exit $?; set +a; "
        "export HOME=/root PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "
        "PYTHONPATH=/work/lh-harness; "
        "started=$(date +%s); "
        f"{runner} run --config /work/fh-input/suite-config.json --yes; exit_code=$?; "
        "duration=$(( $(date +%s) - started )); "
        f'jq -n --argjson exit_code "$exit_code" --argjson duration "$duration" '
        f"'{{exit_code:$exit_code,duration_seconds:$duration}}' > {state_dir}/completion.json.tmp; "
        f'mv {state_dir}/completion.json.tmp {state_dir}/completion.json; exit "$exit_code"'
    )
    log = f"{state_dir}/runner.log"
    remote(
        runtime,
        f"mkdir -p /work/fh-suite-state/{suite} /work/jobs/{suite}; "
        + "systemd-run --quiet "
        + f"--unit={quote(f'fh-suite-{suite}')} "
        + "--property=Type=exec "
        + f"--property={quote(f'StandardOutput=append:{log}')} "
        + f"--property={quote(f'StandardError=append:{log}')} "
        + f"/bin/bash -lc {quote(inner)}",
    )


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def copy_to_runtime(local: Path, runtime: str, target: str) -> None:
    retry(["runta", "cp", str(local), f"{runtime}:{target}"])


def pack_lh_artifacts(run_dir: Path, cli_dir: Path) -> tuple[Path, str]:
    required = (cli_dir / "package.json", cli_dir / "dist" / "index.js")
    for path in required:
        if not path.is_file():
            raise RuntimeError(f"missing local CLI build artifact: {path}")
    lh_dir = Path(__file__).with_name("lh")
    run_dir.mkdir(parents=True, exist_ok=True)
    archive = run_dir / "lh-artifacts.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        bundle.add(cli_dir / "package.json", arcname="lh-cli/package.json")
        bundle.add(cli_dir / "dist", arcname="lh-cli/dist")
        for path in lh_dir.rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts:
                bundle.add(
                    path,
                    arcname=Path("lh-harness/lh") / path.relative_to(lh_dir),
                )
    return archive, hashlib.sha256(archive.read_bytes()).hexdigest()


def start(args: argparse.Namespace) -> None:
    tasks_root = args.tasks.resolve()
    env_file = args.env_file.resolve()
    if not tasks_root.is_dir() or not env_file.is_file():
        raise RuntimeError("--tasks must be a directory and --env-file must be a file")
    env = read_env(env_file)
    missing = [
        key
        for key in ("LH_AGENT_ID", "LOBEHUB_CLI_API_KEY", "LOBEHUB_WORKSPACE_ID")
        if not env.get(key)
    ]
    if missing:
        raise RuntimeError(f"missing from runtime env file: {', '.join(missing)}")
    if (
        args.harbor_concurrency < 1
        or args.pier_concurrency < 1
        or args.idle_timeout < 1
    ):
        raise RuntimeError("concurrency and idle timeout must be positive integers")

    run_dir = (args.out / args.run_id).resolve()
    run_file = run_dir / "run.json"
    if run_file.exists():
        raise RuntimeError(f"run already exists; use status or collect: {run_file}")
    tasks = discover_tasks(tasks_root, args.task)
    runtimes = {
        suite: runtime_name(args.run_id, SUITES[suite]["runner"]) for suite in tasks
    }
    artifact, artifact_hash = pack_lh_artifacts(run_dir, args.cli_dir.resolve())
    record = {
        "version": 1,
        "run_id": args.run_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "checkpoint": args.checkpoint,
        "model_label": args.model,
        "agent_id": env["LH_AGENT_ID"],
        "lh_artifact_sha256": artifact_hash,
        "topology": "two-shared-runta-runtimes",
        "network": {
            "runtime_egress": "public",
            "agent": "public",
            "verifier": "task-defined",
        },
        "runtimes": runtimes,
        "concurrency": {
            "terminal-bench": args.harbor_concurrency,
            "datacurve": args.pier_concurrency,
        },
        "tasks": tasks,
    }
    write_json(run_file, record)
    write_json(run_dir / "task-index.json", tasks)
    (run_dir / "runta-ca-overlay.yaml").write_text(CA_OVERLAY)
    for suite in tasks:
        config = suite_config(
            args.run_id,
            suite,
            tasks[suite],
            args.model,
            record["concurrency"][suite],
        )
        write_json(run_dir / f"{suite}-config.json", config)

    encoded_network_script = base64.b64encode(NETWORK_SCRIPT.encode()).decode()
    for suite, runtime in runtimes.items():
        print(f"Preparing {suite} on {runtime}", file=sys.stderr)
        ensure_runtime(runtime, args.checkpoint, args.idle_timeout)
        retry(["runta", "egress", "set", runtime, "--mode", "denylist"])
        remote(
            runtime,
            "mkdir -p /work/fh-input /work/fh-suite-tasks /work/jobs",
        )
        copy_to_runtime(artifact, runtime, "/work/fh-input/lh-artifacts.tar.gz")
        copy_to_runtime(env_file, runtime, "/work/fh-input/runtime.env")
        copy_to_runtime(run_file, runtime, "/work/fh-input/run.json")
        copy_to_runtime(
            run_dir / "task-index.json", runtime, "/work/fh-input/task-index.json"
        )
        copy_to_runtime(
            run_dir / f"{suite}-config.json",
            runtime,
            "/work/fh-input/suite-config.json",
        )
        if suite == "terminal-bench":
            copy_to_runtime(
                run_dir / "runta-ca-overlay.yaml",
                runtime,
                "/work/runta-ca-overlay.yaml",
            )
        source = SUITES[suite]["source"]
        directories = " ".join(quote(row["dir"]) for row in tasks[suite])
        target = f"/work/fh-suite-tasks/{suite}"
        remote(
            runtime,
            "set -eu; chmod 600 /work/fh-input/runtime.env; "
            "rm -rf /work/lh-cli /work/lh-harness; "
            "tar -xzf /work/fh-input/lh-artifacts.tar.gz -C /work; "
            + (
                "test -d /work/terminal-bench/terminal-bench || "
                "harbor datasets download terminal-bench@2.0 --output-dir /work/terminal-bench --overwrite; "
                if suite == "terminal-bench"
                else ""
            )
            + f"rm -rf {quote(target)}; "
            f"mkdir -p {quote(target)}; for task in {directories}; do "
            f'test -f {quote(source)}/"$task/task.toml"; cp -a {quote(source)}/"$task" {quote(target)}/; done; '
            f"printf %s {quote(encoded_network_script)} | base64 -d | python3 - {quote(target)}",
        )
        launch(runtime, suite)

    print(json.dumps({"run": str(run_file), "runtimes": runtimes}, indent=2))


def load_run(path: Path) -> tuple[Path, dict[str, Any]]:
    run_file = path / "run.json" if path.is_dir() else path
    if not run_file.is_file():
        raise RuntimeError(f"run record not found: {run_file}")
    return run_file.resolve(), json.loads(run_file.read_text())


def get_status(record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    states = runtime_states()
    for suite, runtime in record["runtimes"].items():
        runtime_state = states.get(runtime, "missing")
        unit: dict[str, str] = {}
        completion: dict[str, Any] | None = None
        completed = 0
        if runtime_state != "missing":
            unit = unit_status(runtime, suite)
            completion_raw = remote(
                runtime,
                f"test ! -f /work/fh-suite-state/{quote(suite)}/completion.json || "
                f"cat /work/fh-suite-state/{quote(suite)}/completion.json",
                capture=True,
            ).strip()
            completion = json.loads(completion_raw) if completion_raw else None
            count = remote(
                runtime,
                f"find /work/jobs/{quote(suite)} -mindepth 3 -type f -name result.json 2>/dev/null | wc -l",
                capture=True,
            ).strip()
            completed = int(count or 0)
        result[suite] = {
            "runtime": runtime,
            "runtime_state": runtime_state,
            "unit": unit,
            "completion": completion,
            "completed_trials": completed,
            "expected_trials": len(record["tasks"][suite]),
        }
    return result


def status(args: argparse.Namespace) -> None:
    _, record = load_run(args.run)
    print(json.dumps(get_status(record), indent=2))


def download_verified(runtime: str, source: str, target: Path, expected: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(3):
        temporary = target.with_suffix(target.suffix + ".part")
        temporary.unlink(missing_ok=True)
        command(["runta", "cp", f"{runtime}:{source}", str(temporary)], check=False)
        if (
            temporary.is_file()
            and hashlib.sha256(temporary.read_bytes()).hexdigest() == expected
        ):
            temporary.replace(target)
            return
        time.sleep(2)
    raise RuntimeError(f"failed to copy a verified archive from {runtime}:{source}")


def collect_usage(run_dir: Path, record: dict[str, Any], env_file: Path | None) -> None:
    operation_ids: set[str] = set()
    for snapshot in run_dir.glob("suites/*/final/**/operation-status.jsonl"):
        for line in snapshot.read_text(errors="replace").splitlines():
            try:
                operation_id = json.loads(line).get("operationId")
                if isinstance(operation_id, str):
                    operation_ids.add(operation_id)
            except json.JSONDecodeError:
                continue
    write_json(run_dir / "operation-ids.json", sorted(operation_ids))
    if not operation_ids or shutil.which("lh") is None:
        print(
            "Warning: operation IDs or local lh CLI unavailable; usage was not collected",
            file=sys.stderr,
        )
        return

    started = datetime.fromisoformat(record["started_at"])
    now = datetime.now(timezone.utc)
    months: list[str] = []
    year, month = started.year, started.month
    while (year, month) <= (now.year, now.month):
        months.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    process_env = os.environ.copy()
    if env_file and env_file.is_file():
        process_env.update(read_env(env_file))
    rows: list[dict[str, Any]] = []
    for month_value in months:
        result = subprocess.run(
            [
                "lh",
                "usage",
                "--month",
                month_value,
                "--agent-id",
                record["agent_id"],
                "--json",
            ],
            check=False,
            text=True,
            capture_output=True,
            env=process_env,
        )
        if result.returncode:
            print(
                f"Warning: lh usage failed for {month_value}: {result.stderr.strip()}",
                file=sys.stderr,
            )
            return
        value = json.loads(result.stdout)
        if isinstance(value, list):
            rows.extend(value)
    write_json(run_dir / "lh-usage-raw.json", rows)
    filtered = [
        row
        for row in rows
        if row.get("metadata", {}).get("operationId") in operation_ids
    ]
    write_json(run_dir / "lh-usage.json", filtered)


def collect(args: argparse.Namespace) -> None:
    run_file, record = load_run(args.run)
    run_dir = run_file.parent
    current = get_status(record)
    incomplete = [
        suite for suite, value in current.items() if value["completion"] is None
    ]
    if incomplete:
        raise RuntimeError(f"suites have no completion record: {', '.join(incomplete)}")

    for suite, runtime in record["runtimes"].items():
        remote_dir = f"/work/fh-suite-state/{suite}"
        unit = f"fh-suite-{suite}.service"
        archive = f"{remote_dir}/final-evidence.tar.gz"
        hash_value = remote(
            runtime,
            f"set -eu; mkdir -p {quote(remote_dir)}; "
            f"systemctl show {quote(unit)} --no-pager > {quote(remote_dir + '/unit-status.txt')} 2>&1 || true; "
            f"journalctl -u {quote(unit)} --no-pager > {quote(remote_dir + '/journal.log')} 2>&1 || true; "
            f"tar -czf {quote(archive + '.tmp')} -C /work/jobs {quote(suite)} "
            f"-C {quote(remote_dir)} unit-status.txt journal.log runner.log completion.json "
            f"-C /work/fh-input run.json suite-config.json task-index.json; "
            f"mv {quote(archive + '.tmp')} {quote(archive)}; sha256sum {quote(archive)}",
            capture=True,
        ).split()[0]
        local_dir = run_dir / "suites" / suite
        local_archive = local_dir / "final-evidence.tar.gz"
        download_verified(runtime, archive, local_archive, hash_value)
        final_dir = local_dir / "final"
        shutil.rmtree(final_dir, ignore_errors=True)
        final_dir.mkdir(parents=True)
        with tarfile.open(local_archive) as bundle:
            bundle.extractall(final_dir, filter="data")
        (local_dir / "SHA256SUMS").write_text(f"{hash_value}  final-evidence.tar.gz\n")

    for runtime in record["runtimes"].values():
        retry(["runta", "pause", runtime])
    collect_usage(run_dir, record, args.env_file.resolve() if args.env_file else None)
    write_json(run_dir / "final-status.json", current)
    print(
        json.dumps(
            {"run": str(run_file), "evidence": str(run_dir / "suites")}, indent=2
        )
    )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    start_parser = commands.add_parser("start", help="start both suites and return")
    start_parser.add_argument("--checkpoint", required=True)
    start_parser.add_argument("--run-id", required=True)
    start_parser.add_argument("--tasks", type=Path, required=True)
    start_parser.add_argument("--env-file", type=Path, required=True)
    start_parser.add_argument(
        "--model", required=True, help="reporting label; the Lh agent owns its model"
    )
    start_parser.add_argument(
        "--task",
        action="append",
        help="run only this suite/task id; repeat to select multiple tasks",
    )
    start_parser.add_argument("--out", type=Path, default=Path("runs"))
    start_parser.add_argument(
        "--cli-dir",
        type=Path,
        default=Path(__file__).resolve().parents[4] / "apps/cli",
        help="built apps/cli directory",
    )
    start_parser.add_argument("--harbor-concurrency", type=int, default=2)
    start_parser.add_argument("--pier-concurrency", type=int, default=1)
    start_parser.add_argument("--idle-timeout", type=int, default=900)
    start_parser.set_defaults(handler=start)

    status_parser = commands.add_parser("status", help="print one status snapshot")
    status_parser.add_argument("--run", type=Path, required=True)
    status_parser.set_defaults(handler=status)

    collect_parser = commands.add_parser(
        "collect", help="collect final evidence and pause runtimes"
    )
    collect_parser.add_argument("--run", type=Path, required=True)
    collect_parser.add_argument("--env-file", type=Path)
    collect_parser.set_defaults(handler=collect)
    return root


def main() -> None:
    args = parser().parse_args()
    try:
        args.handler(args)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
