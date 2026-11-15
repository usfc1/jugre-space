import { assessVehicle } from './mission-engineering.mjs';
import { planMission } from './mission-plan.mjs';
import { importProject, MAX_PROJECT_FILE_BYTES, openProjectLibrary } from './mission-projects.mjs';

export function setupProjectLibrary({ specs, status, edit, fmt, outcomeLabels }) {
  const get = id => document.getElementById(id);
  const select = get('design-project');
  const compare = get('design-compare');
  const comparison = get('design-compare-table');
  const archived = get('design-show-archive');
  let library;

  function current() {
    library ??= openProjectLibrary(localStorage, specs);
    return library;
  }

  function selected() {
    const project = current().get(select.value);
    if (!project) throw new Error('Select a saved project');
    return project;
  }

  function refresh(preferred = select.value) {
    const previous = new Set([...compare.selectedOptions].map(option => option.value));
    const projects = current().list().filter(item => archived.checked || !item.archived);
    select.replaceChildren(new Option('Select a project', ''));
    compare.replaceChildren();
    for (const { spec, archived: inArchive } of projects) {
      const name = inArchive ? `${spec.name} · archived` : spec.name;
      select.add(new Option(name, spec.id));
      compare.add(new Option(name, spec.id, false, previous.has(spec.id)));
    }
    if (projects.some(item => item.spec.id === preferred)) select.value = preferred;
    updateActions();
    comparison.replaceChildren();
  }

  function updateActions() {
    const item = current().get(select.value);
    for (const id of ['open', 'copy', 'archive', 'delete', 'export']) get(`design-project-${id}`).disabled = !item;
    get('design-project-archive').textContent = item?.archived ? 'Restore' : 'Archive';
  }

  function handle(id, event, callback) {
    get(id).addEventListener(event, async () => {
      try { await callback(); }
      catch (error) { status.textContent = error.message; }
    });
  }

  function open(project) {
    current().select(project.spec.id);
    edit(project);
    refresh(project.spec.id);
    status.textContent = `Opened “${project.spec.name}”.`;
  }

  function add(project) {
    const saved = current().save(project);
    edit(saved);
    refresh(saved.spec.id);
    status.textContent = `Opened “${saved.spec.name}”.`;
  }

  function renderComparison() {
    const projects = [...compare.selectedOptions].map(option => current().get(option.value));
    if (projects.length < 2 || projects.length > 4) throw new Error('Select two to four projects');
    const table = document.createElement('table');
    const results = get('design-compare-results').checked;
    table.createCaption().textContent = results ? 'Flight results' : 'Mission parameters';
    const heading = table.createTHead().insertRow();
    for (const name of ['Metric', ...projects.map(item => item.spec.name)]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = name;
      heading.append(th);
    }
    const reports = results ? [] : projects.map(({ spec, selection }) => selection
      ? assessVehicle(planMission(spec), selection.carrier ?? selection.layout, specs) : null);
    const body = table.createTBody();
    const rows = results ? [
      ['Outcome', item => outcomeLabels[item.result?.status]],
      ['Objectives', item => item.result ? `${item.result.completed} / ${item.result.total}` : null],
      ['Time, s', item => fmt(item.result?.elapsedS)],
      ['Downlinked, MB', item => fmt(item.result?.downlinkedMB)],
      ['Reason', item => item.result?.reason],
    ] : [
      ['Launch mass, kg', (_, report) => fmt(report?.performance.wetMassKg)],
      ['Ideal Δv, m/s', (_, report) => fmt(report?.performance.idealMps)],
      ['Duration, h', item => fmt(item.spec.durationS == null ? null : item.spec.durationS / 3600)],
      ['Payload cost, M', (_, report) => fmt(report?.spacecraft?.costM)],
      ['Peak payload draw, W', (_, report) => fmt(report?.spacecraft?.peakW)],
      ['Science value, points', (_, report) => fmt(report?.spacecraft?.scienceValue)],
      ['Readiness', (_, report) => report?.feasibility],
    ];
    for (const [name, read] of rows) {
      const row = body.insertRow();
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = name;
      row.append(th);
      projects.forEach((item, index) => { row.insertCell().textContent = read(item, reports[index]) || '—'; });
    }
    comparison.replaceChildren(table);
  }

  handle('design-show-archive', 'change', () => refresh());
  handle('design-project', 'change', updateActions);
  handle('design-project-open', 'click', () => open(selected()));
  handle('design-project-copy', 'click', () => {
    const item = selected();
    item.spec.name = `${item.spec.name.slice(0, 90)} · copy`;
    item.spec.id = crypto.randomUUID();
    item.archived = false;
    item.result = null;
    add(item);
  });
  handle('design-project-archive', 'click', () => {
    const item = selected();
    item.archived = !item.archived;
    current().save(item, { activate: false });
    refresh();
    status.textContent = item.archived ? 'Project archived.' : 'Project restored.';
  });
  handle('design-project-delete', 'click', () => {
    const item = selected();
    if (!window.confirm(`Delete project “${item.spec.name}”?`)) return;
    const active = current().active() === item.spec.id;
    current().remove(item.spec.id);
    if (active) edit(null);
    refresh();
    status.textContent = 'Project deleted.';
  });
  handle('design-project-export', 'click', () => {
    const item = selected();
    const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${item.spec.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.jugre.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const file = get('design-project-file');
  handle('design-project-import', 'click', () => file.click());
  handle('design-project-file', 'change', async () => {
    const entry = file.files[0];
    file.value = '';
    if (!entry) return;
    if (entry.size > MAX_PROJECT_FILE_BYTES) throw new Error('Project file too large');
    const project = importProject(await entry.text(), specs);
    if (current().get(project.spec.id)) project.spec.id = crypto.randomUUID();
    const saved = current().save(project);
    if (saved.archived) archived.checked = true;
    edit(saved);
    refresh(saved.spec.id);
    status.textContent = `Imported “${saved.spec.name}”.`;
  });
  handle('design-compare-run', 'click', renderComparison);

  return { current, refresh };
}
