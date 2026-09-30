import { useQuery } from '@tanstack/react-query'
import { getCoverage } from '../api.js'

const STATUS_STYLE = {
  'Implemented': { bg: 'rgba(34,197,94,0.13)',  color: '#22c55e', border: 'rgba(34,197,94,0.25)' },
  'Partial':     { bg: 'rgba(245,158,11,0.13)', color: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
  'Rule-based':  { bg: 'rgba(56,189,248,0.13)', color: '#38bdf8', border: 'rgba(56,189,248,0.25)' },
  'ML model':    { bg: 'rgba(129,140,248,0.13)',color: '#818cf8', border: 'rgba(129,140,248,0.25)' },
  'Blocked':     { bg: 'rgba(239,68,68,0.13)',  color: '#ef4444', border: 'rgba(239,68,68,0.25)' },
}

function StatusChip({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE['Partial']
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      padding: '2px 10px', borderRadius: 20,
      fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.04em',
    }}>
      {status}
    </span>
  )
}

export default function Coverage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['coverage'],
    queryFn: getCoverage,
    staleTime: Infinity,
  })

  if (isLoading) return <div className="skeleton" style={{ height: 400 }} />
  if (error) return <div className="alert error">{error.message}</div>

  // API returns objects with named fields, not positional arrays
  const models   = data?.models   || []
  const workflow = data?.workflow || []

  const statusCounts = models.reduce((acc, m) => {
    const s = m.status || m[1]
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Use-case Coverage</h1>
        <p className="page-sub">Each AI model requested in KJS-AGR-01, how it is built, and what limits it.</p>
      </div>

      {/* Status summary pills */}
      <div className="flex items-center gap-3 mb-5" style={{ flexWrap: 'wrap' }}>
        {Object.entries(statusCounts).map(([status, count]) => (
          <div key={status} className="stat-tile" style={{ minWidth: 0, padding: '10px 16px', flex: '0 0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusChip status={status} />
              <span className="stat-value" style={{ fontSize: '1.1rem' }}>{count}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Models table */}
      <div className="card mb-5">
        <div className="card-header">
          <span className="card-title">AI model coverage</span>
          <span className="text-muted text-sm">{models.length} models</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {models.length === 0 ? (
            <div className="text-muted" style={{ padding: 24, textAlign: 'center' }}>No coverage data returned from API.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 200 }}>Use-case model</th>
                    <th>Status</th>
                    <th style={{ minWidth: 260 }}>Implementation</th>
                    <th style={{ minWidth: 200 }}>Evidence</th>
                    <th style={{ minWidth: 220 }}>Limitation</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m, i) => {
                    // API returns objects: { use_case_model, status, implementation, evidence, limitation }
                    const name   = m.use_case_model || m[0]
                    const status = m.status         || m[1]
                    const impl   = m.implementation || m[2]
                    const evid   = m.evidence       || m[3]
                    const limit  = m.limitation     || m[4]
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{name}</td>
                        <td><StatusChip status={status} /></td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5 }}>{impl}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'monospace' }}>{evid}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.5 }}>{limit}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Workflow stages */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Workflow stages</span>
          <span className="text-muted text-sm">{workflow.length} stages</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th style={{ width: 220 }}>Stage</th><th>What this prototype provides</th></tr>
              </thead>
              <tbody>
                {workflow.map((w, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, color: 'var(--aqua-400)' }}>{w.stage}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{w.provides}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="alert info mt-4">
        <strong>Key:</strong>&nbsp;
        <strong style={{ color: '#22c55e' }}>Implemented</strong> &mdash; built as requested &nbsp;&bull;&nbsp;
        <strong style={{ color: '#38bdf8' }}>Rule-based</strong> &mdash; FAO equations (no labels to train on) &nbsp;&bull;&nbsp;
        <strong style={{ color: '#f59e0b' }}>Partial</strong> &mdash; proxy for the requested output &nbsp;&bull;&nbsp;
        <strong style={{ color: '#ef4444' }}>Blocked</strong> &mdash; needs data the dataset lacks
      </div>
    </div>
  )
}
