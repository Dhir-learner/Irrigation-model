import { useRef, useState } from 'react'
import { useThreeScene } from './useThreeScene.js'
import { useI18n } from '../i18n.jsx'
import { STATUS_HEX } from '../components/ui.jsx'

/**
 * Schematic 3D fleet: each village is a platform placed by its real relative
 * position (spread apart so none overlap), each farm a column on it.
 * Column height = root-zone depletion ratio; colour = irrigation status.
 */
function layoutVillages(fleet) {
  const groups = {}
  fleet.forEach(f => { (groups[f.village] ||= []).push(f) })
  const names = Object.keys(groups).sort()
  const centers = names.map(name => {
    const pts = groups[name].filter(f => f.latitude != null && f.longitude != null)
    const lat = pts.reduce((s, f) => s + f.latitude, 0) / (pts.length || 1)
    const lon = pts.reduce((s, f) => s + f.longitude, 0) / (pts.length || 1)
    return { name, lat, lon }
  })
  const lat0 = centers.reduce((s, c) => s + c.lat, 0) / centers.length
  const lon0 = centers.reduce((s, c) => s + c.lon, 0) / centers.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  let pts = centers.map(c => ({ ...c, x: (c.lon - lon0) * k, z: -(c.lat - lat0) }))
  const extent = Math.max(...pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.z)))) || 1
  pts = pts.map(p => ({ ...p, x: (p.x / extent) * 22, z: (p.z / extent) * 22 }))
  // Push apart platforms that would overlap; keeps the geography roughly intact.
  const MIN = 9
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - pts[i].x, dz = pts[j].z - pts[i].z
      const d = Math.hypot(dx, dz) || 0.01
      if (d < MIN) {
        const push = (MIN - d) / 2
        pts[i].x -= (dx / d) * push; pts[i].z -= (dz / d) * push
        pts[j].x += (dx / d) * push; pts[j].z += (dz / d) * push
      }
    }
  }
  return { groups, villages: pts }
}

