/**
 * UMSBC Tabling Scheduler: automatic reminder emails.
 *
 * Paste this into Extensions > Apps Script from a Google Sheet that holds the "Reminders" CSV
 * exported by the scheduler. It emails each person with a shift:
 *   - Sunday night: their shifts for the coming week
 *   - Morning of: a reminder for that day's shift
 * Every email carries a calendar invite (.ics) they can open to add the shift to their calendar.
 *
 * Nothing is sent until you set DRY_RUN to false. Setup steps: see the "Reminders" tab on the website.
 */

const CONFIG = {
  SHEET_NAME: 'Reminders',        // the tab that holds the imported CSV
  SENDER_NAME: 'UMSBC Tabling',   // the "from" name people see
  REPLY_TO: '',                   // optional: replies go here (for example a club address)
  TABLE_LOCATION: '',             // optional: where the table is, shown in emails and invites
  WEEKLY_HOUR: 20,                // Sunday reminder goes out around this hour (24h clock, 20 = 8pm)
  DAILY_HOUR: 8,                  // day-of reminder goes out around this hour (8 = 8am)
  ATTACH_CALENDAR_INVITE: true,   // attach an .ics calendar file
  DRY_RUN: true,                  // true = only write to the log; set to false to really send
};

const ROLE_SENIOR = 'Senior Board Member';
const ROLE_BOARD = 'Board Member';
const ROLE_ONCALL = 'On-Call';

/* ============================================================ menu and setup */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tabling reminders')
    .addItem('1. Send a test email to me', 'testEmailToMe')
    .addItem('2. Preview who will be emailed', 'previewReminders')
    .addItem('3. Turn on automatic reminders', 'setup')
    .addSeparator()
    .addItem('Turn off automatic reminders', 'removeTriggers')
    .addItem('Forget what was already sent', 'clearSentLog')
    .addToUi();
}

/** Creates the two schedules: Sunday night (weekly) and every morning (day-of). */
function setup() {
  removeTriggers();
  ScriptApp.newTrigger('sendWeeklyReminders').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(CONFIG.WEEKLY_HOUR).create();
  ScriptApp.newTrigger('sendDailyReminders').timeBased()
    .everyDays(1).atHour(CONFIG.DAILY_HOUR).create();
  const note = CONFIG.DRY_RUN
    ? 'Reminders are scheduled, but DRY_RUN is still true, so nothing will be emailed yet.'
    : 'Reminders are scheduled and will be emailed.';
  Logger.log(note);
  toast_(note);
}

function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => ['sendWeeklyReminders', 'sendDailyReminders'].includes(t.getHandlerFunction()))
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

function clearSentLog() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  toast_('Cleared. Reminders already sent can be sent again.');
}

/* ============================================================ entry points */

function sendWeeklyReminders() { run_('weekly'); }
function sendDailyReminders() { run_('daily'); }

/** Logs what the next Sunday and the next morning reminders would contain. Never sends. */
function previewReminders() {
  const ctx = liveContext_();
  const rows = readRows_(ctx);
  ['weekly', 'daily'].forEach((kind) => {
    const messages = buildMessages(rows, kind, ctx.todayISO, CONFIG, ctx);
    Logger.log(`${kind}: ${messages.length} email(s) if this ran today (${ctx.todayISO}, time zone ${ctx.tz})`);
    messages.forEach((m) => Logger.log(`  to ${m.to}: ${m.subject}`));
  });
  toast_('Preview written to the log: View > Logs in the Apps Script editor.');
}

/** Sends one weekly and one day-of sample to YOU (not to the people in the sheet). */
function testEmailToMe() {
  const ctx = liveContext_();
  const rows = readRows_(ctx);
  if (!rows.length) throw new Error(`No rows found on the "${CONFIG.SHEET_NAME}" tab.`);
  const me = Session.getEffectiveUser().getEmail();
  const firstDate = rows.map((r) => r.date).sort()[0];
  const samples = [
    buildMessages(rows, 'weekly', addDays(firstDate, -1), CONFIG, ctx)[0],
    buildMessages(rows, 'daily', firstDate, CONFIG, ctx)[0],
  ].filter(Boolean);
  samples.forEach((m) => send_(Object.assign({}, m, { to: me, subject: `[TEST] ${m.subject}` })));
  toast_(`Sent ${samples.length} test email(s) to ${me}.`);
}

function run_(kind) {
  const ctx = liveContext_();
  const messages = buildMessages(readRows_(ctx), kind, ctx.todayISO, CONFIG, ctx);
  const props = PropertiesService.getScriptProperties();
  let sent = 0;
  let skipped = 0;
  messages.forEach((m) => {
    if (props.getProperty(m.key)) { skipped++; return; }   // already sent
    if (CONFIG.DRY_RUN) {
      Logger.log(`[DRY RUN] would send to ${m.to}: ${m.subject}`);
      return;
    }
    send_(m);
    props.setProperty(m.key, new Date().toISOString());
    sent++;
  });
  Logger.log(`${kind}: ${messages.length} due, ${sent} sent, ${skipped} already sent.`);
}

