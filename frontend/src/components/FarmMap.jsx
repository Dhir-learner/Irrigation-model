import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import { useEffect, useMemo } from 'react'
import 'leaflet/dist/leaflet.css'

export const STATUS_COLOR = {
  IRRIGATE_NOW:  '#f87171',
  IRRIGATE_SOON: '#fb923c',
  NOT_REQUIRED:  '#4ade80',
}
const NEUTRAL = '#7dd3fc'
const SELECTED = '#e879f9'

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function geometryCoords(geom) {
  if (!geom) return []
  if (geom.type === 'Point') return [geom.coordinates]
  if (geom.type === 'Polygon') return geom.coordinates.flat()
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2)
  return []
}

/** Zoom to the plots whenever the set of features changes (no Leaflet global needed). */
function FitBounds({ features, focusId }) {
  const map = useMap()
  useEffect(() => {
    const focus = focusId && features.find(f => f.properties?.farm_id === focusId)
    const coords = (focus ? [focus] : features).flatMap(f => geometryCoords(f.geometry))
    if (coords.length === 0) return
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity
    for (const [lng, lat] of coords) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
    map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [24, 24], maxZoom: focus ? 16 : 15 })
  }, [features, focusId, map])
  return null
}

export default function FarmMap({ geojson, fleetData, onFarmClick, selectedId, focusSelected = false, height = 440 }) {
  const statusMap = useMemo(() => {
    const m = {}
    ;(fleetData || []).forEach(f => { m[f.farm_id] = f })
    return m
  }, [fleetData])

  const features = geojson?.features || []
  // Re-mount the layer when data or colouring changes; react-leaflet's GeoJSON does not restyle on prop change.
  const layerKey = useMemo(() => {
    let h = features.length
    for (const f of fleetData || []) h = (h * 31 + f.status.length + (f.due_day || 0)) % 1e9
    return `${h}-${selectedId || ''}`
  }, [features, fleetData, selectedId])

  const styleFeature = feature => {
    const id = feature.properties?.farm_id
    const fd = statusMap[id]
    const color = fd ? (STATUS_COLOR[fd.status] || NEUTRAL) : NEUTRAL
    const selected = id === selectedId
    return {
      fillColor: color,
      color: selected ? SELECTED : color,
      weight: selected ? 3 : 1.2,
      fillOpacity: selected ? 0.75 : 0.5,
      opacity: 0.95,
    }
  }

  const onEachFeature = (feature, layer) => {
    const p = feature.properties || {}
    const fd = statusMap[p.farm_id]
    const statusLine = fd
      ? `<span style="color:${STATUS_COLOR[fd.status] || NEUTRAL};font-weight:700">${escapeHtml(fd.status.replace(/_/g, ' '))}</span><br/>
         Next: ${escapeHtml(fd.next_irrigation_date || '—')}<br/>
         Pump: ${fd.hours != null ? Number(fd.hours).toFixed(1) + ' h' : '—'}`
      : ''
    layer.bindTooltip(`<strong>${escapeHtml(p.farm_id)}</strong>`, { sticky: true, direction: 'top' })
    layer.bindPopup(`
      <div style="font-family:Inter,sans-serif;min-width:170px;line-height:1.5">
        <strong>${escapeHtml(p.farm_id)}</strong><br/>
        ${escapeHtml(p.village)}, ${escapeHtml(p.taluk)}<br/>
        ${statusLine}
        ${onFarmClick ? '<div style="margin-top:6px;font-size:11px;opacity:.7">Click plot to open its advisory</div>' : ''}
      </div>`)
    if (onFarmClick) layer.on('click', () => onFarmClick(p.farm_id))
  }

  return (
    <div className="map-container" style={{ height }}>
      <MapContainer center={[12.52, 76.75]} zoom={10} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        {features.length > 0 && (
          <>
            <GeoJSON key={layerKey} data={geojson} style={styleFeature} onEachFeature={onEachFeature} />
            <FitBounds features={features} focusId={focusSelected ? selectedId : null} />
          </>
        )}
      </MapContainer>
    </div>
  )
}
