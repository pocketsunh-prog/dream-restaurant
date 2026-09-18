// tools/_fit-check.mjs — 用 headless Chrome 跑 tools/_fit-probe.html 並印出結果。
// 檢查邏輯畫布在各種視窗大小下是否完整落在 #stage 內（不會被裁掉）。
// 用法: node tools/_fit-check.mjs  （需要 http://127.0.0.1:8080 的靜態伺服器）import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const dir = mkdtempSync(join(tmpdir(), 'dsh-fit-'));

const args = [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--timeout=120000', '--virtual-time-budget=60000',
  `--user-data-dir=${join(dir, 'profile')}`,
  '--window-size=1400,900',
  '--dump-dom', `${BASE}/tools/_fit-probe.html`,
];
const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const chunks = [];
p.stdout.on('data', (d) => chunks.push(d));
p.stderr.on('data', () => {});
p.on('close', () => {
  const html = Buffer.concat(chunks).toString('utf8');
  if (process.env.RAW) {
    console.log(html.slice(0, 3000));
    return;
  }
  const m = html.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/i);
  const body = m
    ? m[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    : '(no output)';
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  console.log(`title="${title}" bytes=${html.length}`);
  console.log(body.trim());
});
