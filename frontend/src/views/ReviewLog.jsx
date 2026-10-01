import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { getFeedback, downloadCSV } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { TOOLTIP } from '../components/Charts.jsx'
import { Card, Stat, PageHeader, Icon, Alert, Skeleton } from '../components/ui.jsx'

const TONE = { accepted: 'ok', modified: 'status-soon', rejected: 'status-now' }
const HEX = { accepted: '#4ade80', modified: '#fb923c', rejected: '#f87171' }
const ICON = { accepted: 'check', modified: 'sliders', rejected: 'alert' }
const num = v => (v === null || v === undefined || v === '' ? null : Number(v))

export default function ReviewLog({ onOpenFarm }) {
  const { t, fmtNum, fmtDate } = useI18n()
  const { data: reviews = [], isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['feedback'], queryFn: getFeedback, staleTime: 10000 })
  const [decision, setDecision] = useState('all')
  const [role, setRole] = useState('all')

  const stats = useMemo(() => {
    const c = { accepted: 0, modified: 0, rejected: 0 }
    const deltas = []
    reviews.forEach(r => {
      c[r.decision] = (c[r.decision] || 0) + 1
      const a = num(r.recommended_hours), b = num(r.override_hours)
      if (r.decision === 'modified' && a !== null && b !== null) deltas.push(b - a)
    })
    return { c, acc: reviews.length ? c.accepted / reviews.length : null, mean: deltas.length ? deltas.reduce((x, y) => x + y, 0) / deltas.length : null, n: deltas.length }
  }, [reviews])
  const rows = useMemo(() => reviews.filter(r => (decision === 'all' || r.decision === decision) && (role === 'all' || r.reviewer_role === role)), [reviews, decision, role])
  const pie = Object.entries(stats.c).filter(([, v]) => v > 0).map(([k, v]) => ({ name: k, value: v }))

  return (
    <>
      <PageHeader eyebrow={t('nav.groupInsight')} title={t('reviews.title')} subtitle={t('reviews.subtitle')} actions={<>
        <button className="btn" onClick={() => downloadCSV(rows, 'advisory_reviews.csv')} disabled={!rows.length}><Icon name="download" />{t('common.exportCsv')}</button>
        <button className="btn" onClick={() => refetch()} disabled={isFetching}><Icon name="refresh" />{isFetching ? t('common.refreshing') : t('common.refresh')}</button>
      </>} />
      {error && <div className="mb-4"><Alert tone="error">{error.message}</Alert></div>}

      <div className="grid-side mb-5">
        <Card title={t('reviews.acceptance')} icon="check">
          {pie.length ? (
            <div style={{ position: 'relative' }}>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={62} outerRadius={86} paddingAngle={3} stroke="var(--bg-card)" strokeWidth={2}>
                    {pie.map(p => <Cell key={p.name} fill={HEX[p.name]} />)}
                  </Pie>
                  <Tooltip {...TOOLTIP} formatter={(v, n) => [v, t('decision.' + n)]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                <div style={{ textAlign: 'center' }}><div className="stat-value">{fmtNum(stats.acc * 100)}%</div><div className="xs muted">{t('decision.accepted')}</div></div>
              </div>
            </div>
          ) : <div className="empty-state">{t('reviews.none')}</div>}
        </Card>
        <div className="stat-grid" style={{ alignContent: 'start' }}>
          <Stat label={t('reviews.total')} icon="clipboard" value={fmtNum(reviews.length)} delta={t('reviews.counts', { a: stats.c.accepted, m: stats.c.modified, r: stats.c.rejected })} />
          {['accepted', 'modified', 'rejected'].map(k => <Stat key={k} label={t('decision.' + k)} icon={ICON[k]} tone={TONE[k]} value={fmtNum(stats.c[k])} />)}
          <Stat label={t('reviews.meanOverride')} icon="clock" tone="water" value={stats.mean == null ? '—' : `${stats.mean > 0 ? '+' : ''}${fmtNum(stats.mean, 1)} h`}
            delta={stats.n ? t('reviews.fromMods', { n: stats.n, dir: t(stats.mean > 0 ? 'reviews.under' : 'reviews.over') }) : t('reviews.noMods')} />
        </div>
      </div>

      <Card title={t('reviews.list')} icon="clipboard" tag={String(rows.length)} flush actions={<>
        <select className="inline-input" value={decision} onChange={e => setDecision(e.target.value)} aria-label={t('reviews.allDecisions')}>
          <option value="all">{t('reviews.allDecisions')}</option>{['accepted', 'modified', 'rejected'].map(k => <option key={k} value={k}>{t('decision.' + k)}</option>)}
        </select>
        <select className="inline-input" value={role} onChange={e => setRole(e.target.value)} aria-label={t('reviews.allReviewers')}>
          <option value="all">{t('reviews.allReviewers')}</option>{['field_officer', 'agronomist', 'farmer'].map(k => <option key={k} value={k}>{t('role.' + k)}</option>)}
        </select>
      </>}>
        {isLoading ? <Skeleton height={200} style={{ margin: 16 }} /> : !rows.length ? (
          <div className="empty-state">{reviews.length ? t('common.noMatch') : t('reviews.none')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{['when', 'farm', 'decision', 'reviewer', 'rec', 'override', 'source', 'comment'].map(k => <th key={k}>{t('reviews.col.' + k)}</th>)}</tr></thead>
              <tbody>
                {rows.map(r => {
                  const a = num(r.recommended_hours), b = num(r.override_hours)
                  return (
                    <tr key={r.id}>
                      <td className="nowrap muted">{r.timestamp ? fmtDate(r.timestamp, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td><button className="link-btn" onClick={() => onOpenFarm?.(r.farm_id)}>{r.farm_id}</button></td>
                      <td><span className="pill" style={{ color: `var(--${TONE[r.decision]})` }}><Icon name={ICON[r.decision]} size={13} stroke={2.4} />{t('decision.' + r.decision)}</span></td>
                      <td>{t('role.' + r.reviewer_role)}</td>
                      <td className="nowrap">{r.recommended_date ? fmtDate(r.recommended_date) : '—'}{a !== null && ` · ${fmtNum(a, 1)} h`}</td>
                      <td className="nowrap">{[r.override_date && fmtDate(r.override_date), b !== null && `${fmtNum(b, 1)} h`].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="muted">{r.soil_moisture_source ? t('source.' + r.soil_moisture_source) : '—'}</td>
                      <td className="truncate" title={r.comment || ''}>{r.comment || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
