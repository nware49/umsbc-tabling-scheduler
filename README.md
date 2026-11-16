# UMSBC Tabling Scheduler Tool

Tool for generating a schedule for tabling at UMass based on the availability of the Board Members and Senior Board Members.

It randomizes the schedule to create opportunities for everyone to meet other members of the club.

It also attempts to prioritize giving Board Members the On-Duty shift, instead of the On-Call shift.

If the schedule ends up with members who only have "On-Call" shifts, hit regenerate and the randomizer should take care of it. 


## Input

The availability of members should be provided by a `.csv` file in the format provided by the `example_availability.csv` file.

It is recommended to collect availability with a Google Form that outputs a Google Sheet, which can then be exported as a .csv

## Running the Scheduler

Run the scheduler by double clicking the `umsbc_scheduler.exe` file in the `/dist` folder. 

Then select your availability csv file and input the start date for the schedule and the number of weeks to schedule shifts.

Click "Generate Schedule" and this will save a schedule in the `/dist` folder. 

If you are unhappy with how it generated and distributed people, hit the "Regenerate Schedule" button, and the scheduler will overwrite the previous schedule file.


## Distributing the Schedule

I would recommend screenshotting the schedule each week and sending it to the Slack. You could hypothetically send the whole schedule to the Slack but people probably forget.

You could also try sending an email reminder to the people who are scheduled for the week. IF you want to start doing this, talk to me and we can set up an export of everyone's email addresses.


## Future Work

- [ ] Emails of the BMs/SBMs for reminders
- [ ] Do you need phone numbers so people can text each other to cover shifts?
- [ ] World domination
- [ ] Skiing through the Student Union
## Website

A browser version lives in `docs/` and is published with GitHub Pages (Settings → Pages → Deploy from branch → `main` / `docs`). It runs the same `autoScheduler.py` in the browser with Pyodide, so uploaded files never leave the user's computer.

- After changing `autoScheduler.py` or the Excel template, run `python scripts/sync_site.py` and commit `docs/`.
- The example files and tutorial screenshots use fictional people (`scripts/make_example_data.py`).
- To preview locally: `cd docs && python -m http.server 8000`, then open http://localhost:8000.

### Reminder emails

`docs/reminders/Code.gs` is a Google Apps Script that emails each person on Sunday night and the morning of their shift, with an `.ics` invite attached. The scheduler exports its input with `TablingScheduler.export_reminders_csv()` (also the "Download Reminders CSV" button on the site). That CSV contains email addresses: keep it out of the repo.
