import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../api.js'
import { useTheme } from '../context.jsx'
import { useI18n, LANGUAGE_NAMES } from '../i18n.jsx'
import { Icon } from './ui.jsx'

export default function Topbar({ title, onMenu }) {
  const { theme, toggleTheme } = useTheme()
  const { t, lang, setLang, fmtDate } = useI18n()
  const { data: health, error } = useQuery({ queryKey: ['health'], queryFn: getHealth, refetchInterval: 60000, retry: 0 })
  const state = error ? 'down' : !health ? 'pending' : health.model_available ? 'ok' : 'warn'
  const label = { ok: t('topbar.apiOk'), warn: t('topbar.apiWarn'), down: t('topbar.apiDown'), pending: t('topbar.apiPending') }[state]

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label={t('nav.menu')}><Icon name="menu" /></button>
      <div className="brand">
        <div className="brand-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8.5 8 5 12 5 16a7 7 0 0 0 14 0c0-4-3.5-8-7-14z" /></svg></div>
        <div className="brand-text">
          <span className="brand-name">{t('app.name')}</span>
          <span className="brand-sub">{t('app.tagline')}</span>
        </div>
      </div>
      <div className="topbar-title"><span className="muted">/</span><strong>{title}</strong></div>
      <div className="topbar-right">
        <span className={`chip api-status ${state}`} title={error?.message || (health?.model_name ? `${label} · ${health.model_name}` : label)}>
          <span className="dot" aria-hidden="true" /><span className="hide-sm">{label}</span>
        </span>
        <span className="chip hide-md">{fmtDate(new Date().toISOString(), { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        <label>
          <span className="visually-hidden">{t('topbar.language')}</span>
          <select className="lang-select" value={lang} onChange={e => setLang(e.target.value)}>
            {Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? t('topbar.toLight') : t('topbar.toDark')} title={theme === 'dark' ? t('topbar.toLight') : t('topbar.toDark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  )
}
