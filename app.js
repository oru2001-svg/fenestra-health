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

navLinks.forEach((link) => link.addEventListener('click', () => showPanel(link.dataset.target)));

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

const periodConfig = {
  day: { label: 'Day', step: 'day', spanDays: 6 },
  week: { label: 'Week', step: 'week', spanDays: 83 },
  month: { label: 'Month', step: 'month', monthsBack: 11 },
};

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function periodRange(period) {
  const now = new Date();
  const config = periodConfig[period];
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() - config.monthsBack, 1);
    return { start, end: now };
  }
  const span = config.spanDays;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - span);
  return { start, end: now };
}

function bucketStart(date, period) {
  if (period === 'day') return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (period === 'week') return startOfWeek(date);
  return startOfMonth(date);
}

function nextBucket(date, period) {
  if (period === 'day') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  if (period === 'week') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function formatLabel(period, date) {
  if (period === 'day') return date.toLocaleDateString(undefined, { weekday: 'short' });
  if (period === 'week') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return date.toLocaleDateString(undefined, { month: 'short' });
}

function aggregateSeries(data, { period, dateKey = 'date', valueKey = 'value', seriesKey = 'series' }) {
  const { start, end } = periodRange(period);
  const buckets = [];
  let cursor = bucketStart(start, period);
  while (cursor <= end) {
    buckets.push(new Date(cursor));
    cursor = nextBucket(cursor, period);
  }

  const bucketIndex = new Map(buckets.map((b, i) => [b.toISOString(), i]));
  const seriesNames = Array.from(new Set(data.map((d) => d[seriesKey] || 'Value')));
  const seriesData = Object.fromEntries(seriesNames.map((name) => [name, Array(buckets.length).fill(0)]));

  data.forEach((row) => {
    const date = new Date(row[dateKey]);
    if (date < start || date > end) return;
    const key = bucketStart(date, period).toISOString();
    const idx = bucketIndex.get(key);
    if (idx === undefined) return;
    const name = row[seriesKey] || 'Value';
    seriesData[name][idx] += Number(row[valueKey]);
  });

  const labels = buckets.map((b) => formatLabel(period, b));
  return { labels, seriesData, buckets };
}

function renderLegend(container, colors) {
  const legend = document.createElement('div');
  legend.className = 'legend';
  Object.entries(colors).forEach(([name, color]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-swatch" style="background:${color}"></span>${name}`;
    legend.appendChild(item);
  });
  container.appendChild(legend);
}

function renderLineChart(containerId, labels, seriesData, { colors, valueFormatter = (v) => v.toFixed(0) }) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const width = 720;
  const height = 220;
  const padding = { top: 12, right: 14, bottom: 30, left: 46 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const seriesValues = Object.values(seriesData).flat();
  const maxValue = Math.max(...seriesValues, 1);

  const yTicks = 4;
  const yStep = maxValue / yTicks;

  const xStep = labels.length > 1 ? innerWidth / (labels.length - 1) : innerWidth;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // Grid lines and y-axis labels
  for (let i = 0; i <= yTicks; i++) {
    const y = padding.top + (innerHeight * i) / yTicks;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padding.left);
    line.setAttribute('x2', width - padding.right);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.classList.add('grid-line');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', padding.left - 8);
    label.setAttribute('y', y + 4);
    label.setAttribute('text-anchor', 'end');
    label.classList.add('axis-label');
    label.textContent = valueFormatter(maxValue - yStep * i);
    svg.appendChild(label);
  }

  // X labels
  labels.forEach((label, i) => {
    const x = padding.left + xStep * i;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', height - 8);
    text.setAttribute('text-anchor', 'middle');
    text.classList.add('axis-label');
    text.textContent = label;
    svg.appendChild(text);
  });

  Object.entries(seriesData).forEach(([name, values]) => {
    const points = values.map((val, i) => {
      const x = padding.left + xStep * i;
      const y = padding.top + innerHeight - (innerHeight * val) / maxValue;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', points.join(' '));
    path.setAttribute('stroke', colors[name] || '#2a8da1');
    path.classList.add('line');
    svg.appendChild(path);
  });

  container.appendChild(svg);
  renderLegend(container, colors);
}

function setupToggle(id, callback, defaultPeriod = 'month') {
  const group = document.getElementById(id);
  const buttons = group?.querySelectorAll('.toggle');
  if (!group || !buttons?.length) return;

  const setActive = (period) => {
    buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.period === period));
    callback(period);
  };

  buttons.forEach((btn) => btn.addEventListener('click', () => setActive(btn.dataset.period)));
  setActive(defaultPeriod);
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

let revenueData = [];
let expenseData = [];
let profitabilityData = { procedure: [], physician: [] };
let optimizeTrend = [];

function buildMarginRows() {
  const revenueByDate = new Map();
  revenueData.forEach((r) => {
    const key = r.date;
    revenueByDate.set(key, (revenueByDate.get(key) || 0) + Number(r.amount));
  });

  const expenseByDate = new Map();
  expenseData.forEach((e) => {
    const key = e.date;
    expenseByDate.set(key, (expenseByDate.get(key) || 0) + Number(e.amount));
  });

  const dates = new Set([...revenueByDate.keys(), ...expenseByDate.keys()]);
  return Array.from(dates).map((date) => ({
    date,
    series: 'Margin',
    value: (revenueByDate.get(date) || 0) - (expenseByDate.get(date) || 0),
  }));
}

function computeCashSnapshot() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const revenue = revenueData
    .filter((r) => new Date(r.date) >= cutoff)
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const expenses = expenseData
    .filter((e) => new Date(e.date) >= cutoff)
    .reduce((sum, e) => sum + Number(e.amount), 0);
  return currency(revenue - expenses);
}

