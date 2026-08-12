import { useRef, useEffect } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene'
import EditorController from './EditorController'
import { Controls } from '../three/Controls'
import { useStore, setState } from '../store'

export const QUALITY = {
  eco: { dprMax: 1.0, shadow: 256, aa: false },
  smooth: { dprMax: 1.25, shadow: 512, aa: false },
  balanced: { dprMax: 1.5, shadow: 1024, aa: true },
  high: { dprMax: 2.0, shadow: 2048, aa: true },
}

// 设备标签投影（HTML 覆盖在画布上）
function DeviceLabels({ floorIndex, containerRef }) {
  const devices = useStore((s) => s.project.floors[floorIndex]?.devices || [])
  const haStates = useStore((s) => s.haStates)
  const showLabels = useStore((s) => s.showLabels)
  const night = useStore((s) => s.night)
  const { camera } = useThree()
  const els = useRef(new Map())

  // 确保 label DOM 元素存在
  useEffect(() => {
    const wrap = containerRef.current
    if (!wrap) return
    devices.forEach((dev) => {
      if (!els.current.has(dev.id)) {
        const el = document.createElement('div')
        el.className = 'device-label'
        wrap.appendChild(el)
        els.current.set(dev.id, el)
      }
    })
    return () => {
      els.current.forEach((el) => el.remove())
      els.current.clear()
    }
  }, [devices.length, floorIndex])

  useFrame(() => {
    const wrap = containerRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const v = new THREE.Vector3()
    devices.forEach((dev) => {
      const el = els.current.get(dev.id)
      if (!el) return
      el.classList.toggle('light-theme', !night)
      el.style.display = showLabels ? 'block' : 'none'
      if (!showLabels) return
      const pos = new THREE.Vector3(dev.pos[0], (0) + (dev.pos[1] || 1.4), dev.pos[2])
      v.copy(pos).project(camera)
      if (v.z > 1) { el.style.display = 'none'; return }
      el.style.left = (v.x * 0.5 + 0.5) * rect.width + 'px'
      el.style.top = (-v.y * 0.5 + 0.5) * rect.height + 'px'
      const st = haStates[dev.entity_id]
      const domain = (dev.entity_id || '').split('.')[0]
      let label = dev.name || dev.entity_id
      if (st) {
        if (domain === 'sensor' && st.attributes && st.attributes.unit_of_measurement) {
          label = `${dev.name || ''} ${st.state}${st.attributes.unit_of_measurement}`.trim()
        } else if (domain !== 'sensor') {
          label = `${dev.name || ''} ${st.state === 'on' ? '开' : st.state === 'off' ? '关' : st.state}`.trim()
        }
      }
      el.textContent = label
    })
  })

  return null
}

// 相机对焦（目标通过 store 传给 Controls）
function CameraFocus({ floorIndex }) {
  const project = useStore((s) => s.project)
  const floor = project.floors[floorIndex]
  const { camera } = useThree()

  useEffect(() => {
    const box = new THREE.Box3()
    let has = false
    const add = (x, z) => { box.expandByPoint(new THREE.Vector3(x, 0, z)); has = true }
    ;(floor?.rooms || []).forEach((r) => (r.points || []).forEach((p) => add(p[0], p[1])))
    ;(floor?.furniture || []).forEach((f) => { add(f.pos[0], f.pos[2]) })
    if (has) {
      const c = box.getCenter(new THREE.Vector3())
      setState({ camTarget: [c.x, 0, c.z] })
      camera.position.set(c.x + 9, c.y + 10, c.z + 12)
      camera.lookAt(c.x, 0, c.z)
    }
  }, [floorIndex, JSON.stringify(floor?.rooms), JSON.stringify(floor?.furniture)])

  return null
}

const MODE_BG = {
  '全屋': '#e9eef2', '照明': '#1d2638', '遮阳': '#d8e0ec',
  '环境': '#dfe9dc', '安防': '#22262f',
}

export default function Viewer({ onSelect, floorIndex }) {
  const quality = useStore((s) => s.quality)
  const shadows = useStore((s) => s.shadows)
  const night = useStore((s) => s.night)
  const mode = useStore((s) => s.mode)
  const containerRef = useRef(null)
  const q = QUALITY[quality] || QUALITY.balanced
  const bg = night ? '#0a1020' : (MODE_BG[mode] || MODE_BG['全屋'])

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Canvas
        dpr={Math.min(window.devicePixelRatio || 1, q.dprMax)}
        gl={{ antialias: q.aa, powerPreference: 'high-performance' }}
        shadows={shadows}
        camera={{ position: [9, 10, 12], fov: 42, near: 0.1, far: 150 }}
      >
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, night ? 30 : 40, night ? 70 : 90]} />
        <Scene onSelect={onSelect} floorIndex={floorIndex} />
        <Controls />
        <CameraFocus floorIndex={floorIndex} />
        <DeviceLabels floorIndex={floorIndex} containerRef={containerRef} />
        <EditorController />
      </Canvas>
    </div>
  )
}
