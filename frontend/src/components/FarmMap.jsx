import { MapContainer, TileLayer, GeoJSON, ScaleControl, useMap } from 'react-leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { useI18n } from '../i18n.jsx'
import { Icon, Segmented, STATUS_HEX } from './ui.jsx'

export const STATUS_COLOR = STATUS_HEX

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_ATTR = 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
const BASES = {
  satellite: [{ url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTR, maxNativeZoom: 18 }],
  hybrid: [
    { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTR, maxNativeZoom: 18 },
    { url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, attribution: '', maxNativeZoom: 18, opacity: 0.85 },
    { url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, attribution: '', maxNativeZoom: 18 },
  ],
  streets: [{ url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors', maxNativeZoom: 19 }],
  terrain: [{ url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, attribution: 'Tiles &copy; Esri', maxNativeZoom: 18 }],
}

// Single-hue sequential ramps (light → dark) for magnitude; status keeps its own reserved colours.
const RAMPS = {
  ndvi: ['#f7fcb9', '#d9f0a3', '#addd8e', '#78c679', '#41ab5d', '#238443', '#005a32'],
  wetness: ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
}
function rampColor(ramp, x) {
  const v = Math.min(1, Math.max(0, x))
  return ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))]
}

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function coordsOf(geom) {
  if (!geom) return []
  if (geom.type === 'Point') return [geom.coordinates]
  if (geom.type === 'Polygon') return geom.coordinates.flat()
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2)
  return []
}
function boundsOf(features) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const f of features) for (const [lng, lat] of coordsOf(f.geometry)) {
    if (lat < a) a = lat; if (lat > c) c = lat; if (lng < b) b = lng; if (lng > d) d = lng
  }
  return Number.isFinite(a) ? [[a, b], [c, d]] : null
}

/** Imperative map actions: fit on data change, re-measure on fullscreen. */
function MapController({ features, focusId, focusSelected, command, fullscreen }) {
  const map = useMap()
  const fit = (onlyFocus) => {
    const target = onlyFocus && focusId ? features.filter(f => f.properties?.farm_id === focusId) : features
    const bounds = boundsOf(target.length ? target : features)
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: onlyFocus && focusId ? 17 : 15, animate: true })
  }
  useEffect(() => { fit(focusSelected) }, [features, focusId, focusSelected]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (command) fit(command.type === 'focus') }, [command]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = setTimeout(() => map.invalidateSize(), 220); return () => clearTimeout(id) }, [fullscreen, map])
  return null
}

function storedBase() {
  try { return localStorage.getItem('aqua.basemap') || 'satellite' } catch { return 'satellite' }
}

