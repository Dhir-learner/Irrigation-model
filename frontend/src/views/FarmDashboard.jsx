import { lazy, Suspense, useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getOptions, getFarms, getFarm, getFarmPlan, getFarmsGeoJSON, getFleet, getFleetAnalytics, postFeedback, postFarmWhatIf,
} from '../api.js'
import { useToast, useTheme } from '../context.jsx'
import { useI18n } from '../i18n.jsx'
import SoilGauge from '../components/SoilGauge.jsx'
import FarmMap from '../components/FarmMap.jsx'
import { WaterBalanceChart, YieldLossChart, ContributionChart, KcCurveChart } from '../components/Charts.jsx'
import { Card, Stat, Icon, PageHeader, StatusBadge, Tabs, Alert, Skeleton, Sparkline, STATUS_VAR } from '../components/ui.jsx'
import { fleetQueryParams } from './FleetMap.jsx'

const SoilProfile3D = lazy(() => import('../three/SoilProfile3D.jsx'))

const SPEECH_LANG = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN', mr: 'mr-IN' }
const WHATIF = [
  { key: 'Rainfall_mm', step: 1, d: 0, unit: 'mm' },
  { key: 'Temperature_C', step: 0.1, d: 1, unit: '°C' },
  { key: 'Relative_Humidity', step: 0.5, d: 1, unit: '%' },
  { key: 'NDVI', step: 0.01, d: 2, unit: '' },
  { key: 'LAI', step: 0.01, d: 2, unit: '' },
]
const PROFILE = ['NDVI', 'LAI', 'Soil_pH', 'Organic_Carbon', 'Temperature_C', 'Relative_Humidity', 'Rainfall_mm']
const STAGES = ['initial', 'development', 'mid', 'late']

function parseRain(text) {
  if (!text.trim()) return []
  return text.split(/[,\s]+/).filter(Boolean).map(Number).filter(n => Number.isFinite(n) && n >= 0).slice(0, 14)
}

function BulletRow({ name, value, s, digits }) {
  const { fmtNum } = useI18n()
  if (!s || value == null) return null
  const span = s.max - s.min || 1
  const pos = v => `${Math.min(100, Math.max(0, ((v - s.min) / span) * 100))}%`
  return (
    <div className="bullet">
      <span className="name">{name}</span>
      <div className="track" title={`min ${s.min} · P25 ${s.p25} · median ${s.median} · P75 ${s.p75} · max ${s.max}`}>
        <span className="iqr" style={{ left: pos(s.p25), width: `calc(${pos(s.p75)} - ${pos(s.p25)})` }} />
        <span className="med" style={{ left: pos(s.median) }} />
        <span className="mark" style={{ left: pos(value) }} />
      </div>
      <span className="val">{fmtNum(value, digits)}</span>
    </div>
  )
}

