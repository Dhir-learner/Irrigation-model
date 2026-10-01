import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFleetAnalytics, downloadCSV } from '../api.js'
import { STATUS_COLOR } from '../components/FarmMap.jsx'
import { DemandCalendarChart, HistogramChart, CorrelationChart } from '../components/Charts.jsx'
import { fleetQueryParams } from './FleetMap.jsx'

const n0 = v => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }))

const COLUMNS = [
  { key: 'village', label: 'Village' },
  { key: 'taluk', label: 'Taluk' },
  { key: 'farms', label: 'Farms', num: true },
  { key: 'status_mix', label: 'Status mix', sortKey: 'irrigate_now' },
  { key: 'mean_relative_wetness', label: 'Wetness rank', num: true, fmt: v => v == null ? '—' : (v * 100).toFixed(0) + 'th' },
  { key: 'mean_due_day', label: 'Mean due (d)', num: true, fmt: v => v?.toFixed(1) },
  { key: 'volume_due_7d_m3', label: 'Water due 7d (m³)', num: true, fmt: n0 },
  { key: 'pump_hours_due_7d', label: 'Pump-h 7d', num: true, fmt: n0 },
]

function StatusMix({ row }) {
  const parts = [['IRRIGATE_NOW', row.irrigate_now], ['IRRIGATE_SOON', row.irrigate_soon], ['NOT_REQUIRED', row.not_required]]
  return (
    <div className="mix-bar" title={`Irrigate now ${row.irrigate_now} · Soon ${row.irrigate_soon} · Not required ${row.not_required}`}>
      {parts.map(([k, v]) => v > 0 && <span key={k} style={{ flex: v, background: STATUS_COLOR[k] }} />)}
    </div>
  )
}

export default function Analytics({ settings }) {
  const params = fleetQueryParams(settings)
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', params], queryFn: () => getFleetAnalytics(params), staleTime: 60000,
  })
  const [sort, setSort] = useState({ key: 'volume_due_7d_m3', dir: -1 })

  const villages = useMemo(() => {
    const rows = [...(data?.villages || [])]
    const key = COLUMNS.find(c => c.key === sort.key)?.sortKey || sort.key
    return rows.sort((a, b) => {
      const x = a[key], y = b[key]
      return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity)) * sort.dir
    })
  }, [data, sort])

  if (isLoading) return <div className="skeleton" style={{ height: 400 }} />
  if (error) return <div className="alert error">Could not load analytics: {error.message}</div>
  const t = data.totals
  const sm = data.feature_summary?.Predicted_Soil_Moisture
  const peak = data.demand_calendar.reduce((m, d) => (d.volume_m3 > (m?.volume_m3 ?? -1) ? d : m), null)

  return (
    <div>
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Fleet Analytics</h1>
          <p className="page-sub">Portfolio view for planners: where the water is needed, when, and how much the soil-moisture signal really varies.</p>
        </div>
        <button className="btn" onClick={() => downloadCSV(data.villages, 'village_summary.csv')}>Export village CSV</button>
      </div>

      <div className="stat-grid mb-5">
        <div className="stat-tile"><div className="stat-label">Farms &middot; area</div><div className="stat-value">{t.farms}</div><div className="stat-delta">{n0(t.area_ha)} ha</div></div>
        <div className="stat-tile"><div className="stat-label">Need water within 3 days</div><div className="stat-value">{t.irrigate_now + t.irrigate_soon}</div><div className="stat-delta">{t.irrigate_now} now &middot; {t.irrigate_soon} soon</div></div>
        <div className="stat-tile"><div className="stat-label">Gross water due in 7 days</div><div className="stat-value">{n0(t.volume_due_7d_m3)} m³</div><div className="stat-delta">{n0(t.pump_hours_due_7d)} pump-hours</div></div>
        <div className="stat-tile"><div className="stat-label">Fleet crop water use</div><div className="stat-value">{n0(t.daily_etc_m3)} m³/d</div><div className="stat-delta">mean ETc {t.mean_etc_mm_day} mm/d</div></div>
        <div className="stat-tile"><div className="stat-label">Peak demand day</div><div className="stat-value">{peak ? new Date(peak.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</div><div className="stat-delta">{peak ? `${n0(peak.volume_m3)} m³ · ${peak.farms_due} farms` : ''}</div></div>
      </div>

      <div className="card mb-5">
        <div className="card-header">
          <span className="card-title">Irrigation demand calendar, next 14 days</span>
          <span className="text-muted text-sm">gross volume of irrigations falling due each day</span>
        </div>
        <div className="card-body">
          <DemandCalendarChart calendar={data.demand_calendar} />
          {t.farms_due_beyond_horizon > 0 && <p className="text-muted text-xs mt-2">{t.farms_due_beyond_horizon} farms fall due after the 14-day horizon.</p>}
        </div>
      </div>

      <div className="card mb-5">
        <div className="card-header">
          <span className="card-title">Village summary</span>
          <span className="flex gap-3 text-xs text-muted">
            {[['IRRIGATE_NOW', 'Now'], ['IRRIGATE_SOON', 'Soon'], ['NOT_REQUIRED', 'Not required']].map(([k, l]) => (
              <span key={k}><span className="status-dot" style={{ background: STATUS_COLOR[k] }} />{l}</span>
            ))}
          </span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {COLUMNS.map(c => (
                    <th key={c.key} className={(c.num ? 'num ' : '') + 'sortable'} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                      <button onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}>
                        {c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {villages.map(v => (
                  <tr key={v.village}>
                    {COLUMNS.map(c => (
                      <td key={c.key} className={c.num ? 'num' : c.key === 'village' ? 'font-bold' : ''}>
                        {c.key === 'status_mix' ? <StatusMix row={v} /> : c.fmt ? c.fmt(v[c.key]) : v[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid-2 gap-4 mb-5">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Distribution of model soil moisture</span>
            <span className="card-tag">{data.soil_moisture_histogram.length} bins</span>
          </div>
          <div className="card-body">
            <HistogramChart bins={data.soil_moisture_histogram} format={v => Number(v).toFixed(3)} unit=" m³/m³" />
            {sm && (
              <p className="text-muted text-xs mt-2">
                Median {sm.median} &middot; IQR {sm.p25}–{sm.p75} &middot; CV {(sm.cv * 100).toFixed(1)}%.
                The whole fleet sits inside a {(sm.max - sm.min).toFixed(3)} m³/m³ band, far narrower than the
                field capacity–wilting point range, which is why the engine ranks it rather than reading it as an absolute value.
              </p>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Correlation with soil moisture</span>
            <span className="card-tag">Spearman &rho;</span>
          </div>
          <div className="card-body">
            <CorrelationChart rows={data.correlations} />
            <p className="text-muted text-xs mt-2">
              Rank correlation across 1,000 farms. Where Pearson and Spearman disagree in sign, the relation is driven by a few villages, not a trend.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Feature summary</span></div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Feature</th><th className="num">Mean</th><th className="num">Std</th><th className="num">Min</th><th className="num">P25</th><th className="num">Median</th><th className="num">P75</th><th className="num">Max</th><th className="num">CV</th><th className="num">Missing</th></tr></thead>
              <tbody>
                {Object.entries(data.feature_summary).map(([k, s]) => (
                  <tr key={k}>
                    <td className="font-bold">{k.replace(/_/g, ' ')}</td>
                    {['mean', 'std', 'min', 'p25', 'median', 'p75', 'max'].map(m => <td key={m} className="num">{s[m]}</td>)}
                    <td className="num">{s.cv != null ? (s.cv * 100).toFixed(1) + '%' : '—'}</td>
                    <td className="num">{s.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
