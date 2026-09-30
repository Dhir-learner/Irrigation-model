import { useState } from 'react'
import { AppProviders } from './context.jsx'
import Topbar from './components/Topbar.jsx'
import Sidebar from './components/Sidebar.jsx'
import FarmDashboard from './views/FarmDashboard.jsx'
import FleetMap from './views/FleetMap.jsx'
import PumpScheduling from './views/PumpScheduling.jsx'
import ModelValidation from './views/ModelValidation.jsx'
import Coverage from './views/Coverage.jsx'
import ReviewLog from './views/ReviewLog.jsx'

const VIEWS = [
  { id: 'dashboard',  label: 'Farm Dashboard',   icon: 'home' },
  { id: 'fleet',      label: 'Fleet Map',         icon: 'map' },
  { id: 'schedule',   label: 'Pump Scheduling',   icon: 'clock' },
  { id: 'validation', label: 'Model Validation',  icon: 'bar-chart' },
  { id: 'coverage',   label: 'Use-case Coverage', icon: 'shield' },
  { id: 'reviews',    label: 'Review Log',        icon: 'clipboard' },
]

export default function App() {
  const [activeView, setActiveView] = useState('dashboard')
  const [language, setLanguage] = useState('en')
  const [farmSettings, setFarmSettings] = useState(null) // shared settings from dashboard

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':  return <FarmDashboard language={language} onSettingsChange={setFarmSettings} />
      case 'fleet':      return <FleetMap settings={farmSettings} />
      case 'schedule':   return <PumpScheduling settings={farmSettings} />
      case 'validation': return <ModelValidation />
      case 'coverage':   return <Coverage />
      case 'reviews':    return <ReviewLog />
      default:           return null
    }
  }

  return (
    <AppProviders>
      <Topbar
        language={language}
        onLanguageChange={setLanguage}
        activeView={activeView}
      />
      <div className="app-layout">
        <Sidebar views={VIEWS} activeView={activeView} onNavigate={setActiveView} settings={farmSettings} />
        <main className="main-content">
          {renderView()}
        </main>
      </div>
    </AppProviders>
  )
}
