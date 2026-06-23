"""
Finance_ME — a personal budget & savings-schedule tracker.

Zero-dependency web app: Python standard library only (http.server + sqlite3).
Run with:  python3 app.py   then open http://localhost:8000

Core budget formula:
    Salary (75,000) - Class Installment (40,000) - Savings (10,000)
        = Spendable Budget (25,000)
"""

import json
import os
import re
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import db

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
PORT = int(os.environ.get("PORT", "8000"))

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def month_label(ym):
    """'2026-07' -> 'July 2026'."""
    y, m = ym.split("-")
    return f"{MONTH_NAMES[int(m)]} {y}"


def current_month():
    return date.today().strftime("%Y-%m")


# --- Aggregation -----------------------------------------------------------

def build_dashboard():
    cfg = db.get_config()
    conn = db.get_conn()
    cur = conn.cursor()

    cm = current_month()
    today = date.today().isoformat()

    # Savings schedule progress
    totals = cur.execute(
        """SELECT
               COUNT(*)                                          AS total_months,
               COALESCE(SUM(amount), 0)                          AS projected,
               COALESCE(SUM(CASE WHEN status='paid'   THEN amount ELSE 0 END), 0) AS saved,
               COALESCE(SUM(CASE WHEN status='paid'   THEN 1 ELSE 0 END), 0) AS completed,
               COALESCE(SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END), 0) AS missed
           FROM savings_schedule"""
    ).fetchone()

    total_months = totals["total_months"]
    projected = totals["projected"]
    saved = totals["saved"]
    completed = totals["completed"]
    missed = totals["missed"]

    savings_progress = {
        "total_projected": projected,
        "total_saved": saved,
        "months_total": total_months,
        "months_completed": completed,
        "months_remaining": total_months - completed,
        "months_missed": missed,
        "percent": round(saved / projected * 100, 1) if projected else 0.0,
    }

    # This month's commitment
    sched_row = cur.execute(
        "SELECT * FROM savings_schedule WHERE substr(scheduled_date,1,7)=?",
        (cm,),
    ).fetchone()
    commit_row = cur.execute(
        "SELECT class_paid FROM monthly_commitments WHERE month=?", (cm,)
    ).fetchone()

    spent = cur.execute(
        "SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE substr(spent_date,1,7)=?",
        (cm,),
    ).fetchone()["s"]

    commitment = {
        "month": cm,
        "month_label": month_label(cm),
        "class_installment": {
            "amount": cfg["class_installment"],
            "paid": bool(commit_row["class_paid"]) if commit_row else False,
        },
        "savings": {
            "amount": cfg["savings_commitment"],
            "scheduled": sched_row is not None,
            "schedule_id": sched_row["id"] if sched_row else None,
            "paid": (sched_row is not None and sched_row["status"] == "paid"),
        },
        "spent_this_month": spent,
        "spendable_remaining": cfg["spendable_budget"] - spent,
    }

    # Goals + allocations
    goal_rows = cur.execute(
        "SELECT * FROM savings_goals ORDER BY id"
    ).fetchall()
    goals = []
    allocation_total = 0
    for g in goal_rows:
        allocation_total += g["monthly_allocation"]
        contributed = cur.execute(
            "SELECT COALESCE(SUM(amount),0) AS s FROM goal_contributions WHERE goal_id=?",
            (g["id"],),
        ).fetchone()["s"]
        logged = cur.execute(
            "SELECT 1 FROM goal_contributions WHERE goal_id=? AND month=?",
            (g["id"], cm),
        ).fetchone()
        goals.append({
            "id": g["id"],
            "name": g["name"],
            "target_amount": g["target_amount"],
            "monthly_allocation": g["monthly_allocation"],
            "total_contributed": contributed,
            "logged_this_month": logged is not None,
            "percent": (round(contributed / g["target_amount"] * 100, 1)
                        if g["target_amount"] else 0.0),
        })

    conn.close()

    return {
        "today": today,
        "current_month": cm,
        "current_month_label": month_label(cm),
        "budget": cfg,
        "commitment": commitment,
        "savings_progress": savings_progress,
        "goals": goals,
        "allocation": {
            "committed": cfg["savings_commitment"],
            "allocated": allocation_total,
            "unallocated": cfg["savings_commitment"] - allocation_total,
            "balanced": allocation_total == cfg["savings_commitment"],
        },
    }


def get_schedule():
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT * FROM savings_schedule ORDER BY scheduled_date"
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        ym = r["scheduled_date"][:7]
        out.append({
            "id": r["id"],
            "scheduled_date": r["scheduled_date"],
            "month_label": month_label(ym),
            "amount": r["amount"],
            "status": r["status"],
            "actual_date": r["actual_date"],
            "notes": r["notes"],
        })
    return out


def update_schedule(sched_id, status=None, notes=None):
    conn = db.get_conn()
    cur = conn.cursor()
    row = cur.execute(
        "SELECT * FROM savings_schedule WHERE id=?", (sched_id,)
    ).fetchone()
    if row is None:
        conn.close()
        return None
    new_status = status if status is not None else row["status"]
    if new_status not in ("pending", "paid", "missed"):
        conn.close()
        raise ValueError("invalid status")
    actual = row["actual_date"]
    if new_status == "paid":
        actual = date.today().isoformat()
    elif new_status in ("pending", "missed"):
        actual = None
    new_notes = notes if notes is not None else row["notes"]
    cur.execute(
        "UPDATE savings_schedule SET status=?, actual_date=?, notes=? WHERE id=?",
        (new_status, actual, new_notes, sched_id),
    )
    conn.commit()
    conn.close()
    return True


