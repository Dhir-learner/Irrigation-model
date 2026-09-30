/** API helpers — all calls go to the same origin (FastAPI serves /app and all /... routes) */

const BASE = import.meta.env.DEV ? '' : ''

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return res.json()
}

export const getOptions   = ()           => api('/options')
export const getFarms     = ()           => api('/farms')
export const getFleet     = (params)     => api('/fleet?' + new URLSearchParams(params))
export const getFarm      = (id)         => api(`/farms/${encodeURIComponent(id)}`)
export const getFarmPlan  = (id, body)   => api(`/farms/${encodeURIComponent(id)}/plan`, { method: 'POST', body: JSON.stringify(body) })
export const getValidation = ()          => api('/validation')
export const getCoverage  = ()           => api('/coverage')
export const getFeedback  = ()           => api('/feedback?limit=200')
export const postFeedback = (body)       => api('/feedback', { method: 'POST', body: JSON.stringify(body) })
export const postWhatIf   = (body)       => api('/what-if',  { method: 'POST', body: JSON.stringify(body) })
export const getFeederSchedule = (body)  => api('/feeder-schedule', { method: 'POST', body: JSON.stringify(body) })
export const getFarmsGeoJSON = (params)  => api('/farms/geojson?' + new URLSearchParams(params))
