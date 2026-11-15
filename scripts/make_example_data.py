"""Generate the fictional example files used by the website (no real member data)."""
import csv
import json
import random
import sys

random.seed(7)

FIRST = ["Avery", "Jordan", "Morgan", "Riley", "Casey", "Taylor", "Quinn", "Rowan", "Sage", "Emery", "Harper",
         "Finley", "Dakota", "Skyler", "Reese", "Jamie", "Parker", "Devon", "Kendall", "Lane", "Blake", "Remy",
         "Ellis", "Arden", "Sloane", "Marlow", "Tatum", "Wren", "Hollis", "Kit", "Lennox", "Sutton", "Rory",
         "Briar", "Cove", "Drew", "Ember", "Frankie", "Gray", "Hayden", "Indy", "Jules", "Kai", "Lior", "Micah",
         "Nico", "Oakley", "Peyton", "River", "Shiloh"]
LAST = ["Brooks", "Ellis", "Reyes", "Okafor", "Lindgren", "Nakamura", "Abbott", "Castillo", "Whitfield", "Novak",
        "Delgado", "Marsh", "Pruitt", "Banerjee", "Calloway", "Hollis", "Voss", "Achterberg", "Ortiz", "Fitzgerald",
        "Sorensen", "Tanaka", "Quigley", "Pillai", "Ashworth", "Bellamy", "Cardenas", "Dunmore", "Eastwood",
        "Farrow", "Galloway", "Hartigan", "Iyer", "Jessup", "Kowalczyk", "Lockhart", "Mbeki", "Navarro", "Oyelaran",
        "Prescott", "Rasmussen", "Salazar", "Thackeray", "Underhill", "Valdez", "Whitlock", "Xu", "Yoon",
        "Zielinski", "Arcand"]
NAMES = [f"{f} {l}" for f, l in zip(FIRST, LAST)]
SENIORS, BOARD = NAMES[:20], NAMES[20:]
SLOTS = ["11-12", "12-1", "1-2", "2-3"]

rows = []
for names, position in ((SENIORS, "Senior Board Member"), (BOARD, "Board Member")):
    for name in names:
        first, last = name.split()
        tue = ", ".join(s for s in SLOTS if random.random() < 0.75)
        wed = ", ".join(s for s in SLOTS if random.random() < 0.75)
        rows.append({
            "Timestamp": f"9/{random.randint(1, 8)}/2026 {random.randint(9, 20)}:{random.randint(10, 59)}:00",
            "Email Address": f"{first.lower()}.{last.lower()}@example.edu",
            "First Name": first,
            "Last Name": last,
            "Availability for Tuesdays (11am - 3pm)": tue,
            "Availability for Wednesdays (11am - 3pm)": wed,
            "Position": position,
        })

with open("docs/examples/example_availability.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)

# Two earlier weeks of tabling (1 SBM + 1 BM per slot); the past shifts file is the tally of these.
SHIFT_ROWS = [(day, slot) for day in ("Tuesday", "Wednesday") for slot in SLOTS]
history = []
for _ in range(2):
    seniors = random.sample(SENIORS, len(SHIFT_ROWS))
    boards = random.sample(BOARD, len(SHIFT_ROWS))
    history.append([{"day": d, "slot": sl, "senior": sn, "board": bd}
                    for (d, sl), sn, bd in zip(SHIFT_ROWS, seniors, boards)])

tally = {}
for week in history:
    for shift in week:
        for name in (shift["senior"], shift["board"]):
            tally[name] = tally.get(name, 0) + 1

with open("docs/examples/example_past_shifts.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Name", "Shifts"])
    w.writerows(sorted(tally.items(), key=lambda kv: (-kv[1], kv[0])))

if len(sys.argv) > 1:  # used by the screenshot tooling
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)
