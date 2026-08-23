"""Contratos de acabamento da entrega web profissional."""

from __future__ import annotations

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "web" / "styles.css").read_text(encoding="utf-8")
APP = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
FACE = (ROOT / "web" / "face-identities.js").read_text(encoding="utf-8")


class MarkupCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.buttons: list[dict[str, str]] = []
        self.external_blank_links: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "button":
            self.buttons.append(values)
        if tag == "a" and values.get("target") == "_blank":
            self.external_blank_links.append(values)


class TestWebDeliveryQuality(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.markup = MarkupCollector()
        cls.markup.feed(HTML)

    def test_document_has_unique_ids(self) -> None:
        self.assertEqual(len(self.markup.ids), len(set(self.markup.ids)))

    def test_metadata_language_and_favicon_are_complete(self) -> None:
        self.assertIn('<html lang="pt-BR">', HTML)
        self.assertIn('name="description"', HTML)
        self.assertIn('name="theme-color"', HTML)
        self.assertIn('rel="icon" href="web/favicon.svg"', HTML)
        self.assertTrue((ROOT / "web" / "favicon.svg").is_file())

    def test_face_runtime_is_lazy_and_retryable(self) -> None:
        self.assertNotIn('<script src="web/vendor/human/human.js', HTML)
        self.assertIn("loadHumanLibrary", FACE)
        self.assertIn("humanLibraryPromise = null", FACE)
        self.assertIn("document.head.append(script)", FACE)

    def test_simulator_has_keyboard_contract_and_accessible_help(self) -> None:
        self.assertIn('id="simulatorCommandPanel" tabindex="0"', HTML)
        self.assertIn('aria-describedby="simulatorHint"', HTML)
        self.assertIn('id="simulatorHint" role="status" aria-live="polite"', HTML)
        for marker in ('"1": "FRENTE"', 'ArrowRight: "DIREITA"', 'ArrowLeft: "ESQUERDA"', '"4": "PARAR"', '"5": "GIRAR"'):
            self.assertIn(marker, APP)

    def test_critical_dynamic_statuses_are_announced(self) -> None:
        for element_id in ("overallModeStatus", "simulatorHint", "cameraStatus", "faceStatus", "codeStatus"):
            tag = re.search(rf"<[^>]*id=\"{element_id}\"[^>]*>", HTML)
            self.assertIsNotNone(tag, element_id)
            surrounding = HTML[max(0, tag.start() - 180):tag.end() + 50]
            self.assertIn('aria-live="polite"', surrounding, element_id)

    def test_reduced_motion_and_visible_focus_are_supported(self) -> None:
        self.assertIn("@media (prefers-reduced-motion: reduce)", CSS)
        self.assertIn(":focus-visible", CSS)
        self.assertIn("outline: 3px solid var(--cyan)", CSS)

    def test_below_fold_panels_use_content_visibility(self) -> None:
        self.assertIn("content-visibility: auto", CSS)
        self.assertIn("contain-intrinsic-size: auto 720px", CSS)

    def test_external_blank_links_prevent_opener_access(self) -> None:
        self.assertTrue(self.markup.external_blank_links)
        for link in self.markup.external_blank_links:
            rel = set(link.get("rel", "").split())
            self.assertTrue({"noreferrer", "noopener"} & rel)

    def test_no_inline_event_handlers_are_used(self) -> None:
        self.assertNotRegex(HTML, r"\son(?:click|keydown|submit)=")

    def test_asset_versions_force_the_professional_release(self) -> None:
        for marker in ("web/styles.css?v=13", "web/app.js?v=10", "web/face-identities.js?v=11"):
            self.assertIn(marker, HTML)


if __name__ == "__main__":
    unittest.main(verbosity=2)
