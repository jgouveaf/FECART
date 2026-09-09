'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => localStorage.setItem('quantumAuth:v1', 'ok'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.QT_SITE_URL || 'http://127.0.0.1:9876/', { waitUntil: 'networkidle' });
    await page.locator('#uiTheme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.locator('.hero-card h2').hover();
    await page.keyboard.press('q');
    assert.equal(await page.locator('#uiZoom').getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(200);
    assert.match(await page.locator('#zoomContent').evaluate(el => getComputedStyle(el).transform), /1.75/);
    await page.mouse.move(700, 350);
    await page.waitForTimeout(200);
    const originX = await page.locator('#zoomContent').evaluate(el => parseFloat(el.style.transformOrigin));
    const contentLeft = await page.locator('main').evaluate(el => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
    assert.ok(Math.abs(originX - (700 - contentLeft)) < 1, 'Zoom origin follows the pointer within the content');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#zoomContent').evaluate(el => el.style.transform), '');
    for (const section of ['#camera-gestos', '#codigos']) {
      await page.locator(section).scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.mouse.move(850, 450);
      const sidebarBefore = await page.locator('#sidebarNavigation').boundingBox();
      const headerBefore = await page.locator('.topbar').boundingBox();
      await page.keyboard.press('q');
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#uiZoom').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await page.locator('#sidebarNavigation').boundingBox(), sidebarBefore, 'Sidebar stays fixed while zooming a scrolled section');
      assert.deepEqual(await page.locator('.topbar').boundingBox(), headerBefore, 'Sticky header stays fixed');
      assert.ok(await page.locator('#sidebarNavigation .nav-link').first().evaluate(el => {
        const rect = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), 'Sidebar is reachable above the magnified content');
      await page.keyboard.press('Escape');
    }
    assert.match(await page.locator('.firmware-flasher-copy p').textContent(), /20 cm/);
    assert.doesNotMatch(await page.locator('.firmware-flasher-copy p').textContent(), /aprovado a 5 cm/);
    await page.locator('.hero-card h2').hover();
    await page.keyboard.press('p');
    assert.equal(await page.locator('.interface-help').isVisible(), true);
    assert.match(await page.locator('#uiHelpText').textContent(), /ambiente/);
    await page.keyboard.press('Escape');
    await page.locator('#simulador').scrollIntoViewIfNeeded();
    await page.locator('#uiHelp').click();
    const before = await page.locator('#toggleSimulation').textContent();
    await page.locator('#toggleSimulation').click();
    assert.equal(await page.locator('#toggleSimulation').textContent(), before, 'Help must not activate the selected control');
    assert.equal(await page.locator('.interface-help').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('#toggleSimulation').click();
    assert.notEqual(await page.locator('#toggleSimulation').textContent(), before, 'Normal control still works');
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'typing-test'; document.body.append(input); input.focus();
    });
    await page.keyboard.type('qp');
    assert.equal(await page.locator('#typing-test').inputValue(), 'qp');
    assert.equal(await page.locator('#uiZoom').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.interface-help').isVisible(), false);
    await page.locator('#typing-test').evaluate(el => el.remove());
    await page.locator('#uiTheme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.screenshot({ path: 'work/interface-light.png', fullPage: true });
    await page.locator('#uiTheme').click();
    await page.screenshot({ path: 'work/interface-dark.png', fullPage: true });
    await page.locator('#firmwareFlasher').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'work/interface-dark-detail.png' });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      const contrast = await page.evaluate(() => {
        const rgb = value => value.match(/[\d.]+/g).map(Number);
        const luminance = channels => channels.slice(0, 3).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        return ['.firmware-flasher h3', '.person-follow-panel h3', '.quick-guide-grid span', '.diagnostic-card strong', '.interface-tools button'].map(selector => {
          const el = document.querySelector(selector);
          let parent = el, background;
          while (parent) { background = rgb(getComputedStyle(parent).backgroundColor); if (background[3] !== 0) break; parent = parent.parentElement; }
          const a = luminance(rgb(getComputedStyle(el).color)), b = luminance(background);
          return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
        });
      });
      for (const result of contrast) assert.ok(result.ratio >= 4.5, `${theme}: ${result.selector} contrast ${result.ratio}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('.interface-tools').evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    await page.locator('#camera-gestos').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.mouse.move(180, 350);
    await page.keyboard.press('q');
    await page.waitForTimeout(250);
    await page.locator('#menuButton').click();
    assert.equal(await page.locator('#menuButton').getAttribute('aria-expanded'), 'true', 'Mobile menu opens while zoom is active');
    await page.waitForFunction(() => Math.abs(document.getElementById('sidebarNavigation').getBoundingClientRect().x) < 1);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    console.log('PASS: themes, persistence, zoom and pointer, Escape, contextual help, click isolation, normal control, typing, mobile layout, no page errors. No physical devices used.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