/* ============================================================ Google services (not unit tested) */

function liveContext_() {
  const tz = Session.getScriptTimeZone();
  const sheetTz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  return {
    tz,
    sheetTz,
    todayISO: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
    dateCellToISO: (value) => (value instanceof Date
      ? Utilities.formatDate(value, sheetTz, 'yyyy-MM-dd')
      : String(value).trim().slice(0, 10)),
    toUtcStamp: (iso, hour, minute) => Utilities.formatDate(
      Utilities.parseDate(`${iso} ${pad2(hour)}:${pad2(minute)}`, tz, 'yyyy-MM-dd HH:mm'),
      'UTC', "yyyyMMdd'T'HHmmss'Z'"),
    nowStamp: () => Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"),
  };
}

function readRows_(ctx) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`There is no tab named "${CONFIG.SHEET_NAME}". Import the Reminders CSV into a tab with that name.`);
  return parseRows(sheet.getDataRange().getValues(), ctx);
}

function send_(m) {
  const options = { name: CONFIG.SENDER_NAME, htmlBody: m.html };
  if (CONFIG.REPLY_TO) options.replyTo = CONFIG.REPLY_TO;
  if (m.ics) options.attachments = [Utilities.newBlob(m.ics, 'text/calendar', m.icsName)];
  GmailApp.sendEmail(m.to, m.subject, m.text, options);
}

function toast_(message) {
  try { SpreadsheetApp.getActive().toast(message, 'Tabling reminders', 8); } catch (e) { /* no spreadsheet UI */ }
}

/* ============================================================ pure logic (unit tested) */

function pad2(n) { return String(n).padStart(2, '0'); }

/** 'YYYY-MM-DD' plus n days, with no time zone involved. */
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function prettyDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** '11:00 AM to 12:00 PM' -> { start: [11, 0], end: [12, 0] } (24-hour), or null. */
function parseTimeRange(text) {
  const match = String(text).match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*(?:to|-|–)\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  const to24 = (h, ap) => (Number(h) % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0);
  return {
    start: [to24(match[1], match[3]), Number(match[2])],
    end: [to24(match[4], match[6]), Number(match[5])],
  };
}

