import { useQuery } from '@tanstack/react-query'
import { getOptions } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Card, PageHeader, Icon } from '../components/ui.jsx'
import { KcCurveChart } from '../components/Charts.jsx'

const STAGES = ['initial', 'development', 'mid', 'late']
const STAGE_ICON = { initial: 'seed', development: 'leaf', mid: 'sun', late: 'flask' }

export default function Guide({ settings }) {
  const { t, fmtNum } = useI18n()
  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })
  const days = opts?.stage_days
  let acc = 0
  const ranges = days ? STAGES.map(s => { const from = acc; acc += days[s]; return { s, from, to: acc } }) : []
  const current = ranges.find(r => settings.cropAge >= r.from && settings.cropAge < r.to)?.s ?? 'late'
  const steps = t('guide.steps')
  const terms = t('guide.terms')

  return (
    <>
      <PageHeader eyebrow={t('nav.groupFarm')} title={t('guide.title')} subtitle={t('guide.subtitle')} />

      <h2 className="card-title mb-3"><span className="ico"><Icon name="info" size={14} /></span>{t('guide.how')}</h2>
      <div className="steps mb-5">
        {Array.isArray(steps) && steps.map((s, i) => <div key={i} className="step"><h4>{s.t}</h4><p>{s.b}</p></div>)}
      </div>

      <div className="grid-main mb-5">
        <Card title={t('guide.stages')} icon="seed" tag={t('sidebar.day', { n: settings.cropAge })} tagTone="ok">
          <div className="stage-cards">
            {ranges.map(r => (
              <div key={r.s} className={'stage-card' + (r.s === current ? ' current' : '')}>
                <div className="row between"><h4>{t('stage.' + r.s)}</h4><Icon name={STAGE_ICON[r.s]} size={18} style={{ color: 'var(--accent)' }} /></div>
                <span className="meta">{t('guide.stageDays', { from: r.from, to: r.to })} · Kc {opts?.kc ? fmtNum(r.s === 'initial' ? opts.kc.initial : r.s === 'late' ? opts.kc.end : opts.kc.mid, 2) : ''}</span>
                <p>{t('guide.stageTips.' + r.s)}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t('dash.kcCurve')} icon="trend">
          <KcCurveChart stageDays={days} kc={opts?.kc} cropAge={settings.cropAge} height={240} />
          <div className="mt-3">
            {opts?.methods && Object.entries(opts.methods).map(([m, eff]) => (
              <div key={m} className="bullet" style={{ gridTemplateColumns: '110px 1fr 46px', marginBottom: 10 }}>
                <span className="name">{t('method.' + m)}</span>
                <div className="track"><span className="iqr" style={{ left: 0, width: `${eff * 100}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} /></div>
                <span className="val">{fmtNum(eff * 100)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title={t('guide.glossary')} icon="book" className="mb-5">
        <div className="glossary">
          {Array.isArray(terms) && terms.map(term => (
            <div key={term.k} className="term"><span className="k">{term.k}</span><span className="t">{term.t}</span><p>{term.b}</p></div>
          ))}
        </div>
      </Card>

      <Card title={t('guide.methods')} icon="drop" className="mb-5">
        <div className="glossary">
          {['drip', 'sprinkler', 'furrow', 'flood'].map(m => (
            <div key={m} className="term"><span className="t" style={{ marginLeft: 0 }}>{t('method.' + m)}</span><p>{t('guide.methodText.' + m)}</p></div>
          ))}
        </div>
      </Card>

      <div className="callout"><Icon name="alert" size={18} /><div>{t('guide.disclaimer')}</div></div>
    </>
  )
}
