import {
  ComposedChart, AreaChart, Area, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { STATUS_COLOR } from './FarmMap.jsx'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = iso => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// One accent hue for magnitude; status colours only ever mean irrigation status.
const ACCENT = '#00c896'
const RAIN = '#38bdf8'
const POS = '#38bdf8'
const NEG = '#c084fc'
const TICK = { fill: 'var(--text-2)', fontSize: 11 }
const GRID = 'var(--border)'
const TOOLTIP = {
  contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border-md)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow-md)' },
  labelStyle: { color: 'var(--text-2)', marginBottom: 4 },
  itemStyle: { color: 'var(--text-1)' },
  cursor: { fill: 'var(--bg-hover)' },
}
const LEGEND = { wrapperStyle: { fontSize: 11, color: 'var(--text-2)' }, iconSize: 10 }

/** Root-zone depletion projection with forecast rain on the same mm axis. */
export function WaterBalanceChart({ projection, rawMM, tawMM, height = 260 }) {
  if (!projection?.length) return null
  const data = projection.map(d => ({ ...d, label: fmtDate(d.date) }))
  const names = { depletion_start_mm: 'Root-zone depletion', effective_rain_mm: 'Effective rain' }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="depGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={ACCENT} stopOpacity={0.28} />
            <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} unit=" mm" width={62} domain={[0, dataMax => Math.ceil(Math.max(dataMax, rawMM || 0) * 1.1)]} />
        <Tooltip {...TOOLTIP} formatter={(v, n) => [`${Number(v).toFixed(1)} mm`, names[n] || n]} />
        <Legend {...LEGEND} formatter={n => names[n] || n} />
        {rawMM != null && (
          <ReferenceLine y={rawMM} stroke={STATUS_COLOR.IRRIGATE_SOON} strokeDasharray="5 4"
            label={{ value: `Irrigation trigger (RAW ${rawMM.toFixed(0)} mm)`, fill: 'var(--text-2)', fontSize: 10, position: 'insideTopLeft' }} />
        )}
        {tawMM != null && (
          <ReferenceLine y={tawMM} stroke={STATUS_COLOR.IRRIGATE_NOW} strokeDasharray="2 4"
            label={{ value: `Wilting (TAW ${tawMM.toFixed(0)} mm)`, fill: 'var(--text-2)', fontSize: 10, position: 'insideTopLeft' }} />
        )}
        <Bar dataKey="effective_rain_mm" fill={RAIN} radius={[4, 4, 0, 0]} maxBarSize={14} />
        <Area type="monotone" dataKey="depletion_start_mm" stroke={ACCENT} strokeWidth={2} fill="url(#depGrad)" dot={{ r: 3, fill: ACCENT }} activeDot={{ r: 5 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** FAO-33 relative yield loss for each delay. */
export function YieldLossChart({ data, height = 200 }) {
  if (!data?.length) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="delay_days" tick={TICK} axisLine={false} tickLine={false}
          label={{ value: 'Delay after due date (days)', position: 'insideBottom', offset: -8, fill: 'var(--text-2)', fontSize: 10 }} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} unit="%" />
        <Tooltip {...TOOLTIP} labelFormatter={v => `${v}-day delay`} formatter={v => [`${Number(v).toFixed(2)}%`, 'Relative yield loss']} />
        <Bar dataKey="relative_yield_loss_pct" fill={STATUS_COLOR.IRRIGATE_NOW} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Signed per-feature contribution to the model estimate. */
export function ContributionChart({ contributions }) {
  if (!contributions?.length) return null
  const data = contributions.slice(0, 8).map(c => ({ feature: c.feature, value: Number(c.contribution) * 100 }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} unit=" pp" />
        <YAxis type="category" dataKey="feature" tick={TICK} axisLine={false} tickLine={false} width={120} />
        <ReferenceLine x={0} stroke="var(--border-strong)" />
        <Tooltip {...TOOLTIP} formatter={v => [`${v >= 0 ? '+' : ''}${Number(v).toFixed(4)} pp soil moisture`, 'Contribution']} />
        <Bar dataKey="value" radius={4} maxBarSize={18}>
          {data.map((d, i) => <Cell key={i} fill={d.value >= 0 ? POS : NEG} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Farms per due day, coloured by the status that day implies. */
export function DueDayChart({ fleet, height = 220 }) {
  if (!fleet?.length) return null
  const counts = {}
  fleet.forEach(f => {
    const c = (counts[f.due_day] ||= { day: f.due_day, IRRIGATE_NOW: 0, IRRIGATE_SOON: 0, NOT_REQUIRED: 0 })
    c[f.status] = (c[f.status] || 0) + 1
  })
  const data = Object.values(counts).sort((a, b) => a.day - b.day)
  const names = { IRRIGATE_NOW: 'Irrigate now', IRRIGATE_SOON: 'Due within 3 days', NOT_REQUIRED: 'Not required yet' }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="day" tick={TICK} axisLine={false} tickLine={false}
          label={{ value: 'Days until irrigation is due', position: 'insideBottom', offset: -8, fill: 'var(--text-2)', fontSize: 10 }} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} labelFormatter={v => `Due in ${v} day${v === 1 ? '' : 's'}`} formatter={(v, n) => [v, names[n]]} />
        <Legend {...LEGEND} formatter={n => names[n]} />
        {Object.keys(names).map(k => (
          <Bar key={k} dataKey={k} stackId="s" fill={STATUS_COLOR[k]} stroke="var(--bg-card)" strokeWidth={1} maxBarSize={30} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Gross volume falling due each day across the fleet. */
export function DemandCalendarChart({ calendar, height = 240 }) {
  if (!calendar?.length) return null
  const data = calendar.map(d => ({ ...d, label: fmtDate(d.date) }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} unit=" m³" width={64} />
        <Tooltip {...TOOLTIP} content={({ active, payload, label }) => active && payload?.length ? (
          <div style={TOOLTIP.contentStyle} className="chart-tip">
            <div style={TOOLTIP.labelStyle}>{label}</div>
            <div><strong>{Number(payload[0].payload.volume_m3).toLocaleString('en-IN')} m³</strong> gross</div>
            <div>{payload[0].payload.farms_due} farms due &middot; {Number(payload[0].payload.pump_hours).toLocaleString('en-IN')} pump-h</div>
          </div>
        ) : null} />
        <Bar dataKey="volume_m3" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={34} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Histogram from [{from, to, count}] bins. */
export function HistogramChart({ bins, unit = '', format = v => v, height = 220 }) {
  if (!bins?.length) return null
  const data = bins.map(b => ({ ...b, mid: (b.from + b.to) / 2 }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="mid" tick={TICK} axisLine={false} tickLine={false} tickFormatter={format} minTickGap={24} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} labelFormatter={(_, p) => p?.[0] ? `${format(p[0].payload.from)}–${format(p[0].payload.to)}${unit}` : ''} formatter={v => [v, 'Farms']} />
        <Bar dataKey="count" fill={ACCENT} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Signed correlation coefficients (diverging, gray zero line). */
export function CorrelationChart({ rows, valueKey = 'spearman', height }) {
  if (!rows?.length) return null
  const data = rows.map(r => ({ feature: r.feature.replace(/_/g, ' '), value: r[valueKey] ?? 0, pearson: r.pearson, spearman: r.spearman }))
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(200, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" domain={[-1, 1]} tick={TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="feature" tick={TICK} axisLine={false} tickLine={false} width={120} />
        <ReferenceLine x={0} stroke="var(--border-strong)" />
        <Tooltip {...TOOLTIP} formatter={(_, __, p) => [`Spearman ${p.payload.spearman} · Pearson ${p.payload.pearson}`, 'Correlation with soil moisture']} />
        <Bar dataKey="value" radius={4} maxBarSize={18}>
          {data.map((d, i) => <Cell key={i} fill={d.value >= 0 ? POS : NEG} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Pumps running per 30-minute slot against feeder capacity. */
export function FeederLoadChart({ assignments, capacity, height = 220 }) {
  if (!assignments?.length) return null
  const load = {}
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  assignments.forEach(a => {
    for (let m = toMin(a.start); m < toMin(a.end); m += 30) {
      const key = `${a.date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      load[key] = (load[key] || 0) + 1
    }
  })
  // Every 30-minute slot from the first to the last scheduled day, idle slots as 0,
  // so the supply-window pattern and the gaps between windows are visible.
  const days = [...new Set(assignments.map(a => a.date))].sort()
  const data = []
  for (let d = new Date(days[0]); d <= new Date(days[days.length - 1]); d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    for (let m = 0; m < 1440; m += 30) {
      const slot = `${iso} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      data.push({ slot, pumps: load[slot] || 0 })
    }
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="slot" tick={TICK} axisLine={false} tickLine={false} minTickGap={60} tickFormatter={s => fmtDate(s.split(' ')[0]) + ' ' + s.split(' ')[1]} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} formatter={v => [v, 'Pumps running']} />
        {capacity && <ReferenceLine y={capacity} stroke={STATUS_COLOR.IRRIGATE_NOW} strokeDasharray="5 4" label={{ value: `Feeder capacity ${capacity}`, fill: 'var(--text-2)', fontSize: 10, position: 'insideTopRight' }} />}
        <Area type="stepAfter" dataKey="pumps" stroke={ACCENT} fill={ACCENT} fillOpacity={0.25} strokeWidth={1.5} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Stage Kc curve for the crop season with a marker at today's crop age. */
export function KcCurveChart({ stageDays, kc, cropAge, height = 160 }) {
  if (!stageDays || !kc) return null
  const ini = stageDays.initial, dev = ini + stageDays.development, mid = dev + stageDays.mid, end = mid + stageDays.late
  const data = [
    { day: 0, kc: kc.initial }, { day: ini, kc: kc.initial }, { day: dev, kc: kc.mid },
    { day: mid, kc: kc.mid }, { day: end, kc: kc.end },
  ]
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="day" type="number" domain={[0, end]} tick={TICK} axisLine={false} tickLine={false} unit="d" />
        <YAxis tick={TICK} axisLine={false} tickLine={false} domain={[0, 1.4]} />
        <Tooltip {...TOOLTIP} labelFormatter={v => `Day ${v}`} formatter={v => [Number(v).toFixed(2), 'Kc']} />
        <ReferenceLine x={Math.min(cropAge, end)} stroke={ACCENT} strokeWidth={2} label={{ value: `Today (day ${cropAge})`, fill: 'var(--text-1)', fontSize: 10, position: 'top' }} />
        <Line type="linear" dataKey="kc" stroke="var(--text-2)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
