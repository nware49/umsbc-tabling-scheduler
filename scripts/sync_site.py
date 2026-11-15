"""Copy the scheduler and Excel template into docs/ so the website runs the same code as the desktop app.
Run this after changing autoScheduler.py or the template, then commit docs/."""
import shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
shutil.copyfile(root / "autoScheduler.py", root / "docs" / "py" / "autoScheduler.py")
shutil.copyfile(root / "template" / "weekly_tabling_schedule_template.xlsx",
                root / "docs" / "template" / "weekly_tabling_schedule_template.xlsx")
print("docs/ is in sync with autoScheduler.py and the template.")
