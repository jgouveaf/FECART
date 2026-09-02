"""Real browser lifecycle tests for camera/gesture web controls.

No physical camera, serial port, or robot is opened. Playwright runs the real
``camera-controller.js`` against deterministic MediaStream fakes. Static tests
cover gesture model and command-timeout safety contracts.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CAMERA_SOURCE = ROOT / "web" / "camera-controller.js"
GESTURE_SOURCE = ROOT / "web" / "camera-gestures.js"
GESTURE_MATH_SOURCE = ROOT / "web" / "gesture-math.js"
FACE_QUALITY_SOURCE = ROOT / "web" / "face-quality.js"
ROBOT_SOURCE = ROOT / "web" / "robot-control.js"
HTML_SOURCE = ROOT / "index.html"
FILE_PROTOCOL_SCRIPT = ROOT / "tests" / "browser_file_protocol_redirect.cjs"


PLAYWRIGHT_HARNESS = r"""
const { chromium } = require("playwright");
const cameraSource = process.env.QT_CAMERA_SOURCE;
const markup = `
  <video id="cameraVideo"></video>
  <div id="cameraStage"></div>
  <button id="startCamera" disabled></button>
  <button id="stopCamera" disabled></button>
  <span id="cameraStatus"></span>
  <span id="cameraDot"></span>
  <strong id="cameraPlaceholderTitle"></strong>
  <small id="cameraPlaceholderHint"></small>
  <select id="cameraDeviceSelect"><option value="">Inicial</option></select>
  <span id="cameraFpsBadge"></span>`;

async function newHarnessPage(browser, behavior) {
  const page = await browser.newPage();
  await page.route("http://localhost/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: markup }));
  await page.goto("http://localhost/camera-lifecycle-test");
  await page.evaluate((initialBehavior) => {
    window.__gumBehavior = initialBehavior;
    window.__gumCalls = 0;
    window.__streams = [];
    window.__patches = [];
    window.__logs = [];
    window.QuantumControl = {
      state: { camera: { active: false, status: "OFFLINE" }, diagnostics: { lastError: "Nenhum" } },
      patch(section, values, meta) {
        this.state[section] = Object.assign(this.state[section] || {}, values);
        window.__patches.push({ section, values: { ...values }, meta });
      },
      log(level, source, message) { window.__logs.push({ level, source, message }); },
    };

    class FakeTrack extends EventTarget {
      constructor() { super(); this.stopCalls = 0; this.label = "Webcam simulada"; }
      stop() { this.stopCalls += 1; }
      getSettings() { return { deviceId: "camera-1", width: 1280, height: 720 }; }
    }
    class FakeStream {
      constructor() { this.track = new FakeTrack(); }
      getTracks() { return [this.track]; }
      getVideoTracks() { return [this.track]; }
    }
    window.__newStream = () => {
      const stream = new FakeStream();
      window.__streams.push(stream);
      return stream;
    };

    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() { return this.__srcObject || null; },
      set(value) { this.__srcObject = value; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1280 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 720 });
    HTMLMediaElement.prototype.play = async function play() { this.__playing = true; };
    HTMLMediaElement.prototype.pause = function pause() { this.__playing = false; };

    const mediaDevices = new EventTarget();
    mediaDevices.enumerateDevices = async () => [
      { kind: "videoinput", deviceId: "camera-1", label: "Webcam simulada" },
    ];
    mediaDevices.getUserMedia = async () => {
      window.__gumCalls += 1;
      if (window.__gumBehavior === "DENIED") {
        throw new DOMException("Permissão negada pelo teste", "NotAllowedError");
      }
      const candidate = window.__newStream();
      if (window.__gumBehavior === "PENDING") {
        return new Promise((resolve) => setTimeout(() => resolve(candidate), 120));
      }
      return candidate;
    };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });
  }, behavior);
  await page.addScriptTag({ path: cameraSource });
  await page.waitForFunction(() => Boolean(window.quantumCameraController));
  return page;
}

async function lateStopScenario(browser) {
  const page = await newHarnessPage(browser, "PENDING");
  await page.evaluate(() => {
    window.__startSettled = false;
    window.quantumCameraController.start()
      .then(() => { window.__startResult = "RESOLVED"; })
      .catch((error) => { window.__startResult = error.name; })
      .finally(() => { window.__startSettled = true; });
  });
  await page.waitForFunction(() => window.__gumCalls === 1);
  await page.evaluate(() => window.quantumCameraController.stop("TEST_STOP_DURING_START"));
  await page.waitForFunction(() => window.__startSettled === true, null, { timeout: 5000 });
  const result = await page.evaluate(() => ({
      phase: window.quantumCameraController.phase,
      active: window.quantumCameraController.active,
      hasStream: Boolean(window.quantumCameraController.stream),
      attached: Boolean(document.getElementById("cameraVideo").srcObject),
      gumCalls: window.__gumCalls,
      candidateStopCalls: window.__streams[0].track.stopCalls,
      startDisabled: document.getElementById("startCamera").disabled,
      stopDisabled: document.getElementById("stopCamera").disabled,
      startResult: window.__startResult,
    }));
  await page.close();
  return result;
}

