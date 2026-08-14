import { useRef, useEffect } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene'
import WallProps3D from './WallProps3D'
import { Controls } from '../three/Controls'
import { useStore, setState } from '../store'
import { BASE } from '../api'

export const QUALITY = {
  eco: { dprMax: 1.0, shadow: 256, aa: false },
  smooth: { dprMax: 1.25, shadow: 512, aa: false },
  balanced: { dprMax: 1.5, shadow: 1024, aa: true },
  high: { dprMax: 3.0, shadow: 2048, aa: true },
}

// 设备标签投影（HTML 覆盖在画布上）
const NO_DEVICES = []
const _v = new THREE.Vector3()  // 复用的临时向量，避免每帧 new 造成 GC 压力
function DeviceLabels({ floorIndex, containerRef }) {
  const floor = useStore((s) => s.project.floors[floorIndex])
  const devices = (floor && floor.devices) || NO_DEVICES
  const haStates = useStore((s) => s.haStates)
  const showLabels = useStore((s) => s.showLabels)
  const night = useStore((s) => s.night)
  const mode = useStore((s) => s.mode)
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
    if (devices.length === 0) return
    const wrap = containerRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const v = _v  // 复用临时向量，避免每帧 new 导致 GC 压力（GC 是周期性卡顿的常见原因）
    devices.forEach((dev) => {
      const el = els.current.get(dev.id)
      if (!el) return
      el.classList.toggle('light-theme', !night)
      const hide = mode === '纯户型'
      el.style.display = (showLabels && !hide) ? 'block' : 'none'
      if (!showLabels || hide) return
      v.set(dev.pos[0], (dev.pos[1] || 1.4), dev.pos[2]).project(camera)
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
    ;(floor?.walls || []).forEach((w) => { add(w.start[0], w.start[1]); add(w.end[0], w.end[1]) })
    ;(floor?.furniture || []).forEach((f) => { add(f.pos[0], f.pos[2]) })
    const c = has ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 2)
    const width = has ? box.max.x - box.min.x : 8
    const height = has ? box.max.z - box.min.z : 6
    const floorH = (floor && floor.height) || 2.8
    // 对齐原版 ig：distance = max(9.5, 宽*1.42, 高*1.7, 层高*1.3)
    const distance = Math.max(9.5, width * 1.42, height * 1.7, floorH * 1.3)
    setState({ camTarget: [c.x, 0.55, c.z], camDist: distance })
    if (!view2d) {
      // 对齐原版 lg：iso 视角，camera = target + (0.86b, 0.86b, 1.04b)，b = distance*0.88，fov 36
      const b = distance * 0.88
      camera.position.set(c.x + 0.86 * b, 0.55 + 0.86 * b, c.z + 1.04 * b)
      if (camera.fov !== 36) { camera.fov = 36; camera.updateProjectionMatrix() }
      camera.lookAt(c.x, 0.55, c.z)
    }
  }, [floorIndex, view2d, recenterKey])

  return null
}

// 对齐原版 glass 风格主题背景/雾色（day 模式）
const MODE_BG = {
  '全屋': '#5278ae', '照明': '#5879ad', '遮阳': '#080c22',
  '环境': '#4f74aa', '安防': '#070a1d',
}
const MODE_FOG = {
  '全屋': '#6d8ebe', '照明': '#6685b4', '遮阳': '#0c122b',
  '环境': '#6889ba', '安防': '#0b0f27',
}

// 场景背景：按 bgMode 切换 纯色/背景图/渐变/夜景
function SceneBackground({ mode, night, bgImage, bgMode }) {
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    // 天空渐变（对齐原版采样：顶 #253962 → 底 #46618d 垂直渐变）
    const skyGradient = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 4
      canvas.height = 512
      const ctx = canvas.getContext('2d')
      const g = ctx.createLinearGradient(0, 0, 0, 512)
      g.addColorStop(0, '#253962')
      g.addColorStop(1, '#46618d')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 4, 512)
      const tex = new THREE.CanvasTexture(canvas)
      tex.needsUpdate = true
      return tex
    }

    if (bgMode === 'image' && bgImage) {
      // bgImage 可能是本地图片名（存的名字），也可能是外部 URL / data URL，分别处理
      const url = (bgImage.startsWith('http') || bgImage.startsWith('data:'))
        ? bgImage
        : BASE + 'api/background/' + bgImage
      const loader = new THREE.TextureLoader()
      loader.crossOrigin = 'anonymous'
      loader.load(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        scene.background = tex
      }, undefined, () => {
        scene.background = new THREE.Color('#1a2a40')
      })
    } else if (bgMode === 'night') {
      scene.background = new THREE.Color('#0a1020')
    } else {
      // 默认（color/gradient）都用蓝色天空渐变
      scene.background = night ? new THREE.Color('#0a1020') : skyGradient()
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
  const editing = useStore((s) => s.editing)
  const selected = useStore((s) => s.selected)
  const editorBgImage = useStore((s) => s.editorBgImage)
  const editorBgMode = useStore((s) => s.editorBgMode)
  const containerRef = useRef(null)
  const q = QUALITY[quality] || QUALITY.balanced
  const fogColor = night ? '#0a1020' : (MODE_FOG[mode] || MODE_FOG['全屋'])

  // 3D 视图右键 = 取消（单击右键取消；按住右键拖动=平移，不算取消）
  useEffect(() => {
    let down = null
    const onDown = (e) => { if (e.button === 2) down = [e.clientX, e.clientY] }
    const onUp = (e) => {
      if (e.button !== 2 || !down) { down = null; return }
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1])
      down = null
      if (moved < 5) setState({ tool: 'select', selected: null, wallSel: [], pickItem: null })
    }
    const onCtx = (e) => e.preventDefault()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('contextmenu', onCtx)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('contextmenu', onCtx)
    }
  }, [])

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Canvas
        dpr={Math.min(window.devicePixelRatio || 1, q.dprMax)}
        gl={{ antialias: q.aa, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        shadows={shadows}
        camera={{ position: [8.4, 9.6, 10.2], fov: 36, near: 0.1, far: 150 }}
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
        <SceneBackground mode={mode} night={night} bgImage={editing ? editorBgImage : bgImage} bgMode={editing ? editorBgMode : bgMode} />
        <fog attach="fog" args={[fogColor, night ? 30 : 40, night ? 70 : 90]} />
        <Scene onSelect={onSelect} floorIndex={floorIndex} />
        <Controls />
        <CameraFocus floorIndex={floorIndex} />
        <DeviceLabels floorIndex={floorIndex} containerRef={containerRef} />
      </Canvas>
      {/* 3D 编辑时点选墙/家具/设备，右侧弹属性面板 */}
      {editing && selected && ['wall', 'furniture', 'device'].includes(selected.type) && <WallProps3D floorIndex={floorIndex} />}
    </div>
  )
}
