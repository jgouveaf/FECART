'use strict';

// Exercise navigation and controls in the reorganized page without physical IO.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('quantumAuth:v1', 'ok'));
    await page.goto(process.env.QT_SITE_URL || 'http://127.0.0.1:9877/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.quantumRobot && window.QuantumUserConfig);

    const structure = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      return {
        duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
        sections: [...document.querySelectorAll('#zoomContent > section[id]')].map(el => el.id),
        brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(el => !document.getElementById(el.hash.slice(1))).map(el => el.hash),
        usbConnected: window.quantumRobot.connected,
        selectedMode: window.QuantumControl.state.mode.id,
      };
    });
    assert.deepEqual(structure.duplicates, []);
    assert.deepEqual(structure.brokenAnchors, []);
    assert.deepEqual(structure.sections, ['visao-geral', 'camera-gestos', 'guia', 'simulador', 'codigos', 'configuracoes', 'diagnostico', 'logs']);
    assert.equal(structure.usbConnected, false);
    assert.equal(structure.selectedMode, 1);
    assert.equal(await page.locator('#emergencyStop').count(), 1);
    assert.equal(await page.locator('#firmwareFlasher [data-motor-test]').count(), 0, 'Physical tests are outside the firmware installation block');
    assert.equal(await page.locator('#codigos [data-motor-test]').count(), 4);
    assert.equal(await page.locator('#configuracoes #saveConfig').count(), 1);

    const stop = await page.locator('#emergencyStop').boundingBox();
    assert.ok(stop.y > 0 && stop.y + stop.height < 1000, 'Emergency control is visible on initial desktop screen');
    fs.mkdirSync('tests/artifacts', { recursive: true });
    await page.screenshot({ path: 'tests/artifacts/operation-light.png' });
    await page.locator('#uiTheme').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'tests/artifacts/operation-dark.png' });

    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        for (const section of ['camera-gestos', 'codigos', 'configuracoes', 'diagnostico', 'logs']) {
          if (width <= 920) {
            await page.locator('#menuButton').click();
            await page.waitForFunction(() => Math.abs(document.getElementById('sidebarNavigation').getBoundingClientRect().x) < 1);
          }
          await page.locator(`.nav-link[href="#${section}"]`).click();
          await page.waitForFunction(id => {
            const el = document.getElementById(id);
            const top = el.getBoundingClientRect().top;
            return top >= 0 && (Math.abs(top - parseFloat(getComputedStyle(el).scrollMarginTop)) < 3 || scrollY + innerHeight >= document.documentElement.scrollHeight - 2);
          }, section, { timeout: 5000 }).catch(async error => {
            throw new Error(`${width}/${theme}/${section}: ${JSON.stringify(await page.locator(`#${section}`).boundingBox())}; ${error.message}`);
          });
          assert.equal(new URL(page.url()).hash, `#${section}`);
          assert.equal(await page.locator(`.nav-link[href="#${section}"]`).evaluate(el => el.classList.contains('active')), true);
          const rect = await page.locator(`#${section}`).boundingBox();
          assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, `${width}/${theme}: ${section} fits`);
          const heading = await page.locator(`#${section} h2`).first().boundingBox();
          const header = await page.locator('.topbar').boundingBox();
          assert.ok(heading.y >= header.y + header.height, `${width}/${theme}/${section}: title ${heading.y} stays below header ${header.y + header.height}`);
          if (width <= 920) assert.equal(await page.locator('#menuButton').getAttribute('aria-expanded'), 'false');
        }
        const overflow = await page.evaluate(() => [...document.querySelectorAll('main button, main input:not([type="file"]), main select, main textarea')].filter(el => {
          const box = el.getBoundingClientRect();
          return box.width && box.height && (box.left < -1 || box.right > innerWidth + 1);
        }).map(el => el.id || el.textContent));
        assert.deepEqual(overflow, [], `${width}/${theme}: controls remain inside the viewport`);
      }
    }

    // Saving preferences remains in the existing flow, now at its own anchor.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.nav-link[href="#configuracoes"]').click();
    await page.locator('#configCooldown').fill('450');
    await page.locator('#saveConfig').click();
    assert.match(await page.locator('#configStatus').textContent(), /salv/i);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#configCooldown').inputValue(), '450');
    assert.equal(await page.evaluate(() => window.quantumRobot.connected), false);

    await page.locator('.nav-link[href="#guia"]').click();
    await page.locator('.project-details > summary').click();
    assert.equal(await page.locator('.progress-card').isVisible(), true);
    await page.locator('.nav-link[href="#camera-gestos"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#robotControlPanel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/artifacts/operation-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: 5 viewport widths × 2 themes; navigation, visible emergency control, preserved IDs, separate firmware/tests/config, preference persistence, no page errors. No physical devices used.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
