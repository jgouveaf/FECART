"""OpenAI-backed conversational AI with live Quantum Tracker context."""
from __future__ import annotations

import logging
import threading
from typing import Callable, List, Optional

from core.models import TrackedTarget, TargetState
from utils.config import AppConfig

logger = logging.getLogger("quantum_ai")

_SYSTEM_PROMPT = """Você é o QUANTUM AI, a inteligência artificial tática integrada ao QUANTUM TRACKER.
Responda sempre em português do Brasil, de modo objetivo e claro. Você pode analisar o contexto
de rastreamento apresentado, indicar anomalias e sugerir ações seguras. Não invente dados ausentes."""


class GeminiAssistant:
    """Compatibility-named assistant implemented with the OpenAI Responses API."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self._client = None
        self._history: list[tuple[str, str]] = []
        self.available = False
        self.error_message = ""
        self._lock = threading.Lock()
        self._init(config.openai_api_key)

    def configure(self, api_key: str) -> bool:
        return self._init(api_key)

    def ask(
        self,
        question: str,
        targets: Optional[List[TrackedTarget]] = None,
        fps: float = 0.0,
        mode: str = "idle",
        on_done: Optional[Callable[[str], None]] = None,
    ) -> Optional[str]:
        if not self.available:
            return f"[QUANTUM AI offline] {self.error_message or 'Configure uma API key da OpenAI.'}"

        prompt = self._build_prompt(question, targets or [], fps, mode)
        if on_done:
            threading.Thread(target=self._send_async, args=(prompt, question, on_done), daemon=True).start()
            return None
        return self._send_sync(prompt, question)

    def reset_chat(self) -> None:
        with self._lock:
            self._history.clear()

    def _init(self, api_key: str) -> bool:
        if not api_key or not api_key.strip():
            self.available = False
            self.error_message = "API key não configurada."
            return False
        try:
            from openai import OpenAI

            with self._lock:
                self._client = OpenAI(api_key=api_key.strip())
                self._history.clear()
            self.available = True
            self.error_message = ""
            return True
        except Exception as exc:
            self.available = False
            self.error_message = str(exc)
            logger.warning("OpenAI indisponível: %s", exc)
            return False

    def _build_prompt(self, question: str, targets: List[TrackedTarget], fps: float, mode: str) -> str:
        lines = [_SYSTEM_PROMPT, "", "--- CONTEXTO DO SISTEMA AGORA ---"]
        lines.extend((
            f"Modo: {mode.upper()}",
            f"FPS: {fps:.1f}",
            f"Total de alvos detectados: {len(targets)}",
        ))
        visible = [target for target in targets if target.state == TargetState.VISIBLE]
        ghost = [target for target in targets if target.state == TargetState.GHOST]
        lost = [target for target in targets if target.state == TargetState.LOST]
        lines.append(f"Visíveis: {len(visible)} | Ghost: {len(ghost)} | Perdidos: {len(lost)}")
        for target in targets[:5]:
            lines.append(
                f"- ID {target.track_id} | {target.name or 'Desconhecido'} | Estado: {target.state.value} "
                f"| Confiança: {target.confidence:.0%} | Velocidade: {target.speed:.1f}px/f"
            )
        if ghost:
            lines.append("Alerta: há alvos em modo Ghost; rastreamento por Kalman ativo.")
        lines.extend(("--- FIM DO CONTEXTO ---", f"PERGUNTA DO OPERADOR: {question}"))

        with self._lock:
            history = list(self._history[-8:])
        if history:
            transcript = "\n".join(f"{role}: {message}" for role, message in history)
            lines.extend(("", "--- CONVERSA ANTERIOR ---", transcript))
        return "\n".join(lines)

    def _send_sync(self, prompt: str, question: str) -> str:
        try:
            with self._lock:
                if self._client is None:
                    return "[QUANTUM AI offline] Cliente OpenAI não inicializado."
                response = self._client.responses.create(model=self.config.openai_model, input=prompt)
            answer = response.output_text.strip() or "A OpenAI não retornou uma resposta de texto."
            with self._lock:
                self._history.extend((("OPERADOR", question), ("QUANTUM AI", answer)))
            return answer
        except Exception as exc:
            logger.warning("Erro na comunicação com OpenAI: %s", exc)
            return f"[Erro na comunicação com OpenAI: {exc}]"

    def _send_async(self, prompt: str, question: str, on_done: Callable[[str], None]) -> None:
        on_done(self._send_sync(prompt, question))
