/**
 * API helpers. By default calls go to the same origin (FastAPI serves /app and the API).
 * Set VITE_API_BASE (e.g. https://my-space.hf.space) to host the UI separately.
 */

const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

/** Turn a FastAPI error body into one readable sentence. */
function errorMessage(status, body) {
  const detail = body && typeof body === 'object' ? body.detail : body
  if (Array.isArray(detail)) {
    // pydantic validation errors: [{loc: [...], msg: '...'}]
    return detail.map(d => `${(d.loc || []).filter(x => x !== 'body').join('.')}: ${d.msg}`).join('; ')
  }
  if (typeof detail === 'string' && detail) return detail
  if (status === 503) return 'Model not available. Run `python -m src.train` on the server.'
  if (status >= 500) return `Server error (HTTP ${status}). Check the API logs.`
  return `Request failed (HTTP ${status})`
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function api(path, opts = {}) {
  let res
  try {
    res = await fetch(BASE + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the API server. Is uvicorn running?')
  }
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, body))
  return body
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const farmPath = (id, suffix = '') => {
  if (!id || !String(id).trim()) throw new ApiError(422, 'Select a farm first.')
  return `/farms/${encodeURIComponent(id)}${suffix}`
}
/** Drop null/undefined/'' so they are not sent as the literal string "undefined". */
const qs = (params = {}) => new URLSearchParams(
  Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
).toString()

export const getHealth        = ()          => api('/health')
export const getOptions       = ()          => api('/options')
export const getModelInfo     = ()          => api('/model-info')
export const getFarms         = ()          => api('/farms')
export const getFleet         = (params)    => api('/fleet?' + qs(params))
export const getFleetAnalytics = (params)   => api('/fleet/analytics?' + qs(params))
export const getFarm          = (id)        => api(farmPath(id))
export const getFarmPlan      = (id, body)  => post(farmPath(id, '/plan'), body)
export const postFarmWhatIf   = (id, body)  => post(farmPath(id, '/what-if'), body)
export const getValidation    = ()          => api('/validation')
export const getCoverage      = ()          => api('/coverage')
export const getFeedback      = ()          => api('/feedback?limit=500')
export const postFeedback     = (body)      => post('/feedback', body)
export const getFeederSchedule = (body)     => post('/feeder-schedule', body)
export const getFarmsGeoJSON  = (params)    => api('/farms/geojson?' + qs(params))

/** Client-side CSV download for any array of flat objects. */
export function downloadCSV(rows, filename) {
  if (!rows || rows.length === 0) return
  const cols = Object.keys(rows[0])
  const esc = v => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
