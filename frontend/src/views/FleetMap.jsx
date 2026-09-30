import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFarmsGeoJSON, getFleet } from '../api.js'
import FarmMap from '../components/FarmMap.jsx'
import { DueDayChart } from '../components/Charts.jsx'

const STATUS = {
  IRRIGATE_NOW:  { label: 'Irrigate now',  color: '#ef4444' },
  IRRIGATE_SOON: { label: 'Due in 3 days', color: '#f59e0b' },
  NOT_REQUIRED:  { label: 'Not required',  color: '#22c55e' },
}

function StatTile({ label, value, color }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : {}}>{value ?? '\u2014'}</div>
    </div>
  )
}

export default function FleetMap({ settings }) {
  const [talukFilter, setTalukFilter] = useState('All')
  const [villageFilter, setVillageFilter] = useState('All')
  const cropAge = settings?.cropAge || 180

  const fleetParams = { crop_age_days: cropAge }
  if (settings?.soilType) fleetParams.soil_type = settings.soilType
  if (settings?.method) fleetParams.irrigation_method = settings.method

  const { data: fleet = [], isLoading } = useQuery({
    queryKey: ['fleet', fleetParams],
    queryFn: () => getFleet(fleetParams),
    staleTime: 60000,
  })

  const geoParams = useMemo(() => {
    const p = {}
    if (talukFilter !== 'All') p.taluk = talukFilter
    if (villageFilter !== 'All') p.village = villageFilter
    return p
  }, [talukFilter, villageFilter])

  const { data: geojson } = useQuery({
    queryKey: ['geojson', geoParams],
    queryFn: () => getFarmsGeoJSON(geoParams),
    staleTime: 60000,
  })

  const taluks = useMemo(() => ['All', ...new Set(fleet.map(f => f.taluk))].sort(), [fleet])

  const filteredFleet = useMemo(() => {
    let f = fleet
    if (talukFilter !== 'All') f = f.filter(x => x.taluk === talukFilter)
    if (villageFilter !== 'All') f = f.filter(x => x.village === villageFilter)
    return f
  }, [fleet, talukFilter, villageFilter])

  const villages = useMemo(() =>
    ['All', ...new Set(fleet.filter(f => talukFilter === 'All' || f.taluk === talukFilter).map(f => f.village))].sort()
  , [fleet, talukFilter])

  const counts = useMemo(() => {
    const c = { IRRIGATE_NOW: 0, IRRIGATE_SOON: 0, NOT_REQUIRED: 0 }
    filteredFleet.forEach(f => { if (c[f.status] !== undefined) c[f.status]++ })
    return c
  }, [filteredFleet])

  const waterDue7 = useMemo(() =>
    filteredFleet.filter(f => f.due_day <= 7).reduce((s, f) => s + (f.volume_m3 || 0), 0)
  , [filteredFleet])

  // Build fleetData lookup for map colouring
  const fleetDataForMap = filteredFleet.map(f => ({
    farm_id: f.farm_id,
    status: f.status,
    next_irrigation_date: f.next_irrigation_date,
    duration_hours: f.hours,
  }))

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Fleet Map</h1>
        <p className="page-sub">Every plot coloured by irrigation status under shared crop and equipment settings.</p>
      </div>

      {/* Filters */}
      <div className="filter-bar mb-5">
        <div className="field">
          <label>Taluk</label>
          <select value={talukFilter} onChange={e => { setTalukFilter(e.target.value); setVillageFilter('All') }}>
            {taluks.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Village</label>
          <select value={villageFilter} onChange={e => setVillageFilter(e.target.value)}>
            {villages.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="stat-grid mb-5">
        <StatTile label="Total farms" value={filteredFleet.length} />
        <StatTile label="Irrigate now" value={counts.IRRIGATE_NOW} color="#ef4444" />
        <StatTile label="Due in 3 days" value={counts.IRRIGATE_SOON} color="#f59e0b" />
        <StatTile label="Not required" value={counts.NOT_REQUIRED} color="#22c55e" />
        <StatTile label="Water due in 7d" value={waterDue7.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' m\u00B3'} />
      </div>

      {/* Map */}
      <div className="card mb-5">
        <div className="card-header">
          <span className="card-title">Plots by irrigation status</span>
          <div style={{ display: 'flex', gap: 12 }}>
            {Object.entries(STATUS).map(([k, v]) => (
              <span key={k} style={{ fontSize: '0.75rem', color: v.color, fontWeight: 600 }}>
                &bull; {v.label}
              </span>
            ))}
          </div>
        </div>
        {isLoading
          ? <div className="skeleton" style={{ height: 440 }} />
          : <FarmMap geojson={geojson} fleetData={fleetDataForMap} height={440} tall />
        }
      </div>

      {/* Due-day chart + table */}
      <div className="grid-2 gap-4">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Farms by days until irrigation</span>
          </div>
          <div className="card-body">
            <DueDayChart fleet={filteredFleet} />
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Due soonest</span>
            <span className="text-muted text-sm">sorted by urgency</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Farm ID</th><th>Village</th><th>Status</th><th>Due (days)</th><th>Hours</th><th>Stress</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filteredFleet]
                    .sort((a, b) => (a.due_day - b.due_day) || (b.stress_index - a.stress_index))
                    .map(f => (
                    <tr key={f.farm_id}>
                      <td style={{ fontWeight: 600 }}>{f.farm_id}</td>
                      <td>{f.village}</td>
                      <td>
                        <span style={{ color: STATUS[f.status]?.color || '#38bdf8', fontWeight: 600, fontSize: '0.78rem' }}>
                          {f.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td>{f.due_day}</td>
                      <td>{f.hours?.toFixed(1)}</td>
                      <td>{f.stress_index?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
