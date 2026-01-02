import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const SITE_URL = process.env.SMOKE_URL || process.env.SCREENSHOT_URL || 'http://127.0.0.1:5173';
const STORAGE_KEY = 'az_speed_suite_data_react';
const PROFESSIONAL_MODE_STORAGE_KEY = 'alphabetTypingSuite.professionalMode';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isLocalUrl = (maybeUrl) => {
  try {
    const u = new URL(maybeUrl);
    const host = (u.hostname || '').toLowerCase();
    return u.protocol === 'http:' && (host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0');
  } catch {
    return false;
  }
};

const waitForHttpReady = async (url, { timeoutMs = 30000, pollMs = 250 } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (res && (res.status === 200 || res.status === 304)) return true;
    } catch {
      // keep polling
    }
    await sleep(pollMs);
  }
  return false;
};

const startViteIfNeeded = async (siteUrl) => {
  if (!isLocalUrl(siteUrl)) return null;
  if (await waitForHttpReady(siteUrl, { timeoutMs: 1200, pollMs: 200 })) return null;

  let port = '5173';
  try {
    port = String(new URL(siteUrl).port || '5173');
  } catch {
    // ignore
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', port], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const ready = await waitForHttpReady(siteUrl, { timeoutMs: 30000, pollMs: 250 });
  if (!ready) {
    try {
      child.kill('SIGINT');
    } catch {
      // ignore
    }
    throw new Error(`Dev server did not become ready at ${siteUrl} within 30s.`);
  }

  return child;
};

const stopChild = async (child) => {
  if (!child) return;
  if (child.killed) return;
  try {
    child.kill('SIGINT');
  } catch {
    // ignore
  }
  for (let i = 0; i < 20; i++) {
    if (child.exitCode != null) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(100);
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // ignore
  }
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
};

const safeClickTab = async (page, label) => {
  const btn = page.getByRole('button', { name: label, exact: true });
  if (await btn.count()) {
    await btn.first().click();
    return true;
  }
  return false;
};

const safeClickAnyTab = async (page, labels) => {
  for (const label of labels) {
    // eslint-disable-next-line no-await-in-loop
    if (await safeClickTab(page, label)) return true;
  }
  return false;
};

const ensureChecked = async (page, label, desired = true) => {
  const box = page.getByLabel(label).first();
  if (!(await box.count())) return;
  if (desired) await box.check();
  else await box.uncheck();
};

const assertChecked = async (page, label, desired = true) => {
  const box = page.getByLabel(label).first();
  if (!(await box.count())) return;
  const val = await box.isChecked();
  assert(val === desired, `${label} expected ${desired ? 'checked' : 'unchecked'}`);
};

const setModeButton = async (page, name) => {
  let btn = page.getByRole('button', { name, exact: true });
  if (!(await btn.count())) btn = page.getByRole('button', { name });
  await btn.first().click();
};

const seedData = () => {
  const now = Date.now();
  const mkLog = () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    let total = 0;
    const log = [{ char: letters[0], duration: 0, total: 0, prev: '' }];
    for (let i = 1; i < letters.length; i += 1) {
      const d = 0.055 + (i % 7) * 0.006;
      total += d;
      log.push({ char: letters[i], duration: d, total, prev: letters[i - 1] });
    }
    return log;
  };

  const run = (mode, time, offsetMs) => ({
    id: `seed_${mode}_${now - offsetMs}`,
    time,
    mistakes: 0,
    mode,
    profile: 'User',
    device: 'This Device',
    deviceId: 'seed-web',
    deviceLabel: 'This Device',
    platform: 'web',
    blind: false,
    note: '',
    timestamp: now - offsetMs,
    log: mkLog(),
    mistakeLog: [],
    specialized: { enabled: false, start: 'a', end: 'z' },
  });

  return {
    localData: {
      profiles: ['User'],
      devices: ['This Device'],
      currentProfile: 'User',
      currentDevice: 'This Device',
      history: [run('classic', 1.92, 1000 * 60 * 60 * 4), run('classic', 2.08, 1000 * 60 * 60 * 10)],
      profileSettings: { User: { tonysRhythm: false, fingering: true } },
      fingerPatterns: [],
      selectedFingerPatternId: null,
      rhythmPatterns: [],
      selectedRhythmPatternId: null,
    },
    settings: {
      mode: 'classic',
      blind: false,
      voice: false,
      sound: false,
      specializedPractice: { enabled: false, start: 'a', end: 'z' },
    },
    meta: { updatedAt: now },
  };
};

