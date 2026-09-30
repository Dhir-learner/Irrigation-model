import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, CartesianGrid, Cell
} from 'recharts'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDate = (isoStr) => {
  try {
    const d = new Date(isoStr)
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`
  } catch { return isoStr }
}

const TICK_STYLE = { fill: 'var(--text-muted)', fontSize: 11 }
const GRID_STROKE = 'rgba(56,189,248,0.06)'

/** Soil water depletion 14-day projection */
export function WaterBalanceChart({ projection, rawMM }) {
  if (!projection || projection.length === 0) return null
  const data = projection.map(d => ({
    ...d,
    date: d.date,
    label: fmtDate(d.date),
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="depGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.25}/>
            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false}/>
        <XAxis dataKey="label" tick={TICK_STYLE} axisLine={false} tickLine={false}/>
        <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false}/>
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-muted)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
          formatter={(v, n) => [`${Number(v).toFixed(1)} mm`, n === 'depletion_start_mm' ? 'Depletion' : n]}
        />
        {rawMM && <ReferenceLine y={rawMM} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `RAW ${rawMM?.toFixed(0)}mm`, fill: '#94a3b8', fontSize: 10 }}/>}
        <Area type="monotone" dataKey="depletion_start_mm" stroke="#38bdf8" strokeWidth={2} fill="url(#depGrad)" dot={{ r: 3, fill: '#38bdf8' }} activeDot={{ r: 5 }}/>
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Yield loss bar chart */
export function YieldLossChart({ data }) {
  if (!data || data.length === 0) return null
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false}/>
        <XAxis dataKey="delay_days" tick={TICK_STYLE} axisLine={false} tickLine={false} label={{ value: 'Delay (days)', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 10 }}/>
        <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false}/>
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Yield loss']}
        />
        <Bar dataKey="relative_yield_loss_pct" radius={[4,4,0,0]}>
          {data.map((_, i) => <Cell key={i} fill={i < 2 ? '#f59e0b' : '#ef4444'}/>)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Feature importance / contribution horizontal bars */
export function ContributionChart({ contributions }) {
  if (!contributions || contributions.length === 0) return null
  const data = contributions.slice(0, 8).map(c => ({
    feature: c.feature,
    value: parseFloat((c.contribution * 100).toFixed(4)),
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 60, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false}/>
        <XAxis type="number" tick={TICK_STYLE} axisLine={false} tickLine={false}/>
        <YAxis type="category" dataKey="feature" tick={TICK_STYLE} axisLine={false} tickLine={false} width={80}/>
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          formatter={(v) => [`${Number(v).toFixed(4)}`, 'Contribution']}
        />
        <Bar dataKey="value" radius={[0,4,4,0]}>
          {data.map((d, i) => <Cell key={i} fill={d.value >= 0 ? '#22c55e' : '#ef4444'}/>)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Fleet due-day bar chart */
export function DueDayChart({ fleet }) {
  if (!fleet || fleet.length === 0) return null
  const counts = {}
  fleet.forEach(f => { counts[f.due_day] = (counts[f.due_day] || 0) + 1 })
  const data = Object.entries(counts).map(([k, v]) => ({ day: Number(k), farms: v })).sort((a, b) => a.day - b.day)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false}/>
        <XAxis dataKey="day" tick={TICK_STYLE} axisLine={false} tickLine={false} label={{ value: 'Days until irrigation due', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 10 }}/>
        <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false}/>
        <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v) => [v, 'Farms']}/>
        <Bar dataKey="farms" radius={[4,4,0,0]}>
          {data.map((d, i) => <Cell key={i} fill={d.day <= 3 ? '#ef4444' : d.day <= 7 ? '#f59e0b' : '#38bdf8'}/>)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
