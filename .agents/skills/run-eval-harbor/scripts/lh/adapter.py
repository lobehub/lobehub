from __future__ import annotations

import json
import shlex
from collections.abc import Callable
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined

DEV_CLI_DIR = "/opt/lh-dev"
DEV_CLI_RUNNER = f"{DEV_CLI_DIR}/run-lh.sh"
CHECK_LH_PATH = "/installed-agent/check-lh.sh"
RUN_AGENT_PATH = "/installed-agent/run-agent.js"

_HOST_DIR_PREFIX = "host-dir:"
_CONNECT_SCRIPT = "/tmp/lh-connect-supervised.sh"
_LOGIN_READY = "/tmp/lh-login-ready"
_DEVICE_READY = "/tmp/lh-device-ready"
_SUPERVISOR_CONFIG = "/tmp/lh-supervisord.conf"
_SUPERVISOR_SOCKET = "/tmp/lh-supervisor.sock"
_TEMPLATES = Environment(
    autoescape=False,
    keep_trailing_newline=True,
    loader=FileSystemLoader(Path(__file__).with_name("template")),
    undefined=StrictUndefined,
)


class LhAdapter:
    def __init__(
        self,
        get_env: Callable[[str], str | None],
        *,
        agent_id: str | None,
        workspace_id: str | None,
        server_url: str | None,
        gateway_url: str | None,
        cli_source: str | None,
        run_mode: str | None,
    ) -> None:
        self.get_env = get_env
        self.agent_id = agent_id
        self.workspace_id = workspace_id
        self.server_url = server_url
        self.gateway_url = gateway_url
        self.cli_source_arg = cli_source
        self.run_mode_arg = run_mode

    def value(self, direct: str | None, env_name: str, default: str = "") -> str:
        return (direct or self.get_env(env_name) or default).strip()

    @property
    def cli_source(self) -> str:
        return self.value(self.cli_source_arg, "LH_CLI_SOURCE", "system")

    @property
    def uses_system_cli(self) -> bool:
        return self.cli_source == "system"

    def host_cli_dir(self) -> Path | None:
        if self.uses_system_cli:
            return None
        if not self.cli_source.startswith(_HOST_DIR_PREFIX):
            raise ValueError(f"Unsupported LH_CLI_SOURCE: {self.cli_source}")
        path = Path(self.cli_source.removeprefix(_HOST_DIR_PREFIX)).expanduser()
        if not path.is_absolute():
            raise ValueError("LH_CLI_SOURCE host-dir path must be absolute")
        for required in (path / "package.json", path / "dist" / "index.js"):
            if not required.is_file():
                raise FileNotFoundError(f"Missing local LH CLI build input: {required}")
        return path

    def render(self, name: str, **values: object) -> str:
        return _TEMPLATES.get_template(name).render(**values)

    def install_script(self, *, install_cli: bool) -> str:
        return self.render(
            "install-lh.sh.j2",
            cli_package=shlex.quote("@lobehub/cli"),
            node_version=shlex.quote(self.value(None, "LH_NODE_VERSION", "24")),
            install_cli=install_cli,
            use_system_cli=self.uses_system_cli,
        )

    def run_commands(self, instruction: str) -> list[str]:
        agent_id = self.value(self.agent_id, "LH_AGENT_ID")
        agent_slug = self.value(None, "LH_AGENT_SLUG")
        if not agent_id and not agent_slug:
            raise ValueError("LH_AGENT_ID or LH_AGENT_SLUG is required")
        server_url = self.value(self.server_url, "LH_SERVER_URL")
        gateway_url = self.value(self.gateway_url, "LH_GATEWAY_URL")
        workspace_id = self.value(self.workspace_id, "LOBEHUB_WORKSPACE_ID")
        run_mode = self.value(self.run_mode_arg, "LH_RUN_MODE", "agent")
        if run_mode not in {"agent", "task"}:
            raise ValueError("LH_RUN_MODE must be 'agent' or 'task'")
        cli = "lh" if self.uses_system_cli else f"bash {DEV_CLI_RUNNER}"
        cli_path = "/usr/local/bin/lh" if self.uses_system_cli else DEV_CLI_RUNNER
        agent_option = (
            f" --agent-id {shlex.quote(agent_id)}"
            if agent_id
            else f" --agent-slug {shlex.quote(agent_slug)}"
        )
        self.host_cli_dir()
        workspace_env = (
            f"export LOBEHUB_WORKSPACE_ID={shlex.quote(workspace_id)}; "
            if workspace_id
            else ""
        )

        login = (
            workspace_env + f"rm -f {_LOGIN_READY} {_DEVICE_READY}; "
            f"({cli} whoami >/dev/null 2>&1 || {cli} login"
        )
        if server_url:
            login += f" --server {shlex.quote(server_url)}"
        login += f") && touch {_LOGIN_READY}"

        connect = self.render(
            "connect-lh.sh.j2",
            cli_command=cli,
            connect_script=_CONNECT_SCRIPT,
            device_ready=_DEVICE_READY,
            gateway_url=shlex.quote(gateway_url) if gateway_url else "",
            login_ready=_LOGIN_READY,
            workspace_id=shlex.quote(workspace_id) if workspace_id else "",
            supervisor_config=_SUPERVISOR_CONFIG,
            supervisor_socket=_SUPERVISOR_SOCKET,
        )
        ready = (
            workspace_env + f"test -f {_LOGIN_READY} || exit 1; "
            f"{CHECK_LH_PATH} -- {cli} && touch {_DEVICE_READY}"
        )
        run = (
            workspace_env + f"test -f {_LOGIN_READY} || exit 1; "
            f"node {shlex.quote(RUN_AGENT_PATH)}"
            f" --cli {shlex.quote(cli_path)}"
            f"{agent_option}"
            f" --run-mode {shlex.quote(run_mode)}"
            f" --prompt {shlex.quote(instruction)}"
            f" --device-ready {shlex.quote(_DEVICE_READY)}"
            ' --status-path "$HOME/.lobehub/daemon.status.json"'
            f" --supervisor-config {shlex.quote(_SUPERVISOR_CONFIG)}"
        )
        return [login, connect, ready, run]

    @staticmethod
    def populate_context(logs_dir: Path, context: Any) -> None:
        try:
            lines = (logs_dir / "operation-status.jsonl").read_text().splitlines()
        except OSError:
            return

        for line in reversed(lines):
            try:
                state = json.loads(line)["currentState"]
                tokens = state.get("usage", {}).get("llm", {}).get("tokens", {})
                cost = state.get("cost") or {}
                if isinstance(tokens.get("input"), int):
                    context.n_input_tokens = tokens["input"]
                if isinstance(tokens.get("output"), int):
                    context.n_output_tokens = tokens["output"]
                if cost.get("currency") == "USD" and isinstance(
                    cost.get("total"), (int, float)
                ):
                    context.cost_usd = cost["total"]
                cached = [
                    model.get("usage", {}).get("inputCachedTokens")
                    for model in cost.get("llm", {}).get("byModel", [])
                    if isinstance(model, dict)
                ]
                if cached and all(isinstance(value, int) for value in cached):
                    context.n_cache_tokens = sum(cached)
                return
            except (KeyError, TypeError, ValueError, AttributeError):
                continue
