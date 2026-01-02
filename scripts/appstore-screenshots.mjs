import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const SITE_URL = process.env.SCREENSHOT_URL || 'https://alphatyper.vercel.app';
const OUT_DIR = path.resolve(process.cwd(), 'screenshots');
const VIDEO_DIR = path.resolve(process.cwd(), 'videos');
const FINAL_DIR = path.resolve(process.cwd(), 'appstore', 'final');
const EXPORT_FINAL = process.env.EXPORT_FINAL === '1' || process.env.EXPORT_FINAL === 'true';
const EXPORT_MP4 =
  process.env.EXPORT_MP4 === '1' ||
  process.env.EXPORT_MP4 === 'true' ||
  (EXPORT_FINAL && process.env.EXPORT_MP4 !== '0' && process.env.EXPORT_MP4 !== 'false');

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
  // Prefer a simple GET on the root; Vite will respond even before full HMR settles.
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
  if (!process.env.SCREENSHOT_URL) return null;
  if (!isLocalUrl(siteUrl)) return null;

  // If already running, do nothing.
  if (await waitForHttpReady(siteUrl, { timeoutMs: 1200, pollMs: 200 })) return null;

  let port = '5173';
  try {
    port = String(new URL(siteUrl).port || '5173');
  } catch {
    // ignore
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  process.stdout.write(`Starting Vite dev server on ${siteUrl}...\n`);
  const child = spawn(npmCmd, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', port], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  child.stdout?.on('data', (d) => {
    const s = d.toString();
    if (s.includes('Local:') || s.includes('ready in')) process.stdout.write(s);
  });
  child.stderr?.on('data', (d) => {
    const s = d.toString();
    // Avoid noisy logs; only surface clear errors.
    if (s.toLowerCase().includes('error') || s.toLowerCase().includes('failed')) process.stdout.write(s);
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

const stopChildProcess = async (child) => {
  if (!child) return;
  if (child.killed) return;
  try {
    child.kill('SIGINT');
  } catch {
    // ignore
  }
  // Give it a moment to exit cleanly.
  for (let i = 0; i < 20; i++) {
    if (child.exitCode != null) return;
    await sleep(100);
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // ignore
  }
};

/**
 * iPad 12.9" (2048×2732) => 1024×1366 @2
 */
const IPAD_12_9 = { id: 'ipad-12.9', viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 };
/**
 * iPad 12.9" landscape (2732×2048) => 1366×1024 @2
 */
const IPAD_12_9_LANDSCAPE = { id: 'ipad-12.9-landscape', viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2 };

/**
 * iPhone 6.7" (1290×2796) => 430×932 @3
 */
const IPHONE_6_7 = { id: 'iphone-6.7', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 };
/**
 * iPhone 6.1" (1179×2556) => 393×852 @3
 */
const IPHONE_6_1 = { id: 'iphone-6.1', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 };

const ALL_DEVICES = [IPAD_12_9, IPAD_12_9_LANDSCAPE, IPHONE_6_7, IPHONE_6_1];

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const emptyDir = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  ensureDir(dir);
};

const copyDir = (from, to) => {
  ensureDir(to);
  fs.cpSync(from, to, { recursive: true });
};

const toMp4IfPossible = (inputWebmPath, outputMp4Path) => {
  if (!EXPORT_MP4) return false;
  if (!inputWebmPath || !fs.existsSync(inputWebmPath)) return false;
  if (!ffmpegPath) {
    process.stdout.write('Skipping MP4 export (ffmpeg-static unavailable).\n');
    return false;
  }

  ensureDir(path.dirname(outputMp4Path));
  const result = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-i',
      inputWebmPath,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-level',
      '4.1',
      '-movflags',
      '+faststart',
      '-r',
      '30',
      '-crf',
      '20',
      '-preset',
      'medium',
      '-an',
      outputMp4Path,
    ],
    { stdio: 'pipe' },
  );

  if (result.status !== 0) {
    process.stdout.write(`MP4 export failed for ${inputWebmPath}\n`);
    const err = (result.stderr || '').toString().trim();
    if (err) process.stdout.write(`${err}\n`);
    return false;
  }

  process.stdout.write(`Saved ${outputMp4Path}\n`);
  return true;
};

const safeClickTab = async (page, label) => {
  const btn = page.getByRole('button', { name: label, exact: true });
  if (await btn.count()) {
    await btn.first().click();
    return true;
  }
  return false;
};

const ensureProfessionalMode = async (page) => {
  const proSwitch = page.getByRole('switch').first();
  if (await proSwitch.count()) {
    const checked = await proSwitch.getAttribute('aria-checked');
    if (checked !== 'true') await proSwitch.click();
  }
};

