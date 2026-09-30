/* Sugarcane irrigation advisory: web frontend for the FastAPI service.
 * No build step and no framework. Talks to the API on the same origin. */
"use strict";

// ------------------------------------------------------------------ state
const STATUS = {
  IRRIGATE_NOW: { label: "Irrigate now", color: "#d03b3b", level: "critical" },
  IRRIGATE_SOON: { label: "Irrigate within 3 days", color: "#fab219", level: "warning" },
  NOT_REQUIRED: { label: "Not required yet", color: "#0ca30c", level: "good" },
};
const STAGES = [
  ["initial", "Germination"],
  ["development", "Tillering"],
  ["mid", "Grand growth"],
  ["late", "Maturity"],
];
const SOURCE_LABEL = { sensor: "field probe", ml_model: "ML estimate" };

const state = {
  options: null,
  farms: [],
  farmId: null,
  detail: null,
  plan: null,
  fleet: null,
  fleetKey: null,
  plotMap: null,
  plotLayer: null,
  fleetMap: null,
  fleetLayer: null,
  geoCache: {},
};

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ helpers
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pct(value, digits = 1) {
  return value === null || value === undefined ? "—" : `${fmt(value * 100, digits)}%`;
}
function niceDate(iso, opts = { day: "numeric", month: "short" }) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", opts);
}
function localIso(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso() {
  return localIso(new Date());
}
function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00`) - new Date(`${fromIso}T00:00:00`)) / 86400000);
}
function store(key, value) {
  try { localStorage.setItem(`irrigation.${key}`, JSON.stringify(value)); } catch (_) { /* storage unavailable */ }
}
function recall(key, fallback) {
  try {
    const raw = localStorage.getItem(`irrigation.${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}
function banner(message) {
  const el = $("banner");
  el.hidden = !message;
  el.textContent = message || "";
}
async function api(path, options = {}) {
  const init = { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } };
  if (init.body && typeof init.body !== "string") init.body = JSON.stringify(init.body);
  const response = await fetch(path, init);
  if (!response.ok) {
    let detail = response.statusText;
    try { detail = (await response.json()).detail || detail; } catch (_) { /* not JSON */ }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return response.json();
}
function fillSelect(select, values, selected, labeler = (v) => v) {
  select.innerHTML = values.map((v) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(labeler(v))}</option>`).join("");
}
function kv(el, rows) {
  el.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("");
}
function table(headers, rows, opts = {}) {
  const head = headers.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.label)}</th>`).join("");
  const body = rows.map((row, i) => {
    const cells = headers.map((h) => `<td class="${h.num ? "num" : ""}">${h.html ? h.render(row) : esc(h.render(row))}</td>`).join("");
    const attrs = opts.rowAttrs ? opts.rowAttrs(row, i) : "";
    return `<tr${attrs}>${cells}</tr>`;
  }).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function statusPill(status) {
  return `<span class="status-pill status-${status}">${esc(STATUS[status].label)}</span>`;
}

// ------------------------------------------------------------------ settings
function settings() {
  const planting = $("f-planting").value || null;
  const age = planting ? Math.max(0, daysBetween(planting, todayIso())) : 180;
  const sensorRaw = $("f-sensor").value.trim();
  return {
    crop_age_days: age,
    soil_type: $("f-soil").value,
    irrigation_method: $("f-method").value,
    pump_flow_m3h: Number($("f-pump").value) || state.options.default_pump_flow_m3h,
    sensor_soil_moisture: sensorRaw === "" ? null : Number(sensorRaw),
    use_live_weather: $("f-live").checked,
    language: $("language").value,
  };
}
function saveSettings() {
  store("settings", {
    planting: $("f-planting").value,
    soil: $("f-soil").value,
    method: $("f-method").value,
    pump: $("f-pump").value,
    live: $("f-live").checked,
    language: $("language").value,
    farmId: state.farmId,
  });
}
function updateAge() {
  const s = settings();
  $("f-age").textContent = `${s.crop_age_days} days`;
}

// ------------------------------------------------------------------ farm selectors
function uniq(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
function syncSelectors(farmId) {
  const farm = state.farms.find((f) => f.farm_id === farmId) || state.farms[0];
  fillSelect($("f-taluk"), uniq(state.farms.map((f) => f.taluk)), farm.taluk);
  fillSelect($("f-village"), uniq(state.farms.filter((f) => f.taluk === farm.taluk).map((f) => f.village)), farm.village);
  const inVillage = state.farms.filter((f) => f.village === farm.village).map((f) => f.farm_id).sort();
  fillSelect($("f-farm"), inVillage, farm.farm_id);
  state.farmId = farm.farm_id;
}
function onTalukChange() {
  const farm = state.farms.find((f) => f.taluk === $("f-taluk").value);
  syncSelectors(farm.farm_id);
  loadFarm();
}
function onVillageChange() {
  const farm = state.farms.find((f) => f.village === $("f-village").value);
  syncSelectors(farm.farm_id);
  loadFarm();
}

// ------------------------------------------------------------------ dashboard
async function loadFarm() {
  if (!state.farmId) return;
  saveSettings();
  const s = settings();
  const button = $("f-submit");
  button.disabled = true;
  document.querySelectorAll("#view-dashboard .card").forEach((c) => c.classList.add("loading"));
  try {
    const [detail, plan] = await Promise.all([
      api(`/farms/${encodeURIComponent(state.farmId)}`),
      api(`/farms/${encodeURIComponent(state.farmId)}/plan`, { method: "POST", body: s }),
    ]);
    state.detail = detail;
    state.plan = plan;
    banner("");
    renderDashboard();
  } catch (error) {
    banner(`Could not load the advisory: ${error.message}`);
  } finally {
    button.disabled = false;
    document.querySelectorAll("#view-dashboard .card").forEach((c) => c.classList.remove("loading"));
  }
}

function renderDashboard() {
  const { detail, plan: bundle } = state;
  const plan = bundle.plan;
  const rec = plan.recommendation;
  const farm = detail.farm;
  const s = settings();

  // Sidebar farm card and top chips
  $("farm-card").innerHTML = `<b>${esc(farm.Farm_ID)}</b><span>${esc(farm.Village)}, ${esc(farm.Taluk)}</span><span>${esc(farm.District)} district</span><span>${fmt(farm.Farm_Area_ha, 2)} ha · sugarcane</span>`;
  const first = plan.projection[0];
  $("today-chip").textContent = `${fmt(first.temperature_c, 0)}°C · ${fmt(first.rain_mm, 0)} mm rain today`;

  // Advisory card
  const hours = fmt(rec.duration_hours, 1);
  const headline = {
    IRRIGATE_NOW: `Irrigate today for ${hours} hours`,
    IRRIGATE_SOON: `Irrigate on ${niceDate(rec.next_irrigation_date, { weekday: "short", day: "numeric", month: "short" })} for ${hours} hours`,
    NOT_REQUIRED: `No irrigation needed until ${niceDate(rec.next_irrigation_date)}`,
  }[rec.status];
  $("advisory-body").className = "";
  $("advisory-body").innerHTML = `
    ${statusPill(rec.status)}
    <p class="headline">${esc(headline)}</p>
    <p class="subline">Soil moisture ${pct(bundle.soil_moisture_used)} (${esc(SOURCE_LABEL[bundle.soil_moisture_source])}).
      Root zone has used ${fmt(plan.soil_water.depletion_mm, 0)} of the ${fmt(plan.soil_water.raw_mm, 0)} mm the crop can take before stress.</p>
    <div class="mini-stats">
      <div class="mini"><span class="label">Next irrigation</span><span class="value">${niceDate(rec.next_irrigation_date)}</span><span class="note">in ${rec.days_until_irrigation} days</span></div>
      <div class="mini"><span class="label">Pump duration</span><span class="value">${hours} h</span><span class="note">${fmt(s.pump_flow_m3h, 0)} m³/h pump</span></div>
      <div class="mini"><span class="label">Water to apply</span><span class="value">${fmt(rec.gross_depth_mm, 0)} mm</span><span class="note">${fmt(rec.volume_m3, 0)} m³ for the plot</span></div>
      <div class="mini"><span class="label">Water stress</span><span class="value">${esc(plan.water_stress.category.toLowerCase())}</span><span class="note">index ${fmt(plan.water_stress.stress_index, 2)}</span></div>
    </div>`;

  renderWeather(bundle);
  renderAlerts(bundle);

  // Soil and sensor
  kv($("soil-body"), [
    ["Soil moisture used", `${pct(bundle.soil_moisture_used)}`],
    ["Source", esc(SOURCE_LABEL[bundle.soil_moisture_source])],
    ["Field capacity", pct(plan.soil_water.field_capacity, 0)],
    ["Wilting point", pct(plan.soil_water.wilting_point, 0)],
    ["Depletion", `${fmt(plan.soil_water.depletion_mm, 0)} mm`],
    ["Available / readily available", `${fmt(plan.soil_water.taw_mm, 0)} / ${fmt(plan.soil_water.raw_mm, 0)} mm`],
    ["Soil pH", fmt(farm.Soil_pH, 1)],
    ["Organic carbon", `${fmt(farm.Organic_Carbon, 1)} g/kg`],
    ["Temperature", `${fmt(farm.Temperature_C, 1)} °C`],
    ["Relative humidity", `${fmt(farm.Relative_Humidity, 0)}%`],
  ]);

  // Crop status
  const stageIndex = STAGES.findIndex(([key]) => key === plan.crop.stage);
  const ndvi = farm.NDVI;
  $("crop-body").innerHTML = `
    <p><b>${esc(plan.crop.stage_label)}</b> · day ${s.crop_age_days}</p>
    <div class="stage-track" aria-hidden="true">${STAGES.map((_, i) => `<div class="${i <= stageIndex ? "on" : ""}"></div>`).join("")}</div>
    <div class="stage-labels">${STAGES.map(([, label]) => `<span>${label}</span>`).join("")}</div>
    <dl class="kv">
      <dt>Crop coefficient Kc</dt><dd>${fmt(plan.crop.kc, 2)}</dd>
      <dt>Root depth</dt><dd>${fmt(plan.crop.root_depth_m, 2)} m</dd>
      <dt>NDVI</dt><dd>${ndvi === null ? "missing" : fmt(ndvi, 2)}</dd>
      <dt>Leaf area index</dt><dd>${fmt(farm.LAI, 2)}</dd>
    </dl>
    <div><p class="small muted">Water stress index ${fmt(plan.water_stress.stress_index, 2)} (0 none, 1 severe)</p>
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${plan.water_stress.stress_index}" aria-label="Water stress index"><span style="width:${Math.max(2, plan.water_stress.stress_index * 100)}%"></span></div></div>`;

  balanceChart($("balance-chart"), plan.projection, plan.soil_water.raw_mm, plan.soil_water.taw_mm);
  rainChart($("rain-chart"), plan.projection);

  // Fertigation
  const fert = bundle.fertigation;
  const products = Object.keys(fert.products_per_application_kg_acre);
  $("fert-body").innerHTML = `
    <p><b>Next application:</b> ${niceDate(fert.next_fertigation_date, { weekday: "short", day: "numeric", month: "short" })}, with irrigation</p>
    ${table(
      [
        { label: "Product", render: (p) => p },
        { label: "kg/acre", num: true, render: (p) => fmt(fert.products_per_application_kg_acre[p], 1) },
        { label: "kg for plot", num: true, render: (p) => fmt(fert.products_per_application_kg_plot[p], 1) },
      ],
      products,
    )}
    <p class="small muted">${fert.applications_in_stage} splits in this stage. Organic carbon rated ${esc(fert.organic_carbon_rating)}, nitrogen × ${fmt(fert.nitrogen_adjustment_factor, 2)}.</p>`;

  yieldChart($("yield-chart"), bundle.yield_loss_if_delayed);

  // Pump schedule
  const windows = state.options.supply_windows.map((w) => `${w.start}–${w.end}`).join(", ");
  $("pump-body").innerHTML = `
    ${table(
      [
        { label: "Date", render: (r) => niceDate(r.date, { weekday: "short", day: "numeric", month: "short" }) },
        { label: "Start", render: (r) => r.start },
        { label: "End", render: (r) => r.end },
        { label: "Hours", num: true, render: (r) => fmt(r.hours, 1) },
      ],
      bundle.pump_sessions.slice(0, 8),
    )}
    ${bundle.pump_sessions.length > 8 ? `<p class="small muted">+ ${bundle.pump_sessions.length - 8} more sessions</p>` : ""}
    <p class="small muted">Supply windows ${esc(windows)}. Morning first to cut evaporation.</p>`;

  // Water summary
  kv($("water-body"), [
    ["Reference ET (ETo)", `${fmt(plan.water_requirement.eto_mm_day, 2)} mm/day`],
    ["Crop water use (ETc)", `${fmt(plan.water_requirement.etc_mm_day, 2)} mm/day`],
    ["Daily plot demand", `${fmt(plan.water_requirement.etc_m3_day, 1)} m³`],
    ["14-day demand", `${fmt(plan.water_requirement.horizon_etc_mm, 0)} mm`],
    ["Net / gross depth", `${fmt(rec.net_depth_mm, 0)} / ${fmt(rec.gross_depth_mm, 0)} mm`],
    ["Method efficiency", `${esc(plan.inputs.irrigation_method)} ${pct(rec.application_efficiency, 0)}`],
    ["ETo source", esc(plan.inputs.eto_source)],
  ]);

  // Farmer message
  renderMessage(bundle.advisory_text, bundle.language, "Template text. Every number comes directly from the engine.");
  $("r-hours").value = rec.duration_hours;

  // Model card
  const model = detail.model;
  $("model-tag").textContent = model.model_name;
  const maxAbs = Math.max(...model.top_factors.map((f) => f.absolute_contribution), 1e-9);
  $("model-body").innerHTML = `
    <dl class="kv"><dt>Model estimate</dt><dd>${pct(model.predicted_soil_moisture, 2)}</dd><dt>Prototype risk</dt><dd>${esc(model.risk_level)}</dd></dl>
    <p class="small muted">Largest local effects (baseline replacement, not causal):</p>
    <div class="factors">${model.top_factors.map((f) => `
      <div class="small"><div class="row" style="justify-content:space-between"><span>${esc(f.feature.replace(/_/g, " ").replace(".geo", "farm location"))}</span><span class="muted">${f.contribution >= 0 ? "+" : ""}${(f.contribution * 100).toFixed(3)} pts</span></div>
      <div class="meter"><span style="width:${Math.max(2, (f.absolute_contribution / maxAbs) * 100)}%"></span></div></div>`).join("")}</div>
    <p class="small muted">Not reliable for unseen villages: see Model validation.</p>`;

  renderPlotMap(detail);
}

function renderWeather(bundle) {
  const forecast = bundle.weather && bundle.weather.forecast;
  $("weather-note").textContent = bundle.weather ? bundle.weather.note : "";
  let days;
  if (forecast && forecast.dates) {
    days = forecast.dates.slice(0, 5).map((date, i) => ({
      date,
      temp: forecast.temperature_c[i],
      rain: forecast.rain_mm[i],
      prob: forecast.rain_probability_pct ? forecast.rain_probability_pct[i] : null,
      eto: forecast.eto_mm ? forecast.eto_mm[i] : null,
    }));
  } else {
    days = bundle.plan.projection.slice(0, 5).map((d) => ({ date: d.date, temp: d.temperature_c, rain: d.rain_mm, prob: null, eto: d.eto_mm }));
  }
  $("weather-body").className = "";
  $("weather-body").innerHTML = `<div class="forecast">${days.map((d, i) => `
    <div class="day"><span class="d">${i === 0 ? "Today" : niceDate(d.date, { weekday: "short" })}</span>
    <span class="t">${fmt(d.temp, 0)}°</span>
    <span class="r">${d.rain ? fmt(d.rain, 1) : "0"} mm${d.prob !== null ? ` · ${d.prob}%` : ""}</span>
    <span class="e">ETo ${fmt(d.eto, 1)}</span></div>`).join("")}</div>
    <p class="small muted">${forecast ? "Live forecast from Open-Meteo." : "No live forecast: temperature is the plot's recorded mean. Tick Live forecast to fetch one."}</p>`;
  if (forecast && forecast.dates) {
    $("today-chip").textContent = `${fmt(days[0].temp, 0)}°C · ${fmt(days[0].rain, 0)} mm rain today`;
  }
}

function renderAlerts(bundle) {
  const plan = bundle.plan;
  const rec = plan.recommendation;
  const alerts = [];
  if (rec.status === "IRRIGATE_NOW") alerts.push(["critical", "Irrigate now", "Root-zone depletion has passed the stress threshold."]);
  if (rec.status === "IRRIGATE_SOON") alerts.push(["warning", "Irrigation due soon", `Plan pumping for ${niceDate(rec.next_irrigation_date)}.`]);
  if (plan.water_stress.category !== "NONE") alerts.push(["warning", `Water stress: ${plan.water_stress.category.toLowerCase()}`, `Stress index ${fmt(plan.water_stress.stress_index, 2)}.`]);
  if (plan.rainfall_adjustment.postponed_days > 0) {
    alerts.push(["info", "Rain expected", `${fmt(plan.rainfall_adjustment.forecast_rain_mm, 0)} mm forecast postpones irrigation by ${plan.rainfall_adjustment.postponed_days} days.`]);
  }
  const fiveDay = bundle.yield_loss_if_delayed.find((r) => r.delay_days === 5);
  if (fiveDay && fiveDay.relative_yield_loss_pct >= 0.2) {
    alerts.push(["warning", "Delay risk", `A 5-day delay past the due date may cost about ${fmt(fiveDay.relative_yield_loss_pct, 1)}% of yield.`]);
  }
  if (bundle.soil_moisture_source === "ml_model") {
    alerts.push(["info", "Model estimate in use", "Enter a probe reading for a reliable advisory."]);
  } else {
    alerts.push(["good", "Probe reading in use", "The advisory uses your field measurement."]);
  }
  if (bundle.weather && bundle.weather.note.startsWith("live forecast unavailable")) {
    alerts.push(["warning", "Forecast unavailable", bundle.weather.note]);
  }
  if (rec.status === "NOT_REQUIRED" && plan.water_stress.category === "NONE") {
    alerts.unshift(["good", "Crop water is adequate", `Next irrigation about ${niceDate(rec.next_irrigation_date)}.`]);
  }
  $("alerts").innerHTML = alerts.map(([level, title, body]) => `<li class="alert ${level}"><b>${esc(title)}</b><span>${esc(body)}</span></li>`).join("");
}

function renderMessage(text, language, note) {
  const box = $("message-text");
  box.textContent = text;
  box.setAttribute("lang", language);
  $("message-lang").textContent = state.options.languages[language] || language;
  $("message-note").textContent = note;
}

// ------------------------------------------------------------------ charts (inline SVG)
const SVGNS = "http://www.w3.org/2000/svg";
function svg(width, height, label) {
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" xmlns="${SVGNS}">`;
}
function niceMax(value) {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / exp / 2) * 2 * exp;
}

function balanceChart(el, projection, raw, taw) {
  const W = 640, H = 220, L = 44, R = 12, T = 14, B = 26;
  const maxY = niceMax(Math.max(raw * 1.15, ...projection.map((p) => p.depletion_start_mm)));
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, projection.length - 1);
  const y = (v) => T + (1 - v / maxY) * (H - T - B);
  let out = svg(W, H, `Soil water depletion over 14 days against the irrigation threshold of ${raw.toFixed(0)} mm`);
  for (let k = 0; k <= 4; k++) {
    const v = (maxY / 4) * k;
    out += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`;
  }
  out += `<text x="${L}" y="10">mm depleted</text>`;
  out += `<line class="threshold" x1="${L}" x2="${W - R}" y1="${y(raw)}" y2="${y(raw)}"/>`;
  out += `<text class="threshold-label" x="${L + 6}" y="${y(raw) - 6}">Irrigate at ${raw.toFixed(0)} mm</text>`;
  out += `<polyline class="series-line" points="${projection.map((p, i) => `${x(i)},${y(p.depletion_start_mm)}`).join(" ")}"/>`;
  projection.forEach((p, i) => {
    out += `<circle class="series-dot" cx="${x(i)}" cy="${y(p.depletion_start_mm)}" r="4"><title>${niceDate(p.date)}: ${p.depletion_start_mm.toFixed(1)} mm depleted, ETc ${p.etc_mm.toFixed(1)} mm, rain ${p.rain_mm.toFixed(1)} mm, Ks ${p.ks.toFixed(2)}</title></circle>`;
    if (i % 2 === 0) out += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${niceDate(p.date)}</text>`;
  });
  el.innerHTML = `${out}</svg>`;
  el.title = `Total available water ${taw.toFixed(0)} mm`;
}

