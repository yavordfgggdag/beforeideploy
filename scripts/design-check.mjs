import fs from 'node:fs';
import path from 'node:path';
const root = 'App/Sources/BeforeIDeploy';
const errors = [];
// Warnings only (they do not fail the build yet): the number printed is the current baseline to drive down.
// `--verbose` lists every site.
const warnings = { padding: [], plain: [] };
const verbose = process.argv.includes('--verbose');
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'DesignSystem') walk(file); continue; }
    if (!file.endsWith('.swift')) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/Color\(hex:|\.system\(size:|cornerRadius:\s*\d|\.shadow\(/.test(line)) errors.push(`${file}:${i + 1}: use DesignSystem tokens`);
      if (/preferredColorScheme\(\.dark\)/.test(line)) errors.push(`${file}:${i + 1}: forced appearance`);
      // `.padding(12)`, `.padding(.horizontal, 7)`, `.padding([.top, .bottom], 4)` → use Space.*
      for (const _ of code.matchAll(/\.padding\(\s*(?:(?:\.\w+|\[[^\]]*\])\s*,\s*)?\d/g)) warnings.padding.push(`${file}:${i + 1}`);
      // plain buttons have no focus ring → use .bidButton / IconButton
      for (const _ of code.matchAll(/\.buttonStyle\(\s*\.plain\s*\)/g)) warnings.plain.push(`${file}:${i + 1}`);
    });
  }
}
walk(root);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Design System: all screens use typography, colour, radius and elevation tokens.');
console.log(`Warnings (baseline, not failing) outside DesignSystem/: ${warnings.padding.length} literal .padding(<number>) — use Space.*; ` +
  `${warnings.plain.length} .buttonStyle(.plain) — use .bidButton or IconButton.` + (verbose ? '' : ' Run with --verbose to list them.'));
if (verbose) {
  for (const [kind, list] of Object.entries(warnings)) for (const at of list) console.log(`warning: ${at}: ${kind === 'padding' ? 'literal padding' : '.buttonStyle(.plain)'}`);
}
