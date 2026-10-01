import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Mounts a three.js scene into `containerRef` and runs `build(ctx)` once.
 * build returns { update?(dt, t), dispose?() }. The renderer, controls, resize
 * observer and render loop are owned here and torn down on unmount.
 * Returns { ok } — false when WebGL is unavailable so callers can show a fallback.
 */
export function useThreeScene(containerRef, build, { camera: camOpts = {}, autoRotate = 0.6 } = {}) {
  const [ok] = useState(webglAvailable)
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    const el = containerRef.current
    if (!ok || !el) return undefined

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(camOpts.fov ?? 40, 1, 0.1, 1000)
    camera.position.set(...(camOpts.position ?? [6, 5, 7]))

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(...(camOpts.target ?? [0, 0, 0]))
    controls.minDistance = camOpts.minDistance ?? 2
    controls.maxDistance = camOpts.maxDistance ?? 60
    controls.maxPolarAngle = camOpts.maxPolarAngle ?? Math.PI * 0.49
    controls.autoRotate = !reducedMotion() && autoRotate > 0
    controls.autoRotateSpeed = autoRotate
    const stopAuto = () => { controls.autoRotate = false }
    renderer.domElement.addEventListener('pointerdown', stopAuto)

    const ctx = { THREE, scene, camera, renderer, controls, el }
    const handle = buildRef.current(ctx) || {}

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      handle.onResize?.(w, h)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // Render only while visible; pause off-screen to save battery on field tablets.
    let visible = true
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    io.observe(el)

    const clock = new THREE.Clock()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!visible || document.hidden) { clock.getDelta(); return }
      const dt = Math.min(clock.getDelta(), 0.05)
      handle.update?.(dt, clock.elapsedTime)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      renderer.domElement.removeEventListener('pointerdown', stopAuto)
      handle.dispose?.()
      controls.dispose()
      scene.traverse(obj => {
        obj.geometry?.dispose?.()
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
        mats.forEach(m => { m.map?.dispose?.(); m.dispose?.() })
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
    // Rebuild only when the container mounts; data changes flow through refs inside build.
  }, [ok]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ok }
}
