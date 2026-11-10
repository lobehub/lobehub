const required = document.getElementById('required');
const title = document.getElementById('title');
const description = document.getElementById('description');
const status = document.getElementById('status');
const amount = document.getElementById('amount');
const progress = document.getElementById('progress');
const actions = document.getElementById('actions');
const retry = document.getElementById('retry');
const quit = document.getElementById('quit');
let previousPhase;
// The window stays hidden until the check outlasts its delay; play the draw-in when it appears.
const enter = () => {
  if (document.visibilityState !== 'visible') return;
  document.body.classList.add('enter');
  document.removeEventListener('visibilitychange', enter);
};
document.addEventListener('visibilitychange', enter);
enter();
window.updateWindow.onState((state) => {
  const t = state.strings;
  const error = state.phase === 'error';
  document.documentElement.lang = state.language;
  document.body.dataset.phase = state.phase;
  document.querySelector('main').setAttribute('aria-busy', String(!error));
  required.hidden = state.reason !== 'required';
  title.textContent = t.requiredTitle;
  description.textContent = t.requiredDescription;
  status.textContent = t[state.phase];
  amount.textContent = '';
  progress.removeAttribute('value');
  progress.setAttribute('aria-label', t[state.phase] || t.downloading);
  progress.hidden = error;
  actions.hidden = !error;
  retry.textContent = t.retry;
  quit.textContent = t.quit;
  if (state.phase === 'downloading') {
    const percent =
      state.percent ?? (state.total > 0 ? (state.received / state.total) * 100 : undefined);
    if (Number.isFinite(percent)) {
      progress.max = 100;
      progress.value = Math.max(0, Math.min(100, percent));
      amount.textContent = `${Math.floor(progress.value)}%`;
    } else if (state.received > 0) {
      amount.textContent = `${(state.received / 1024 / 1024).toFixed(1)} MB`;
    }
  }
  if (error && previousPhase !== 'error') retry.focus();
  previousPhase = state.phase;
});
retry.addEventListener('click', () => window.updateWindow.retry());
quit.addEventListener('click', () => window.updateWindow.quit());
