"""GeminiAssistant — Conversational AI with live Quantum Tracker context."""
from __future__ import annotations

import logging
import threading
from typing import Callable, List, Optional

from core.models import TrackedTarget, TargetState
from utils.config import AppConfig

logger = logging.getLogger("gemini_assistant")

# System persona injected on every conversation
_SYSTEM_PROMPT = """Voce e o QUANTUM AI, a inteligencia artificial tatica integrada ao sistema de rastreamento QUANTUM TRACKER.
Voce monitora alvos em tempo real usando cameras, detecta pessoas com YOLOv8, rastreia com ByteTrack, reconhece rostos com InsightFace e interpreta gestos com MediaPipe.

Regras do seu comportamento:
- Responda SEMPRE em portugues do Brasil.
- Seja objetivo, tecnico e claro. Respostas curtas a medio, nao escreva paredes de texto.
- Quando tiver contexto do sistema, use-o para dar respostas relevantes.
- Voce pode analisar situacoes, sugerir acoes e alertar sobre anomalias.
- Se nao souber algo, seja honesto.
- Tom: profissional, mas acessivel. Como um assistente militar inteligente.
"""


class GeminiAssistant:
    """Manages a persistent conversation session with Gemini, injecting
    live system context into every prompt so the AI knows what is happening."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self._model = None
        self._chat = None
        self.available = False
        self.error_message = ""
        self._lock = threading.Lock()

        self._init(config.gemini_api_key)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def configure(self, api_key: str) -> bool:
        """(Re)initialize with a new API key. Returns True on success."""
        return self._init(api_key)

    def ask(
        self,
        question: str,
        targets: Optional[List[TrackedTarget]] = None,
        fps: float = 0.0,
        mode: str = "idle",
        on_done: Optional[Callable[[str], None]] = None,
    ) -> Optional[str]:
        """Send a message to Gemini with live system context.
        
        If on_done is provided, sends in background thread and returns None immediately.
        Otherwise blocks and returns the answer string.
        """
        if not self.available:
            return f"[QUANTUM AI offline] {self.error_message or 'Configure a API key do Gemini na aba de Configuracoes.'}"

        full_prompt = self._build_prompt(question, targets or [], fps, mode)

        if on_done:
            threading.Thread(
                target=self._send_async,
                args=(full_prompt, on_done),
                daemon=True,
            ).start()
            return None
        else:
            return self._send_sync(full_prompt)

    def reset_chat(self) -> None:
        """Start a new conversation (clear history)."""
        with self._lock:
            if self._model is not None:
                try:
                    self._chat = self._model.start_chat(history=[])
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _init(self, api_key: str) -> bool:
        if not api_key or api_key.strip() == "":
            self.available = False
            self.error_message = "API Key nao configurada."
            return False
        try:
            import google.generativeai as genai
            genai.configure(api_key=api_key.strip())
            model = genai.GenerativeModel(
                model_name=self.config.gemini_model,
                system_instruction=_SYSTEM_PROMPT,
            )
            chat = model.start_chat(history=[])
            with self._lock:
                self._model = model
                self._chat = chat
            self.available = True
            self.error_message = ""
            logger.info("Gemini configurado com sucesso.")
            return True
        except Exception as exc:
            self.available = False
            self.error_message = str(exc)
            logger.warning(f"Gemini nao disponivel: {exc}")
            return False

    def _build_prompt(
        self,
        question: str,
        targets: List[TrackedTarget],
        fps: float,
        mode: str,
    ) -> str:
        """Builds the prompt with injected real-time system context."""
        lines = ["--- CONTEXTO DO SISTEMA AGORA ---"]
        lines.append(f"Modo: {mode.upper()}")
        lines.append(f"FPS: {fps:.1f}")
        lines.append(f"Total de alvos detectados: {len(targets)}")

        visible = [t for t in targets if t.state == TargetState.VISIBLE]
        ghost   = [t for t in targets if t.state == TargetState.GHOST]
        lost    = [t for t in targets if t.state == TargetState.LOST]

        lines.append(f"Visiveis: {len(visible)} | Ghost: {len(ghost)} | Perdidos: {len(lost)}")

        for t in targets[:5]:  # limit context to 5 targets
            name = t.name or "Desconhecido"
            lines.append(
                f"  - ID {t.track_id} | {name} | Estado: {t.state.value} "
                f"| Confianca: {t.confidence:.0%} | Velocidade: {t.speed:.1f}px/f"
            )

        if ghost:
            lines.append("ALERTA: Ha alvos em modo Ghost (oclusos). Rastreamento por Kalman ativo.")

        lines.append("--- FIM DO CONTEXTO ---")
        lines.append(f"\nPERGUNTA DO OPERADOR: {question}")

        return "\n".join(lines)

    def _send_sync(self, prompt: str) -> str:
        with self._lock:
            try:
                response = self._chat.send_message(prompt)
                return response.text
            except Exception as exc:
                logger.warning(f"Gemini error: {exc}")
                return f"[Erro na comunicacao com Gemini: {exc}]"

    def _send_async(self, prompt: str, on_done: Callable[[str], None]) -> None:
        answer = self._send_sync(prompt)
        on_done(answer)
