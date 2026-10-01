import { useQuery } from '@tanstack/react-query'
import { getFarms } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Icon } from './ui.jsx'

export default function Sidebar({ groups, activeView, onNavigate, settings, open }) {
  const { t } = useI18n()
  const { data: farms = [] } = useQuery({ queryKey: ['farms'], queryFn: getFarms, staleTime: 300000 })
  const farm = farms.find(f => f.farm_id === settings?.farmId)
  return (
    <nav className={'sidebar' + (open ? ' open' : '')} aria-label="Main navigation">
      {groups.map(g => (
        <div key={g.id}>
          <div className="nav-group">{t(g.label)}</div>
          {g.views.map(v => (
            <button key={v.id} className={'nav-link' + (activeView === v.id ? ' active' : '')} aria-current={activeView === v.id ? 'page' : undefined} onClick={() => onNavigate(v.id)}>
              <span className="nav-icon"><Icon name={v.icon} size={15} /></span>
              <span>{t(v.label)}</span>
            </button>
          ))}
        </div>
      ))}
      <div className="sidebar-foot">
        {farm && (
          <button className="farm-pill" onClick={() => onNavigate('dashboard')} title={t('sidebar.open')}>
            <span className="label">{t('sidebar.activeFarm')}</span>
            <span className="id">{farm.farm_id}</span>
            {farm.village}, {farm.taluk}<br />
            {t('sidebar.day', { n: settings.cropAge })} · {t('method.' + settings.method)} · {t('soil.' + settings.soilType)}
          </button>
        )}
        <p className="sidebar-note">{t('app.prototype')}</p>
      </div>
    </nav>
  )
}