const completeRunAndSave = async (page, { delayMs = 70 } = {}) => {
  await safeClickTab(page, 'Practice & Record');
  await sleep(200);
  await setModeButton(page, 'classic');
  await ensureChecked(page, 'Specialized Practice', false);
  await ensureChecked(page, 'Blind Mode', false);

  await page.keyboard.type('abcdefghijklmnopqrstuvwxyz', { delay: delayMs });
  await page.getByText('New Run Completed!', { exact: true }).waitFor({ timeout: 15000 });

  const save = page.getByRole('button', { name: 'Save & Restart', exact: true });
  if (await save.count()) await save.first().click();

  await page.getByText('New Run Completed!', { exact: true }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await sleep(200);
};

const smokeTogglesStick = async (page) => {
  await safeClickTab(page, 'Practice & Record');
  await sleep(200);

  // These flips should stick without reverting.
  await ensureChecked(page, 'Show Fingering', false);
  await sleep(450);
  await assertChecked(page, 'Show Fingering', false);

  await ensureChecked(page, 'Show Fingering', true);
  await sleep(450);
  await assertChecked(page, 'Show Fingering', true);

  await ensureChecked(page, 'Rhythm Pattern', true);
  await sleep(450);
  await assertChecked(page, 'Rhythm Pattern', true);

  await ensureChecked(page, 'Rhythm Pattern', false);
  await sleep(450);
  await assertChecked(page, 'Rhythm Pattern', false);
};

const smokeBlankEnterRestart = async (page) => {
  await safeClickTab(page, 'Practice & Record');
  await sleep(250);

  // Switch to blank typing mode.
  const blankBtn = page.getByRole('button', { name: /blank/i });
  if (!(await blankBtn.count())) return;
  await blankBtn.first().click();
  await sleep(250);

  const ta = page.locator('textarea').first();
  if (!(await ta.count())) return;
  await ta.click();
  await page.keyboard.type('a');
  await sleep(200);

  // Enter should restart (clear typed text) rather than insert a newline.
  await page.keyboard.press('Enter');
  await sleep(300);
  const v = await ta.inputValue();
  assert(v === '' || v === 'a', 'Blank typing Enter did not restart/clear');
};

const smokeOneViewport = async (browser, device) => {
  const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor });
  await context.addInitScript(
    ({ seed, storageKey, proKey }) => {
      try {
        localStorage.setItem(proKey, '1');
        localStorage.setItem(storageKey, JSON.stringify(seed));
      } catch {
        // ignore
      }
    },
    { seed: seedData(), storageKey: STORAGE_KEY, proKey: PROFESSIONAL_MODE_STORAGE_KEY },
  );

  const page = await context.newPage();
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
  await sleep(3600);

  // Practice
  assert(await safeClickTab(page, 'Practice & Record'), 'Practice & Record tab missing');
  await page.locator('#letter-0').waitFor({ state: 'visible', timeout: 10000 });
  await ensureChecked(page, 'Show Fingering', true);
  await ensureChecked(page, 'Rhythm Pattern', false);
  await ensureChecked(page, 'Specialized Practice', false);
  await ensureChecked(page, 'Blind Mode', false);

  await smokeTogglesStick(page);

  // Generate a run and save it so Analytics + History definitely populate.
  await completeRunAndSave(page, { delayMs: 75 });

  // Analytics
  assert(await safeClickTab(page, 'Analytics & Coach'), 'Analytics & Coach tab missing');
  await page.getByText('Complete a few runs!').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  // Either we see populated rows or the empty state; empty state is a failure.
  const emptyAnalytics = await page.getByText('Complete a few runs!', { exact: true }).count();
  assert(emptyAnalytics === 0, 'Analytics still empty after saving runs');

  // Finger patterns
  assert(await safeClickTab(page, 'Finger Pattern Practice'), 'Finger Pattern Practice tab missing');
  await sleep(800);

  // History
  assert(await safeClickTab(page, 'Run History'), 'Run History tab missing');
  await page.getByText('No history yet. Start practice!').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  const emptyHistory = await page.getByText('No history yet. Start practice!', { exact: true }).count();
  assert(emptyHistory === 0, 'Run History still empty after saving runs');

  // Account/Cloud
  await safeClickAnyTab(page, ['Account', 'Cloud Sync', 'Login']);
  await sleep(600);

  // About
  const aboutOk = await safeClickAnyTab(page, ['About', 'Info']);
  assert(aboutOk, 'About tab missing');
  await page.getByText('AlphaTyper').first().waitFor({ timeout: 8000 });

  await smokeBlankEnterRestart(page);

  await context.close();
};

const main = async () => {
  const vite = await startViteIfNeeded(SITE_URL);
  try {
    const browser = await chromium.launch();
    try {
      const devices = [
        { id: 'iphone-6.7', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 },
        { id: 'ipad-12.9', viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 },
      ];

      for (const d of devices) {
        process.stdout.write(`SMOKE: ${d.id}...\n`);
        // eslint-disable-next-line no-await-in-loop
        await smokeOneViewport(browser, d);
        process.stdout.write(`SMOKE: ${d.id} OK\n`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stopChild(vite);
  }

  process.stdout.write('SMOKE: ALL OK\n');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