export default function FarmDashboard({ settings, onSettingsChange }) {
  const { toast } = useToast()
  const { theme } = useTheme()
  const { t, lang, fmtNum, fmtDate } = useI18n()
  const queryClient = useQueryClient()
  const today = new Date().toISOString().split('T')[0]
  const { farmId, plantingDate, soilType, method, pumpFlow, cropAge } = settings

  const [taluk, setTaluk] = useState('All')
  const [village, setVillage] = useState('All')
  const [search, setSearch] = useState('')
  const [sensor, setSensor] = useState('')
  const [rainText, setRainText] = useState('')
  const [useLive, setUseLive] = useState(false)
  const [tab, setTab] = useState('advisory')
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

  // Keep the selection valid so the plan request never goes out with an empty farm ID.
  useEffect(() => {
    if (farms.length && filteredFarms.length && !filteredFarms.some(f => f.farm_id === farmId)) onSettingsChange({ farmId: filteredFarms[0].farm_id })
  }, [farms, filteredFarms, farmId, onSettingsChange])
  useEffect(() => {
    if (!currentFarm) return
    if (taluk !== 'All' && currentFarm.taluk !== taluk) { setTaluk('All'); setVillage('All') }
    else if (village !== 'All' && currentFarm.village !== village) setVillage('All')
  }, [farmId]) // eslint-disable-line react-hooks/exhaustive-deps
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
    language: lang,
  }), [cropAge, sensorValue, sensorValid, soilType, method, pumpFlow, rainForecast, useLive, lang])

  const planEnabled = Boolean(currentFarm)
  const { data: plan, isFetching: planLoading, error: planError, refetch } = useQuery({
    queryKey: ['plan', farmId, planBody], queryFn: () => getFarmPlan(farmId, planBody), enabled: planEnabled, placeholderData: p => p, staleTime: 30000,
  })
  const geoParams = useMemo(() => (village !== 'All' ? { village } : taluk !== 'All' ? { taluk } : currentFarm ? { village: currentFarm.village } : {}), [taluk, village, currentFarm])
  const { data: geojson } = useQuery({ queryKey: ['geojson', geoParams], queryFn: () => getFarmsGeoJSON(geoParams), staleTime: 300000 })
  const fleetParams = fleetQueryParams(settings)
  const { data: fleet } = useQuery({ queryKey: ['fleet', fleetParams], queryFn: () => getFleet(fleetParams), enabled: Boolean(soilType && method), staleTime: 60000 })
  const { data: analytics } = useQuery({ queryKey: ['analytics', fleetParams], queryFn: () => getFleetAnalytics(fleetParams), enabled: tab === 'crop', staleTime: 60000 })
  const { data: farmDetail } = useQuery({ queryKey: ['farmDetail', farmId], queryFn: () => getFarm(farmId), enabled: planEnabled, staleTime: 300000 })

  const feedbackMut = useMutation({
    mutationFn: postFeedback,
    onSuccess: () => { toast(t('dash.recorded'), 'success'); queryClient.invalidateQueries({ queryKey: ['feedback'] }) },
    onError: e => toast(t('dash.recordFailed', { msg: e.message }), 'error'),
  })
  const whatIfMut = useMutation({
    mutationFn: changes => postFarmWhatIf(farmId, { ...planBody, sensor_soil_moisture: null, use_live_weather: false, changes }),
    onSuccess: setWiResult,
    onError: e => toast(t('dash.whatIfFailed', { msg: e.message }), 'error'),
  })

  const P = plan?.plan
  const rec = P?.recommendation
  const sw = P?.soil_water
  const availablePct = sw ? 100 * (1 - sw.depletion_ratio) : null
  const triggerPct = sw ? 100 * (1 - sw.depletion_fraction_p) : null
  const soonPct = sw && P ? 100 * (1 - Math.max(0, sw.raw_mm - 3 * P.water_requirement.etc_mm_day) / sw.taw_mm) : null
  const calib = plan?.soil_moisture_calibration
  const ff = farmDetail?.farm
  const forecast = plan?.weather?.forecast
  const stage = P?.crop?.stage

  const stepFarm = useCallback(dir => {
    const i = filteredFarms.findIndex(f => f.farm_id === farmId)
    const next = filteredFarms[(i + dir + filteredFarms.length) % filteredFarms.length]
    if (next) onSettingsChange({ farmId: next.farm_id })
  }, [filteredFarms, farmId, onSettingsChange])

  const events = useMemo(() => {
    if (!rec || !plan) return []
    const tone = `var(--${STATUS_VAR[rec.status]})`
    const list = [{ date: rec.next_irrigation_date, title: t('dash.evIrrigate', { h: fmtNum(rec.duration_hours, 1), m: fmtNum(rec.volume_m3) }), sub: t('status.' + rec.status), tone }]
    ;(plan.pump_sessions || []).slice(0, 3).forEach(s => list.push({ date: s.date, title: `${t('map.pump')} ${s.start}–${s.end}`, sub: `${fmtNum(s.hours, 1)} h`, tone: 'var(--water)' }))
    if (plan.fertigation) list.push({ date: plan.fertigation.next_fertigation_date, title: t('dash.evFert'), sub: Object.entries(plan.fertigation.products_per_application_kg_acre).map(([k, v]) => `${k} ${fmtNum(v, 1)}`).join(' · ') + ' kg/acre', tone: 'var(--accent)' })
    const d = new Date(rec.next_irrigation_date); d.setDate(d.getDate() + 1)
    const loss7 = plan.yield_loss_if_delayed?.find(y => y.delay_days === 7)
    list.push({ date: d.toISOString().slice(0, 10), title: t('dash.evStress'), sub: loss7 ? `${t('chart.delayLabel', { n: 7 })}: −${fmtNum(loss7.relative_yield_loss_pct, 1)}%` : '', tone: 'var(--status-now)' })
    return list.sort((a, b) => a.date.localeCompare(b.date))
  }, [rec, plan, t, fmtNum])

  const handleFeedback = e => {
    e.preventDefault()
    const fd = new FormData(e.target)
    const decision = fd.get('decision')
    feedbackMut.mutate({
      farm_id: farmId, reviewer_role: fd.get('role'), decision,
      recommended_date: rec?.next_irrigation_date, recommended_hours: rec?.duration_hours,
      override_date: decision === 'modified' ? (fd.get('date') || undefined) : undefined,
      override_hours: decision === 'modified' && fd.get('hours') !== '' ? Number(fd.get('hours')) : undefined,
      comment: fd.get('comment') || undefined, soil_moisture_source: plan?.soil_moisture_source,
    })
    e.target.reset()
  }
  const runWhatIf = () => {
    const changes = Object.fromEntries(Object.entries(wiValues).filter(([, v]) => v !== undefined))
    if (!Object.keys(changes).length) { toast(t('dash.moveSlider'), 'warn'); return }
    whatIfMut.mutate(changes)
  }
  const copyAdvisory = async () => {
    try { await navigator.clipboard.writeText(plan.advisory_text); toast(t('dash.copiedOk'), 'success') } catch { toast(t('dash.noClipboard'), 'warn') }
  }
  const speak = () => {
    if (!('speechSynthesis' in window)) { toast(t('dash.noSpeech'), 'warn'); return }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return }
    const u = new SpeechSynthesisUtterance(plan.advisory_text)
    u.lang = SPEECH_LANG[lang] || 'en-IN'
    u.rate = 0.95
    u.onend = u.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(u)
    setSpeaking(true)
  }
  useEffect(() => () => window.speechSynthesis?.cancel(), [])
  const exportPdf = async () => {
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
      const el = document.getElementById('advisory-panel')
      const canvas = await html2canvas(el, { scale: 1.5, backgroundColor: theme === 'dark' ? '#06100d' : '#f3f6f1', useCORS: true })
      const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save(`advisory_${farmId}_${today}.pdf`)
      toast(t('dash.pdfOk'), 'success')
    } catch (e) { toast(t('dash.pdfFail', { msg: e.message }), 'error') }
  }

  if (farmsError) return <><PageHeader title={t('dash.title')} /><Alert tone="error">{t('dash.farmsError', { msg: farmsError.message })}</Alert></>

  const stageDays = opts?.stage_days
  const seasonEnd = stageDays ? STAGES.reduce((s, k) => s + stageDays[k], 0) : 405

  return (
    <div id="advisory-panel">
      <PageHeader eyebrow={t('nav.groupFarm')} title={t('dash.title')} subtitle={t('dash.subtitle')} actions={<>
        <button className="btn" onClick={() => stepFarm(-1)} disabled={filteredFarms.length < 2}><Icon name="arrowL" />{t('common.prev')}</button>
        <button className="btn" onClick={() => stepFarm(1)} disabled={filteredFarms.length < 2}>{t('common.next')}<Icon name="arrowR" /></button>
        <button className="btn" onClick={exportPdf} disabled={!plan}><Icon name="download" />{t('common.exportPdf')}</button>
      </>} />

      <section className="panel" aria-label={t('dash.settings')}>
        <div className="panel-title"><span><Icon name="sliders" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('dash.settings')}</span>
          <button className="btn sm primary" onClick={() => planEnabled && refetch()} disabled={!planEnabled || planLoading}><Icon name="refresh" size={13} />{planLoading ? t('common.refreshing') : t('common.refresh')}</button>
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="f-taluk">{t('common.taluk')}</label>
            <select id="f-taluk" value={taluk} onChange={e => { setTaluk(e.target.value); setVillage('All') }}>
              {taluks.map(x => <option key={x} value={x}>{x === 'All' ? t('common.all') : x}</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-village">{t('common.village')}</label>
            <select id="f-village" value={village} onChange={e => setVillage(e.target.value)}>
              {villages.map(x => <option key={x} value={x}>{x === 'All' ? t('common.all') : x}</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-search">{t('dash.searchId')}</label>
            <input id="f-search" type="search" value={search} placeholder="0110" onChange={e => setSearch(e.target.value)} /></div>
          <div className="field"><label htmlFor="f-farm">{t('dash.farmCount', { n: filteredFarms.length })}</label>
            <select id="f-farm" value={currentFarm ? farmId : ''} onChange={e => onSettingsChange({ farmId: e.target.value })} disabled={farmsLoading}>
              {farmsLoading && <option value="">{t('common.loading')}</option>}
              {!farmsLoading && !filteredFarms.length && <option value="">{t('dash.noMatch')}</option>}
              {filteredFarms.map(f => <option key={f.farm_id} value={f.farm_id}>{f.farm_id}</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-plant">{t('dash.plantingDate')} · {t('dash.cropDay', { n: cropAge })}</label>
            <input id="f-plant" type="date" value={plantingDate} max={today} onChange={e => onSettingsChange({ plantingDate: e.target.value })} /></div>
          <div className="field"><label htmlFor="f-soil">{t('dash.soilTexture')}</label>
            <select id="f-soil" value={soilType} onChange={e => onSettingsChange({ soilType: e.target.value })}>
              {opts?.soils?.map(s => <option key={s} value={s}>{t('soil.' + s)}</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-method">{t('dash.irrigationMethod')}</label>
            <select id="f-method" value={method} onChange={e => onSettingsChange({ method: e.target.value })}>
              {opts?.methods && Object.entries(opts.methods).map(([m, eff]) => <option key={m} value={m}>{t('method.' + m)} ({Math.round(eff * 100)}%)</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-pump">{t('dash.pump')}</label>
            <input id="f-pump" type="number" value={pumpFlow} min="1" max="200" step="0.5" onChange={e => onSettingsChange({ pumpFlow: e.target.value })} /></div>
          <div className="field"><label htmlFor="f-probe">{t('dash.probe')}</label>
            <input id="f-probe" type="number" value={sensor} min="0" max="0.6" step="0.005" placeholder={t('common.optional')} className={sensorValid ? '' : 'invalid'} aria-invalid={!sensorValid} onChange={e => setSensor(e.target.value)} /></div>
          <div className="field span-2"><label htmlFor="f-rain">{t('dash.rainForecast')}</label>
            <input id="f-rain" type="text" value={rainText} placeholder={t('dash.rainPlaceholder')} onChange={e => setRainText(e.target.value)} /></div>
          <label className="switch"><input type="checkbox" checked={useLive} onChange={e => setUseLive(e.target.checked)} />{t('dash.liveWeather')}</label>
        </div>
      </section>

      {!sensorValid && <div className="mb-3"><Alert tone="warn">{t('dash.probeInvalid')}</Alert></div>}
      {planError && <div className="mb-3"><Alert tone="error">{t('dash.advisoryError', { msg: planError.message })}</Alert></div>}
      {!planError && !plan && planEnabled && <Skeleton height={150} style={{ marginBottom: 20 }} />}

      {rec && (
        <div className={'mb-5' + (planLoading ? ' is-stale' : '')}>
          <div className="context-strip">
            <StatusBadge status={rec.status} />
            {currentFarm && <>
              <span className="mono strong">{farmId}</span><span className="sep">·</span>
              <span>{currentFarm.village}, {currentFarm.taluk}</span><span className="sep">·</span>
              <span>{fmtNum(currentFarm.area_ha, 2)} ha</span><span className="sep">·</span>
              <span>{t('stage.' + stage)} ({t('dash.cropDay', { n: cropAge })})</span>
            </>}
          </div>
          <div className="stat-grid">
            <Stat label={t('dash.kpi.available')} icon="drop" tone={availablePct <= triggerPct ? 'status-now' : availablePct <= soonPct ? 'status-soon' : 'water'}
              value={`${fmtNum(availablePct)}%`}
              delta={plan.soil_moisture_source === 'sensor' ? t('dash.kpi.probeValue', { v: fmtNum(plan.soil_moisture_used, 3) }) : t('dash.kpi.mlValue', { v: fmtNum(plan.soil_moisture_used, 3) })} />
            <Stat label={t('dash.kpi.next')} icon="calendar" tone={STATUS_VAR[rec.status]} value={fmtDate(rec.next_irrigation_date)}
              delta={rec.days_until_irrigation === 0 ? t('common.today') : rec.days_until_irrigation === 1 ? t('common.inDay') : t('common.inDays', { n: rec.days_until_irrigation })} />
            <Stat label={t('dash.kpi.pumpTime')} icon="pump" tone="accent" value={`${fmtNum(rec.duration_hours, 1)} h`} delta={t('dash.kpi.gross', { v: fmtNum(rec.volume_m3), mm: fmtNum(rec.gross_depth_mm) })} />
            <Stat label={t('dash.kpi.cropUse')} icon="sun" tone="accent-2" value={`${fmtNum(P.water_requirement.etc_mm_day, 1)} mm/d`} delta={`Kc ${fmtNum(P.crop.kc, 2)} · ETo ${fmtNum(P.water_requirement.eto_mm_day, 1)}`}>
              <Sparkline values={P.projection.map(r => r.etc_mm)} color="var(--accent-2)" />
            </Stat>
            <Stat label={t('dash.kpi.stress')} icon="thermo" tone={P.water_stress.stress_index > 0.2 ? 'status-now' : 'accent'} value={t('stress.' + P.water_stress.category)} delta={`Ks ${fmtNum(P.water_stress.ks, 2)}`}>
              <Sparkline values={P.projection.map(r => r.depletion_start_mm)} color="var(--status-soon)" />
            </Stat>
          </div>
        </div>
      )}

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'advisory', label: t('dash.tabs.advisory'), icon: 'leaf' },
        { id: 'water', label: t('dash.tabs.water'), icon: 'drop' },
        { id: 'crop', label: t('dash.tabs.crop'), icon: 'seed' },
        { id: 'model', label: t('dash.tabs.model'), icon: 'sliders' },
        { id: 'review', label: t('dash.tabs.review'), icon: 'user' },
      ]} />

      {tab === 'advisory' && (
        <div className="grid-main">
          <div className="stack">
            <Card title={t('dash.plotView')} icon="globe" flush tag={currentFarm?.village}>
              <FarmMap geojson={geojson} fleetData={fleet} farmsMeta={farms} selectedId={farmId} focusSelected onFarmClick={id => onSettingsChange({ farmId: id })} height={400} />
            </Card>
            <Card title={t('dash.weatherStrip')} icon="rain" tag={forecast?.eto_mm?.length ? 'Open-Meteo' : undefined} tagTone="water">
              {forecast?.dates?.length ? (
                <div className="weather-strip">
                  {forecast.dates.map((d, i) => {
                    const rain = forecast.rain_mm?.[i] ?? 0
                    return (
                      <div key={d} className={'wx' + (rain >= 5 ? ' wet' : '')}>
                        <span className="d">{fmtDate(d, { weekday: 'short', day: 'numeric' })}</span>
                        <Icon name={rain >= 5 ? 'rain' : 'sun'} size={18} style={{ color: rain >= 5 ? 'var(--water)' : 'var(--status-soon)' }} />
                        <span className="t">{fmtNum(forecast.temperature_c?.[i], 0)}°</span>
                        <span className="r">{fmtNum(rain, 1)} mm</span>
                        <div className="rain-bar" title={t('dash.rainProb')}><span style={{ width: `${forecast.rain_probability_pct?.[i] ?? 0}%` }} /></div>
                      </div>
                    )
                  })}
                </div>
              ) : <p className="sub small">{t('dash.weatherNone')}</p>}
              {plan?.weather?.note && <p className="muted xs mt-2">{t('dash.weather', { note: plan.weather.note })}</p>}
            </Card>
          </div>
          <div className="stack">
            {plan && (
              <Card title={t('dash.advisory')} icon="info" actions={<>
                <button className="btn sm" onClick={copyAdvisory}><Icon name="copy" size={13} />{t('common.copy')}</button>
                <button className="btn sm" onClick={speak} aria-pressed={speaking}><Icon name="speaker" size={13} />{speaking ? t('dash.stop') : t('dash.readAloud')}</button>
                <a className="btn sm" href={`https://wa.me/?text=${encodeURIComponent(`${farmId}: ${plan.advisory_text}`)}`} target="_blank" rel="noreferrer"><Icon name="share" size={13} />{t('dash.whatsapp')}</a>
              </>}>
                <div className={'advisory-text' + (rec?.status === 'IRRIGATE_NOW' ? ' urgent' : '')} lang={lang}>{plan.advisory_text}</div>
                {P?.rainfall_adjustment?.postponed_days > 0 && <div className="mt-3"><Alert tone="info">{t('dash.rainPostpones', { mm: fmtNum(P.rainfall_adjustment.forecast_rain_mm), d: P.rainfall_adjustment.postponed_days })}</Alert></div>}
              </Card>
            )}
            {plan && (
              <Card title={t('dash.moisture')} icon="drop" tag={t('source.' + plan.soil_moisture_source)} tagTone={plan.soil_moisture_source === 'sensor' ? 'ok' : 'warn'} foot={calib?.method === 'percentile_rank' ? calib.note : null}>
                <div className="row" style={{ alignItems: 'center', gap: 20 }}>
                  <SoilGauge availablePct={availablePct} triggerPct={triggerPct} soonPct={soonPct} />
                  <dl className="kv" style={{ flex: 1, minWidth: 200 }}>
                    {calib?.method === 'percentile_rank' && <>
                      <dt>{t('dash.modelValue')}</dt><dd>{fmtNum(calib.model_value, 4)} m³/m³</dd>
                      <dt>{t('dash.wetRank')}</dt><dd>{t('dash.wetRankValue', { n: fmtNum(calib.relative_wetness * 100) })}</dd>
                    </>}
                    <dt>{t('dash.rootUsed')}</dt><dd>{fmtNum(plan.soil_moisture_used, 3)} m³/m³</dd>
                    <dt>{t('dash.fcwp')}</dt><dd>{fmtNum(sw?.field_capacity, 2)} / {fmtNum(sw?.wilting_point, 2)}</dd>
                    <dt>TAW · RAW</dt><dd>{fmtNum(sw?.taw_mm)} · {fmtNum(sw?.raw_mm)} mm</dd>
                  </dl>
                </div>
              </Card>
            )}
            {events.length > 0 && (
              <Card title={t('dash.nextEvents')} icon="calendar">
                <ul className="timeline">
                  {events.map((e, i) => (
                    <li key={i}>
                      <span className="when">{fmtDate(e.date, { day: 'numeric', month: 'short' })}</span>
                      <span className="what" style={{ '--tone': e.tone }}>{e.title}{e.sub && <small>{e.sub}</small>}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'water' && plan && (
        <div className="stack">
          <Card title={t('dash.balanceTitle', { n: P.projection.length })} icon="drop" tag={t('dash.balanceHint')}
            foot={t('dash.balanceFoot', { taw: fmtNum(sw.taw_mm), raw: fmtNum(sw.raw_mm), p: sw.depletion_fraction_p, root: P.crop.root_depth_m, eto: P.inputs.eto_source })}>
            <WaterBalanceChart projection={P.projection} rawMM={sw.raw_mm} tawMM={sw.taw_mm} />
          </Card>
          <div className="grid-2">
            <Card title={t('dash.yieldRisk')} icon="alert" tag="FAO-33 Ky" foot={t('dash.yieldNote')}><YieldLossChart data={plan.yield_loss_if_delayed} /></Card>
            <Card title={t('dash.budget')} icon="layers">
              <dl className="kv">
                <dt>{t('dash.etcToday')}</dt><dd>{fmtNum(P.water_requirement.etc_mm_day, 2)} mm · {fmtNum(P.water_requirement.etc_m3_day)} m³</dd>
                <dt>{t('dash.etcHorizon')}</dt><dd>{fmtNum(P.water_requirement.horizon_etc_mm)} mm</dd>
                <dt>{t('dash.depletionNow')}</dt><dd>{t('dash.depletionOf', { mm: fmtNum(sw.depletion_mm, 1), pct: fmtNum(sw.depletion_ratio * 100) })}</dd>
                <dt>{t('dash.netDepth')}</dt><dd>{fmtNum(rec.net_depth_mm, 1)} mm</dd>
                <dt>{t('dash.grossDepth')}</dt><dd>{t('dash.grossAt', { mm: fmtNum(rec.gross_depth_mm, 1), eff: Math.round(rec.application_efficiency * 100) })}</dd>
                <dt>{t('dash.volume')}</dt><dd>{fmtNum(rec.volume_m3)} m³</dd>
                <dt>{t('dash.pumpTime')}</dt><dd>{t('dash.pumpAt', { h: fmtNum(rec.duration_hours, 1), q: P.inputs.pump_flow_m3h })}</dd>
                <dt>{t('dash.rainInForecast')}</dt><dd>{fmtNum(P.rainfall_adjustment.forecast_rain_mm)} mm</dd>
              </dl>
            </Card>
          </div>
          <div className="grid-2">
            <Card title={t('dash.projection')} icon="calendar" flush>
              <div className="table-wrap" style={{ maxHeight: 360 }}>
                <table className="data-table">
                  <thead><tr><th>{t('common.date')}</th><th className="num">{t('dash.col.temp')}</th><th className="num">ETc</th><th className="num">{t('dash.col.effRain')}</th><th className="num">{t('dash.col.depletion')}</th><th className="num">Ks</th></tr></thead>
                  <tbody>
                    {P.projection.map(r => (
                      <tr key={r.date} className={r.depletion_start_mm >= sw.raw_mm ? 'row-alert' : ''}>
                        <td>{fmtDate(r.date)}</td><td className="num">{fmtNum(r.temperature_c, 1)}</td><td className="num">{fmtNum(r.etc_mm, 2)}</td>
                        <td className="num">{fmtNum(r.effective_rain_mm, 1)}</td><td className="num">{fmtNum(r.depletion_start_mm, 1)}</td><td className="num">{fmtNum(r.ks, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title={t('dash.sessions')} icon="pump" tag={t('dash.sessionsHint', { n: (plan.pump_sessions || []).length })} flush>
              <div className="table-wrap" style={{ maxHeight: 360 }}>
                <table className="data-table">
                  <thead><tr><th>{t('common.date')}</th><th>{t('common.start')}</th><th>{t('common.end')}</th><th className="num">h</th></tr></thead>
                  <tbody>{(plan.pump_sessions || []).map((s, i) => <tr key={i}><td>{fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>{s.start}</td><td>{s.end}</td><td className="num">{fmtNum(s.hours, 1)}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'crop' && plan && (
        <div className="stack">
          <div className="grid-main">
            <Card title={t('dash.soil3d')} icon="cube" flush tag="three.js" tagTone="water">
              <Suspense fallback={<Skeleton height={400} style={{ borderRadius: 0 }} />}>
                <SoilProfile3D availablePct={availablePct} triggerPct={triggerPct} rootDepthM={P.crop.root_depth_m} stage={stage} status={rec.status} height={400} />
              </Suspense>
            </Card>
            <div className="stack">
              <Card title={t('dash.cropStage')} icon="seed" tag={`${t('stage.' + stage)} · ${t('dash.rootDepth', { m: P.crop.root_depth_m })}`}>
                {stageDays && (() => {
                  const cols = STAGES.map(s => `${stageDays[s]}fr`).join(' ')
                  let acc = 0
                  return (
                    <>
                      <div className="small sub">{t('dash.stageProgress')}: {fmtNum(Math.min(100, (100 * cropAge) / seasonEnd))}%</div>
                      <div className="stage-track" style={{ '--cols': cols }}>
                        {STAGES.map(s => {
                          const from = acc; acc += stageDays[s]
                          const state = cropAge >= acc ? 'done' : cropAge >= from ? 'now' : ''
                          const fill = state === 'now' ? ((cropAge - from) / stageDays[s]) * 100 : 0
                          return <div key={s} className={'seg ' + state}>{state === 'now' && <span style={{ width: `${fill}%` }} />}</div>
                        })}
                      </div>
                      <div className="stage-names" style={{ '--cols': cols }}>
                        {STAGES.map(s => <span key={s} className={s === stage ? 'now' : ''}>{t('stage.' + s)}</span>)}
                      </div>
                    </>
                  )
                })()}
                <div className="mt-3"><KcCurveChart stageDays={stageDays} kc={opts?.kc} cropAge={cropAge} /></div>
              </Card>
              <div className="callout"><Icon name="leaf" size={18} /><div><strong>{t('dash.stageGuide')}</strong><br />{t('guide.stageTips.' + stage)}</div></div>
            </div>
          </div>
          <div className="grid-2">
            <Card title={t('dash.farmProfile')} icon="chart" foot={t('dash.farmProfileHint')}>
              {analytics?.feature_summary && ff ? (
                <div className="bullet-list">
                  {PROFILE.map(k => <BulletRow key={k} name={t('feature.' + k)} value={ff[k]} s={analytics.feature_summary[k]} digits={['Rainfall_mm', 'Relative_Humidity'].includes(k) ? 0 : 2} />)}
                </div>
              ) : <Skeleton height={220} />}
            </Card>
            <Card title={t('dash.fert')} icon="flask" tag={t('dash.placeholderDoses')} tagTone="warn" flush
              foot={<>{t('dash.fertNote', { n: plan.fertigation?.applications_in_stage, oc: t('dash.ocRating.' + plan.fertigation?.organic_carbon_rating), f: plan.fertigation?.nitrogen_adjustment_factor })}<br />{t('dash.fertTiming')}</>}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>{t('dash.product')}</th><th className="num">{t('dash.kgAcre')}</th><th className="num">{t('dash.kgPlot')}</th></tr></thead>
                  <tbody>
                    {Object.entries(plan.fertigation?.products_per_application_kg_acre || {}).map(([p, v]) => (
                      <tr key={p}><td className="strong">{p}</td><td className="num">{fmtNum(v, 2)}</td><td className="num">{fmtNum(plan.fertigation.products_per_application_kg_plot?.[p], 2)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'model' && (
        <div className="stack">
          <Card title={t('dash.whatIf')} icon="sliders" tag={t('dash.whatIfTag')}>
            <p className="sub small mb-4">{t('dash.whatIfIntro')}</p>
            <div className="whatif-grid mb-4">
              {WHATIF.map(({ key, step, d, unit }) => {
                const range = opts?.feature_ranges?.[key]
                const base = ff?.[key]
                if (!range || base == null) return null
                const value = wiValues[key] ?? base
                return (
                  <div className="whatif-slider" key={key}>
                    <label><span>{t('dash.wi.' + key)}</span><strong>{fmtNum(value, d)} {unit}</strong></label>
                    <input type="range" min={range.min} max={range.max} step={step} value={value} onChange={e => setWiValues(v => ({ ...v, [key]: Number(e.target.value) }))} />
                    <span className="xs muted">{t('dash.farmValue', { v: fmtNum(base, d), min: fmtNum(range.min, d), max: fmtNum(range.max, d) })}</span>
                  </div>
                )
              })}
            </div>
            <div className="row">
              <button className="btn primary" onClick={runWhatIf} disabled={whatIfMut.isPending}>{whatIfMut.isPending ? t('dash.simulating') : t('dash.runSim')}</button>
              <button className="btn" onClick={() => { setWiValues({}); setWiResult(null) }}>{t('common.reset')}</button>
            </div>
            {wiResult && (
              <div className="table-wrap mt-4">
                <table className="data-table">
                  <thead><tr><th></th><th className="num">{t('dash.current')}</th><th className="num">{t('dash.scenario')}</th><th className="num">{t('dash.change')}</th></tr></thead>
                  <tbody>
                    {[
                      ['modelSm', r => r.model.predicted_soil_moisture, 4],
                      ['rank', r => r.plan.relative_wetness * 100, 0],
                      ['rootzone', r => r.plan.rootzone_moisture, 3],
                      ['days', r => r.plan.days_until_irrigation, 0],
                      ['volume', r => r.plan.volume_m3, 0],
                      ['hours', r => r.plan.duration_hours, 1],
                    ].map(([k, get, dd]) => {
                      const a = get(wiResult.original), b = get(wiResult.simulated), diff = b - a
                      const none = Math.abs(diff) < 10 ** -dd / 2
                      return <tr key={k}><td className="strong">{t('dash.wi.' + k)}</td><td className="num">{fmtNum(a, dd)}</td><td className="num">{fmtNum(b, dd)}</td><td className={'num ' + (none ? 'muted' : 'tone-water')}>{none ? t('dash.noChange') : (diff > 0 ? '+' : '') + fmtNum(diff, dd)}</td></tr>
                    })}
                    <tr><td className="strong">{t('common.status')}</td><td className="num">{t('status.' + wiResult.original.plan.status)}</td><td className="num">{t('status.' + wiResult.simulated.plan.status)}</td><td className="num">{wiResult.original.plan.status === wiResult.simulated.plan.status ? <span className="muted">{t('dash.same')}</span> : t('dash.changed')}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {farmDetail?.model && (
            <Card title={t('dash.why', { v: fmtNum(farmDetail.model.predicted_soil_moisture, 4) })} icon="chart" tag={farmDetail.model.model_name} foot={t('dash.whyNote')}>
              <ContributionChart contributions={farmDetail.model.top_factors} />
            </Card>
          )}
        </div>
      )}

      {tab === 'review' && (
        <Card title={t('dash.review')} icon="user" tag={t('dash.reviewTag')} foot={t('dash.overrideNote')}>
          <p className="sub small mb-4">
            {t('dash.underReview', { rec: rec ? `${t('status.' + rec.status)}, ${fmtNum(rec.duration_hours, 1)} h, ${fmtDate(rec.next_irrigation_date)}` : '—' })} {t('dash.reviewNote')}
          </p>
          <form className="form-grid" onSubmit={handleFeedback}>
            <div className="field"><label htmlFor="r-role">{t('dash.reviewer')}</label>
              <select id="r-role" name="role" defaultValue="field_officer">{['field_officer', 'agronomist', 'farmer'].map(r => <option key={r} value={r}>{t('role.' + r)}</option>)}</select></div>
            <div className="field"><label htmlFor="r-decision">{t('dash.decision')}</label>
              <select id="r-decision" name="decision" defaultValue="accepted">
                <option value="accepted">{t('decision.accept')}</option><option value="modified">{t('decision.modify')}</option><option value="rejected">{t('decision.reject')}</option>
              </select></div>
            <div className="field"><label htmlFor="r-date">{t('dash.overrideDate')}</label><input id="r-date" type="date" name="date" /></div>
            <div className="field"><label htmlFor="r-hours">{t('dash.overrideHours')}</label><input id="r-hours" type="number" name="hours" min="0" step="0.5" placeholder={fmtNum(rec?.duration_hours, 1)} /></div>
            <div className="field span-2"><label htmlFor="r-comment">{t('dash.comment')}</label><input id="r-comment" type="text" name="comment" maxLength={1000} placeholder={t('common.optional')} /></div>
            <button className="btn primary" type="submit" disabled={feedbackMut.isPending || !rec}>{feedbackMut.isPending ? t('dash.saving') : t('dash.record')}</button>
          </form>
        </Card>
      )}
    </div>
  )
}
