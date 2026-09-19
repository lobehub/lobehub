from __future__ import annotations

import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from jinja2 import Environment, FileSystemLoader, StrictUndefined

_HOST_DIR_PREFIX = "host-dir:"
_DEV_CLI_DIR = "/opt/lh-dev"
_DEV_CLI_RUNNER = f"{_DEV_CLI_DIR}/run-lh.sh"
_CHECK_LH_PATH = "/installed-agent/check-lh.sh"
_CONNECT_SCRIPT = "/tmp/lh-connect-supervised.sh"
_LOGIN_READY = "/tmp/lh-login-ready"
_DEVICE_READY = "/tmp/lh-device-ready"
_SUPERVISOR_CONFIG = "/tmp/lh-supervisord.conf"
_SUPERVISOR_SOCKET = "/tmp/lh-supervisor.sock"
_TEMPLATE_DIR = Path(__file__).with_name("template")
_TEMPLATES = Environment(
    autoescape=False,
    keep_trailing_newline=True,
    loader=FileSystemLoader(_TEMPLATE_DIR),
    undefined=StrictUndefined,
)


class LhInstalledAgent(BaseInstalledAgent):
    def __init__(
        self,
        logs_dir: Path,
        prompt_template_path: Path | str | None = None,
        version: str | None = None,
        extra_env: dict[str, str] | None = None,
        agent_id: str | None = None,
        server_url: str | None = None,
        gateway_url: str | None = None,
        cli_source: str | None = None,
        *args,
        **kwargs,
    ):
        self._agent_id = agent_id
        self._server_url = server_url
        self._gateway_url = gateway_url
        self._cli_source_arg = cli_source
        super().__init__(
            logs_dir=logs_dir,
            prompt_template_path=prompt_template_path,
            version=version,
            extra_env=extra_env,
            *args,
            **kwargs,
        )

    @staticmethod
    def name() -> str:
        return "lh"

    def _value(self, direct: str | None, env_name: str, default: str = "") -> str:
        return (direct or self._get_env(env_name) or default).strip()

    @property
    def _cli_source(self) -> str:
        return self._value(self._cli_source_arg, "LH_CLI_SOURCE", "system")

    def _render_template(self, name: str, **values: object) -> str:
        return _TEMPLATES.get_template(name).render(**values)

    def _host_cli_dir(self) -> Path:
        if not self._cli_source.startswith(_HOST_DIR_PREFIX):
            raise ValueError(f"Unsupported LH_CLI_SOURCE: {self._cli_source}")

        path = Path(self._cli_source.removeprefix(_HOST_DIR_PREFIX)).expanduser()
        if not path.is_absolute():
            raise ValueError("LH_CLI_SOURCE host-dir path must be absolute")
        for required in (path / "package.json", path / "dist" / "index.js"):
            if not required.is_file():
                raise FileNotFoundError(f"Missing local LH CLI build input: {required}")
        return path

    def _cli_command(self) -> str:
        if self._cli_source == "system":
            return "lh"
        self._host_cli_dir()
        return f"bash {_DEV_CLI_RUNNER}"

    def _agent_target(self) -> tuple[str, str]:
        agent_id = self._value(self._agent_id, "LH_AGENT_ID")
        if agent_id:
            return "--agent-id", agent_id
        raise ValueError("LH_AGENT_ID is required")

    async def install(self, environment: BaseEnvironment) -> None:
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        await self.exec_as_root(
            environment,
            command=f"mkdir -p /installed-agent {shlex.quote(_DEV_CLI_DIR)}",
        )

        if self._cli_source != "system":
            host_dir = self._host_cli_dir()
            await environment.upload_file(host_dir / "package.json", f"{_DEV_CLI_DIR}/package.json")
            await environment.upload_dir(host_dir / "dist", f"{_DEV_CLI_DIR}/dist")

        install_script = self.logs_dir / "install-lh.sh"
        install_script.write_text(
            self._render_template(
                "install-lh.sh.j2",
                cli_package=shlex.quote("@lobehub/cli"),
                node_version=shlex.quote(self._value(None, "LH_NODE_VERSION", "24")),
                use_system_cli=self._cli_source == "system",
            )
        )
        await environment.upload_file(install_script, "/installed-agent/install-lh.sh")
        await self.exec_as_root(
            environment,
            command="chmod +x /installed-agent/install-lh.sh && /installed-agent/install-lh.sh",
        )

        check_script = self.logs_dir / "check-lh.sh"
        check_script.write_text(self._render_template("check-lh.sh.j2"))
        await environment.upload_file(check_script, _CHECK_LH_PATH)
        await self.exec_as_root(
            environment,
            command=f"chmod +x {shlex.quote(_CHECK_LH_PATH)}",
        )

    def create_run_agent_commands(self, instruction: str) -> list[str]:
        selector_flag, selector_value = self._agent_target()
        server_url = self._value(self._server_url, "LH_SERVER_URL")
        gateway_url = self._value(self._gateway_url, "LH_GATEWAY_URL")
        cli = self._cli_command()

        login = (
            f"rm -f {_LOGIN_READY} {_DEVICE_READY}; "
            f"({cli} whoami >/dev/null 2>&1 || {cli} login"
        )
        if server_url:
            login += f" --server {shlex.quote(server_url)}"
        login += f") && touch {_LOGIN_READY}"

        connect = self._render_template(
            "connect-lh.sh.j2",
            cli_command=cli,
            connect_script=_CONNECT_SCRIPT,
            device_ready=_DEVICE_READY,
            gateway_url=shlex.quote(gateway_url) if gateway_url else "",
            login_ready=_LOGIN_READY,
            supervisor_config=_SUPERVISOR_CONFIG,
            supervisor_socket=_SUPERVISOR_SOCKET,
        )
        ready = (
            f"test -f {_LOGIN_READY} || exit 1; "
            f"{_CHECK_LH_PATH} -- {cli} && touch {_DEVICE_READY}"
        )
        run = self._render_template(
            "run-agent.sh.j2",
            cli_command=cli,
            device_ready=_DEVICE_READY,
            instruction=shlex.quote(instruction),
            selector_flag=selector_flag,
            selector_value=shlex.quote(selector_value),
            supervisor_config=_SUPERVISOR_CONFIG,
        )
        return [login, connect, ready, run]

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        del context
        for command in self.create_run_agent_commands(self.render_instruction(instruction)):
            await self.exec_as_agent(environment, command=command)