# --- HTTP handler ----------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "FinanceME/1.0"

    def log_message(self, fmt, *args):  # quieter logs
        pass

    # -- helpers --
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, msg, status=400):
        self._send_json({"error": msg}, status)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        # prevent path traversal
        safe = os.path.normpath(path).lstrip("/")
        full = os.path.join(STATIC_DIR, safe)
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self._send_error("Not found", 404)
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
        }.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- routing --
    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/dashboard":
                self._send_json(build_dashboard())
            elif path == "/api/schedule":
                self._send_json(get_schedule())
            elif path == "/api/config":
                self._send_json(db.get_config())
            elif not path.startswith("/api/"):
                self._serve_static(path)
            else:
                self._send_error("Not found", 404)
        except Exception as exc:  # surface errors as JSON
            self._send_error(str(exc), 500)

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._read_json()
        try:
            if path == "/api/config":
                self._send_json(db.update_config(
                    salary=body.get("salary"),
                    class_installment=body.get("class_installment"),
                    savings_commitment=body.get("savings_commitment"),
                ))
                return

            m = re.match(r"^/api/schedule/(\d+)$", path)
            if m:
                ok = update_schedule(
                    int(m.group(1)),
                    status=body.get("status"),
                    notes=body.get("notes"),
                )
                if ok is None:
                    self._send_error("Schedule entry not found", 404)
                else:
                    self._send_json({"ok": True})
                return

            if path == "/api/commitment/class":
                self._toggle_class(body)
                return

            if path == "/api/goals":
                self._create_goal(body)
                return

            m = re.match(r"^/api/goals/(\d+)$", path)
            if m:
                self._update_goal(int(m.group(1)), body)
                return

            m = re.match(r"^/api/goals/(\d+)/delete$", path)
            if m:
                self._delete_goal(int(m.group(1)))
                return

            m = re.match(r"^/api/goals/(\d+)/contribution$", path)
            if m:
                self._log_contribution(int(m.group(1)), body)
                return

            if path == "/api/expenses":
                self._add_expense(body)
                return

            self._send_error("Not found", 404)
        except ValueError as exc:
            self._send_error(str(exc), 400)
        except Exception as exc:
            self._send_error(str(exc), 500)

    # -- action handlers --
    def _toggle_class(self, body):
        cm = body.get("month") or current_month()
        paid = 1 if body.get("paid") else 0
        conn = db.get_conn()
        conn.execute(
            "INSERT INTO monthly_commitments(month, class_paid, created_at) "
            "VALUES (?, ?, ?) "
            "ON CONFLICT(month) DO UPDATE SET class_paid=excluded.class_paid",
            (cm, paid, date.today().isoformat()),
        )
        conn.commit()
        conn.close()
        self._send_json({"ok": True})

    def _create_goal(self, body):
        name = (body.get("name") or "").strip()
        if not name:
            raise ValueError("Goal name is required")
        conn = db.get_conn()
        cur = conn.execute(
            "INSERT INTO savings_goals(name, target_amount, monthly_allocation, created_at) "
            "VALUES (?, ?, ?, ?)",
            (name, int(body.get("target_amount") or 0),
             int(body.get("monthly_allocation") or 0), date.today().isoformat()),
        )
        gid = cur.lastrowid
        conn.commit()
        conn.close()
        self._send_json({"ok": True, "id": gid})

    def _update_goal(self, gid, body):
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM savings_goals WHERE id=?", (gid,)).fetchone()
        if row is None:
            conn.close()
            self._send_error("Goal not found", 404)
            return
        name = body.get("name", row["name"])
        target = int(body.get("target_amount", row["target_amount"]))
        alloc = int(body.get("monthly_allocation", row["monthly_allocation"]))
        conn.execute(
            "UPDATE savings_goals SET name=?, target_amount=?, monthly_allocation=? WHERE id=?",
            (name, target, alloc, gid),
        )
        conn.commit()
        conn.close()
        self._send_json({"ok": True})

    def _delete_goal(self, gid):
        conn = db.get_conn()
        conn.execute("DELETE FROM savings_goals WHERE id=?", (gid,))
        conn.commit()
        conn.close()
        self._send_json({"ok": True})

    def _log_contribution(self, gid, body):
        cm = body.get("month") or current_month()
        conn = db.get_conn()
        row = conn.execute("SELECT monthly_allocation FROM savings_goals WHERE id=?",
                           (gid,)).fetchone()
        if row is None:
            conn.close()
            self._send_error("Goal not found", 404)
            return
        amount = int(body.get("amount") if body.get("amount") is not None
                     else row["monthly_allocation"])
        # toggle: if already logged this month, remove it
        existing = conn.execute(
            "SELECT id FROM goal_contributions WHERE goal_id=? AND month=?", (gid, cm)
        ).fetchone()
        if existing:
            conn.execute("DELETE FROM goal_contributions WHERE id=?", (existing["id"],))
        else:
            conn.execute(
                "INSERT INTO goal_contributions(goal_id, month, amount, created_at) "
                "VALUES (?, ?, ?, ?)",
                (gid, cm, amount, date.today().isoformat()),
            )
        conn.commit()
        conn.close()
        self._send_json({"ok": True})

    def _add_expense(self, body):
        amount = int(body.get("amount") or 0)
        if amount <= 0:
            raise ValueError("Expense amount must be positive")
        conn = db.get_conn()
        conn.execute(
            "INSERT INTO expenses(spent_date, amount, description, created_at) "
            "VALUES (?, ?, ?, ?)",
            (body.get("spent_date") or date.today().isoformat(),
             amount, (body.get("description") or "").strip(),
             date.today().isoformat()),
        )
        conn.commit()
        conn.close()
        self._send_json({"ok": True})


def main():
    db.init_db()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Finance_ME running at http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
