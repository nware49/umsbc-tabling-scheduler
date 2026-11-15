/* Runs the real Python scheduler (Pyodide) off the main thread so the page stays responsive. */
const PYODIDE_VERSION = 'v0.29.4';
importScripts(`https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/pyodide.js`);

let pyodide = null;
let runSchedule = null;

const status = (message, step) => postMessage({ type: 'status', message, step });

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download ${url} (${res.status})`);
  return res.text();
}

async function init() {
  status('Starting Python…', 1);
  pyodide = await loadPyodide();

  status('Loading data libraries (pandas)…', 2);
  await pyodide.loadPackage(['pandas', 'micropip']);

  status('Loading Excel support…', 3);
  await pyodide.runPythonAsync('import micropip\nawait micropip.install("openpyxl")');

  status('Loading the scheduler…', 4);
  const [scheduler, runner, template] = await Promise.all([
    fetchText('py/autoScheduler.py'),
    fetchText('py/web_runner.py'),
    fetch('template/weekly_tabling_schedule_template.xlsx').then((r) => {
      if (!r.ok) throw new Error('Couldn\'t download the Excel template');
      return r.arrayBuffer();
    }),
  ]);
  pyodide.FS.mkdirTree('template');
  pyodide.FS.writeFile('template/weekly_tabling_schedule_template.xlsx', new Uint8Array(template));
  pyodide.FS.writeFile('autoScheduler.py', scheduler);
  pyodide.FS.writeFile('web_runner.py', runner);
  pyodide.runPython('import web_runner');
  runSchedule = pyodide.runPython('web_runner.run_schedule');
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await init();
      postMessage({ type: 'ready' });
    } else if (data.type === 'run') {
      const o = data.options;
      pyodide.FS.writeFile('availability.csv', o.availability);
      if (o.pastShifts) pyodide.FS.writeFile('past_shifts.csv', o.pastShifts);
      const json = runSchedule(
        'availability.csv',
        o.pastShifts ? 'past_shifts.csv' : '',
        o.startDate,
        o.numWeeks,
        o.numSeniors,
        o.numBoard,
        o.numOncall,
        o.skipDates,
      );
      postMessage({ type: 'result', id: data.id, json });
    }
  } catch (err) {
    postMessage({ type: 'error', id: data.id, message: String(err && err.message ? err.message : err), phase: data.type });
  }
};
