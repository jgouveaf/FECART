"""Configuracao segura do chat OpenAI, sem rede e sem chave real."""

from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from brain.gemini_assistant import GeminiAssistant
from core.models import BoundingBox, TargetState, TrackedTarget
from utils.config import AppConfig


class FakeResponses:
    def __init__(self) -> None:
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(output_text="Resposta offline simulada")


class FakeClient:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.responses = FakeResponses()


class TestAIConfigurationOffline(unittest.TestCase):
    def test_missing_key_keeps_chat_offline(self) -> None:
        assistant = GeminiAssistant(replace(AppConfig(), openai_api_key=""))
        self.assertFalse(assistant.available)
        self.assertIn("offline", assistant.ask("status").lower())

    def test_fake_client_receives_context_without_network(self) -> None:
        fake_module = SimpleNamespace(OpenAI=FakeClient)
        config = replace(AppConfig(), openai_api_key="chave-de-teste", openai_model="modelo-teste")
        with patch.dict(sys.modules, {"openai": fake_module}):
            assistant = GeminiAssistant(config)
            target = TrackedTarget(
                4,
                BoundingBox(10, 20, 60, 180),
                0.93,
                state=TargetState.VISIBLE,
                name="Pessoa teste",
            )
            answer = assistant.ask("Qual o status?", [target], 30.0, "offline")
        self.assertEqual(answer, "Resposta offline simulada")
        call = assistant._client.responses.calls[0]
        self.assertEqual(call["model"], "modelo-teste")
        self.assertIn("Pessoa teste", call["input"])
        self.assertNotIn("chave-de-teste", call["input"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
