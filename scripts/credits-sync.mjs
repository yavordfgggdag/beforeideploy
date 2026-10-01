import fs from 'node:fs';
// supabase/credits-v12.sql and credits-v13.sql are the only editable sources of the credit SQL. Each one becomes
// a generated block of schema.sql, in this order (V13 replaces the V12 functions whose rules changed).
const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const actions = JSON.stringify(JSON.parse(read('supabase/functions/_shared/pricing-actions.json')));
if (!read('supabase/credits-v12.sql').includes(`('pricing.actions','${actions}')`)) { console.error('SQL action seed differs from pricing-actions.json'); process.exit(1); }
const path = new URL('supabase/schema.sql', root);
const old = fs.readFileSync(path, 'utf8');
let next = old;
for (const [file, tag] of [['supabase/credits-v12.sql', 'V12 CREDITS'], ['supabase/credits-v13.sql', 'V13 CREDITS']]) {
  const begin = `-- BEGIN GENERATED ${tag}`;
  const end = `-- END GENERATED ${tag}`;
  const block = `${begin}\n${read(file)}\n${end}`;
  next = next.includes(begin) ? next.slice(0, next.indexOf(begin)) + block + next.slice(next.indexOf(end) + end.length) : next.replace(/\n*$/, '\n') + '\n' + block + '\n';
}
if (process.argv.includes('--check')) { if (old !== next) { console.error('Run node scripts/credits-sync.mjs'); process.exit(1); } }
else fs.writeFileSync(path, next);
const actionPath = new URL('engine/src/pricing-actions.json', root);
const actionText = JSON.stringify(JSON.parse(actions), null, 2) + '\n';
if (process.argv.includes('--check')) { if (!fs.existsSync(actionPath) || fs.readFileSync(actionPath, 'utf8') !== actionText) { console.error('Run node scripts/credits-sync.mjs (action prices)'); process.exit(1); } }
else fs.writeFileSync(actionPath, actionText);
