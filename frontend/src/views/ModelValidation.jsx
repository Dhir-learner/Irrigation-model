import { useQuery } from '@tanstack/react-query'
import { getValidation } from '../api.js'

export default function ModelValidation() {
  const { data, isLoading, error } = useQuery({ queryKey: ['validation'], queryFn: getValidation, retry: 0 })

  if (isLoading) return <div className="skeleton" style={{ height: 300 }} />

  if (error) return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Model Validation</h1>
        <p className="page-sub">Does the soil-moisture model generalise to a village it has never seen?</p>
      </div>
      <div className="alert warn">
        {error.message.includes('404')
          ? 'Run python -m src.validation from the project root to generate spatial validation results first.'
          : error.message}
      </div>
    </div>
  )

  const { summary, results } = data || {}

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Model Validation</h1>
        <p className="page-sub">Spatial leave-one-village-out validation of the soil-moisture ML model.</p>
      </div>

      {summary?.finding && (
        <div className="card mb-5">
          <div className="card-body">
            <div className="alert info" style={{ marginBottom: 0 }}>
              <strong>Finding:</strong> {summary.finding}
            </div>
          </div>
        </div>
      )}

      {summary && (
        <div className="stat-grid mb-5">
          <div className="stat-tile">
            <div className="stat-label">Distinct soil-moisture values</div>
            <div className="stat-value">{summary.target_profile?.distinct_target_values ?? '\u2014'}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Villages with one value only</div>
            <div className="stat-value">
              {summary.target_profile?.villages_with_single_target_value ?? '\u2014'}
              {' / '}
              {summary.target_profile?.villages ?? '\u2014'}
            </div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Unseen-village baseline MAE</div>
            <div className="stat-value">{summary.unseen_village_mean_baseline_mae?.toFixed(4) ?? '\u2014'}</div>
          </div>
        </div>
      )}

      <div className="grid-2 gap-4">
        {data?.figure && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Error by validation scheme</span>
            </div>
            <div className="card-body">
              <img
                src={data.figure}
                alt="Bar chart comparing MAE for four models under random, leave-one-village-out, and leave-one-taluk-out splits"
                style={{ width: '100%', borderRadius: 8 }}
                onError={e => { e.target.style.display = 'none' }}
              />
            </div>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">All results</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Model</th><th>Split</th><th>MAE</th><th>RMSE</th><th>R&sup2;</th></tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{r.model}</td>
                        <td>{r.split || r.validation_scheme || '\u2014'}</td>
                        <td>{Number(r.mae).toFixed(5)}</td>
                        <td>{Number(r.rmse).toFixed(5)}</td>
                        <td style={{ color: r.r2 < 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                          {Number(r.r2).toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="alert info mt-4">
        A negative R&sup2; means the model is worse than predicting the mean. Random splits leak village-level labels between train and test &mdash; leave-one-village-out is the honest deployment test.
      </div>
    </div>
  )
}