async function rapidStartScenario(browser) {
  const page = await newHarnessPage(browser, "PENDING");
  await page.evaluate(() => {
    const starts = Array.from({ length: 12 }, () => window.quantumCameraController.start());
    window.__rapidSettled = false;
    Promise.all(starts).then(() => { window.__rapidSettled = true; });
  });
  await page.waitForFunction(() => window.__gumCalls === 1);
  const callsWhilePending = await page.evaluate(() => window.__gumCalls);
  await page.waitForFunction(() => window.__rapidSettled === true, null, { timeout: 5000 });
  const beforeStop = await page.evaluate(() => ({
    active: window.quantumCameraController.active,
    attached: document.getElementById("cameraVideo").srcObject === window.__streams[0],
  }));
  await page.evaluate(() => window.quantumCameraController.stop("TEST_RAPID_CLICKS"));
  const result = await page.evaluate(({ callsWhilePending, beforeStop }) => ({
      callsWhilePending,
      totalCalls: window.__gumCalls,
      streamCount: window.__streams.length,
      activeBeforeStop: beforeStop.active,
      attachedBeforeStop: beforeStop.attached,
      trackStopCalls: window.__streams[0].track.stopCalls,
      phaseAfterStop: window.quantumCameraController.phase,
    }), { callsWhilePending, beforeStop });
  await page.close();
  return result;
}

