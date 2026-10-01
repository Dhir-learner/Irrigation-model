import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getValidation, getModelInfo } from '../api.js'
import { useI18n, featureLabel } from '../i18n.jsx'
import { TOOLTIP } from '../components/Charts.jsx'
import { Card, Stat, PageHeader, Segmented, Alert, Skeleton, Icon } from '../components/ui.jsx'

const SCHEMES = ['Random 5-fold', 'Leave-one-village-out', 'Leave-one-taluk-out']
const sci = v => (v == null ? '—' : Math.abs(v) < 0.001 ? Number(v).toExponential(1) : Number(v).toFixed(4))

export default function ModelValidation() {
  const { t, fmtNum, fmtDate } = useI18n()
  const { data, isLoading, error } = useQuery({ queryKey: ['validation'], queryFn: getValidation, retry: 0 })
  const { data: info } = useQuery({ queryKey: ['modelInfo'], queryFn: getModelInfo, staleTime: Infinity })
  const [featureSet, setFeatureSet] = useState('all features')

  const featureSets = useMemo(() => [...new Set((data?.results || []).map(r => r.feature_set))], [data])
  const pivot = useMemo(() => {
    const rows = (data?.results || []).filter(r => r.feature_set === featureSet)
    return [...new Set(rows.map(r => r.model))].map(model => ({ model, cells: Object.fromEntries(SCHEMES.map(s => [s, rows.find(r => r.model === model && r.scheme === s)])) }))
  }, [data, featureSet])

  const header = <PageHeader eyebrow={t('nav.groupInsight')} title={t('model.title')} subtitle={t('model.subtitle')} />
  if (isLoading) return <>{header}<Skeleton height={320} /></>
  if (error) return <>{header}<Alert tone="warn">{error.status === 404 ? t('model.noReport') : error.message}</Alert></>

  const { summary } = data
  const tm = info?.test_metrics
  const best = summary?.best_unseen_village_model
  const importance = (info?.feature_importance || []).slice(0, 12).map(r => ({ feature: featureLabel(t, r.feature), importance: r.importance }))

  return (
    <>
      {header}
      <div className="callout mb-5"><Icon name="info" size={18} /><div><strong>{t('model.finding')}:</strong> {t('model.findingText')}</div></div>

      <div className="stat-grid mb-5">
        {tm && <Stat label={t('model.holdout')} icon="check" tone="accent" value={fmtNum(tm.r2, 4)} delta={t('model.holdoutNote')} />}
        <Stat label={t('model.unseen')} icon="alert" tone="status-now" value={best ? fmtNum(best.r2, 3) : '—'} valueTone={best?.r2 < 0 ? 'danger' : undefined} delta={best && t('model.unseenNote', { m: best.model })} />
        <Stat label={t('model.distinct')} icon="layers" value={summary?.target_profile?.distinct_target_values ?? '—'} delta={t('model.distinctNote')} />
        <Stat label={t('model.single')} icon="map" tone="status-soon" value={`${summary?.target_profile?.villages_with_single_target_value ?? '—'} / ${summary?.target_profile?.villages ?? '—'}`} />
        <Stat label={t('model.std')} icon="chart" tone="water" value={fmtNum(summary?.target_profile?.target_std, 4)} delta="m³/m³" />
      </div>

      <Card title={t('model.byScheme')} icon="chart" flush className="mb-5" foot={t('model.schemeNote')}
        actions={<Segmented value={featureSet} onChange={setFeatureSet} options={featureSets.map(fs => ({ value: fs, label: t('model.featureSets.' + fs) }))} />}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th rowSpan={2}>{t('model.model')}</th>{SCHEMES.map(s => <th key={s} colSpan={2} className="group">{t('model.schemes.' + s)}</th>)}</tr>
              <tr>{SCHEMES.flatMap(s => [<th key={s + 'm'} className="num">MAE</th>, <th key={s + 'r'} className="num">R²</th>])}</tr>
            </thead>
            <tbody>
              {pivot.map(row => (
                <tr key={row.model}>
                  <td className="strong">{row.model}</td>
                  {SCHEMES.flatMap(s => {
                    const c = row.cells[s]
                    return [
                      <td key={s + 'm'} className="num">{sci(c?.mae)}</td>,
                      <td key={s + 'r'} className={'num strong ' + (c?.r2 < 0 ? 'tone-danger' : 'tone-ok')}>{c ? Number(c.r2).toFixed(3) : '—'}</td>,
                    ]
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid-2 mb-5">
        {importance.length > 0 && (
          <Card title={t('model.importance')} icon="trend" tag={info.model_name} foot={t('model.importanceNote')}>
            <ResponsiveContainer width="100%" height={Math.max(240, importance.length * 26)}>
              <BarChart data={importance} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <defs><linearGradient id="impGrad" x1="0" x2="1"><stop offset="0" stopColor="#19d39b" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${Math.round(v * 100)}%`} />
                <YAxis type="category" dataKey="feature" tick={{ fill: 'var(--text-2)', fontSize: 11 }} axisLine={false} tickLine={false} width={160} />
                <Tooltip {...TOOLTIP} formatter={v => [`${fmtNum(v * 100, 1)}%`, t('model.share')]} />
                <Bar dataKey="importance" fill="url(#impGrad)" radius={[0, 5, 5, 0]} maxBarSize={16} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
        {data.figure && (
          <Card title={t('model.figure')} icon="chart">
            <img src={data.figure} alt={t('model.byScheme')} style={{ width: '100%', borderRadius: 10, background: '#fff' }} onError={e => { e.currentTarget.hidden = true }} />
          </Card>
        )}
      </div>

      {info && (
        <Card title={t('model.card')} icon="clipboard">
          <dl className="kv">
            <dt>{t('model.cardModel')}</dt><dd>{info.model_name}</dd>
            <dt>{t('model.cardTarget')}</dt><dd>{info.target}</dd>
            <dt>{t('model.cardTrained')}</dt><dd>{fmtDate(info.training_date, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
            <dt>{t('model.cardInputs')}</dt><dd>{info.feature_list.map(f => featureLabel(t, f)).join(', ')}</dd>
            <dt>{t('model.cardMae')}</dt><dd>{sci(tm?.mae)} · RMSE {sci(tm?.rmse)}</dd>
            <dt>{t('model.cardSplit')}</dt><dd className="sub">{info.split_strategy}</dd>
          </dl>
        </Card>
      )}
    </>
  )
}
