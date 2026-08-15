from __future__ import annotations

from typing import Iterable, Optional

from core.models import EventRecord, EventType, SystemEvent
from utils.config import AppConfig


class QuantumBrain:
    """Tactical analysis with OpenAI support and a local fallback."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.model = None
        if config.openai_api_key:
            try:
                from openai import OpenAI

                self.model = OpenAI(api_key=config.openai_api_key)
            except Exception:
                self.model = None

    def analyze_event(self, event: SystemEvent) -> str:
        name = event.name or "desconhecido"
        if event.event_type == EventType.TARGET_IDENTIFIED:
            return f"Alvo {name} identificado com {event.confidence:.0%} de confianca. Rastreamento estavel."
        if event.event_type == EventType.GHOST_ACTIVATED:
            return f"Modo Ghost ativado para ID {event.track_id}. Posicao estimada por filtro de Kalman."
        if event.event_type == EventType.TARGET_LOST:
            return f"Rastreamento parcialmente perdido para ID {event.track_id}. Aguardando reacquisicao."
        return self._local("Evento registrado em modo local.")

    def ask(self, question: str) -> str:
        prompt = (
            "Voce e o QuantumBrain, uma IA tatica de uma feira cientifica. "
            "Responda de forma curta, tecnica e clara.\n"
            f"Pergunta: {question}"
        )
        remote = self._generate(prompt)
        return remote or self._local(f"Pergunta recebida: {question}")

    def generate_report(self, events: Iterable[EventRecord]) -> str:
        lines = ["RELATORIO QUANTUM TRACKER", "", "Eventos recentes:"]
        for event in events:
            lines.append(f"- {event.timestamp} | ID {event.track_id} | {event.name or 'UNKNOWN'} | {event.event} | {event.state}")
        prompt = "\n".join(lines) + "\n\nGere uma analise tatica breve."
        remote = self._generate(prompt)
        return remote or "\n".join(lines + ["", "Analise local: sistema operacional, logs historicos disponiveis."])

    def _generate(self, prompt: str) -> Optional[str]:
        if self.model is None:
            return None
        try:
            response = self.model.responses.create(
                model=self.config.openai_model,
                input=prompt,
            )
            return response.output_text or None
        except Exception:
            return None

    def _local(self, text: str) -> str:
        return f"Conexao neural indisponivel. Operando em modo local. {text}"
