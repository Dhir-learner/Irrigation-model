import { useQuery } from '@tanstack/react-query'
import { getOptions } from '../api.js'
import { useTheme } from '../context.jsx'

const LANGS = { en: 'English', kn: '\u0C95\u0CA8\u0CCD\u0CA8\u0CA1', hi: '\u0939\u093F\u0902\u0926\u0940', mr: '\u092E\u0930\u093E\u0920\u0940' }

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)

const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>
)

export default function Topbar({ language, onLanguageChange }) {
  const { theme, toggleTheme } = useTheme()
  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short'
  })

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-logo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C8.5 8 5 12 5 16a7 7 0 0014 0c0-4-3.5-8-7-14z"/>
          </svg>
        </div>
        <div className="brand-text">
          <span className="brand-name">AquaAdvisory</span>
          <span className="brand-sub">K J Somaiya &middot; KIAAR</span>
        </div>
      </div>

      <div className="topbar-right">
        <div className="chip">{today}</div>
        <div className="chip">KJS-AGR-01</div>

        <label className="lang-select">
          <span className="visually-hidden">Advisory language</span>
          <select value={language} onChange={e => onLanguageChange(e.target.value)}>
            {Object.entries(LANGS).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>

        <button
          className="icon-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title="Toggle theme"
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  )
}