function computeRunRate() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const total = expenseData
    .filter((e) => new Date(e.date) >= cutoff)
    .reduce((sum, e) => sum + Number(e.amount), 0);
  return currency(total);
}

function renderRevenue(period) {
  const { labels, seriesData } = aggregateSeries(revenueData, {
    period,
    dateKey: 'date',
    valueKey: 'amount',
    seriesKey: 'type',
  });
  renderLineChart('revenue-chart', labels, seriesData, {
    colors: { Claims: '#2a8da1', Capitation: '#7ccfbf' },
    valueFormatter: (v) => currency(v),
  });
}

function renderRevenueMix() {
  const totals = revenueData.reduce(
    (acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + Number(r.amount);
      return acc;
    },
    {}
  );
  const entries = Object.entries(totals).map(([type, amount]) => `${type}: ${currency(amount)}`);
  renderList('revenue-mix', entries);
}

function renderOverview(period) {
  const marginRows = buildMarginRows();
  const { labels, seriesData } = aggregateSeries(marginRows, {
    period,
    dateKey: 'date',
    valueKey: 'value',
  });
  renderLineChart('overview-margin', labels, seriesData, {
    colors: { Margin: '#2a8da1' },
    valueFormatter: (v) => currency(v),
  });
  document.getElementById('overview-cash').textContent = computeCashSnapshot();
}

function renderExpenses(period) {
  const { labels, seriesData } = aggregateSeries(expenseData, {
    period,
    dateKey: 'date',
    valueKey: 'amount',
    seriesKey: 'category',
  });
  renderLineChart('expense-chart', labels, seriesData, {
    colors: {
      Payroll: '#2a8da1',
      Rent: '#5d7bb8',
      Supplies: '#9c7bd1',
      'General Admin': '#8aa39a',
    },
    valueFormatter: (v) => currency(v),
  });
  document.getElementById('expense-runrate').textContent = computeRunRate();
}

function renderOptimize(period) {
  const { labels, seriesData } = aggregateSeries(optimizeTrend, {
    period,
    dateKey: 'date',
    valueKey: 'value',
    seriesKey: 'metric',
  });
  renderLineChart('optimize-chart', labels, seriesData, {
    colors: { Capacity: '#2a8da1', Utilization: '#5d7bb8' },
    valueFormatter: (v) => `${v.toFixed(0)}`,
  });
}

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

async function loadOptimizeList() {
  const ideas = await loadCSV('data/optimize.csv');
  const suggestions = ideas.map((idea) => `${idea.action} — expected lift ${idea.lift}%`);
  renderList('optimize-list', suggestions);
}

async function init() {
  [revenueData, expenseData, optimizeTrend] = await Promise.all([
    loadCSV('data/revenue.csv'),
    loadCSV('data/expenses.csv'),
    loadCSV('data/optimize_trend.csv'),
  ]);

  setupToggle('overview-toggle', renderOverview, 'month');
  setupToggle('revenue-toggle', renderRevenue, 'month');
  setupToggle('expense-toggle', renderExpenses, 'month');
  setupToggle('optimize-toggle', renderOptimize, 'week');

  renderRevenueMix();
  loadProfitability();
  loadOptimizeList();
}

init();
