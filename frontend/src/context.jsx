import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'

const ToastCtx = createContext(null)
const ThemeCtx = createContext(null)

function storedTheme() {
  try { return localStorage.getItem('theme') || 'dark' } catch { return 'dark' }
}

export function AppProviders({ children }) {
  const [toasts, setToasts] = useState([])
  const [theme, setTheme] = useState(storedTheme)
  const nextId = useRef(0)

  const toast = useCallback((msg, type = 'info') => {
    const id = ++nextId.current
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* private mode */ }
  }, [theme])

  const toggleTheme = useCallback(() => setTheme(t => (t === 'dark' ? 'light' : 'dark')), [])

  return (
    <ThemeCtx.Provider value={{ theme, toggleTheme }}>
      <ToastCtx.Provider value={{ toast }}>
        {children}
        <div className="toast-container" role="status" aria-live="polite">
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
