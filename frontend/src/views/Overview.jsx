import { lazy, Suspense, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { getFleet, getFleetAnalytics } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Card, Stat, Icon, Sparkline, StatusLine, Skeleton, Alert, STATUS_HEX } from '../components/ui.jsx'
import { DemandCalendarChart, TOOLTIP } from '../components/Charts.jsx'
import { fleetQueryParams } from './FleetMap.jsx'

const Fleet3D = lazy(() => import('../three/Fleet3D.jsx'))

export default function Overview({ settings, onOpenFarm, onNavigate }) {
  const { t, fmtNum, fmtDate } = useI18n()
  const params = fleetQueryParams(settings)
  const { data: fleet = [], error } = useQuery({ queryKey: ['fleet', params], queryFn: () => getFleet(params), staleTime: 60000 })
  const { data: analytics } = useQuery({ queryKey: ['analytics', params], queryFn: () => getFleetAnalytics(params), staleTime: 60000 })

  const urgent = useMemo(() => [...fleet].sort((a, b) => a.due_day - b.due_day || b.depletion_ratio - a.depletion_ratio).slice(0, 8), [fleet])
  const byTaluk = useMemo(() => {
    const m = {}
    fleet.forEach(f => {
      const r = (m[f.taluk] ||= { taluk: f.taluk, IRRIGATE_NOW: 0, IRRIGATE_SOON: 0, NOT_REQUIRED: 0 })
      r[f.status] += 1
    })
    return Object.values(m).sort((a, b) => (b.IRRIGATE_NOW + b.IRRIGATE_SOON) - (a.IRRIGATE_NOW + a.IRRIGATE_SOON))
  }, [fleet])
  const villages = new Set(fleet.map(f => f.village)).size
  const tot = analytics?.totals
  const calendar = analytics?.demand_calendar || []

  return (
    <>
      <section className="hero">
        <div className="eyebrow">{t('overview.greeting')}</div>
        <h1 className="hero-title"><span className="grad">{t('overview.heroTitle')}</span></h1>
        <p className="hero-sub">{t('overview.heroSub', { farms: fmtNum(fleet.length || 1000), villages: villages || 10 })}</p>
        <p className="hero-sub small muted">
          {t('overview.settingsNote', { day: params.crop_age_days, soil: t('soil.' + settings.soilType), method: t('method.' + settings.method) })}
        </p>
        <div className="hero-actions">
          <button className="btn primary" onClick={() => onNavigate('dashboard')}><Icon name="leaf" />{t('overview.openFarm')}</button>
          <button className="btn" onClick={() => onNavigate('fleet')}><Icon name="map" />{t('overview.openFleet')}</button>
          <button className="btn ghost" onClick={() => onNavigate('guide')}><Icon name="book" />{t('nav.guide')}</button>
        </div>
      </section>

      {error && <div className="mb-4"><Alert tone="error">{t('fleet.errorLoad', { msg: error.message })}</Alert></div>}

      <div className="stat-grid mb-5">
        <Stat label={t('overview.needWater')} icon="alert" tone="status-now"
          value={tot ? fmtNum(tot.irrigate_now + tot.irrigate_soon) : '…'}
          delta={tot && t('analytics.nowSoon', { now: tot.irrigate_now, soon: tot.irrigate_soon })} />
        <Stat label={t('overview.waterWeek')} icon="drop" tone="water"
          value={tot ? `${fmtNum(tot.volume_due_7d_m3)} m³` : '…'} delta={tot && t('fleet.pumpHours', { n: fmtNum(tot.pump_hours_due_7d) })}>
          <Sparkline values={calendar.slice(0, 7).map(d => d.volume_m3)} color="var(--water)" />
        </Stat>
        <Stat label={t('overview.fleetUse')} icon="sun" tone="accent"
          value={tot ? `${fmtNum(tot.daily_etc_m3)} m³` : '…'} delta={tot && t('analytics.meanEtc', { v: fmtNum(tot.mean_etc_mm_day, 2) })} />
        <Stat label={t('overview.area')} icon="layers" tone="accent-2"
          value={tot ? `${fmtNum(tot.area_ha)} ha` : '…'} delta={tot && `${fmtNum(tot.farms)} ${t('common.farms')}`}>
          <Sparkline values={calendar.map(d => d.farms_due)} color="var(--accent)" />
        </Stat>
      </div>

      <div className="grid-main mb-5">
        <Card title={t('overview.fleet3d')} icon="cube" flush tag="three.js" tagTone="water">
          {fleet.length ? (
            <Suspense fallback={<Skeleton height={480} style={{ borderRadius: 0 }} />}>
              <Fleet3D fleet={fleet} selectedId={settings.farmId} onOpenFarm={onOpenFarm} height={480} />
            </Suspense>
          ) : <Skeleton height={480} style={{ borderRadius: 0 }} />}
        </Card>
        <Card title={t('overview.urgent')} icon="alert" flush foot={t('overview.urgentHint')}>
          <div className="table-wrap" style={{ maxHeight: 440 }}>
            <table className="data-table clickable">
              <tbody>
                {urgent.map(f => (
                  <tr key={f.farm_id} onClick={() => onOpenFarm(f.farm_id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpenFarm(f.farm_id)}>
                    <td>
                      <div className="mono">{f.farm_id}</div>
                      <div className="xs muted">{f.village}</div>
                    </td>
                    <td><StatusLine status={f.status} short /></td>
                    <td className="num">
                      <div className="strong">{f.due_day === 0 ? t('common.today') : fmtDate(f.next_irrigation_date)}</div>
                      <div className="xs muted">{fmtNum(f.hours, 1)} h · {fmtNum(f.volume_m3)} m³</div>
                    </td>
                    <td style={{ width: 70 }}>
                      <div className="mix-bar" style={{ width: 60 }} title={`${fmtNum(f.depletion_ratio * 100)}%`}>
                        <span style={{ flex: f.depletion_ratio, background: STATUS_HEX[f.status] }} />
                        <span style={{ flex: 1 - f.depletion_ratio, background: 'transparent' }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid-main">
        <Card title={t('overview.calendar')} icon="calendar">
          {calendar.length ? <DemandCalendarChart calendar={calendar} /> : <Skeleton height={250} />}
        </Card>
        <Card title={t('overview.byTaluk')} icon="chart">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byTaluk} layout="vertical" margin={{ top: 0, right: 10, left: 6, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="taluk" width={118} tick={{ fill: 'var(--text-2)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP} formatter={(v, n) => [v, t('status.' + n)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} formatter={n => <span style={{ color: 'var(--text-2)' }}>{t('status.short.' + n)}</span>} />
              {Object.keys(STATUS_HEX).map(k => <Bar key={k} dataKey={k} stackId="a" fill={STATUS_HEX[k]} stroke="var(--bg-card)" strokeWidth={1} barSize={16} />)}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </>
  )
}