export default function FarmMap({
  geojson, fleetData, onFarmClick, selectedId, focusSelected = false, height = 440,
  colorBy: colorByProp, showColorBy = true, farmsMeta,
}) {
  const { t, fmtDate, fmtNum, lang } = useI18n()
  const [base, setBase] = useState(storedBase)
  const [colorBy, setColorBy] = useState(colorByProp || 'status')
  const [fullscreen, setFullscreen] = useState(false)
  const [command, setCommand] = useState(null)
  const shellRef = useRef(null)

  useEffect(() => { try { localStorage.setItem('aqua.basemap', base) } catch { /* ignore */ } }, [base])
  useEffect(() => {
    if (!fullscreen) return
    const onKey = e => e.key === 'Escape' && setFullscreen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const byId = useMemo(() => {
    const m = {}
    ;(fleetData || []).forEach(f => { m[f.farm_id] = { ...m[f.farm_id], ...f } })
    ;(farmsMeta || []).forEach(f => { m[f.farm_id] = { ...m[f.farm_id], ndvi: f.ndvi } })
    return m
  }, [fleetData, farmsMeta])

  const ndviRange = useMemo(() => {
    const v = Object.values(byId).map(f => f.ndvi).filter(x => x != null)
    return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1]
  }, [byId])

  const features = geojson?.features || []
  const layerKey = useMemo(() => {
    let h = features.length
    for (const f of fleetData || []) h = (h * 31 + f.status.length + (f.due_day || 0)) % 1e9
    return `${h}-${selectedId || ''}-${colorBy}-${lang}`
  }, [features, fleetData, selectedId, colorBy, lang])

  const fillFor = d => {
    if (!d) return '#7dd3fc'
    if (colorBy === 'ndvi' && d.ndvi != null) return rampColor(RAMPS.ndvi, (d.ndvi - ndviRange[0]) / ((ndviRange[1] - ndviRange[0]) || 1))
    if (colorBy === 'wetness' && d.relative_wetness != null) return rampColor(RAMPS.wetness, d.relative_wetness)
    return STATUS_COLOR[d.status] || '#7dd3fc'
  }

  const styleFeature = feature => {
    const id = feature.properties?.farm_id
    const color = fillFor(byId[id])
    const selected = id === selectedId
    return { fillColor: color, color: selected ? '#ffffff' : color, weight: selected ? 3.5 : 1.4, fillOpacity: selected ? 0.8 : 0.55, opacity: 1 }
  }

  const onEachFeature = (feature, layer) => {
    const p = feature.properties || {}
    const d = byId[p.farm_id]
    const lines = []
    if (d?.status) lines.push(`<span style="color:${STATUS_COLOR[d.status]};font-weight:700">● ${escapeHtml(t('status.' + d.status))}</span>`)
    if (d?.next_irrigation_date) lines.push(`${escapeHtml(t('map.nextIrrigation'))}: <b>${escapeHtml(fmtDate(d.next_irrigation_date))}</b>`)
    if (d?.hours != null) lines.push(`${escapeHtml(t('map.pump'))}: <b>${fmtNum(d.hours, 1)} h</b>`)
    if (d?.ndvi != null) lines.push(`NDVI: <b>${fmtNum(d.ndvi, 2)}</b>`)
    layer.bindTooltip(`<b>${escapeHtml(p.farm_id)}</b>`, { sticky: true, direction: 'top' })
    layer.bindPopup(`<div style="min-width:180px;line-height:1.6">
      <div style="font-family:var(--font-mono);font-weight:700;font-size:13px">${escapeHtml(p.farm_id)}</div>
      <div style="color:var(--text-2);margin-bottom:4px">${escapeHtml(p.village)}, ${escapeHtml(p.taluk)}</div>
      ${lines.join('<br/>')}
      ${onFarmClick ? `<div style="margin-top:6px;font-size:11px;color:var(--text-3)">${escapeHtml(t('map.clickHint'))}</div>` : ''}</div>`)
    if (onFarmClick) layer.on('click', () => onFarmClick(p.farm_id))
  }

  const legend = colorBy === 'status'
    ? (
      <div className="map-legend map-glass">
        {Object.keys(STATUS_COLOR).map(k => (
          <div className="row" key={k}><span className="swatch" style={{ background: STATUS_COLOR[k] }} />{t('status.' + k)}</div>
        ))}
      </div>
    )
    : (
      <div className="map-legend map-glass">
        <strong style={{ fontSize: '0.74rem' }}>{t(colorBy === 'ndvi' ? 'map.byNdvi' : 'map.byWetness')}</strong>
        <div className="ramp" style={{ background: `linear-gradient(90deg, ${RAMPS[colorBy].join(',')})` }} />
        <div className="ends">
          <span>{colorBy === 'ndvi' ? fmtNum(ndviRange[0], 2) : t('map.legendLow')}</span>
          <span>{colorBy === 'ndvi' ? fmtNum(ndviRange[1], 2) : t('map.legendHigh')}</span>
        </div>
      </div>
    )

  return (
    <div ref={shellRef} className={'map-shell' + (fullscreen ? ' fullscreen' : '')} style={{ height }}>
      <MapContainer center={[12.52, 76.75]} zoom={10} maxZoom={20} style={{ height: '100%', width: '100%' }} scrollWheelZoom zoomControl>
        {BASES[base].map((layer, i) => (
          <TileLayer key={base + i} url={layer.url} attribution={layer.attribution} maxNativeZoom={layer.maxNativeZoom} maxZoom={20} opacity={layer.opacity ?? 1} />
        ))}
        <ScaleControl position="bottomright" imperial={false} />
        {features.length > 0 && (
          <>
            <GeoJSON key={layerKey} data={geojson} style={styleFeature} onEachFeature={onEachFeature} />
            <MapController features={features} focusId={selectedId} focusSelected={focusSelected} command={command} fullscreen={fullscreen} />
          </>
        )}
      </MapContainer>

      <div className="map-toolbar">
        <div className="map-glass map-row">
          <Segmented label={t('map.satellite')} value={base} onChange={setBase} options={[
            { value: 'satellite', label: t('map.satellite') },
            { value: 'hybrid', label: t('map.hybrid') },
            { value: 'streets', label: t('map.streets') },
            { value: 'terrain', label: t('map.terrain') },
          ]} />
        </div>
        <div className="map-glass map-row">
          {showColorBy && (
            <select value={colorBy} onChange={e => setColorBy(e.target.value)} aria-label={t('map.colorBy')}>
              <option value="status">{t('map.byStatus')}</option>
              <option value="ndvi">{t('map.byNdvi')}</option>
              {fleetData?.some(f => f.relative_wetness != null) && <option value="wetness">{t('map.byWetness')}</option>}
            </select>
          )}
          {selectedId && <button className="map-btn" title={t('map.focus')} aria-label={t('map.focus')} onClick={() => setCommand({ type: 'focus', n: Date.now() })}><Icon name="target" /></button>}
          <button className="map-btn" title={t('map.fitAll')} aria-label={t('map.fitAll')} onClick={() => setCommand({ type: 'all', n: Date.now() })}><Icon name="globe" /></button>
          <button className="map-btn" title={t(fullscreen ? 'map.collapse' : 'map.expand')} aria-label={t(fullscreen ? 'map.collapse' : 'map.expand')} onClick={() => setFullscreen(f => !f)}>
            <Icon name={fullscreen ? 'collapse' : 'expand'} />
          </button>
        </div>
      </div>
      {legend}
    </div>
  )
}
