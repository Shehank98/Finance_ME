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
  const pc = document.getElementById("planCommit");
  if (pc) pc.textContent = a.committed.toLocaleString("en-LK");
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

    // Build the "savings method" line for this goal.
    let plan = "";
    if (g.monthly_allocation > 0 && g.projected_completion_label) {
      plan = `At ${fmt(g.monthly_allocation)}/mo → reaches target by <strong>${g.projected_completion_label}</strong> (${g.months_to_go} mo)`;
    } else if (g.monthly_allocation <= 0) {
      plan = `No monthly allocation set yet`;
    }
    let track = "";
    if (g.on_track === true && g.target_date_label) {
      track = `<span class="goal-track on">On track for ${g.target_date_label}</span>`;
    } else if (g.on_track === false && g.target_date_label) {
      const need = g.required_monthly ? ` — needs ${fmt(g.required_monthly)}/mo` : "";
      track = `<span class="goal-track off">Behind ${g.target_date_label}${need}</span>`;
    }

    el.innerHTML = `
      <div class="goal-top">
        <span class="goal-name">${escapeHtml(g.name)} ${g.target_date_label ? `<span class="muted">· by ${g.target_date_label}</span>` : ""}</span>
        <span class="goal-alloc">${fmt(g.monthly_allocation)}/mo</span>
      </div>
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${Math.min(g.percent,100)}%"></div></div>
      <div class="goal-meta">
        <span>${fmt(g.total_contributed)} of ${fmt(g.target_amount)} (${g.percent}%)</span>
        <span class="goal-actions">
          ${track}
          <span class="chip ${g.logged_this_month ? "logged" : ""}">${g.logged_this_month ? "✓ Logged" : "Not logged"}</span>
          <button class="tiny ${g.logged_this_month ? "secondary" : ""}" data-log="${g.id}">
            ${g.logged_this_month ? "Undo" : "Log this month"}
          </button>
          <button class="tiny danger" data-del="${g.id}">✕</button>
        </span>
      </div>
      ${plan ? `<div class="goal-meta" style="margin-top:0.35rem"><span>${plan}</span></div>` : ""}`;
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

// ---- Target planner ----
let LAST_PLAN_INPUT = null;

async function runPlan() {
  const name = document.getElementById("planName").value.trim();
  const target = Number(document.getElementById("planTarget").value);
  const saved = Number(document.getElementById("planSaved").value) || 0;
  const mode = document.getElementById("planMode").value;
  if (!target || target <= 0) { toast("Enter a target amount"); return; }

  const payload = { target_amount: target, current_saved: saved };
  if (mode === "date") {
    const d = document.getElementById("planDate").value;
    if (!d) { toast("Pick a target date"); return; }
    payload.target_date = d;
  } else {
    const mAmt = Number(document.getElementById("planMonthly").value);
    if (!mAmt || mAmt <= 0) { toast("Enter a monthly amount"); return; }
    payload.monthly_allocation = mAmt;
  }

  let plan;
  try {
    plan = await api("/api/plan", "POST", payload);
  } catch (e) { toast(e.message); return; }

  LAST_PLAN_INPUT = {
    name, target, saved, mode,
    target_date: payload.target_date || plan.completion_month,
    monthly: plan.required_monthly,
  };
  renderPlanResult(plan, name);
}

function renderPlanResult(plan, name) {
  const box = document.getElementById("planResult");
  box.hidden = false;
  box.classList.toggle("ok", plan.feasible);
  box.classList.toggle("bad", !plan.feasible);

  const label = name ? escapeHtml(name) : "this target";
  const showSaveBtn = plan.feasible && plan.required_monthly > 0;

  box.innerHTML = `
    <h3>${plan.feasible ? "✅ Here's your savings method" : "⚠ This target needs a rethink"}</h3>
    <div class="plan-numbers">
      <div><span class="n ${plan.feasible ? "accent" : "warn"}">${fmt(plan.required_monthly)}</span><span class="muted">per month</span></div>
      <div><span class="n">${plan.months_needed}</span><span class="muted">months</span></div>
      <div><span class="n">${plan.completion_month_label || "—"}</span><span class="muted">${plan.target_date ? "target date" : "done by"}</span></div>
      ${plan.remaining !== plan.target_amount ? `<div><span class="n">${fmt(plan.remaining)}</span><span class="muted">left to save</span></div>` : ""}
    </div>
    <p class="method">${escapeHtml(plan.summary)}</p>
    ${showSaveBtn ? `<div class="actions"><button id="savePlanBtn">＋ Save "${label}" as a goal (${fmt(plan.required_monthly)}/mo)</button></div>` : ""}
  `;

  if (showSaveBtn) {
    document.getElementById("savePlanBtn").addEventListener("click", savePlanAsGoal);
  }
}

async function savePlanAsGoal() {
  const p = LAST_PLAN_INPUT;
  if (!p) return;
  const name = p.name || "New goal";
  await api("/api/goals", "POST", {
    name,
    target_amount: p.target,
    monthly_allocation: p.monthly,
    target_date: p.mode === "date" ? p.target_date : null,
  });
  document.getElementById("planResult").hidden = true;
  document.getElementById("planName").value = "";
  document.getElementById("planTarget").value = "";
  document.getElementById("planSaved").value = "";
  toast(`Goal "${name}" saved with ${fmt(p.monthly)}/mo`);
  await loadDashboard();
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
      target_date: document.getElementById("newGoalDate").value || null,
    });
    document.getElementById("newGoalName").value = "";
    document.getElementById("newGoalTarget").value = "";
    document.getElementById("newGoalAlloc").value = "";
    document.getElementById("newGoalDate").value = "";
    toast("Goal added");
    await loadDashboard();
  });

  // Target planner
  document.getElementById("planMode").addEventListener("change", (e) => {
    const byDate = e.target.value === "date";
    document.getElementById("planDateWrap").hidden = !byDate;
    document.getElementById("planMonthlyWrap").hidden = byDate;
  });
  document.getElementById("planBtn").addEventListener("click", runPlan);

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
