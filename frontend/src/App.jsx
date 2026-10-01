import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppProviders } from './context.jsx'
import { useI18n } from './i18n.jsx'
import { getOptions } from './api.js'
import Topbar from './components/Topbar.jsx'
import Sidebar from './components/Sidebar.jsx'
import Overview from './views/Overview.jsx'
import FarmDashboard from './views/FarmDashboard.jsx'
import FleetMap from './views/FleetMap.jsx'
import Analytics from './views/Analytics.jsx'
import PumpScheduling from './views/PumpScheduling.jsx'
import ModelValidation from './views/ModelValidation.jsx'
import Coverage from './views/Coverage.jsx'
import ReviewLog from './views/ReviewLog.jsx'
import Guide from './views/Guide.jsx'

const GROUPS = [
  { id: 'farm', label: 'nav.groupFarm', views: [
    { id: 'overview', label: 'nav.overview', icon: 'home' },
    { id: 'dashboard', label: 'nav.dashboard', icon: 'leaf' },
    { id: 'guide', label: 'nav.guide', icon: 'book' },
  ] },
  { id: 'fleet', label: 'nav.groupFleet', views: [
    { id: 'fleet', label: 'nav.fleet', icon: 'map' },
    { id: 'analytics', label: 'nav.analytics', icon: 'trend' },
    { id: 'schedule', label: 'nav.schedule', icon: 'pump' },
  ] },
  { id: 'insight', label: 'nav.groupInsight', views: [
    { id: 'validation', label: 'nav.validation', icon: 'chart' },
    { id: 'coverage', label: 'nav.coverage', icon: 'shield' },
    { id: 'reviews', label: 'nav.reviews', icon: 'clipboard' },
  ] },
]
const VIEWS = GROUPS.flatMap(g => g.views)

const isoDaysAgo = days => new Date(Date.now() - days * 864e5).toISOString().split('T')[0]
const DEFAULT_SETTINGS = { farmId: '', plantingDate: isoDaysAgo(180), soilType: '', method: '', pumpFlow: '' }

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('aqua.settings') || '{}') } } catch { return DEFAULT_SETTINGS }
}
function viewFromHash() {
  const id = window.location.hash.replace('#', '')
  return VIEWS.some(v => v.id === id) ? id : 'overview'
}

function Shell() {
  const { t, lang } = useI18n()
  const [activeView, setActiveView] = useState(viewFromHash)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settings, setSettings] = useState(loadSettings)
  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })

  useEffect(() => {
    if (!opts) return
    setSettings(s => ({
      ...s,
      soilType: opts.soils?.includes(s.soilType) ? s.soilType : opts.default_soil,
      method: opts.methods && s.method in opts.methods ? s.method : opts.default_method,
      pumpFlow: s.pumpFlow || opts.default_pump_flow_m3h,
    }))
  }, [opts])
  useEffect(() => { try { localStorage.setItem('aqua.settings', JSON.stringify(settings)) } catch { /* ignore */ } }, [settings])
  useEffect(() => {
    const onHash = () => setActiveView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const current = VIEWS.find(v => v.id === activeView)
  useEffect(() => { document.title = `${t(current.label)} · ${t('app.name')}` }, [current, t, lang])

  const navigate = useCallback(id => {
    window.location.hash = id
    setActiveView(id)
    setMenuOpen(false)
    window.scrollTo({ top: 0 })
  }, [])
  const updateSettings = useCallback(patch => setSettings(s => ({ ...s, ...patch })), [])
  const cropAge = useMemo(() => {
    const ts = new Date(settings.plantingDate).getTime()
    return Number.isFinite(ts) ? Math.max(0, Math.floor((Date.now() - ts) / 864e5)) : 180
  }, [settings.plantingDate])
  const shared = { ...settings, cropAge }
  const openFarm = useCallback(farmId => { updateSettings({ farmId }); navigate('dashboard') }, [updateSettings, navigate])

  const view = {
    overview: <Overview settings={shared} onOpenFarm={openFarm} onNavigate={navigate} />,
    dashboard: <FarmDashboard settings={shared} onSettingsChange={updateSettings} />,
    guide: <Guide settings={shared} />,
    fleet: <FleetMap settings={shared} onOpenFarm={openFarm} />,
    analytics: <Analytics settings={shared} onOpenFarm={openFarm} />,
    schedule: <PumpScheduling settings={shared} />,
    validation: <ModelValidation />,
    coverage: <Coverage />,
    reviews: <ReviewLog onOpenFarm={openFarm} />,
  }[activeView]

  return (
    <>
      <div className="app-bg" aria-hidden="true" />
      <Topbar title={t(current.label)} onMenu={() => setMenuOpen(o => !o)} />
      <div className="app-layout">
        <Sidebar groups={GROUPS} activeView={activeView} onNavigate={navigate} settings={shared} open={menuOpen} />
        <div className={'scrim' + (menuOpen ? ' open' : '')} onClick={() => setMenuOpen(false)} aria-hidden="true" />
        <main className="main-content">
          <div className="page" key={activeView}>{view}</div>
        </main>
      </div>
    </>
  )
}

export default function App() {
  return (
    <AppProviders>
      <Shell />
    </AppProviders>
  )
}
