from __future__ import annotations

import queue
import threading
from typing import Callable, Optional


class SpeechListener:
    """One-shot microphone listener. It is optional and never blocks the UI."""

    def __init__(self, on_text: Callable[[str], None]) -> None:
        self.on_text = on_text
        self.errors: "queue.Queue[str]" = queue.Queue()
        self.thread: Optional[threading.Thread] = None

    def listen_once(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _worker(self) -> None:
        try:
            import speech_recognition as sr

            recognizer = sr.Recognizer()
            with sr.Microphone() as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.4)
                audio = recognizer.listen(source, timeout=5, phrase_time_limit=6)
            text = recognizer.recognize_google(audio, language="pt-BR")
            self.on_text(text)
        except Exception as exc:
            self.errors.put(f"Microfone indisponivel: {exc}")
