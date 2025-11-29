const panels = document.querySelectorAll('.panel');
const navLinks = document.querySelectorAll('.nav-link');
const toggleButton = document.getElementById('toggle-view');
let profitabilityMode = 'procedure';

const currency = (value) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function showPanel(id) {
  panels.forEach((panel) => panel.classList.remove('visible'));
  navLinks.forEach((link) => link.classList.remove('active'));
  document.getElementById(id).classList.add('visible');
  document.querySelector(`[data-target="${id}"]`).classList.add('active');
}

navLinks.forEach((link) =>
  link.addEventListener('click', () => showPanel(link.dataset.target))
);

async function loadCSV(path) {
  const response = await fetch(path);
  const text = await response.text();
  const [header, ...rows] = text.trim().split('\n');
  const keys = header.split(',');
  return rows.map((row) => {
    const values = row.split(',');
    return Object.fromEntries(keys.map((key, i) => [key.trim(), values[i].trim()]));
  });
}

function renderBars(target, data, valueKey, labelKey) {
  const container = document.getElementById(target);
  container.innerHTML = '';
  const max = Math.max(...data.map((d) => Number(d[valueKey])));
  data.forEach((d) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const height = Math.max(6, (Number(d[valueKey]) / max) * 100);
    bar.style.height = `${height}%`;
    bar.title = `${d[labelKey]} — ${currency(Number(d[valueKey]))}`;
    container.appendChild(bar);
  });
  const labels = document.createElement('div');
  labels.className = 'label-row';
  labels.innerHTML = `
    <span>${data[0]?.[labelKey] || ''}</span>
    <span>${data[data.length - 1]?.[labelKey] || ''}</span>
  `;
  container.appendChild(labels);
}

function renderSpark(target, data, valueKey) {
  const container = document.getElementById(target);
  container.innerHTML = '';
  const max = Math.max(...data.map((d) => Number(d[valueKey])));
  data.forEach((d) => {
    const line = document.createElement('div');
    line.className = 'spark-line';
    line.style.setProperty('--fill', `${(Number(d[valueKey]) / max) * 100}%`);
    container.appendChild(line);
  });
}

function renderList(target, items) {
  const list = document.getElementById(target);
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<li class="empty-state">No items to show</li>';
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
}

function renderTable(rows) {
  const tbody = document.querySelector('#profitability-table tbody');
  tbody.innerHTML = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.name}</td>
      <td>${currency(Number(row.revenue))}</td>
      <td>${currency(Number(row.expense))}</td>
      <td>${currency(Number(row.revenue) - Number(row.expense))}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadOverview() {
  const revenue = await loadCSV('data/revenue.csv');
  const expenses = await loadCSV('data/expenses.csv');
  const cash = revenue.reduce((sum, r) => sum + Number(r.amount), 0) -
    expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  document.getElementById('overview-cash').textContent = currency(cash);
  renderSpark('overview-margin', revenue, 'amount');
}

async function loadRevenue() {
  const revenue = await loadCSV('data/revenue.csv');
  renderBars('revenue-chart', revenue, 'amount', 'month');
  const totals = revenue.reduce(
    (acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + Number(r.amount);
      return acc;
    },
    {}
  );
  const entries = Object.entries(totals).map(([type, amount]) => `${type}: ${currency(amount)}`);
  renderList('revenue-mix', entries);
}

async function loadExpenses() {
  const expenses = await loadCSV('data/expenses.csv');
  renderBars('expense-chart', expenses, 'amount', 'category');
  const monthlyRunRate = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  document.getElementById('expense-runrate').textContent = currency(monthlyRunRate);
}

let profitabilityData = { procedure: [], physician: [] };

async function loadProfitability() {
  const data = await loadCSV('data/profitability.csv');
  profitabilityData = {
    procedure: data.filter((d) => d.view === 'procedure'),
    physician: data.filter((d) => d.view === 'physician'),
  };
  renderProfitability();
}

function renderProfitability() {
  const rows = profitabilityData[profitabilityMode];
  document.getElementById('profitability-title').textContent =
    `Profitability by ${profitabilityMode === 'procedure' ? 'Procedure' : 'Physician'}`;
  toggleButton.textContent = profitabilityMode === 'procedure' ? 'View by Physician' : 'View by Procedure';
  renderTable(rows);
}

toggleButton.addEventListener('click', () => {
  profitabilityMode = profitabilityMode === 'procedure' ? 'physician' : 'procedure';
  renderProfitability();
});

async function loadOptimize() {
  const ideas = await loadCSV('data/optimize.csv');
  const suggestions = ideas.map((idea) => `${idea.action} — expected lift ${idea.lift}%`);
  renderList('optimize-list', suggestions);
  renderBars('optimize-chart', ideas, 'lift', 'action');
}

function init() {
  loadOverview();
  loadRevenue();
  loadExpenses();
  loadProfitability();
  loadOptimize();
}

init();
