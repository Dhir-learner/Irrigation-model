import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFarmsGeoJSON, getFleet, downloadCSV } from '../api.js'
import FarmMap, { STATUS_COLOR } from '../components/FarmMap.jsx'
import { DueDayChart } from '../components/Charts.jsx'

const STATUS = {
  IRRIGATE_NOW:  { label: 'Irrigate now', icon: '●' },
  IRRIGATE_SOON: { label: 'Due within 3 days', icon: '▲' },
  NOT_REQUIRED:  { label: 'Not required yet', icon: '✓' },
}
const PAGE = 50

export function fleetQueryParams(settings) {
  return {
    crop_age_days: Math.min(settings?.cropAge ?? 180, 500),
    soil_type: settings?.soilType || undefined,
    irrigation_method: settings?.method || undefined,
    pump_flow_m3h: Number(settings?.pumpFlow) > 0 ? Number(settings.pumpFlow) : undefined,
  }
}

export default function FleetMap({ settings, onOpenFarm }) {
  const [talukFilter, setTalukFilter] = useState('All')
  const [villageFilter, setVillageFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState(new Set(Object.keys(STATUS)))
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)

  const fleetParams = fleetQueryParams(settings)
  const { data: fleet = [], isLoading, error } = useQuery({
    queryKey: ['fleet', fleetParams], queryFn: () => getFleet(fleetParams), staleTime: 60000,
  })

  const geoParams = useMemo(() => {
    const p = {}
    if (talukFilter !== 'All') p.taluk = talukFilter
    if (villageFilter !== 'All') p.village = villageFilter
    return p
  }, [talukFilter, villageFilter])
  const { data: geojson } = useQuery({ queryKey: ['geojson', geoParams], queryFn: () => getFarmsGeoJSON(geoParams), staleTime: 300000 })

  const taluks = useMemo(() => ['All', ...[...new Set(fleet.map(f => f.taluk))].sort()], [fleet])
  const villages = useMemo(() =>
    ['All', ...[...new Set(fleet.filter(f => talukFilter === 'All' || f.taluk === talukFilter).map(f => f.village))].sort()]
  , [fleet, talukFilter])

  const areaFleet = useMemo(() => fleet.filter(f =>
    (talukFilter === 'All' || f.taluk === talukFilter) && (villageFilter === 'All' || f.village === villageFilter)
  ), [fleet, talukFilter, villageFilter])

  const counts = useMemo(() => {
    const c = { IRRIGATE_NOW: 0, IRRIGATE_SOON: 0, NOT_REQUIRED: 0 }
    areaFleet.forEach(f => { c[f.status] = (c[f.status] || 0) + 1 })
    return c
  }, [areaFleet])

  const visibleFleet = useMemo(() => areaFleet.filter(f => statusFilter.has(f.status)), [areaFleet, statusFilter])
  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return visibleFleet
      .filter(f => !q || f.farm_id.toLowerCase().includes(q) || f.village.toLowerCase().includes(q))
      .sort((a, b) => (a.due_day - b.due_day) || (b.depletion_ratio - a.depletion_ratio))
  }, [visibleFleet, search])

  const week = useMemo(() => {
    const due = areaFleet.filter(f => f.due_day <= 7)
    return {
      volume: due.reduce((s, f) => s + (f.volume_m3 || 0), 0),
      hours: due.reduce((s, f) => s + (f.hours || 0), 0),
    }
  }, [areaFleet])

  const toggleStatus = key => setStatusFilter(prev => {
    const next = new Set(prev)
    if (next.has(key) && next.size > 1) next.delete(key)
    else next.add(key)
    return next
  })

  // Hide polygons for statuses that are filtered out.
  const visibleGeo = useMemo(() => {
    if (!geojson) return geojson
    const keep = new Set(visibleFleet.map(f => f.farm_id))
    return { ...geojson, features: geojson.features.filter(f => keep.has(f.properties.farm_id)) }
  }, [geojson, visibleFleet])

  return (
    <div>
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Fleet Map</h1>
          <p className="page-sub">
            Every plot under shared settings: day {fleetParams.crop_age_days} &middot; {settings?.soilType?.replace(/_/g, ' ')} &middot; {settings?.method} &middot; {fleetParams.pump_flow_m3h ?? '—'} m³/h.
            Change them on the Farm Dashboard.
          </p>
        </div>
        <button className="btn" disabled={!tableRows.length} onClick={() => downloadCSV(tableRows, `fleet_status_${new Date().toISOString().slice(0, 10)}.csv`)}>
          Export CSV
        </button>
      </div>

      {error && <div className="alert error mb-4">Could not load fleet: {error.message}</div>}

      <div className="filter-bar mb-5">
        <div className="field">
          <label htmlFor="fl-taluk">Taluk</label>
          <select id="fl-taluk" value={talukFilter} onChange={e => { setTalukFilter(e.target.value); setVillageFilter('All') }}>
            {taluks.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fl-village">Village</label>
          <select id="fl-village" value={villageFilter} onChange={e => setVillageFilter(e.target.value)}>
            {villages.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Show status</span>
          <div className="chip-toggle-group">
            {Object.entries(STATUS).map(([k, v]) => (
              <button key={k} type="button" className={'chip-toggle' + (statusFilter.has(k) ? ' on' : '')}
                aria-pressed={statusFilter.has(k)} onClick={() => toggleStatus(k)}>
                <span className="swatch" style={{ background: STATUS_COLOR[k] }} aria-hidden="true" />{v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="stat-grid mb-5">
        <div className="stat-tile"><div className="stat-label">Farms in area</div><div className="stat-value">{areaFleet.length}</div></div>
        {Object.entries(STATUS).map(([k, v]) => (
          <div className="stat-tile" key={k}>
            <div className="stat-label"><span style={{ color: STATUS_COLOR[k] }} aria-hidden="true">{v.icon}</span> {v.label}</div>
            <div className="stat-value">{counts[k]}</div>
            <div className="stat-delta">{areaFleet.length ? ((100 * counts[k]) / areaFleet.length).toFixed(0) : 0}% of farms</div>
          </div>
        ))}
        <div className="stat-tile">
          <div className="stat-label">Water due in 7 days</div>
          <div className="stat-value">{Math.round(week.volume).toLocaleString('en-IN')} m³</div>
          <div className="stat-delta">{Math.round(week.hours).toLocaleString('en-IN')} pump-hours</div>
        </div>
      </div>

      <div className="card mb-5">
        <div className="card-header">
          <span className="card-title">Plots by irrigation status</span>
          <span className="text-muted text-sm">click a plot to open its advisory</span>
        </div>
        {isLoading
          ? <div className="skeleton" style={{ height: 460 }} />
          : <FarmMap geojson={visibleGeo} fleetData={visibleFleet} height={460} selectedId={settings?.farmId} onFarmClick={onOpenFarm} />}
      </div>

      <div className="grid-2 gap-4">
        <div className="card">
          <div className="card-header"><span className="card-title">Farms by days until irrigation</span></div>
          <div className="card-body"><DueDayChart fleet={visibleFleet} /></div>
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Due soonest</span>
            <input type="search" className="inline-search" placeholder="Filter farm or village" value={search}
              onChange={e => { setSearch(e.target.value); setShown(PAGE) }} aria-label="Filter table" />
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="data-table clickable">
                <thead>
                  <tr><th>Farm</th><th>Village</th><th>Status</th><th className="num">Due</th><th className="num">Depleted</th><th className="num">Hours</th></tr>
                </thead>
                <tbody>
                  {tableRows.slice(0, shown).map(f => (
                    <tr key={f.farm_id} onClick={() => onOpenFarm(f.farm_id)} tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && onOpenFarm(f.farm_id)} title="Open advisory">
                      <td className="font-bold">{f.farm_id}</td>
                      <td>{f.village}</td>
                      <td><span className="status-dot" style={{ background: STATUS_COLOR[f.status] }} aria-hidden="true" />{STATUS[f.status]?.label}</td>
                      <td className="num">{f.due_day === 0 ? 'today' : `${f.due_day} d`}</td>
                      <td className="num">{(f.depletion_ratio * 100).toFixed(0)}%</td>
                      <td className="num">{f.hours?.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tableRows.length > shown && (
              <button className="btn ghost full" onClick={() => setShown(s => s + PAGE)}>
                Show more ({tableRows.length - shown} remaining)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
