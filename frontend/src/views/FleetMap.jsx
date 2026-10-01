import { lazy, Suspense, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFarmsGeoJSON, getFleet, getFarms, downloadCSV } from '../api.js'
import { useI18n } from '../i18n.jsx'
import FarmMap from '../components/FarmMap.jsx'
import { DueDayChart } from '../components/Charts.jsx'
import { Card, Stat, PageHeader, Icon, Segmented, StatusLine, Alert, Skeleton, STATUS_HEX, STATUS_VAR } from '../components/ui.jsx'

const Fleet3D = lazy(() => import('../three/Fleet3D.jsx'))
const PAGE = 50
const STATUSES = Object.keys(STATUS_HEX)

export function fleetQueryParams(settings) {
  return {
    crop_age_days: Math.min(settings?.cropAge ?? 180, 500),
    soil_type: settings?.soilType || undefined,
    irrigation_method: settings?.method || undefined,
    pump_flow_m3h: Number(settings?.pumpFlow) > 0 ? Number(settings.pumpFlow) : undefined,
  }
}

export default function FleetMap({ settings, onOpenFarm }) {
  const { t, fmtNum } = useI18n()
  const [taluk, setTaluk] = useState('All')
  const [village, setVillage] = useState('All')
  const [statusOn, setStatusOn] = useState(new Set(STATUSES))
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [mode, setMode] = useState('2d')

  const params = fleetQueryParams(settings)
  const { data: fleet = [], isLoading, error } = useQuery({ queryKey: ['fleet', params], queryFn: () => getFleet(params), staleTime: 60000 })
  const { data: farms } = useQuery({ queryKey: ['farms'], queryFn: getFarms, staleTime: 300000 })
  const geoParams = useMemo(() => (village !== 'All' ? { village } : taluk !== 'All' ? { taluk } : {}), [taluk, village])
  const { data: geojson } = useQuery({ queryKey: ['geojson', geoParams], queryFn: () => getFarmsGeoJSON(geoParams), staleTime: 300000 })

  const taluks = useMemo(() => ['All', ...[...new Set(fleet.map(f => f.taluk))].sort()], [fleet])
  const villages = useMemo(() => ['All', ...[...new Set(fleet.filter(f => taluk === 'All' || f.taluk === taluk).map(f => f.village))].sort()], [fleet, taluk])
  const area = useMemo(() => fleet.filter(f => (taluk === 'All' || f.taluk === taluk) && (village === 'All' || f.village === village)), [fleet, taluk, village])
  const counts = useMemo(() => area.reduce((c, f) => ((c[f.status] = (c[f.status] || 0) + 1), c), {}), [area])
  const visible = useMemo(() => area.filter(f => statusOn.has(f.status)), [area, statusOn])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return visible.filter(f => !q || f.farm_id.toLowerCase().includes(q) || f.village.toLowerCase().includes(q))
      .sort((a, b) => a.due_day - b.due_day || b.depletion_ratio - a.depletion_ratio)
  }, [visible, search])
  const week = useMemo(() => area.filter(f => f.due_day <= 7).reduce((s, f) => ({ v: s.v + f.volume_m3, h: s.h + f.hours }), { v: 0, h: 0 }), [area])
  const visibleGeo = useMemo(() => {
    if (!geojson) return geojson
    const keep = new Set(visible.map(f => f.farm_id))
    return { ...geojson, features: geojson.features.filter(f => keep.has(f.properties.farm_id)) }
  }, [geojson, visible])
  const toggle = k => setStatusOn(prev => {
    const next = new Set(prev)
    if (next.has(k) && next.size > 1) next.delete(k); else next.add(k)
    return next
  })

  return (
    <>
      <PageHeader eyebrow={t('nav.groupFleet')} title={t('fleet.title')}
        subtitle={t('fleet.subtitle', { day: params.crop_age_days, soil: t('soil.' + settings.soilType), method: t('method.' + settings.method), pump: params.pump_flow_m3h ?? '—' })}
        actions={<button className="btn" disabled={!rows.length} onClick={() => downloadCSV(rows, `fleet_status_${new Date().toISOString().slice(0, 10)}.csv`)}><Icon name="download" />{t('common.exportCsv')}</button>} />

      {error && <div className="mb-4"><Alert tone="error">{t('fleet.errorLoad', { msg: error.message })}</Alert></div>}

      <section className="panel">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          <div className="field"><label htmlFor="fl-taluk">{t('common.taluk')}</label>
            <select id="fl-taluk" value={taluk} onChange={e => { setTaluk(e.target.value); setVillage('All') }}>{taluks.map(x => <option key={x} value={x}>{x === 'All' ? t('common.all') : x}</option>)}</select></div>
          <div className="field"><label htmlFor="fl-village">{t('common.village')}</label>
            <select id="fl-village" value={village} onChange={e => setVillage(e.target.value)}>{villages.map(x => <option key={x} value={x}>{x === 'All' ? t('common.all') : x}</option>)}</select></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><span className="field-label">{t('fleet.showStatus')}</span>
            <div className="row">
              {STATUSES.map(k => (
                <button key={k} type="button" className={'chip-toggle' + (statusOn.has(k) ? ' on' : '')} aria-pressed={statusOn.has(k)} onClick={() => toggle(k)}>
                  <span className="swatch" style={{ background: STATUS_HEX[k] }} />{t('status.' + k)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="stat-grid mb-5">
        <Stat label={t('fleet.inArea')} icon="layers" value={fmtNum(area.length)} />
        {STATUSES.map(k => (
          <Stat key={k} label={t('status.' + k)} tone={STATUS_VAR[k]} icon={k === 'IRRIGATE_NOW' ? 'alert' : k === 'IRRIGATE_SOON' ? 'clock' : 'check'}
            value={fmtNum(counts[k] || 0)} delta={t('common.ofFarms', { pct: area.length ? fmtNum((100 * (counts[k] || 0)) / area.length) : 0 })} />
        ))}
        <Stat label={t('fleet.waterWeek')} icon="drop" tone="water" value={`${fmtNum(week.v)} m³`} delta={t('fleet.pumpHours', { n: fmtNum(week.h) })} />
      </div>

      <Card title={t('fleet.mapTitle')} icon={mode === '2d' ? 'globe' : 'cube'} flush className="mb-5"
        actions={<Segmented value={mode} onChange={setMode} options={[{ value: '2d', label: t('fleet.view2d'), icon: 'map' }, { value: '3d', label: t('fleet.view3d'), icon: 'cube' }]} />}>
        {isLoading ? <Skeleton height={540} style={{ borderRadius: 0 }} />
          : mode === '2d'
            ? <FarmMap geojson={visibleGeo} fleetData={visible} farmsMeta={farms} height={540} selectedId={settings?.farmId} onFarmClick={onOpenFarm} />
            : <Suspense fallback={<Skeleton height={540} style={{ borderRadius: 0 }} />}><Fleet3D fleet={visible} selectedId={settings?.farmId} onOpenFarm={onOpenFarm} height={540} /></Suspense>}
      </Card>

      <div className="grid-side">
        <Card title={t('fleet.byDay')} icon="chart"><DueDayChart fleet={visible} /></Card>
        <Card title={t('fleet.dueSoonest')} icon="clock" flush
          actions={<input type="search" className="inline-input" placeholder={t('fleet.filterPh')} value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE) }} aria-label={t('fleet.filterPh')} />}>
          <div className="table-wrap" style={{ maxHeight: 440 }}>
            <table className="data-table clickable">
              <thead><tr><th>{t('fleet.col.farm')}</th><th>{t('fleet.col.village')}</th><th>{t('fleet.col.status')}</th><th className="num">{t('fleet.col.due')}</th><th className="num">{t('fleet.col.depleted')}</th><th className="num">{t('fleet.col.hours')}</th></tr></thead>
              <tbody>
                {rows.slice(0, shown).map(f => (
                  <tr key={f.farm_id} onClick={() => onOpenFarm(f.farm_id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpenFarm(f.farm_id)}>
                    <td className="mono">{f.farm_id}</td><td>{f.village}</td><td><StatusLine status={f.status} short /></td>
                    <td className="num">{f.due_day === 0 ? t('common.today') : `${f.due_day} d`}</td>
                    <td className="num">{fmtNum(f.depletion_ratio * 100)}%</td><td className="num">{fmtNum(f.hours, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown && <button className="btn ghost full" onClick={() => setShown(s => s + PAGE)}>{t('common.showMore', { n: rows.length - shown })}</button>}
          {!rows.length && <div className="empty-state">{t('common.noMatch')}</div>}
        </Card>
      </div>
    </>
  )
}
