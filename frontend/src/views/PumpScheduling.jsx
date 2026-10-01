import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getFleet, getOptions, getFeederSchedule, downloadCSV } from '../api.js'
import { useToast } from '../context.jsx'
import { useI18n } from '../i18n.jsx'
import { FeederLoadChart } from '../components/Charts.jsx'
import { Card, Stat, PageHeader, Icon, Alert } from '../components/ui.jsx'
import { fleetQueryParams } from './FleetMap.jsx'

function Gantt({ assignments, windows, max = 40 }) {
  const { t, fmtDate } = useI18n()
  if (!assignments?.length) return <div className="empty-state">{t('schedule.noSessions')}</div>
  const farms = [...new Set(assignments.map(a => a.farm_id))].slice(0, max)
  const dates = [...new Set(assignments.map(a => a.date))].sort()
  const toMin = s => { const [h, m] = (s || '00:00').split(':').map(Number); return h * 60 + m }
  const dayW = 168, rowH = 24, labelW = 100, headH = 34
  const W = labelW + dates.length * dayW, H = headH + farms.length * rowH + 8
  const fi = Object.fromEntries(farms.map((f, i) => [f, i])), di = Object.fromEntries(dates.map((d, i) => [d, i]))
  return (
    <div className="table-wrap" style={{ paddingBottom: 8 }}>
      <svg width={W} height={H} style={{ display: 'block', fontFamily: 'var(--font-ui)' }} role="img" aria-label={t('schedule.timeline')}>
        <defs><linearGradient id="ganttBar" x1="0" x2="1"><stop offset="0" stopColor="#19d39b" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs>
        {dates.map((d, i) => (
          <g key={d}>
            {(windows || []).map((w, j) => <rect key={j} x={labelW + i * dayW + (toMin(w.start) / 1440) * dayW} y={headH - 4} width={((toMin(w.end) - toMin(w.start)) / 1440) * dayW} height={H - headH} fill="var(--bg-hover)" />)}
            <text x={labelW + i * dayW + dayW / 2} y={18} textAnchor="middle" fontSize={11} fill="var(--text-2)">{fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}</text>
            <line x1={labelW + i * dayW} y1={headH - 4} x2={labelW + i * dayW} y2={H} stroke="var(--border)" />
          </g>
        ))}
        {farms.map((f, i) => <text key={f} x={labelW - 8} y={headH + i * rowH + rowH / 2 + 4} textAnchor="end" fontSize={10} fill="var(--text-2)" fontFamily="var(--font-mono)">{f}</text>)}
        {assignments.map((a, k) => {
          if (fi[a.farm_id] === undefined || di[a.date] === undefined) return null
          const s = toMin(a.start), e = toMin(a.end)
          return (
            <rect key={k} x={labelW + di[a.date] * dayW + (s / 1440) * dayW} y={headH + fi[a.farm_id] * rowH + 4} width={Math.max(3, ((e - s) / 1440) * dayW)} height={rowH - 8} rx={4} fill="url(#ganttBar)">
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
  const { t, fmtNum } = useI18n()
  const [village, setVillage] = useState('')
  const [capacity, setCapacity] = useState('')
  const [days, setDays] = useState(14)
  const [result, setResult] = useState(null)

  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })
  const params = fleetQueryParams(settings)
  const { data: fleet = [], isLoading, error } = useQuery({ queryKey: ['fleet', params], queryFn: () => getFleet(params), staleTime: 60000 })
  const villages = useMemo(() => [...new Set(fleet.map(f => f.village))].sort(), [fleet])
  useEffect(() => { if (villages.length && !villages.includes(village)) setVillage(villages[0]) }, [villages, village])
  useEffect(() => { if (opts && capacity === '') setCapacity(opts.max_concurrent_pumps_per_feeder) }, [opts, capacity])
  useEffect(() => { setResult(null) }, [params.crop_age_days, params.soil_type, params.irrigation_method, params.pump_flow_m3h])

  const windowHours = useMemo(() => (opts?.supply_windows || []).reduce((s, w) => {
    const [a, b] = [w.start, w.end].map(x => { const [h, m] = x.split(':').map(Number); return h + m / 60 })
    return s + (b - a)
  }, 0), [opts])
  const due = useMemo(() => fleet.filter(f => f.village === village && f.due_day < days), [fleet, village, days])
  const demand = due.reduce((s, f) => s + f.hours, 0)
  const cap = (Number(capacity) || 0) * windowHours * days
  const ratio = cap ? demand / cap : 0

  const mut = useMutation({
    mutationFn: getFeederSchedule,
    onSuccess: (data, vars) => { setResult({ ...data, requested: vars.farms.length, village }); toast(t('schedule.built'), 'success') },
    onError: e => toast(t('schedule.failed', { msg: e.message }), 'error'),
  })
  const build = e => {
    e.preventDefault()
    if (!due.length) { toast(t('schedule.noFarms'), 'warn'); return }
    mut.mutate({
      farms: due.map(f => ({ farm_id: f.farm_id, hours: Math.max(0.5, f.hours), due_day: f.due_day, stress_index: f.stress_index || 0 })),
      start_date: new Date().toISOString().split('T')[0], days, max_concurrent: Number(capacity) || undefined,
    })
  }

  return (
    <>
      <PageHeader eyebrow={t('nav.groupFleet')} title={t('schedule.title')} subtitle={t('schedule.subtitle')} />
      {error && <div className="mb-4"><Alert tone="error">{t('schedule.errorLoad', { msg: error.message })}</Alert></div>}

      <form className="panel" onSubmit={build}>
        <div className="form-grid">
          <div className="field"><label htmlFor="ps-v">{t('schedule.feeder')}</label>
            <select id="ps-v" value={village} onChange={e => { setVillage(e.target.value); setResult(null) }}>{villages.map(v => <option key={v}>{v}</option>)}</select></div>
          <div className="field"><label htmlFor="ps-c">{t('schedule.maxPumps')}</label><input id="ps-c" type="number" min="1" max="500" value={capacity} onChange={e => setCapacity(e.target.value)} /></div>
          <div className="field"><label htmlFor="ps-d">{t('schedule.horizon')}</label><input id="ps-d" type="number" min="1" max="21" value={days} onChange={e => setDays(Math.min(21, Math.max(1, parseInt(e.target.value) || 1)))} /></div>
          <div className="field span-2"><span className="field-label">{t('schedule.windows', { h: windowHours })}</span>
            <div className="row">{opts?.supply_windows?.map(w => <span key={w.start} className="chip"><Icon name="bolt" size={12} />{w.start}–{w.end}</span>)}</div></div>
          <button className="btn primary" type="submit" disabled={mut.isPending || !village || isLoading}><Icon name="pump" />{mut.isPending ? t('schedule.building') : t('schedule.build')}</button>
        </div>
      </form>

      <div className="stat-grid mb-5">
        <Stat label={t('schedule.dueInHorizon')} icon="layers" value={isLoading ? '…' : fmtNum(due.length)} />
        <Stat label={t('schedule.demanded')} icon="clock" tone="accent-2" value={fmtNum(demand)} />
        <Stat label={t('schedule.capacity')} icon="bolt" tone="water" value={`${fmtNum(cap)} h`} delta={t('schedule.capacityCalc', { p: capacity || '—', h: windowHours, d: days })} />
        <Stat label={t('schedule.ratio')} icon="alert" tone={ratio > 1 ? 'status-now' : 'status-ok'} value={cap ? `${fmtNum(ratio * 100)}%` : '—'} valueTone={ratio > 1 ? 'danger' : undefined}
          delta={ratio > 1 ? t('schedule.over') : t('schedule.fits')}>
          <div className="mix-bar mt-2" style={{ width: '100%' }}><span style={{ flex: Math.min(1, ratio), background: ratio > 1 ? 'var(--status-now)' : 'var(--accent)' }} /><span style={{ flex: Math.max(0, 1 - ratio) }} /></div>
        </Stat>
      </div>

      {result && (
        <div className="stack">
          <div className="stat-grid">
            <Stat label={t('schedule.fully')} icon="check" tone="status-ok" value={`${result.requested - (result.unscheduled?.length || 0)} / ${result.requested}`} />
            <Stat label={t('schedule.unmet')} icon="alert" tone={result.unmet_hours > 0 ? 'status-soon' : 'status-ok'} value={`${fmtNum(result.unmet_hours)} / ${fmtNum(result.demand_hours)}`} />
            <Stat label={t('schedule.peak')} icon="pump" value={result.peak_concurrent_pumps} delta={t('schedule.limit', { n: result.capacity_per_slot })} />
            <Stat label={t('schedule.util')} icon="bolt" tone="water" value={`${fmtNum(result.feeder_utilisation * 100)}%`} />
          </div>
          <Alert tone="info">{t('schedule.method')}</Alert>
          <Card title={t('schedule.load')} icon="bolt" tag={t('schedule.loadHint')}><FeederLoadChart assignments={result.assignments} capacity={result.capacity_per_slot} /></Card>
          <Card title={t('schedule.timeline')} icon="calendar" tag={t('schedule.timelineHint')} flush><Gantt assignments={result.assignments} windows={opts?.supply_windows} /></Card>
          {result.unscheduled?.length > 0 && (
            <Card title={t('schedule.cannot')} icon="alert" tag={String(result.unscheduled.length)} tagTone="danger" flush foot={t('schedule.cannotHint')}>
              <div className="table-wrap" style={{ maxHeight: 300 }}>
                <table className="data-table">
                  <thead><tr><th>{t('common.farm')}</th><th className="num">{t('schedule.needed')}</th><th className="num">{t('schedule.scheduled')}</th><th className="num">{t('schedule.unmetH')}</th></tr></thead>
                  <tbody>{result.unscheduled.map(u => <tr key={u.farm_id}><td className="mono">{u.farm_id}</td><td className="num">{fmtNum(u.hours, 1)}</td><td className="num">{fmtNum(u.hours_scheduled, 1)}</td><td className="num tone-danger">{fmtNum(u.hours_unmet, 1)}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
          )}
          <Card title={t('schedule.all')} icon="clipboard" flush actions={<button className="btn sm" onClick={() => downloadCSV(result.assignments, `pump_schedule_${result.village}.csv`)}><Icon name="download" size={13} />{t('common.exportCsv')}</button>}>
            <div className="table-wrap" style={{ maxHeight: 400 }}>
              <table className="data-table">
                <thead><tr><th>{t('common.farm')}</th><th>{t('common.date')}</th><th>{t('common.start')}</th><th>{t('common.end')}</th><th className="num">h</th></tr></thead>
                <tbody>{result.assignments.map((a, i) => <tr key={i}><td className="mono">{a.farm_id}</td><td>{a.date}</td><td>{a.start}</td><td>{a.end}</td><td className="num">{fmtNum(a.hours, 1)}</td></tr>)}</tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
