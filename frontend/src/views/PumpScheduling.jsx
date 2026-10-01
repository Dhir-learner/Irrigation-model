import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getFleet, getOptions, getFeederSchedule, downloadCSV } from '../api.js'
import { useToast } from '../context.jsx'
import { FeederLoadChart, fmtDate } from '../components/Charts.jsx'
import { fleetQueryParams } from './FleetMap.jsx'

const BAR = '#00c896'

/** SVG Gantt: one row per farm, one column per day, bars at their clock time. */
function GanttChart({ assignments, windows, maxFarms = 40 }) {
  if (!assignments?.length) return <div className="text-muted" style={{ padding: 24 }}>No sessions generated.</div>
  const farms = [...new Set(assignments.map(a => a.farm_id))].slice(0, maxFarms)
  const dates = [...new Set(assignments.map(a => a.date))].sort()
  const toMins = t => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + m }
  const dayW = 168, rowH = 24, labelW = 96, headerH = 34
  const width = labelW + dates.length * dayW
  const height = headerH + farms.length * rowH + 8
  const farmIndex = Object.fromEntries(farms.map((f, i) => [f, i]))
  const dateIndex = Object.fromEntries(dates.map((d, i) => [d, i]))

  return (
    <div className="table-wrap" style={{ paddingBottom: 8 }}>
      <svg width={width} height={height} style={{ fontFamily: 'Inter, sans-serif', display: 'block' }} role="img" aria-label="Pump session timeline">
        {dates.map((d, i) => (
          <g key={d}>
            {(windows || []).map((w, j) => (
              <rect key={j} x={labelW + i * dayW + (toMins(w.start) / 1440) * dayW} y={headerH - 4}
                width={((toMins(w.end) - toMins(w.start)) / 1440) * dayW} height={height - headerH} fill="var(--bg-hover)" />
            ))}
            <text x={labelW + i * dayW + dayW / 2} y={18} textAnchor="middle" fontSize={11} fill="var(--text-2)">{fmtDate(d)}</text>
            <line x1={labelW + i * dayW} y1={headerH - 4} x2={labelW + i * dayW} y2={height} stroke="var(--border)" />
          </g>
        ))}
        {farms.map((f, i) => (
          <text key={f} x={labelW - 8} y={headerH + i * rowH + rowH / 2 + 4} textAnchor="end" fontSize={10} fill="var(--text-2)">{f}</text>
        ))}
        {assignments.map((a, idx) => {
          const fi = farmIndex[a.farm_id], di = dateIndex[a.date]
          if (fi === undefined || di === undefined) return null
          const s = toMins(a.start), e = toMins(a.end)
          return (
            <rect key={idx} x={labelW + di * dayW + (s / 1440) * dayW} y={headerH + fi * rowH + 4}
              width={Math.max(3, ((e - s) / 1440) * dayW)} height={rowH - 8} rx={3} fill={BAR} fillOpacity={0.85}>
              <title>{`${a.farm_id} · ${a.date} ${a.start}–${a.end} (${Number(a.hours).toFixed(1)} h)`}</title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}

export default function PumpScheduling({ settings }) {
  const { toast } = useToast()
  const [village, setVillage] = useState('')
  const [capacity, setCapacity] = useState('')
  const [days, setDays] = useState(14)
  const [result, setResult] = useState(null)

  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })
  const fleetParams = fleetQueryParams(settings)
  const { data: fleet = [], isLoading: fleetLoading, error: fleetError } = useQuery({
    queryKey: ['fleet', fleetParams], queryFn: () => getFleet(fleetParams), staleTime: 60000,
  })

  const villages = useMemo(() => [...new Set(fleet.map(f => f.village))].sort(), [fleet])
  useEffect(() => {
    if (villages.length && !villages.includes(village)) setVillage(villages[0])
  }, [villages, village])
  useEffect(() => {
    if (opts && capacity === '') setCapacity(opts.max_concurrent_pumps_per_feeder)
  }, [opts, capacity])
  // Settings changed elsewhere: the old schedule no longer matches the fleet.
  useEffect(() => { setResult(null) }, [fleetParams.crop_age_days, fleetParams.soil_type, fleetParams.irrigation_method, fleetParams.pump_flow_m3h])

  const windowHours = useMemo(() => (opts?.supply_windows || []).reduce((s, w) => {
    const [a, b] = [w.start, w.end].map(t => { const [h, m] = t.split(':').map(Number); return h + m / 60 })
    return s + (b - a)
  }, 0), [opts])

  const villageFarms = useMemo(() => fleet.filter(f => f.village === village && f.due_day < days), [fleet, village, days])
  const demandHours = villageFarms.reduce((s, f) => s + f.hours, 0)
  const capacityHours = (Number(capacity) || 0) * windowHours * days

  const scheduleMut = useMutation({
    mutationFn: getFeederSchedule,
    onSuccess: (data, vars) => { setResult({ ...data, farmsRequested: vars.farms.length, village }); toast('Schedule built', 'success') },
    onError: e => toast('Schedule error: ' + e.message, 'error'),
  })

  const handleBuild = e => {
    e.preventDefault()
    if (villageFarms.length === 0) { toast('No farms fall due in this village within the horizon', 'warn'); return }
    scheduleMut.mutate({
      farms: villageFarms.map(f => ({ farm_id: f.farm_id, hours: Math.max(0.5, f.hours), due_day: f.due_day, stress_index: f.stress_index || 0 })),
      start_date: new Date().toISOString().split('T')[0],
      days,
      max_concurrent: Number(capacity) || undefined,
    })
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pump Scheduling</h1>
        <p className="page-sub">Allocate pumping slots for farms sharing one electricity feeder. Earliest-due farms are served first, then the most water-stressed.</p>
      </div>

      {fleetError && <div className="alert error mb-4">Could not load fleet: {fleetError.message}</div>}

      <form className="filter-bar mb-4" onSubmit={handleBuild}>
        <div className="field">
          <label htmlFor="ps-village">Feeder (village)</label>
          <select id="ps-village" value={village} onChange={e => { setVillage(e.target.value); setResult(null) }}>
            {villages.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ps-cap">Max pumps at once</label>
          <input id="ps-cap" type="number" value={capacity} min="1" max="500" onChange={e => setCapacity(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ps-days">Horizon (days)</label>
          <input id="ps-days" type="number" value={days} min="1" max="21" onChange={e => setDays(Math.min(21, Math.max(1, parseInt(e.target.value) || 1)))} />
        </div>
        <div className="field wide">
          <span className="field-label">Supply windows ({windowHours} h/day)</span>
          <div className="readonly-value">{opts?.supply_windows?.map(w => `${w.start}–${w.end}`).join(' · ') || '—'}</div>
        </div>
        <button className="btn primary" type="submit" disabled={scheduleMut.isPending || !village || fleetLoading}>
          {scheduleMut.isPending ? 'Building…' : 'Build schedule'}
        </button>
      </form>

      <div className="stat-grid mb-5">
        <div className="stat-tile"><div className="stat-label">Farms due in horizon</div><div className="stat-value">{fleetLoading ? '…' : villageFarms.length}</div></div>
        <div className="stat-tile"><div className="stat-label">Pump-hours demanded</div><div className="stat-value">{Math.round(demandHours).toLocaleString('en-IN')}</div></div>
        <div className="stat-tile"><div className="stat-label">Feeder capacity</div><div className="stat-value">{Math.round(capacityHours).toLocaleString('en-IN')} h</div><div className="stat-delta">{capacity || '—'} pumps &times; {windowHours} h &times; {days} d</div></div>
        <div className="stat-tile">
          <div className="stat-label">Demand / capacity</div>
          <div className={'stat-value' + (demandHours > capacityHours ? ' tone-danger' : '')}>{capacityHours ? ((100 * demandHours) / capacityHours).toFixed(0) + '%' : '—'}</div>
          <div className="stat-delta">{demandHours > capacityHours ? 'over capacity: some farms will wait' : 'fits, before due-date constraints'}</div>
        </div>
      </div>

      {result && (
        <>
          <div className="stat-grid mb-5">
            <div className="stat-tile"><div className="stat-label">Fully scheduled</div><div className="stat-value tone-ok">{result.farmsRequested - (result.unscheduled?.length || 0)} / {result.farmsRequested}</div></div>
            <div className="stat-tile"><div className="stat-label">Unmet pump-hours</div><div className={'stat-value' + (result.unmet_hours > 0 ? ' tone-warn' : '')}>{result.unmet_hours?.toFixed(0)} / {result.demand_hours?.toFixed(0)}</div></div>
            <div className="stat-tile"><div className="stat-label">Peak concurrent pumps</div><div className="stat-value">{result.peak_concurrent_pumps ?? '—'}</div><div className="stat-delta">limit {result.capacity_per_slot}</div></div>
            <div className="stat-tile"><div className="stat-label">Feeder utilisation</div><div className="stat-value">{result.feeder_utilisation != null ? (result.feeder_utilisation * 100).toFixed(0) + '%' : '—'}</div></div>
          </div>

          <div className="alert info mb-4">{result.method_note}</div>

          <div className="card mb-4">
            <div className="card-header"><span className="card-title">Feeder load</span><span className="text-muted text-sm">pumps running per 30-minute slot</span></div>
            <div className="card-body"><FeederLoadChart assignments={result.assignments} capacity={result.capacity_per_slot} /></div>
          </div>

          <div className="card mb-4">
            <div className="card-header">
              <span className="card-title">Pump session timeline</span>
              <span className="text-muted text-sm">first 40 farms &middot; shaded = supply windows &middot; hover a bar</span>
            </div>
            <div className="card-body" style={{ padding: '8px 0 0 0' }}>
              <GanttChart assignments={result.assignments} windows={opts?.supply_windows} />
            </div>
          </div>

          {result.unscheduled?.length > 0 && (
            <div className="card mb-4">
              <div className="card-header">
                <span className="card-title">Farms that cannot finish in the horizon</span>
                <span className="card-tag danger">{result.unscheduled.length}</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <p className="card-foot text-sm">Raise feeder capacity, extend the horizon, or move these farms to drip (90% efficiency) to cut their pump-hours.</p>
                <div className="table-wrap" style={{ maxHeight: 280 }}>
                  <table className="data-table">
                    <thead><tr><th>Farm</th><th className="num">Needed h</th><th className="num">Scheduled h</th><th className="num">Unmet h</th></tr></thead>
                    <tbody>
                      {result.unscheduled.map(u => (
                        <tr key={u.farm_id}><td className="font-bold">{u.farm_id}</td><td className="num">{u.hours.toFixed(1)}</td><td className="num">{u.hours_scheduled.toFixed(1)}</td><td className="num">{u.hours_unmet.toFixed(1)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <span className="card-title">All sessions</span>
              <button className="btn sm" onClick={() => downloadCSV(result.assignments, `pump_schedule_${result.village}.csv`)}>Export CSV</button>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <div className="table-wrap" style={{ maxHeight: 420 }}>
                <table className="data-table">
                  <thead><tr><th>Farm</th><th>Date</th><th>Start</th><th>End</th><th className="num">Hours</th></tr></thead>
                  <tbody>
                    {result.assignments.map((a, i) => (
                      <tr key={i}><td className="font-bold">{a.farm_id}</td><td>{a.date}</td><td>{a.start}</td><td>{a.end}</td><td className="num">{Number(a.hours).toFixed(1)}</td></tr>
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
