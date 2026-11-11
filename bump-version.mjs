/* 缓存击穿：同步 index.html 中所有静态资源 ?v= 版本串，并校验 CHANGELOG 有对应条目。
   用法：node bump-version.mjs 0.2.1
   零依赖，不参与运行时；改动任何 index.html / main.js / style.css / 字体后都应执行一次。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('用法：node bump-version.mjs <x.y.z>，例如 node bump-version.mjs 0.2.1');
  process.exit(1);
}

const indexPath = path.join(dir, 'index.html');
const logPath = path.join(dir, 'CHANGELOG.md');
const html = fs.readFileSync(indexPath, 'utf8');
const log = fs.readFileSync(logPath, 'utf8');

if (!log.includes(`## [${version}]`)) {
  console.error(`CHANGELOG.md 缺少 ## [${version}] 条目，请先写更新日志再升版`);
  process.exit(1);
}

const re = /\?v=\d+\.\d+\.\d+/g;
const found = html.match(re) || [];
if (!found.length) {
  console.error('index.html 中没有任何 ?v= 引用，无法确认需要击穿哪些缓存');
  process.exit(1);
}
const next = html.replace(re, `?v=${version}`);
if (next !== html) fs.writeFileSync(indexPath, next, 'utf8');

const versions = [...new Set((next.match(re) || []).map(s => s.slice(3)))];
console.log(`版本 ${version}：替换 ${found.length} 处引用，当前全部版本串 = ${versions.join(', ')}`);
if (versions.length !== 1 || versions[0] !== version) {
  console.error('版本串未完全统一');
  process.exit(1);
}
console.log('缓存击穿完成。');
