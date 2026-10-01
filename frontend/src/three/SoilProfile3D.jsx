import { useRef } from 'react'
import { useThreeScene } from './useThreeScene.js'
import { useI18n } from '../i18n.jsx'

const STAGE_HEIGHT = { initial: 0.5, development: 1.5, mid: 2.6, late: 2.9 }
const STAGE_GREEN = { initial: 0x5fd068, development: 0x34b85a, mid: 0x1f9d4c, late: 0x9fb043 }

/**
 * Cut-away root-zone column. The water body's height is the available-water
 * fraction of TAW (full at field capacity, empty at wilting point); the amber
 * plane is the FAO-56 irrigation trigger. Cane height and root depth follow the
 * crop stage. All values update smoothly through a ref, without rebuilding.
 */
export default function SoilProfile3D({ availablePct = 50, triggerPct = 40, rootDepthM = 1.2, stage = 'mid', status, height = 340 }) {
  const { t, fmtNum } = useI18n()
  const container = useRef(null)
  const props = useRef({})
  props.current = { availablePct, triggerPct, rootDepthM, stage, status }

  const { ok } = useThreeScene(container, ({ THREE, scene }) => {
    const W = 2.6, D = 2.6, ZONE = 2.4 // root-zone column height in scene units at max root depth
    const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()

    scene.add(new THREE.HemisphereLight(0xdff7ff, 0x2a1d12, 1.1))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(4, 8, 5)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    scene.add(sun)

    const root = new THREE.Group()
    root.position.y = 0.4
    scene.add(root)

    // Soil block: translucent body with crisp edges so the water inside reads clearly.
    const soilGeo = new THREE.BoxGeometry(W, ZONE, D)
    const soil = new THREE.Mesh(soilGeo, new THREE.MeshStandardMaterial({ color: 0x7a5132, transparent: true, opacity: 0.32, roughness: 0.95, depthWrite: false }))
    soil.position.y = -ZONE / 2
    root.add(soil)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(soilGeo), new THREE.LineBasicMaterial({ color: 0xc89b6d, transparent: true, opacity: 0.55 }))
    edges.position.copy(soil.position)
    root.add(edges)

    // Horizon bands on the cut face for texture.
    const bandColors = [0x5b3a22, 0x6b4428, 0x7d5230, 0x8a5e38]
    bandColors.forEach((c, i) => {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(W, ZONE / 4), new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.55, side: THREE.DoubleSide }))
      band.position.set(0, -ZONE / 8 - (i * ZONE) / 4, D / 2 + 0.002)
      root.add(band)
    })

    // Topsoil slab and mulch surface.
    const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.14, D + 0.12), new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 1 }))
    top.position.y = 0.07
    top.receiveShadow = true
    root.add(top)

    // Water body (scaled in Y every frame) with a shimmering surface.
    const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0, transmission: 0.2, depthWrite: false })
    const water = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 1, D - 0.06), waterMat)
    root.add(water)
    const surfMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.75, emissive: 0x0ea5e9, emissiveIntensity: 0.35, side: THREE.DoubleSide })
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, D - 0.06, 24, 24), surfMat)
    surface.rotation.x = -Math.PI / 2
    root.add(surface)
    const surfPos = surface.geometry.attributes.position
    const surfBase = Float32Array.from(surfPos.array)

    // Reference planes: field capacity (top of zone), trigger, wilting point (bottom).
    const plane = (color, opacity) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, D + 0.5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }))
      m.rotation.x = -Math.PI / 2
      const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W + 0.5, D + 0.5)), new THREE.LineBasicMaterial({ color }))
      m.add(ring)
      root.add(m)
      return m
    }
    const fcPlane = plane(0x22d3ee, 0.06)
    const trigPlane = plane(0xfb923c, 0.14)
    const wpPlane = plane(0xf87171, 0.08)

    // Sugarcane: stalks with node rings and arching leaves.
    const cane = new THREE.Group()
    root.add(cane)
    const stalkMat = new THREE.MeshStandardMaterial({ color: 0x6f9a3a, roughness: 0.6 })
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1f9d4c, roughness: 0.7, side: THREE.DoubleSide })
    const nodeMat = new THREE.MeshStandardMaterial({ color: 0x4d6b28 })
    const stalkGeo = new THREE.CylinderGeometry(0.035, 0.045, 1, 8)
    stalkGeo.translate(0, 0.5, 0)
    const leafGeo = new THREE.PlaneGeometry(0.06, 0.9, 1, 6)
    leafGeo.translate(0, 0.45, 0)
    const lp = leafGeo.attributes.position
    for (let i = 0; i < lp.count; i++) { const y = lp.getY(i); lp.setZ(i, (y * y) * 0.35) }
    leafGeo.computeVertexNormals()
    const nodeGeo = new THREE.TorusGeometry(0.045, 0.012, 6, 12)
    const stalks = []
    for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
      const s = new THREE.Group()
      s.position.set(gx * 0.75 + (rnd() - 0.5) * 0.18, 0.14, gz * 0.75 + (rnd() - 0.5) * 0.18)
      const stalk = new THREE.Mesh(stalkGeo, stalkMat)
      stalk.castShadow = true
      s.add(stalk)
      for (let n = 1; n <= 6; n++) {
        const node = new THREE.Mesh(nodeGeo, nodeMat)
        node.rotation.x = Math.PI / 2
        node.position.y = n / 7
        node.userData.frac = n / 7
        s.add(node)
      }
      for (let l = 0; l < 5; l++) {
        const leaf = new THREE.Mesh(leafGeo, leafMat)
        leaf.castShadow = true
        leaf.userData.frac = 0.55 + l * 0.1
        leaf.rotation.y = (l / 5) * Math.PI * 2 + rnd()
        leaf.rotation.x = 0.5 + rnd() * 0.4
        s.add(leaf)
      }
      s.userData = { stalk, sway: rnd() * Math.PI * 2 }
      cane.add(s)
      stalks.push(s)
    }

    // Roots: branching line segments, scaled to the root depth each frame.
    const rootPts = []
    stalks.forEach(s => {
      for (let r = 0; r < 7; r++) {
        let x = s.position.x, y = 0.1, z = s.position.z
        const steps = 6
        const dx = (rnd() - 0.5) * 0.12, dz = (rnd() - 0.5) * 0.12
        for (let k = 0; k < steps; k++) {
          const nx = x + dx + (rnd() - 0.5) * 0.08
          const ny = y - (1 / steps) * (0.85 + rnd() * 0.15)
          const nz = z + dz + (rnd() - 0.5) * 0.08
          rootPts.push(x, y, z, nx, ny, nz)
          x = nx; y = ny; z = nz
        }
      }
    })
    const rootGeo = new THREE.BufferGeometry()
    rootGeo.setAttribute('position', new THREE.Float32BufferAttribute(rootPts, 3))
    const roots = new THREE.LineSegments(rootGeo, new THREE.LineBasicMaterial({ color: 0xe9d8b4, transparent: true, opacity: 0.75 }))
    root.add(roots)

    const cur = { level: 0.5, trig: 0.4, depth: 1, cane: 2.6 }
    const green = new THREE.Color()
    return {
      update(dt, time) {
        const p = props.current
        const ease = 1 - Math.exp(-dt * 3)
        const depthFrac = Math.max(0.25, Math.min(1, (p.rootDepthM || 1.2) / 1.2))
        cur.level += ((Math.max(0, Math.min(100, p.availablePct ?? 50)) / 100) - cur.level) * ease
        cur.trig += ((Math.max(0, Math.min(100, p.triggerPct ?? 40)) / 100) - cur.trig) * ease
        cur.depth += (depthFrac - cur.depth) * ease
        cur.cane += ((STAGE_HEIGHT[p.stage] ?? 2.6) - cur.cane) * ease

        const zone = ZONE * cur.depth
        const bottom = -zone
        const waterH = Math.max(0.02, zone * cur.level)
        water.scale.y = waterH
        water.position.y = bottom + waterH / 2
        surface.position.y = bottom + waterH + 0.002
        fcPlane.position.y = 0.001
        wpPlane.position.y = bottom
        trigPlane.position.y = bottom + zone * cur.trig
        roots.scale.y = zone
        waterMat.color.set(cur.level <= cur.trig ? 0xfb923c : 0x38bdf8)

        for (let i = 0; i < surfPos.count; i++) {
          const x = surfBase[i * 3], y = surfBase[i * 3 + 1]
          surfPos.setZ(i, Math.sin(x * 4 + time * 1.6) * 0.012 + Math.cos(y * 5 + time * 1.2) * 0.01)
        }
        surfPos.needsUpdate = true

        green.setHex(STAGE_GREEN[p.stage] ?? 0x1f9d4c)
        leafMat.color.lerp(green, ease)
        stalks.forEach(s => {
          s.userData.stalk.scale.y = cur.cane
          s.children.forEach(c => { if (c.userData.frac) c.position.y = c.userData.frac * cur.cane })
          s.rotation.z = Math.sin(time * 0.8 + s.userData.sway) * 0.03
        })
      },
    }
  }, { camera: { position: [5.2, 2.6, 5.6], target: [0, -0.6, 0], minDistance: 4, maxDistance: 14, maxPolarAngle: Math.PI * 0.62 }, autoRotate: 0.8 })

  return (
    <div className="three-wrap" style={{ height }}>
      {ok ? <div ref={container} style={{ position: 'absolute', inset: 0 }} /> : <div className="three-fallback">WebGL is not available in this browser.</div>}
      <div className="three-legend" aria-label={t('dash.soil3d')}>
        <div className="row"><span className="bar" style={{ background: '#22d3ee' }} />{t('dash.soil3dFc')}</div>
        <div className="row"><span className="bar" style={{ background: '#fb923c' }} />{t('dash.soil3dTrigger')} · {fmtNum(triggerPct, 0)}%</div>
        <div className="row"><span className="bar" style={{ background: '#f87171' }} />{t('dash.soil3dWp')}</div>
        <div className="row"><span className="bar" style={{ background: '#38bdf8', height: 8 }} /><strong style={{ color: 'var(--text-1)' }}>{fmtNum(availablePct, 0)}% {t('dash.ofTaw')}</strong></div>
        <div className="row"><span className="bar" style={{ background: '#e9d8b4' }} />{t('dash.soil3dRoots', { m: fmtNum(rootDepthM, 2) })}</div>
      </div>
      <div className="three-hint">{t('dash.soil3dHint')}</div>
    </div>
  )
}
