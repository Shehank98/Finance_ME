# Finance_ME

A personal **budget & savings-schedule tracker** for a fixed monthly commitment plan.

Built with **zero dependencies** — just the Python standard library
(`http.server` + `sqlite3`) on the backend and vanilla HTML/CSS/JS on the front
end. No `pip install`, no build step.

## The budget model

```
Salary (75,000)
  − Class Installment (40,000)
  − Savings Commitment (10,000)
  = Spendable Budget (25,000)
```

LKR **25,000/month** is the real spendable number after commitments, and the
dashboard surfaces it prominently. As you log credit-card / daily spending, the
**spendable remaining** figure updates live.

## Features

### Budget Planner
The core formula above is shown as a live strip at the top of the dashboard.
Amounts are editable via **Budget settings** (⚙).

### Savings Schedule Tracker
- Fixed recurring saving of **LKR 10,000** on the first week of every month.
- Runs **July 2026 → December 2030** = **54 months** = **LKR 540,000** projected.
- The `savings_schedule` table is **auto-populated on first run** with all 54
  scheduled entries.
- Each month you log whether the 10,000 was **paid** or **missed**.
- Dashboard widget shows:
  - Total saved to date
  - Total projected by 2030 (LKR 540,000)
  - Months completed vs months remaining
  - **Missed months highlighted in red**, with a **catch-up payment** button
  - Progress bar toward 540,000

### Savings Allocation
The 10,000 monthly saving feeds into savings goals (House, Bike, …). You can
split the 10,000 across goals (e.g. Bike 4,000 + House 6,000) or send it all to
one. Each goal shows its monthly contribution and whether it was **logged this
month**. The allocation badge warns if your splits don't add up to 10,000.

### This Month's Commitment card
- **Class installment: LKR 40,000** — paid / unpaid toggle
- **Savings: LKR 10,000** — paid / unpaid toggle (synced with the schedule)
- **Spendable remaining: LKR 25,000** — updates as spending is logged

## Running

```bash
python3 app.py
# then open http://localhost:8000
```

Set a different port with `PORT=9000 python3 app.py`.

The SQLite database `finance.db` is created automatically on first run and is
git-ignored. Delete it to reset all data.

## Data model

| Table                 | Purpose                                                        |
|-----------------------|----------------------------------------------------------------|
| `config`              | Salary, class installment, savings commitment                  |
| `savings_schedule`    | 54 scheduled payments (`pending` / `paid` / `missed`)          |
| `savings_goals`       | Goals with target + monthly allocation                         |
| `goal_contributions`  | Per-goal, per-month logged contributions                       |
| `monthly_commitments` | Class-installment paid status per month                        |
| `expenses`            | Logged spending (drives "spendable remaining")                 |

## API

| Method | Path                              | Description                          |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/dashboard`                  | Aggregated dashboard data            |
| GET    | `/api/schedule`                   | Full 54-entry schedule timeline      |
| POST   | `/api/schedule/<id>`              | Update a schedule entry's status     |
| GET/POST | `/api/config`                   | Read / update budget amounts         |
| POST   | `/api/commitment/class`           | Toggle class installment paid        |
| POST   | `/api/goals`                      | Create a goal                        |
| POST   | `/api/goals/<id>`                 | Update a goal                        |
| POST   | `/api/goals/<id>/delete`          | Delete a goal                        |
| POST   | `/api/goals/<id>/contribution`    | Toggle this month's contribution     |
| POST   | `/api/expenses`                   | Log a spend                          |