const seedData = () => {
  const now = Date.now();
  const mkLog = (durations) => {
    const ds = Array.isArray(durations) ? durations : [];
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    let total = 0;
    const log = [{ char: letters[0], duration: 0, total: 0, prev: '' }];
    for (let i = 1; i < letters.length; i += 1) {
      const d = ds[i - 1] ?? (0.03 + (i % 7) * 0.004);
      total += d;
      log.push({ char: letters[i], duration: d, total, prev: letters[i - 1] });
    }
    return log;
  };

  const run = (mode, time, timestampOffset, logDurations) => ({
    id: `seed_${mode}_${now - timestampOffset}`,
    time,
    mistakes: mode === 'classic' ? 0 : 1,
    mode,
    profile: 'User',
    device: 'This Device',
    deviceId: 'seed-ipad',
    deviceLabel: 'This Device',
    platform: 'web',
    blind: false,
    note: '',
    timestamp: now - timestampOffset,
    log: mkLog(logDurations),
    mistakeLog: [],
    specialized: { enabled: false, start: 'a', end: 'z' },
  });

  const fingerPattern = {
    id: 'fp1',
    name: 'Custom Fingering Drill',
    map: {
      a: 'L5',
      s: 'L4',
      d: 'L3',
      f: 'L2',
      j: 'R2',
      k: 'R3',
      l: 'R4',
      ';': 'R5',
    },
    createdAt: now - 1000 * 60 * 60 * 24 * 7,
    updatedAt: now - 1000 * 60 * 60 * 2,
  };

  const rhythmPattern = {
    id: 'rp1',
    name: 'Speed Bursts',
    groupsRow1: [['a', 'b'], ['c', 'd', 'e'], ['f', 'g'], ['h'], ['i', 'j', 'k'], ['l', 'm', 'n'], ['o', 'p']],
    groupsRow2: [['q', 'r'], ['s'], ['t', 'u'], ['v'], ['w', 'x'], ['y'], ['z']],
    createdAt: now - 1000 * 60 * 60 * 24 * 5,
    updatedAt: now - 1000 * 60 * 60 * 1,
  };

  return {
    localData: {
      profiles: ['User'],
      devices: ['This Device'],
      currentProfile: 'User',
      currentDevice: 'This Device',
      history: [
        run('classic', 1.64, 1000 * 60 * 60 * 6, [0.020, 0.024, 0.031, 0.022, 0.027, 0.044, 0.023, 0.028, 0.026, 0.029, 0.038, 0.021, 0.025, 0.030, 0.033, 0.041, 0.024, 0.028, 0.035, 0.022, 0.026, 0.032, 0.029, 0.034, 0.040]),
        run('classic', 1.78, 1000 * 60 * 60 * 12, [0.026, 0.028, 0.036, 0.025, 0.030, 0.052, 0.025, 0.030, 0.028, 0.032, 0.040, 0.024, 0.027, 0.033, 0.036, 0.048, 0.027, 0.031, 0.039, 0.025, 0.029, 0.037, 0.033, 0.038, 0.046]),
        run('backwards-spaces', 2.54, 1000 * 60 * 60 * 24, null),
        run('spaces', 2.18, 1000 * 60 * 60 * 36, null),
        run('backwards', 1.95, 1000 * 60 * 60 * 48, null),
        run('flash', 1.40, 1000 * 60 * 60 * 72, null),
      ],
      profileSettings: { User: { tonysRhythm: false, fingering: true } },
      fingerPatterns: [fingerPattern],
      selectedFingerPatternId: 'fp1',
      rhythmPatterns: [rhythmPattern],
      selectedRhythmPatternId: 'rp1',
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

const installCaptureSkin = async (page) => {
  await page.evaluate(() => {
    const existing = document.getElementById('appstore-capture-skin');
    if (existing) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const isLandscape = w > h;
    const isPhone = Math.min(w, h) <= 500;

    const titleSize = isLandscape ? 50 : 62;
    const subtitleSize = isLandscape ? 22 : 28;
    const captionTop = isLandscape ? 38 : 50;
    const safeScale = isPhone ? 0.92 : isLandscape ? 0.82 : 0.86;
    const safeMarginTop = isPhone ? 120 : isLandscape ? 140 : 200;
    const safeTranslateX = isPhone ? 0 : isLandscape ? 170 : 0;
    const safeOrigin = isPhone ? 'top center' : isLandscape ? 'top left' : 'top center';

    const phoneTitle = 40;
    const phoneSubtitle = 18;
    const finalTitleSize = isPhone ? phoneTitle : titleSize;
    const finalSubtitleSize = isPhone ? phoneSubtitle : subtitleSize;
    const captionLeft = isPhone ? 20 : 44;
    const captionRight = isPhone ? 20 : 44;

    const style = document.createElement('style');
    style.id = 'appstore-capture-skin';
    style.textContent = `
      html, body { background: #061A44 !important; }
      #appstore-backdrop { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
      #appstore-backdrop .grad { position: absolute; inset: 0; background:
        radial-gradient(1000px 700px at 18% 8%, rgba(56,189,248,0.32), rgba(56,189,248,0.0) 60%),
        radial-gradient(1100px 820px at 88% 12%, rgba(37,99,235,0.34), rgba(37,99,235,0.0) 62%),
        linear-gradient(180deg, rgba(6,26,68,1) 0%, rgba(11,43,107,1) 55%, rgba(6,26,68,1) 100%);
      }
      #appstore-backdrop .dots { position: absolute; inset: 0; background-image:
        radial-gradient(circle at 1px 1px, rgba(255,255,255,0.10) 1px, rgba(255,255,255,0.0) 1.6px);
        background-size: 18px 18px;
        opacity: 0.18;
        mask-image: radial-gradient(900px 620px at 30% 14%, rgba(0,0,0,1), rgba(0,0,0,0) 70%);
      }
      #appstore-backdrop svg { position: absolute; left: -12%; right: -12%; bottom: -12%; width: 124%; height: 56%; opacity: 0.98; filter: drop-shadow(0 -18px 60px rgba(0,0,0,0.35)); }

      #appstore-caption { position: fixed; left: ${captionLeft}px; top: ${captionTop}px; right: ${captionRight}px; z-index: 2; pointer-events: none; display: flex; justify-content: flex-start; }
      #appstore-caption .panel {
        max-width: ${isPhone ? 390 : isLandscape ? 560 : 900}px;
        background: linear-gradient(180deg, rgba(15,23,42,0.42), rgba(15,23,42,0.30));
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 26px;
        padding: ${isPhone ? 16 : isLandscape ? 22 : 26}px ${isPhone ? 18 : isLandscape ? 26 : 30}px;
        box-shadow: 0 24px 70px rgba(0,0,0,0.45);
        -webkit-backdrop-filter: blur(14px) saturate(120%);
        backdrop-filter: blur(14px) saturate(120%);
        position: relative;
        overflow: hidden;
      }
      #appstore-caption .panel:before {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(520px 240px at 18% 10%, rgba(56,189,248,0.18), rgba(56,189,248,0.0) 70%);
        opacity: 0.9;
        pointer-events: none;
      }
      #appstore-caption .title { color: #fff; font: 950 ${finalTitleSize}px/1.03 system-ui, -apple-system, Segoe UI, Roboto, Arial; letter-spacing: -0.03em; text-shadow: 0 10px 26px rgba(0,0,0,0.35); position: relative; }
      #appstore-caption .subtitle { margin-top: ${isPhone ? 10 : 12}px; color: rgba(255,255,255,0.92); font: 750 ${finalSubtitleSize}px/1.22 system-ui, -apple-system, Segoe UI, Roboto, Arial; text-shadow: 0 10px 22px rgba(0,0,0,0.28); max-width: ${isPhone ? 340 : isLandscape ? 520 : 820}px; position: relative; }
      #appstore-caption .brand { margin-top: ${isPhone ? 12 : 16}px; display: flex; gap: 12px; align-items: center; position: relative; }
      #appstore-caption .brand img { width: ${isPhone ? 38 : 44}px; height: ${isPhone ? 38 : 44}px; border-radius: 12px; filter: drop-shadow(0 12px 22px rgba(0,0,0,0.35)); }
      #appstore-caption .brand .name { color: rgba(255,255,255,0.92); font: 900 ${isPhone ? 16 : 18}px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; letter-spacing: 0.10em; text-transform: uppercase; }

      /* Make room for the caption and let the blue/waves show through. */
      .safe-shell { background: transparent !important; position: relative; z-index: 1; transform: translateX(${safeTranslateX}px) scale(${safeScale}); transform-origin: ${safeOrigin}; margin-top: ${safeMarginTop}px !important; height: auto !important; }
      .safe-shell > .pointer-events-none.absolute.inset-0 { display: none !important; }

      /* Keep modal readable but don’t obscure the marketing background. */
      .modal-safe { background: transparent !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
    `;
    document.head.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.id = 'appstore-backdrop';
    backdrop.innerHTML = `
      <div class="grad"></div>
      <div class="dots"></div>
      <svg viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="wg1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="rgba(56,189,248,0.55)" />
            <stop offset="0.55" stop-color="rgba(59,130,246,0.55)" />
            <stop offset="1" stop-color="rgba(37,99,235,0.50)" />
          </linearGradient>
          <linearGradient id="wg2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="rgba(34,211,238,0.35)" />
            <stop offset="1" stop-color="rgba(59,130,246,0.30)" />
          </linearGradient>
          <filter id="wb" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
        </defs>
        <path filter="url(#wb)" fill="url(#wg1)" d="M0,224L48,218.7C96,213,192,203,288,202.7C384,203,480,213,576,208C672,203,768,181,864,170.7C960,160,1056,160,1152,176C1248,192,1344,224,1392,240L1440,256L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
        <path filter="url(#wb)" fill="url(#wg2)" d="M0,256L60,250.7C120,245,240,235,360,229.3C480,224,600,224,720,208C840,192,960,160,1080,149.3C1200,139,1320,149,1380,154.7L1440,160L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"></path>
        <path fill="rgba(2,6,23,0.22)" d="M0,288L80,277.3C160,267,320,245,480,240C640,235,800,245,960,240C1120,235,1280,213,1360,202.7L1440,192L1440,320L1360,320C1280,320,1120,320,960,320C800,320,640,320,480,320C320,320,160,320,80,320L0,320Z"></path>
      </svg>
    `;
    document.body.appendChild(backdrop);

    const caption = document.createElement('div');
    caption.id = 'appstore-caption';
    caption.innerHTML = `
      <div class="panel">
        <div class="title" id="appstore-title">AlphaTyper</div>
        <div class="subtitle" id="appstore-subtitle">Professional practice tools for serious speed.</div>
        <div class="brand" id="appstore-brand" style="display:none">
          <img src="/logo.svg" alt="" />
          <div class="name">YUNOVA</div>
        </div>
      </div>
    `;
    document.body.appendChild(caption);
  });
};

const setCaption = async (page, { title, subtitle, showBrand = false }) => {
  await page.evaluate(
    ({ title, subtitle, showBrand }) => {
      const t = document.getElementById('appstore-title');
      const s = document.getElementById('appstore-subtitle');
      const b = document.getElementById('appstore-brand');
      if (t) t.textContent = title;
      if (s) s.textContent = subtitle;
      if (b) b.style.display = showBrand ? 'flex' : 'none';
    },
    { title, subtitle, showBrand },
  );
};

const setModeButton = async (page, name) => {
  let btn;
  if (typeof name === 'string') {
    btn = page.getByRole('button', { name, exact: true });
    if (!(await btn.count())) {
      btn = page.getByRole('button', { name });
    }
  } else {
    btn = page.getByRole('button', { name });
  }
  await btn.first().click();
};

const setSpecializedRange = async (page, start, end) => {
  const rangeContainer = page.getByText('Range', { exact: true }).locator('..');
  const combos = rangeContainer.getByRole('combobox');
  if ((await combos.count()) >= 2) {
    await combos.nth(0).selectOption(String(start).toLowerCase());
    await combos.nth(1).selectOption(String(end).toLowerCase());
  }
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

const framePracticeLetters = async (page) => {
  try {
    const first = page.locator('#letter-0');
    if (await first.count()) {
      await first.first().scrollIntoViewIfNeeded();
      await sleep(120);
      await page.evaluate(() => window.scrollBy(0, -180));
      await sleep(120);
      return;
    }
  } catch {
    // ignore
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(120);
};

const getStoredHistoryCount = async (page) => {
  try {
    return await page.evaluate((storageKey) => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        const history = parsed?.localData?.history;
        return Array.isArray(history) ? history.length : 0;
      } catch {
        return 0;
      }
    }, STORAGE_KEY);
  } catch {
    return 0;
  }
};

const waitForEmptyStateGone = async (page, text, timeoutMs = 4000) => {
  const loc = page.getByText(text, { exact: true });
  if (!(await loc.count())) return;
  await loc.first().waitFor({ state: 'detached', timeout: timeoutMs }).catch(async () => {
    // Sometimes it's present but not detached (hidden); accept hidden.
    await loc.first().waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => {});
  });
};

const completeClassicRunAndSave = async (page, { delayMs = 70 } = {}) => {
  await safeClickTab(page, 'Practice & Record');
  await sleep(250);
  await setModeButton(page, 'classic');
  await ensureChecked(page, 'Specialized Practice', false);
  await ensureChecked(page, 'Blind Mode', false);

  await page.keyboard.type('abcdefghijklmnopqrstuvwxyz', { delay: delayMs });
  await page.getByText('New Run Completed!', { exact: true }).waitFor({ timeout: 12000 });

  const save = page.getByRole('button', { name: 'Save & Restart', exact: true });
  if (await save.count()) {
    await save.first().click();
  } else {
    await closeResultsModal(page);
  }

  await page.getByText('New Run Completed!', { exact: true }).waitFor({ state: 'detached', timeout: 12000 }).catch(() => {});
  await sleep(250);
};

const ensurePopulatedForAnalyticsAndHistory = async (page) => {
  // Seed data should already exist, but the UI filters analytics by current profile+device.
  // To guarantee screenshots aren't empty, ensure a few saved runs exist for this session.
  let count = await getStoredHistoryCount(page);
  const target = Math.max(6, count);
  let tries = 0;
  while (count < target && tries < 4) {
    tries += 1;
    await completeClassicRunAndSave(page, { delayMs: 70 + tries * 6 });
    count = await getStoredHistoryCount(page);
  }
};

const runToOpenResults = async (page, { delayMs = 70 } = {}) => {
  await safeClickTab(page, 'Practice & Record');
  await sleep(350);

  // Start + finish a classic run quickly to open the Results modal.
  // Global key handler listens on window; no need to focus an input.
  await setModeButton(page, 'classic');
  await ensureChecked(page, 'Specialized Practice', false);
  await ensureChecked(page, 'Blind Mode', false);
  await page.keyboard.type('abcdefghijklmnopqrstuvwxyz', { delay: delayMs });
  await page.getByText('New Run Completed!', { exact: true }).waitFor({ timeout: 8000 });
};

const closeResultsModal = async (page) => {
  const modalTitle = page.getByText('New Run Completed!', { exact: true });
  if (!(await modalTitle.count())) return;
  const discard = page.getByRole('button', { name: 'Discard & Restart', exact: true });
  if (await discard.count()) {
    await discard.first().click();
  }
  await modalTitle.waitFor({ state: 'detached', timeout: 8000 });
};

const takeShot = async (page, outPath) => {
  await sleep(350);
  await page.screenshot({ path: outPath, fullPage: false });
  process.stdout.write(`Saved ${outPath}\n`);
};

const generateScreenshots = async (browser, device) => {
  const seed = seedData();

  const deviceDir = path.join(OUT_DIR, device.id);
  emptyDir(deviceDir);

  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
  });
  await context.addInitScript(
    ({ seed, storageKey, proKey }) => {
      try {
        localStorage.setItem(proKey, '1');
        localStorage.setItem(storageKey, JSON.stringify(seed));
      } catch {
        // ignore
      }
    },
    { seed, storageKey: STORAGE_KEY, proKey: PROFESSIONAL_MODE_STORAGE_KEY },
  );

  const page = await context.newPage();
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
  await sleep(3600);

  await ensureProfessionalMode(page);
  await installCaptureSkin(page);

  // 1) Practice & Record + fingering
  await safeClickTab(page, 'Practice & Record');
  await ensureChecked(page, 'Show Fingering', true);
  await ensureChecked(page, 'Rhythm Pattern', false);
  await ensureChecked(page, 'Specialized Practice', false);
  await ensureChecked(page, 'Blind Mode', false);
  // On phones, Playwright may auto-scroll to toggles; re-frame on the letter grid.
  await sleep(180);
  await framePracticeLetters(page);
  await setCaption(page, {
    title: 'Guided Practice, Instantly',
    subtitle: 'Clean drills with optional fingering guidance when you want it.',
  });
  await takeShot(page, path.join(deviceDir, '01-practice-fingering.png'));

  // 2) Time results
  await runToOpenResults(page, { delayMs: 75 });
  await setCaption(page, {
    title: 'Know What Slowed You Down',
    subtitle: 'Finish a run and get clear results you can improve right away.',
  });
  await takeShot(page, path.join(deviceDir, '02-time-results.png'));
  // Save the run so Analytics + Run History are populated.
  const save = page.getByRole('button', { name: 'Save & Restart', exact: true });
  if (await save.count()) await save.first().click();
  else await closeResultsModal(page);
  await sleep(250);

  // Ensure there are enough runs to make Analytics/History look alive.
  await ensurePopulatedForAnalyticsAndHistory(page);

  // 3) Analytics / splits
  await safeClickTab(page, 'Analytics & Coach');
  await waitForEmptyStateGone(page, 'Complete a few runs!', 6000);
  await setCaption(page, {
    title: 'See Your Speed Map',
    subtitle: 'Splits show exactly where you lose time — and where to focus.',
  });
  await takeShot(page, path.join(deviceDir, '03-analytics-splits.png'));

  // 4) Customize fingerings + rhythms
  await safeClickTab(page, 'Finger Pattern Practice');
  await sleep(450);
  // Keep framing consistent: stay near the top and open a single editor.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
  await page.getByRole('button', { name: 'New Pattern', exact: true }).click();
  await sleep(450);
  await setCaption(page, {
    title: 'Customize Fingerings & Rhythms',
    subtitle: 'Build your own drills in seconds — for the exact skills you want.',
  });
  await takeShot(page, path.join(deviceDir, '04-customize-patterns.png'));
  await page.evaluate(() => window.scrollTo(0, 0));

  // 5) Backwards + spaces (many modes)
  await safeClickTab(page, 'Practice & Record');
  await sleep(350);
  await setModeButton(page, 'Z Y X');
  await ensureChecked(page, 'Show Fingering', true);
  await ensureChecked(page, 'Specialized Practice', false);
  await setCaption(page, {
    title: 'Train Real Control',
    subtitle: 'Backwards, spaces, blind mode — switch instantly and level up.',
  });
  await takeShot(page, path.join(deviceDir, '05-modes-backwards-spaces.png'));

  // 6) Specialized Practice
  await setModeButton(page, 'classic');
  await sleep(250);
  await ensureChecked(page, 'Specialized Practice', true);
  await sleep(250);
  await setSpecializedRange(page, 'g', 'p');
  await ensureChecked(page, 'Show Fingering', true);
  await setCaption(page, {
    title: 'Specialized Practice',
    subtitle: 'Pick a range and drill it until it feels automatic.',
  });
  await takeShot(page, path.join(deviceDir, '06-specialized-practice.png'));

  // Extra options (so you can pick your favorites) — App Store allows up to 10.
  // 7) Blind mode
  await safeClickTab(page, 'Practice & Record');
  await sleep(250);
  await setModeButton(page, 'classic');
  await ensureChecked(page, 'Specialized Practice', false);
  await ensureChecked(page, 'Blind Mode', true);
  await ensureChecked(page, 'Show Fingering', false);
  await framePracticeLetters(page);
  await setCaption(page, {
    title: 'Train Without Looking',
    subtitle: 'Blind Mode builds real confidence and control.',
  });
  await takeShot(page, path.join(deviceDir, '07-blind-mode.png'));

  // 8) Rhythm pattern
  await ensureChecked(page, 'Blind Mode', false);
  await ensureChecked(page, 'Show Fingering', true);
  await ensureChecked(page, 'Rhythm Pattern', true);
  await framePracticeLetters(page);
  await setCaption(page, {
    title: 'Rhythm-Based Drills',
    subtitle: 'Practice in groups to lock in smooth transitions.',
  });
  await takeShot(page, path.join(deviceDir, '08-rhythm-pattern.png'));

  // 9) Run history
  await safeClickTab(page, 'Run History');
  await sleep(350);
  await waitForEmptyStateGone(page, 'No history yet. Start practice!', 6000);
  await setCaption(page, {
    title: 'Track Progress Over Time',
    subtitle: 'Your runs, organized and easy to review.',
  });
  await takeShot(page, path.join(deviceDir, '09-run-history.png'));

  // 10) Cloud Sync (Account)
  await safeClickAnyTab(page, ['Account', 'Cloud Sync', 'Login']);
  await sleep(450);
  await setCaption(page, {
    title: 'Cloud Sync Across Devices',
    subtitle: 'Sign in once and keep your progress backed up.',
  });
  await takeShot(page, path.join(deviceDir, '10-cloud-sync.png'));

  await context.close();
};

