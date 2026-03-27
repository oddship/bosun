"""Harbor adapter for Pi (plain, no extensions).

Usage:
    harbor run -d terminal-bench@2.0 \
        --agent-import-path packages.pi-weaver.harbor.pi_agent:PiAgent \
        -m openai-codex/gpt-5.4-mini \
        --ae PI_AUTH_JSON='{"openai-codex":{"type":"oauth",...}}' \
        -n 1
"""

import json
import os
import shlex
from pathlib import Path
from typing import Any

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.agent.name import AgentName


class PiAgent(BaseInstalledAgent):
    """Plain Pi agent — single conversation, no extensions."""

    SUPPORTS_ATIF: bool = False  # TODO: add trajectory conversion later

    @staticmethod
    def name() -> str:
        return "pi"

    def get_version_command(self) -> str | None:
        return 'export PATH="$HOME/.bun/bin:$PATH"; pi --version 2>/dev/null || echo "unknown"'

    def parse_version(self, stdout: str) -> str:
        import re
        text = stdout.strip()
        match = re.search(r"(\d+\.\d+\.\d+)", text)
        return match.group(1) if match else text

    async def install(self, environment: BaseEnvironment) -> None:
        # Install system deps (root)
        await self.exec_as_root(
            environment,
            command=(
                "if command -v apk &> /dev/null; then"
                "  apk add --no-cache curl bash git;"
                " elif command -v apt-get &> /dev/null; then"
                "  apt-get update && apt-get install -y curl git unzip;"
                " fi"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

        # Install bun + pi (as agent user)
        # pi's CLI shebang is #!/usr/bin/env node — symlink bun as node
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "curl -fsSL https://bun.sh/install | bash && "
                'export PATH="$HOME/.bun/bin:$PATH" && '
                "ln -sf $(which bun) $HOME/.bun/bin/node && "
                "bun add -g @mariozechner/pi-coding-agent && "
                "pi --version"
            ),
        )

        # Write auth.json from env
        auth_json = os.environ.get("PI_AUTH_JSON", "")
        if auth_json:
            await self.exec_as_agent(
                environment,
                command=(
                    "mkdir -p ~/.pi/agent && "
                    f"echo {shlex.quote(auth_json)} > ~/.pi/agent/auth.json && "
                    "chmod 600 ~/.pi/agent/auth.json"
                ),
            )

        # Write settings.json with model config
        provider, model = self._parse_model_name()
        settings = {"defaultProvider": provider, "defaultModel": model}
        settings_json = json.dumps(settings)
        await self.exec_as_agent(
            environment,
            command=(
                "mkdir -p ~/.pi/agent && "
                f"echo {shlex.quote(settings_json)} > ~/.pi/agent/settings.json"
            ),
        )

    def _parse_model_name(self) -> tuple[str, str]:
        """Parse 'provider/model' into (provider, model). Default to openai-codex."""
        if self.model_name and "/" in self.model_name:
            parts = self.model_name.split("/", 1)
            return parts[0], parts[1]
        elif self.model_name:
            return "openai-codex", self.model_name
        return "openai-codex", "gpt-5.4-mini"

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        escaped_instruction = shlex.quote(instruction)

        env = {
            # Disable any interactive features
            "CI": "1",
        }

        # Pass through auth env vars as fallback
        for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
            val = os.environ.get(key, "")
            if val:
                env[key] = val

        # NOTE: Don't set PATH in env dict — Docker -e doesn't expand $HOME/$PATH.
        # Set it inside the command string instead.
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.bun/bin:$PATH"; '
                f"pi --no-session -p -- {escaped_instruction} "
                f"2>&1 | tee /logs/agent/pi.txt"
            ),
            env=env,
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        """Extract basic info from pi output. TODO: parse session JSONL for ATIF."""
        log_file = self.logs_dir / "pi.txt"
        if log_file.exists():
            content = log_file.read_text()
            # Log output length for debugging
            print(f"Pi output: {len(content)} bytes")
