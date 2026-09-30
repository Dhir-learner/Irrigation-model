import { MapContainer, TileLayer, GeoJSON, Popup, useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

const STATUS_COLOR = {
  IRRIGATE_NOW:  '#ef4444',
  IRRIGATE_SOON: '#f59e0b',
  NOT_REQUIRED:  '#22c55e',
}

function FitBounds({ features }) {
  const map = useMap()
  useEffect(() => {
    if (!features || features.length === 0) return
    try {
      const L = window.L || require('leaflet')
      // Collect all coordinates
      const coords = features.flatMap(f => {
        const geom = f.geometry
        if (!geom) return []
        if (geom.type === 'Point') return [geom.coordinates]
        if (geom.type === 'Polygon') return geom.coordinates.flat()
        if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2)
        return []
      })
      if (coords.length === 0) return
      const lats = coords.map(c => c[1])
      const lngs = coords.map(c => c[0])
      map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [20, 20] })
    } catch (_) {}
  }, [features, map])
  return null
}

export default function FarmMap({ geojson, fleetData, onFarmClick, height = 440, tall = false }) {
  const statusMap = {}
  if (fleetData) fleetData.forEach(f => { statusMap[f.farm_id] = f })

  const styleFeature = (feature) => {
    const props = feature.properties || {}
    const fd = statusMap[props.farm_id]
    const color = fd ? (STATUS_COLOR[fd.status] || '#38bdf8') : '#38bdf8'
    return {
      fillColor: color,
      color: color,
      weight: 1.5,
      fillOpacity: 0.45,
      opacity: 0.9,
    }
  }

  const onEachFeature = (feature, layer) => {
    const props = feature.properties || {}
    const fd = statusMap[props.farm_id]
    layer.bindPopup(`
      <div style="font-family:Inter,sans-serif;min-width:160px">
        <strong>${props.farm_id}</strong><br/>
        ${props.village}, ${props.taluk}<br/>
        ${fd ? `<span style="color:${STATUS_COLOR[fd.status]||'#38bdf8'}">${fd.status?.replace(/_/g,' ')}</span><br/>Next: ${fd.next_irrigation_date||'â€”'}<br/>Hours: ${(fd.hours ?? fd.duration_hours)?.toFixed(1)||'â€”'}h` : ''}
      </div>
    `)
    if (onFarmClick) {
      layer.on('click', () => onFarmClick(props.farm_id))
    }
  }

  const features = geojson?.features || []

  return (
    <div className={`map-container${tall ? ' tall' : ''}`} style={{ height }}>
      <MapContainer
        center={[12.52, 76.0]}
        zoom={11}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        {geojson && features.length > 0 && (
          <>
            <GeoJSON
              key={JSON.stringify(features.length)}
              data={geojson}
              style={styleFeature}
              onEachFeature={onEachFeature}
            />
            <FitBounds features={features} />
          </>
        )}
      </MapContainer>
    </div>
  )
}