async function permissionRetryScenario(browser) {
  const page = await newHarnessPage(browser, "DENIED");
  await page.evaluate(() => {
    window.__deniedSettled = false;
    window.quantumCameraController.start()
      .catch((error) => { window.__deniedName = error.name; })
      .finally(() => { window.__deniedSettled = true; });
  });
  await page.waitForFunction(() => window.__deniedSettled === true);
  const afterDenied = await page.evaluate(() => ({
      rejectedName: window.__deniedName,
      phase: window.quantumCameraController.phase,
      status: document.getElementById("cameraStatus").textContent,
      hint: document.getElementById("cameraPlaceholderHint").textContent,
      startText: document.getElementById("startCamera").textContent,
      startDisabled: document.getElementById("startCamera").disabled,
      stopDisabled: document.getElementById("stopCamera").disabled,
    }));
  await page.evaluate(() => {
    window.__gumBehavior = "SUCCESS";
    window.__retrySettled = false;
    window.quantumCameraController.start().finally(() => { window.__retrySettled = true; });
  });
  await page.waitForFunction(() => window.__retrySettled === true);
  const afterRetry = await page.evaluate(() => {
    const retryStream = window.__streams[0];
    return {
      phase: window.quantumCameraController.phase,
      active: window.quantumCameraController.active,
      calls: window.__gumCalls,
      status: document.getElementById("cameraStatus").textContent,
      stageActive: document.getElementById("cameraStage").classList.contains("active"),
      attached: document.getElementById("cameraVideo").srcObject === retryStream,
    };
  });
  await page.evaluate(() => window.quantumCameraController.stop("TEST_PERMISSION_RETRY"));
  afterRetry.trackStopCalls = await page.evaluate(() => window.__streams[0].track.stopCalls);
  const result = { afterDenied, afterRetry };
  await page.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const lateStop = await lateStopScenario(browser);
    const rapidStart = await rapidStartScenario(browser);
    const permissionRetry = await permissionRetryScenario(browser);
    const result = {
      lateStop,
      rapidStart,
      permissionRetry,
    };
    process.stdout.write(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
"""


def find_node() -> Path | None:
    executable = shutil.which("node")
    if executable:
        return Path(executable)
    runtime_root = Path.home() / ".cache" / "codex-runtimes"
    candidates = sorted(runtime_root.glob("*/dependencies/node/bin/node.exe")) if runtime_root.is_dir() else []
    return candidates[0] if candidates else None


def find_node_modules() -> Path | None:
    configured = os.environ.get("NODE_PATH")
    if configured and (Path(configured) / "playwright").exists():
        return Path(configured)
    runtime_root = Path.home() / ".cache" / "codex-runtimes"
    candidates = sorted(runtime_root.glob("*/dependencies/node/node_modules")) if runtime_root.is_dir() else []
    return next((path for path in candidates if (path / "playwright").exists()), None)


class TestCameraControllerLifecycleInBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        node = find_node()
        node_modules = find_node_modules()
        if node is None or node_modules is None:
            raise unittest.SkipTest("Playwright/Node não está disponível para o teste real de navegador")
        environment = os.environ.copy()
        environment["NODE_PATH"] = str(node_modules)
        environment["QT_CAMERA_SOURCE"] = str(CAMERA_SOURCE)
        completed = subprocess.run(
            [str(node), "-"],
            cwd=ROOT,
            env=environment,
            input=PLAYWRIGHT_HARNESS,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=45,
            check=False,
        )
        if completed.returncode != 0:
            raise AssertionError(f"Harness Playwright falhou:\n{completed.stdout}\n{completed.stderr}")
        cls.result = json.loads(completed.stdout)

    def test_late_stream_is_released_after_stop_during_start(self) -> None:
        result = self.result["lateStop"]
        self.assertEqual(result["phase"], "OFF")
        self.assertFalse(result["active"])
        self.assertFalse(result["hasStream"])
        self.assertFalse(result["attached"])
        self.assertEqual(result["gumCalls"], 1)
        self.assertEqual(result["candidateStopCalls"], 1)
        self.assertFalse(result["startDisabled"])
        self.assertTrue(result["stopDisabled"])

    def test_rapid_starts_share_exactly_one_stream(self) -> None:
        result = self.result["rapidStart"]
        self.assertEqual(result["callsWhilePending"], 1)
        self.assertEqual(result["totalCalls"], 1)
        self.assertEqual(result["streamCount"], 1)
        self.assertTrue(result["activeBeforeStop"])
        self.assertTrue(result["attachedBeforeStop"])
        self.assertEqual(result["trackStopCalls"], 1)
        self.assertEqual(result["phaseAfterStop"], "OFF")

    def test_permission_denial_has_actionable_error_and_retry_recovers(self) -> None:
        denied = self.result["permissionRetry"]["afterDenied"]
        self.assertEqual(denied["rejectedName"], "NotAllowedError")
        self.assertEqual(denied["phase"], "ERROR")
        self.assertEqual(denied["status"], "NO PERMISSION")
        self.assertIn("permissão", denied["hint"].lower())
        self.assertEqual(denied["startText"], "Tentar novamente")
        self.assertFalse(denied["startDisabled"])
        self.assertTrue(denied["stopDisabled"])
        retry = self.result["permissionRetry"]["afterRetry"]
        self.assertEqual(retry["phase"], "ACTIVE")
        self.assertTrue(retry["active"])
        self.assertEqual(retry["calls"], 2)
        self.assertEqual(retry["status"], "CAMERA ACTIVE")
        self.assertTrue(retry["stageActive"])
        self.assertTrue(retry["attached"])
        self.assertEqual(retry["trackStopCalls"], 1)


class TestFileProtocolRedirectInBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        node = find_node()
        node_modules = find_node_modules()
        if node is None or node_modules is None:
            raise unittest.SkipTest("Playwright/Node não está disponível para validar file://")
        environment = os.environ.copy()
        environment["NODE_PATH"] = str(node_modules)
        environment["QT_INDEX_PATH"] = str(HTML_SOURCE)
        completed = subprocess.run(
            [str(node), str(FILE_PROTOCOL_SCRIPT)],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=False,
        )
        if completed.returncode != 0:
            raise AssertionError(f"Teste file:// falhou:\n{completed.stdout}\n{completed.stderr}")
        cls.result = json.loads(completed.stdout)

    def test_local_file_redirects_to_public_https_preserving_section(self) -> None:
        self.assertEqual(self.result["currentUrl"], "https://jgouveaf.github.io/FECART/#camera-gestos")
        self.assertEqual(self.result["pageErrors"], [])

    def test_redirect_happens_before_face_or_gesture_runtime_requests(self) -> None:
        self.assertEqual(self.result["blockedRuntimeRequests"], [])
        self.assertGreaterEqual(len(self.result["fileRequests"]), 1)
        self.assertTrue(self.result["fileRequests"][0].endswith("/index.html"))


class TestGestureAndCommandLifecycleContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.gesture = GESTURE_SOURCE.read_text(encoding="utf-8")
        cls.gesture_math = GESTURE_MATH_SOURCE.read_text(encoding="utf-8")
        cls.face_quality = FACE_QUALITY_SOURCE.read_text(encoding="utf-8")
        cls.robot = ROBOT_SOURCE.read_text(encoding="utf-8")
        cls.html = HTML_SOURCE.read_text(encoding="utf-8")

    def test_gesture_button_controls_explicit_enable_and_disable_state(self) -> None:
        self.assertIn('id="toggleGestures"', self.html)
        self.assertIn('getElementById("toggleGestures")', self.gesture)
        self.assertRegex(self.gesture, r'toggleButton\.addEventListener\("click"[^\n]+enabled[^\n]+disable[^\n]+enable')
        self.assertIn("gestureDetectorStatus", self.html)
        self.assertIn("gestureConfidence", self.html)

    def test_gesture_model_is_a_single_shared_inflight_promise(self) -> None:
        self.assertRegex(self.gesture, r"let\s+modelPromise\s*=\s*null")
        self.assertRegex(self.gesture, r"if\s*\(modelPromise\)\s*return\s+modelPromise")
        self.assertRegex(self.gesture, r"modelPromise\s*=\s*\(async\s*\(\)\s*=>")
        self.assertRegex(self.gesture, r"finally\s*\{\s*modelPromise\s*=\s*null")

    def test_mediapipe_runtime_and_model_are_local(self) -> None:
        self.assertNotRegex(self.gesture, r"https?://")
        for relative in (
            "web/vendor/mediapipe/vision_bundle.js",
            "web/vendor/mediapipe/hand_landmarker.task",
            "web/vendor/mediapipe/wasm/vision_wasm_internal.js",
            "web/vendor/mediapipe/wasm/vision_wasm_internal.wasm",
        ):
            path = ROOT / relative
            self.assertTrue(path.is_file(), path)
            self.assertGreater(path.stat().st_size, 1_000, path)
        self.assertIn("web/vendor/mediapipe/vision_bundle.js", self.gesture)
        self.assertIn("web/vendor/mediapipe/hand_landmarker.task", self.gesture)
        self.assertIn("web/vendor/mediapipe/wasm", self.gesture)

    def test_gesture_confirmation_has_confidence_frames_time_cooldown_and_loss_stop(self) -> None:
        confidence = re.search(r"MIN_CONFIDENCE\s*=.*?([0-9.]+)\s*;", self.gesture)
        frames = re.search(r"CONFIRM_FRAMES\s*=\s*(\d+)", self.gesture)
        confirm_ms = re.search(r"CONFIRM_MS\s*=\s*(\d+)", self.gesture)
        cooldown = re.search(r"COMMAND_COOLDOWN_MS\s*=.*?(\d+)\s*;", self.gesture)
        hand_loss = re.search(r"LOST_HAND_STOP_MS\s*=\s*(\d+)", self.gesture)
        self.assertIsNotNone(confidence)
        self.assertGreaterEqual(float(confidence.group(1)), 0.6)
        self.assertIsNotNone(frames)
        self.assertGreaterEqual(int(frames.group(1)), 3)
        self.assertIsNotNone(confirm_ms)
        self.assertGreaterEqual(int(confirm_ms.group(1)), 100)
        self.assertIsNotNone(cooldown)
        self.assertGreaterEqual(int(cooldown.group(1)), 300)
        self.assertIsNotNone(hand_loss)
        self.assertLessEqual(int(hand_loss.group(1)), 900)
        self.assertIn("confirmTemporal", self.gesture)
        self.assertIn('forceStop("HAND_LOST"', self.gesture)
        self.assertIn("loopGeneration", self.gesture)
        self.assertIn("result.worldLandmarks?.[0]", self.gesture)
        self.assertIn("jointAngle", self.gesture_math)
        self.assertNotIn('handedness === "Right"', self.gesture_math)

    def test_face_quality_has_temporal_hysteresis(self) -> None:
        self.assertIn("FaceQualityStabilizer", self.face_quality)
        self.assertIn("riseFrames", self.face_quality)
        self.assertIn("fallFrames", self.face_quality)
        self.assertIn("highEnter", self.face_quality)
        self.assertIn("highExit", self.face_quality)

    def test_command_timeout_heartbeat_cannot_refresh_its_own_input_timestamp(self) -> None:
        timeout = re.search(r"INPUT_TIMEOUT_MS[^;]*?(?:\|\||=)\s*(\d+)\s*;", self.robot)
        self.assertIsNotNone(timeout)
        self.assertLessEqual(int(timeout.group(1)), 1500)
        start = self.robot.find("function watchdogTick()")
        end = self.robot.find("async function toggleEmergency", start)
        self.assertGreaterEqual(start, 0, "watchdog de segurança não encontrado")
        self.assertGreater(end, start, "fim do watchdog de segurança não encontrado")
        body = self.robot[start:end]
        self.assertRegex(self.robot, r"setInterval\s*\(\s*watchdogTick\s*,\s*COMMAND_HEARTBEAT_MS\s*\)")
        self.assertIn("lastFreshInputAt", body)
        self.assertIn("PARAR", body)
        self.assertIn('sendMotion("PARAR")', body)
        self.assertNotIn("acceptIntent(", body)
        self.assertNotIn("deliverIntent(", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
