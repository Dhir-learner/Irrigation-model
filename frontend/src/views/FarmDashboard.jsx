import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getOptions, getFarms, getFarm, getFarmPlan, getFarmsGeoJSON, getFleet, postFeedback, postFarmWhatIf } from '../api.js'
import { useToast, useTheme } from '../context.jsx'
import SoilGauge from '../components/SoilGauge.jsx'
import FarmMap from '../components/FarmMap.jsx'
import { WaterBalanceChart, YieldLossChart, ContributionChart, KcCurveChart, fmtDate } from '../components/Charts.jsx'

export const STATUS = {
  IRRIGATE_NOW:  { label: 'Irrigate now',           cls: 'irrigate-now',  icon: '●' },
  IRRIGATE_SOON: { label: 'Irrigate within 3 days', cls: 'irrigate-soon', icon: '▲' },
  NOT_REQUIRED:  { label: 'Not required yet',       cls: 'not-required',  icon: '✓' },
}
const SPEECH_LANG = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN', mr: 'mr-IN' }
const WHATIF_FEATURES = [
  { key: 'Rainfall_mm', label: 'Seasonal rainfall', unit: 'mm', step: 1 },
  { key: 'Temperature_C', label: 'Mean temperature', unit: '°C', step: 0.1 },
  { key: 'Relative_Humidity', label: 'Relative humidity', unit: '%', step: 0.5 },
  { key: 'NDVI', label: 'NDVI', unit: '', step: 0.01 },
  { key: 'LAI', label: 'LAI', unit: '', step: 0.01 },
]
const TABS = [
  { id: 'advisory', label: 'Advisory' },
  { id: 'water', label: 'Water balance' },
  { id: 'model', label: 'Model & what-if' },
  { id: 'review', label: 'Review' },
]

const fmt = (v, d = 1, suffix = '') => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d) + suffix)
const fmtInt = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }))

function StatTile({ label, value, delta, tone }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className={'stat-value' + (tone ? ' tone-' + tone : '')}>{value ?? '—'}</div>
      {delta && <div className="stat-delta">{delta}</div>}
    </div>
  )
}

function parseRain(text) {
  if (!text.trim()) return []
  return text.split(/[,\s]+/).filter(Boolean).map(Number).filter(n => Number.isFinite(n) && n >= 0).slice(0, 14)
}

