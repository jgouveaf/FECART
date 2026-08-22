"use strict";

// Regressão do erro "Failed to fetch dynamically imported module: file:///...".
const { chromium } = require("playwright");
const { pathToFileURL } = require("url");

const indexPath = process.env.QT_INDEX_PATH;
const publicSiteUrl = "https://jgouveaf.github.io/FECART/";

if (!indexPath) throw new Error("QT_INDEX_PATH não foi informado.");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  const fileRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().startsWith("file:")) fileRequests.push(request.url());
  });
  await page.route(`${publicSiteUrl}**`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Quantum Tracker HTTPS</title><main id=redirect-ok>HTTPS</main>",
  }));

  try {
    const sourceUrl = `${pathToFileURL(indexPath).href}#camera-gestos`;
    try {
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (error) {
      if (!String(error.message).includes("ERR_ABORTED")) throw error;
    }
    await page.waitForURL(`${publicSiteUrl}#camera-gestos`, { timeout: 15000 });
    await page.waitForSelector("#redirect-ok");
    const result = {
      currentUrl: page.url(),
      pageErrors,
      fileRequests,
      blockedRuntimeRequests: fileRequests.filter((url) => /vision_bundle|hand_landmarker|vendor\/human\/models/i.test(url)),
    };
    process.stdout.write(JSON.stringify(result));
    if (result.currentUrl !== `${publicSiteUrl}#camera-gestos`
      || pageErrors.length
      || result.blockedRuntimeRequests.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
