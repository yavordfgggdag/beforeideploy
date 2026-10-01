import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('supabase/credits-v12.sql',root),'utf8');
const actions = JSON.stringify(JSON.parse(fs.readFileSync(new URL('supabase/functions/_shared/pricing-actions.json',root),'utf8')));
if (!source.includes(`('pricing.actions','${actions}')`)) { console.error('SQL action seed differs from pricing-actions.json'); process.exit(1); }
const path = new URL('supabase/schema.sql',root);
const old = fs.readFileSync(path,'utf8');
const begin = '-- BEGIN GENERATED V12 CREDITS';
const end = '-- END GENERATED V12 CREDITS';
const block = `${begin}\n${source}\n${end}`;
const next = old.includes(begin) ? old.slice(0,old.indexOf(begin))+block+old.slice(old.indexOf(end)+end.length) : old+'\n'+block+'\n';
if(process.argv.includes('--check')) { if(old!==next) { console.error('Run node scripts/credits-sync.mjs'); process.exit(1); } }
else fs.writeFileSync(path,next);
const actionPath = new URL('engine/src/pricing-actions.json',root);
const actionText = JSON.stringify(JSON.parse(actions),null,2)+'\n';
if(process.argv.includes('--check')) { if(!fs.existsSync(actionPath)||fs.readFileSync(actionPath,'utf8')!==actionText) { console.error('Run node scripts/credits-sync.mjs (action prices)'); process.exit(1); } }
else fs.writeFileSync(actionPath,actionText);
