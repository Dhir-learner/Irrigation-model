import { useI18n } from '../i18n.jsx'

/* Single-stroke icon set (24px grid, currentColor). */
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  leaf: 'M5 21c0-9 6-15 16-16-1 10-7 16-16 16zm0 0 8-8',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  layers: 'm12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  shield: 'M12 21s8-4 8-10V5l-8-3-8 3v6c0 6 8 10 8 10z',
  clipboard: 'M9 4h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 13l2 2 4-4',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0v16m4-14h7',
  drop: 'M12 3c4 5 6.5 8.5 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 11.5 8 8 12 3z',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  pump: 'M4 20h16M6 20V9h6v11M12 13h4a2 2 0 0 1 2 2v5M9 9V5h6',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4m8-4v4',
  thermo: 'M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z',
  rain: 'M7 15a5 5 0 1 1 1-9.9A6 6 0 0 1 19 9a4 4 0 0 1-1 7.9M8 19l-1 2m5-3-1 2m5-3-1 2',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  check: 'M5 12l5 5L20 7',
  info: 'M12 16v-5m0-3h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5',
  collapse: 'M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-3.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  cube: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3zm0 9 8-4.5M12 12v9m0-9L4 7.5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  speaker: 'M4 9v6h4l5 4V5L8 9H4zm12 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4m0-11-6.8 4',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M4 20h16',
  refresh: 'M20 11a8 8 0 0 0-14.8-4M4 4v4h4m-4 5a8 8 0 0 0 14.8 4M20 20v-4h-4',
  arrowL: 'M15 18l-6-6 6-6',
  arrowR: 'm9 18 6-6-6-6',
  seed: 'M12 21v-8m0 0c0-4 3-7 7-7 0 4-3 7-7 7zm0 0c0-3-2.5-5.5-5.5-5.5 0 3 2.5 5.5 5.5 5.5z',
  flask: 'M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3',
  bolt: 'M13 3 4 14h7l-1 7 9-11h-7l1-7z',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4m8 2v4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
}

export function Icon({ name, size = 16, stroke = 1.8, className, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      <path d={PATHS[name] || PATHS.info} />
    </svg>
  )
}

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, icon, tag, tagTone, actions, children, foot, flush, className = '', style }) {
  return (
    <section className={'card ' + className} style={style}>
      {(title || actions || tag) && (
        <div className="card-header">
          <h2 className="card-title">
            {icon && <span className="ico"><Icon name={icon} size={14} /></span>}
            {title}
          </h2>
          <div className="row">
            {tag && <span className={'card-tag ' + (tagTone || '')}>{tag}</span>}
            {actions}
          </div>
        </div>
      )}
      <div className={'card-body' + (flush ? ' flush' : '')}>{children}</div>
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  )
}

export function Stat({ label, value, delta, icon, tone, valueTone, children }) {
  const color = tone ? `var(--${tone})` : undefined
  return (
    <div className="stat" style={color ? { '--tone': color } : undefined}>
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon"><Icon name={icon} size={15} /></span>}
      </div>
      <div className={'stat-value' + (valueTone ? ' tone-' + valueTone : '')}>{value ?? '—'}</div>
      {delta && <div className="stat-delta">{delta}</div>}
      {children}
    </div>
  )
}

export const STATUS_VAR = { IRRIGATE_NOW: 'status-now', IRRIGATE_SOON: 'status-soon', NOT_REQUIRED: 'status-ok' }
export const STATUS_HEX = { IRRIGATE_NOW: '#f87171', IRRIGATE_SOON: '#fb923c', NOT_REQUIRED: '#4ade80' }
export const STATUS_ICON = { IRRIGATE_NOW: 'alert', IRRIGATE_SOON: 'clock', NOT_REQUIRED: 'check' }

export function StatusBadge({ status }) {
  const { t } = useI18n()
  return (
    <span className={'status-badge ' + status}>
      {status === 'IRRIGATE_NOW' ? <span className="pulse" aria-hidden="true" /> : <Icon name={STATUS_ICON[status]} size={14} stroke={2.4} />}
      {t('status.' + status)}
    </span>
  )
}

export function StatusLine({ status, short }) {
  const { t } = useI18n()
  return (
    <span className="status-line" style={{ color: `var(--${STATUS_VAR[status]})` }}>
      <span className="status-dot" style={{ background: 'currentColor' }} aria-hidden="true" />
      {t(short ? 'status.short.' + status : 'status.' + status)}
    </span>
  )
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(tb => (
        <button key={tb.id} role="tab" aria-selected={active === tb.id} className={'tab' + (active === tb.id ? ' active' : '')} onClick={() => onChange(tb.id)}>
          {tb.icon && <Icon name={tb.icon} size={15} />}
          {tb.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Tiny inline trend line; values only, no axes. */
export function Sparkline({ values, color = 'var(--accent)', height = 30, fill = true }) {
  if (!values || values.length < 2) return null
  const w = 120
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)])
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      {fill && <path d={`${d} L${w} ${height} L0 ${height} Z`} fill={color} opacity="0.12" />}
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Alert({ tone = 'info', children }) {
  const icon = { info: 'info', warn: 'alert', error: 'alert', success: 'check' }[tone]
  return (
    <div className={'alert ' + tone} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>{children}</div>
    </div>
  )
}

export const Skeleton = ({ height = 160, style }) => <div className="skeleton" style={{ height, ...style }} />
