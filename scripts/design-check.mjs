import fs from 'node:fs';
import path from 'node:path';
const root = 'App/Sources/BeforeIDeploy';
const errors = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'DesignSystem') walk(file); continue; }
    if (!file.endsWith('.swift')) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/Color\(hex:|\.system\(size:|cornerRadius:\s*\d|\.shadow\(/.test(line)) errors.push(`${file}:${i + 1}: use DesignSystem tokens`);
      if (/preferredColorScheme\(\.dark\)/.test(line)) errors.push(`${file}:${i + 1}: forced appearance`);
    });
  }
}
walk(root);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Design System: all screens use typography, colour, radius and elevation tokens.');
