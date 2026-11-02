#!/usr/bin/env python3
"""Publish Harbor/Pier prompts to LobeHub and manage external eval runs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tomllib
from pathlib import Path


class EvalClient:
    def __init__(self, cli_dir: Path | None = None, env: dict[str, str] | None = None):
        self.command = ["node", str(cli_dir.resolve() / "dist/index.js")] if cli_dir else ["lh"]
        self.env = env

    def call(self, *args: str):
        result = subprocess.run(
            [*self.command, *args, "--json"], env=self.env,
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        response = json.loads(result.stdout)
        if response.get("ok") is not True:
            raise RuntimeError(str(response.get("error")))
        data = response["data"]
        if isinstance(data, dict) and data.get("success") is False:
            raise RuntimeError(str(data.get("error") or data))
        return data

    def cases(self, dataset_id: str) -> dict:
        cases = {}
        for offset in range(0, 100_000, 100):
            page = self.call("eval", "testcase", "list", "--dataset-id", dataset_id,
                             "--limit", "100", "--offset", str(offset))
            items = page["data"]
            for item in items:
                case_id = (item.get("metadata") or {}).get("caseId")
                if case_id in cases:
                    raise ValueError(f"Duplicate dataset case ID: {case_id}")
                cases[case_id] = item
            if len(items) < 100:
                return cases
        raise ValueError("Dataset exceeds the supported pagination limit")

    def create_run(self, dataset_id: str, agent_id: str, name: str, case_ids: list[str],
                   timeout_ms: int = 3_600_000, experiment_id: str | None = None) -> dict:
        available = self.cases(dataset_id)
        missing = set(case_ids) - available.keys()
        if not case_ids or missing:
            raise ValueError(f"Empty selection or missing dataset cases: {sorted(missing)}")
        extra = ["--experiment-id", experiment_id] if experiment_id else []
        run = self.call(
            "eval", "run", "create", "--external", "--dataset-id", dataset_id,
            "--agent-id", agent_id, "--name", name, "--k", "1",
            "--timeout", str(timeout_ms), "--include-cases", ",".join(case_ids), *extra,
        )
        return run

    def report_job(self, run_id: str, case_id: str, job: Path) -> dict:
        # Both infra write a trial result beside agent/ and verifier/. Never
        # infer a pass from the agent reply or from the aggregate job mean.
        trials = list(job.glob("*/result.json"))
        if len(trials) != 1:
            raise ValueError(f"Expected one trial result in {job}, found {len(trials)}")
        return self.report_trial(run_id, case_id, trials[0].parent)

    def report_trial(self, run_id: str, case_id: str, path: Path) -> dict:
        trial = json.loads((path / "result.json").read_text())
        started = json.loads((path / "agent/run-start.json").read_text())
        topics = self.call("eval", "run-topic", "list", "--run-id", run_id)
        topic = next((item for item in topics if item["topicId"] == started["topicId"]), None)
        if not topic or topic["testCaseId"] != started["testCaseId"]:
            raise ValueError(f"Trial does not belong to this eval run: {case_id}")
        test_case = topic["testCase"]
        if case_id not in {test_case["id"], (test_case.get("metadata") or {}).get("caseId")}:
            raise ValueError(f"Trial case ID does not match {case_id}")
        rewards = (trial.get("verifier_result") or {}).get("rewards") or {}
        score = rewards.get("reward")
        if not isinstance(score, (int, float)) or not 0 <= score <= 1:
            raise ValueError(f"Missing or invalid verifier reward for {case_id}: {rewards}")
        exception = trial.get("exception_info") or {}
        message = exception.get("exception_message", "")
        idle = (
            exception.get("exception_type") == "NonZeroAgentExitCodeError"
            and "No device request for " in message and "agent interrupted" in message
        )
        if exception and not idle:
            raise ValueError(f"Trial infrastructure error for {case_id}: {exception}")
        allowed = {"external", "passed", "failed"} | ({"error", "timeout"} if idle else set())
        if topic["status"] not in allowed:
            raise ValueError(f"Eval topic is not ready for scoring: {topic['status']}")
        return self.call(
            "eval", "run-topic", "report-result", "--run-id", run_id,
            "--topic-id", started["topicId"], "--score", str(score),
            "--correct", str(score == 1).lower(),
            "--result-json", json.dumps({"caseId": case_id, "rewards": rewards,
                                         **({"termination": "device_idle"} if idle else {})}),
        )

    def report_batch(self, run_id: str, job: Path) -> dict:
        results, errors = [], []
        topics = self.call("eval", "run-topic", "list", "--run-id", run_id)
        case_ids = {item["testCaseId"]: (item["testCase"].get("metadata") or {}).get("caseId")
                    or item["testCaseId"] for item in topics}
        trials = sorted(job.glob("*/result.json"))
        if not trials:
            raise ValueError(f"No trial results found in {job}")
        for path in trials:
            try:
                started = json.loads((path.parent / "agent/run-start.json").read_text())
                case_id = case_ids[started["testCaseId"]]
                receipt = self.report_trial(run_id, case_id, path.parent)
                save(path.parent / "eval-report.json", receipt)
                results.append({"caseId": case_id, **receipt})
            except Exception as error:
                errors.append({"trial": path.parent.name, "error": str(error)})
        result = {"reported": results, "errors": errors}
        save(job / "eval-report.json", result)
        return result


def save(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def publish(args: argparse.Namespace, client: EvalClient) -> dict:
    selection = set(args.case_id or [])
    if args.frontier_dir:
        selection = {
            tomllib.loads(path.read_text())["task"]["name"]
            for path in (args.frontier_dir / "tasks").glob("*/task.toml")
        }
        if args.case_id:
            if not set(args.case_id) <= selection:
                raise ValueError("Requested case is not in the FrontierHarness task set")
            selection = set(args.case_id)
        if not selection:
            raise ValueError("FrontierHarness selection is empty")
    cases = {}
    sources = {}
    for suite, root in (("terminal-bench", args.harbor_tasks), ("datacurve", args.pier_tasks)):
        if root is None:
            continue
        root = root.resolve()
        revision = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                                  capture_output=True, text=True)
        sources[suite] = revision.stdout.strip() if revision.returncode == 0 else None
        paths = [root / "task.toml"] if (root / "task.toml").is_file() else sorted(root.glob("*/task.toml"))
        for path in paths:
            config = tomllib.loads(path.read_text())
            case_id = config.get("task", {}).get("name") or f"{suite}/{path.parent.name}"
            if selection and case_id not in selection:
                continue
            namespace = case_id.partition("/")[0]
            if namespace in {"terminal-bench", "datacurve"} and namespace != suite:
                continue
            if case_id in cases:
                raise ValueError(f"Duplicate task identity: {case_id}")
            prompt = (path.parent / "instruction.md").read_text().strip()
            if not prompt:
                raise ValueError(f"Empty task instruction: {case_id}")
            cases[case_id] = {
                "suite": suite, "taskName": path.parent.name,
                "input": prompt, "inputSha256": hashlib.sha256(prompt.encode()).hexdigest(),
                "taskSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
    if not cases or (selection and selection != cases.keys()):
        raise ValueError(f"Empty selection or missing task sources: {sorted(selection - cases.keys())}")
    # An interrupted publish resumes the same dataset. Existing prompts are
    # checked, never silently overwritten by a changed local task checkout.
    manifest = json.loads(args.output.read_text()) if args.output.exists() else None
    metadata = {"sources": sources, "caseIds": sorted(cases), "format": "harbor-pier"}
    if manifest:
        if manifest["identifier"] != args.identifier or manifest["sources"] != sources:
            raise ValueError("Publish manifest belongs to a different dataset/source revision")
        if manifest["cases"] != {key: {k: v for k, v in case.items() if k != "input"} for key, case in cases.items()}:
            raise ValueError("Task inputs differ from the publish manifest; use a new dataset version")
    else:
        dataset = client.call(
            "eval", "dataset", "create", "--benchmark-id", args.benchmark_id,
            "--identifier", args.identifier, "--name", args.name,
            "--eval-mode", "external", "--metadata", json.dumps(metadata),
        )
        manifest = {
            "datasetId": dataset["id"], "identifier": args.identifier, "sources": sources,
            "cases": {key: {k: v for k, v in case.items() if k != "input"} for key, case in cases.items()},
        }
        save(args.output, manifest)
    existing = client.cases(manifest["datasetId"])
    if set(existing) - cases.keys():
        raise ValueError("Dataset contains unexpected cases")
    for order, (case_id, case) in enumerate(cases.items()):
        if case_id in existing:
            if existing[case_id]["content"]["input"] != case["input"]:
                raise ValueError(f"Published prompt differs from local task: {case_id}")
            continue
        client.call("eval", "testcase", "create", "--dataset-id", manifest["datasetId"],
                    "--case-id", case_id, "--input", case["input"], "--category", case["suite"],
                    "--sort-order", str(order))
    return {"datasetId": manifest["datasetId"], "cases": len(cases), "manifest": str(args.output)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli-dir", type=Path, help="built apps/cli directory; default: installed lh")
    commands = parser.add_subparsers(dest="command", required=True)
    publishing = commands.add_parser("publish", help="upload prompts only, without solutions or tests")
    publishing.add_argument("--harbor-tasks", type=Path)
    publishing.add_argument("--pier-tasks", type=Path)
    publishing.add_argument("--frontier-dir", type=Path, help="restrict to this checkout's FrontierHarness cases")
    publishing.add_argument("--case-id", action="append")
    publishing.add_argument("--benchmark-id", required=True)
    publishing.add_argument("--identifier", required=True)
    publishing.add_argument("--name", required=True)
    publishing.add_argument("--output", type=Path, required=True)
    creating = commands.add_parser("create-run")
    creating.add_argument("--manifest", type=Path, required=True)
    creating.add_argument("--agent-id", default=os.environ.get("LH_AGENT_ID"), required=not os.environ.get("LH_AGENT_ID"))
    creating.add_argument("--name", required=True)
    creating.add_argument("--case-id", action="append")
    creating.add_argument("--timeout-ms", type=int, default=3_600_000)
    creating.add_argument("--experiment-id")
    creating.add_argument("--output", type=Path, required=True)
    reporting = commands.add_parser("report")
    reporting.add_argument("--run-id", required=True)
    reporting_selection = reporting.add_mutually_exclusive_group(required=True)
    reporting_selection.add_argument("--case-id")
    reporting_selection.add_argument("--all", action="store_true", help="report every trial, retaining individual errors")
    reporting.add_argument("--job", type=Path, required=True)
    args = parser.parse_args()
    client = EvalClient(args.cli_dir)
    if args.command == "publish":
        result = publish(args, client)
    elif args.command == "create-run":
        if args.output.exists():
            raise FileExistsError(f"Run receipt already exists: {args.output}")
        manifest = json.loads(args.manifest.read_text())
        selected = args.case_id or list(manifest["cases"])
        if not set(selected) <= manifest["cases"].keys():
            raise ValueError("Selected case is absent from the publish manifest")
        result = client.create_run(manifest["datasetId"], args.agent_id, args.name, selected,
                                   args.timeout_ms, args.experiment_id)
        save(args.output, result)
        claimed = client.call("eval", "run", "claim", "--id", result["id"])
        result["status"] = claimed["run"]["status"]
        save(args.output, result)
    else:
        result = (client.report_batch(args.run_id, args.job) if args.all
                  else client.report_job(args.run_id, args.case_id, args.job))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("errors"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