function rainChart(el, projection) {
  const W = 640, H = 70, L = 44, R = 12, T = 10, B = 14;
  const maxRain = Math.max(...projection.map((p) => p.rain_mm));
  if (maxRain <= 0) {
    el.innerHTML = `<p class="small muted">No rain in the projection.</p>`;
    return;
  }
  const maxY = niceMax(maxRain);
  const step = (W - L - R) / Math.max(1, projection.length - 1);
  const bw = Math.min(18, step * 0.6);
  let out = svg(W, H, "Forecast rain per day");
  out += `<text x="${L}" y="9">rain mm</text>`;
  projection.forEach((p, i) => {
    const h = (p.rain_mm / maxY) * (H - T - B);
    const cx = L + i * step;
    if (h > 0) out += `<rect class="bar-rain" x="${cx - bw / 2}" y="${H - B - h}" width="${bw}" height="${h}" rx="3"><title>${niceDate(p.date)}: ${p.rain_mm.toFixed(1)} mm rain</title></rect>`;
  });
  out += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  el.innerHTML = `${out}</svg>`;
}

function yieldChart(el, rows) {
  const W = 360, H = 190, L = 36, R = 8, T = 22, B = 30;
  const maxY = niceMax(Math.max(1, ...rows.map((r) => r.relative_yield_loss_pct)));
  const step = (W - L - R) / rows.length;
  const bw = Math.min(34, step * 0.62);
  let out = svg(W, H, "Relative yield loss for irrigation delays of 0 to 15 days");
  for (let k = 0; k <= 2; k++) {
    const v = (maxY / 2) * k;
    const yy = T + (1 - v / maxY) * (H - T - B);
    out += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${v}%</text>`;
  }
  rows.forEach((r, i) => {
    const h = (r.relative_yield_loss_pct / maxY) * (H - T - B);
    const cx = L + step * (i + 0.5);
    out += `<rect class="bar" x="${cx - bw / 2}" y="${H - B - h}" width="${bw}" height="${Math.max(h, 0.5)}" rx="4"><title>${r.delay_days}-day delay: ${r.relative_yield_loss_pct.toFixed(2)}% yield loss</title></rect>`;
    out += `<text class="value-label" x="${cx}" y="${H - B - h - 5}" text-anchor="middle">${r.relative_yield_loss_pct.toFixed(1)}</text>`;
    out += `<text x="${cx}" y="${H - 12}" text-anchor="middle">${r.delay_days}d</text>`;
  });
  out += `<text x="${W - R}" y="${H - 1}" text-anchor="end">delay past due date</text>`;
  el.innerHTML = `${out}</svg>`;
}

function ganttChart(el, assignments, startIso, days) {
  const farms = [...new Set(assignments.map((a) => a.farm_id))].slice(0, 40);
  if (!farms.length) {
    el.innerHTML = `<p class="muted">No sessions fit in the horizon.</p>`;
    return;
  }
  const rowH = 16, L = 104, R = 10, T = 22;
  const W = 1000, H = T + farms.length * rowH + 8;
  const start = new Date(`${startIso}T00:00:00`).getTime();
  const span = days * 86400000;
  const x = (iso, hhmm) => {
    const t = new Date(`${iso}T${hhmm}:00`).getTime();
    return L + ((t - start) / span) * (W - L - R);
  };
  let out = svg(W, H, `Pumping sessions for ${farms.length} farms over ${days} days`);
  for (let d = 0; d <= days; d += Math.max(1, Math.round(days / 10))) {
    const xx = L + (d / days) * (W - L - R);
    const date = localIso(new Date(start + d * 86400000));
    out += `<line class="grid-line" x1="${xx}" x2="${xx}" y1="${T - 6}" y2="${H}"/><text x="${xx + 2}" y="${T - 10}">${niceDate(date)}</text>`;
  }
  farms.forEach((farm, i) => {
    const yy = T + i * rowH;
    out += `<text x="${L - 6}" y="${yy + 11}" text-anchor="end">${esc(farm)}</text>`;
    assignments.filter((a) => a.farm_id === farm).forEach((a) => {
      const x1 = x(a.date, a.start), x2 = x(a.date, a.end);
      out += `<rect class="bar" x="${x1}" y="${yy + 2}" width="${Math.max(2, x2 - x1)}" height="${rowH - 5}" rx="2"><title>${esc(farm)}: ${niceDate(a.date)} ${a.start}–${a.end} (${a.hours} h)</title></rect>`;
    });
  });
  el.innerHTML = `${out}</svg>`;
}

// ------------------------------------------------------------------ maps
function leafletReady(el) {
  if (window.L) return true;
  el.innerHTML = `<p class="muted" style="padding:16px">The map library could not load (offline?). Plot data is still in the cards.</p>`;
  return false;
}
function baseLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  });
}
async function villageGeo(village) {
  if (!state.geoCache[village]) state.geoCache[village] = await api(`/farms/geojson?village=${encodeURIComponent(village)}`);
  return state.geoCache[village];
}
async function renderPlotMap(detail) {
  const el = $("plot-map");
  if (!leafletReady(el)) return;
  if (!state.plotMap) {
    state.plotMap = L.map(el, { scrollWheelZoom: false });
    baseLayer().addTo(state.plotMap);
  }
  const village = detail.farm.Village;
  const geo = await villageGeo(village);
  if (state.plotLayer) state.plotLayer.remove();
  const selected = detail.farm.Farm_ID;
  state.plotLayer = L.geoJSON(geo, {
    style: (f) => f.properties.farm_id === selected
      ? { color: "#d97a2b", weight: 3, fillColor: "#d97a2b", fillOpacity: 0.55 }
      : { color: "#2a78d6", weight: 1, fillColor: "#86b6ef", fillOpacity: 0.35 },
    onEachFeature: (f, layer) => {
      layer.bindTooltip(`${f.properties.farm_id}${f.properties.farm_id === selected ? " (selected)" : ""}`);
      layer.on("click", () => { syncSelectors(f.properties.farm_id); loadFarm(); });
    },
  }).addTo(state.plotMap);
  const target = state.plotLayer.getLayers().find((l) => l.feature.properties.farm_id === selected);
  if (target) state.plotMap.fitBounds(target.getBounds(), { maxZoom: 17, padding: [60, 60] });
  else state.plotMap.fitBounds(state.plotLayer.getBounds());
  $("plot-caption").textContent = `${geo.features.length} plots in ${village} · selected in orange`;
  setTimeout(() => state.plotMap.invalidateSize(), 50);
}

// ------------------------------------------------------------------ fleet
function fleetQuery() {
  const s = settings();
  return `crop_age_days=${s.crop_age_days}&soil_type=${encodeURIComponent(s.soil_type)}&irrigation_method=${encodeURIComponent(s.irrigation_method)}&pump_flow_m3h=${s.pump_flow_m3h}`;
}
async function loadFleet() {
  const key = fleetQuery();
  if (state.fleet && state.fleetKey === key) return state.fleet;
  $("fleet-tiles").innerHTML = `<div class="tile"><span class="label">Working</span><span class="note">Running the FAO-56 engine for all 1,000 plots. The first run takes a few seconds.</span></div>`;
  state.fleet = await api(`/fleet?${key}`);
  state.fleetKey = key;
  return state.fleet;
}
async function showFleet() {
  try {
    const fleet = await loadFleet();
    const s = settings();
    $("fleet-sub").textContent = `Every plot under crop age ${s.crop_age_days} days, ${s.soil_type.replace("_", " ")} soil, ${s.irrigation_method} irrigation and the ML soil-moisture estimate.`;
    const count = (status) => fleet.filter((f) => f.status === status).length;
    const weekVolume = fleet.filter((f) => f.due_day <= 7).reduce((sum, f) => sum + f.volume_m3, 0);
    $("fleet-tiles").innerHTML = [
      ["Plots", fleet.length.toLocaleString("en-IN"), ""],
      [STATUS.IRRIGATE_NOW.label, count("IRRIGATE_NOW"), ""],
      [STATUS.IRRIGATE_SOON.label, count("IRRIGATE_SOON"), ""],
      [STATUS.NOT_REQUIRED.label, count("NOT_REQUIRED"), ""],
      ["Water due in 7 days", `${fmt(weekVolume, 0)} m³`, ""],
    ].map(([label, value]) => `<div class="tile"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`).join("");
    $("fleet-legend").innerHTML = Object.values(STATUS).map((st) => `<span><i style="background:${st.color}"></i>${esc(st.label)}</span>`).join("");
    const soonest = [...fleet].sort((a, b) => a.due_day - b.due_day || b.stress_index - a.stress_index).slice(0, 60);
    $("fleet-table").innerHTML = table(
      [
        { label: "Farm", render: (r) => r.farm_id },
        { label: "Village", render: (r) => r.village },
        { label: "Status", html: true, render: (r) => statusPill(r.status) },
        { label: "Due", render: (r) => niceDate(r.next_irrigation_date) },
        { label: "Hours", num: true, render: (r) => fmt(r.hours, 1) },
      ],
      soonest,
      { rowAttrs: (r) => ` class="clickable" data-farm="${esc(r.farm_id)}" tabindex="0"` },
    );
    $("fleet-table").querySelectorAll("tr[data-farm]").forEach((tr) => {
      const open = () => { syncSelectors(tr.dataset.farm); location.hash = "#dashboard"; loadFarm(); };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    });
    await renderFleetMap(fleet);
  } catch (error) {
    banner(`Could not load the fleet: ${error.message}`);
  }
}
async function renderFleetMap(fleet) {
  const el = $("fleet-map");
  if (!leafletReady(el)) return;
  if (!state.fleetMap) {
    state.fleetMap = L.map(el, { preferCanvas: true });
    baseLayer().addTo(state.fleetMap);
  }
  if (!state.geoCache.__all) state.geoCache.__all = await api("/farms/geojson");
  const byId = Object.fromEntries(fleet.map((f) => [f.farm_id, f]));
  if (state.fleetLayer) state.fleetLayer.remove();
  state.fleetLayer = L.geoJSON(state.geoCache.__all, {
    style: (f) => {
      const color = STATUS[(byId[f.properties.farm_id] || {}).status || "NOT_REQUIRED"].color;
      return { color, weight: 1, fillColor: color, fillOpacity: 0.6 };
    },
    onEachFeature: (f, layer) => {
      const row = byId[f.properties.farm_id];
      if (row) layer.bindTooltip(`<b>${esc(row.farm_id)}</b><br>${esc(row.village)}, ${esc(row.taluk)}<br>${esc(STATUS[row.status].label)}<br>Due ${niceDate(row.next_irrigation_date)} · ${fmt(row.hours, 1)} h`);
      layer.on("click", () => { syncSelectors(f.properties.farm_id); location.hash = "#dashboard"; loadFarm(); });
    },
  }).addTo(state.fleetMap);
  state.fleetMap.fitBounds(state.fleetLayer.getBounds());
  setTimeout(() => state.fleetMap.invalidateSize(), 50);
}

// ------------------------------------------------------------------ scheduling
async function showSchedule() {
  const villages = uniq(state.farms.map((f) => f.village));
  if (!$("s-village").options.length) {
    const current = (state.farms.find((f) => f.farm_id === state.farmId) || {}).village;
    fillSelect($("s-village"), villages, current);
    $("s-capacity").value = state.options.max_concurrent_pumps_per_feeder;
    $("s-windows").textContent = state.options.supply_windows.map((w) => `${w.start}–${w.end}`).join(", ");
  }
  await buildSchedule();
}
async function buildSchedule(event) {
  if (event) event.preventDefault();
  const village = $("s-village").value;
  const days = Math.min(21, Math.max(3, Number($("s-days").value) || 21));
  const capacity = Math.max(1, Number($("s-capacity").value) || 25);
  try {
    const fleet = await loadFleet();
    const due = fleet.filter((f) => f.village === village && f.due_day < days);
    if (!due.length) {
      $("schedule-tiles").innerHTML = `<div class="tile"><span class="label">Farms due</span><span class="value">0</span><span class="note">Nobody in ${esc(village)} is due inside ${days} days.</span></div>`;
      $("gantt").innerHTML = "";
      $("unscheduled").innerHTML = "";
      return;
    }
    const start = todayIso();
    const result = await api("/feeder-schedule", {
      method: "POST",
      body: { farms: due.map((f) => ({ farm_id: f.farm_id, hours: f.hours, due_day: f.due_day, stress_index: f.stress_index })), start_date: start, days, max_concurrent: capacity },
    });
    const fully = due.length - result.unscheduled.length;
    $("schedule-tiles").innerHTML = [
      ["Farms due", due.length],
      ["Fully scheduled", fully],
      ["Pump-hours unmet", `${fmt(result.unmet_hours, 0)} of ${fmt(result.demand_hours, 0)}`],
      ["Peak pumps running", result.peak_concurrent_pumps],
      ["Feeder utilisation", pct(result.feeder_utilisation, 0)],
    ].map(([label, value]) => `<div class="tile"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`).join("");
    $("schedule-note").textContent = result.method_note;
    ganttChart($("gantt"), result.assignments, start, days);
    $("unscheduled").innerHTML = result.unscheduled.length
      ? table(
        [
          { label: "Farm", render: (r) => r.farm_id },
          { label: "Needed h", num: true, render: (r) => fmt(r.hours, 1) },
          { label: "Scheduled h", num: true, render: (r) => fmt(r.hours_scheduled, 1) },
          { label: "Unmet h", num: true, render: (r) => fmt(r.hours_unmet, 1) },
        ],
        result.unscheduled,
      )
      : `<p class="muted">Every due farm fits. </p>`;
  } catch (error) {
    banner(`Could not build the schedule: ${error.message}`);
  }
}

// ------------------------------------------------------------------ validation, coverage, reviews
async function showValidation() {
  try {
    const data = await api("/validation");
    const s = data.summary;
    $("finding").innerHTML = `<b>Finding.</b> ${esc(s.finding)}`;
    $("validation-tiles").innerHTML = [
      ["Distinct soil-moisture values", s.target_profile.distinct_target_values],
      ["Villages with one value only", `${s.target_profile.villages_with_single_target_value} of ${s.target_profile.villages}`],
      ["Best unseen-village error", fmt(s.best_unseen_village_model.mae, 5)],
      ["Guess-the-average error", fmt(s.unseen_village_mean_baseline_mae, 5)],
    ].map(([label, value]) => `<div class="tile"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`).join("");
    $("validation-figure").src = data.figure;
    $("validation-table").innerHTML = table(
      [
        { label: "Scheme", render: (r) => r.scheme },
        { label: "Features", render: (r) => r.feature_set },
        { label: "Model", render: (r) => r.model },
        { label: "MAE", num: true, render: (r) => fmt(r.mae, 5) },
        { label: "R²", num: true, render: (r) => fmt(r.r2, 3) },
      ],
      data.results,
    );
  } catch (error) {
    $("finding").textContent = `Validation report unavailable: ${error.message}`;
  }
}
const COVERAGE_CHIP = { "ML model": "chip-ml", "Rule-based": "chip-rule", Partial: "chip-partial", Blocked: "chip-blocked", Implemented: "chip-done" };
async function showCoverage() {
  const data = await api("/coverage");
  $("coverage-table").innerHTML = table(
    [
      { label: "Requested model", render: (r) => r.use_case_model },
      { label: "Status", html: true, render: (r) => `<span class="status-chip ${COVERAGE_CHIP[r.status] || ""}">${esc(r.status)}</span>` },
      { label: "How it is built", render: (r) => r.implementation },
      { label: "Limitation", render: (r) => r.limitation },
    ],
    data.models,
  );
  $("workflow-table").innerHTML = table(
    [{ label: "Stage", render: (r) => r.stage }, { label: "What this prototype provides", render: (r) => r.provides }],
    data.workflow,
  );
}
async function showReviews() {
  const rows = await api("/feedback?limit=200");
  $("reviews-table").innerHTML = rows.length
    ? table(
      [
        { label: "When", render: (r) => new Date(r.timestamp).toLocaleString("en-IN") },
        { label: "Farm", render: (r) => r.farm_id },
        { label: "Reviewer", render: (r) => r.reviewer_role.replace("_", " ") },
        { label: "Decision", render: (r) => r.decision },
        { label: "Advised", render: (r) => `${niceDate(r.recommended_date)} · ${fmt(r.recommended_hours, 1)} h` },
        { label: "Override h", num: true, render: (r) => (r.override_hours === null ? "—" : fmt(r.override_hours, 1)) },
        { label: "Soil moisture from", render: (r) => SOURCE_LABEL[r.soil_moisture_source] || "—" },
        { label: "Comment", render: (r) => r.comment || "" },
      ],
      rows,
    )
    : `<p class="muted">No decisions recorded yet. Use the Human review card on the dashboard.</p>`;
}

// ------------------------------------------------------------------ actions
async function rewriteWithClaude() {
  if (!state.plan) return;
  const button = $("btn-llm");
  button.disabled = true;
  button.textContent = "Rewriting…";
  try {
    const result = await api("/advisory", { method: "POST", body: { facts: state.plan.facts, language: $("language").value, use_llm: true } });
    renderMessage(result.text, $("language").value, result.note || (result.source === "llm" ? "Rewritten by Claude." : "Template text."));
    toast(result.source === "llm" ? "Rewritten by Claude" : "Claude unavailable: showing template");
  } catch (error) {
    toast(`Rewrite failed: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Rewrite with Claude";
  }
}
async function copyMessage() {
  try {
    await navigator.clipboard.writeText($("message-text").textContent);
    toast("Message copied");
  } catch (_) {
    toast("Copy is not available in this browser");
  }
}
async function submitReview(event) {
  event.preventDefault();
  if (!state.plan) return;
  const rec = state.plan.plan.recommendation;
  const decision = $("r-decision").value;
  try {
    await api("/feedback", {
      method: "POST",
      body: {
        farm_id: state.farmId,
        decision,
        reviewer_role: $("r-role").value,
        recommended_date: rec.next_irrigation_date,
        recommended_hours: rec.duration_hours,
        override_hours: decision === "modified" ? Number($("r-hours").value) : null,
        comment: $("r-comment").value.trim() || null,
        soil_moisture_source: state.plan.soil_moisture_source,
      },
    });
    $("r-comment").value = "";
    $("review-note").textContent = `Recorded: ${decision} by ${$("r-role").value.replace("_", " ")} at ${new Date().toLocaleTimeString("en-IN")}.`;
    toast("Decision recorded");
  } catch (error) {
    toast(`Could not record: ${error.message}`);
  }
}

