import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const artifacts = process.env.UI_ARTIFACT_DIR;
const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 844 }]
  .filter((viewport) => !process.env.UI_VIEWPORT_WIDTH || viewport.width === Number(process.env.UI_VIEWPORT_WIDTH));
assert.ok(viewports.length, "UI_VIEWPORT_WIDTH must be 1440, 390, or 320");
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl"],
});

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce", hasTouch: viewport.width < 768, deviceScaleFactor: viewport.width < 768 ? 2 : 1 });
    page.setDefaultTimeout(15000);
    const errors = [];
    const failed = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && new URL(response.url()).origin === new URL(baseUrl).origin) {
        failed.push([response.status(), response.url()]);
      }
    });
    await page.addInitScript(() => {
      window.__snapshotLabels = [];
      window.__swarmRender = { frames: 0, current: 0, previous: 0 };
      const glPrototype = WebGL2RenderingContext.prototype;
      const clear = glPrototype.clear;
      glPrototype.clear = function (mask) {
        if (this.canvas.parentElement?.id === "threeStageMount" && (mask & this.COLOR_BUFFER_BIT)) {
          window.__swarmRender.frames++;
          window.__swarmRender.previous = window.__swarmRender.current;
          window.__swarmRender.current = 0;
        }
        return clear.call(this, mask);
      };
      for (const name of ["drawArrays", "drawElements"]) {
        const draw = glPrototype[name];
        glPrototype[name] = function (mode, ...args) {
          if (this.canvas.parentElement?.id === "threeStageMount" && [this.LINES, this.LINE_STRIP, this.LINE_LOOP].includes(mode)) {
            window.__swarmRender.current++;
          }
          return draw.call(this, mode, ...args);
        };
      }
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (this.canvas.width === 1920) window.__snapshotLabels.push(String(text));
        return fillText.call(this, text, ...args);
      };
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.getElementById("backendEngineStatus")?.textContent?.includes("10,000"));
    await page.waitForFunction(() => window.__swarmRender.frames > 3);
    const enabledLines = await page.evaluate(() => window.__swarmRender.previous);
    await page.locator("#threeSwarmBtn").click();
    assert.equal(await page.locator("#threeSwarmBtn").getAttribute("aria-pressed"), "false");
    await page.waitForFunction((lines) => window.__swarmRender.previous <= lines - 40, enabledLines);
    const disabledLines = await page.evaluate(() => window.__swarmRender.previous);
    await page.locator("#threeSwarmBtn").click();
    assert.equal(await page.locator("#threeSwarmBtn").getAttribute("aria-pressed"), "true");
    await page.waitForFunction((lines) => window.__swarmRender.previous >= lines + 40, disabledLines);
    const stage = page.locator("#threeStageMount canvas");
    const firstFrame = await stage.screenshot();
    const frameCount = await page.evaluate(() => window.__swarmRender.frames);
    await page.waitForFunction((frames) => window.__swarmRender.frames > frames + 3, frameCount);
    const nextFrame = await stage.screenshot();
    assert.notDeepEqual(firstFrame, nextFrame, "3D packets must move, not just toggle a button");
    if (artifacts) await stage.screenshot({ path: join(artifacts, `swarm-${viewport.width}.png`) });
    const initialTime = Number(await page.locator("#timeline").inputValue());
    await page.locator("#playBtn").click();
    await page.waitForFunction((time) => Number(document.getElementById("timeline")?.value) > time, initialTime);
    await page.locator("#playBtn").click();
    assert.equal(await page.locator("#playBtn").innerText(), "Play");

    const wafer = page.locator("#tenKWaferCanvas");
    await wafer.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.getElementById("tenKExecCounter")?.textContent === "10,000 / 10,000 PARALLEL RUNS");
    const cellPoint = await wafer.evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width || 680));
      const height = Math.max(260, Math.round(rect.height || 340));
      return {
        x: rect.x + (48 + (25.5 / 100) * (width - 62)) * rect.width / width,
        y: rect.y + (28 + (25.5 / 100) * (height - 54)) * rect.height / height,
      };
    });
    if (viewport.width < 768) await page.touchscreen.tap(cellPoint.x, cellPoint.y);
    else await page.mouse.click(cellPoint.x, cellPoint.y);
    await page.waitForFunction(() => document.getElementById("inspRunTitle")?.textContent === "STORE RUN #02526 / 10,000");
    assert.match(await page.locator("#threeInfoTitle").innerText(), /#02526/);
    await page.mouse.move(0, 0);
    for (const mode of ["baseline", "delta", "families", "proposed"]) {
      await page.locator(`[data-wafer-mode="${mode}"]`).click();
      assert.match(await page.locator(`[data-wafer-mode="${mode}"]`).getAttribute("class"), /active/);
      await page.waitForFunction(() => document.getElementById("tenKExecCounter")?.textContent?.includes("SWEEPING"));
      await page.waitForFunction(() => document.getElementById("tenKExecCounter")?.textContent === "10,000 / 10,000 PARALLEL RUNS");
    }
    for (const filter of ["rescued", "failed", "top100", "all"]) {
      await page.locator(`[data-wafer-filter="${filter}"]`).click();
      assert.match(await page.locator(`[data-wafer-filter="${filter}"]`).getAttribute("class"), /active/);
      if (filter === "top100" || filter === "all") {
        await page.waitForFunction((selectedFilter) => {
          const canvas = document.getElementById("tenKWaferCanvas");
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.min(devicePixelRatio || 1, 2);
          const width = Math.max(320, Math.round(rect.width || 680));
          const height = Math.max(260, Math.round(rect.height || 340));
          const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
          const cellW = (width - 62) / 100;
          const cellH = (height - 54) / 100;
          let orangeCells = 0;
          for (let row = 0; row < 100; row++) {
            for (let col = 0; col < 100; col++) {
              const x = Math.floor((48 + (col + 0.4) * cellW) * dpr);
              const y = Math.floor((28 + (row + 0.4) * cellH) * dpr);
              const offset = (y * canvas.width + x) * 4;
              if (pixels[offset] > 170 && pixels[offset + 1] > 50 && pixels[offset + 2] < 160) orangeCells++;
            }
          }
          // Ignore a few cells covered by the selection crosshair or regime rails.
          return selectedFilter === "top100" ? orangeCells >= 80 && orangeCells <= 110 : orangeCells > 1000;
        }, filter);
      }
    }
    await page.locator("#inspJumpInput").fill("10000");
    await page.locator("#inspJumpInput").press("Enter");
    await page.waitForFunction(() => document.getElementById("inspRunTitle")?.textContent === "STORE RUN #10000 / 10,000");
    assert.match(await page.locator("#inspFamilySub").innerText(), /Family #500.*Variant #20/);
    if (artifacts) await wafer.screenshot({ path: join(artifacts, `wafer-${viewport.width}.png`) });

    const initialFixtures = await page.evaluate(() => window.RehearsalApp.getState().scene.objects);
    await page.locator('[data-wafer-bench="optimal"]').click();
    const selectedWait = await page.locator("#inspWaitDelta").innerText();
    const selectedRun = await page.locator("#inspRunTitle").innerText();
    await page.locator("#loadCellTo3DBtn").click();
    assert.equal(await page.locator("#inspWaitDelta").innerText(), selectedWait);
    assert.equal(await page.locator("#inspRunTitle").innerText(), selectedRun);
    assert.deepEqual(await page.evaluate(() => window.RehearsalApp.getState().scene.objects), initialFixtures);
    assert.match(await page.locator("#threeInfoBody").innerText(), /separate assumptions/);
    await page.locator('[data-wafer-bench="worst"]').click();
    await page.locator("#loadCellTo3DBtn").click();
    assert.match(await page.locator('[data-three-mode="proposed"]').getAttribute("class"), /\bon\b/);
    await page.locator('[data-wafer-mode="delta"]').click();
    assert.match(await page.locator('[data-wafer-mode="delta"]').getAttribute("class"), /active/);
    await page.locator("#resweepTenKBtn").click();
    await page.waitForFunction(() => document.getElementById("tenKExecCounter")?.textContent?.includes("SWEEP"));
    await page.waitForFunction(() => document.getElementById("tenKExecCounter")?.textContent === "10,000 / 10,000 PARALLEL RUNS");
    await page.locator("#refreshBackendEngineBtn").click();
    await page.waitForFunction(() => document.getElementById("backendEngineStatus")?.textContent?.includes("fresh run"));

    await page.locator("#headerExport3DBtn").click();
    await page.locator("#threeExportDrawer").waitFor({ state: "visible" });
    const drawer = await page.locator("#threeExportDrawer").boundingBox();
    assert.ok(drawer.x >= 0 && drawer.x + drawer.width <= viewport.width + 1);
    const snapshotPromise = page.waitForEvent("download");
    await page.locator("#export3DSnapBtn").click();
    const snapshot = await snapshotPromise;
    assert.match(snapshot.suggestedFilename(), /\.png$/);
    const snapshotLabels = await page.evaluate(() => window.__snapshotLabels);
    assert.ok(snapshotLabels.some((text) => text.includes("[ASSUMED]")));
    assert.ok(snapshotLabels.every((text) => !/SCENARIOS VERIFIED|VERIFIED BY/.test(text)));
    if (artifacts) await snapshot.saveAs(join(artifacts, `snapshot-${viewport.width}.png`));
    const csvPromise = page.waitForEvent("download");
    await page.locator("#export3DCsvBtn").click();
    const csv = await csvPromise;
    const [header, ...rows] = (await readFile(await csv.path(), "utf8")).trimEnd().split("\n");
    assert.equal(rows.length, 10000);
    assert.ok(header.endsWith(",source_tag"));
    assert.ok(rows.every((row) => row.endsWith(",assumed")));
    if (artifacts) await csv.saveAs(join(artifacts, `wafer-${viewport.width}.csv`));
    await page.locator("#closeExportDrawerBtn").click();

    await page.locator('[data-select-obj="display"]').first().click();
    await page.locator("#displayX").fill("3.0");
    await page.locator("#displayX").dispatchEvent("change");
    await page.locator("#displayY").fill("7.7");
    await page.locator("#displayY").dispatchEvent("change");
    await page.waitForFunction(() => window.RehearsalApp.getState().results?.plan.routeBlocked);
    await page.locator("#headerExport3DBtn").click();
    const reportPromise = page.waitForEvent("download");
    await page.locator("#export3DReportBtn").click();
    const report = await reportPromise;
    const reportText = await readFile(await report.path(), "utf8");
    assert.match(reportText, /Proposed Layout.*Wait Blocked.*Served 0.*comparison unavailable/);
    assert.doesNotMatch(reportText, /87s faster|SCENARIOS VERIFIED|VERIFIED BY/);
    if (artifacts) await report.saveAs(join(artifacts, `blocked-report-${viewport.width}.md`));
    await page.locator("#closeExportDrawerBtn").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    const result = { baseUrl, viewport, selectedRun, stableWait: selectedWait, engine: await page.locator("#backendEngineStatus").innerText(), swarmRenderingAndMotion: "pass", simulatorPlayback: "pass", waferPointerAndTouch: "pass", waferModesAndFilters: "pass", sweepCompletion: "pass", csvRows: rows.length, mobileExports: "pass", blockedReport: "pass", errors, failed };
    console.log(JSON.stringify(result));
    if (artifacts) {
      await writeFile(join(artifacts, `result-${viewport.width}.json`), JSON.stringify(result, null, 2) + "\n");
      await page.screenshot({ path: join(artifacts, `verified-${viewport.width}.png`), fullPage: false });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