const recordPreviewVideo = async (browser, device) => {
  const seed = seedData();
  const deviceDir = path.join(VIDEO_DIR, device.id);
  emptyDir(deviceDir);

  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    recordVideo: {
      dir: deviceDir,
      size: device.viewport,
    },
  });
  await context.addInitScript(
    ({ seed, storageKey, proKey }) => {
      try {
        localStorage.setItem(proKey, '1');
        localStorage.setItem(storageKey, JSON.stringify(seed));
      } catch {
        // ignore
      }
    },
    { seed, storageKey: STORAGE_KEY, proKey: PROFESSIONAL_MODE_STORAGE_KEY },
  );

  const page = await context.newPage();
  const video = page.video();
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
  await sleep(3600);
  await ensureProfessionalMode(page);
  await installCaptureSkin(page);

  // Quick walkthrough (generic App Store preview style; no copying other apps).
  await safeClickTab(page, 'Practice & Record');
  await ensureChecked(page, 'Show Fingering', true);
  await ensureChecked(page, 'Rhythm Pattern', false);
  await setCaption(page, { title: 'Practice That Actually Works', subtitle: 'Guided fingering + focused drills.', showBrand: false });
  await page.keyboard.type('abcdef', { delay: 30 });
  await sleep(650);

  await setCaption(page, { title: 'Instant Results', subtitle: 'Clear feedback after every run.', showBrand: false });
  await runToOpenResults(page);
  await sleep(650);
  await closeResultsModal(page);
  await sleep(450);

  await safeClickTab(page, 'Analytics & Coach');
  await setCaption(page, { title: 'See Your Bottlenecks', subtitle: 'Splits reveal what to fix next.', showBrand: false });
  await sleep(1100);

  await safeClickTab(page, 'Finger Pattern Practice');
  await setCaption(page, { title: 'Build Custom Drills', subtitle: 'Finger patterns and rhythm practice.', showBrand: false });
  await sleep(500);
  await page.getByRole('button', { name: 'New Pattern', exact: true }).click();
  await sleep(450);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(950);

  await safeClickTab(page, 'Practice & Record');
  await setModeButton(page, 'Z Y X');
  await setCaption(page, { title: 'Switch Modes Anytime', subtitle: 'Backwards, spaces, blind, and more.', showBrand: false });
  await sleep(900);

  await setModeButton(page, 'classic');
  await ensureChecked(page, 'Specialized Practice', true);
  await sleep(300);
  await setSpecializedRange(page, 'g', 'p');
  await setCaption(page, { title: 'Target Weak Letters', subtitle: 'Pick a range and drill it fast.', showBrand: false });
  await sleep(1000);

  await safeClickTab(page, 'About');
  await setCaption(page, { title: 'AlphaTyper', subtitle: 'Built by YUNOVA, LLC', showBrand: true });
  await sleep(1400);

  await context.close();

  if (video) {
    const rawPath = await video.path();
    const finalPath = path.join(deviceDir, 'app-preview.webm');
    try {
      fs.renameSync(rawPath, finalPath);
      process.stdout.write(`Saved ${finalPath}\n`);
    } catch {
      process.stdout.write(`Saved ${rawPath}\n`);
    }

    const mp4Path = path.join(deviceDir, 'app-preview.mp4');
    toMp4IfPossible(finalPath, mp4Path);
  }
};

