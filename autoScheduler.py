import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random
from collections import defaultdict, Counter
import json
import os
import sys
from typing import Dict, List, Tuple, Set
import openpyxl
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
import shutil
from copy import copy


class TablingScheduler:
    def __init__(self, num_seniors=1, num_board=1, num_oncall=1):
        # People needed per shift: Senior Board Members, regular Board Members, On-Call Board Members
        self.num_seniors = num_seniors
        self.num_board = num_board
        self.num_oncall = num_oncall
        self.members = []
        self.senior_members = []
        self.board_members = []
        self.time_slots = ['11-12', '12-1', '1-2', '2-3']
        self.days = ['Tuesday', 'Wednesday']
        self.assignment_history = defaultdict(list)  # person -> list of (week_number, day, time, role)
        self.schedule = {}  # (week, day, time) -> {'Senior': person, 'Board': person, 'OnCall': person}
        self.prior_shifts = defaultdict(int)  # email -> shifts already worked before this schedule

    def load_data(self, csv_file_path):
        """Load member data from CSV file, handling duplicates by keeping most recent entry"""
        df = pd.read_csv(csv_file_path)

        # Normalize names (strip + uppercase)
        df['First Name Clean'] = df['First Name'].astype(str).str.strip().str.upper()
        df['Last Name Clean'] = df['Last Name'].astype(str).str.strip().str.upper()

        # If there's a timestamp or submission order, prefer to sort by it.
        # Assuming "Timestamp" column exists; otherwise, just keep the last row.
        if 'Timestamp' in df.columns:
            df = df.sort_values('Timestamp')  # oldest → newest
        # Drop duplicates keeping the last occurrence (most recent)
        df = df.drop_duplicates(subset=['First Name Clean', 'Last Name Clean'], keep='last')

        for _, row in df.iterrows():
            member = {
                'email': row['Email Address'],
                'first_name': row['First Name'].strip(),
                'last_name': row['Last Name'].strip(),
                'position': row['Position'],
                'availability': {
                    'Tuesday': self._parse_availability(row.get('Availability for Tuesdays (11am - 3pm)', '')),
                    'Wednesday': self._parse_availability(row.get('Availability for Wednesdays (11am - 3pm)', ''))
                }
            }

            self.members.append(member)

            if member['position'] == 'Senior Board Member':
                self.senior_members.append(member)
            elif member['position'] == 'Board Member':
                self.board_members.append(member)

        print(f"Loaded {len(self.members)} members:")
        print(f"  - {len(self.senior_members)} Senior Board Members")
        print(f"  - {len(self.board_members)} Board Members")

    def load_past_shifts(self, csv_file_path):
        """Load shifts already worked this semester (CSV with 'Name' and 'Shifts' columns).
        Must be called after load_data so names can be matched to members."""
        df = pd.read_csv(csv_file_path)
        by_name = {f"{m['first_name']} {m['last_name']}".strip().upper(): m for m in self.members}

        unmatched = []
        for _, row in df.iterrows():
            name = ' '.join(str(row['Name']).split()).upper()
            member = by_name.get(name)
            if member is None:
                unmatched.append(str(row['Name']))
                continue
            self.prior_shifts[member['email']] += int(row['Shifts'])

        print(f"Loaded past shifts for {len(df) - len(unmatched)} members "
              f"({sum(self.prior_shifts.values())} shifts total)")
        if unmatched:
            print(f"⚠️  Could not match {len(unmatched)} name(s) in past shifts file: {', '.join(unmatched)}")

    def _parse_availability(self, availability_str):
        """Parse availability string like '11-12, 12-1, 2-3' into list"""
        if pd.isna(availability_str) or not availability_str.strip():
            return []

        slots = [slot.strip() for slot in availability_str.split(',')]
        return [slot for slot in slots if slot in self.time_slots]

    def _get_week_dates(self, start_date, num_weeks=16):
        """Generate list of week start dates (Mondays) for the schedule period"""
        weeks = []
        current_date = start_date

        # Ensure we start on a Monday
        while current_date.weekday() != 0:
            current_date -= timedelta(days=1)

        for i in range(num_weeks):
            weeks.append(current_date)
            current_date += timedelta(weeks=1)

        return weeks

    def _person_worked_last_week(self, person, week_num):
        """Check if person worked in the previous week"""
        if week_num == 0:
            return False

        last_week_assignments = [assignment for assignment in self.assignment_history[person['email']]
                                 if assignment[0] == week_num - 1]
        return len(last_week_assignments) > 0

    def _get_available_people(self, day, time_slot, role, week_num):
        """Get list of people available for specific day/time/role who didn't work last week"""
        available = []

        if role == 'Senior':
            candidates = self.senior_members
        else:  # 'Board' or 'OnCall'
            candidates = self.board_members

        for person in candidates:
            # Check availability for this time slot
            if time_slot not in person['availability'][day]:
                continue

            # Check if they worked last week
            if self._person_worked_last_week(person, week_num):
                continue

            # Check if they're already assigned this week
            current_week_assignments = [assignment for assignment in self.assignment_history[person['email']]
                                        if assignment[0] == week_num]
            if current_week_assignments:
                continue

            available.append(person)

        return available

    def _calculate_assignment_counts(self):
        """Calculate how many assignments each person has had"""
        counts = defaultdict(lambda: {'total': 0, 'regular': 0, 'oncall': 0, 'senior': 0, 'prior': 0})

        # Shifts worked before this schedule count toward the total so people are balanced overall
        for email, prior in self.prior_shifts.items():
            counts[email]['total'] += prior
            counts[email]['prior'] += prior

        for email, assignments in self.assignment_history.items():
            for assignment in assignments:
                week, day, time, role = assignment
                counts[email]['total'] += 1
                if role == 'OnCall':
                    counts[email]['oncall'] += 1
                elif role == 'Board':
                    counts[email]['regular'] += 1
                elif role == 'Senior':
                    counts[email]['senior'] += 1

        return counts

    def _pick_board_member(self, available_board_members, role):
        """Pick a Board Member for a 'Board' or 'OnCall' spot, favoring people with fewer shifts"""
        if not available_board_members:
            return None

        counts = self._calculate_assignment_counts()
        role_key = 'regular' if role == 'Board' else 'oncall'

        # Prefer fewer total, then fewer shifts in this role
        scored_members = [
            (member, counts[member['email']]['total'] * 10 + counts[member['email']][role_key])
            for member in available_board_members
        ]
        scored_members.sort(key=lambda x: x[1])
        top_candidates = scored_members[:min(3, len(scored_members))]
        return random.choice(top_candidates)[0]

    def generate_schedule(self, start_date_str, num_weeks=16):
        """Generate schedule ensuring Senior Members only do Senior shifts"""
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        weeks = self._get_week_dates(start_date, num_weeks)

        print(f"\nGenerating {num_weeks}-week schedule starting {start_date_str}")
        print("=" * 50)

        unassigned_shifts = []

        for week_num, week_start in enumerate(weeks):
            print(f"\nWeek {week_num + 1} (starting {week_start.strftime('%Y-%m-%d')}):")

            for day in self.days:
                for time_slot in self.time_slots:
                    assigned = {'Senior': [], 'Board': [], 'OnCall': []}
                    needed = {'Senior': self.num_seniors, 'Board': self.num_board, 'OnCall': self.num_oncall}

                    # Senior assignments (ONLY Senior Members), fewest senior + prior shifts first
                    for _ in range(self.num_seniors):
                        available_senior = self._get_available_people(day, time_slot, 'Senior', week_num)
                        if not available_senior:
                            break
                        counts = self._calculate_assignment_counts()
                        senior = min(
                            available_senior,
                            key=lambda m: counts[m['email']]['senior'] + counts[m['email']]['prior']
                        )
                        self.assignment_history[senior['email']].append((week_num, day, time_slot, 'Senior'))
                        assigned['Senior'].append(senior)

                    # Board + OnCall assignments (ONLY Board Members)
                    for role in ('Board', 'OnCall'):
                        for _ in range(needed[role]):
                            available_board = self._get_available_people(day, time_slot, 'Board', week_num)
                            member = self._pick_board_member(available_board, role)
                            if not member:
                                break
                            self.assignment_history[member['email']].append((week_num, day, time_slot, role))
                            assigned[role].append(member)

                    # Store assignment
                    self.schedule[(week_num, day, time_slot)] = {
                        'Senior': assigned['Senior'],
                        'Board': assigned['Board'],
                        'OnCall': assigned['OnCall'],
                        'date': week_start + timedelta(days=(1 if day == 'Tuesday' else 2))
                    }

                    if any(len(assigned[role]) < needed[role] for role in assigned):
                        unassigned_shifts.append((week_num + 1, day, time_slot))

        # Print summary
        print(f"\n" + "=" * 50)
        print("SCHEDULE SUMMARY")
        print("=" * 50)

        if unassigned_shifts:
            print(f"\n⚠️  UNASSIGNED SHIFTS ({len(unassigned_shifts)}):")
            for week, day, time in unassigned_shifts:
                print(f"  Week {week} - {day} {time}")

        print(f"\nASSIGNMENT COUNTS:")
        counts = self._calculate_assignment_counts()

        print("\nSenior Board Members:")
        for member in self.senior_members:
            total = counts[member['email']]['total']
            prior = counts[member['email']]['prior']
            print(f"  {member['first_name']} {member['last_name']}: {total} shifts ({prior} prior)")

        print("\nBoard Members:")
        for member in self.board_members:
            email = member['email']
            total = counts[email]['total']
            regular = counts[email]['regular']
            oncall = counts[email]['oncall']
            prior = counts[email]['prior']
            print(
                f"  {member['first_name']} {member['last_name']}: {total} total "
                f"({prior} prior, {regular} regular, {oncall} on-call)")

    def resource_path(self, relative_path):
        """Get absolute path to resource, works for dev and PyInstaller exe"""
        try:
            base_path = sys._MEIPASS  # temp folder created by PyInstaller
        except Exception:
            base_path = os.path.abspath(".")
        return os.path.join(base_path, relative_path)

    @staticmethod
    def _names(people):
        return '; '.join(f"{m['first_name']} {m['last_name']}" for m in people)

    def export_schedule(self, filename):
        """Export schedule to CSV"""
        rows = []

        for (week_num, day, time_slot), assignment in self.schedule.items():
            date = assignment['date']

            rows.append({
                'Week': week_num + 1,
                'Date': date.strftime('%Y-%m-%d'),
                'Day': day,
                'Time': time_slot,
                'Senior_Board_Member': self._names(assignment['Senior']),
                'Senior_Email': '; '.join(m['email'] for m in assignment['Senior']),
                'Board_Member': self._names(assignment['Board']),
                'Board_Email': '; '.join(m['email'] for m in assignment['Board']),
                'OnCall_Member': self._names(assignment['OnCall']),
                'OnCall_Email': '; '.join(m['email'] for m in assignment['OnCall'])
            })

        df = pd.DataFrame(rows)
        df.to_csv(filename, index=False)
        print(f"\nSchedule exported to: {filename}")

    def export_weekly_excel(self, template_file, output_file):
        """Export schedule to Excel using the template, one sheet per week.
        Preserves row/column spacing and formatting."""

        filepath = self.resource_path(template_file)

        # Load template workbook once
        wb = load_workbook(filepath)
        template_sheet = wb.active

        # Map (day, time_slot) → column index in template
        col_map = {
            ("Tuesday", "11-12"): 3,
            ("Tuesday", "12-1"): 4,
            ("Tuesday", "1-2"): 5,
            ("Tuesday", "2-3"): 6,
            ("Wednesday", "11-12"): 7,
            ("Wednesday", "12-1"): 8,
            ("Wednesday", "1-2"): 9,
            ("Wednesday", "2-3"): 10,
        }

        # Group schedule by week
        weeks = defaultdict(list)
        for (week_num, day, time_slot), assignment in self.schedule.items():
            weeks[week_num].append((day, time_slot, assignment))

        # Row layout: one row per person needed, grouped by role
        layout = (
            [('Senior', i, 5, 'Senior Board Member') for i in range(self.num_seniors)] +
            [('Board', i, 6, 'Board Member') for i in range(self.num_board)] +
            [('OnCall', i, 7, 'On-Call') for i in range(self.num_oncall)]
        )
        delta = len(layout) - 3  # template has one row per role

        # Make a copy of the template for each week
        for week_num, entries in weeks.items():
            new_sheet = wb.copy_worksheet(template_sheet)
            new_sheet.title = f"Week {week_num + 1}"
            self._resize_role_rows(new_sheet, template_sheet, layout, delta)

            # Fill in assignments
            for day, time_slot, assignment in entries:
                if (day, time_slot) not in col_map:
                    continue
                col = col_map[(day, time_slot)]

                for offset, (role, index, _, _) in enumerate(layout):
                    people = assignment[role]
                    new_sheet.cell(row=5 + offset, column=col).value = (
                        f"{people[index]['first_name']} {people[index]['last_name']}"
                        if index < len(people) else "UNASSIGNED"
                    )

        # Finally, remove the original template sheet
        wb.remove(template_sheet)

        # Save workbook
        wb.save(output_file)
        print(f"Weekly schedules exported to: {output_file}")

    def _resize_role_rows(self, sheet, template_sheet, layout, delta):
        """Make the role rows match the number of people per shift, shifting the notes below them"""
        notes = [f"C{r}:J{r}" for r in (9, 10, 11)]
        for rng in notes:
            sheet.unmerge_cells(rng)
        if delta:
            sheet.move_range("A8:Y11", rows=delta)

        for offset, (role, _, template_row, label) in enumerate(layout):
            row = 5 + offset
            sheet.row_dimensions[row].height = template_sheet.row_dimensions[template_row].height
            for col in range(1, 26):
                src = template_sheet.cell(row=template_row, column=col)
                dst = sheet.cell(row=row, column=col)
                dst._style = copy(src._style)
                dst.value = label if col == 2 else None

        for rng in notes:
            first, last = rng.split(':')
            sheet.merge_cells(f"{first[0]}{int(first[1:]) + delta}:{last[0]}{int(last[1:]) + delta}")

        # Drop notes about roles that aren't scheduled
        if not self.num_oncall:
            for col in (2, 3):
                sheet.cell(row=11 + delta, column=col).value = None

    def save_history(self, filename):
        """Save assignment history to JSON for future runs"""
        history_data = {
            'assignment_history': dict(self.assignment_history)
        }

        with open(filename, 'w') as f:
            json.dump(history_data, f, indent=2)
        print(f"Assignment history saved to: {filename}")

    def load_history(self, filename):
        """Load assignment history from previous runs"""
        if os.path.exists(filename):
            with open(filename, 'r') as f:
                history_data = json.load(f)

            self.assignment_history = defaultdict(list)
            for email, assignments in history_data.get('assignment_history', {}).items():
                self.assignment_history[email] = assignments

            print(f"Loaded assignment history from: {filename}")
            return True
        return False


# Example usage
if __name__ == "__main__":
    # Initialize scheduler
    scheduler = TablingScheduler()

    # Load member data from CSV
    csv_file = "board_members.csv"  # Replace with your CSV file path
    try:
        scheduler.load_data(csv_file)
    except FileNotFoundError:
        print(f"Error: Could not find {csv_file}")
        print("Please make sure your CSV file is in the same directory as this script.")
        exit(1)

    # Load previous assignment history if it exists
    history_file = "assignment_history.json"
    # scheduler.load_history(history_file)

    # Generate schedule
    start_date = "2025-09-07"  # Replace with your desired start date (YYYY-MM-DD)
    scheduler.generate_schedule(start_date, num_weeks=16)  # 16 weeks ≈ 4 months

    # Export unformatted results
    # output_file = f"tabling_schedule_{start_date.replace('-', '_')}.csv"
    # scheduler.export_schedule(output_file)

    # Save updated history
    # scheduler.save_history(history_file)

    # Export templated schedule
    output_xlsx = f"tabling_schedule_{start_date.replace('-', '_')}.xlsx"
    scheduler.export_weekly_excel("weekly_tabling_schedule_template.xlsx", output_xlsx)
