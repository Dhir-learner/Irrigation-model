import { createContext, useContext, useState, useCallback } from 'react'

const ToastCtx = createContext(null)
const ThemeCtx = createContext(null)

export function AppProviders({ children }) {
  const [toasts, setToasts] = useState([])
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  const toast = useCallback((msg, type = 'info') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', next)
      document.documentElement.setAttribute('data-theme', next)
      return next
    })
  }, [])

  // Apply on mount
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }

  return (
    <ThemeCtx.Provider value={{ theme, toggleTheme }}>
      <ToastCtx.Provider value={{ toast }}>
        {children}
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast alert ${t.type}`}>{t.msg}</div>
          ))}
        </div>
      </ToastCtx.Provider>
    </ThemeCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
export const useTheme = () => useContext(ThemeCtx)