const showEndcardOverlay = async (page, { title, tagline, lines }) => {
  await page.evaluate(
    ({ title, tagline, lines }) => {
      const existing = document.getElementById('appstore-ad-endcard');
      if (existing) existing.remove();

      const root = document.createElement('div');
      root.id = 'appstore-ad-endcard';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.zIndex = '999999';
      root.style.display = 'flex';
      root.style.alignItems = 'center';
      root.style.justifyContent = 'center';
      root.style.background = 'radial-gradient(900px 500px at 25% 15%, rgba(56,189,248,0.30), rgba(56,189,248,0)), linear-gradient(135deg, #061A44, #0B2B6B 55%, #061A44)';
      root.style.opacity = '0';
      root.style.transition = 'opacity 520ms ease';

      const panel = document.createElement('div');
      panel.style.width = 'min(86vw, 980px)';
      panel.style.padding = 'min(7vw, 72px)';
      panel.style.borderRadius = '28px';
      panel.style.border = '1px solid rgba(255,255,255,0.18)';
      panel.style.background = 'rgba(2, 6, 23, 0.40)';
      panel.style.backdropFilter = 'blur(16px)';
      panel.style.webkitBackdropFilter = 'blur(16px)';
      panel.style.boxShadow = '0 30px 90px rgba(2, 6, 23, 0.55)';
      panel.style.textAlign = 'left';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.gap = '18px';
      top.style.marginBottom = '18px';

      const logo = document.createElement('img');
      logo.src = '/logo.svg';
      logo.alt = 'AlphaTyper';
      logo.style.width = '72px';
      logo.style.height = '72px';
      logo.style.borderRadius = '18px';
      logo.style.background = 'rgba(255,255,255,0.06)';
      logo.style.border = '1px solid rgba(255,255,255,0.12)';

      const headingWrap = document.createElement('div');

      const h1 = document.createElement('div');
      h1.textContent = title;
      h1.style.color = '#fff';
      h1.style.fontWeight = '900';
      h1.style.lineHeight = '1.04';
      h1.style.letterSpacing = '-0.02em';
      h1.style.fontSize = 'clamp(40px, 6vw, 88px)';

      const h2 = document.createElement('div');
      h2.textContent = tagline;
      h2.style.color = 'rgba(255,255,255,0.88)';
      h2.style.fontWeight = '750';
      h2.style.marginTop = '10px';
      h2.style.fontSize = 'clamp(16px, 2.1vw, 30px)';

      headingWrap.appendChild(h1);
      headingWrap.appendChild(h2);

      top.appendChild(logo);
      top.appendChild(headingWrap);

      const list = document.createElement('div');
      list.style.marginTop = '22px';
      list.style.display = 'grid';
      list.style.gap = '10px';

      (lines || []).forEach((t) => {
        const row = document.createElement('div');
        row.textContent = t;
        row.style.color = 'rgba(255,255,255,0.86)';
        row.style.fontWeight = '800';
        row.style.letterSpacing = '0.02em';
        row.style.fontSize = 'clamp(14px, 1.8vw, 24px)';
        list.appendChild(row);
      });

      panel.appendChild(top);
      panel.appendChild(list);
      root.appendChild(panel);
      document.body.appendChild(root);

      requestAnimationFrame(() => {
        root.style.opacity = '1';
      });
    },
    { title, tagline, lines },
  );
};

