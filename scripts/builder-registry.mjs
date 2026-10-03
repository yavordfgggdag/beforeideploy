#!/usr/bin/env node
// Builder requirements register (Phase 0). Reads the audit (docs/builder/source/lovable-base44-odit-bg.md,
// 260 normalised rows F001–F260 in 20 groups) and merges docs/builder/assessment.json (what Before I Deploy
// has, per group and per row, with test evidence) into docs/builder/registry.json and REGISTRY.md.
//   node scripts/builder-registry.mjs          rebuild registry.json + REGISTRY.md
//   node scripts/builder-registry.mjs --check  fail if a row is "ready" without test evidence, or the files are stale
// A row is never "ready" because a button exists: only evidence (a test name or a recorded manual check) counts.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'docs', 'builder');
const SRC = path.join(DIR, 'source', 'lovable-base44-odit-bg.md');
const check = process.argv.includes('--check');

const STATUS_BID = ['не е оценено', 'за изграждане', 'частично', 'налично и тествано', 'неприложим контекст'];
const phaseOf = { 1: 1, 2: 2, 3: 2, 4: 3, 5: 3, 6: 6, 7: 4, 8: 4, 9: 4, 10: 4, 11: 5, 12: 5, 13: 5, 14: 5, 15: 6, 16: 7, 17: 7, 18: 7, 19: 2, 20: 0 };
const acceptance = {
  1: 'Нов проект се отваря с работещ preview; копието има ясно описани данни и зависимости',
  2: 'Обсъждането не променя проекта; планът е редактируем; Stop показва вече извършеното',
  3: 'Всеки път има наличност, права и отчет на разхода; fallback е видим',
  4: 'Предвидимите редакции се прилагат директно; undo връща точната предходна стойност',
  5: 'Промяна на споделен компонент има preview на засегнатите страници; импортът показва неподдържаното',
  6: 'Двупосочната промяна се проследява; конфликт не презаписва мълчаливо работа',
  7: 'Тестова операция не променя production; експортът и възстановяването са проверени с примерни записи',
  8: 'Права на app user и editor са отделни; отказът на достъп се доказва с втори тестов потребител',
  9: 'Secret не влиза в клиентски пакет; отказаните действия се блокират и се записват',
  10: 'Всеки ресурс има лимит, грешки и logs; частен файл отказва достъп без право',
  11: 'Свързване/откачане работят; sandbox плащане и повторен webhook не създават дублиране',
  12: 'Паметта е изолирана по потребител; инструмент не получава повече права от разрешеното',
  13: 'Неуспешна стъпка се проследява; повторение не дублира необратим страничен ефект',
  14: 'Трите MCP посоки имат отделни разрешения, отмяна на достъпа и лимити',
  15: 'Публикуваният адрес обслужва избраната версия; backend и data промени са изрично описани',
  16: 'Контролирано събитие и грешка се намират по време/версия; записването има ясни настройки',
  17: 'Проверяват се реалният публикуван URL и индексирането; рекламен разход не се стартира без потвърждение',
  18: 'Viewer не може да редактира; споделянето показва точната аудитория и обхват',
  19: 'Разходът се отчита към конкретно действие; след твърд лимит нова платена работа не започва',
  20: 'Контекст: не е изискване за реализация',
};

function parse() {
  const text = fs.readFileSync(SRC, 'utf8');
  const rows = [];
  let group = 0;
  let groupTitle = '';
  for (const line of text.split('\n')) {
    const g = /^### (\d\d)\. (.+)$/.exec(line);
    if (g) { group = Number(g[1]); groupTitle = g[2].trim(); continue; }
    const m = /^\| <a id="f\d+"><\/a>(F\d{3}) \| (.*)$/.exec(line);
    if (!m || !group) continue;
    const cells = m[2].split(/ \| /);
    const prod = /^\*\*(.+?)\*\* — (.*)$/.exec(cells[0] || '');
    rows.push({
      id: m[1],
      group,
      groupTitle,
      product: prod ? prod[1] : '',
      function: (prod ? prod[2] : cells[0] || '').trim(),
      docStatus: (cells[1] || '').replace(/\*/g, '').trim(),
      productStatus: (cells[2] || '').trim(),
      evidence: (cells[3] || '').replace(/\|\s*$/, '').trim(),
    });
  }
  return rows;
}

