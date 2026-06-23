"use strict";

const fmt = (n) => "LKR " + Number(n).toLocaleString("en-LK");

async function api(path, method = "GET", body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2200);
}

let DASH = null;

// ---- Render dashboard ----
async function loadDashboard() {
  DASH = await api("/api/dashboard");
  renderFormula(DASH.budget);
  renderCommitment(DASH);
  renderProgress(DASH.savings_progress);
  renderAllocation(DASH);
}

function renderFormula(b) {
  document.getElementById("fSalary").textContent = fmt(b.salary);
  document.getElementById("fClass").textContent = fmt(b.class_installment);
  document.getElementById("fSavings").textContent = fmt(b.savings_commitment);
  document.getElementById("fSpendable").textContent = fmt(b.spendable_budget);
}

function renderCommitment(d) {
  const c = d.commitment;
  document.getElementById("commitMonth").textContent = "· " + c.month_label;
  document.getElementById("commitClassAmt").textContent = fmt(c.class_installment.amount);
  document.getElementById("commitSavingsAmt").textContent =
    fmt(c.savings.amount) + (c.savings.scheduled ? "" : " · starts Jul 2026");

  const classToggle = document.getElementById("classToggle");
  classToggle.checked = c.class_installment.paid;
  document.getElementById("classToggleLbl").textContent = c.class_installment.paid ? "Paid" : "Unpaid";

  const savingsToggle = document.getElementById("savingsToggle");
  savingsToggle.checked = c.savings.paid;
  savingsToggle.disabled = !c.savings.scheduled;
  document.getElementById("savingsToggleLbl").textContent =
    !c.savings.scheduled ? "—" : (c.savings.paid ? "Paid" : "Unpaid");
  savingsToggle.dataset.scheduleId = c.savings.schedule_id || "";

  document.getElementById("spentThisMonth").textContent = fmt(c.spent_this_month);
  const rem = document.getElementById("spendableRemaining");
  rem.textContent = fmt(c.spendable_remaining);
  rem.classList.toggle("negative", c.spendable_remaining < 0);
}

function renderProgress(p) {
  document.getElementById("totalSaved").textContent = fmt(p.total_saved);
  document.getElementById("totalProjected").textContent = fmt(p.total_projected);
  document.getElementById("monthsDone").textContent = `${p.months_completed} / ${p.months_total}`;
  document.getElementById("monthsLeft").textContent = p.months_remaining;
  document.getElementById("progressFill").style.width = p.percent + "%";
  document.getElementById("progressPct").textContent =
    `${p.percent}% toward ${fmt(p.total_projected)}`;
  const note = document.getElementById("missedNote");
  if (p.months_missed > 0) {
    note.textContent = `⚠ ${p.months_missed} missed month(s) — log a catch-up in the timeline below.`;
    note.style.color = "var(--danger)";
  } else {
    note.textContent = "";
  }
}

function renderAllocation(d) {
  const a = d.allocation;
  document.getElementById("allocCommitted").textContent = a.committed.toLocaleString("en-LK");
  document.getElementById("allocMonth").textContent = d.current_month_label;
  const badge = document.getElementById("allocBadge");
  if (a.balanced) {
    badge.textContent = "✓ Fully allocated";
    badge.classList.remove("warn");
  } else if (a.unallocated > 0) {
    badge.textContent = `${fmt(a.unallocated)} unallocated`;
    badge.classList.add("warn");
  } else {
    badge.textContent = `Over-allocated by ${fmt(-a.unallocated)}`;
    badge.classList.add("warn");
  }

  const list = document.getElementById("goalsList");
  list.innerHTML = "";
  if (d.goals.length === 0) {
    list.innerHTML = `<p class="muted">No goals yet. Add one below to split your savings.</p>`;
  }
  for (const g of d.goals) {
    const el = document.createElement("div");
    el.className = "goal";
    el.innerHTML = `
      <div class="goal-top">
        <span class="goal-name">${escapeHtml(g.name)}</span>
        <span class="goal-alloc">${fmt(g.monthly_allocation)}/mo</span>
      </div>
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${Math.min(g.percent,100)}%"></div></div>
      <div class="goal-meta">
        <span>${fmt(g.total_contributed)} of ${fmt(g.target_amount)} (${g.percent}%)</span>
        <span class="goal-actions">
          <span class="chip ${g.logged_this_month ? "logged" : ""}">${g.logged_this_month ? "✓ Logged" : "Not logged"}</span>
          <button class="tiny ${g.logged_this_month ? "secondary" : ""}" data-log="${g.id}">
            ${g.logged_this_month ? "Undo" : "Log this month"}
          </button>
          <button class="tiny danger" data-del="${g.id}">✕</button>
        </span>
      </div>`;
    list.appendChild(el);
  }

  list.querySelectorAll("[data-log]").forEach((b) =>
    b.addEventListener("click", () => logContribution(b.dataset.log)));
  list.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteGoal(b.dataset.del)));
}