const probeDurationSeconds = (mediaPath) => {
  if (!ffmpegPath) return null;
  if (!mediaPath || !fs.existsSync(mediaPath)) return null;

  const r = spawnSync(ffmpegPath, ['-i', mediaPath], { stdio: 'pipe' });
  const err = (r.stderr || '').toString();
  const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
  return hh * 3600 + mm * 60 + ss;
};

const toMp4WithGeneratedAudioIfPossible = (inputWebmPath, outputMp4Path, { durationSeconds, trimStartSeconds = 0 } = {}) => {
  if (!EXPORT_MP4) return false;
  if (!inputWebmPath || !fs.existsSync(inputWebmPath)) return false;
  if (!ffmpegPath) return false;

  ensureDir(path.dirname(outputMp4Path));
  // Keep within common App Store preview limits while allowing more room than 20s.
  const dur = Math.min(29.5, Math.max(1, Number(durationSeconds) || 26));
  const trimStart = Math.max(0, Number(trimStartSeconds) || 0);
  const srcDur = probeDurationSeconds(inputWebmPath);
  // If trimming, we need enough remaining duration; pad clones the last frame.
  const effectiveSrc = Math.max(0, (srcDur || 0) - trimStart);
  const pad = Math.max(0, effectiveSrc < dur ? dur - effectiveSrc : 0);

  // Safe synthesized audio: a soft ambient bed (no copyrighted music).
  const result = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-i',
      inputWebmPath,
      '-f',
      'lavfi',
      '-t',
      String(dur),
      '-i',
      'anoisesrc=color=pink:sample_rate=48000',
      '-f',
      'lavfi',
      '-t',
      String(dur),
      '-i',
      'sine=frequency=196:sample_rate=48000',
      '-f',
      'lavfi',
      '-t',
      String(dur),
      '-i',
      'sine=frequency=246.94:sample_rate=48000',
      '-filter_complex',
      [
        // Video: ensure 30fps and pad/trim to exact duration.
        `[0:v]fps=30,format=yuv420p,trim=start=${trimStart}:duration=${dur},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}[v]`,
        // Audio: warm + unobtrusive (avoid robotic clicks).
        '[1:a]highpass=f=160,lowpass=f=1500,volume=0.050,aecho=0.8:0.88:30:0.12[noise]',
        '[2:a]volume=0.020,vibrato=f=5:d=0.35[ton1]',
        '[3:a]volume=0.016,vibrato=f=6:d=0.30[ton2]',
        `[noise][ton1][ton2]amix=inputs=3:duration=first:dropout_transition=2,alimiter=limit=0.90,afade=t=in:st=0:d=0.35,afade=t=out:st=${Math.max(0, dur - 0.9).toFixed(3)}:d=0.9,atrim=duration=${dur},asetpts=PTS-STARTPTS[a]`,
      ].join(';'),
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-t',
      String(dur),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-level',
      '4.1',
      '-movflags',
      '+faststart',
      '-r',
      '30',
      '-crf',
      '20',
      '-preset',
      'medium',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      outputMp4Path,
    ],
    { stdio: 'pipe' },
  );

  if (result.status !== 0) {
    process.stdout.write(`MP4+audio export failed for ${inputWebmPath}\n`);
    const err = (result.stderr || '').toString().trim();
    if (err) process.stdout.write(`${err}\n`);
    return false;
  }

  process.stdout.write(`Saved ${outputMp4Path}\n`);
  return true;
};

