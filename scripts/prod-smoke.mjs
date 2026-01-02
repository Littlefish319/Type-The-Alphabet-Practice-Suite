import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'https://alphatyper.vercel.app/';

const expectTruthy = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1000);

  // Ensure main UI rendered
  await page.getByRole('heading', { name: /alphatyper/i }).waitFor({ timeout: 30_000 });

  // Pro mode switch should toggle and stay.
  const proSwitch = page.locator('button[role="switch"][aria-checked]');
  await proSwitch.first().waitFor({ timeout: 30_000 });
  const proBefore = await proSwitch.first().getAttribute('aria-checked');
  await proSwitch.first().click();
  await sleep(250);
  const proAfter = await proSwitch.first().getAttribute('aria-checked');
  expectTruthy(proAfter !== proBefore, 'Professional Mode switch did not toggle');
  await sleep(800);
  const proAfterStable = await proSwitch.first().getAttribute('aria-checked');
  expectTruthy(proAfterStable === proAfter, 'Professional Mode switch toggled then reverted');

  // Sound checkbox should toggle and stay.
  const soundCheckbox = page.getByLabel(/enable sound/i);
  await soundCheckbox.waitFor({ timeout: 30_000 });
  const soundBefore = await soundCheckbox.isChecked();
  await soundCheckbox.click();
  await sleep(150);
  const soundAfter = await soundCheckbox.isChecked();
  expectTruthy(soundAfter !== soundBefore, 'Enable Sound checkbox did not toggle');
  await sleep(800);
  const soundAfterStable = await soundCheckbox.isChecked();
  expectTruthy(soundAfterStable === soundAfter, 'Enable Sound checkbox toggled then reverted');

  // Mode switching: classic -> guinness -> flash -> classic
  const clickMode = async (re) => {
    await page.getByRole('button', { name: re }).click();
  };

  await clickMode(/^classic/i);
  await sleep(200);

  await clickMode(/^guinness/i);
  await sleep(250);

  await clickMode(/flash/i);
  await page.locator('#flash-letter').waitFor({ state: 'visible', timeout: 10_000 });
  await sleep(800);
  await page.locator('#flash-letter').waitFor({ state: 'visible', timeout: 10_000 });

  await clickMode(/^classic/i);
  await sleep(250);
  await page.locator('#flash-letter').waitFor({ state: 'detached', timeout: 10_000 });
  await sleep(800);
  await page.locator('#flash-letter').waitFor({ state: 'detached', timeout: 10_000 });

  if (consoleErrors.length) {
    throw new Error(`Console errors on prod:\n- ${consoleErrors.join('\n- ')}`);
  }

  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