const rows = parse();
if (rows.length !== 260) { console.error(`expected 260 rows, found ${rows.length}`); process.exit(1); }
const assess = JSON.parse(fs.readFileSync(path.join(DIR, 'assessment.json'), 'utf8'));
const errors = [];
const out = rows.map((r) => {
  const g = assess.groups[String(r.group)] || {};
  const o = assess.rows?.[r.id] || {};
  const context = r.group === 20 || o.status === 'неприложим контекст';
  const status = o.status || (context ? 'неприложим контекст' : 'не е оценено');
  if (!STATUS_BID.includes(status)) errors.push(`${r.id}: unknown status "${status}"`);
  if (status === 'налично и тествано' && !(o.evidence && o.evidence.length)) errors.push(`${r.id}: "налично и тествано" without test evidence`);
  if (context && !(o.reason || g.contextReason)) errors.push(`${r.id}: context row needs a reason`);
  return {
    ...r,
    phase: o.phase ?? phaseOf[r.group],
    exists: o.exists ?? g.exists ?? '',
    missing: o.missing ?? g.missing ?? '',
    depends: o.depends ?? g.depends ?? '',
    acceptance: o.acceptance ?? acceptance[r.group],
    bidStatus: status,
    evidenceBid: o.evidence ?? [],
    reason: o.reason ?? (context ? g.contextReason : ''),
  };
});
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const count = (f) => out.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
const registry = { schema: 'bid.builder-registry/1', source: 'docs/builder/source/lovable-base44-odit-bg.md', rows: out };
const json = JSON.stringify(registry, null, 1) + '\n';

let md = `# Регистър на изискванията за билдера

Генериран от \`scripts/builder-registry.mjs\` от одита (\`source/lovable-base44-odit-bg.md\`) и оценката в \`assessment.json\`. Не го редактирай на ръка.

Реализационният статус започва като **не е оценено**. „Налично и тествано“ изисква име на тест или записана проверка; бутон или компонент не е доказателство. „Потвърдено по документация“ не означава „тествано в продукта“. Групи 20 и исторически, промоционални и субективни твърдения са контекст, не функции за реализация.

## Обобщение

| Реализационен статус | Редове |\n|---|---:|\n`;
const bySt = count((r) => r.bidStatus);
for (const s of STATUS_BID) md += `| ${s} | ${bySt[s] || 0} |\n`;
md += `| **Общо** | **${out.length}** |\n\n## По групи и фази\n\n| Гр. | Група | Фаза | Редове | Налично и тествано | Частично | За изграждане | Не е оценено | Контекст |\n|---|---|---|---:|---:|---:|---:|---:|---:|\n`;
const groups = [...new Set(out.map((r) => r.group))];
for (const gid of groups) {
  const rs = out.filter((r) => r.group === gid);
  const c = (s) => rs.filter((r) => r.bidStatus === s).length;
  md += `| ${String(gid).padStart(2, '0')} | ${rs[0].groupTitle} | ${phaseOf[gid]} | ${rs.length} | ${c('налично и тествано')} | ${c('частично')} | ${c('за изграждане')} | ${c('не е оценено')} | ${c('неприложим контекст')} |\n`;
}
md += '\n## Какво вече има и какво липсва, по групи\n\n';
for (const gid of groups) {
  const g = assess.groups[String(gid)] || {};
  md += `### ${String(gid).padStart(2, '0')}. ${out.find((r) => r.group === gid).groupTitle} (фаза ${phaseOf[gid]})\n\n- **Има:** ${g.exists || '—'}\n- **Липсва:** ${g.missing || '—'}\n- **Зависимости:** ${g.depends || '—'}\n- **Приемане:** ${acceptance[gid]}\n${g.evidence?.length ? `- **Доказателство от тест:** ${g.evidence.join('; ')}\n` : ''}\n`;
}
md += '## Редове\n\n| ID | Продукт | Функция | Документация | Фаза | Статус в Before I Deploy |\n|---|---|---|---|---:|---|\n';
for (const r of out) md += `| ${r.id} | ${r.product} | ${r.function.replace(/\|/g, '/')} | ${r.docStatus} | ${r.phase} | ${r.bidStatus} |\n`;

if (check) {
  const same = fs.existsSync(path.join(DIR, 'registry.json')) && fs.readFileSync(path.join(DIR, 'registry.json'), 'utf8') === json && fs.readFileSync(path.join(DIR, 'REGISTRY.md'), 'utf8') === md;
  if (!same) { console.error('registry is stale: run node scripts/builder-registry.mjs'); process.exit(1); }
  console.log(`✅ builder registry ok (${out.length} rows)`);
} else {
  fs.writeFileSync(path.join(DIR, 'registry.json'), json);
  fs.writeFileSync(path.join(DIR, 'REGISTRY.md'), md);
  console.log(`wrote registry.json + REGISTRY.md: ${out.length} rows;`, JSON.stringify(bySt));
}
