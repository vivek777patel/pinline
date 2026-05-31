// End-to-end UI verification against the real built app.
// Spawns the server with a temp DB, drives Chromium, asserts DOM behaviour.
// Run with: npm run e2e   (requires `npm run build:web` first)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import assert from "node:assert/strict";

const PORT = 4321;
const DB = join(tmpdir(), `pinline-e2e-${randomUUID()}.db`);
const base = `http://localhost:${PORT}`;

const server = spawn("node", ["src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), PINLINE_DB: DB },
  stdio: "ignore",
});

function ok(msg) {
  console.log("  ✓ " + msg);
}
const pinCount = (n) => page.waitForFunction((n) => document.querySelectorAll(".pin").length === n, n);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base + "/api/pins")).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

let browser;
let page;
try {
  await waitForServer();
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(base);
  const menu = (name) => page.locator(".menu-item", { hasText: name });

  assert.equal(await page.locator("h1").textContent(), "PINLINE");
  await page.waitForSelector(".empty");
  ok("loads with sidebar menu + empty state");

  // --- slice 4 + 6: quick-add a finding, see it render fully ---
  await page.fill(".quickadd input", "%finding =api-gw expired cert #infra ~platform sev:critical due:2d");
  await page.click(".quickadd button");
  await pinCount(1);
  const finding = page.locator(".pin", { hasText: "expired cert" });
  assert.ok((await finding.getAttribute("class")).includes("imp-critical"), "importance band from severity");
  assert.equal(await finding.locator(".sev-critical").count(), 1, "severity badge");
  assert.equal(await finding.locator(".due", { hasText: "due in 2d" }).count(), 1, "due label");
  for (const c of ["#infra", "~platform", "=api-gw"]) {
    assert.equal(await finding.locator(".chip", { hasText: c }).count(), 1, `chip ${c}`);
  }
  ok("quick-add finding renders importance/severity/due/chips");

  // --- slice 7: agenda strip ---
  assert.equal(await page.locator(".agenda", { hasText: "next 7 days" }).count(), 1);
  assert.equal(await page.locator(".agenda-item", { hasText: "expired cert" }).count(), 1);
  ok("agenda strip shows the upcoming due date");

  // second pin (followup with a nudge)
  await page.fill(".quickadd input", "chase vendor %fu nudge:3d !low");
  await page.click(".quickadd button");
  await pinCount(2);
  assert.equal(await page.locator(".agenda-item", { hasText: "chase vendor" }).count(), 1, "nudge in agenda");
  ok("second pin added; agenda includes its nudge");

  // --- editor: open via title, change importance via date/field, save ---
  await page.locator(".pin .title", { hasText: "chase vendor" }).click();
  await page.waitForSelector(".modal");
  ok("clicking a pin title opens the editor");
  await page.locator(".modal .field input[type='date']").first().fill("2026-06-04");
  await page.locator(".modal select").nth(1).selectOption("critical"); // Importance
  await page.locator(".modal .field", { hasText: "Teams" }).locator("input").fill("platform, secops");
  await page.locator(".modal .field", { hasText: "Assets" }).locator("input").fill("db-prod");
  await page.locator(".modal .primary").click();
  await page.waitForFunction(() => !document.querySelector(".modal"));
  const edited = page.locator(".pin", { hasText: "chase vendor" });
  assert.equal(await page.locator(".pin.imp-critical", { hasText: "chase vendor" }).count(), 1, "importance saved");
  assert.equal(await edited.locator(".due").count(), 1, "due date now set");
  assert.equal(await edited.locator(".chip", { hasText: "~platform" }).count(), 1, "team saved");
  assert.equal(await edited.locator(".chip", { hasText: "~secops" }).count(), 1, "second team saved");
  assert.equal(await edited.locator(".chip", { hasText: "=db-prod" }).count(), 1, "asset saved");
  ok("editor saves importance, a new due date, and comma-separated teams/assets");

  // --- agenda card opens the editor ---
  await page.locator(".agenda-item").first().click();
  await page.waitForSelector(".modal");
  ok("clicking an agenda card opens the editor");
  await page.locator(".modal .x").click();
  await page.waitForFunction(() => !document.querySelector(".modal"));

  // --- Assets view (grouped grid) ---
  await menu("Assets").click();
  await page.waitForSelector(".group-head");
  assert.equal(await page.locator(".group-head", { hasText: "api-gw" }).count(), 1);
  ok("Assets view groups into an api-gw section");

  // --- Findings view ---
  await menu("Findings").click();
  await pinCount(1);
  assert.equal(await page.locator(".pin", { hasText: "chase vendor" }).count(), 0, "followup hidden");
  ok("Findings view shows the finding only");

  // --- back to All, click-a-chip to filter ---
  await menu("All").click();
  await pinCount(2);
  await page.locator(".chip", { hasText: "=api-gw" }).first().click();
  await page.waitForSelector(".filter-active");
  await pinCount(1);
  ok("clicking the =api-gw chip filters to that asset");
  await page.locator(".filter-active").click();
  await pinCount(2);

  // --- slice 6: remediation state round-trips ---
  await finding.locator("select.remediation").selectOption("triaged");
  await page.waitForFunction(() => {
    const li = [...document.querySelectorAll(".pin")].find((e) => e.textContent.includes("expired cert"));
    return li?.querySelector("select.remediation")?.value === "triaged";
  });
  ok("setting remediation state persists via PATCH");

  // --- status -> done removes from live ---
  await finding.locator("select[aria-label='status']").selectOption("done");
  await pinCount(1);
  assert.equal(await page.locator(".pin", { hasText: "expired cert" }).count(), 0, "left the live view");
  ok("marking done removes it from the live view");

  // --- Archive view shows the done pin ---
  await menu("Archive").click();
  await page.waitForSelector(".pin.done");
  assert.equal(await page.locator(".pin.done", { hasText: "expired cert" }).count(), 1);
  ok("Archive view shows the done pin");

  // --- collapsible sidebar ---
  assert.equal(await page.locator(".menu-label").first().isVisible(), true, "labels visible when expanded");
  await page.locator(".collapse-btn").click();
  await page.waitForFunction(() => document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assert.equal(await page.locator(".menu-label").first().isVisible(), false, "labels hidden when collapsed");
  ok("sidebar collapses to an icon rail");

  console.log("\nALL BROWSER CHECKS PASSED ✅");
} finally {
  if (browser) await browser.close();
  server.kill();
  for (const s of ["", "-wal", "-shm"]) rmSync(DB + s, { force: true });
}
