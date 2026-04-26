import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

const PORT = 4173;
const PROJECT_ROOT = process.cwd();
const URL = `http://127.0.0.1:${PORT}/`;
const OUTPUT = path.join(PROJECT_ROOT, 'thumbnail.png');
const INDEX_HTML_PATH = path.join(PROJECT_ROOT, 'index.html');
const THUMBNAIL_PUBLIC_URL = 'https://fnpavel.github.io/pauperdata/thumbnail.png';
const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 640;

function buildThumbnailUrl(version) {
  return `${THUMBNAIL_PUBLIC_URL}?v=${version}`;
}

async function updateIndexThumbnailVersion(version) {
  const nextUrl = buildThumbnailUrl(version);
  const file = await readFile(INDEX_HTML_PATH, 'utf8');
  let updated = file.replace(
    /(<meta\s+(?:property="og:image"|property="og:image:secure_url"|name="twitter:image")\s+content=")https:\/\/fnpavel\.github\.io\/pauperdata\/thumbnail\.png(?:\?v=[^"]*)?(")/g,
    `$1${nextUrl}$2`
  );

  updated = updated.replace(
    /(<meta\s+property="og:image:width"\s+content=")\d+(")/,
    `$1${THUMBNAIL_WIDTH}$2`
  );
  updated = updated.replace(
    /(<meta\s+property="og:image:height"\s+content=")\d+(")/,
    `$1${THUMBNAIL_HEIGHT}$2`
  );

  if (updated === file) {
    throw new Error('Could not find OG/Twitter thumbnail meta tags in index.html.');
  }

  await writeFile(INDEX_HTML_PATH, updated, 'utf8');
  console.log(`Updated index.html thumbnail cache-bust token: ${version}`);
}

function waitForPort(port, host = '127.0.0.1', timeout = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function tryConnect() {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });

      socket.on('error', () => {
        socket.destroy();

        if (Date.now() - start > timeout) {
          reject(new Error(`Server did not start in time on ${host}:${port}`));
        } else {
          setTimeout(tryConnect, 250);
        }
      });
    }

    tryConnect();
  });
}

function waitForProcessExit(child, timeout = 5000) {
  return new Promise(resolve => {
    let settled = false;

    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    child.once('exit', finish);
    child.once('close', finish);
    setTimeout(finish, timeout);
  });
}

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT)], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  let browser;

  try {
    await waitForPort(PORT);

    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage({
      viewport: { width: 1280, height: 640 },
      deviceScaleFactor: 1,
      colorScheme: 'dark'
    });

    await page.addInitScript(() => {
      localStorage.setItem('mtg-tracker-theme', 'dark');
    });

    // The dashboard can keep fetching data after first paint, so waiting for
    // full network idle makes local thumbnail generation flaky and can time out.
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    await page.waitForSelector('header .logo h1', { timeout: 15000 });
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      //const totalHeight = document.body.scrollHeight;
      //const viewportHeight = window.innerHeight;
      //const targetY = Math.max(0, (totalHeight - viewportHeight) / 2 - 1000);
      window.scrollTo(0, 320);
    });

    await page.waitForTimeout(500);

    await page.screenshot({
      path: OUTPUT,
      type: 'png',
      clip: { x: 0, y: 0, width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT },
    });

    const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    await updateIndexThumbnailVersion(version);

    console.log(`Thumbnail updated: ${OUTPUT}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }

    if (!server.killed) {
      server.kill('SIGTERM');
      await waitForProcessExit(server);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
