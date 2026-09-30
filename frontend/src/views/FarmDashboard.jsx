import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getOptions, getFarms, getFarm, getFarmPlan, getFarmsGeoJSON, postFeedback, postWhatIf } from '../api.js'
import { useToast } from '../context.jsx'
import SoilGauge from '../components/SoilGauge.jsx'
import FarmMap from '../components/FarmMap.jsx'
import { WaterBalanceChart, YieldLossChart, ContributionChart } from '../components/Charts.jsx'

const STATUS = {
  IRRIGATE_NOW:  { label: 'Irrigate now',           cls: 'irrigate-now',  emoji: '\uD83D\uDD34' },
  IRRIGATE_SOON: { label: 'Irrigate within 3 days', cls: 'irrigate-soon', emoji: '\uD83D\uDFE1' },
  NOT_REQUIRED:  { label: 'Not required yet',       cls: 'not-required',  emoji: '\uD83D\uDFE2' },
}

function StatTile({ label, value, delta, color }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : {}}>{value ?? '\u2014'}</div>
      {delta && <div className="stat-delta">{delta}</div>}
    </div>
  )
}

export default function FarmDashboard({ language, onSettingsChange }) {
  const { toast } = useToast()
  const today = new Date().toISOString().split('T')[0]
  const defaultPlanting = new Date(Date.now() - 180 * 864e5).toISOString().split('T')[0]

  const [taluk, setTaluk] = useState('All')
  const [village, setVillage] = useState('All')
  const [farmId, setFarmId] = useState('')
  const [planting, setPlanting] = useState(defaultPlanting)
  const [soilType, setSoilType] = useState('')
  const [method, setMethod] = useState('')
  const [pumpFlow, setPumpFlow] = useState(18)
  const [sensor, setSensor] = useState('')
  const [useLive, setUseLive] = useState(false)
  const [activeTab, setActiveTab] = useState('advisory')

  // What-if state
  const [wiRain, setWiRain] = useState(null)
  const [wiTemp, setWiTemp] = useState(null)
  const [wiHumidity, setWiHumidity] = useState(null)
  const [wiResult, setWiResult] = useState(null)

  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })
  const { data: farms = [] } = useQuery({ queryKey: ['farms'], queryFn: getFarms })

  // Set defaults when opts loads
  useMemo(() => {
    if (opts && !soilType) setSoilType(opts.default_soil)
    if (opts && !method) setMethod(opts.default_method)
    if (opts && !pumpFlow) setPumpFlow(opts.default_pump_flow_m3h)
  }, [opts])

  // Set first farm when farms load
  useMemo(() => {
    if (farms.length > 0 && !farmId) setFarmId(farms[0].farm_id)
  }, [farms])

  const taluks = useMemo(() => ['All', ...new Set(farms.map(f => f.taluk))].sort(), [farms])
  const filteredByTaluk = useMemo(() => taluk === 'All' ? farms : farms.filter(f => f.taluk === taluk), [farms, taluk])
  const villages = useMemo(() => ['All', ...new Set(filteredByTaluk.map(f => f.village))].sort(), [filteredByTaluk])
  const filteredFarms = useMemo(() => village === 'All' ? filteredByTaluk : filteredByTaluk.filter(f => f.village === village), [filteredByTaluk, village])

  const cropAge = useMemo(() => {
    const diff = Math.floor((Date.now() - new Date(planting).getTime()) / 864e5)
    return Math.max(0, diff)
  }, [planting])

  const planBody = useMemo(() => ({
    crop_age_days: cropAge,
    sensor_soil_moisture: sensor ? parseFloat(sensor) : null,
    soil_type: soilType || undefined,
    irrigation_method: method || undefined,
    pump_flow_m3h: pumpFlow ? parseFloat(pumpFlow) : undefined,
    use_live_weather: useLive,
    language,
  }), [cropAge, sensor, soilType, method, pumpFlow, useLive, language])

  const { data: plan, isLoading: planLoading, error: planError, refetch: refetchPlan } = useQuery({
    queryKey: ['plan', farmId, planBody],
    queryFn: () => getFarmPlan(farmId, planBody),
    enabled: !!farmId,
    staleTime: 0,
  })

  // GeoJSON for village
  const geoParams = useMemo(() => {
    const p = {}
    if (taluk !== 'All') p.taluk = taluk
    if (village !== 'All') p.village = village
    return p
  }, [taluk, village])
  const { data: geojson } = useQuery({ queryKey: ['geojson', geoParams], queryFn: () => getFarmsGeoJSON(geoParams), staleTime: 30000 })

  // Farm detail for model explanation
  const { data: farmDetail } = useQuery({ queryKey: ['farmDetail', farmId], queryFn: () => getFarm(farmId), enabled: !!farmId, staleTime: 60000 })

  // Feedback mutation
  const feedbackMut = useMutation({
    mutationFn: postFeedback,
    onSuccess: () => toast('Decision recorded', 'success'),
    onError: e => toast('Error: ' + e.message, 'error'),
  })

  // What-if mutation
  const whatIfMut = useMutation({
    mutationFn: postWhatIf,
    onSuccess: data => setWiResult(data),
    onError: e => toast('What-if error: ' + e.message, 'error'),
  })

  const currentFarm = farms.find(f => f.farm_id === farmId)

  // Share settings with parent
  useMemo(() => {
    if (currentFarm && method) {
      onSettingsChange({ farmId: currentFarm.farm_id, village: currentFarm.village, taluk: currentFarm.taluk, cropAge, method, soilType })
    }
  }, [currentFarm, cropAge, method])

  const planData = plan?.plan          // the FAO-56 plan object
  const rec = planData?.recommendation  // the recommendation block
  const statusInfo = rec ? (STATUS[rec.status] || STATUS.NOT_REQUIRED) : null
  const soilMoistureVal = plan?.soil_moisture_used || currentFarm?.soil_moisture || 0

  const handleFeedback = (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    feedbackMut.mutate({
      farm_id: farmId,
      reviewer_role: fd.get('role'),
      decision: fd.get('decision'),
      recommended_date: rec?.next_irrigation_date,
      recommended_hours: rec?.duration_hours,
      override_hours: fd.get('decision') === 'modified' ? parseFloat(fd.get('hours')) : undefined,
      comment: fd.get('comment') || undefined,
      soil_moisture_source: plan?.soil_moisture_source,
    })
  }

  const handleWhatIf = () => {
    if (!currentFarm) return
    whatIfMut.mutate({
      farm_id: farmId,
      features: { ...currentFarm, Farm_ID: farmId },
      changes: {
        ...(wiRain !== null && { Rainfall_mm: wiRain }),
        ...(wiTemp !== null && { Temperature_C: wiTemp }),
        ...(wiHumidity !== null && { Relative_Humidity: wiHumidity }),
      },
    })
  }

  const handleExportPDF = async () => {
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: html2canvas } = await import('html2canvas')
      const el = document.getElementById('advisory-panel')
      const canvas = await html2canvas(el, { scale: 1.5, backgroundColor: '#080e1a' })
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save('advisory_' + farmId + '_' + today + '.pdf')
      toast('PDF exported', 'success')
    } catch (e) {
      toast('PDF export failed: ' + e.message, 'error')
    }
  }

  return (
    <div id="advisory-panel">
      {/* Page header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Farm Advisory</h1>
          <p className="page-sub">FAO-56 irrigation engine &middot; KJS-AGR-01 prototype</p>
        </div>
        <button className="btn" onClick={handleExportPDF} title="Export advisory as PDF">
          Export PDF
        </button>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="field">
          <label>Taluk</label>
          <select value={taluk} onChange={e => { setTaluk(e.target.value); setVillage('All'); setFarmId('') }}>
            {taluks.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Village</label>
          <select value={village} onChange={e => { setVillage(e.target.value); setFarmId('') }}>
            {villages.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Farm ID</label>
          <select value={farmId} onChange={e => setFarmId(e.target.value)}>
            {filteredFarms.map(f => <option key={f.farm_id} value={f.farm_id}>{f.farm_id}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Planting date</label>
          <input type="date" value={planting} max={today} onChange={e => setPlanting(e.target.value)} />
        </div>
        <div className="field">
          <label>Crop age</label>
          <input type="text" readOnly value={cropAge + ' days'} style={{ background: 'transparent', color: 'var(--text-muted)' }} />
        </div>
        {opts && (
          <>
            <div className="field">
              <label>Soil texture</label>
              <select value={soilType} onChange={e => setSoilType(e.target.value)}>
                {opts.soils?.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Irrigation method</label>
              <select value={method} onChange={e => setMethod(e.target.value)}>
                {opts.methods && Object.keys(opts.methods).map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </>
        )}
        <div className="field">
          <label>Pump (m\u00B3/h)</label>
          <input type="number" value={pumpFlow} min="1" max="200" onChange={e => setPumpFlow(e.target.value)} />
        </div>
        <div className="field">
          <label>Probe reading (m\u00B3/m\u00B3)</label>
          <input type="number" value={sensor} min="0" max="0.6" step="0.005" placeholder="optional" onChange={e => setSensor(e.target.value)} />
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <label style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={useLive} onChange={e => setUseLive(e.target.checked)} />
            Live weather
          </label>
        </div>
        <button className="btn primary" onClick={() => refetchPlan()} style={{ alignSelf: 'flex-end' }}>
          {planLoading ? 'Loading...' : 'Update Advisory'}
        </button>
      </div>

      {planError && <div className="alert error" style={{ marginBottom: 16 }}>Advisory error: {planError.message}</div>}

      {/* Status + key metrics */}
      {statusInfo && rec && (
        <div className="mb-5">
          <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
            <span className={'status-badge ' + statusInfo.cls}>{statusInfo.emoji} {statusInfo.label}</span>
            {currentFarm && (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {farmId} &middot; {currentFarm.village}, {currentFarm.taluk} &middot; {currentFarm.area_ha?.toFixed(2)} ha &middot; Day {cropAge}
              </span>
            )}
          </div>
          <div className="stat-grid">
            <StatTile label="Soil Moisture" value={(soilMoistureVal * 100).toFixed(1) + '%'} delta={plan.soil_moisture_source === 'sensor' ? 'field sensor' : 'ML estimate'} />
            <StatTile label="Next Irrigation" value={rec.next_irrigation_date} delta={'in ' + rec.days_until_irrigation + ' days'} />
            <StatTile label="Pump Duration" value={rec.duration_hours?.toFixed(1) + ' h'} delta={rec.volume_m3?.toFixed(0) + ' m\u00B3'} />
            <StatTile label="Crop Water Use" value={(planData?.water_requirement?.etc_mm_day?.toFixed(1) ?? '\u2014') + ' mm/d'} delta={'Kc ' + (planData?.crop?.kc ?? '\u2014')} />
            <StatTile label="Water Stress" value={planData?.water_stress?.category?.replace(/_/g, ' ') ?? '\u2014'} delta={'index ' + (planData?.water_stress?.stress_index?.toFixed(2) ?? '\u2014')}
              color={planData?.water_stress?.stress_index > 0.5 ? 'var(--status-now)' : undefined} />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {['advisory', 'charts', 'model', 'review'].map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{
              padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === t ? 'var(--aqua-400)' : 'var(--text-muted)',
              fontWeight: activeTab === t ? 700 : 400,
              borderBottom: '2px solid ' + (activeTab === t ? 'var(--aqua-400)' : 'transparent'),
              fontSize: '0.85rem', fontFamily: 'inherit', transition: 'all 0.15s',
            }}>
            {{ advisory: 'Advisory', charts: 'Charts', model: 'Model', review: 'Review' }[t]}
          </button>
        ))}
      </div>

      {/* Tab: Advisory */}
      {activeTab === 'advisory' && (
        <div className="grid-2 gap-4">
          {/* Left: map + soil gauge */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Plot view</span>
                <span className="text-muted text-sm">{village !== 'All' ? village : taluk !== 'All' ? taluk : 'All plots'}</span>
              </div>
              <FarmMap geojson={geojson} onFarmClick={setFarmId} height={300} />
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Soil moisture</span>
                <span className={'card-tag ' + (soilMoistureVal < 0.22 ? 'danger' : soilMoistureVal < 0.23 ? 'warn' : 'ok')}>
                  {plan?.soil_moisture_source || '\u2014'}
                </span>
              </div>
              <div className="card-body flex items-center justify-between gap-4">
                <SoilGauge value={soilMoistureVal} label="Root-zone moisture" size={160} />
                {currentFarm && (
                  <dl className="kv-list" style={{ flex: 1 }}>
                    <dt>NDVI</dt><dd>{currentFarm.ndvi ?? '\u2014'}</dd>
                    <dt>Temperature</dt><dd>{currentFarm.temperature_c ?? '\u2014'} \u00B0C</dd>
                    <dt>Rainfall</dt><dd>{currentFarm.rainfall_mm ?? '\u2014'} mm</dd>
                    <dt>Humidity</dt><dd>{currentFarm.relative_humidity ?? '\u2014'} %</dd>
                    <dt>Area</dt><dd>{currentFarm.area_ha?.toFixed(2)} ha</dd>
                  </dl>
                )}
              </div>
            </div>
          </div>

          {/* Right: advisory + tables */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {plan && (
              <>
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Irrigation Advisory</span>
                    <span className="card-tag">FAO-56 engine</span>
                  </div>
                  <div className="card-body">
                    <div className={'advisory-text' + (rec?.status === 'IRRIGATE_NOW' ? ' urgent' : '')}>
                      {plan.advisory_text}
                    </div>
                    {planData?.rainfall_adjustment?.postponed_days > 0 && (
                      <div className="alert info mt-2">
                        Forecast rain of {planData.rainfall_adjustment.forecast_rain_mm?.toFixed(0)} mm postpones irrigation by {planData.rainfall_adjustment.postponed_days} days.
                      </div>
                    )}
                    {plan.soil_moisture_source === 'ml_model' && (
                      <div className="alert warn mt-2">
                        Using ML estimate &mdash; enter a probe reading for higher accuracy.
                      </div>
                    )}
                  </div>
                </div>

                {/* Fertigation */}
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Fertigation</span>
                    <span className="card-tag warn">placeholder doses</span>
                  </div>
                  <div className="card-body">
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead><tr><th>Product</th><th>kg/acre</th><th>kg (this plot)</th></tr></thead>
                        <tbody>
                          {plan.fertigation && Object.entries(plan.fertigation.products_per_application_kg_acre || {}).map(([p, v]) => (
                            <tr key={p}>
                              <td>{p}</td>
                              <td>{Number(v).toFixed(2)}</td>
                              <td>{Number(plan.fertigation.products_per_application_kg_plot?.[p] || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {plan.fertigation && (
                      <p className="text-muted mt-2">{plan.fertigation.applications_in_stage} splits in this stage. Organic carbon: {plan.fertigation.organic_carbon_rating}.</p>
                    )}
                  </div>
                </div>

                {/* Pump sessions */}
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Pump Sessions</span>
                    <span className="text-muted text-sm">morning window first</span>
                  </div>
                  <div className="card-body" style={{ padding: 0 }}>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead><tr><th>Date</th><th>Start</th><th>End</th><th>Hours</th></tr></thead>
                        <tbody>
                          {(plan.pump_sessions || []).map((s, i) => (
                            <tr key={i}><td>{s.date}</td><td>{s.start}</td><td>{s.end}</td><td>{Number(s.hours).toFixed(1)}</td></tr>
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

      {/* Tab: Charts */}
      {activeTab === 'charts' && plan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Root-zone water balance, next 14 days</span>
              <span className="text-muted text-sm">hover points for values</span>
            </div>
            <div className="card-body">
              <WaterBalanceChart projection={planData?.projection} rawMM={planData?.soil_water?.raw_mm} />
              <p className="text-muted mt-2">
                TAW {planData?.soil_water?.taw_mm?.toFixed(0)} mm &middot; root depth {planData?.crop?.root_depth_m} m &middot; ETo: {planData?.inputs?.eto_source}
              </p>
            </div>
          </div>
          <div className="grid-2 gap-4">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Yield risk if irrigation is delayed</span>
              </div>
              <div className="card-body">
                <YieldLossChart data={plan.yield_loss_if_delayed} />
                <p className="text-muted mt-2">FAO-33 yield response (Ky). Relative estimate, not field-validated.</p>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Water summary</span>
              </div>
              <div className="card-body">
                <dl className="kv-list">
                  <dt>TAW</dt><dd>{planData?.soil_water?.taw_mm?.toFixed(1)} mm</dd>
                  <dt>RAW (trigger)</dt><dd>{planData?.soil_water?.raw_mm?.toFixed(1)} mm</dd>
                  <dt>ETo source</dt><dd>{planData?.inputs?.eto_source}</dd>
                  <dt>ETc (mm/day)</dt><dd>{planData?.water_requirement?.etc_mm_day?.toFixed(2)}</dd>
                  <dt>Gross depth</dt><dd>{planData?.water_requirement?.gross_depth_mm?.toFixed(1)} mm</dd>
                  <dt>Volume needed</dt><dd>{rec?.volume_m3?.toFixed(0)} m\u00B3</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Model (what-if) */}
      {activeTab === 'model' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">What-if Simulator</span>
              <span className="card-tag">sensitivity analysis</span>
            </div>
            <div className="card-body">
              <p className="text-muted mb-4">Adjust environmental inputs to see how the ML soil moisture prediction changes.</p>
              <div className="grid-3 gap-4 mb-4">
                <div className="whatif-slider">
                  <label className="text-muted text-sm">Rainfall (mm): {wiRain ?? currentFarm?.rainfall_mm ?? 0}</label>
                  <input type="range" min="0" max="200" step="1"
                    value={wiRain ?? currentFarm?.rainfall_mm ?? 0}
                    onChange={e => setWiRain(parseFloat(e.target.value))} />
                </div>
                <div className="whatif-slider">
                  <label className="text-muted text-sm">Temperature (\u00B0C): {wiTemp ?? currentFarm?.temperature_c ?? 28}</label>
                  <input type="range" min="10" max="45" step="0.5"
                    value={wiTemp ?? currentFarm?.temperature_c ?? 28}
                    onChange={e => setWiTemp(parseFloat(e.target.value))} />
                </div>
                <div className="whatif-slider">
                  <label className="text-muted text-sm">Humidity (%): {wiHumidity ?? currentFarm?.relative_humidity ?? 60}</label>
                  <input type="range" min="20" max="100" step="1"
                    value={wiHumidity ?? currentFarm?.relative_humidity ?? 60}
                    onChange={e => setWiHumidity(parseFloat(e.target.value))} />
                </div>
              </div>
              <button className="btn primary" onClick={handleWhatIf} disabled={whatIfMut.isPending}>
                {whatIfMut.isPending ? 'Simulating...' : 'Run simulation'}
              </button>
              {wiResult && (
                <div className="grid-2 gap-4 mt-4">
                  <div className="stat-tile">
                    <div className="stat-label">Original prediction</div>
                    <div className="stat-value">{(wiResult.original?.advisory?.predicted_soil_moisture * 100)?.toFixed(2)}%</div>
                    <div className="stat-delta">{wiResult.original?.advisory?.risk_level}</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-label">What-if prediction</div>
                    <div className="stat-value text-aqua">{(wiResult.simulated?.advisory?.predicted_soil_moisture * 100)?.toFixed(2)}%</div>
                    <div className={'stat-delta ' + (wiResult.prediction_change > 0 ? 'pos' : 'neg')}>
                      {wiResult.prediction_change > 0 ? '+' : ''}{(wiResult.prediction_change * 100)?.toFixed(4)}%
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {farmDetail?.model && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Feature contributions</span>
                <span className="card-tag">{farmDetail.model?.model_name}</span>
              </div>
              <div className="card-body">
                <p className="text-muted mb-4 text-sm">One-at-a-time baseline replacement. Shows sensitivity, not causation.</p>
                <ContributionChart contributions={farmDetail.model?.top_factors} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Review */}
      {activeTab === 'review' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Human Review</span>
            <span className="card-tag">HITL feedback</span>
          </div>
          <div className="card-body">
            <p className="text-muted mb-4 text-sm">Decisions are stored as training labels for future model improvement.</p>
            <form className="filter-bar" onSubmit={handleFeedback} style={{ marginBottom: 0 }}>
              <div className="field">
                <label>Reviewer</label>
                <select name="role">
                  <option value="field_officer">Field Officer</option>
                  <option value="agronomist">Agronomist</option>
                  <option value="farmer">Farmer</option>
                </select>
              </div>
              <div className="field">
                <label>Decision</label>
                <select name="decision">
                  <option value="accepted">Accept</option>
                  <option value="modified">Modify</option>
                  <option value="rejected">Reject</option>
                </select>
              </div>
              <div className="field">
                <label>Override hours</label>
                <input type="number" name="hours" min="0" step="0.5" defaultValue={rec?.duration_hours?.toFixed(1) || ''} />
              </div>
              <div className="field" style={{ flex: 2 }}>
                <label>Comment</label>
                <input type="text" name="comment" maxLength={500} placeholder="optional" />
              </div>
              <button className="btn primary" type="submit" style={{ alignSelf: 'flex-end' }} disabled={feedbackMut.isPending}>
                {feedbackMut.isPending ? 'Saving...' : 'Record decision'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
