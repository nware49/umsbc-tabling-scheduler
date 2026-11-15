import tkinter as tk
from tkinter import filedialog, scrolledtext
from autoScheduler import TablingScheduler
import os
import sys
from PIL import Image, ImageTk
from media import ascii_umsbc


# Helper to find media files whether running source or PyInstaller .exe
def resource_path(relative_path):
    """Get absolute path to resource, works for dev and PyInstaller"""
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


class SchedulerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("UMSBC Tabling Scheduler")
        self.root.geometry("950x700")
        self.root.configure(bg="#2068C8")  # set main background color

        # --- Set app icon ---
        try:
            self.root.iconphoto(False, tk.PhotoImage(file=resource_path("media/umsbc_mini_logo.png")))
        except Exception as e:
            print(f"⚠️ Could not load icon: {e}")

        self.csv_file = None
        self.past_shifts_file = "past_shifts.csv" if os.path.exists("past_shifts.csv") else None
        self.last_start_date = None
        self.last_num_weeks = None
        self.last_output_file = None

        # --- Top bar (blue bg) ---
        logo_frame = tk.Frame(root, bg="#2068C8")
        logo_frame.pack(pady=5, anchor="w", fill="x")

        # --- File selection ---
        top_frame = tk.Frame(root, bg="#2068C8")
        top_frame.pack(pady=10)
        tk.Label(top_frame, text="CSV File:", bg="#2068C8", fg="white").pack(side=tk.LEFT, padx=5)
        self.file_button = tk.Button(top_frame, text="Browse...", command=self.browse_file)
        self.file_button.pack(side=tk.LEFT, padx=5)

        past_frame = tk.Frame(root, bg="#2068C8")
        past_frame.pack(pady=5)
        tk.Label(past_frame, text="Past Shifts CSV (optional):", bg="#2068C8", fg="white").pack(side=tk.LEFT, padx=5)
        self.past_button = tk.Button(past_frame, text="Browse...", command=self.browse_past_shifts)
        self.past_button.pack(side=tk.LEFT, padx=5)

        # --- Inputs ---
        input_frame = tk.Frame(root, bg="#2068C8")
        input_frame.pack(pady=10)
        tk.Label(input_frame, text="Schedule Start Date (YYYY-MM-DD):", bg="#2068C8", fg="white").pack(side=tk.LEFT, padx=5)
        self.date_entry = tk.Entry(input_frame, width=15)
        self.date_entry.insert(0, "2025-09-07")
        self.date_entry.pack(side=tk.LEFT, padx=5)

        tk.Label(input_frame, text="Number of Weeks:", bg="#2068C8", fg="white").pack(side=tk.LEFT, padx=5)
        self.weeks_entry = tk.Entry(input_frame, width=5)
        self.weeks_entry.insert(0, "16")
        self.weeks_entry.pack(side=tk.LEFT, padx=5)

        # --- People per shift ---
        staff_frame = tk.Frame(root, bg="#2068C8")
        staff_frame.pack(pady=5)
        self.staff_entries = {}
        for key, label, default in (("seniors", "SBMs per shift:", "1"),
                                    ("board", "BMs per shift:", "1"),
                                    ("oncall", "On-Call BMs per shift:", "1")):
            tk.Label(staff_frame, text=label, bg="#2068C8", fg="white").pack(side=tk.LEFT, padx=5)
            entry = tk.Entry(staff_frame, width=4)
            entry.insert(0, default)
            entry.pack(side=tk.LEFT, padx=5)
            self.staff_entries[key] = entry

        # --- Buttons ---
        button_frame = tk.Frame(root, bg="#2068C8")
        button_frame.pack(pady=10)
        self.generate_button = tk.Button(button_frame, text="Generate Schedule", command=self.generate_schedule)
        self.generate_button.pack(side=tk.LEFT, padx=10)
        self.regenerate_button = tk.Button(button_frame, text="Regenerate Schedule",
                                           command=self.regenerate_schedule, state=tk.DISABLED)
        self.regenerate_button.pack(side=tk.LEFT, padx=10)

        # --- Status box with background image ---
        status_frame = tk.Frame(root, bg="#2068C8")
        status_frame.pack(padx=10, pady=10, fill=tk.BOTH, expand=True)

        self.canvas = tk.Canvas(status_frame, bg="white", highlightthickness=1, highlightbackground="black")
        self.canvas.pack(fill=tk.BOTH, expand=True)


        # Place text widget on canvas
        self.status_box = scrolledtext.ScrolledText(self.canvas, wrap=tk.WORD,
                                                    width=100, height=25, font=("Consolas", 10),
                                                    bg="white", fg="black")
        self.text_window = self.canvas.create_window(0, 0, anchor="nw", window=self.status_box, width=920, height=550)

        # Redirect stdout
        sys.stdout = TextRedirector(self.status_box)

        print("\n" + ascii_umsbc.ASCII_LOGO + "\n\n + Welcome to the UMSBC Tabling Scheduler + \n + Built 9-14-2025 by Nate Ware + ")

    def browse_file(self):
        file_path = filedialog.askopenfilename(
            title="Select CSV File",
            filetypes=(("CSV files", "*.csv"), ("All files", "*.*"))
        )
        if file_path:
            self.csv_file = file_path
            print(f"✅ Loaded file: {os.path.basename(file_path)}\n")

    def browse_past_shifts(self):
        file_path = filedialog.askopenfilename(
            title="Select Past Shifts CSV",
            filetypes=(("CSV files", "*.csv"), ("All files", "*.*"))
        )
        if file_path:
            self.past_shifts_file = file_path
            print(f"✅ Loaded past shifts: {os.path.basename(file_path)}\n")

    def _read_staffing(self):
        """Read people-per-shift inputs; returns None (after printing an error) if invalid"""
        try:
            counts = {key: int(entry.get()) for key, entry in self.staff_entries.items()}
        except ValueError:
            print("❌ Error: People per shift must be whole numbers.\n")
            return None
        if any(n < 0 for n in counts.values()) or sum(counts.values()) == 0:
            print("❌ Error: People per shift can't be negative, and at least one is required.\n")
            return None
        return counts

    def _build_scheduler(self):
        staffing = self._read_staffing()
        if staffing is None:
            return None
        scheduler = TablingScheduler(num_seniors=staffing["seniors"], num_board=staffing["board"],
                                     num_oncall=staffing["oncall"])
        scheduler.load_data(self.csv_file)
        if self.past_shifts_file:
            scheduler.load_past_shifts(self.past_shifts_file)
        return scheduler

    def generate_schedule(self):
        if not self.csv_file:
            print("❌ Error: Please select a CSV file first.\n")
            return

        start_date = self.date_entry.get()
        try:
            num_weeks = int(self.weeks_entry.get())
        except ValueError:
            print("❌ Error: Number of weeks must be an integer.\n")
            return

        scheduler = self._build_scheduler()
        if scheduler is None:
            return
        scheduler.generate_schedule(start_date, num_weeks=num_weeks)

        output_file = f"tabling_schedule_{start_date.replace('-', '_')}.xlsx"
        scheduler.export_weekly_excel("template/weekly_tabling_schedule_template.xlsx", output_file)

        self.last_start_date = start_date
        self.last_num_weeks = num_weeks
        self.last_output_file = output_file
        self.regenerate_button.config(state=tk.NORMAL)

        print(f"\n✅ Schedule exported to {output_file}\n")

    def regenerate_schedule(self):
        if not self.csv_file or not self.last_start_date or not self.last_num_weeks:
            print("❌ Error: No previous schedule to regenerate.\n")
            return

        scheduler = self._build_scheduler()
        if scheduler is None:
            return
        scheduler.generate_schedule(self.last_start_date, num_weeks=self.last_num_weeks)

        output_file = self.last_output_file
        scheduler.export_schedule(output_file)

        print(f"\n🔄 Schedule regenerated and exported to {output_file}\n")


class TextRedirector:
    """Redirects print() output to Tkinter Text widget"""
    def __init__(self, widget):
        self.widget = widget

    def write(self, text):
        self.widget.insert(tk.END, text)
        self.widget.see(tk.END)

    def flush(self):
        pass


if __name__ == "__main__":
    root = tk.Tk()
    app = SchedulerApp(root)
    root.mainloop()
