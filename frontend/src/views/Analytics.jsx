import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFleetAnalytics, downloadCSV } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { DemandCalendarChart, HistogramChart, CorrelationChart, VillageNeedChart } from '../components/Charts.jsx'
import { Card, Stat, PageHeader, Icon, Alert, Skeleton, Sparkline, STATUS_HEX } from '../components/ui.jsx'
import { fleetQueryParams } from './FleetMap.jsx'

function StatusMix({ row }) {
  const parts = [['IRRIGATE_NOW', row.irrigate_now], ['IRRIGATE_SOON', row.irrigate_soon], ['NOT_REQUIRED', row.not_required]]
  return (
    <div className="mix-bar" title={parts.map(([, v]) => v).join(' / ')}>
      {parts.map(([k, v]) => v > 0 && <span key={k} style={{ flex: v, background: STATUS_HEX[k] }} />)}
    </div>
  )
}

export default function Analytics({ settings }) {
  const { t, fmtNum, fmtDate } = useI18n()
  const params = fleetQueryParams(settings)
  const { data, isLoading, error } = useQuery({ queryKey: ['analytics', params], queryFn: () => getFleetAnalytics(params), staleTime: 60000 })
  const [sort, setSort] = useState({ key: 'volume_due_7d_m3', dir: -1 })

  const COLUMNS = [
    { key: 'village', label: t('analytics.col.village') },
    { key: 'taluk', label: t('analytics.col.taluk') },
    { key: 'farms', label: t('analytics.col.farms'), num: true },
    { key: 'mix', label: t('analytics.col.mix'), sortKey: 'irrigate_now' },
    { key: 'mean_relative_wetness', label: t('analytics.col.wet'), num: true, fmt: v => (v == null ? '—' : fmtNum(v * 100)) },
    { key: 'mean_due_day', label: t('analytics.col.due'), num: true, fmt: v => fmtNum(v, 1) },
    { key: 'volume_due_7d_m3', label: t('analytics.col.water'), num: true, fmt: v => fmtNum(v) },
    { key: 'pump_hours_due_7d', label: t('analytics.col.pumph'), num: true, fmt: v => fmtNum(v) },
  ]
  const villages = useMemo(() => {
    const rows = [...(data?.villages || [])]
    const key = sort.key === 'mix' ? 'irrigate_now' : sort.key
    return rows.sort((a, b) => (typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : (a[key] ?? -1) - (b[key] ?? -1)) * sort.dir)
  }, [data, sort])

  const header = <PageHeader eyebrow={t('nav.groupFleet')} title={t('analytics.title')} subtitle={t('analytics.subtitle')}
    actions={data && <button className="btn" onClick={() => downloadCSV(data.villages, 'village_summary.csv')}><Icon name="download" />{t('analytics.exportVillages')}</button>} />
  if (isLoading) return <>{header}<Skeleton height={420} /></>
  if (error) return <>{header}<Alert tone="error">{t('analytics.errorLoad', { msg: error.message })}</Alert></>

  const tot = data.totals
  const sm = data.feature_summary?.Predicted_Soil_Moisture
  const peak = data.demand_calendar.reduce((m, d) => (d.volume_m3 > (m?.volume_m3 ?? -1) ? d : m), null)

  return (
    <>
      {header}
      <div className="stat-grid mb-5">
        <Stat label={t('analytics.farmsArea')} icon="layers" value={fmtNum(tot.farms)} delta={`${fmtNum(tot.area_ha)} ha`} />
        <Stat label={t('analytics.need3')} icon="alert" tone="status-now" value={fmtNum(tot.irrigate_now + tot.irrigate_soon)} delta={t('analytics.nowSoon', { now: tot.irrigate_now, soon: tot.irrigate_soon })} />
        <Stat label={t('analytics.gross7')} icon="drop" tone="water" value={`${fmtNum(tot.volume_due_7d_m3)} m³`} delta={t('fleet.pumpHours', { n: fmtNum(tot.pump_hours_due_7d) })}>
          <Sparkline values={data.demand_calendar.map(d => d.volume_m3)} color="var(--water)" />
        </Stat>
        <Stat label={t('analytics.fleetUse')} icon="sun" tone="accent-2" value={`${fmtNum(tot.daily_etc_m3)} m³/d`} delta={t('analytics.meanEtc', { v: fmtNum(tot.mean_etc_mm_day, 2) })} />
        <Stat label={t('analytics.peakDay')} icon="calendar" tone="status-soon" value={peak ? fmtDate(peak.date) : '—'} delta={peak ? `${fmtNum(peak.volume_m3)} m³ · ${t('chart.farmsDue', { n: peak.farms_due })}` : ''} />
      </div>

      <div className="grid-main mb-5">
        <Card title={t('analytics.calendar')} icon="calendar" tag={t('analytics.calendarHint')}
          foot={tot.farms_due_beyond_horizon > 0 ? t('analytics.beyond', { n: tot.farms_due_beyond_horizon }) : null}>
          <DemandCalendarChart calendar={data.demand_calendar} height={280} />
        </Card>
        <Card title={t('analytics.radar')} icon="target" foot={t('analytics.radarHint')}>
          <VillageNeedChart villages={data.villages} height={280} />
        </Card>
      </div>

      <Card title={t('analytics.villages')} icon="map" flush className="mb-5"
        actions={<span className="row xs muted">{Object.keys(STATUS_HEX).map(k => <span key={k}><span className="status-dot" style={{ background: STATUS_HEX[k] }} />{t('status.short.' + k)}</span>)}</span>}>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{COLUMNS.map(c => (
              <th key={c.key} className={c.num ? 'num' : ''} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}>{c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button>
              </th>
            ))}</tr></thead>
            <tbody>
              {villages.map(v => (
                <tr key={v.village}>
                  {COLUMNS.map(c => (
                    <td key={c.key} className={c.num ? 'num' : c.key === 'village' ? 'strong' : ''}>
                      {c.key === 'mix' ? <StatusMix row={v} /> : c.fmt ? c.fmt(v[c.key]) : v[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid-2 mb-5">
        <Card title={t('analytics.hist')} icon="chart" tag={t('analytics.bins', { n: data.soil_moisture_histogram.length })}
          foot={sm && t('analytics.histNote', { med: sm.median, p25: sm.p25, p75: sm.p75, cv: fmtNum(sm.cv * 100, 1), band: fmtNum(sm.max - sm.min, 3) })}>
          <HistogramChart bins={data.soil_moisture_histogram} format={v => Number(v).toFixed(3)} unit=" m³/m³" />
        </Card>
        <Card title={t('analytics.corr')} icon="trend" tag="Spearman ρ" foot={t('analytics.corrNote')}>
          <CorrelationChart rows={data.correlations} />
        </Card>
      </div>

      <Card title={t('analytics.summary')} icon="layers" flush>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{['feature', 'mean', 'std', 'min', 'p25', 'median', 'p75', 'max', 'cv', 'missing'].map(k => <th key={k} className={k === 'feature' ? '' : 'num'}>{t('analytics.sumCol.' + k)}</th>)}</tr></thead>
            <tbody>
              {Object.entries(data.feature_summary).map(([k, s]) => (
                <tr key={k}>
                  <td className="strong">{t('feature.' + k)}</td>
                  {['mean', 'std', 'min', 'p25', 'median', 'p75', 'max'].map(m => <td key={m} className="num">{s[m]}</td>)}
                  <td className="num">{s.cv != null ? `${fmtNum(s.cv * 100, 1)}%` : '—'}</td>
                  <td className="num">{s.missing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
