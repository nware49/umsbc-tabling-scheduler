"""Browser entry point: runs the real TablingScheduler (autoScheduler.py) inside Pyodide.

The page writes the uploaded CSVs and the Excel template into Pyodide's virtual file system,
then calls run_schedule(). Everything stays on the user's computer.
"""
import base64
import contextlib
import io
import json
import os
from datetime import datetime, timedelta

import pandas as pd

from autoScheduler import TablingScheduler

REQUIRED_COLUMNS = [
    'Email Address', 'First Name', 'Last Name', 'Position',
    'Availability for Tuesdays (11am - 3pm)', 'Availability for Wednesdays (11am - 3pm)',
]
TEMPLATE = 'template/weekly_tabling_schedule_template.xlsx'
OUTPUT = 'schedule.xlsx'


def _names(people):
    return [f"{m['first_name']} {m['last_name']}" for m in people]


def _check_csv(path, required, label):
    """Return an error message if the CSV can't be used, else None."""
    try:
        df = pd.read_csv(path)
    except Exception as exc:  # unreadable / empty file
        return f"Couldn't read the {label} file: {exc}"
    missing = [c for c in required if c not in df.columns]
    if missing:
        return (f"The {label} file is missing column(s): {', '.join(missing)}. "
                f"Found: {', '.join(map(str, df.columns))}.")
    return None


def run_schedule(avail_path, past_path, start_date, num_weeks, num_seniors, num_board, num_oncall, skip_dates):
    log = io.StringIO()
    warnings = []
    try:
        error = _check_csv(avail_path, REQUIRED_COLUMNS, 'sign-up responses')
        if error:
            return json.dumps({'error': error})
        if past_path:
            error = _check_csv(past_path, ['Name', 'Shifts'], 'past shifts')
            if error:
                return json.dumps({'error': error})

        scheduler = TablingScheduler(num_seniors=num_seniors, num_board=num_board, num_oncall=num_oncall)
        with contextlib.redirect_stdout(log):
            scheduler.load_data(avail_path)
            if past_path:
                scheduler.load_past_shifts(past_path)

        if num_seniors and not scheduler.senior_members:
            warnings.append("No members have the position 'Senior Board Member', so SBM spots can't be filled.")
        if (num_board or num_oncall) and not scheduler.board_members:
            warnings.append("No members have the position 'Board Member', so BM spots can't be filled.")
        other = [m for m in scheduler.members if m['position'] not in ('Senior Board Member', 'Board Member')]
        if other:
            warnings.append(f"{len(other)} member(s) have an unrecognized Position and were ignored: "
                            + ', '.join(f"{m['first_name']} {m['last_name']}" for m in other[:8])
                            + ('…' if len(other) > 8 else '') + '.')
        no_avail = [m for m in scheduler.members
                    if not m['availability']['Tuesday'] and not m['availability']['Wednesday']]
        if no_avail:
            warnings.append(f"{len(no_avail)} member(s) have no usable availability (check the time format, "
                            "e.g. '11-12, 1-2'): "
                            + ', '.join(f"{m['first_name']} {m['last_name']}" for m in no_avail[:8])
                            + ('…' if len(no_avail) > 8 else '') + '.')

        with contextlib.redirect_stdout(log):
            scheduler.generate_schedule(start_date, num_weeks=num_weeks, skip_weeks=list(skip_dates))
            scheduler.export_weekly_excel(TEMPLATE, OUTPUT)

        # --- Build the preview data ---
        monday = datetime.strptime(start_date, '%Y-%m-%d')
        monday -= timedelta(days=monday.weekday())
        last_week = max(week for (week, _, _) in scheduler.schedule)

        weeks = []
        unassigned = 0
        for week_num in range(last_week + 1):
            week_start = monday + timedelta(weeks=week_num)
            entries = {key: val for key, val in scheduler.schedule.items() if key[0] == week_num}
            if not entries:
                weeks.append({'num': week_num + 1, 'start': week_start.strftime('%Y-%m-%d'), 'skipped': True})
                continue
            shifts = {day: {} for day in scheduler.days}
            for (_, day, slot), assignment in entries.items():
                shifts[day][slot] = {
                    'Senior': _names(assignment['Senior']),
                    'Board': _names(assignment['Board']),
                    'OnCall': _names(assignment['OnCall']),
                }
                if (len(assignment['Senior']) < num_seniors or len(assignment['Board']) < num_board
                        or len(assignment['OnCall']) < num_oncall):
                    unassigned += 1
            weeks.append({'num': week_num + 1, 'start': week_start.strftime('%Y-%m-%d'), 'skipped': False,
                          'shifts': shifts})

        counts = scheduler._calculate_assignment_counts()
        people = []
        for member in scheduler.members:
            if member['position'] not in ('Senior Board Member', 'Board Member'):
                continue
            c = counts[member['email']]
            people.append({
                'name': f"{member['first_name']} {member['last_name']}",
                'position': 'SBM' if member['position'] == 'Senior Board Member' else 'BM',
                'prior': c['prior'],
                'new': c['total'] - c['prior'],
                'total': c['total'],
            })

        with open(OUTPUT, 'rb') as f:
            xlsx = base64.b64encode(f.read()).decode('ascii')
        os.remove(OUTPUT)

        return json.dumps({
            'log': log.getvalue(), 'warnings': warnings, 'weeks': weeks, 'people': people,
            'unassigned': unassigned, 'slots': scheduler.time_slots, 'days': scheduler.days,
            'xlsx': xlsx,
        })
    except Exception as exc:
        return json.dumps({'error': f"Something went wrong while scheduling: {exc}", 'log': log.getvalue()})
