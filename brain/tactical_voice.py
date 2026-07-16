from __future__ import annotations

import queue
import threading
import time
from typing import Dict


class TacticalVoice:
    """Non-blocking text-to-speech queue."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self.messages: "queue.Queue[str]" = queue.Queue()
        self.thread: threading.Thread | None = None
        self.running = False
        self.last_spoken: Dict[str, float] = {}

    def start(self) -> None:
        if not self.enabled or self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def say(self, text: str) -> None:
        if not self.enabled:
            return
        now = time.time()
        if now - self.last_spoken.get(text, 0.0) < 5.0:
            return
        self.last_spoken[text] = now
        self.messages.put(text)

    def stop(self) -> None:
        self.running = False
        self.messages.put("")
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.0)

    def _worker(self) -> None:
        engine = None
        try:
            import pyttsx3

            engine = pyttsx3.init()
            engine.setProperty("rate", 172)
        except Exception:
            engine = None
        while self.running:
            text = self.messages.get()
            if not text:
                continue
            if engine is None:
                continue
            try:
                engine.say(text)
                engine.runAndWait()
            except Exception:
                pass