const recordAdVideo = async (browser, device, { outDir }) => {
  if (!EXPORT_MP4) return;

  const seed = seedData();
  const rawDir = path.join(VIDEO_DIR, device.id, 'ad-raw');
  emptyDir(rawDir);
  ensureDir(outDir);

  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    recordVideo: {
      dir: rawDir,
      size: device.viewport,
    },
  });
  await context.addInitScript(
    ({ seed, storageKey, proKey }) => {
      try {
        localStorage.setItem(proKey, '1');
        localStorage.setItem(storageKey, JSON.stringify(seed));
      } catch {
        // ignore
      }
    },
    { seed, storageKey: STORAGE_KEY, proKey: PROFESSIONAL_MODE_STORAGE_KEY },
  );

  const page = await context.newPage();
  const video = page.video();
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
  // Let the app settle (including splash); we'll trim dead time in MP4 export.
  await sleep(3000);
  await ensureProfessionalMode(page);
  await installCaptureSkin(page);

  // Start: realistic typing (show the core mechanic).
  await safeClickTab(page, 'Practice & Record');
  await page.locator('#letter-0').waitFor({ state: 'visible', timeout: 8000 });
  // Click a visible element to "wake" the app without focusing a hidden input.
  await page.locator('#letter-0').click({ timeout: 3000 });
  await ensureChecked(page, 'Show Fingering', true);
  await ensureChecked(page, 'Rhythm Pattern', false);
  await ensureChecked(page, 'Specialized Practice', false);
  await ensureChecked(page, 'Blind Mode', false);
  await setModeButton(page, 'classic');
  await setCaption(page, { title: 'Type A–Z', subtitle: 'Just type the alphabet. Get faster every run.', showBrand: false });
  await sleep(220);
  await page.keyboard.type('abcdefghijklmnopqrstuvwxyz', { delay: 75 });
  await sleep(520);

  // Results.
  await setCaption(page, { title: 'Instant Results', subtitle: 'See time + mistakes right away.', showBrand: false });
  await page.getByText('New Run Completed!', { exact: true }).waitFor({ timeout: 20000 });
  await sleep(1200);
  // Save the run so Run History + Analytics are populated during the walkthrough.
  const saveRestart = page.getByRole('button', { name: 'Save & Restart', exact: true });
  if (await saveRestart.count()) await saveRestart.first().click();
  await page.getByText('New Run Completed!', { exact: true }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await sleep(650);

  // Analytics.
  await safeClickTab(page, 'Analytics & Coach');
  await setCaption(page, { title: 'Find Your Bottlenecks', subtitle: 'Splits show what to practice next.', showBrand: false });
  await sleep(2700);

  // Custom drills.
  await safeClickTab(page, 'Finger Pattern Practice');
  await setCaption(page, { title: 'Build Custom Drills', subtitle: 'Finger patterns + rhythm practice.', showBrand: false });
  await sleep(850);
  const newPattern = page.getByRole('button', { name: 'New Pattern', exact: true });
  if (await newPattern.count()) await newPattern.first().click();
  await sleep(1900);

  // Specialized practice.
  await safeClickTab(page, 'Practice & Record');
  await sleep(250);
  await ensureChecked(page, 'Rhythm Pattern', false);
  await ensureChecked(page, 'Blind Mode', false);
  await sleep(180);
  await ensureChecked(page, 'Specialized Practice', true);
  await sleep(260);
  await setSpecializedRange(page, 'g', 'p');
  await framePracticeLetters(page);
  await setCaption(page, { title: 'Targeted Practice', subtitle: 'Pick a range and drill it until it’s automatic.', showBrand: false });
  await sleep(2100);

  // Blind mode.
  await ensureChecked(page, 'Specialized Practice', false);
  await sleep(140);
  await ensureChecked(page, 'Blind Mode', true);
  await sleep(140);
  await ensureChecked(page, 'Show Fingering', false);
  await framePracticeLetters(page);
  await setCaption(page, { title: 'Blind Mode', subtitle: 'Train real confidence without looking.', showBrand: false });
  await sleep(1700);

  // Rhythm pattern.
  await ensureChecked(page, 'Blind Mode', false);
  await sleep(140);
  await ensureChecked(page, 'Show Fingering', true);
  await sleep(140);
  await ensureChecked(page, 'Rhythm Pattern', true);
  await framePracticeLetters(page);
  await setCaption(page, { title: 'Rhythm Drills', subtitle: 'Practice in groups for smooth transitions.', showBrand: false });
  await sleep(1700);

  // Run history.
  await safeClickTab(page, 'Run History');
  await setCaption(page, { title: 'Track Every Run', subtitle: 'Compare runs and see progress over time.', showBrand: false });
  await waitForEmptyStateGone(page, 'No history yet. Start practice!', 8000);
  await sleep(2200);

  // Cloud sync.
  await safeClickAnyTab(page, ['Account', 'Cloud Sync', 'Login']);
  await setCaption(page, { title: 'Cloud Sync', subtitle: 'Sign in once. Keep progress backed up.', showBrand: false });
  await sleep(1600);

  // Endcard (no blackout).
  await showEndcardOverlay(page, {
    title: 'AlphaTyper',
    tagline: 'Practice smarter. Improve faster.',
    lines: ['Download on the App Store', 'Made by Xiaoyu Tang', 'YUNOVA, LLC'],
  });
  await sleep(1600);

  await context.close();

  if (!video) return;
  const rawPath = await video.path();
  const webmPath = path.join(outDir, `${device.id}-ad.webm`);
  try {
    fs.renameSync(rawPath, webmPath);
    process.stdout.write(`Saved ${webmPath}\n`);
  } catch {
    process.stdout.write(`Saved ${rawPath}\n`);
  }

  const mp4Path = path.join(outDir, `${device.id}-ad.mp4`);
  if (!toMp4WithGeneratedAudioIfPossible(webmPath, mp4Path, { durationSeconds: 26, trimStartSeconds: 2.6 })) {
    // Fallback: silent MP4.
    toMp4IfPossible(webmPath, mp4Path);
  }
};