export default function Fleet3D({ fleet, selectedId, onOpenFarm, height = 460 }) {
  const { t, fmtNum, fmtDate } = useI18n()
  const container = useRef(null)
  const labelsRef = useRef(null)
  const [tip, setTip] = useState(null)
  const live = useRef({})
  live.current = { onOpenFarm, selectedId, t }

  const { ok } = useThreeScene(container, ({ THREE, scene, camera, renderer, el }) => {
    scene.add(new THREE.HemisphereLight(0xd8f5ff, 0x0b1a14, 1.0))
    const sun = new THREE.DirectionalLight(0xffffff, 2.0)
    sun.position.set(20, 40, 15)
    scene.add(sun)

    const grid = new THREE.GridHelper(90, 45, 0x2c4d40, 0x18302a)
    grid.material.transparent = true
    grid.material.opacity = 0.5
    scene.add(grid)

    const { groups, villages } = layoutVillages(fleet)
    const total = fleet.length
    const colGeo = new THREE.BoxGeometry(0.42, 1, 0.42)
    colGeo.translate(0, 0.5, 0)
    const colMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 })
    const mesh = new THREE.InstancedMesh(colGeo, colMat, total)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(mesh)

    const index = [] // instanceId -> farm
    const targets = []
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x14302a, roughness: 0.9, transparent: true, opacity: 0.85 })
    const labelAnchors = []
    let n = 0
    villages.forEach(v => {
      const farms = [...groups[v.name]].sort((a, b) => a.due_day - b.due_day || b.depletion_ratio - a.depletion_ratio)
      const side = Math.ceil(Math.sqrt(farms.length))
      const step = 0.6
      const size = side * step + 0.6
      const plat = new THREE.Mesh(new THREE.BoxGeometry(size, 0.18, size), platformMat)
      plat.position.set(v.x, 0.09, v.z)
      scene.add(plat)
      const rim = new THREE.LineSegments(new THREE.EdgesGeometry(plat.geometry), new THREE.LineBasicMaterial({ color: 0x2f6b58 }))
      rim.position.copy(plat.position)
      scene.add(rim)
      labelAnchors.push({ name: v.name, pos: new THREE.Vector3(v.x, 0.3, v.z + size / 2 + 0.6), count: farms.length })
      farms.forEach((f, i) => {
        const gx = (i % side) - (side - 1) / 2
        const gz = Math.floor(i / side) - (side - 1) / 2
        const h = 0.15 + Math.max(0, f.depletion_ratio ?? 0) * 6
        dummy.position.set(v.x + gx * step, 0.18, v.z + gz * step)
        dummy.scale.set(1, 0.001, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(n, dummy.matrix)
        mesh.setColorAt(n, color.set(STATUS_HEX[f.status] || '#7dd3fc'))
        index[n] = f
        targets[n] = { x: dummy.position.x, z: dummy.position.z, h, delay: i * 0.004 + Math.random() * 0.2 }
        n++
      })
    })
    mesh.count = n
    mesh.instanceColor.needsUpdate = true

    // Highlight marker for the selected farm.
    const marker = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    marker.rotation.x = -Math.PI / 2
    marker.visible = false
    scene.add(marker)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 12, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }))
    beam.visible = false
    scene.add(beam)

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let hovered = -1
    const pick = e => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(mesh)[0]
      return { id: hit ? hit.instanceId : -1, x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onMove = e => {
      const { id, x, y } = pick(e)
      if (id !== hovered) {
        if (hovered >= 0) mesh.setColorAt(hovered, color.set(STATUS_HEX[index[hovered].status]))
        if (id >= 0) mesh.setColorAt(id, color.set('#ffffff'))
        mesh.instanceColor.needsUpdate = true
        hovered = id
      }
      renderer.domElement.style.cursor = id >= 0 ? 'pointer' : 'grab'
      setTip(id >= 0 ? { x, y, f: index[id] } : null)
    }
    let downAt = null
    const onDown = e => { downAt = [e.clientX, e.clientY] }
    const onUp = e => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return
      const { id } = pick(e)
      if (id >= 0) live.current.onOpenFarm?.(index[id].farm_id)
    }
    const onLeave = () => { setTip(null); if (hovered >= 0) { mesh.setColorAt(hovered, color.set(STATUS_HEX[index[hovered].status])); mesh.instanceColor.needsUpdate = true; hovered = -1 } }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    const v3 = new THREE.Vector3()
    let grow = 0
    return {
      update(dt, time) {
        if (grow < 2) {
          grow += dt
          for (let i = 0; i < n; i++) {
            const tg = targets[i]
            const p = Math.min(1, Math.max(0, (grow - tg.delay) / 0.9))
            const e = 1 - Math.pow(1 - p, 3)
            dummy.position.set(tg.x, 0.18, tg.z)
            dummy.scale.set(1, Math.max(0.001, tg.h * e), 1)
            dummy.updateMatrix()
            mesh.setMatrixAt(i, dummy.matrix)
          }
          mesh.instanceMatrix.needsUpdate = true
        }
        const sel = live.current.selectedId
        const si = sel ? index.findIndex(f => f?.farm_id === sel) : -1
        if (si >= 0) {
          const tg = targets[si]
          marker.visible = beam.visible = true
          marker.position.set(tg.x, 0.2 + tg.h + 0.15 + Math.sin(time * 3) * 0.08, tg.z)
          beam.position.set(tg.x, 6 + tg.h, tg.z)
        } else {
          marker.visible = beam.visible = false
        }
        // Village labels follow their platforms in screen space.
        const host = labelsRef.current
        if (host) {
          const w = el.clientWidth, h = el.clientHeight
          labelAnchors.forEach((a, i) => {
            const node = host.children[i]
            if (!node) return
            v3.copy(a.pos).project(camera)
            const visible = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1
            node.style.display = visible ? 'block' : 'none'
            node.style.left = `${((v3.x + 1) / 2) * w}px`
            node.style.top = `${((1 - v3.y) / 2) * h}px`
          })
        }
      },
      dispose() {
        renderer.domElement.removeEventListener('pointermove', onMove)
        renderer.domElement.removeEventListener('pointerdown', onDown)
        renderer.domElement.removeEventListener('pointerup', onUp)
        renderer.domElement.removeEventListener('pointerleave', onLeave)
      },
      labels: labelAnchors,
    }
  }, { camera: { position: [0, 30, 42], target: [0, 0, 0], minDistance: 8, maxDistance: 110 }, autoRotate: 0.35 })

  const villageNames = [...new Set(fleet.map(f => f.village))].sort()
  const counts = fleet.reduce((m, f) => ((m[f.village] = (m[f.village] || 0) + 1), m), {})

  return (
    <div className="three-wrap" style={{ height }}>
      {ok ? <div ref={container} style={{ position: 'absolute', inset: 0 }} /> : <div className="three-fallback">WebGL is not available in this browser.</div>}
      <div ref={labelsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {villageNames.map(v => <div key={v} className="three-label">{v} <span style={{ opacity: 0.6, fontWeight: 500 }}>({counts[v]})</span></div>)}
      </div>
      <div className="three-legend">
        {Object.keys(STATUS_HEX).map(k => (
          <div className="row" key={k}><span className="bar" style={{ background: STATUS_HEX[k], height: 8, width: 8, borderRadius: 2 }} />{t('status.' + k)}</div>
        ))}
        <div className="row xs muted" style={{ maxWidth: 190 }}>{t('overview.fleet3dLegend')}</div>
      </div>
      {tip && (
        <div className="three-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="mono strong">{tip.f.farm_id}</div>
          <div className="muted">{tip.f.village}</div>
          <div style={{ color: STATUS_HEX[tip.f.status], fontWeight: 700 }}>{t('status.' + tip.f.status)}</div>
          <div>{t('map.nextIrrigation')}: {fmtDate(tip.f.next_irrigation_date)} · {fmtNum((tip.f.depletion_ratio ?? 0) * 100, 0)}%</div>
        </div>
      )}
      <div className="three-hint">{t('overview.fleet3dHint')}</div>
    </div>
  )
}