// ------------------------------------------------------------------ routing
const VIEWS = { dashboard: null, fleet: showFleet, schedule: showSchedule, validation: showValidation, coverage: showCoverage, reviews: showReviews };
function route() {
  const name = (location.hash || "#dashboard").slice(1);
  const view = name in VIEWS ? name : "dashboard";
  document.querySelectorAll(".view").forEach((el) => { el.hidden = el.id !== `view-${view}`; });
  document.querySelectorAll(".nav-link").forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (VIEWS[view]) VIEWS[view]();
  if (view === "dashboard" && state.plotMap) setTimeout(() => state.plotMap.invalidateSize(), 50);
}

// ------------------------------------------------------------------ theme
function applyTheme(theme) {
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
}
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme")
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  store("theme", next);
}

// ------------------------------------------------------------------ boot
async function boot() {
  applyTheme(recall("theme", null));
  $("date-chip").textContent = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  try {
    const [options, farms] = await Promise.all([api("/options"), api("/farms")]);
    state.options = options;
    state.farms = farms;
  } catch (error) {
    banner(`Cannot reach the API (${error.message}). Start it with: uvicorn api.main:app --reload, and train the model first.`);
    return;
  }
  const saved = recall("settings", {});
  const o = state.options;
  fillSelect($("language"), Object.keys(o.languages), saved.language || "en", (code) => o.languages[code]);
  fillSelect($("f-soil"), o.soils, saved.soil || o.default_soil, (s) => s.replace("_", " "));
  fillSelect($("f-method"), Object.keys(o.methods), saved.method || o.default_method, (m) => `${m} (${Math.round(o.methods[m] * 100)}%)`);
  $("f-pump").value = saved.pump || o.default_pump_flow_m3h;
  $("f-live").checked = Boolean(saved.live);
  const defaultPlanting = localIso(new Date(Date.now() - 180 * 86400000));
  $("f-planting").value = saved.planting || defaultPlanting;
  $("f-planting").max = todayIso();
  updateAge();
  const initial = state.farms.some((f) => f.farm_id === saved.farmId) ? saved.farmId : state.farms[0].farm_id;
  syncSelectors(initial);

  $("filters").addEventListener("submit", (e) => { e.preventDefault(); loadFarm(); });
  $("f-taluk").addEventListener("change", onTalukChange);
  $("f-village").addEventListener("change", onVillageChange);
  $("f-farm").addEventListener("change", () => { state.farmId = $("f-farm").value; loadFarm(); });
  $("f-planting").addEventListener("change", updateAge);
  $("language").addEventListener("change", loadFarm);
  $("btn-llm").addEventListener("click", rewriteWithClaude);
  $("btn-copy").addEventListener("click", copyMessage);
  $("review-form").addEventListener("submit", submitReview);
  $("schedule-form").addEventListener("submit", buildSchedule);
  $("theme-toggle").addEventListener("click", toggleTheme);
  window.addEventListener("hashchange", route);

  route();
  await loadFarm();
}

boot();
