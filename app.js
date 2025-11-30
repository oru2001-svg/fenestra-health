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

const INSTANT_DB_APP_ID = '408eaba0-832e-474b-87fc-c2deb7861fd2';
const INSTANT_DB_API = 'https://api.instantdb.com/v1/query';

async function runSQL(sql) {
  const response = await fetch(INSTANT_DB_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: INSTANT_DB_APP_ID, sql }),
  });
  if (!response.ok) {
    throw new Error(`InstantDB error ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.rows) {
    throw new Error('InstantDB response missing rows');
  }
  return payload.rows;
}

async function loadCSV(path) {
  const response = await fetch(path);
  const text = await response.text();
  const [header, ...rows] = text.trim().split('\n');
  const keys = header.split(',');
  return rows.map((row) => {
    const values = row.split(',');
    return Object.fromEntries(keys.map((key, i) => [key.trim(), values[i]?.trim?.() ?? '']));
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

function periodRange(period, dataDates = []) {
  const dates = dataDates.filter((d) => !Number.isNaN(d?.getTime?.()));
  if (!dates.length) {
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

  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  const start = bucketStart(minDate, period);
  const end = bucketStart(maxDate, period);
  return { start, end };
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
  const parsed = data
    .map((row) => ({ ...row, _date: new Date(row[dateKey]) }))
    .filter((row) => !Number.isNaN(row._date.getTime()));
  const { start, end } = periodRange(
    period,
    parsed.map((row) => row._date)
  );
  const buckets = [];
  let cursor = bucketStart(start, period);
  while (cursor <= end) {
    buckets.push(new Date(cursor));
    cursor = nextBucket(cursor, period);
  }

  const bucketIndex = new Map(buckets.map((b, i) => [b.toISOString(), i]));
  const seriesNames = Array.from(new Set(parsed.map((d) => d[seriesKey] || 'Value')));
  const seriesData = Object.fromEntries(seriesNames.map((name) => [name, Array(buckets.length).fill(0)]));

  parsed.forEach((row) => {
    const date = row._date;
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

function normalizeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function loadDataFromInstantDB() {
  const revenueQuery = `
    SELECT
      Date_of_Service AS date,
      Line_of_Business AS type,
      SUM(Total_Payment) AS amount
    FROM synthetic_claims_fp_twofac_twoprov
    GROUP BY 1, 2
    ORDER BY 1
  `;

  const expenseQuery = `
    SELECT
      Date AS date,
      Category AS category,
      SUM(-Value) AS amount
    FROM general_ledger_family_practice_twoprov_clean
    WHERE Category IN ('Expense', 'COGS')
    GROUP BY 1, 2
    ORDER BY 1
  `;

  const procedureQuery = `
    SELECT
      CPT_Code AS name,
      COUNT(*) AS volume,
      SUM(Total_Payment) AS revenue
    FROM synthetic_claims_fp_twofac_twoprov
    GROUP BY 1
    ORDER BY 3 DESC
    LIMIT 12
  `;

  const physicianRevenueQuery = `
    SELECT
      Provider_Name AS name,
      SUM(Total_Payment) AS revenue,
      COUNT(*) AS visits
    FROM synthetic_claims_fp_twofac_twoprov
    GROUP BY 1
  `;

  const physicianExpenseQuery = `
    SELECT
      COALESCE(Provider, 'Unassigned') AS name,
      SUM(-Value) AS expense
    FROM general_ledger_family_practice_twoprov_clean
    WHERE Category IN ('Expense', 'COGS')
    GROUP BY 1
  `;

  const utilizationQuery = `
    SELECT
      Date_of_Service AS date,
      COUNT(DISTINCT VisitID) AS visits,
      SUM(Total_Payment) AS payments
    FROM synthetic_claims_fp_twofac_twoprov
    GROUP BY 1
    ORDER BY 1
  `;

  const [revenueRows, expenseRows, procedureRows, physicianRevenueRows, physicianExpenseRows, utilizationRows] =
    await Promise.all([
      runSQL(revenueQuery),
      runSQL(expenseQuery),
      runSQL(procedureQuery),
      runSQL(physicianRevenueQuery),
      runSQL(physicianExpenseQuery),
      runSQL(utilizationQuery),
    ]);

  const totalVisits = utilizationRows.reduce((sum, row) => sum + Number(row.visits || 0), 0);
  const totalExpenses = physicianExpenseRows.reduce((sum, row) => sum + Number(row.expense || 0), 0);
  const avgExpensePerVisit = totalVisits ? totalExpenses / totalVisits : 0;
  const expenseByPhysician = new Map(
    physicianExpenseRows.map((row) => [row.name || 'Unassigned', Number(row.expense || 0)])
  );

  revenueData = revenueRows
    .map((row) => ({
      date: normalizeDate(row.date),
      amount: Number(row.amount || 0),
      type: row.type || 'Claims',
    }))
    .filter((row) => row.date);

  expenseData = expenseRows
    .map((row) => ({
      date: normalizeDate(row.date),
      category: row.category || 'Expense',
      amount: Number(row.amount || 0),
    }))
    .filter((row) => row.date);

  optimizeTrend = utilizationRows
    .flatMap((row) => {
      const date = normalizeDate(row.date);
      if (!date) return [];
      const visits = Number(row.visits || 0);
      const payments = Number(row.payments || 0);
      return [
        { date, metric: 'Capacity', value: visits },
        { date, metric: 'Utilization', value: visits ? payments / visits : 0 },
      ];
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  profitabilityData = {
    procedure: procedureRows.map((row) => ({
      name: row.name || 'Unspecified CPT',
      revenue: Number(row.revenue || 0),
      expense: Number(row.volume || 0) * avgExpensePerVisit,
    })),
    physician: physicianRevenueRows.map((row) => {
      const name = row.name || 'Unassigned';
      const visits = Number(row.visits || 0);
      const expense = expenseByPhysician.get(name) ?? avgExpensePerVisit * visits;
      return {
        name,
        revenue: Number(row.revenue || 0),
        expense,
      };
    }),
  };
}

async function loadFallbackFromCSV() {
  const [ledger, claims] = await Promise.all([
    loadCSV('data/general_ledger_family_practice_twoprov_clean.csv'),
    loadCSV('data/synthetic_claims_fp_twofac_twoprov.csv'),
  ]);

  const normalizeNumber = (value) => Number(String(value).replace(/[^0-9.-]/g, '')) || 0;
  revenueData = claims
    .map((row) => ({
      date: normalizeDate(row.Date_of_Service),
      type: row.Line_of_Business || 'Claims',
      amount: normalizeNumber(row.Total_Payment),
    }))
    .filter((row) => row.date);

  expenseData = ledger
    .filter((row) => ['Expense', 'COGS'].includes(row.Category))
    .map((row) => ({
      date: normalizeDate(row.Date),
      category: row.Category,
      amount: Math.abs(normalizeNumber(row.Value)),
    }))
    .filter((row) => row.date);

  const visitsByDate = new Map();
  claims.forEach((row) => {
    const date = normalizeDate(row.Date_of_Service);
    if (!date) return;
    const payments = normalizeNumber(row.Total_Payment);
    visitsByDate.set(date, {
      visits: (visitsByDate.get(date)?.visits || 0) + 1,
      payments: (visitsByDate.get(date)?.payments || 0) + payments,
    });
  });
  optimizeTrend = Array.from(visitsByDate.entries()).flatMap(([date, { visits, payments }]) => [
    { date, metric: 'Capacity', value: visits },
    { date, metric: 'Utilization', value: visits ? payments / visits : 0 },
  ]);

  const totalVisits = claims.length || 1;
  const totalExpenses = ledger
    .filter((row) => ['Expense', 'COGS'].includes(row.Category))
    .reduce((sum, row) => sum + Math.abs(normalizeNumber(row.Value)), 0);
  const avgExpensePerVisit = totalExpenses / totalVisits;

  const expensesByProvider = ledger
    .filter((row) => ['Expense', 'COGS'].includes(row.Category))
    .reduce((acc, row) => {
      const name = row.Provider || 'Unassigned';
      acc.set(name, (acc.get(name) || 0) + Math.abs(normalizeNumber(row.Value)));
      return acc;
    }, new Map());

  const procedures = claims.reduce((acc, row) => {
    const key = row.CPT_Code || 'Unspecified CPT';
    const payment = normalizeNumber(row.Total_Payment);
    const prev = acc.get(key) || { revenue: 0, volume: 0 };
    acc.set(key, { revenue: prev.revenue + payment, volume: prev.volume + 1 });
    return acc;
  }, new Map());

  profitabilityData = {
    procedure: Array.from(procedures.entries())
      .map(([name, info]) => ({
        name,
        revenue: info.revenue,
        expense: info.volume * avgExpensePerVisit,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 12),
    physician: Object.values(
      claims.reduce((acc, row) => {
        const name = row.Provider_Name || 'Unassigned';
        const payment = normalizeNumber(row.Total_Payment);
        if (!acc[name]) acc[name] = { name, revenue: 0, visits: 0 };
        acc[name].revenue += payment;
        acc[name].visits += 1;
        return acc;
      }, {})
    ).map((row) => ({
      name: row.name,
      revenue: row.revenue,
      expense: expensesByProvider.get(row.name) || row.visits * avgExpensePerVisit,
    })),
  };
}

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

function latestDataDate() {
  const dates = [
    ...revenueData.map((r) => new Date(r.date)),
    ...expenseData.map((e) => new Date(e.date)),
  ].filter((d) => !Number.isNaN(d.getTime()));
  if (!dates.length) return new Date();
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

function computeCashSnapshot() {
  const cutoff = latestDataDate();
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
  const cutoff = latestDataDate();
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

function renderOptimizeIdeas() {
  const ideas = [];

  const topProcedure = profitabilityData.procedure[0];
  if (topProcedure) {
    ideas.push(
      `Promote ${topProcedure.name} to lift revenue; avg margin ${currency(
        Number(topProcedure.revenue) - Number(topProcedure.expense)
      )}`
    );
  }

  const topPhysician = [...profitabilityData.physician].sort(
    (a, b) => Number(b.revenue) - Number(a.revenue)
  )[0];
  if (topPhysician) {
    ideas.push(
      `Double down on ${topPhysician.name}'s schedule — ${currency(topPhysician.revenue)} collected with margin ${currency(
        Number(topPhysician.revenue) - Number(topPhysician.expense)
      )}`
    );
  }

  const avgCapacity = optimizeTrend
    .filter((row) => row.metric === 'Capacity')
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
  const avgUtilization = optimizeTrend
    .filter((row) => row.metric === 'Utilization')
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
  if (avgCapacity && avgUtilization) {
    const utilizationRate = avgUtilization / (optimizeTrend.length / 2 || 1);
    ideas.push(`Target +10% visit slots to match utilization trend (${utilizationRate.toFixed(1)} per visit).`);
  }

  renderList('optimize-list', ideas);
}

async function init() {
  try {
    await loadDataFromInstantDB();
  } catch (error) {
    console.warn('InstantDB unavailable, using CSV fallback', error);
    await loadFallbackFromCSV();
  }

  setupToggle('overview-toggle', renderOverview, 'month');
  setupToggle('revenue-toggle', renderRevenue, 'month');
  setupToggle('expense-toggle', renderExpenses, 'month');
  setupToggle('optimize-toggle', renderOptimize, 'week');

  renderRevenueMix();
  renderProfitability();
  renderOptimizeIdeas();
}

init();