export default function FarmDashboard({ language, settings, onSettingsChange }) {
  const { toast } = useToast()
  const { theme } = useTheme()
  const queryClient = useQueryClient()
  const today = new Date().toISOString().split('T')[0]
  const { farmId, plantingDate, soilType, method, pumpFlow, cropAge } = settings

  const [taluk, setTaluk] = useState('All')
  const [village, setVillage] = useState('All')
  const [search, setSearch] = useState('')
  const [sensor, setSensor] = useState('')
  const [rainText, setRainText] = useState('')
  const [useLive, setUseLive] = useState(false)
  const [activeTab, setActiveTab] = useState('advisory')
  const [wiValues, setWiValues] = useState({})
  const [wiResult, setWiResult] = useState(null)
  const [speaking, setSpeaking] = useState(false)

  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })
  const { data: farms = [], isLoading: farmsLoading, error: farmsError } = useQuery({ queryKey: ['farms'], queryFn: getFarms, staleTime: 300000 })

  const taluks = useMemo(() => ['All', ...[...new Set(farms.map(f => f.taluk))].sort()], [farms])
  const byTaluk = useMemo(() => (taluk === 'All' ? farms : farms.filter(f => f.taluk === taluk)), [farms, taluk])
  const villages = useMemo(() => ['All', ...[...new Set(byTaluk.map(f => f.village))].sort()], [byTaluk])
  const filteredFarms = useMemo(() => {
    const list = village === 'All' ? byTaluk : byTaluk.filter(f => f.village === village)
    const q = search.trim().toLowerCase()
    return q ? list.filter(f => f.farm_id.toLowerCase().includes(q)) : list
  }, [byTaluk, village, search])

  const currentFarm = farms.find(f => f.farm_id === farmId)

  // Keep the selected farm valid: when filters exclude it (or nothing is selected yet),
  // pick the first matching farm instead of leaving an empty ID that would 404.
  useEffect(() => {
    if (farms.length === 0 || filteredFarms.length === 0) return
    if (!filteredFarms.some(f => f.farm_id === farmId)) onSettingsChange({ farmId: filteredFarms[0].farm_id })
  }, [farms, filteredFarms, farmId, onSettingsChange])

  // A farm opened from another view (map, analytics) should be visible in the filters.
  useEffect(() => {
    if (!currentFarm) return
    if (taluk !== 'All' && currentFarm.taluk !== taluk) { setTaluk('All'); setVillage('All') }
    else if (village !== 'All' && currentFarm.village !== village) setVillage('All')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId])

  useEffect(() => { setWiValues({}); setWiResult(null) }, [farmId])

  const rainForecast = useMemo(() => parseRain(rainText), [rainText])
  const sensorValue = sensor === '' ? null : Number(sensor)
  const sensorValid = sensorValue === null || (sensorValue >= 0 && sensorValue <= 0.6)

  const planBody = useMemo(() => ({
    crop_age_days: Math.min(cropAge, 500),
    sensor_soil_moisture: sensorValid ? sensorValue : null,
    soil_type: soilType || undefined,
    irrigation_method: method || undefined,
    pump_flow_m3h: Number(pumpFlow) > 0 ? Number(pumpFlow) : undefined,
    forecast_rain_mm: rainForecast,
    use_live_weather: useLive,
    language,
  }), [cropAge, sensorValue, sensorValid, soilType, method, pumpFlow, rainForecast, useLive, language])

  const planEnabled = Boolean(currentFarm)
  const { data: plan, isFetching: planLoading, error: planError, refetch: refetchPlan } = useQuery({
    queryKey: ['plan', farmId, planBody],
    queryFn: () => getFarmPlan(farmId, planBody),
    enabled: planEnabled,
    placeholderData: prev => prev,
    staleTime: 30000,
  })

  const geoParams = useMemo(() => {
    const p = {}
    if (taluk !== 'All') p.taluk = taluk
    if (village !== 'All') p.village = village
    return p
  }, [taluk, village])
  const { data: geojson } = useQuery({ queryKey: ['geojson', geoParams], queryFn: () => getFarmsGeoJSON(geoParams), staleTime: 300000 })

  const fleetParams = { crop_age_days: Math.min(cropAge, 500), soil_type: soilType, irrigation_method: method, pump_flow_m3h: pumpFlow || undefined }
  const { data: fleet } = useQuery({ queryKey: ['fleet', fleetParams], queryFn: () => getFleet(fleetParams), enabled: Boolean(soilType && method), staleTime: 60000 })

  const { data: farmDetail } = useQuery({ queryKey: ['farmDetail', farmId], queryFn: () => getFarm(farmId), enabled: planEnabled, staleTime: 300000 })

  const feedbackMut = useMutation({
    mutationFn: postFeedback,
    onSuccess: () => { toast('Decision recorded', 'success'); queryClient.invalidateQueries({ queryKey: ['feedback'] }) },
    onError: e => toast('Could not record decision: ' + e.message, 'error'),
  })
  const whatIfMut = useMutation({
    mutationFn: changes => postFarmWhatIf(farmId, { ...planBody, sensor_soil_moisture: null, use_live_weather: false, changes }),
    onSuccess: setWiResult,
    onError: e => toast('What-if failed: ' + e.message, 'error'),
  })

  const planData = plan?.plan
  const rec = planData?.recommendation
  const statusInfo = rec ? (STATUS[rec.status] || STATUS.NOT_REQUIRED) : null
  const soilWater = planData?.soil_water
  const availablePct = soilWater ? 100 * (1 - soilWater.depletion_ratio) : null
  const triggerPct = soilWater ? 100 * (1 - soilWater.depletion_fraction_p) : null
  const soonPct = soilWater && planData ? 100 * (1 - Math.max(0, soilWater.raw_mm - 3 * planData.water_requirement.etc_mm_day) / soilWater.taw_mm) : null
  const calibration = plan?.soil_moisture_calibration
  const farmFields = farmDetail?.farm

  const stepFarm = useCallback(dir => {
    const i = filteredFarms.findIndex(f => f.farm_id === farmId)
    const next = filteredFarms[(i + dir + filteredFarms.length) % filteredFarms.length]
    if (next) onSettingsChange({ farmId: next.farm_id })
  }, [filteredFarms, farmId, onSettingsChange])

  const handleFeedback = e => {
    e.preventDefault()
    const fd = new FormData(e.target)
    const decision = fd.get('decision')
    const overrideHours = fd.get('hours') === '' ? undefined : Number(fd.get('hours'))
    feedbackMut.mutate({
      farm_id: farmId,
      reviewer_role: fd.get('role'),
      decision,
      recommended_date: rec?.next_irrigation_date,
      recommended_hours: rec?.duration_hours,
      override_date: decision === 'modified' ? (fd.get('date') || undefined) : undefined,
      override_hours: decision === 'modified' ? overrideHours : undefined,
      comment: fd.get('comment') || undefined,
      soil_moisture_source: plan?.soil_moisture_source,
    })
    e.target.reset()
  }

  const handleWhatIf = () => {
    const changes = Object.fromEntries(Object.entries(wiValues).filter(([, v]) => v !== undefined))
    if (Object.keys(changes).length === 0) { toast('Move at least one slider first', 'warn'); return }
    whatIfMut.mutate(changes)
  }

  const copyAdvisory = async () => {
    try { await navigator.clipboard.writeText(plan.advisory_text); toast('Advisory copied', 'success') }
    catch { toast('Clipboard not available in this browser', 'warn') }
  }
  const speakAdvisory = () => {
    if (!('speechSynthesis' in window)) { toast('Text-to-speech is not supported in this browser', 'warn'); return }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return }
    const u = new SpeechSynthesisUtterance(plan.advisory_text)
    u.lang = SPEECH_LANG[language] || 'en-IN'
    u.rate = 0.95
    u.onend = u.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(u)
    setSpeaking(true)
  }
  useEffect(() => () => window.speechSynthesis?.cancel(), [])
  const whatsappLink = plan ? `https://wa.me/?text=${encodeURIComponent(`${farmId}: ${plan.advisory_text}`)}` : '#'

  const handleExportPDF = async () => {
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
      const el = document.getElementById('advisory-panel')
      const bg = getComputedStyle(document.body).backgroundColor || (theme === 'dark' ? '#080b12' : '#ffffff')
      const canvas = await html2canvas(el, { scale: 1.5, backgroundColor: bg, useCORS: true })
      const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save(`advisory_${farmId}_${today}.pdf`)
      toast('PDF exported', 'success')
    } catch (e) {
      toast('PDF export failed: ' + e.message, 'error')
    }
  }

  if (farmsError) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Farm Advisory</h1></div>
        <div className="alert error">Could not load farms: {farmsError.message}</div>
      </div>
    )
  }

  return (
    <div id="advisory-panel">
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Farm Advisory</h1>
          <p className="page-sub">FAO-56 irrigation engine &middot; KJS-AGR-01 prototype</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={() => stepFarm(-1)} disabled={filteredFarms.length < 2} title="Previous farm">&larr; Prev</button>
          <button className="btn" onClick={() => stepFarm(1)} disabled={filteredFarms.length < 2} title="Next farm">Next &rarr;</button>
          <button className="btn" onClick={handleExportPDF} disabled={!plan}>Export PDF</button>
        </div>
      </div>

      <section className="filter-bar" aria-label="Farm and crop settings">
        <div className="field">
          <label htmlFor="f-taluk">Taluk</label>
          <select id="f-taluk" value={taluk} onChange={e => { setTaluk(e.target.value); setVillage('All') }}>
            {taluks.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-village">Village</label>
          <select id="f-village" value={village} onChange={e => setVillage(e.target.value)}>
            {villages.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-search">Search ID</label>
          <input id="f-search" type="search" value={search} placeholder="e.g. 0110" onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-farm">Farm ({filteredFarms.length})</label>
          <select id="f-farm" value={currentFarm ? farmId : ''} onChange={e => onSettingsChange({ farmId: e.target.value })} disabled={farmsLoading}>
            {farmsLoading && <option value="">Loading…</option>}
            {!farmsLoading && filteredFarms.length === 0 && <option value="">No match</option>}
            {filteredFarms.map(f => <option key={f.farm_id} value={f.farm_id}>{f.farm_id}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-plant">Planting date &middot; day {cropAge}</label>
          <input id="f-plant" type="date" value={plantingDate} max={today} onChange={e => onSettingsChange({ plantingDate: e.target.value })} />
        </div>
        {opts && (
          <>
            <div className="field">
              <label htmlFor="f-soil">Soil texture</label>
              <select id="f-soil" value={soilType} onChange={e => onSettingsChange({ soilType: e.target.value })}>
                {opts.soils?.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-method">Irrigation method</label>
              <select id="f-method" value={method} onChange={e => onSettingsChange({ method: e.target.value })}>
                {opts.methods && Object.entries(opts.methods).map(([m, eff]) => <option key={m} value={m}>{m} ({Math.round(eff * 100)}%)</option>)}
              </select>
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="f-pump">Pump (m³/h)</label>
          <input id="f-pump" type="number" value={pumpFlow} min="1" max="200" step="0.5" onChange={e => onSettingsChange({ pumpFlow: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="f-probe">Probe reading (m³/m³)</label>
          <input id="f-probe" type="number" value={sensor} min="0" max="0.6" step="0.005" placeholder="optional"
            aria-invalid={!sensorValid} className={sensorValid ? '' : 'invalid'} onChange={e => setSensor(e.target.value)} />
        </div>
        <div className="field wide">
          <label htmlFor="f-rain">Rain forecast, mm/day</label>
          <input id="f-rain" type="text" value={rainText} placeholder="e.g. 0, 12, 25 (from today)" onChange={e => setRainText(e.target.value)} />
        </div>
        <label className="check-field">
          <input type="checkbox" checked={useLive} onChange={e => setUseLive(e.target.checked)} />
          Live weather
        </label>
        <button className="btn primary" onClick={() => planEnabled && refetchPlan()} disabled={!planEnabled || planLoading}>
          {planLoading ? 'Updating…' : 'Refresh'}
        </button>
      </section>

      {!sensorValid && <div className="alert warn mb-4">Probe reading must be between 0 and 0.6 m³/m³; it is being ignored.</div>}
      {planError && <div className="alert error mb-4">Advisory error: {planError.message}</div>}
      {!planError && !plan && planEnabled && <div className="skeleton mb-5" style={{ height: 150 }} />}

      {statusInfo && rec && (
        <div className={'mb-5' + (planLoading ? ' is-stale' : '')}>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className={'status-badge ' + statusInfo.cls}><span aria-hidden="true">{statusInfo.icon}</span> {statusInfo.label}</span>
            {currentFarm && (
              <span className="text-muted text-sm">
                {farmId} &middot; {currentFarm.village}, {currentFarm.taluk} &middot; {fmt(currentFarm.area_ha, 2)} ha &middot; {planData.crop.stage_label} (day {cropAge})
              </span>
            )}
          </div>
          <div className="stat-grid">
            <StatTile label="Available water" value={fmt(availablePct, 0, '%')}
              delta={plan.soil_moisture_source === 'sensor' ? `probe ${fmt(plan.soil_moisture_used, 3)} m³/m³` : `ML index → ${fmt(plan.soil_moisture_used, 3)} m³/m³`}
              tone={availablePct <= triggerPct ? 'danger' : availablePct <= soonPct ? 'warn' : undefined} />
            <StatTile label="Next irrigation" value={fmtDate(rec.next_irrigation_date)}
              delta={rec.days_until_irrigation === 0 ? 'today' : `in ${rec.days_until_irrigation} day${rec.days_until_irrigation === 1 ? '' : 's'}`} />
            <StatTile label="Pump run time" value={fmt(rec.duration_hours, 1, ' h')} delta={`${fmtInt(rec.volume_m3)} m³ gross · ${fmt(rec.gross_depth_mm, 0)} mm`} />
            <StatTile label="Crop water use" value={fmt(planData.water_requirement.etc_mm_day, 1, ' mm/d')} delta={`Kc ${planData.crop.kc} · ETo ${fmt(planData.water_requirement.eto_mm_day, 1)}`} />
            <StatTile label="Water stress" value={planData.water_stress.category.replace(/_/g, ' ')}
              delta={`Ks ${fmt(planData.water_stress.ks, 2)}`} tone={planData.water_stress.stress_index > 0.2 ? 'danger' : undefined} />
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} className={'tab' + (activeTab === t.id ? ' active' : '')} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'advisory' && (
        <div className="grid-2 gap-4">
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Plot view</span>
                <span className="text-muted text-sm">{village !== 'All' ? village : taluk !== 'All' ? taluk : 'All plots'} &middot; click a plot to open it</span>
              </div>
              <FarmMap geojson={geojson} fleetData={fleet} selectedId={farmId} focusSelected
                onFarmClick={id => onSettingsChange({ farmId: id })} height={320} />
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Root-zone moisture</span>
                <span className={'card-tag ' + (plan?.soil_moisture_source === 'sensor' ? 'ok' : 'warn')}>
                  {plan?.soil_moisture_source === 'sensor' ? 'field probe' : 'ML estimate'}
                </span>
              </div>
              <div className="card-body flex items-center gap-4 flex-wrap">
                <SoilGauge availablePct={availablePct} triggerPct={triggerPct} soonPct={soonPct}
                  caption={triggerPct != null ? `trigger at ${triggerPct.toFixed(0)}%` : null} />
                <dl className="kv-list" style={{ flex: 1, minWidth: 200 }}>
                  {calibration?.method === 'percentile_rank' && (<>
                    <dt>Model value</dt><dd>{fmt(calibration.model_value, 4)} m³/m³</dd>
                    <dt>Wetness rank</dt><dd>{fmt(calibration.relative_wetness * 100, 0)}th pct of fleet</dd>
                  </>)}
                  <dt>Root-zone used</dt><dd>{fmt(plan?.soil_moisture_used, 3)} m³/m³</dd>
                  <dt>FC / WP</dt><dd>{fmt(soilWater?.field_capacity, 2)} / {fmt(soilWater?.wilting_point, 2)}</dd>
                  <dt>NDVI &middot; LAI</dt><dd>{fmt(farmFields?.NDVI, 3)} &middot; {fmt(farmFields?.LAI, 2)}</dd>
                  <dt>Temp &middot; RH</dt><dd>{fmt(farmFields?.Temperature_C, 1, ' °C')} &middot; {fmt(farmFields?.Relative_Humidity, 0, '%')}</dd>
                  <dt>Season rain</dt><dd>{fmt(farmFields?.Rainfall_mm, 0, ' mm')}</dd>
                  <dt>Soil pH &middot; OC</dt><dd>{fmt(farmFields?.Soil_pH, 1)} &middot; {fmt(farmFields?.Organic_Carbon, 1)}</dd>
                </dl>
              </div>
              {calibration?.note && <p className="card-foot text-muted text-xs">{calibration.note}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {plan && (
              <>
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Irrigation advisory</span>
                    <div className="flex gap-2">
                      <button className="btn sm" onClick={copyAdvisory}>Copy</button>
                      <button className="btn sm" onClick={speakAdvisory} aria-pressed={speaking}>{speaking ? 'Stop' : 'Read aloud'}</button>
                      <a className="btn sm" href={whatsappLink} target="_blank" rel="noreferrer">WhatsApp</a>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className={'advisory-text' + (rec?.status === 'IRRIGATE_NOW' ? ' urgent' : '')} lang={language}>
                      {plan.advisory_text}
                    </div>
                    {planData?.rainfall_adjustment?.postponed_days > 0 && (
                      <div className="alert info mt-2">
                        Forecast rain of {fmt(planData.rainfall_adjustment.forecast_rain_mm, 0)} mm postpones irrigation by {planData.rainfall_adjustment.postponed_days} day(s).
                      </div>
                    )}
                    <p className="text-muted text-xs mt-2">Weather: {plan.weather?.note}</p>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Crop stage</span>
                    <span className="card-tag">{planData.crop.stage_label} &middot; root {planData.crop.root_depth_m} m</span>
                  </div>
                  <div className="card-body">
                    <KcCurveChart stageDays={opts?.stage_days} kc={opts?.kc} cropAge={cropAge} />
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Fertigation &middot; next split</span>
                    <span className="card-tag warn">placeholder doses</span>
                  </div>
                  <div className="card-body" style={{ padding: 0 }}>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead><tr><th>Product</th><th className="num">kg/acre</th><th className="num">kg (this plot)</th></tr></thead>
                        <tbody>
                          {Object.entries(plan.fertigation?.products_per_application_kg_acre || {}).map(([p, v]) => (
                            <tr key={p}>
                              <td>{p}</td>
                              <td className="num">{fmt(v, 2)}</td>
                              <td className="num">{fmt(plan.fertigation.products_per_application_kg_plot?.[p], 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="card-foot text-muted text-xs">
                      {plan.fertigation?.applications_in_stage} splits this stage &middot; organic carbon {plan.fertigation?.organic_carbon_rating} (N factor {plan.fertigation?.nitrogen_adjustment_factor}) &middot; {plan.fertigation?.timing_note}
                    </p>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Pump sessions</span>
                    <span className="text-muted text-sm">{(plan.pump_sessions || []).length} sessions &middot; morning window first</span>
                  </div>
                  <div className="card-body" style={{ padding: 0 }}>
                    <div className="table-wrap" style={{ maxHeight: 260 }}>
                      <table className="data-table">
                        <thead><tr><th>Date</th><th>Start</th><th>End</th><th className="num">Hours</th></tr></thead>
                        <tbody>
                          {(plan.pump_sessions || []).map((s, i) => (
                            <tr key={i}><td>{s.date}</td><td>{s.start}</td><td>{s.end}</td><td className="num">{fmt(s.hours, 1)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'water' && plan && (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="card-header">
              <span className="card-title">Root-zone water balance, next {planData.projection.length} days</span>
              <span className="text-muted text-sm">irrigate when depletion reaches the trigger line</span>
            </div>
            <div className="card-body">
              <WaterBalanceChart projection={planData.projection} rawMM={soilWater.raw_mm} tawMM={soilWater.taw_mm} />
              <p className="text-muted text-xs mt-2">
                TAW {fmt(soilWater.taw_mm, 0)} mm &middot; RAW {fmt(soilWater.raw_mm, 0)} mm (p = {soilWater.depletion_fraction_p}) &middot; root depth {planData.crop.root_depth_m} m &middot; ETo: {planData.inputs.eto_source}
              </p>
            </div>
          </div>
          <div className="grid-2 gap-4">
            <div className="card">
              <div className="card-header"><span className="card-title">Yield risk if irrigation is delayed</span><span className="card-tag">FAO-33 Ky</span></div>
              <div className="card-body">
                <YieldLossChart data={plan.yield_loss_if_delayed} />
                <p className="text-muted text-xs mt-2">Relative to a fully irrigated stage. Not field-validated.</p>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><span className="card-title">Water budget</span></div>
              <div className="card-body">
                <dl className="kv-list">
                  <dt>ETc today</dt><dd>{fmt(planData.water_requirement.etc_mm_day, 2)} mm &middot; {fmtInt(planData.water_requirement.etc_m3_day)} m³</dd>
                  <dt>ETc next 14 d</dt><dd>{fmt(planData.water_requirement.horizon_etc_mm, 0)} mm</dd>
                  <dt>Depletion now</dt><dd>{fmt(soilWater.depletion_mm, 1)} mm ({fmt(soilWater.depletion_ratio * 100, 0)}% of TAW)</dd>
                  <dt>Net depth</dt><dd>{fmt(rec.net_depth_mm, 1)} mm</dd>
                  <dt>Gross depth</dt><dd>{fmt(rec.gross_depth_mm, 1)} mm @ {Math.round(rec.application_efficiency * 100)}% efficiency</dd>
                  <dt>Volume</dt><dd>{fmtInt(rec.volume_m3)} m³</dd>
                  <dt>Pump time</dt><dd>{fmt(rec.duration_hours, 1)} h at {planData.inputs.pump_flow_m3h} m³/h</dd>
                  <dt>Rain in forecast</dt><dd>{fmt(planData.rainfall_adjustment.forecast_rain_mm, 0)} mm</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title">Daily projection</span></div>
            <div className="card-body" style={{ padding: 0 }}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th className="num">Temp °C</th><th className="num">ETo</th><th className="num">ETc</th><th className="num">Rain</th><th className="num">Eff. rain</th><th className="num">Depletion</th><th className="num">Ks</th></tr></thead>
                  <tbody>
                    {planData.projection.map(r => (
                      <tr key={r.date} className={r.depletion_start_mm >= soilWater.raw_mm ? 'row-alert' : ''}>
                        <td>{fmtDate(r.date)}</td><td className="num">{fmt(r.temperature_c, 1)}</td><td className="num">{fmt(r.eto_mm, 2)}</td>
                        <td className="num">{fmt(r.etc_mm, 2)}</td><td className="num">{fmt(r.rain_mm, 1)}</td><td className="num">{fmt(r.effective_rain_mm, 1)}</td>
                        <td className="num">{fmt(r.depletion_start_mm, 1)}</td><td className="num">{fmt(r.ks, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'model' && (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="card-header">
              <span className="card-title">What-if simulator</span>
              <span className="card-tag">model + FAO-56 plan</span>
            </div>
            <div className="card-body">
              <p className="text-muted text-sm mb-4">
                Change this farm's inputs and see how the soil-moisture estimate and the irrigation plan respond.
                Slider ranges span the values observed in the dataset; the model is unreliable outside them.
              </p>
              <div className="whatif-grid mb-4">
                {WHATIF_FEATURES.map(({ key, label, unit, step }) => {
                  const range = opts?.feature_ranges?.[key]
                  const base = farmFields?.[key]
                  if (!range || base == null) return null
                  const value = wiValues[key] ?? base
                  return (
                    <div className="whatif-slider" key={key}>
                      <label className="text-sm">
                        <span>{label}</span>
                        <strong>{fmt(value, step < 1 ? 2 : 0)}{unit && ' ' + unit}</strong>
                      </label>
                      <input type="range" min={range.min} max={range.max} step={step} value={value}
                        onChange={e => setWiValues(v => ({ ...v, [key]: Number(e.target.value) }))} />
                      <span className="text-xs text-muted">farm {fmt(base, step < 1 ? 2 : 0)} &middot; range {fmt(range.min, step < 1 ? 2 : 0)}–{fmt(range.max, step < 1 ? 2 : 0)}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <button className="btn primary" onClick={handleWhatIf} disabled={whatIfMut.isPending}>
                  {whatIfMut.isPending ? 'Simulating…' : 'Run simulation'}
                </button>
                <button className="btn" onClick={() => { setWiValues({}); setWiResult(null) }}>Reset</button>
              </div>
              {wiResult && (
                <div className="table-wrap mt-4">
                  <table className="data-table compare">
                    <thead><tr><th></th><th className="num">Current</th><th className="num">Scenario</th><th className="num">Change</th></tr></thead>
                    <tbody>
                      {[
                        ['Model soil moisture', r => r.model.predicted_soil_moisture, 4],
                        ['Wetness rank (pct)', r => r.plan.relative_wetness * 100, 0],
                        ['Root-zone moisture', r => r.plan.rootzone_moisture, 3],
                        ['Days until irrigation', r => r.plan.days_until_irrigation, 0],
                        ['Volume (m³)', r => r.plan.volume_m3, 0],
                        ['Pump hours', r => r.plan.duration_hours, 1],
                      ].map(([name, get, d]) => {
                        const a = get(wiResult.original), b = get(wiResult.simulated)
                        const diff = b - a
                        return (
                          <tr key={name}>
                            <td>{name}</td><td className="num">{fmt(a, d)}</td><td className="num">{fmt(b, d)}</td>
                            <td className={'num ' + (Math.abs(diff) < 10 ** -d / 2 ? 'text-muted' : '')}>{Math.abs(diff) < 10 ** -d / 2 ? 'no change' : (diff > 0 ? '+' : '') + fmt(diff, d)}</td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td>Status</td>
                        <td className="num">{STATUS[wiResult.original.plan.status]?.label}</td>
                        <td className="num">{STATUS[wiResult.simulated.plan.status]?.label}</td>
                        <td className="num">{wiResult.original.plan.status === wiResult.simulated.plan.status ? <span className="text-muted">same</span> : 'changed'}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-muted text-xs mt-2">{wiResult.simulation_note}</p>
                </div>
              )}
            </div>
          </div>
          {farmDetail?.model && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Why the model estimates {fmt(farmDetail.model.predicted_soil_moisture, 4)} m³/m³</span>
                <span className="card-tag">{farmDetail.model.model_name}</span>
              </div>
              <div className="card-body">
                <p className="text-muted text-sm mb-4">
                  One-at-a-time baseline replacement, in percentage points of soil moisture. Shows sensitivity, not causation.
                  Village and Taluk dominate because the target is a village-level satellite value (see Model Insights).
                </p>
                <ContributionChart contributions={farmDetail.model.top_factors} />
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'review' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Human review</span>
            <span className="card-tag">HITL feedback</span>
          </div>
          <div className="card-body">
            <p className="text-muted mb-4 text-sm">
              Recommendation under review: <strong>{rec ? `${STATUS[rec.status]?.label}, ${fmt(rec.duration_hours, 1)} h on ${rec.next_irrigation_date}` : '—'}</strong>.
              Decisions are stored as labels for future model improvement.
            </p>
            <form className="filter-bar" onSubmit={handleFeedback} style={{ marginBottom: 0 }}>
              <div className="field">
                <label htmlFor="r-role">Reviewer</label>
                <select id="r-role" name="role" defaultValue="field_officer">
                  <option value="field_officer">Field officer</option>
                  <option value="agronomist">Agronomist</option>
                  <option value="farmer">Farmer</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="r-decision">Decision</label>
                <select id="r-decision" name="decision" defaultValue="accepted">
                  <option value="accepted">Accept</option>
                  <option value="modified">Modify</option>
                  <option value="rejected">Reject</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="r-date">Override date</label>
                <input id="r-date" type="date" name="date" />
              </div>
              <div className="field">
                <label htmlFor="r-hours">Override hours</label>
                <input id="r-hours" type="number" name="hours" min="0" step="0.5" placeholder={fmt(rec?.duration_hours, 1)} />
              </div>
              <div className="field wide">
                <label htmlFor="r-comment">Comment</label>
                <input id="r-comment" type="text" name="comment" maxLength={1000} placeholder="optional" />
              </div>
              <button className="btn primary" type="submit" disabled={feedbackMut.isPending || !rec}>
                {feedbackMut.isPending ? 'Saving…' : 'Record decision'}
              </button>
            </form>
            <p className="text-muted text-xs mt-2">Override date and hours are stored only when the decision is “Modify”.</p>
          </div>
        </div>
      )}
    </div>
  )
}
