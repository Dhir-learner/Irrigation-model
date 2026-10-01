import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppProviders } from './context.jsx'
import { getOptions } from './api.js'
import Topbar from './components/Topbar.jsx'
import Sidebar from './components/Sidebar.jsx'
import FarmDashboard from './views/FarmDashboard.jsx'
import FleetMap from './views/FleetMap.jsx'
import Analytics from './views/Analytics.jsx'
import PumpScheduling from './views/PumpScheduling.jsx'
import ModelValidation from './views/ModelValidation.jsx'
import Coverage from './views/Coverage.jsx'
import ReviewLog from './views/ReviewLog.jsx'

const VIEWS = [
  { id: 'dashboard',  label: 'Farm Dashboard',   icon: 'home' },
  { id: 'fleet',      label: 'Fleet Map',         icon: 'map' },
  { id: 'analytics',  label: 'Fleet Analytics',   icon: 'trend' },
  { id: 'schedule',   label: 'Pump Scheduling',   icon: 'clock' },
  { id: 'validation', label: 'Model Insights',    icon: 'bar-chart' },
  { id: 'coverage',   label: 'Use-case Coverage', icon: 'shield' },
  { id: 'reviews',    label: 'Review Log',        icon: 'clipboard' },
]

const isoDaysAgo = days => new Date(Date.now() - days * 864e5).toISOString().split('T')[0]

const DEFAULT_SETTINGS = {
  farmId: '',
  plantingDate: isoDaysAgo(180),
  soilType: '',
  method: '',
  pumpFlow: '',
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('aqua.settings') || '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function viewFromHash() {
  const id = window.location.hash.replace('#', '')
  return VIEWS.some(v => v.id === id) ? id : 'dashboard'
}

export default function App() {
  const [activeView, setActiveView] = useState(viewFromHash)
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem('aqua.lang') || 'en' } catch { return 'en' }
  })
  const [settings, setSettings] = useState(loadSettings)
  const { data: opts } = useQuery({ queryKey: ['options'], queryFn: getOptions, staleTime: Infinity })

  // Fill equipment defaults from the server once options arrive.
  useEffect(() => {
    if (!opts) return
    setSettings(s => ({
      ...s,
      soilType: opts.soils?.includes(s.soilType) ? s.soilType : opts.default_soil,
      method: opts.methods && s.method in opts.methods ? s.method : opts.default_method,
      pumpFlow: s.pumpFlow || opts.default_pump_flow_m3h,
    }))
  }, [opts])

  useEffect(() => {
    try { localStorage.setItem('aqua.settings', JSON.stringify(settings)) } catch { /* ignore */ }
  }, [settings])
  useEffect(() => {
    try { localStorage.setItem('aqua.lang', language) } catch { /* ignore */ }
  }, [language])

  useEffect(() => {
    const onHash = () => setActiveView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback(id => {
    window.location.hash = id
    setActiveView(id)
    document.querySelector('.main-content')?.scrollTo?.({ top: 0 })
  }, [])

  const updateSettings = useCallback(patch => setSettings(s => ({ ...s, ...patch })), [])

  const cropAge = useMemo(() => {
    const t = new Date(settings.plantingDate).getTime()
    return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : 180
  }, [settings.plantingDate])

  const shared = { ...settings, cropAge }

  const openFarm = useCallback(farmId => {
    updateSettings({ farmId })
    navigate('dashboard')
  }, [updateSettings, navigate])

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':  return <FarmDashboard language={language} settings={shared} onSettingsChange={updateSettings} />
      case 'fleet':      return <FleetMap settings={shared} onOpenFarm={openFarm} />
      case 'analytics':  return <Analytics settings={shared} onOpenFarm={openFarm} />
      case 'schedule':   return <PumpScheduling settings={shared} />
      case 'validation': return <ModelValidation />
      case 'coverage':   return <Coverage />
      case 'reviews':    return <ReviewLog onOpenFarm={openFarm} />
      default:           return null
    }
  }

  return (
    <AppProviders>
      <Topbar language={language} onLanguageChange={setLanguage} />
      <div className="app-layout">
        <Sidebar views={VIEWS} activeView={activeView} onNavigate={navigate} settings={shared} />
        <main className="main-content">
          {renderView()}
        </main>
      </div>
    </AppProviders>
  )
}
