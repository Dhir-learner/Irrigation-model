import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getFleet, getOptions, getFeederSchedule } from '../api.js'
import { useToast } from '../context.jsx'

/** Minimal SVG Gantt chart — no external library needed */
function GanttChart({ assignments }) {
  if (!assignments || assignments.length === 0) {
    return <div className="text-muted" style={{ padding: 24 }}>No sessions generated.</div>
  }

  const farms = [...new Set(assignments.map(a => a.farm_id))].slice(0, 40)
  const dates = [...new Set(assignments.map(a => a.date))].sort()

  const toMins = (t) => {
    const [h, m] = (t || '00:00').split(':').map(Number)
    return h * 60 + m
  }

  const dayW = 200
  const rowH = 28
  const labelW = 100
  const headerH = 36
  const width = labelW + dates.length * dayW
  const height = headerH + farms.length * rowH + 20
  const COLORS = ['#38bdf8', '#818cf8', '#34d399', '#fb923c', '#f472b6', '#a78bfa', '#22c55e', '#f59e0b']

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <svg width={width} height={height} style={{ fontFamily: 'Inter, sans-serif' }}>
        {/* Date headers */}
        {dates.map((d, i) => (
          <text key={d} x={labelW + i * dayW + dayW / 2} y={20} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{d}</text>
        ))}
        {/* Farm labels */}
        {farms.map((f, i) => (
          <text key={f} x={labelW - 6} y={headerH + i * rowH + rowH / 2 + 4} textAnchor="end" fontSize={10} fill="var(--text-secondary)">{f}</text>
        ))}
        {/* Vertical grid */}
        {dates.map((_, i) => (
          <line key={i} x1={labelW + i * dayW} y1={headerH} x2={labelW + i * dayW} y2={height - 8} stroke="var(--border)" strokeWidth={1} />
        ))}
        {/* Horizontal grid */}
        {farms.map((_, i) => (
          <line key={i} x1={0} y1={headerH + i * rowH} x2={width} y2={headerH + i * rowH} stroke="var(--border)" strokeWidth={0.5} />
        ))}
        {/* Session bars */}
        {assignments.filter(a => farms.includes(a.farm_id)).map((a, idx) => {
          const fi = farms.indexOf(a.farm_id)
          const di = dates.indexOf(a.date)
          if (fi === -1 || di === -1) return null
          const startM = toMins(a.start)
          const endM = toMins(a.end)
          const x = labelW + di * dayW + (startM / 1440) * dayW
          const w = Math.max(4, ((endM - startM) / 1440) * dayW)
          const y = headerH + fi * rowH + 5
          const color = COLORS[fi % COLORS.length]
          return (
            <g key={idx}>
              <rect x={x} y={y} width={w} height={rowH - 10} rx={3} fill={color} fillOpacity={0.78} />
              <title>{a.farm_id} | {a.date} {a.start}–{a.end} ({Number(a.hours).toFixed(1)}h)</title>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function PumpScheduling({ settings }) {
  const { toast } = useToast()
  const today = new Date().toISOString().split('T')[0]
  const cropAge = settings?.cropAge || 180

  const [village, setVillage] = useState('')
  const [capacity, setCapacity] = useState(25)
  const [days, setDays] = useState(21)
  const [result, setResult] = useState(null)

  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })

  const fleetParams = { crop_age_days: cropAge }
  if (settings?.method) fleetParams.irrigation_method = settings.method

  const { data: fleet = [], isLoading: fleetLoading } = useQuery({
    queryKey: ['fleet', fleetParams],
    queryFn: () => getFleet(fleetParams),
    staleTime: 60000,
  })

  const villages = useMemo(() => [...new Set(fleet.map(f => f.village))].sort(), [fleet])

  // Auto-select first village
  useMemo(() => {
    if (villages.length > 0 && !village) setVillage(villages[0])
  }, [villages])

  const supplyWindows = opts?.supply_windows
    ?.map(w => w.start + '\u2013' + w.end)
    .join(', ') || '\u2014'

  const scheduleMut = useMutation({
    mutationFn: getFeederSchedule,
    onSuccess: data => { setResult(data); toast('Schedule built', 'success') },
    onError: e => toast('Schedule error: ' + e.message, 'error'),
  })

  const villageFarms = useMemo(() =>
    fleet.filter(f => f.village === village && f.due_day < days)
  , [fleet, village, days])

  const handleBuild = (e) => {
    e.preventDefault()
    if (villageFarms.length === 0) {
      toast('No farms due in this village within the horizon', 'warn')
      return
    }
    scheduleMut.mutate({
      farms: villageFarms.map(f => ({
        farm_id: f.farm_id,
        hours: f.hours,
        due_day: f.due_day,
        stress_index: f.stress_index || 0,
      })),
      start_date: today,
      days,
      max_concurrent: capacity,
    })
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pump Scheduling</h1>
        <p className="page-sub">Allocate pumping slots for farms sharing one electricity feeder. Farms due soonest are served first.</p>
      </div>

      {/* Controls */}
      <form className="filter-bar mb-5" onSubmit={handleBuild}>
        <div className="field">
          <label>Feeder (village)</label>
          <select value={village} onChange={e => { setVillage(e.target.value); setResult(null) }}>
            {villages.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Max pumps at once</label>
          <input type="number" value={capacity} min="1" max="500" onChange={e => setCapacity(parseInt(e.target.value))} />
        </div>
        <div className="field">
          <label>Horizon (days)</label>
          <input type="number" value={days} min="3" max="21" onChange={e => setDays(parseInt(e.target.value))} />
        </div>
        <div className="field">
          <label>Supply windows</label>
          <input type="text" readOnly value={supplyWindows} style={{ background: 'transparent', color: 'var(--text-muted)', minWidth: 180 }} />
        </div>
        <div className="field">
          <label>Farms due in horizon</label>
          <input type="text" readOnly value={fleetLoading ? 'loading...' : villageFarms.length + ' farms'}
            style={{ background: 'transparent', color: 'var(--text-muted)' }} />
        </div>
        <button className="btn primary" type="submit" style={{ alignSelf: 'flex-end' }} disabled={scheduleMut.isPending || !village}>
          {scheduleMut.isPending ? 'Building...' : 'Build schedule'}
        </button>
      </form>

      {/* Results */}
      {result && (
        <>
          {/* KPI tiles */}
          <div className="stat-grid mb-5">
            <div className="stat-tile">
              <div className="stat-label">Farms due</div>
              <div className="stat-value">{villageFarms.length}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Fully scheduled</div>
              <div className="stat-value" style={{ color: '#22c55e' }}>
                {villageFarms.length - (result.unscheduled?.length || 0)}
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Unmet pump-hours</div>
              <div className="stat-value" style={{ color: result.unmet_hours > 0 ? '#f59e0b' : '#22c55e' }}>
                {result.unmet_hours?.toFixed(0)} / {result.demand_hours?.toFixed(0)}
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Peak concurrent pumps</div>
              <div className="stat-value">{result.peak_concurrent_pumps ?? '\u2014'}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Feeder utilisation</div>
              <div className="stat-value">
                {result.feeder_utilisation != null
                  ? (result.feeder_utilisation * 100).toFixed(0) + '%'
                  : '\u2014'}
              </div>
            </div>
          </div>

          {result.method_note && (
            <div className="alert info mb-4">{result.method_note}</div>
          )}

          {result.unscheduled?.length > 0 && (
            <div className="alert warn mb-4">
              {result.unscheduled.length} farms cannot finish within the horizon.
              Try raising the feeder capacity, extending the horizon, or switching to a more efficient irrigation method.
            </div>
          )}

          {/* Gantt */}
          <div className="card mb-4">
            <div className="card-header">
              <span className="card-title">Pump sessions Gantt</span>
              <span className="text-muted text-sm">first 40 farms &bull; hover a bar for detail</span>
            </div>
            <div className="card-body" style={{ padding: '8px 0 0 0' }}>
              <GanttChart assignments={result.assignments} />
            </div>
          </div>

          {/* Session table */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">All sessions</span>
              <span className="text-muted text-sm">{(result.assignments || []).length} sessions</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Farm ID</th><th>Date</th><th>Start</th><th>End</th><th>Hours</th></tr>
                  </thead>
                  <tbody>
                    {(result.assignments || []).map((a, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{a.farm_id}</td>
                        <td>{a.date}</td>
                        <td>{a.start}</td>
                        <td>{a.end}</td>
                        <td>{Number(a.hours).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
