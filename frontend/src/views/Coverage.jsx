import { useQuery } from '@tanstack/react-query'
import { getCoverage } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Card, PageHeader, Alert, Skeleton, Stat } from '../components/ui.jsx'

const STATUS_TONE = { Implemented: 'ok', 'ML model': 'water', 'Rule-based': 'accent', Partial: 'status-soon', Blocked: 'status-now' }

function Chip({ status }) {
  const { t } = useI18n()
  const tone = STATUS_TONE[status] || 'accent'
  return (
    <span className="card-tag" style={{ color: `var(--${tone})`, borderColor: `color-mix(in srgb, var(--${tone}) 35%, transparent)`, background: `color-mix(in srgb, var(--${tone}) 10%, transparent)` }}>
      {t('coverage.statusName.' + status)}
    </span>
  )
}

export default function Coverage() {
  const { t } = useI18n()
  const { data, isLoading, error } = useQuery({ queryKey: ['coverage'], queryFn: getCoverage, staleTime: Infinity })
  const header = <PageHeader eyebrow={t('nav.groupInsight')} title={t('coverage.title')} subtitle={t('coverage.subtitle')} />
  if (isLoading) return <>{header}<Skeleton height={400} /></>
  if (error) return <>{header}<Alert tone="error">{error.message}</Alert></>

  // The API serves English; translated rows come from the locale (same order as src/coverage.py).
  const tr = t('coverageData')
  const models = (data?.models || []).map((m, i) => ({ ...m, ...(tr?.models?.[i] ? { use_case_model: tr.models[i].name, implementation: tr.models[i].impl, limitation: tr.models[i].limit } : {}) }))
  const workflow = (data?.workflow || []).map((w, i) => ({ ...w, ...(tr?.workflow?.[i] || {}) }))
  const counts = models.reduce((a, m) => ((a[m.status] = (a[m.status] || 0) + 1), a), {})

  return (
    <>
      {header}
      <div className="stat-grid mb-5">
        {Object.entries(counts).map(([s, n]) => <Stat key={s} label={t('coverage.statusName.' + s)} value={n} tone={STATUS_TONE[s]} delta={t('coverage.keyText.' + s)} />)}
      </div>
      <Card title={t('coverage.models')} icon="shield" tag={t('coverage.nModels', { n: models.length })} flush className="mb-5">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th style={{ minWidth: 200 }}>{t('coverage.col.model')}</th><th>{t('coverage.col.status')}</th><th style={{ minWidth: 260 }}>{t('coverage.col.impl')}</th><th style={{ minWidth: 200 }}>{t('coverage.col.evidence')}</th><th style={{ minWidth: 220 }}>{t('coverage.col.limit')}</th></tr></thead>
            <tbody>
              {models.map((m, i) => (
                <tr key={i}>
                  <td className="strong">{m.use_case_model}</td>
                  <td><Chip status={m.status} /></td>
                  <td className="sub">{m.implementation}</td>
                  <td className="mono xs muted" style={{ fontWeight: 400 }}>{m.evidence}</td>
                  <td className="sub">{m.limitation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={t('coverage.workflow')} icon="layers" tag={t('coverage.nStages', { n: workflow.length })}>
        <div className="steps">
          {workflow.map((w, i) => (
            <div key={i} className="step"><h4>{w.stage.replace(/^\d+\.\s*/, '')}</h4><p>{w.provides}</p></div>
          ))}
        </div>
      </Card>
    </>
  )
}
