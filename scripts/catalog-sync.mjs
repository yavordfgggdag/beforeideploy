#!/usr/bin/env node
// The reviewed JSON is the only editable default price source. --check is run in CI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/_shared/plans-catalog.json'), 'utf8');
const catalog = JSON.parse(source);
const plans = Object.fromEntries(Object.entries(catalog.plans).map(([id, p]) => [id, { tokens: p.credits, max_active_sites: p.activeSites, fair_use_sites: p.activeSitesMax, validity_months: p.validityMonths }]));
const sqlJSON = value => JSON.stringify(value).replaceAll("'", "''");
const seed = `-- BEGIN GENERATED V12 CATALOG (scripts/catalog-sync.mjs)\ninsert into public.settings (key, value) values\n  ('plans', '${sqlJSON(plans)}'),\n  ('billing.catalog', '${sqlJSON(catalog)}')\non conflict (key) do nothing;\n-- END GENERATED V12 CATALOG`;
const schemaFile = path.join(root, 'supabase/schema.sql');
const schema = fs.readFileSync(schemaFile, 'utf8');
let nextSchema = schema.includes('-- BEGIN GENERATED V12 CATALOG') ? schema.replace(/-- BEGIN GENERATED V12 CATALOG[\s\S]*?-- END GENERATED V12 CATALOG/, () => seed) : schema.replace(/-- Default catalog \(WP4\)[\s\S]*?on conflict \(key\) do nothing;/, () => seed);
const migration = `-- Generated V12 catalog migration. Preserves existing Paddle IDs and unrelated settings.\n-- Existing subscribers retain their provider prices. Reconcile sandbox IDs in Admin before enabling sales.\ndo $$\ndeclare old_catalog jsonb; next_catalog jsonb := '${sqlJSON(catalog)}'::jsonb; old_plans jsonb; tier text; pack jsonb; old_pack jsonb; packs jsonb := '[]'::jsonb;\nbegin\n  select value into old_catalog from public.settings where key = 'billing.catalog';\n  if old_catalog->>'version' = next_catalog->>'version' then return; end if;\n  foreach tier in array array['flash','high','knight'] loop\n    next_catalog := jsonb_set(next_catalog, array['plans',tier,'paddlePriceId'], coalesce(old_catalog #> array['plans',tier,'paddlePriceId'], 'null'::jsonb));\n    next_catalog := jsonb_set(next_catalog, array['plans',tier,'yearly','paddlePriceId'], coalesce(old_catalog #> array['plans',tier,'yearly','paddlePriceId'], 'null'::jsonb));\n    next_catalog := jsonb_set(next_catalog, array['plans',tier,'needsReconciliation'], to_jsonb(coalesce(old_catalog #>> array['plans',tier,'price'],'') <> next_catalog #>> array['plans',tier,'price']));\n    next_catalog := jsonb_set(next_catalog, array['plans',tier,'yearly','needsReconciliation'], to_jsonb(coalesce(old_catalog #>> array['plans',tier,'yearly','price'],'') <> next_catalog #>> array['plans',tier,'yearly','price']));\n  end loop;\n  for pack in select * from jsonb_array_elements(next_catalog->'packs') loop\n    select value into old_pack from jsonb_array_elements(coalesce(old_catalog->'packs','[]'::jsonb)) where value->>'id' = pack->>'id' limit 1;\n    packs := packs || jsonb_build_array(pack || jsonb_build_object('paddlePriceId',coalesce(old_pack->'paddlePriceId','null'::jsonb),'needsReconciliation',coalesce(old_pack->>'price','') <> pack->>'price'));\n  end loop;\n  next_catalog := jsonb_set(next_catalog, '{packs}', packs);\n  insert into public.settings(key,value) values ('billing.catalog',coalesce(old_catalog,'{}'::jsonb) || next_catalog) on conflict(key) do update set value=excluded.value;\n  select value into old_plans from public.settings where key='plans';\n  insert into public.settings(key,value) values ('plans',coalesce(old_plans,'{}'::jsonb) || '${sqlJSON(plans)}'::jsonb) on conflict(key) do update set value=excluded.value;\nend $$;\n`;
// The owner deploy path applies schema.sql. Include the same version-guarded migration there.
const migrationBlock = `-- BEGIN GENERATED V12 CATALOG MIGRATION\n${migration}-- END GENERATED V12 CATALOG MIGRATION`;
nextSchema = nextSchema.includes('-- BEGIN GENERATED V12 CATALOG MIGRATION')
 ? nextSchema.replace(/-- BEGIN GENERATED V12 CATALOG MIGRATION[\s\S]*?-- END GENERATED V12 CATALOG MIGRATION/, () => migrationBlock)
 : nextSchema + '\n' + migrationBlock + '\n';
const outputs = new Map([
 ['engine/src/plans-data.json', source],
 ['supabase/schema.sql', nextSchema],
 ['supabase/migrations/202610010001_catalog_v12.sql', migration]
]);
let changed = false;
for (const [name, text] of outputs) {
 const file = path.join(root, name);
 if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) continue;
 changed = true;
 if (process.argv.includes('--check')) console.error(`Catalog output differs: ${name}`);
 else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
}
if (changed && process.argv.includes('--check')) process.exitCode = 1;
else console.log('Catalog copies and schema seed match the V12 source.');