/** Sheet values (first row = headers) -> clean row objects. Bad rows are skipped. */
function parseRows(values, ctx) {
  if (!values.length) return [];
  const header = values[0].map((h) => String(h).trim().toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const idx = {
    date: col('Date'), day: col('Day'), time: col('Time'), role: col('Role'),
    first: col('First Name'), last: col('Last Name'), email: col('Email'),
  };
  const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) throw new Error(`The Reminders tab is missing column(s): ${missing.join(', ')}. Use the CSV exported by the scheduler.`);

  const rows = [];
  values.slice(1).forEach((r) => {
    const email = String(r[idx.email]).trim().toLowerCase();
    const range = parseTimeRange(r[idx.time]);
    const date = r[idx.date] === '' ? '' : ctx.dateCellToISO(r[idx.date]);
    if (!email || !range || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    rows.push({
      date, email, range,
      day: String(r[idx.day]).trim(),
      time: String(r[idx.time]).trim(),
      role: String(r[idx.role]).trim(),
      first: String(r[idx.first]).trim(),
      last: String(r[idx.last]).trim(),
    });
  });
  return rows;
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Role-specific lines, taken from the notes on the weekly Excel template. */
function notesFor(shift, slotRows) {
  const notes = ['Show up for your shift 5 minutes before it starts.'];
  const onCall = slotRows.filter((r) => r.role === ROLE_ONCALL && r.email !== shift.email);
  if (shift.role === ROLE_SENIOR) {
    notes.push("You're in charge of setting up and breaking down the table.");
  } else if (shift.role === ROLE_BOARD) {
    notes.push(onCall.length
      ? `If you can't make it on time, contact the on-call Board Member (${onCall.map((r) => `${r.first} ${r.last}, ${r.email}`).join('; ')}) at least 20 minutes before your shift so they can fill in.`
      : "If you can't make it on time, let the Senior Board Member and the rest of the board know as early as you can.");
  } else if (shift.role === ROLE_ONCALL) {
    notes.push("You're the on-call Board Member for this shift. Keep your phone handy: if someone can't make it, they'll contact you at least 20 minutes before and you'll need to fill in.");
  }
  return notes;
}

function foldIcs(line) {
  // Lines longer than 75 characters must be folded with CRLF + space.
  const out = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
}

function escIcs(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** One calendar file holding every shift in `shifts`. Stable UIDs mean re-sending updates, not duplicates. */
function buildIcs(shifts, rowsBySlot, config, ctx) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UMSBC Tabling Scheduler//Reminders//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  shifts.forEach((s) => {
    const slot = rowsBySlot[`${s.date}|${s.time}`] || [s];
    const description = [`Role: ${s.role}`]
      .concat(notesFor(s, slot))
      .concat(slot.filter((r) => r.email !== s.email)
        .length ? [`Also on this shift: ${slot.filter((r) => r.email !== s.email).map((r) => `${r.first} ${r.last} (${r.role})`).join(', ')}`] : [])
      .join('\n');
    const event = [
      'BEGIN:VEVENT',
      `UID:${s.date}-${pad2(s.range.start[0])}${pad2(s.range.start[1])}-${s.email.replace('@', '.')}@umsbc-tabling-scheduler`,
      `DTSTAMP:${ctx.nowStamp()}`,
      `DTSTART:${ctx.toUtcStamp(s.date, s.range.start[0], s.range.start[1])}`,
      `DTEND:${ctx.toUtcStamp(s.date, s.range.end[0], s.range.end[1])}`,
      `SUMMARY:${escIcs(`UMSBC tabling (${s.role})`)}`,
      `DESCRIPTION:${escIcs(description)}`,
    ];
    if (config.TABLE_LOCATION) event.push(`LOCATION:${escIcs(config.TABLE_LOCATION)}`);
    event.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Tabling shift starts in 1 hour', 'TRIGGER:-PT1H', 'END:VALARM', 'END:VEVENT');
    lines.push(...event);
  });
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcs).join('\r\n')}\r\n`;
}

/**
 * Works out which emails are due. kind 'weekly': shifts in the next 7 days (Monday to Sunday when run on
 * Sunday). kind 'daily': shifts today. Returns one message per person.
 */
function buildMessages(rows, kind, todayISO, config, ctx) {
  const from = kind === 'weekly' ? addDays(todayISO, 1) : todayISO;
  const to = kind === 'weekly' ? addDays(todayISO, 7) : todayISO;
  const due = rows.filter((r) => r.date >= from && r.date <= to);

  const rowsBySlot = {};
  rows.forEach((r) => { (rowsBySlot[`${r.date}|${r.time}`] = rowsBySlot[`${r.date}|${r.time}`] || []).push(r); });

  const byPerson = {};
  due.forEach((r) => { (byPerson[r.email] = byPerson[r.email] || []).push(r); });

  return Object.keys(byPerson).sort().map((email) => {
    const shifts = byPerson[email].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const first = shifts[0].first;
    const where = config.TABLE_LOCATION ? ` at ${config.TABLE_LOCATION}` : '';

    const shiftLines = shifts.map((s) => `${s.day}, ${prettyDate(s.date)}: ${s.time} (${s.role})${where}`);
    const teammates = shifts.map((s) => {
      const others = (rowsBySlot[`${s.date}|${s.time}`] || []).filter((r) => r.email !== s.email);
      return others.length ? `${s.day}: ${others.map((r) => `${r.first} ${r.last} (${r.role})`).join(', ')}` : null;
    }).filter(Boolean);
    const notes = [...new Set(shifts.flatMap((s) => notesFor(s, rowsBySlot[`${s.date}|${s.time}`] || [s])))];

    const intro = kind === 'weekly'
      ? `Here ${shifts.length === 1 ? "is your tabling shift" : 'are your tabling shifts'} for this week:`
      : `You're tabling today:`;
    const subject = kind === 'weekly'
      ? (shifts.length === 1
        ? `Your tabling shift this week: ${shifts[0].day}, ${prettyDate(shifts[0].date)}`
        : `Your tabling shifts this week (${prettyDate(shifts[0].date)} to ${prettyDate(shifts[shifts.length - 1].date)})`)
      : `Tabling today at ${shifts[0].time.split(' to ')[0]}`;
    const inviteLine = config.ATTACH_CALENDAR_INVITE
      ? 'A calendar invite (.ics) is attached. Open it to add your shift to your calendar.'
      : '';

    const text = [`Hi ${first},`, '', intro, '', ...shiftLines.map((l) => `  - ${l}`),
      ...(teammates.length ? ['', 'Who else is on your shift:', ...teammates.map((l) => `  - ${l}`)] : []),
      '', 'Reminders:', ...notes.map((n) => `  - ${n}`),
      ...(inviteLine ? ['', inviteLine] : []), '', 'Thanks,', config.SENDER_NAME].join('\n');

    const html = [`<p>Hi ${esc(first)},</p>`, `<p>${esc(intro)}</p>`,
      `<ul>${shiftLines.map((l) => `<li><strong>${esc(l)}</strong></li>`).join('')}</ul>`,
      teammates.length ? `<p>Who else is on your shift:</p><ul>${teammates.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '',
      '<p>Reminders:</p>', `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`,
      inviteLine ? `<p>${esc(inviteLine)}</p>` : '', `<p>Thanks,<br>${esc(config.SENDER_NAME)}</p>`].join('\n');

    const message = {
      to: email, subject, text, html,
      key: `${kind}|${from}|${email}`,
    };
    if (config.ATTACH_CALENDAR_INVITE) {
      message.ics = buildIcs(shifts, rowsBySlot, config, ctx);
      message.icsName = kind === 'weekly' ? 'tabling-shifts.ics' : 'tabling-shift.ics';
    }
    return message;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { parseRows, buildMessages, parseTimeRange, addDays, buildIcs, CONFIG };
}
