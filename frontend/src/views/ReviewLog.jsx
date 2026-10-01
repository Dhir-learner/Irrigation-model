import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFeedback, downloadCSV } from '../api.js'

const DECISIONS = {
  accepted: { label: 'Accepted', tone: 'ok', icon: '✓' },
  modified: { label: 'Modified', tone: 'warn', icon: '✎' },
  rejected: { label: 'Rejected', tone: 'danger', icon: '✕' },
}
const num = v => (v === null || v === undefined || v === '' ? null : Number(v))

export default function ReviewLog({ onOpenFarm }) {
  const { data: reviews = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['feedback'], queryFn: getFeedback, staleTime: 10000,
  })
  const [decision, setDecision] = useState('all')
  const [role, setRole] = useState('all')

  const stats = useMemo(() => {
    const c = { accepted: 0, modified: 0, rejected: 0 }
    const deltas = []
    reviews.forEach(r => {
      c[r.decision] = (c[r.decision] || 0) + 1
      const rec = num(r.recommended_hours), ov = num(r.override_hours)
      if (r.decision === 'modified' && rec !== null && ov !== null) deltas.push(ov - rec)
    })
    const meanDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null
    return { counts: c, acceptance: reviews.length ? c.accepted / reviews.length : null, meanDelta, nDelta: deltas.length }
  }, [reviews])

  const rows = useMemo(() => reviews.filter(r =>
    (decision === 'all' || r.decision === decision) && (role === 'all' || r.reviewer_role === role)
  ), [reviews, decision, role])

  return (
    <div>
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Review Log</h1>
          <p className="page-sub">Human decisions on advisories, newest first. These become training labels for a future irrigation model.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => downloadCSV(rows, 'advisory_reviews.csv')} disabled={!rows.length}>Export CSV</button>
          <button className="btn" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {error && <div className="alert error mb-4">{error.message}</div>}

      <div className="stat-grid mb-5">
        <div className="stat-tile"><div className="stat-label">Total reviews</div><div className="stat-value">{reviews.length}</div></div>
        <div className="stat-tile">
          <div className="stat-label">Acceptance rate</div>
          <div className="stat-value">{stats.acceptance == null ? '—' : (stats.acceptance * 100).toFixed(0) + '%'}</div>
          <div className="stat-delta">{stats.counts.accepted} accepted &middot; {stats.counts.modified} modified &middot; {stats.counts.rejected} rejected</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Mean hours override</div>
          <div className="stat-value">{stats.meanDelta == null ? '—' : (stats.meanDelta > 0 ? '+' : '') + stats.meanDelta.toFixed(1) + ' h'}</div>
          <div className="stat-delta">{stats.nDelta ? `from ${stats.nDelta} modifications: ${stats.meanDelta > 0 ? 'engine under-waters' : 'engine over-waters'}` : 'no modified reviews yet'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Reviews <span className="text-muted text-sm">({rows.length})</span></span>
          <div className="flex gap-2 flex-wrap">
            <select value={decision} onChange={e => setDecision(e.target.value)} aria-label="Filter by decision" className="inline-select">
              <option value="all">All decisions</option>
              {Object.entries(DECISIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={role} onChange={e => setRole(e.target.value)} aria-label="Filter by reviewer" className="inline-select">
              <option value="all">All reviewers</option>
              <option value="field_officer">Field officer</option>
              <option value="agronomist">Agronomist</option>
              <option value="farmer">Farmer</option>
            </select>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {isLoading ? <div className="skeleton" style={{ height: 200, margin: 16 }} /> : rows.length === 0 ? (
            <div className="empty-state">
              {reviews.length === 0 ? 'No reviews yet. Record one from Farm Dashboard → Review.' : 'No reviews match these filters.'}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th><th>Farm</th><th>Decision</th><th>Reviewer</th>
                    <th>Recommended</th><th>Override</th><th>Moisture source</th><th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const d = DECISIONS[r.decision]
                    const rec = num(r.recommended_hours), ov = num(r.override_hours)
                    return (
                      <tr key={r.id}>
                        <td className="text-muted nowrap">{r.timestamp ? new Date(r.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td><button className="link-btn" onClick={() => onOpenFarm?.(r.farm_id)} title="Open farm">{r.farm_id}</button></td>
                        <td><span className={'pill tone-' + (d?.tone || 'info')}><span aria-hidden="true">{d?.icon}</span> {d?.label || r.decision}</span></td>
                        <td>{r.reviewer_role?.replace(/_/g, ' ')}</td>
                        <td className="nowrap">{r.recommended_date || '—'}{rec !== null && ` · ${rec.toFixed(1)} h`}</td>
                        <td className="nowrap">{r.override_date || ''}{ov !== null ? `${r.override_date ? ' · ' : ''}${ov.toFixed(1)} h` : (!r.override_date ? '—' : '')}</td>
                        <td className="text-muted">{r.soil_moisture_source?.replace(/_/g, ' ') || '—'}</td>
                        <td className="truncate" title={r.comment || ''}>{r.comment || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
