import { useQuery } from '@tanstack/react-query'
import { getFarms } from '../api.js'

const ICONS = {
  trend: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
      <polyline points="16 7 22 7 22 13"/>
    </svg>
  ),
  home: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  ),
  map: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/>
      <line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  ),
  clock: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  'bar-chart': (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
      <line x1="2"  y1="20" x2="22" y2="20"/>
    </svg>
  ),
  shield: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  clipboard: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    </svg>
  ),
}

export default function Sidebar({ views, activeView, onNavigate, settings }) {
  const { data: farms = [] } = useQuery({ queryKey: ['farms'], queryFn: getFarms, staleTime: 300000 })
  const farm = farms.find(f => f.farm_id === settings?.farmId)
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <span className="sidebar-section-label">Views</span>

      {views.map(v => (
        <button
          key={v.id}
          data-view={v.id}
          className={`nav-link ${activeView === v.id ? 'active' : ''}`}
          onClick={() => onNavigate(v.id)}
          aria-current={activeView === v.id ? 'page' : undefined}
          title={v.label}
        >
          <span className="nav-icon">{ICONS[v.icon]}</span>
          <span>{v.label}</span>
        </button>
      ))}

      {farm && (
        <div className="sidebar-foot">
          <span className="sidebar-section-label" style={{ display: 'block', marginBottom: 8 }}>Active farm</span>
          <div className="sidebar-farm-card">
            <button className="sidebar-farm-id" onClick={() => onNavigate('dashboard')} title="Open farm dashboard">{farm.farm_id}</button>
            <div className="sidebar-farm-meta">
              {farm.village}, {farm.taluk}<br />
              Day {settings.cropAge} &middot; {settings.method} &middot; {settings.soilType?.replace(/_/g, ' ')}
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
