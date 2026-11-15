/* UMSBC Tabling Scheduler — UI. The scheduling itself runs in worker.js (Python via Pyodide). */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SITE = 'UMSBC Tabling Scheduler';
  const MAX_FILE_BYTES = 2 * 1024 * 1024;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) node.append(child instanceof Node ? child : document.createTextNode(child));
    return node;
  }

  /* ------------------------------------------------------------------ routing */
  const routes = ['generate', 'tutorial', 'formats', 'faq'];
  let firstRoute = true;

  function route() {
    const [, name = 'generate', sub] = (location.hash || '').match(/^#\/([^/]*)\/?(.*)$/) || [];
    const current = routes.includes(name) ? name : 'generate';
    for (const view of $$('.view')) view.hidden = view.id !== `view-${current}`;
    for (const link of $$('#main-nav a')) {
      if (link.dataset.route === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const view = $(`#view-${current}`);
    document.title = `${view.dataset.title} · ${SITE}`;

    const target = sub ? document.getElementById(sub) : null;
    if (target) {
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    } else {
      window.scrollTo(0, 0);
    }
    if (!firstRoute) (target || $('h1', view)).focus({ preventScroll: true });
    firstRoute = false;
  }
  window.addEventListener('hashchange', route);

  // Highlight the tutorial step being read.
  if ('IntersectionObserver' in window) {
    const links = new Map($$('.toc a').map((a) => [a.getAttribute('href').split('/').pop(), a]));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.classList.remove('active'));
        links.get(entry.target.id)?.classList.add('active');
      }
    }, { rootMargin: '-20% 0px -70% 0px' });
    $$('.doc-step').forEach((section) => observer.observe(section));
  }

  /* ------------------------------------------------------------------ engine (worker) */
  const engine = { state: 'loading', worker: null };
  const engineBox = $('#engine');
  const engineText = $('#engine-text');
  const retryBtn = $('#engine-retry');
  let pending = null; // { resolve, reject }
  let nextId = 1;

  function setEngine(state, message) {
    engine.state = state;
    engineBox.className = `engine${state === 'ready' ? ' ready' : state === 'failed' ? ' failed' : ''}`;
    engineText.textContent = message;
    retryBtn.hidden = state !== 'failed';
    updateGenerateState();
  }

  function startEngine() {
    engine.worker?.terminate();
    setEngine('loading', 'Preparing the scheduler… the first visit takes a little while.');
    const worker = new Worker('worker.js');
    engine.worker = worker;
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') {
        setEngine('loading', `Preparing the scheduler (step ${data.step} of 4): ${data.message}`);
      } else if (data.type === 'ready') {
        setEngine('ready', 'Scheduler ready. Your files never leave this page.');
      } else if (data.type === 'result') {
        pending?.resolve(data.json);
        pending = null;
      } else if (data.type === 'error') {
        if (data.phase === 'init') {
          setEngine('failed', `Couldn't load the scheduler: ${data.message}. Check your connection and try again.`);
        } else {
          pending?.reject(new Error(data.message));
          pending = null;
        }
      }
    };
    worker.onerror = (event) => setEngine('failed', `The scheduler stopped unexpectedly (${event.message || 'unknown error'}).`);
    worker.postMessage({ type: 'init' });
  }
  retryBtn.addEventListener('click', startEngine);

  function runInEngine(options) {
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      engine.worker.postMessage({ type: 'run', id: nextId++, options });
    });
  }

  /* ------------------------------------------------------------------ files */
  const files = { availability: null, past: null };

  function countRows(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    return Math.max(0, lines.length - 1);
  }

  function showError(id, message) {
    const box = $(`#err-${id}`);
    box.textContent = message || '';
    box.hidden = !message;
  }

  function setFile(kind, name, text) {
    files[kind] = { name, text };
    const chip = $(`#chip-${kind}`);
    $('.file-name', chip).textContent = name;
    $('.file-meta', chip).textContent = `${countRows(text)} rows`;
    chip.hidden = false;
    $(`#box-${kind}`).classList.add('has-file');
    showError(kind, '');
    updateGenerateState();
  }

  function clearFile(kind) {
    files[kind] = null;
    $(`#chip-${kind}`).hidden = true;
    $(`#box-${kind}`).classList.remove('has-file');
    $(`#file-${kind === 'availability' ? 'availability' : 'past'}`).value = '';
    updateGenerateState();
    $(`#file-${kind === 'availability' ? 'availability' : 'past'}`).focus();
  }

  async function onFile(kind, input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showError(kind, `That file is ${(file.size / 1048576).toFixed(1)} MB. Expected a small CSV export, so check you picked the right file.`);
      input.value = '';
      return;
    }
    if (!/\.csv$/i.test(file.name) && !/csv|text/.test(file.type)) {
      showError(kind, 'That doesn\'t look like a CSV file. In Google Sheets use File → Download → Comma-separated values (.csv).');
      input.value = '';
      return;
    }
    setFile(kind, file.name, await file.text());
  }

  $('#file-availability').addEventListener('change', (e) => onFile('availability', e.target));
  $('#file-past').addEventListener('change', (e) => onFile('past', e.target));
  $$('[data-clear]').forEach((btn) => btn.addEventListener('click', () => clearFile(btn.dataset.clear)));

  $('#use-example').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const [a, p] = await Promise.all(['examples/example_availability.csv', 'examples/example_past_shifts.csv']
        .map((url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.text(); })));
      setFile('availability', 'example_availability.csv', a);
      setFile('past', 'example_past_shifts.csv', p);
    } catch {
      showError('availability', 'Couldn\'t load the example files. Check your connection and try again.');
    } finally {
      button.disabled = false;
    }
  });

  /* ------------------------------------------------------------------ settings */
  const startInput = $('#start-date');
  const weeksInput = $('#num-weeks');
  const staff = { seniors: $('#n-seniors'), board: $('#n-board'), oncall: $('#n-oncall') };

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const mondayOf = (d) => { const c = new Date(d); c.setDate(c.getDate() - ((c.getDay() + 6) % 7)); return c; };
  const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const longDate = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // Default: the coming Monday.
  startInput.value = iso(addDays(mondayOf(new Date()), 7));

  $$('[data-stepper]').forEach((box) => {
    const input = $('input', box);
    $$('button', box).forEach((btn) => btn.addEventListener('click', () => {
      const min = Number(input.min), max = Number(input.max);
      input.value = Math.min(max, Math.max(min, (Number(input.value) || 0) + Number(btn.dataset.step)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }));
  });

  function staffing() {
    return { numSeniors: Number(staff.seniors.value), numBoard: Number(staff.board.value), numOncall: Number(staff.oncall.value) };
  }

  function updateStaffUI() {
    const { numSeniors, numBoard, numOncall } = staffing();
    const key = `${numSeniors},${numBoard},${numOncall}`;
    $$('#presets [data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === key)));
    const parts = [];
    if (numSeniors) parts.push(`${numSeniors} SBM${numSeniors > 1 ? 's' : ''}`);
    if (numBoard) parts.push(`${numBoard} BM${numBoard > 1 ? 's' : ''}`);
    if (numOncall) parts.push(`${numOncall} On-Call`);
    const total = numSeniors + numBoard + numOncall;
    $('#staff-summary').textContent = total
      ? `Each shift: ${parts.join(' + ')} = ${total} ${total === 1 ? 'person' : 'people'} · ${total * 8} spots a week.`
      : 'Choose at least one person per shift.';
    showError('staff', '');
  }

  $$('#presets [data-preset]').forEach((btn) => btn.addEventListener('click', () => {
    const [s, b, o] = btn.dataset.preset.split(',');
    staff.seniors.value = s; staff.board.value = b; staff.oncall.value = o;
    updateStaffUI();
  }));
  Object.values(staff).forEach((input) => input.addEventListener('input', updateStaffUI));
  updateStaffUI();

  // Skipped weeks
  const skipped = new Set();
  const skipInput = $('#skip-date');

  function renderSkipped() {
    const list = $('#skip-list');
    list.replaceChildren(...[...skipped].sort().map((monday) => {
      const label = `Week of ${longDate(parseISO(monday))}`;
      return el('li', {}, label,
        el('button', { type: 'button', 'aria-label': `Remove ${label}`, text: '×' }));
    }));
    $$('#skip-list li').forEach((li, i) => {
      const monday = [...skipped].sort()[i];
      $('button', li).addEventListener('click', () => { skipped.delete(monday); renderSkipped(); $('#skip-add').focus(); });
    });
  }

  $('#skip-add').addEventListener('click', () => {
    if (!skipInput.value) { showError('skip', 'Pick a date in the week you want to skip, then press Add week.'); skipInput.focus(); return; }
    showError('skip', '');
    skipped.add(iso(mondayOf(parseISO(skipInput.value))));
    skipInput.value = '';
    renderSkipped();
  });

  /* ------------------------------------------------------------------ generate */
  const generateBtn = $('#generate');
  const generateHelp = $('#generate-help');
  let busy = false;

  function updateGenerateState() {
    const ready = engine.state === 'ready' && files.availability && !busy;
    generateBtn.disabled = !ready;
    if (busy) generateHelp.textContent = 'Building your schedule…';
    else if (!files.availability) generateHelp.textContent = 'Upload the sign-up responses to continue.';
    else if (engine.state !== 'ready') generateHelp.textContent = engine.state === 'failed'
      ? 'The scheduler didn\'t load. Use "Try again" at the top of the page.'
      : 'Waiting for the scheduler to finish loading…';
    else generateHelp.textContent = 'Ready when you are.';
  }

  function validate() {
    let ok = true;
    const fail = (id, input, message) => { showError(id, message); input?.setAttribute('aria-invalid', 'true'); if (ok) input?.focus(); ok = false; };
    [startInput, weeksInput].forEach((i) => i.removeAttribute('aria-invalid'));
    showError('start', ''); showError('weeks', ''); showError('staff', '');

    if (!startInput.value) fail('start', startInput, 'Choose the first week of the schedule.');
    const weeks = Number(weeksInput.value);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 40) fail('weeks', weeksInput, 'Enter a whole number of weeks between 1 and 40.');
    const s = staffing();
    const values = Object.values(s);
    if (values.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) fail('staff', staff.seniors, 'Each role can have between 0 and 6 people per shift.');
    else if (values.reduce((a, b) => a + b, 0) === 0) fail('staff', staff.seniors, 'Choose at least one person per shift.');
    return ok;
  }

  let lastOptions = null;
  let lastResult = null;

  async function generate() {
    if (busy || !files.availability) return;
    if (!validate()) return;
    lastOptions = {
      availability: files.availability.text,
      pastShifts: files.past ? files.past.text : '',
      startDate: startInput.value,
      numWeeks: Number(weeksInput.value),
      ...staffing(),
      skipDates: [...skipped].sort(),
    };
    await execute();
  }

  async function execute() {
    busy = true;
    generateBtn.setAttribute('aria-busy', 'true');
    $('.btn-label', generateBtn).textContent = 'Scheduling…';
    $('#reshuffle').disabled = true;
    updateGenerateState();
    try {
      const result = JSON.parse(await runInEngine(lastOptions));
      lastResult = result.error ? null : result;
      renderResults(result);
    } catch (err) {
      renderResults({ error: `Something went wrong while scheduling: ${err.message}` });
    } finally {
      busy = false;
      generateBtn.removeAttribute('aria-busy');
      $('.btn-label', generateBtn).textContent = 'Generate schedule';
      $('#reshuffle').disabled = false;
      updateGenerateState();
    }
  }

  $('#form').addEventListener('submit', (e) => { e.preventDefault(); generate(); });
  $('#reshuffle').addEventListener('click', () => { if (lastOptions) execute(); });

  /* ------------------------------------------------------------------ results */
  const icon = (paths) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = paths;
    return svg;
  };
  const ICON_OK = '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>';
  const ICON_WARN = '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>';

  function renderResults(result) {
    const section = $('#results');
    section.hidden = false;
    const banner = $('#banner');
    const hasData = !result.error;
    $('#download').hidden = !hasData;
    $('#reshuffle').hidden = !hasData;
    $('.result-actions .help', section).hidden = !hasData;
    $('#week-tabs').replaceChildren();
    $('#week-panel').replaceChildren();
    $('#skipped-note').textContent = '';
    $('#warnings').replaceChildren();
    $('#people-details').hidden = !hasData;
    $('#log').closest('details').hidden = !result.log;
    $('#log').textContent = result.log || '';

    if (!hasData) {
      banner.className = 'banner err';
      banner.replaceChildren(icon(ICON_WARN), el('div', { role: 'alert' }, result.error));
      focusResults();
      return;
    }

    const scheduled = result.weeks.filter((w) => !w.skipped);
    const total = scheduled.length * 8;
    const full = result.unassigned === 0;
    banner.className = `banner ${full ? 'ok' : 'warn'}`;
    banner.replaceChildren(
      icon(full ? ICON_OK : ICON_WARN),
      el('div', {},
        full
          ? `Schedule ready: ${scheduled.length} ${scheduled.length === 1 ? 'week' : 'weeks'}, all ${total} shifts fully staffed.`
          : `Schedule ready: ${scheduled.length} ${scheduled.length === 1 ? 'week' : 'weeks'}, but ${result.unassigned} of ${total} shifts have unfilled spots (marked "Unfilled"). Try Shuffle again, fewer people per shift, or more availability.`));

    for (const message of result.warnings) $('#warnings').append(el('p', { class: 'alert', role: 'status' }, message));

    renderWeekTabs(result, scheduled);
    const skippedWeeks = result.weeks.filter((w) => w.skipped);
    if (skippedWeeks.length) {
      $('#skipped-note').textContent = `Skipped: ${skippedWeeks.map((w) => `Week ${w.num} (week of ${longDate(parseISO(w.start))})`).join(', ')}.`;
    }
    renderPeople(result.people);
    focusResults();
  }

  function focusResults() {
    const heading = $('#results-title');
    heading.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    heading.focus({ preventScroll: true });
  }

  function renderWeekTabs(result, scheduled) {
    const tabs = $('#week-tabs');
    const buttons = scheduled.map((week, i) => {
      const monday = parseISO(week.start);
      const btn = el('button', {
        type: 'button', role: 'tab', id: `tab-w${week.num}`, 'aria-controls': 'week-panel',
        'aria-selected': 'false', tabindex: '-1',
      }, `Week ${week.num}`, el('small', {}, `${md(monday)} – ${md(addDays(monday, 6))}`));
      btn.addEventListener('click', () => select(i));
      return btn;
    });
    tabs.replaceChildren(...buttons);

    function select(i, focus = false) {
      buttons.forEach((b, j) => { b.setAttribute('aria-selected', String(i === j)); b.tabIndex = i === j ? 0 : -1; });
      $('#week-panel').setAttribute('aria-labelledby', buttons[i].id);
      $('#week-panel').replaceChildren(weekTable(scheduled[i], result));
      if (focus) buttons[i].focus();
    }
    tabs.onkeydown = (e) => {
      const i = buttons.findIndex((b) => b.getAttribute('aria-selected') === 'true');
      const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (move) { e.preventDefault(); select((i + move + buttons.length) % buttons.length, true); }
      if (e.key === 'Home') { e.preventDefault(); select(0, true); }
      if (e.key === 'End') { e.preventDefault(); select(buttons.length - 1, true); }
    };
    if (buttons.length) select(0);
  }

  function weekTable(week, result) {
    const { slots, days } = result;
    const o = lastOptions;
    const monday = parseISO(week.start);
    const layout = [
      ...Array.from({ length: o.numSeniors }, (_, i) => ['Senior', i, 'Senior Board Member']),
      ...Array.from({ length: o.numBoard }, (_, i) => ['Board', i, 'Board Member']),
      ...Array.from({ length: o.numOncall }, (_, i) => ['OnCall', i, 'On-Call']),
    ];
    const dayRow = el('tr', {}, el('th', { class: 'corner', scope: 'col' }, el('span', { class: 'sr-only' }, 'Role')));
    const timeRow = el('tr', {}, el('th', { class: 'corner', scope: 'row' }, 'Time'));
    days.forEach((day, d) => {
      const cls = d === 0 ? 'day-tue' : 'day-wed';
      dayRow.append(el('th', { class: cls, colspan: String(slots.length), scope: 'colgroup' }, `${day} ${md(addDays(monday, d + 1))}`));
      slots.forEach((slot) => timeRow.append(el('th', { class: `time ${cls}`, scope: 'col' }, slot.replace('-', '–'))));
    });
    const body = layout.map(([role, index, label]) => {
      const row = el('tr', {}, el('th', { scope: 'row' }, label));
      for (const day of days) {
        for (const slot of slots) {
          const name = week.shifts[day][slot][role][index];
          row.append(el('td', {}, name || el('span', { class: 'unfilled' }, icon(ICON_WARN), 'Unfilled')));
        }
      }
      return row;
    });
    return el('div', { class: 'table-scroll' },
      el('table', { class: 'sched' },
        el('caption', { class: 'sr-only' }, `Schedule for week ${week.num}`),
        el('thead', {}, dayRow, timeRow), el('tbody', {}, body)));
  }

  function renderPeople(people) {
    const rows = [...people].sort((a, b) => b.new - a.new || b.total - a.total || a.name.localeCompare(b.name));
    const tbody = $('#people-table tbody');
    const notScheduled = people.filter((p) => p.new === 0).length;
    $('#people-count').textContent = `(${people.length} people · ${notScheduled} not scheduled yet)`;

    function draw() {
      const q = $('#people-filter').value.trim().toLowerCase();
      tbody.replaceChildren(...rows.filter((p) => p.name.toLowerCase().includes(q)).map((p) =>
        el('tr', {},
          el('th', { scope: 'row' }, p.name, p.new === 0 ? [' ', el('span', { class: 'pill' }, 'Not scheduled')] : ''),
          el('td', {}, p.position),
          el('td', { class: 'num-col' }, String(p.prior)),
          el('td', { class: 'num-col' }, String(p.new)),
          el('td', { class: 'num-col' }, String(p.total)))));
    }
    $('#people-filter').value = '';
    $('#people-filter').oninput = draw;
    draw();
  }

  $('#download').addEventListener('click', () => {
    if (!lastResult) return;
    const bytes = Uint8Array.from(atob(lastResult.xlsx), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `tabling_schedule_${lastOptions.startDate.replace(/-/g, '_')}.xlsx` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  /* ------------------------------------------------------------------ boot */
  route();
  updateGenerateState();
  startEngine();
})();
