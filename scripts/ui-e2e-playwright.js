'use strict';

/**
 * Full Deployer UI scenario (Playwright). Run: npm run test:ui:e2e
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.DEPLOYER_UI_BASE_URL || 'http://127.0.0.1:3000';
const USER = process.env.DEPLOYER_UI_USER || 'admin';
const PASS = process.env.DEPLOYER_UI_PASS || 'admin';
const ARTIFACTS = path.join(__dirname, '..', 'test-artifacts-e2e');
const TEST_TPL_ID = `qa-manual-tpl-${Date.now().toString(36)}`;

function step(n, msg) {
  console.log(`\n[${n}] ${msg}`);
}

async function assertNoPageErrors(page, label) {
  const errors = await page.evaluate(() => window.__qaErrors || []);
  if (errors.length) {
    throw new Error(`${label}: JS errors: ${errors.join(' | ')}`);
  }
}

(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('pageerror', (e) => {
    page.evaluate((msg) => {
      window.__qaErrors = window.__qaErrors || [];
      window.__qaErrors.push(msg);
    }, e.message).catch(() => {});
  });

  const report = { steps: [], ok: true };

  function pass(name, detail) {
    report.steps.push({ name, status: 'ok', detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  }

  function fail(name, err) {
    report.ok = false;
    report.steps.push({ name, status: 'fail', detail: String(err.message || err) });
    console.error(`  ✗ ${name}: ${err.message || err}`);
  }

  try {
    step(1, 'Login');
    await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/index.html', { timeout: 15000 });
    pass('login redirect to index');

    step(2, 'Templates list on main page');
    await page.waitForTimeout(1500);
    const cards = await page.locator('.template-card').count();
    if (cards < 7) throw new Error(`expected >=7 templates, got ${cards}`);
    pass('templates visible', `${cards} cards`);
    await page.screenshot({ path: path.join(ARTIFACTS, '01-index-templates.png'), fullPage: true });

    step(3, 'Open deploy modal for integration-smoke');
    const smokeBtn = page.locator('[data-deploy="integration-smoke"]');
    if (!(await smokeBtn.count())) throw new Error('integration-smoke deploy button missing');
    await smokeBtn.click();
    await page.waitForSelector('#modal-overlay:not([hidden])', { timeout: 5000 });
    pass('deploy modal opened');
    await page.click('#modal-cancel');
    await page.waitForTimeout(300);

    step(4, 'Open template editor — create new');
    await page.click('a[href="/template-editor.html"]');
    await page.waitForURL('**/template-editor.html', { timeout: 10000 });
    pass('template editor loaded');

    step(5, 'Import JSON file and fill form');
    const samplePath = path.join(__dirname, '..', 'templates-bundled', 'docker-getting-started.json');
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    sample.id = TEST_TPL_ID;
    sample.name = `QA Manual ${TEST_TPL_ID}`;
    const importFile = path.join(ARTIFACTS, `${TEST_TPL_ID}.json`);
    fs.writeFileSync(importFile, JSON.stringify(sample, null, 2));

    await page.locator('#import-json').setInputFiles(importFile);
    await page.waitForTimeout(800);
    const idVal = await page.locator('input[name="id"]').inputValue();
    if (idVal !== TEST_TPL_ID) throw new Error(`id field=${idVal}, expected ${TEST_TPL_ID}`);
    pass('import JSON filled form', TEST_TPL_ID);
    await page.screenshot({ path: path.join(ARTIFACTS, '02-editor-imported.png'), fullPage: true });

    step(6, 'Save template via form submit');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/index.html', { timeout: 15000 });
    await page.waitForTimeout(1500);
    const hasNew = await page.locator(`.template-card:has-text("${sample.name}")`).count();
    if (!hasNew) throw new Error('saved template not in list');
    pass('template saved and visible on index');
    await page.screenshot({ path: path.join(ARTIFACTS, '03-after-save.png'), fullPage: true });

    step(7, 'Edit saved template');
    await page.click(`a[href="/template-editor.html?id=${encodeURIComponent(TEST_TPL_ID)}"]`);
    await page.waitForURL(`**/template-editor.html?id=${TEST_TPL_ID}`, { timeout: 10000 });
    const loadedName = await page.locator('input[name="name"]').inputValue();
    if (!loadedName.includes('QA Manual')) throw new Error(`edit load name=${loadedName}`);
    pass('edit page loaded existing template');

    step(8, 'Delete QA template from index');
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    page.once('dialog', (d) => d.accept());
    const delBtn = page.locator(`.btn-delete[data-id="${TEST_TPL_ID}"]`);
    if (!(await delBtn.count())) throw new Error('delete button not found');
    await delBtn.click();
    await page.waitForTimeout(1500);
    const gone = await page.locator(`.btn-delete[data-id="${TEST_TPL_ID}"]`).count();
    if (gone !== 0) throw new Error('template still in list after delete');
    pass('template deleted');
    await page.screenshot({ path: path.join(ARTIFACTS, '04-after-delete.png'), fullPage: true });

    step(9, 'Containers section loads');
    const containersSection = page.locator('#containers-list');
    await containersSection.waitFor({ timeout: 10000 });
    pass('containers section rendered');

    step(10, 'Logout');
    await page.click('#btn-logout');
    await page.waitForURL('**/login.html', { timeout: 10000 });
    pass('logout redirect to login');

    await assertNoPageErrors(page, 'final');
    pass('no uncaught JS errors');
  } catch (err) {
    fail('scenario', err);
    await page.screenshot({ path: path.join(ARTIFACTS, 'FAIL.png'), fullPage: true }).catch(() => {});
  }

  await browser.close();

  const summaryPath = path.join(ARTIFACTS, 'report.json');
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${summaryPath}`);
  console.log(`Artifacts: ${ARTIFACTS}`);

  if (!report.ok) process.exit(2);
  console.log('\nAll UI E2E steps passed.');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
