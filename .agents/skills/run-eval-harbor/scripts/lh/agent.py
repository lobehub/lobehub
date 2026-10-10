from __future__ import annotations

from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from lh.adapter import CHECK_LH_PATH, DEV_CLI_DIR, RUN_AGENT_PATH, LhAdapter


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

    async def install(self, environment: BaseEnvironment) -> None:
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        await self.exec_as_root(
            environment, command=f"mkdir -p /installed-agent {DEV_CLI_DIR}"
        )

        host_dir = self._lh.host_cli_dir()
        if host_dir is not None:
            await environment.upload_file(
                host_dir / "package.json", f"{DEV_CLI_DIR}/package.json"
            )
            await environment.upload_dir(host_dir / "dist", f"{DEV_CLI_DIR}/dist")

        scripts = {
            "/installed-agent/install-lh.sh": self._lh.install_script(install_cli=True),
            CHECK_LH_PATH: self._lh.render("check-lh.sh.j2"),
            RUN_AGENT_PATH: self._lh.render("run-agent.js"),
        }
        for remote_path, contents in scripts.items():
            local_path = self.logs_dir / Path(remote_path).name
            local_path.write_text(contents)
            await environment.upload_file(local_path, remote_path)
        await self.exec_as_root(
            environment,
            command=(
                f"chmod +x /installed-agent/install-lh.sh {CHECK_LH_PATH} && "
                "/installed-agent/install-lh.sh"
            ),
        )

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        del context
        for command in self._lh.run_commands(self.render_instruction(instruction)):
            await self.exec_as_agent(environment, command=command)

    def populate_context_post_run(self, context: AgentContext) -> None:
        self._lh.populate_context(self.logs_dir, context)
