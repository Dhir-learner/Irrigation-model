import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from './locales/en.js'
import kn from './locales/kn.js'
import hi from './locales/hi.js'
import mr from './locales/mr.js'

export const LOCALES = { en, kn, hi, mr }
export const LANGUAGE_NAMES = { en: 'English', kn: 'ಕನ್ನಡ', hi: 'हिंदी', mr: 'मराठी' }

const I18nCtx = createContext(null)

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict)
}

function interpolate(text, vars) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : m))
}

function storedLang() {
  try {
    const v = localStorage.getItem('aqua.lang')
    return v && LOCALES[v] ? v : 'en'
  } catch {
    return 'en'
  }
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(storedLang)

  useEffect(() => {
    document.documentElement.lang = lang
    try { localStorage.setItem('aqua.lang', lang) } catch { /* private mode */ }
  }, [lang])

  /** Translate a dotted key; falls back to English, then to the key itself. */
  const t = useCallback((key, vars) => {
    const hit = lookup(LOCALES[lang], key) ?? lookup(en, key)
    if (typeof hit !== 'string') return hit ?? key
    return interpolate(hit, vars)
  }, [lang])

  // Western digits everywhere so numbers match the advisory text and the API.
  const locale = `${lang}-IN-u-nu-latn`
  const fmtNum = useCallback((v, digits = 0) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
    return Number(v).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  }, [locale])
  const fmtDate = useCallback((iso, opts = { day: 'numeric', month: 'short' }) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? (iso ?? '—') : d.toLocaleDateString(locale, opts)
  }, [locale])

  const value = useMemo(() => ({ lang, setLang, t, fmtNum, fmtDate, locale }), [lang, t, fmtNum, fmtDate, locale])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export const useI18n = () => useContext(I18nCtx)

/** Human label for a raw model feature name, e.g. "Village_Laxmipura" or "Rainfall_mm". */
export function featureLabel(t, raw) {
  const name = String(raw).replace(/^\./, '')
  const m = name.match(/^(Village|Taluk)_(.+)$/)
  if (m) return `${t('feature.' + m[1])}: ${m[2].replace(/_/g, ' ')}`
  const hit = t('feature.' + name)
  return hit === 'feature.' + name ? name.replace(/_/g, ' ') : hit
}
