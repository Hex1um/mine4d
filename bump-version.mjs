/* 缓存击穿：同步仓库内所有 index.html 的静态资源 ?v= 版本串，并校验 CHANGELOG 有对应条目。
   用法：node bump-version.mjs 1.2.0
   零依赖，不参与运行时；改动任何 html / css / js / 字体后都应执行一次。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('用法：node bump-version.mjs <x.y.z>，例如 node bump-version.mjs 1.2.0');
  process.exit(1);
}

const log = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
if (!log.includes(`## [${version}]`)) {
  console.error(`CHANGELOG.md 缺少 ## [${version}] 条目，请先写更新日志再升版`);
  process.exit(1);
}

// 根目录与各变体子目录的 index.html
const targets = ['index.html'];
for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
  if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'index.html'))) {
    targets.push(path.join(entry.name, 'index.html'));
  }
}

const re = /\?v=\d+\.\d+\.\d+/g;
let total = 0;
const bad = [];
for (const rel of targets) {
  const file = path.join(dir, rel);
  const html = fs.readFileSync(file, 'utf8');
  const found = html.match(re) || [];
  if (!found.length) continue;
  const next = html.replace(re, `?v=${version}`);
  if (next !== html) fs.writeFileSync(file, next, 'utf8');
  const versions = [...new Set((next.match(re) || []).map((s) => s.slice(3)))];
  total += found.length;
  console.log(`${rel}：${found.length} 处 → ${versions.join(', ')}`);
  if (versions.length !== 1 || versions[0] !== version) bad.push(rel);
}

if (!total) {
  console.error('没有任何 ?v= 引用，无法确认需要击穿哪些缓存');
  process.exit(1);
}
if (bad.length) {
  console.error('版本串未完全统一：' + bad.join(', '));
  process.exit(1);
}
console.log(`缓存击穿完成：${targets.length} 个页面、共 ${total} 处引用 → ?v=${version}`);