const buildAdVideoFromStills = ({ deviceId, outDir, durationSeconds = 26 }) => {
  if (!EXPORT_MP4) return;
  if (!ffmpegPath) return;

  const DEVICE_PX = {
    'ipad-12.9': { w: 2048, h: 2732 },
    'ipad-12.9-landscape': { w: 2732, h: 2048 },
    'iphone-6.7': { w: 1290, h: 2796 },
    'iphone-6.1': { w: 1179, h: 2556 },
  };
  const target = DEVICE_PX[deviceId];
  if (!target) return;

  const srcDir = path.join(OUT_DIR, deviceId);
  if (!fs.existsSync(srcDir)) return;

  const ordered = [
    '01-practice-fingering.png',
    '02-time-results.png',
    '03-analytics-splits.png',
    '06-specialized-practice.png',
    '04-customize-patterns.png',
    '09-run-history.png',
    '10-cloud-sync.png',
  ]
    .map((n) => path.join(srcDir, n))
    .filter((p) => fs.existsSync(p));

  if (ordered.length < 3) return;

  // Allocate time so everything is readable.
  const xfade = 0.35;
  const endcardDur = 1.4;
  const per = Math.max(1.6, (durationSeconds - endcardDur + xfade * (ordered.length - 1)) / ordered.length);

  const titleSize = Math.round(target.w * 0.07);
  const subtitleSize = Math.round(target.w * 0.026);
  const ctaSize = Math.round(target.w * 0.026);
  const brandSize = Math.round(target.w * 0.015);
  const x = Math.round(target.w * 0.06);
  const titleY = Math.round(target.h * 0.34);
  const subtitleY = titleY + Math.round(subtitleSize * 2.0);
  const ctaY = subtitleY + Math.round(ctaSize * 2.6);
  const brandY = ctaY + Math.round(brandSize * 3.6);

  const endcardSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${target.w}" height="${target.h}" viewBox="0 0 ${target.w} ${target.h}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#061A44"/>
          <stop offset="0.55" stop-color="#0B2B6B"/>
          <stop offset="1" stop-color="#061A44"/>
        </linearGradient>
        <radialGradient id="r" cx="30%" cy="20%" r="70%">
          <stop offset="0" stop-color="rgba(56,189,248,0.35)"/>
          <stop offset="1" stop-color="rgba(56,189,248,0)"/>
        </radialGradient>
      </defs>
      <rect width="${target.w}" height="${target.h}" fill="url(#g)"/>
      <rect width="${target.w}" height="${target.h}" fill="url(#r)"/>
      <text x="${x}" y="${titleY}" fill="#fff" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="900" font-size="${titleSize}">AlphaTyper</text>
      <text x="${x}" y="${subtitleY}" fill="rgba(255,255,255,0.92)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="700" font-size="${subtitleSize}">Practice smarter. Track progress. Improve faster.</text>
      <text x="${x}" y="${ctaY}" fill="rgba(255,255,255,0.92)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="800" font-size="${ctaSize}">Download on the App Store</text>
      <text x="${x}" y="${brandY}" fill="rgba(255,255,255,0.72)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="800" font-size="${brandSize}" letter-spacing="0.18em">YUNOVA</text>
    </svg>
  `.trim();

  const endcardPath = path.join(outDir, `${deviceId}-endcard.png`);
  ensureDir(outDir);
  spawnSync(ffmpegPath, ['-y', '-i', `data:image/svg+xml,${encodeURIComponent(endcardSvg)}`, '-frames:v', '1', endcardPath], { stdio: 'ignore' });

  const outPath = path.join(outDir, `${deviceId}-ad.mp4`);

  const inputs = [];
  const filterParts = [];
  let offset = per;

  // Image inputs.
  ordered.forEach((img, idx) => {
    inputs.push('-loop', '1', '-t', String(per + (idx === 0 ? xfade : 0)), '-i', img);
  });
  // Endcard.
  inputs.push('-loop', '1', '-t', String(endcardDur), '-i', endcardPath);

  // Audio: safe generated ambient bed (no copyrighted music).
  inputs.push('-f', 'lavfi', '-t', String(durationSeconds), '-i', 'anoisesrc=color=pink:sample_rate=48000');
  inputs.push('-f', 'lavfi', '-t', String(durationSeconds), '-i', 'sine=frequency=196:sample_rate=48000');
  inputs.push('-f', 'lavfi', '-t', String(durationSeconds), '-i', 'sine=frequency=246.94:sample_rate=48000');

  // Crossfades between video inputs.
  const totalVidInputs = ordered.length + 1;
  filterParts.push(`[${totalVidInputs}:a]highpass=f=160,lowpass=f=1500,volume=0.040,aecho=0.8:0.88:30:0.12[noise]`);
  filterParts.push(`[${totalVidInputs + 1}:a]volume=0.016,vibrato=f=5:d=0.35[ton1]`);
  filterParts.push(`[${totalVidInputs + 2}:a]volume=0.013,vibrato=f=6:d=0.30[ton2]`);
  filterParts.push(`[noise][ton1][ton2]amix=inputs=3:duration=first:dropout_transition=2,alimiter=limit=0.90,afade=t=in:st=0:d=0.35,afade=t=out:st=${Math.max(0, durationSeconds - 0.9).toFixed(3)}:d=0.9[a]`);

  for (let i = 0; i < totalVidInputs; i += 1) {
    // Force all segments (including endcard) to the exact same size so xfade works.
    filterParts.push(`[${i}:v]scale=${target.w}:${target.h},fps=30,format=yuv420p[v${i}]`);
  }

  // Chain xfades.
  let current = `[v0]`;
  for (let i = 1; i < totalVidInputs; i += 1) {
    const next = `[v${i}]`;
    const out = `[x${i}]`;
    filterParts.push(`${current}${next}xfade=transition=fade:duration=${xfade}:offset=${(i - 1) * per}${out}`);
    current = out;
  }

  const filter = `${filterParts.join(';')}`;

  const res = spawnSync(
    ffmpegPath,
    [
      '-y',
      ...inputs,
      '-filter_complex',
      filter,
      '-map',
      current,
      '-map',
      '[a]',
      '-t',
      String(durationSeconds),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-level',
      '4.1',
      '-movflags',
      '+faststart',
      '-r',
      '30',
      '-crf',
      '20',
      '-preset',
      'medium',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      outPath,
    ],
    { stdio: 'pipe' },
  );

  if (res.status !== 0) {
    const err = (res.stderr || '').toString().trim();
    process.stdout.write(`Ad video export failed for ${deviceId}\n`);
    if (err) process.stdout.write(`${err}\n`);
    return;
  }
  process.stdout.write(`Saved ${outPath}\n`);
};

const main = async () => {
  ensureDir(OUT_DIR);
  ensureDir(VIDEO_DIR);
  ensureDir(FINAL_DIR);

  const vite = await startViteIfNeeded(SITE_URL);

  try {
    const browser = await chromium.launch();
    try {
      for (const device of ALL_DEVICES) {
        await generateScreenshots(browser, device);
        await recordPreviewVideo(browser, device);
      }
    } finally {
      await browser.close();
    }

    // Build ad/App-Store-preview videos (real typing + walkthrough + branded endcard).
    if (EXPORT_MP4) {
      const adOut = path.join(FINAL_DIR, 'videos', 'ad');
      const browser2 = await chromium.launch();
      try {
        await recordAdVideo(browser2, IPAD_12_9_LANDSCAPE, { outDir: adOut });
        await recordAdVideo(browser2, IPHONE_6_7, { outDir: adOut });
      } finally {
        await browser2.close();
      }
    }

    if (EXPORT_FINAL) {
      const finalScreens = path.join(FINAL_DIR, 'screenshots');
      const finalVideos = path.join(FINAL_DIR, 'videos');
      ensureDir(finalScreens);
      ensureDir(finalVideos);

      for (const device of ALL_DEVICES) {
        const srcScreens = path.join(OUT_DIR, device.id);
        const srcVideos = path.join(VIDEO_DIR, device.id);
        const dstScreens = path.join(finalScreens, device.id);
        const dstVideos = path.join(finalVideos, device.id);
        emptyDir(dstScreens);
        emptyDir(dstVideos);
        if (fs.existsSync(srcScreens)) copyDir(srcScreens, dstScreens);
        if (fs.existsSync(srcVideos)) copyDir(srcVideos, dstVideos);
      }
      process.stdout.write(`Exported final assets to: ${FINAL_DIR}\n`);
    }

    process.stdout.write(`\nDone. Screenshots are in: ${OUT_DIR}\n`);
    process.stdout.write(`Video is in: ${VIDEO_DIR}\n`);
    process.stdout.write(`Tip: set SCREENSHOT_URL to capture a different site.\n`);
  } finally {
    await stopChildProcess(vite);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
