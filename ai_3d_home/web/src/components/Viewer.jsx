import { useRef, useEffect } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene'
import { Controls } from '../three/Controls'
import { useStore, setState } from '../store'

export const QUALITY = {
  eco: { dprMax: 1.0, shadow: 256, aa: false },
  smooth: { dprMax: 1.25, shadow: 512, aa: false },
  balanced: { dprMax: 1.5, shadow: 1024, aa: true },
  high: { dprMax: 2.0, shadow: 2048, aa: true },
}

// 设备标签投影（HTML 覆盖在画布上）
const NO_DEVICES = []
function DeviceLabels({ floorIndex, containerRef }) {
  const floor = useStore((s) => s.project.floors[floorIndex])
  const devices = (floor && floor.devices) || NO_DEVICES
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

// 相机对焦（3D 透视视角；2D 编辑已改为独立 SVG，不再切换相机）
function CameraFocus({ floorIndex }) {
  const project = useStore((s) => s.project)
  const floor = project.floors[floorIndex]
  const view2d = useStore((s) => s.view2d)
  const recenterKey = useStore((s) => s.recenterKey)
  const { camera } = useThree()

  useEffect(() => {
    const box = new THREE.Box3()
    let has = false
    const add = (x, z) => { box.expandByPoint(new THREE.Vector3(x, 0, z)); has = true }
    ;(floor?.rooms || []).forEach((r) => (r.points || []).forEach((p) => add(p[0], p[1])))
    ;(floor?.furniture || []).forEach((f) => { add(f.pos[0], f.pos[2]) })
    const c = has ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 2)
    // 户型最大尺寸，用于取景框住
    const size = has ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) : 8
    setState({ camTarget: [c.x, 0, c.z], camDist: Math.max(size, 4) })
    if (!view2d) {
      // 按户型大小定距离，让户型居中且框住
      const dist = size * 1.6 + 12
      camera.position.set(c.x, c.y + dist, c.z + dist * 0.5)
      camera.lookAt(c.x, 0, c.z)
    }
  }, [floorIndex, view2d, recenterKey, JSON.stringify(floor?.rooms), JSON.stringify(floor?.furniture)])

  return null
}

const MODE_BG = {
  '全屋': '#e9eef2', '照明': '#1d2638', '遮阳': '#d8e0ec',
  '环境': '#0e1a30', '安防': '#cfe4f5',
}

// 场景背景：按 bgMode 切换 纯色/背景图/渐变/夜景
function SceneBackground({ mode, night, bgImage, bgMode }) {
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const skyGradient = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 4
      canvas.height = 512
      const ctx = canvas.getContext('2d')
      const g = ctx.createLinearGradient(0, 0, 0, 512)
      g.addColorStop(0, '#9cc8e8')
      g.addColorStop(1, '#e8f4fc')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 4, 512)
      const tex = new THREE.CanvasTexture(canvas)
      tex.needsUpdate = true
      return tex
    }

    if (bgMode === 'image' && bgImage) {
      const loader = new THREE.TextureLoader()
      loader.crossOrigin = 'anonymous'
      loader.load(bgImage + (bgImage.includes('?') ? '&' : '?') + 't=' + Date.now(), (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        scene.background = tex
      }, undefined, () => {
        scene.background = new THREE.Color('#1a2a40')
      })
    } else if (bgMode === 'gradient') {
      scene.background = skyGradient()
    } else if (bgMode === 'night') {
      scene.background = new THREE.Color('#0a1020')
    } else {
      // color：跟随模式颜色
      scene.background = new THREE.Color(night ? '#0a1020' : (MODE_BG[mode] || MODE_BG['全屋']))
    }
  }, [mode, night, bgImage, bgMode])

  return null
}

export default function Viewer({ onSelect, floorIndex }) {
  const quality = useStore((s) => s.quality)
  const shadows = useStore((s) => s.shadows)
  const night = useStore((s) => s.night)
  const mode = useStore((s) => s.mode)
  const floor = useStore((s) => s.project.floors[floorIndex])
  const bgImage = useStore((s) => s.bgImage)
  const bgMode = useStore((s) => s.bgMode)
  const containerRef = useRef(null)
  const q = QUALITY[quality] || QUALITY.balanced
  const bg = night ? '#0a1020' : (MODE_BG[mode] || MODE_BG['全屋'])

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Canvas
        dpr={Math.min(window.devicePixelRatio || 1, q.dprMax)}
        gl={{ antialias: q.aa, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        shadows={shadows}
        camera={{ position: [9, 10, 12], fov: 42, near: 0.1, far: 150 }}
        onCreated={({ gl, scene, camera }) => {
          window.__dbg3d = {
            get frames() { return gl.info.render.frame },
            get calls() { return gl.info.render.calls },
            get triangles() { return gl.info.render.triangles },
            get cam() { return camera.position.toArray() },
            get camType() { return (camera && camera.isOrthographicCamera) ? 'ortho' : 'persp' },
            scene,
            gl,
          }
        }}
      >
        <SceneBackground mode={mode} night={night} bgImage={bgImage} bgMode={bgMode} />
        <fog attach="fog" args={[bg, night ? 30 : 40, night ? 70 : 90]} />
        <Scene onSelect={onSelect} floorIndex={floorIndex} />
        <Controls />
        <CameraFocus floorIndex={floorIndex} />
        <DeviceLabels floorIndex={floorIndex} containerRef={containerRef} />
      </Canvas>
    </div>
  )
}
