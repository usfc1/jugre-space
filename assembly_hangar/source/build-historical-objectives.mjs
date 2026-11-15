import { readFile, writeFile } from 'node:fs/promises';
const document = await readFile(new URL('../MANUAL_CONTROL_MISSIONS.md', import.meta.url), 'utf8');
const text = document.slice(document.indexOf('ПРИЛОЖЕНИЕ Б —'), document.indexOf('## Аудит текущего состояния'));
const ids = ['apollo_11', 'artemis_ii', 'mars_2020', 'mars_science_laboratory', 'dart', 'voyager_2', 'iss_resupply'];
const catalog = {};
for (let i = 0; i < ids.length; i++) {
  const section = text.split(new RegExp(`Б${i + 1}\\. `))[1]?.split(new RegExp(`Б${i + 2}\\. `))[0];
  if (!section) throw new Error('Приложение Б отсутствует');
  let stage = 1, counter = 0;
  const objectives = [], context = section.split('\n').find(l => l.startsWith('Контекст:'))?.slice(9).trim();
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    const match = line.match(/^Этап(?:ы)? (\d+)/); if (match) { stage = Number(match[1]); counter = 0; }
    const task = line.match(/^\[([ОДБ])\] (.*)/); if (!task) continue;
    const id = `${i + 1}-${stage}-${++counter}`;
    if (task[2].includes('Это событие, а не задание')) continue;
    objectives.push({ id, stage, name: task[2], tier: { О: 'primary', Д: 'optional', Б: 'bonus' }[task[1]],
      future: task[2].startsWith('Будущее:') });
  }
  catalog[ids[i]] = { context, objectives };
}
await writeFile(new URL('./historical-objective-catalog.mjs', import.meta.url), '// Generated from Appendix B by build-historical-objectives.mjs.\nexport const historicalCatalog = ' + JSON.stringify(catalog, null, 2) + ';\n');
for (const [id, data] of Object.entries(catalog)) console.log(id, data.objectives.map(o => o.id + ': ' + o.name.slice(0, 72)).join('\n'));
