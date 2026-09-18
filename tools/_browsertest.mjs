// tools/_browsertest.mjs — 用 headless Chrome 跑 tools/*.html 的測試頁，抓出 <pre id="out"> / #summary 的內容。
// 用法: node tools/_browsertest.mjs [page1 page2 ...]
//   預設跑 ui-test.html material-test.html weather-clip-test.html night-crisp-test.html
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const pages = process.argv.slice(2);
const PAGES = pages.length ? pages : ['ui-test.html', 'material-test.html', 'weather-clip-test.html', 'night-crisp-test.html'];

function runOne(page) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-2d-'));
    const outFile = join(dir, 'out.html');
    const errFile = join(dir, 'err.txt');
    const url = `${BASE}/tools/${page}`;
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--timeout=60000',
      '--virtual-time-budget=20000', `--user-data-dir=${join(dir, 'profile')}`,
      '--window-size=1400,900',
      '--dump-dom', url,
    ];
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let errLen = 0;
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { errLen += d.length; });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* ignore */ } }, 90000);
    p.on('close', (code) => {
      clearTimeout(timer);
      const html = Buffer.concat(chunks).toString('utf8');
      const grab = (id) => {
        const m = html.match(new RegExp(`<pre id="${id}"[^>]*>([\\s\\S]*?)</pre>`, 'i'));
        return m ? decode(m[1]) : null;
      };
      const grabDiv = (id) => {
        const m = html.match(new RegExp(`<div id="${id}"[^>]*>([\\s\\S]*?)</div>\\s*<div id="log">`, 'i'));
        return m ? decode(m[1]) : null;
      };
      const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
      resolve({ page, code, out: grab('out'), summary: grabDiv('summary'), title: decode(title), errLen, bytes: html.length });
    });
  });
}

function decode(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

for (const page of PAGES) {
  const r = await runOne(page);
  const body = r.out || r.summary || '(no output)';
  const lines = body.split('\n').filter((l) => l.trim());
  const pass = lines.filter((l) => /PASS|通過|OK/.test(l)).length;
  const fail = lines.filter((l) => /FAIL|失敗|ERROR/.test(l)).length;
  console.log(`\n===== ${r.page} (exit ${r.code}) title="${r.title}" lines=${lines.length} PASS=${pass} FAIL=${fail} =====`);
  console.log(body);
}
