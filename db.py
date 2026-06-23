"""
Data layer for Finance_ME.

Uses the Python standard library only (sqlite3) so the app runs anywhere with
no install step. The schema and seed data are created automatically on first
run via init_db().
"""

import os
import sqlite3
from datetime import date

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "finance.db")

# --- Budget constants (the user's fixed monthly commitment) -----------------
DEFAULT_SALARY = 75000
DEFAULT_CLASS_INSTALLMENT = 40000
DEFAULT_SAVINGS_COMMITMENT = 10000

# Savings schedule window: first payment July 2026, last payment December 2030.
SCHEDULE_START = (2026, 7)
SCHEDULE_END = (2030, 12)


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _months_between(start, end):
    """Yield 'YYYY-MM' strings inclusive from start (y, m) to end (y, m)."""
    y, m = start
    while (y, m) <= end:
        yield f"{y:04d}-{m:02d}", y, m
        m += 1
        if m == 13:
            m, y = 1, y + 1


def init_db():
    """Create tables and seed default data if the database is empty."""
    conn = get_conn()
    cur = conn.cursor()

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS savings_schedule (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            scheduled_date TEXT    NOT NULL,            -- YYYY-MM-DD (1st of month)
            amount         INTEGER NOT NULL,
            status         TEXT    NOT NULL DEFAULT 'pending', -- pending|paid|missed
            actual_date    TEXT,                        -- when the transfer happened
            notes          TEXT,
            created_at     TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS savings_goals (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT    NOT NULL,
            target_amount      INTEGER NOT NULL DEFAULT 0,
            monthly_allocation INTEGER NOT NULL DEFAULT 0,
            target_date        TEXT,                        -- YYYY-MM the goal is wanted by
            created_at         TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS goal_contributions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id    INTEGER NOT NULL,
            month      TEXT    NOT NULL,                -- YYYY-MM
            amount     INTEGER NOT NULL,
            created_at TEXT    NOT NULL,
            UNIQUE(goal_id, month),
            FOREIGN KEY(goal_id) REFERENCES savings_goals(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS monthly_commitments (
            month       TEXT PRIMARY KEY,               -- YYYY-MM
            class_paid  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS expenses (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            spent_date  TEXT    NOT NULL,               -- YYYY-MM-DD
            amount      INTEGER NOT NULL,
            description TEXT,
            created_at  TEXT    NOT NULL
        );
        """
    )

    # --- Lightweight migration: add target_date to pre-existing databases ---
    cols = {r[1] for r in cur.execute("PRAGMA table_info(savings_goals)").fetchall()}
    if "target_date" not in cols:
        cur.execute("ALTER TABLE savings_goals ADD COLUMN target_date TEXT")

    now = date.today().isoformat()

    # --- Seed config ---
    defaults = {
        "salary": DEFAULT_SALARY,
        "class_installment": DEFAULT_CLASS_INSTALLMENT,
        "savings_commitment": DEFAULT_SAVINGS_COMMITMENT,
    }
    for key, value in defaults.items():
        cur.execute(
            "INSERT OR IGNORE INTO config(key, value) VALUES (?, ?)",
            (key, str(value)),
        )

    # --- Seed the 54-entry savings schedule (only if empty) ---
    existing = cur.execute("SELECT COUNT(*) FROM savings_schedule").fetchone()[0]
    if existing == 0:
        amount = int(cur.execute(
            "SELECT value FROM config WHERE key='savings_commitment'"
        ).fetchone()[0])
        rows = [
            (f"{ym}-01", amount, "pending", None, None, now)
            for ym, _, _ in _months_between(SCHEDULE_START, SCHEDULE_END)
        ]
        cur.executemany(
            """INSERT INTO savings_schedule
               (scheduled_date, amount, status, actual_date, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            rows,
        )

    # --- Seed example goals (House + Bike) matching the spec, only if empty ---
    existing_goals = cur.execute("SELECT COUNT(*) FROM savings_goals").fetchone()[0]
    if existing_goals == 0:
        cur.executemany(
            """INSERT INTO savings_goals
               (name, target_amount, monthly_allocation, target_date, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            [
                ("House Fund", 500000, 6000, "2030-12", now),
                ("Bike", 250000, 4000, "2030-12", now),
            ],
        )

    conn.commit()
    conn.close()


# --- Config helpers ---------------------------------------------------------

def get_config():
    conn = get_conn()
    rows = conn.execute("SELECT key, value FROM config").fetchall()
    conn.close()
    cfg = {r["key"]: int(r["value"]) for r in rows}
    salary = cfg.get("salary", DEFAULT_SALARY)
    klass = cfg.get("class_installment", DEFAULT_CLASS_INSTALLMENT)
    savings = cfg.get("savings_commitment", DEFAULT_SAVINGS_COMMITMENT)
    return {
        "salary": salary,
        "class_installment": klass,
        "savings_commitment": savings,
        # Core formula: Salary - Class Installment - Savings = Spendable Budget
        "spendable_budget": salary - klass - savings,
    }


def update_config(salary=None, class_installment=None, savings_commitment=None):
    conn = get_conn()
    for key, val in (
        ("salary", salary),
        ("class_installment", class_installment),
        ("savings_commitment", savings_commitment),
    ):
        if val is not None:
            conn.execute(
                "INSERT INTO config(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, str(int(val))),
            )
    conn.commit()
    conn.close()
    return get_config()
