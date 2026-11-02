#!/usr/bin/env python3
"""Run FrontierHarness tasks on a Docker host and collect their results."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from datetime import datetime, timezone
from pathlib import Path

from lh.eval import EvalClient

SUITES = {
    "terminal-bench": ("harbor", "lh.agent:LhInstalledAgent"),
    "datacurve": ("pier", "lh.pier_agent:LhPierInstalledAgent"),
}
SCRIPT_DIR = Path(__file__).resolve().parent


def credentials(path: Path) -> dict[str, str]:
    values = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    required = ("LH_AGENT_ID", "LOBEHUB_CLI_API_KEY", "LOBEHUB_WORKSPACE_ID")
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise ValueError(f"missing Cloud credentials: {', '.join(missing)}")
    return {key: values[key] for key in required}


def save(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def start(args: argparse.Namespace) -> None:
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", args.run_id):
        raise ValueError("run-id must contain only letters, digits, dots, dashes and underscores")
    eval_dir = args.eval_dir.resolve()
    cli_dir = args.cli_dir.resolve()
    env_file = args.env_file.resolve()
    for required in (cli_dir / "package.json", cli_dir / "dist/index.js", eval_dir / "benchmark.json"):
        if not required.is_file():
            raise FileNotFoundError(required)
    creds = credentials(env_file)
    concurrency = {"terminal-bench": args.harbor_concurrency, "datacurve": args.pier_concurrency}
    if any(value < 1 for value in concurrency.values()):
        raise ValueError("suite concurrency must be positive")
    notify_dir = Path.home() / "scripts"
    if args.notify and not all((notify_dir / name).is_file() for name in ("notify-on-exit.sh", ".env")):
        raise FileNotFoundError("notification script or its .env is missing")
    sources = {
        "terminal-bench": args.terminal_bench.resolve(),
        "datacurve": (args.deep_swe.resolve() / "tasks"),
    }
    if not all(path.is_dir() for path in sources.values()):
        raise ValueError("Terminal-Bench or DeepSWE task directory is missing")
    network_script = eval_dir / "skills/frontierharness-eval/scripts/set-agent-network-mode.py"
    if not network_script.is_file():
        raise FileNotFoundError(network_script)

    tasks = []
    for task in sorted((eval_dir / "tasks").glob("*/task.toml")):
        task_id = tomllib.loads(task.read_text())["task"]["name"]
        if args.task and task_id not in args.task:
            continue
        suite, _, _ = task_id.partition("/")
        if suite not in SUITES:
            raise ValueError(f"unknown FrontierHarness suite: {task_id}")
        source = sources[suite] / task.parent.name
        if not (source / "task.toml").is_file():
            raise FileNotFoundError(source / "task.toml")
        source_task = tomllib.loads((source / "task.toml").read_text())
        source_name = source_task.get("task", {}).get("name")
        if suite == "terminal-bench" and source_name is None:
            source_name = f"terminal-bench/{source.name}"
        if source_name != task_id:
            raise ValueError(f"task identity differs from the benchmark: {task_id}")
        tasks.append({"id": task_id, "suite": suite, "dir": task.parent.name})
    if args.task and set(args.task) != {task["id"] for task in tasks}:
        raise ValueError("requested task is not in the FrontierHarness benchmark")
    if not args.task and len(tasks) != 30:
        raise ValueError(f"expected 30 FrontierHarness tasks, found {len(tasks)}")

    run_dir = (args.out.resolve() / args.run_id)
    if run_dir.exists():
        raise FileExistsError(f"run already exists: {run_dir}")
    run_dir.mkdir(parents=True)
    eval_manifest = json.loads(args.eval_manifest.read_text()) if args.eval_manifest else None
    if eval_manifest and not {task["id"] for task in tasks} <= eval_manifest["cases"].keys():
        raise ValueError("Selected tasks are missing from the eval dataset manifest")
    for task in tasks:
        suite, name = task["suite"], task["dir"]
        target = run_dir / "tasks" / suite / name
        shutil.copytree(sources[suite] / name, target)
        subprocess.run([sys.executable, str(network_script), str(target / "task.toml"), "public"], check=True)
        if eval_manifest:
            prompt_hash = hashlib.sha256((target / "instruction.md").read_text().strip().encode()).hexdigest()
            if prompt_hash != eval_manifest["cases"][task["id"]]["inputSha256"]:
                raise ValueError(f"Task prompt differs from the published dataset: {task['id']}")
    for suite in dict.fromkeys(task["suite"] for task in tasks):
        runner, adapter = SUITES[suite]
        agent = {
            "model_name": args.model,
            "env": {
                **{key: "${" + key + "}" for key in creds},
                "LH_CLI_SOURCE": f"host-dir:{cli_dir}",
                "LH_RUN_MODE": "eval" if eval_manifest else "agent",
                **({"LH_EVAL_RUN_ID": "${LH_EVAL_RUN_ID}"} if eval_manifest else {}),
            },
        }
        agent["name" if runner == "harbor" else "import_path"] = adapter
        config = {
            "job_name": f"{args.run_id}-{suite}",
            "jobs_dir": str(run_dir / "jobs" / suite),
            "n_concurrent_trials": concurrency[suite],
            "retry": {"max_retries": 0},
            "tasks": [{"path": str(run_dir / "tasks" / suite / task["dir"])}
                      for task in tasks if task["suite"] == suite],
            "environment": {"type": "docker"},
            "agents": [agent],
        }
        save(run_dir / "config" / f"{suite}.json", config)
    record = {
        "run_id": args.run_id,
        "model": args.model,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "topology": "docker-host-native-jobs",
        "concurrency": concurrency,
        "eval_commit": subprocess.check_output(["git", "-C", str(eval_dir), "rev-parse", "HEAD"], text=True).strip(),
        "deep_swe_commit": subprocess.check_output(["git", "-C", str(args.deep_swe), "rev-parse", "HEAD"], text=True).strip(),
        "cli_sha256": hashlib.sha256((cli_dir / "dist/index.js").read_bytes()).hexdigest(),
        "cli_dir": str(cli_dir),
        "env_file": str(env_file),
        "agent_id": creds["LH_AGENT_ID"],
        "tasks": tasks,
    }
    if eval_manifest:
        record["eval_dataset_id"] = eval_manifest["datasetId"]
    save(run_dir / "run.json", record)
    save(run_dir / "status.json", {"state": "queued", "total": len(tasks)})
    command = [sys.executable, str(Path(__file__).resolve()), "worker", "--run", str(run_dir)]
    if args.notify:
        notifier = notify_dir / "notify-on-exit.sh"
        command = [
            str(notifier), "--title", f"FrontierHarness local: {args.run_id}",
            "--content", f"Result directory: {run_dir}", "--", *command,
        ]
    with (run_dir / "worker.log").open("a") as log:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            cwd=notify_dir if args.notify else run_dir,
            start_new_session=True,
        )
    (run_dir / "worker.pid").write_text(f"{process.pid}\n")
    print(json.dumps({"run": str(run_dir), "pid": process.pid, "tasks": len(tasks)}, indent=2))


def worker(args: argparse.Namespace) -> None:
    run_dir = args.run.resolve()
    record = json.loads((run_dir / "run.json").read_text())
    env = os.environ.copy()
    for key in ("LH_SERVER_URL", "LOBEHUB_SERVER", "LH_GATEWAY_URL", "AGENT_GATEWAY_URL", "LH_AGENT_SLUG", "LH_EVAL_CASE_ID"):
        env.pop(key, None)
    env.update(credentials(Path(record["env_file"])))
    env["PYTHONPATH"] = str(SCRIPT_DIR) + (":" + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    if record.get("eval_dataset_id"):
        client = EvalClient(Path(record["cli_dir"]), env)
        if not record.get("eval_run_id"):
            run = client.create_run(record["eval_dataset_id"], record["agent_id"], record["run_id"],
                                    [task["id"] for task in record["tasks"]])
            record.update({"eval_run_id": run["id"], "eval_url": run.get("url")})
            save(run_dir / "run.json", record)
            client.call("eval", "run", "claim", "--id", run["id"])
        env["LH_EVAL_RUN_ID"] = record["eval_run_id"]
    processes, jobs, errors = {}, {}, {}
    save(run_dir / "status.json", {"state": "running", "total": len(record["tasks"]), "concurrency": record["concurrency"]})
    for suite in dict.fromkeys(task["suite"] for task in record["tasks"]):
        runner = SUITES[suite][0]
        command = (["uv", "run", "--with", "harbor==0.23.0", "harbor"] if runner == "harbor" else ["pier"])
        command += ["run", "--config", str(run_dir / "config" / f"{suite}.json"), "--yes"]
        jobs[suite] = run_dir / "jobs" / suite / f"{record['run_id']}-{suite}"
        try:
            with (run_dir / f"{runner}.log").open("a") as log:
                processes[suite] = subprocess.Popen(command, cwd=run_dir, env=env, stdout=log, stderr=subprocess.STDOUT)
        except OSError as error:
            errors[suite] = str(error)
    for suite, process in processes.items():
        exit_code = process.wait()
        if exit_code or not (jobs[suite] / "result.json").is_file():
            errors[suite] = f"runner exit={exit_code}; job={jobs[suite]}"
    if record.get("eval_run_id"):
        for suite, job in jobs.items():
            try:
                receipt = client.report_batch(record["eval_run_id"], job)
                if receipt["errors"]:
                    errors[suite] = receipt["errors"]
            except Exception as error:
                errors[suite] = str(error)
    status = {
        "state": "failed" if errors else "complete", "total": len(record["tasks"]),
        "completed": sum(len(list(job.glob("*/result.json"))) for job in jobs.values()),
        "jobs": {suite: str(job) for suite, job in jobs.items()}, "errors": errors,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    save(run_dir / "status.json", status)
    if errors:
        raise SystemExit(1)


def collect(args: argparse.Namespace) -> None:
    run_dir = args.run.resolve()
    eval_dir = args.eval_dir.resolve()
    record_path = run_dir / "run.json"
    record = json.loads(record_path.read_text())
    status = json.loads((run_dir / "status.json").read_text())
    if status["state"] != "complete":
        raise RuntimeError("local run has not completed")
    model = record["model"]
    env = os.environ.copy()
    for key in ("LH_SERVER_URL", "LOBEHUB_SERVER", "LH_GATEWAY_URL", "AGENT_GATEWAY_URL", "LH_AGENT_SLUG"):
        env.pop(key, None)
    env.update(credentials(args.env_file or Path(record["env_file"])))

    scripts = eval_dir / "skills/frontierharness-eval/scripts"
    sys.path.insert(0, str(scripts))
    spec = importlib.util.spec_from_file_location("fh_calculate_cost", scripts / "calculate-cost.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("FrontierHarness cost calculator is unavailable")
    calculator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(calculator)
    pricing = json.loads((scripts / "pricing.json").read_text())

    originals = {}
    for result in (run_dir / "jobs").glob("*/*/*/result.json"):
        trial = json.loads(result.read_text())
        key = (result.parents[2].name, Path(trial["config"]["task"]["path"]).name)
        if key in originals:
            raise RuntimeError(f"multiple trials for {key}: {result}")
        originals[key] = result.parent
    operations = {}
    for task in record["tasks"]:
        name, suite = task["dir"], task["suite"]
        job = originals[(suite, name)]
        status_logs = list(job.rglob("operation-status.jsonl"))
        if len(status_logs) != 1:
            raise RuntimeError(f"expected one operation log: {job}")
        ids = {json.loads(line)["operationId"] for line in status_logs[0].read_text().splitlines()}
        if not ids:
            raise RuntimeError(f"no operation ID: {job}")
        operations[task["id"]] = ids

    cli = args.cli_dir.resolve() / "dist/index.js"
    year, month = map(int, record["started_at"][:7].split("-"))
    end = status.get("finished_at", datetime.now(timezone.utc).isoformat())
    end_year, end_month = map(int, end[:7].split("-"))
    usage = []
    while (year, month) <= (end_year, end_month):
        usage.extend(json.loads(subprocess.check_output(
            ["node", str(cli), "usage", "--month", f"{year:04d}-{month:02d}",
             "--agent-id", record["agent_id"], "--json"], text=True, env=env,
        )))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    all_ids = set().union(*operations.values())
    matched = [row for row in usage if (row.get("metadata") or {}).get("operationId") in all_ids]
    if {row["metadata"]["operationId"] for row in matched} != all_ids:
        raise RuntimeError("lh usage is missing one or more run operations")

    trials = run_dir / "trials"
    for task in record["tasks"]:
        name, suite = task["dir"], task["suite"]
        trial_dir = trials / f"{suite}__{name}"
        job_dir = trial_dir / "jobs"
        original = originals[(suite, name)]
        trial_dir.mkdir(parents=True, exist_ok=True)
        if job_dir.is_symlink():
            job_dir.unlink()
        if not job_dir.exists():
            shutil.copytree(original, job_dir / original.name)
        agents = list(job_dir.rglob("operation-status.jsonl"))
        if len(agents) != 1:
            raise RuntimeError(f"expected one agent log: {job_dir}")
        rows = sorted(
            (row for row in matched if row["metadata"]["operationId"] in operations[task["id"]]),
            key=lambda row: row.get("createdAt", ""),
        )
        (agents[0].parent / "lh-usage.jsonl").write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        )
        title_path = eval_dir / "tasks" / name / "task.toml"
        title = tomllib.loads(title_path.read_text()).get("metadata", {}).get("display_title", name)
        scored = calculator.calculate(trial_dir, model, "lh", pricing, True, True)
        trial = {
            "id": task["id"], "title": title, "suite": suite, "harness": "lh",
            "run_id": record["run_id"], "attempt": 1,
            "operations": sorted(operations[task["id"]]), "usage_requests": len(rows),
            **scored,
        }
        (trial_dir / "trial.json").write_text(json.dumps(trial, indent=2) + "\n")

    record.update({
        "harness": "lh", "model": model, "provider": "lobehub-cloud",
        "checkpoint": "none (local Docker)", "methodology_comparable": False,
        "egress_policy": {"mode": "public", "scope": "agent task"},
        "methodology_notes": [
            f"Docker executes tasks on a shared host without checkpoint restores; image caches persist. Suite concurrency: {record.get('concurrency', 'legacy sequential')}.",
            "Only the agent task network is public; verifier and environment policy remain task-defined.",
            f"The Cloud agent selects the model; {model} is the recorded reporting label and frozen benchmark prices are used for comparison.",
        ],
    })
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    (run_dir / "lh-usage.json").write_text(json.dumps(matched, indent=2) + "\n")
    print(f"Prepared {len(record['tasks'])} trials; {len(matched)} usage requests across {len(all_ids)} operations")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    start_parser = commands.add_parser("start")
    start_parser.add_argument("--run-id", required=True)
    start_parser.add_argument("--eval-dir", type=Path, required=True)
    start_parser.add_argument("--terminal-bench", type=Path, required=True)
    start_parser.add_argument("--deep-swe", type=Path, required=True)
    start_parser.add_argument("--env-file", type=Path, required=True)
    start_parser.add_argument("--eval-manifest", type=Path, help="published dataset manifest; use lh eval agent run")
    start_parser.add_argument("--cli-dir", type=Path, default=SCRIPT_DIR.parents[3] / "apps/cli")
    start_parser.add_argument("--out", type=Path, default=Path("runs"))
    start_parser.add_argument("--model", default="kimi-k3")
    start_parser.add_argument("--task", action="append")
    start_parser.add_argument("--harbor-concurrency", type=int, default=2)
    start_parser.add_argument("--pier-concurrency", type=int, default=1)
    start_parser.add_argument("--notify", action="store_true", help="send a notification when the worker exits")
    start_parser.set_defaults(handler=start)
    collect_parser = commands.add_parser("collect", help="prepare results and usage for FrontierHarness reports")
    collect_parser.add_argument("--run", required=True, type=Path)
    collect_parser.add_argument("--eval-dir", required=True, type=Path)
    collect_parser.add_argument("--cli-dir", required=True, type=Path)
    collect_parser.add_argument("--env-file", type=Path, help="override the original worker's credential file")
    collect_parser.set_defaults(handler=collect)
    worker_parser = commands.add_parser("worker", help=argparse.SUPPRESS)
    worker_parser.add_argument("--run", type=Path, required=True)
    worker_parser.set_defaults(handler=worker)
    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