// ---- Schedule timeline ----
async function loadSchedule() {
  const rows = await api("/api/schedule");
  const body = document.getElementById("scheduleBody");
  body.innerHTML = "";
  const todayMonth = DASH ? DASH.current_month : "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.className = r.status;
    const isMissed = r.status === "missed";
    tr.innerHTML = `
      <td>${r.month_label}</td>
      <td>${fmt(r.amount)}</td>
      <td><span class="status-pill ${r.status}">${r.status}</span></td>
      <td>${r.actual_date || "—"}</td>
      <td>
        ${r.status !== "paid" ? `<button class="tiny ${isMissed ? "catchup" : ""}" data-paid="${r.id}">${isMissed ? "Log catch-up" : "Mark paid"}</button>` : `<button class="tiny secondary" data-undo="${r.id}">Undo</button>`}
        ${r.status === "pending" ? `<button class="tiny danger" data-miss="${r.id}">Mark missed</button>` : ""}
      </td>`;
    body.appendChild(tr);
  }
  body.querySelectorAll("[data-paid]").forEach((b) =>
    b.addEventListener("click", () => setSchedule(b.dataset.paid, "paid")));
  body.querySelectorAll("[data-miss]").forEach((b) =>
    b.addEventListener("click", () => setSchedule(b.dataset.miss, "missed")));
  body.querySelectorAll("[data-undo]").forEach((b) =>
    b.addEventListener("click", () => setSchedule(b.dataset.undo, "pending")));
}

async function setSchedule(id, status) {
  await api(`/api/schedule/${id}`, "POST", { status });
  toast(status === "paid" ? "Marked as paid ✓" : status === "missed" ? "Marked missed" : "Reset to pending");
  await refreshAll();
}

// ---- Actions ----
async function logContribution(id) {
  await api(`/api/goals/${id}/contribution`, "POST", {});
  await loadDashboard();
}

async function deleteGoal(id) {
  await api(`/api/goals/${id}/delete`, "POST", {});
  toast("Goal removed");
  await loadDashboard();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function refreshAll() {
  await loadDashboard();
  await loadSchedule();
}

// ---- Wire up events ----
function wire() {
  document.getElementById("classToggle").addEventListener("change", async (e) => {
    await api("/api/commitment/class", "POST", { paid: e.target.checked });
    await loadDashboard();
  });

  document.getElementById("savingsToggle").addEventListener("change", async (e) => {
    const id = e.target.dataset.scheduleId;
    if (!id) return;
    await api(`/api/schedule/${id}`, "POST", { status: e.target.checked ? "paid" : "pending" });
    await refreshAll();
  });

  document.getElementById("addExpenseBtn").addEventListener("click", async () => {
    const amount = Number(document.getElementById("expAmount").value);
    const description = document.getElementById("expDesc").value;
    if (!amount || amount <= 0) { toast("Enter a valid amount"); return; }
    await api("/api/expenses", "POST", { amount, description });
    document.getElementById("expAmount").value = "";
    document.getElementById("expDesc").value = "";
    toast("Spend logged");
    await loadDashboard();
  });

  document.getElementById("addGoalBtn").addEventListener("click", async () => {
    const name = document.getElementById("newGoalName").value.trim();
    if (!name) { toast("Goal name required"); return; }
    await api("/api/goals", "POST", {
      name,
      target_amount: Number(document.getElementById("newGoalTarget").value) || 0,
      monthly_allocation: Number(document.getElementById("newGoalAlloc").value) || 0,
    });
    document.getElementById("newGoalName").value = "";
    document.getElementById("newGoalTarget").value = "";
    document.getElementById("newGoalAlloc").value = "";
    toast("Goal added");
    await loadDashboard();
  });

  // Settings modal
  const modal = document.getElementById("settingsModal");
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("setSalary").value = DASH.budget.salary;
    document.getElementById("setClass").value = DASH.budget.class_installment;
    document.getElementById("setSavings").value = DASH.budget.savings_commitment;
    modal.hidden = false;
  });
  document.getElementById("cancelSettings").addEventListener("click", () => (modal.hidden = true));
  document.getElementById("saveSettings").addEventListener("click", async () => {
    await api("/api/config", "POST", {
      salary: Number(document.getElementById("setSalary").value),
      class_installment: Number(document.getElementById("setClass").value),
      savings_commitment: Number(document.getElementById("setSavings").value),
    });
    modal.hidden = true;
    toast("Budget updated");
    await loadDashboard();
  });
}

(async function init() {
  wire();
  await refreshAll();
  document.getElementById("todayLabel").textContent =
    "Today · " + new Date(DASH.today).toDateString();
})();
