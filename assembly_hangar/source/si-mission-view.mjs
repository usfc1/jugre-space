import { prepareSiMission } from './si-mission.mjs';
import { createWebSiClient } from './si-web-client.mjs';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};

export function setupSiMissionView({ specs, onReview }) {
  const get = id => document.getElementById(id);
  const form = get('si-form');
  const prompt = get('si-prompt');
  const status = get('si-status');
  const result = get('si-result');
  const submit = get('si-submit');
  const panel = get('si-mode');
  let pending = null;
  let controller = null;
  const client = window.jugreDesktop?.si ?? createWebSiClient();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (controller) return;
    const text = prompt.value.trim();
    if (!text || text.length > 3000) { status.textContent = 'Enter a mission request of up to 3,000 characters.'; return; }
    pending = null;
    result.replaceChildren();
    submit.disabled = true;
    controller = new AbortController();
    const active = controller;
    try {
      panel.dataset.state = 'thinking';
      status.textContent = 'Luna is interpreting your request…';
      const proposal = await client.propose(text, { signal: active.signal });
      active.signal.throwIfAborted();
      if (!proposal || typeof proposal.message !== 'string' || !Array.isArray(proposal.assumptions)) throw new Error('The service returned an invalid proposal.');
      result.append(node('p', proposal.message, 'si-message'));
      if (proposal.assumptions.length) {
        result.append(node('h4', 'Assumptions'));
        const assumptions = node('ul');
        for (const item of proposal.assumptions) if (typeof item === 'string') assumptions.append(node('li', item));
        result.append(assumptions);
      }
      if (proposal.status !== 'ready') { panel.dataset.state = 'review'; status.textContent = proposal.status === 'clarification' ? 'More information needed.' : 'This mission is not supported yet.'; return; }
      status.textContent = 'Running engineering checks…';
      panel.dataset.state = 'checking';
      const prepared = await prepareSiMission(proposal.mission, specs, { signal: active.signal,
        progress: count => { status.textContent = `Checking launcher configurations: ${count}`; } });
      active.signal.throwIfAborted();
      pending = prepared;
      const { spec, plan, candidate } = prepared;
      result.append(node('h4', candidate?.ready ? 'Engineering checks passed' : 'Engineering review required'));
      const summary = node('div', '', 'si-summary');
      for (const [label, value] of [['Destination', spec.destination], ['Objective', spec.type], ['Crew', String(spec.crewCount)],
        ['Extra payload', `${spec.payloadMassKg} kg`], ['Earth return', spec.returnRequired ? 'Required' : 'Not required'],
        ['Launcher', candidate?.vehicle?.name ?? 'Not selected']]) {
        const row = node('div'); row.append(node('span', label), node('strong', value)); summary.append(row);
      }
      result.append(summary);
      const issues = [...plan.unavailable, ...(candidate?.checks ?? []).filter(check => check.status === 'FAIL').map(check => `${check.label}: ${check.reason}`)];
      if (issues.length || !candidate) {
        result.append(node('h4', 'Items to resolve'));
        const list = node('ul');
        for (const issue of (issues.length ? issues : ['No compatible launcher was found.'])) list.append(node('li', issue));
        result.append(list);
      }
      const review = node('button', 'Review in Engineering →', 'standard-primary');
      review.type = 'button';
      review.addEventListener('click', () => { if (pending) onReview(pending); });
      result.append(review);
      status.textContent = candidate?.ready ? 'Proposal checked by the mission engine.' : 'Review the limitations before continuing.';
      panel.dataset.state = candidate?.ready ? 'complete' : 'review';
    } catch (error) { if (!active.signal.aborted) { panel.dataset.state = 'error'; status.textContent = error.message || 'SI could not complete the request.'; } }
    finally { if (controller === active) { controller = null; submit.disabled = false; } }
  });

  return { cancel() { controller?.abort(); controller = null; submit.disabled = false; panel.dataset.state = 'idle'; } };
}
