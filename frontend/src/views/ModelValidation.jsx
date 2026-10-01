import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getValidation, getModelInfo } from '../api.js'

const SCHEMES = ['Random 5-fold', 'Leave-one-village-out', 'Leave-one-taluk-out']
const sci = v => (v == null ? '—' : Math.abs(v) < 0.001 ? Number(v).toExponential(1) : Number(v).toFixed(4))

function ImportanceChart({ rows }) {
  const data = rows.slice(0, 12).map(r => ({ feature: r.feature.replace(/_/g, ' '), importance: r.importance }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={{ fill: 'var(--text-2)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => (v * 100).toFixed(0) + '%'} />
        <YAxis type="category" dataKey="feature" tick={{ fill: 'var(--text-2)', fontSize: 11 }} axisLine={false} tickLine={false} width={150} />
        <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-md)', borderRadius: 8, fontSize: 12 }}
          cursor={{ fill: 'var(--bg-hover)' }} formatter={v => [(v * 100).toFixed(1) + '%', 'Share of importance']} />
        <Bar dataKey="importance" fill="#00c896" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function ModelValidation() {
  const { data, isLoading, error } = useQuery({ queryKey: ['validation'], queryFn: getValidation, retry: 0 })
  const { data: info } = useQuery({ queryKey: ['modelInfo'], queryFn: getModelInfo, staleTime: Infinity })
  const [featureSet, setFeatureSet] = useState('all features')

  const pivot = useMemo(() => {
    const rows = (data?.results || []).filter(r => r.feature_set === featureSet)
    const models = [...new Set(rows.map(r => r.model))]
    return models.map(model => ({
      model,
      cells: Object.fromEntries(SCHEMES.map(s => [s, rows.find(r => r.model === model && r.scheme === s)])),
    }))
  }, [data, featureSet])
  const featureSets = useMemo(() => [...new Set((data?.results || []).map(r => r.feature_set))], [data])

  const header = (
    <div className="page-header">
      <h1 className="page-title">Model Insights</h1>
      <p className="page-sub">How good is the soil-moisture model, really? Random splits versus villages and taluks it has never seen.</p>
    </div>
  )

  if (isLoading) return <>{header}<div className="skeleton" style={{ height: 300 }} /></>
  if (error) return (
    <div>
      {header}
      <div className="alert warn">
        {error.status === 404 ? 'No validation report yet. Run `python -m src.validation` from the project root.' : error.message}
      </div>
    </div>
  )

  const { summary } = data
  const tm = info?.test_metrics

  return (
    <div>
      {header}

      {summary?.finding && <div className="alert info mb-5"><strong>Finding:</strong> {summary.finding}</div>}

      <div className="stat-grid mb-5">
        {tm && (
          <div className="stat-tile">
            <div className="stat-label">Random hold-out R²</div>
            <div className="stat-value">{tm.r2.toFixed(4)}</div>
            <div className="stat-delta">optimistic: villages leak across the split</div>
          </div>
        )}
        <div className="stat-tile">
          <div className="stat-label">Unseen-village best R²</div>
          <div className={'stat-value' + (summary?.best_unseen_village_model?.r2 < 0 ? ' tone-danger' : '')}>{summary?.best_unseen_village_model?.r2?.toFixed(3) ?? '—'}</div>
          <div className="stat-delta">{summary?.best_unseen_village_model?.model} &middot; below 0 = worse than the mean</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Distinct target values</div>
          <div className="stat-value">{summary?.target_profile?.distinct_target_values ?? '—'}</div>
          <div className="stat-delta">across 1,000 farms</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Villages with a single value</div>
          <div className="stat-value">{summary?.target_profile?.villages_with_single_target_value ?? '—'} / {summary?.target_profile?.villages ?? '—'}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Target std</div>
          <div className="stat-value">{summary?.target_profile?.target_std?.toFixed(4) ?? '—'}</div>
          <div className="stat-delta">m³/m³</div>
        </div>
      </div>

      <div className="card mb-5">
        <div className="card-header">
          <span className="card-title">Error by validation scheme</span>
          <div className="segmented" role="radiogroup" aria-label="Feature set">
            {featureSets.map(fs => (
              <button key={fs} role="radio" aria-checked={featureSet === fs} className={featureSet === fs ? 'on' : ''} onClick={() => setFeatureSet(fs)}>{fs}</button>
            ))}
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Model</th>
                  {SCHEMES.map(s => <th key={s} colSpan={2} className="num group-head">{s}</th>)}
                </tr>
                <tr>{SCHEMES.map(s => [<th key={s + 'm'} className="num">MAE</th>, <th key={s + 'r'} className="num">R²</th>])}</tr>
              </thead>
              <tbody>
                {pivot.map(row => (
                  <tr key={row.model}>
                    <td className="font-bold">{row.model}</td>
                    {SCHEMES.map(s => {
                      const c = row.cells[s]
                      return [
                        <td key={s + 'm'} className="num">{sci(c?.mae)}</td>,
                        <td key={s + 'r'} className={'num ' + (c?.r2 < 0 ? 'tone-danger' : 'tone-ok')}>
                          {c ? Number(c.r2).toFixed(3) : '—'}{c?.r2 < 0 && <span className="visually-hidden"> (worse than mean)</span>}
                        </td>,
                      ]
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="card-foot text-muted text-xs">
            Negative R² means the model is worse than predicting the mean. Random splits leak village-level labels between train and test;
            leave-one-village-out is the honest test for a new village. This is why the dashboard prefers a probe reading and ranks the model value.
          </p>
        </div>
      </div>

      <div className="grid-2 gap-4">
        {info?.feature_importance?.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Global feature importance</span>
              <span className="card-tag">{info.model_name}</span>
            </div>
            <div className="card-body">
              <ImportanceChart rows={info.feature_importance} />
              <p className="text-muted text-xs mt-2">Location features (village, longitude) carry much of the weight: the model is largely recognising <em>where</em> a farm is.</p>
            </div>
          </div>
        )}
        {data.figure && (
          <div className="card">
            <div className="card-header"><span className="card-title">Validation figure</span></div>
            <div className="card-body">
              <img src={data.figure} alt="Bar chart comparing MAE for four models under random, leave-one-village-out and leave-one-taluk-out splits"
                style={{ width: '100%', borderRadius: 8, background: '#fff' }} onError={e => { e.currentTarget.hidden = true }} />
            </div>
          </div>
        )}
      </div>

      {info && (
        <div className="card mt-4">
          <div className="card-header"><span className="card-title">Model card</span></div>
          <div className="card-body">
            <dl className="kv-list">
              <dt>Model</dt><dd>{info.model_name}</dd>
              <dt>Target</dt><dd>{info.target}</dd>
              <dt>Trained</dt><dd>{new Date(info.training_date).toLocaleString('en-IN')}</dd>
              <dt>Inputs</dt><dd>{info.feature_list.join(', ')}</dd>
              <dt>Hold-out MAE</dt><dd>{sci(tm?.mae)} &middot; RMSE {sci(tm?.rmse)}</dd>
              <dt>Split</dt><dd>{info.split_strategy}</dd>
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
