import {
  ComposedChart, AreaChart, Area, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { useI18n, featureLabel } from '../i18n.jsx'
import { STATUS_HEX } from './ui.jsx'

// One accent hue for magnitude; water is cyan; status colours only mean irrigation status.
const ACCENT = '#19d39b'
const WATER = '#38bdf8'
const POS = '#38bdf8'
const NEG = '#c084fc'
const TICK = { fill: 'var(--text-3)', fontSize: 11 }
const GRID = 'var(--border)'
export const TOOLTIP = {
  contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 10, fontSize: 12, boxShadow: 'var(--shadow-md)', color: 'var(--text-1)' },
  labelStyle: { color: 'var(--text-2)', marginBottom: 4 },
  itemStyle: { color: 'var(--text-1)' },
  cursor: { fill: 'var(--bg-hover)' },
}
const LEGEND = { wrapperStyle: { fontSize: 11, color: 'var(--text-2)' }, iconSize: 10 }

/** Root-zone depletion projection with effective rain on the same mm axis. */
export function WaterBalanceChart({ projection, rawMM, tawMM, height = 280 }) {
  const { t, fmtDate, fmtNum } = useI18n()
  if (!projection?.length) return null
  const data = projection.map(d => ({ ...d, label: fmtDate(d.date) }))
  const names = { depletion_start_mm: t('chart.depletion'), effective_rain_mm: t('chart.effRain') }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 14, right: 12, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="depGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} minTickGap={12} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} unit=" mm" width={62} domain={[0, max => Math.ceil(Math.max(max, rawMM || 0) * 1.1)]} />
        <Tooltip {...TOOLTIP} formatter={(v, n) => [`${fmtNum(v, 1)} mm`, names[n] || n]} />
        <Legend {...LEGEND} formatter={n => names[n] || n} />
        {rawMM != null && <ReferenceLine y={rawMM} stroke={STATUS_HEX.IRRIGATE_SOON} strokeDasharray="5 4" label={{ value: t('chart.trigger', { v: fmtNum(rawMM, 0) }), fill: 'var(--text-2)', fontSize: 10, position: 'insideTopLeft' }} />}
        {tawMM != null && <ReferenceLine y={tawMM} stroke={STATUS_HEX.IRRIGATE_NOW} strokeDasharray="2 4" label={{ value: t('chart.wilting', { v: fmtNum(tawMM, 0) }), fill: 'var(--text-2)', fontSize: 10, position: 'insideTopLeft' }} />}
        <Bar dataKey="effective_rain_mm" fill={WATER} radius={[4, 4, 0, 0]} maxBarSize={14} />
        <Area type="monotone" dataKey="depletion_start_mm" stroke={ACCENT} strokeWidth={2} fill="url(#depGrad)" dot={{ r: 3, fill: ACCENT }} activeDot={{ r: 5 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function YieldLossChart({ data, height = 210 }) {
  const { t, fmtNum } = useI18n()
  if (!data?.length) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 14 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="delay_days" tick={TICK} axisLine={false} tickLine={false}
          label={{ value: t('chart.delay'), position: 'insideBottom', offset: -8, fill: 'var(--text-3)', fontSize: 10 }} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} unit="%" />
        <Tooltip {...TOOLTIP} labelFormatter={v => t('chart.delayLabel', { n: v })} formatter={v => [`${fmtNum(v, 2)}%`, t('chart.yieldLoss')]} />
        <Bar dataKey="relative_yield_loss_pct" radius={[4, 4, 0, 0]} maxBarSize={38}>
          {data.map((d, i) => <Cell key={i} fill={STATUS_HEX.IRRIGATE_NOW} fillOpacity={0.35 + 0.65 * (i / (data.length - 1 || 1))} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ContributionChart({ contributions }) {
  const { t, fmtNum } = useI18n()
  if (!contributions?.length) return null
  const data = contributions.slice(0, 8).map(c => ({ feature: featureLabel(t, c.feature), value: Number(c.contribution) * 100 }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="feature" tick={TICK} axisLine={false} tickLine={false} width={130} />
        <ReferenceLine x={0} stroke="var(--border-strong)" />
        <Tooltip {...TOOLTIP} formatter={v => [`${v >= 0 ? '+' : ''}${fmtNum(v, 4)} ${t('chart.contribUnit')}`, t('chart.contribution')]} />
        <Bar dataKey="value" radius={4} maxBarSize={18}>
          {data.map((d, i) => <Cell key={i} fill={d.value >= 0 ? POS : NEG} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DueDayChart({ fleet, height = 230 }) {
  const { t } = useI18n()
  if (!fleet?.length) return null
  const counts = {}
  fleet.forEach(f => {
    const c = (counts[f.due_day] ||= { day: f.due_day, IRRIGATE_NOW: 0, IRRIGATE_SOON: 0, NOT_REQUIRED: 0 })
    c[f.status] += 1
  })
  const data = Object.values(counts).sort((a, b) => a.day - b.day)
  const keys = Object.keys(STATUS_HEX)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 14 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="day" tick={TICK} axisLine={false} tickLine={false}
          label={{ value: t('chart.dueAxis'), position: 'insideBottom', offset: -8, fill: 'var(--text-3)', fontSize: 10 }} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} labelFormatter={v => t('chart.dueIn', { n: v })} formatter={(v, n) => [v, t('status.' + n)]} />
        <Legend {...LEGEND} formatter={n => t('status.' + n)} />
        {keys.map(k => <Bar key={k} dataKey={k} stackId="s" fill={STATUS_HEX[k]} stroke="var(--bg-card)" strokeWidth={1} maxBarSize={30} />)}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DemandCalendarChart({ calendar, height = 250 }) {
  const { t, fmtDate, fmtNum } = useI18n()
  if (!calendar?.length) return null
  const data = calendar.map(d => ({ ...d, label: fmtDate(d.date) }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="calGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={WATER} />
            <stop offset="100%" stopColor={ACCENT} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} minTickGap={8} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => (v >= 1000 ? `${fmtNum(v / 1000, 0)}k` : v)} unit=" m³" width={66} />
        <Tooltip {...TOOLTIP} content={({ active, payload, label }) => active && payload?.length ? (
          <div style={TOOLTIP.contentStyle} className="chart-tip">
            <div style={TOOLTIP.labelStyle}>{label}</div>
            <div><strong>{fmtNum(payload[0].payload.volume_m3, 0)} m³</strong> {t('chart.gross')}</div>
            <div>{t('chart.farmsDue', { n: payload[0].payload.farms_due })} · {t('chart.pumpH', { n: fmtNum(payload[0].payload.pump_hours, 0) })}</div>
          </div>
        ) : null} />
        <Bar dataKey="volume_m3" fill="url(#calGrad)" radius={[5, 5, 0, 0]} maxBarSize={34} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function HistogramChart({ bins, unit = '', format = v => v, height = 230 }) {
  const { t } = useI18n()
  if (!bins?.length) return null
  const data = bins.map(b => ({ ...b, mid: (b.from + b.to) / 2 }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="mid" tick={TICK} axisLine={false} tickLine={false} tickFormatter={format} minTickGap={24} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} labelFormatter={(_, p) => (p?.[0] ? `${format(p[0].payload.from)}–${format(p[0].payload.to)}${unit}` : '')} formatter={v => [v, t('chart.farms')]} />
        <Bar dataKey="count" fill={WATER} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CorrelationChart({ rows, height }) {
  const { t } = useI18n()
  if (!rows?.length) return null
  const data = rows.map(r => ({ feature: t('feature.' + r.feature), value: r.spearman ?? 0, pearson: r.pearson, spearman: r.spearman }))
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(220, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" domain={[-1, 1]} tick={TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="feature" tick={TICK} axisLine={false} tickLine={false} width={130} />
        <ReferenceLine x={0} stroke="var(--border-strong)" />
        <Tooltip {...TOOLTIP} formatter={(_, __, p) => [`Spearman ${p.payload.spearman} · Pearson ${p.payload.pearson}`, t('chart.corr')]} />
        <Bar dataKey="value" radius={4} maxBarSize={18}>
          {data.map((d, i) => <Cell key={i} fill={d.value >= 0 ? POS : NEG} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function FeederLoadChart({ assignments, capacity, height = 230 }) {
  const { t, fmtDate } = useI18n()
  if (!assignments?.length) return null
  const load = {}
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
  assignments.forEach(a => {
    for (let m = toMin(a.start); m < toMin(a.end); m += 30) {
      const key = `${a.date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      load[key] = (load[key] || 0) + 1
    }
  })
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
      <AreaChart data={data} margin={{ top: 14, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="slot" tick={TICK} axisLine={false} tickLine={false} minTickGap={60} tickFormatter={s => fmtDate(s.split(' ')[0])} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} labelFormatter={s => `${fmtDate(s.split(' ')[0])} ${s.split(' ')[1]}`} formatter={v => [v, t('schedule.pumpsRunning')]} />
        {capacity && <ReferenceLine y={capacity} stroke={STATUS_HEX.IRRIGATE_NOW} strokeDasharray="5 4" label={{ value: t('schedule.capacityLine', { n: capacity }), fill: 'var(--text-2)', fontSize: 10, position: 'insideTopRight' }} />}
        <Area type="stepAfter" dataKey="pumps" stroke={ACCENT} fill={ACCENT} fillOpacity={0.25} strokeWidth={1.5} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function KcCurveChart({ stageDays, kc, cropAge, height = 170 }) {
  const { t, fmtNum } = useI18n()
  if (!stageDays || !kc) return null
  const ini = stageDays.initial, dev = ini + stageDays.development, mid = dev + stageDays.mid, end = mid + stageDays.late
  const data = [{ day: 0, kc: kc.initial }, { day: ini, kc: kc.initial }, { day: dev, kc: kc.mid }, { day: mid, kc: kc.mid }, { day: end, kc: kc.end }]
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 18, right: 14, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="kcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.3} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="day" type="number" domain={[0, end]} tick={TICK} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} domain={[0, 1.4]} />
        <Tooltip {...TOOLTIP} labelFormatter={v => t('chart.day', { n: v })} formatter={v => [fmtNum(v, 2), 'Kc']} />
        <Area type="linear" dataKey="kc" stroke={ACCENT} strokeWidth={2} fill="url(#kcGrad)" dot={{ r: 3, fill: ACCENT }} isAnimationActive={false} />
        <ReferenceLine x={Math.min(cropAge, end)} stroke={WATER} strokeWidth={2} label={{ value: t('chart.today', { n: cropAge }), fill: 'var(--text-1)', fontSize: 10, position: 'top' }} />
        <Line dataKey="kc" stroke="transparent" dot={false} activeDot={false} legendType="none" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Ranked list: share of each village's farms due within 3 days. Labelled bars read better than rings. */
export function VillageNeedChart({ villages }) {
  const { fmtNum } = useI18n()
  if (!villages?.length) return null
  const data = villages
    .map(v => ({ name: v.village, value: (100 * (v.irrigate_now + v.irrigate_soon)) / v.farms, n: v.irrigate_now + v.irrigate_soon, farms: v.farms }))
    .sort((a, b) => b.value - a.value)
  return (
    <div className="rank-list">
      {data.map(d => (
        <div key={d.name} className="rank-row" title={`${d.n} / ${d.farms}`}>
          <span className="n">{d.name}</span>
          <span className="bar"><span style={{ width: `${Math.max(d.value, 1.5)}%`, opacity: d.value ? 1 : 0.35 }} /></span>
          <span className="v">{fmtNum(d.value)}%</span>
        </div>
      ))}
    </div>
  )
}
