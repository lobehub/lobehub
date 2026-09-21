from __future__ import annotations

import base64
import shlex
from pathlib import Path

from lh.adapter import CHECK_LH_PATH, DEV_CLI_DIR, RUN_AGENT_PATH, LhAdapter
from pier.agents.installed.base import BaseInstalledAgent
from pier.environments.base import BaseEnvironment
from pier.models.agent.context import AgentContext
from pier.models.agent.install import AgentInstallSpec, InstallStep


class LhPierInstalledAgent(BaseInstalledAgent):
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
        run_mode: str | None = None,
        workspace_id: str | None = None,
        *args,
        **kwargs,
    ):
        super().__init__(
            *args,
            logs_dir=logs_dir,
            prompt_template_path=prompt_template_path,
            version=version,
            extra_env=extra_env,
            **kwargs,
        )
        self._lh = LhAdapter(
            self._get_env,
            agent_id=agent_id,
            workspace_id=workspace_id,
            server_url=server_url,
            gateway_url=gateway_url,
            cli_source=cli_source,
            run_mode=run_mode,
        )

    @staticmethod
    def name() -> str:
        return "lh"

    @staticmethod
    def _write_file_command(path: str, contents: str) -> str:
        encoded = base64.b64encode(contents.encode()).decode()
        return f"printf %s {shlex.quote(encoded)} | base64 -d > {shlex.quote(path)}"

    def install_spec(self) -> AgentInstallSpec:
        install_script = self._lh.install_script(
            install_cli=self._lh.host_cli_dir() is None
        )
        setup = "set -euo pipefail; mkdir -p /installed-agent /opt/lh-dev; "
        setup += self._write_file_command(
            "/installed-agent/install-lh.sh", install_script
        )
        setup += "; " + self._write_file_command(
            CHECK_LH_PATH, self._lh.render("check-lh.sh.j2")
        )
        setup += "; " + self._write_file_command(
            RUN_AGENT_PATH, self._lh.render("run-agent.js")
        )
        setup += (
            f"; chmod +x /installed-agent/install-lh.sh {CHECK_LH_PATH}; "
            "/installed-agent/install-lh.sh"
        )
        return AgentInstallSpec(
            agent_name=self.name(),
            version=self._version,
            steps=[InstallStep(user="root", run=setup)],
        )

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        host_dir = self._lh.host_cli_dir()
        if host_dir is not None:
            await environment.upload_file(
                host_dir / "package.json", f"{DEV_CLI_DIR}/package.json"
            )
            await environment.upload_dir(host_dir / "dist", f"{DEV_CLI_DIR}/dist")
        for command in self._lh.run_commands(self.render_instruction(instruction)):
            await self.exec_as_agent(environment, command=command)

        self.logs_dir.mkdir(parents=True, exist_ok=True)
        status_log = self.logs_dir / "operation-status.jsonl"
        downloaded = status_log.with_suffix(".jsonl.download")
        await environment.download_file(
            "/logs/agent/operation-status.jsonl", downloaded
        )
        downloaded.replace(status_log)
        self._lh.populate_context(self.logs_dir, context)

    def populate_context_post_run(self, context: AgentContext) -> None:
        self._lh.populate_context(self.logs_dir, context)
