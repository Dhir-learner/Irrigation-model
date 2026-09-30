import { useQuery } from '@tanstack/react-query'
import { getFeedback } from '../api.js'

const DECISION_COLOR = {
  accepted: '#22c55e',
  modified:  '#f59e0b',
  rejected:  '#ef4444',
}

export default function ReviewLog() {
  const { data: reviews = [], isLoading, error, refetch } = useQuery({
    queryKey: ['feedback'],
    queryFn: getFeedback,
    staleTime: 10000,
  })

  if (isLoading) return <div className="skeleton" style={{ height: 300 }} />

  const counts = reviews.reduce((acc, r) => {
    acc[r.decision] = (acc[r.decision] || 0) + 1
    return acc
  }, {})

  return (
    <div>
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Review Log</h1>
          <p className="page-sub">Human decisions on advisories, newest first. These become training labels.</p>
        </div>
        <button className="btn" onClick={() => refetch()}>Refresh</button>
      </div>

      {error && <div className="alert error mb-4">{error.message}</div>}

      {/* Summary tiles */}
      <div className="stat-grid mb-5">
        <div className="stat-tile">
          <div className="stat-label">Total reviews</div>
          <div className="stat-value">{reviews.length}</div>
        </div>
        {['accepted', 'modified', 'rejected'].map(d => (
          <div key={d} className="stat-tile">
            <div className="stat-label" style={{ textTransform: 'capitalize' }}>{d}</div>
            <div className="stat-value" style={{ color: DECISION_COLOR[d] }}>
              {counts[d] || 0}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">All reviews</span>
          <span className="text-muted text-sm">{reviews.length} records</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {reviews.length === 0 ? (
            <div className="text-muted" style={{ padding: 24, textAlign: 'center' }}>
              No reviews yet. Submit one from the Farm Advisory &rarr; Review tab.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Farm ID</th><th>Decision</th><th>Reviewer</th>
                    <th>Rec. date</th><th>Rec. hours</th><th>Override hrs</th>
                    <th>Moisture source</th><th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {[...reviews].reverse().map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{r.farm_id}</td>
                      <td>
                        <span style={{
                          color: DECISION_COLOR[r.decision] || '#38bdf8',
                          fontWeight: 700, fontSize: '0.78rem',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>
                          {r.decision}
                        </span>
                      </td>
                      <td>{r.reviewer_role?.replace(/_/g, ' ')}</td>
                      <td>{r.recommended_date || '\u2014'}</td>
                      <td>{r.recommended_hours?.toFixed(1) || '\u2014'}</td>
                      <td>{r.override_hours != null ? Number(r.override_hours).toFixed(1) : '\u2014'}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{r.soil_moisture_source || '\u2014'}</td>
                      <td style={{
                        color: 'var(--text-secondary)', maxWidth: 200,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{r.comment || '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
