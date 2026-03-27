"""Harbor adapter for Pi + Weaver extension (checkpoint/time_lapse/done).

Usage:
    harbor run -d terminal-bench@2.0 \
        --agent-import-path packages.pi-weaver.harbor.pi_weaver_agent:PiWeaverAgent \
        -m openai-codex/gpt-5.4-mini \
        --ae PI_AUTH_JSON='{"openai-codex":{"type":"oauth",...}}' \
        -n 1
"""

import os
import shlex
from pathlib import Path
from typing import Any

from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

# Import the plain Pi agent as base — same directory
from .pi_agent import PiAgent


# Path to the weaver extension — go up from pi_harbor/ to harbor/ to pi-weaver/
WEAVER_EXTENSION_DIR = Path(__file__).parent.parent.parent / "extension"


class PiWeaverAgent(PiAgent):
    """Pi agent with Weaver extension — checkpoint, time_lapse, done tools."""

    @staticmethod
    def name() -> str:
        return "pi-weaver"

    async def install(self, environment: BaseEnvironment) -> None:
        # Do base pi install (bun, pi, auth, settings)
        await super().install(environment)

        # Copy weaver extension files into the container
        extension_dir = WEAVER_EXTENSION_DIR
        if not extension_dir.exists():
            raise RuntimeError(f"Weaver extension not found at {extension_dir}")

        # Upload extension files
        await self.exec_as_agent(
            environment,
            command="mkdir -p /installed-agent/weaver",
        )

        for fname in ("index.ts", "prompt.ts"):
            src = extension_dir / fname
            if src.exists():
                content = src.read_text()
                escaped = shlex.quote(content)
                await self.exec_as_agent(
                    environment,
                    command=f"cat > /installed-agent/weaver/{fname} << 'WEAVER_EOF'\n{content}\nWEAVER_EOF",
                )

    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        instruction = self.render_instruction(instruction)
        escaped_instruction = shlex.quote(instruction)

        env = {
            "CI": "1",
        }

        for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
            val = os.environ.get(key, "")
            if val:
                env[key] = val

        # NOTE: Don't set PATH in env dict — Docker -e doesn't expand $HOME/$PATH.
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.bun/bin:$PATH"; '
                "pi --no-session -p "
                "-e /installed-agent/weaver/index.ts "
                f"-- {escaped_instruction} "
                f"2>&1 | tee /logs/agent/pi-weaver.txt"
            ),
            env=env,
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        """Extract info from pi-weaver output."""
        for log_name in ("pi-weaver.txt", "pi.txt"):
            log_file = self.logs_dir / log_name
            if log_file.exists():
                content = log_file.read_text()
                print(f"Pi-weaver output: {len(content)} bytes")
                print(f"  Checkpoints: {content.count('📌')}")
                print(f"  Time lapses: {content.count('⏪')}")
                print(f"  Done calls: {content.count('✅')}")
                break
