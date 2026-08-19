import { useMemo, useRef, useState, useEffect } from 'react'
import { useThree, useFrame, extend } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
// 让 R3F 认识这些线元素（否则不渲染）
extend({ Line2, LineSegments2, LineSegmentsGeometry, LineMaterial })
import { useStore, setState, getState, toast } from '../store'
import { api } from '../api'
import { FURNITURE_LIB, FURNITURE_MAIN, FURNITURE_DETAIL, FURNITURE_ACCENT, WALL_THICK, DOOR_COLORS, robustFloorGeometry, wholeFloorGeometryWithColors, wallKey, DEVICE_MODELS, FURNITURE_WALL_HEIGHT, pointToSeg, pointInPolygon, wallOnEdge } from '../three/geometry'
import { getCatalogItem } from '../catalog'

// R3F 的 onClick 对「有命中对象」的情况不做 delta 过滤，所以左键旋转松手时只要鼠标还在对象上，
// 就会误触发点击 → 点房间跳视角（相机飞到房间中心、距离变小，表现为「突然放大」）。
// 这里统一用 delta（pointerdown→pointerup 的屏幕距离）判断：拖拽 >6px 就不算点击。
const isDragClick = (e) => e && e.delta != null && e.delta > 6

// 米家 Xiaomi Home 3D 配色（低饱和、柔和浅色、扁平化）
const THEME = {
  day: {
    wallColor: '#F0F0F0',   // 室内白墙
    wallOpacity: 0.197,
    floorPalette: ['#EAE8E5', '#EEECE9', '#E6E4E1', '#F0EEEC', '#EDEBE8'],  // 地面暖灰白系
  },
  night: {
    wallColor: '#F8E9D3',   // 暖光照射墙面
    wallOpacity: 0.197,
    floorPalette: ['#EAE8E5', '#E6E4E1', '#EDEBE8', '#E2E0DD', '#F0EEEC'],
  },
}


// 加粗画图网格（用细长方体做线，比 gridHelper 的 1px 清晰得多）
function DrawingGrid({ size = 20, cell = 1, level, night }) {
  const n = Math.round(size / cell)
  const half = size / 2
  const lines = []
  const mainColor = night ? '#6a7a9a' : '#4f7fae'
  const subColor = night ? '#3a4a6a' : '#a8c4e0'
  for (let i = 0; i <= n; i++) {
    const p = -half + i * cell
    const isMajor = i % 5 === 0
    const t = isMajor ? 0.05 : 0.025
    const c = isMajor ? mainColor : subColor
    // X 方向（横线）
    lines.push(
      <mesh key={`h${i}`} position={[0, level + 0.01, p]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size, t]} />
        <meshBasicMaterial color={c} transparent opacity={isMajor ? 0.9 : 0.6} side={THREE.DoubleSide} />
      </mesh>,
      <mesh key={`v${i}`} position={[p, level + 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[t, size]} />
        <meshBasicMaterial color={c} transparent opacity={isMajor ? 0.9 : 0.6} side={THREE.DoubleSide} />
      </mesh>,
    )
  }
  return <group>{lines}</group>
}

// 颜色混合（对齐原版 _ 函数）
function mixColor(a, b, t) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString() }

// 模型文件基础路径（相对页面，HA ingress 下也正确）
const MODEL_BASE = (() => {
  let p = window.location.pathname
  if (p.endsWith('index.html')) p = p.slice(0, -'index.html'.length)
  if (!p.endsWith('/')) p += '/'
  return p
})()

// 加载网上 GLB 模型：等比缩放放进目标 w/d/h 盒子（不拉伸），横竖方向对齐，水平居中、底部贴地、开阴影
export function GltfModel({ name, w, d, h }) {
  const url = MODEL_BASE + 'models/' + name
  const [scene, setScene] = useState(null)

  useEffect(() => {
    let alive = true
    // Draco 压缩的 GLB（如自定义柜子）需要解码器；未压缩的模型也兼容
    const loader = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(MODEL_BASE + 'draco/')
    loader.setDRACOLoader(draco)
    loader.load(url, (gltf) => {
      if (!alive) return
      const s = gltf.scene.clone(true)
      const b0 = new THREE.Box3().setFromObject(s)
      const sz0 = b0.getSize(new THREE.Vector3())
      // 方向对齐：模型竖着（深度>宽度）但目标横着（宽度>深度），或反之，旋转 90°
      if (w && d && sz0.x > 0.001 && sz0.z > 0.001) {
        const modelVertical = sz0.z > sz0.x
        const targetVertical = d > w
        if (modelVertical !== targetVertical) {
          s.rotation.y = Math.PI / 2
          s.updateMatrixWorld(true)
        }
      }
      const box = new THREE.Box3().setFromObject(s)
      const sz = box.getSize(new THREE.Vector3())
      // 等比缩放：保证放进目标 w/d/h（不拉伸，比例正确）
      let scale = 1
      if (w && d && h) {
        scale = Math.min(w / (sz.x || 1), d / (sz.z || 1), h / (sz.y || 1))
      } else if (h) {
        scale = h / (sz.y || 1)
      }
      s.scale.multiplyScalar(scale)
      s.updateMatrixWorld(true)
      const b2 = new THREE.Box3().setFromObject(s)
      const center = b2.getCenter(new THREE.Vector3())
      s.position.set(-center.x, -b2.min.y, -center.z)
      s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      setScene(s)
    }, undefined, () => { /* 加载失败静默 */ })
    return () => { alive = false; draco.dispose() }
  }, [url, w, d, h])

  if (!scene) return null
  return <primitive object={scene} />
}

// 窗帘半幅：useFrame 缓动开合（闭合占满 w/2 与导轨齐平，打开向两侧滑出 + 按 shrink 收拢，缓慢动画）
function CurtainHalf({ side, w, targetOpen, rodY, folds, fabric, fabricDark, fabricLight, shrink, z = 0 }) {
  const groupRef = useRef()
  const smoothRef = useRef(targetOpen)
  const s = shrink != null ? Math.max(0.15, Math.min(0.85, shrink)) : 0.5
  useFrame((_, delta) => {
    const cur = smoothRef.current
    const d = targetOpen - cur
    const next = cur + d * Math.min(1, delta * 2.5)
    smoothRef.current = Math.abs(d) < 0.003 ? targetOpen : next
    const g = groupRef.current
    if (!g) return
    const o = smoothRef.current
    // 中心：闭合 ±w/4（占满半边），打开按 shrink 收拢到横杆端（帘缘正好到 ±w/2，不超出横杆）
    g.position.x = side * (w / 4 + (w / 4) * s * o)
    g.scale.x = 1 - s * o
  })
  const fw = (w / 2 / folds) * 1.2
  return (
    <group ref={groupRef} position={[0, 0, z]}>
      {Array.from({ length: folds }).map((_, i) => {
        const fx = (i - (folds - 1) / 2) * (w / 2 / folds)
        const wave = Math.sin(i * 1.9 + side) * 0.01
        return (
          <mesh key={i} position={[fx, rodY / 2 - 0.02, wave]} rotation={[0, Math.sin(i * 1.4 + side) * 0.11, 0]} castShadow>
            <boxGeometry args={[fw, rodY - 0.05, 0.02]} />
            <meshPhysicalMaterial color={i % 2 ? fabricDark : fabric} roughness={0.93} metalness={0} transparent opacity={0.96} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
      {/* 帘头波浪装饰 */}
      <mesh position={[0, rodY - 0.045, 0]}>
        <boxGeometry args={[w / 2 * 1.05, 0.06, 0.035]} />
        <meshStandardMaterial color={fabricLight} roughness={0.85} />
      </mesh>
    </group>
  )
}

// 柜门开合动画：绕铰链（group 原点）缓动旋转到目标角度（delta 缓动，松手自然停下）
function AnimatedRotate({ to, position, children }) {
  const ref = useRef()
  const toRef = useRef(to)
  toRef.current = to
  useFrame((_, delta) => {
    const r = ref.current
    if (!r) return
    const target = toRef.current
    const d = target - r.rotation.y
    r.rotation.y += d * Math.min(1, delta * 7)
    if (Math.abs(d) < 0.002) r.rotation.y = target
  })
  return <group ref={ref} position={position}>{children}</group>
}

// 家具盒子（对齐原版 uA：boxGeometry + physical 材质 clearcoat）
function FBox({ position, size, color, roughness = 0.72 }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshPhysicalMaterial color={color} roughness={roughness} metalness={0.018} clearcoat={0.16} clearcoatRoughness={0.82} />
    </mesh>
  )
}

// ---------- 家具模型（对齐原版：每个家具用多个盒子拼出具体造型，统一蓝灰主题色） ----------
export function FurnitureModel({ type, color, w: cw, d: cd, h: ch, params, doorOpen, curtainPos }) {
  const lib = FURNITURE_LIB.find((f) => f.type === type)
  const devModel = DEVICE_MODELS.find((m) => m.id === type)
  // 设备模型（开关/灯/空调/摄像机/风扇…）统一走 DeviceModel
  if (devModel) return <DeviceModel id={devModel.id} w={devModel.w} d={devModel.d} h={devModel.h} />
  // 网上下载的 GLB 模型：直接加载渲染（自动缩放对齐）
  if (lib && lib.glb) return <GltfModel name={lib.glb} w={cw || lib.w} d={cd || lib.d} h={ch || lib.h} />
  const cat = getCatalogItem(type)
  if (cat) return <GltfModel name={cat.glb} w={cw || cat.w} d={cd || cat.d} h={ch || cat.h} />
  const w = cw || (lib ? lib.w : 1)
  const d = cd || (lib ? lib.d : 0.6)
  const h = ch || (lib ? lib.h : 0.6)
  const M = color || FURNITURE_MAIN
  const D = color ? mixColor(color, '#000000', 0.28) : FURNITURE_DETAIL
  const A = color ? mixColor(color, '#ffffff', 0.35) : FURNITURE_ACCENT
  const q = Math.min(0.12, h * 0.16)  // 桌面厚度
  const legs = (V) => [-1, 1].flatMap(x => [-1, 1].map(z => (
    <FBox key={`${x}${z}`} position={[x * (w / 2 - 0.09), V / 2, z * (d / 2 - 0.09)]} size={[0.08, V, 0.08]} color={D} />
  )))

  switch (type) {
    case '沙发':
      return (
        <group>
          <FBox position={[0, h * 0.24, d * 0.14]} size={[w, h * 0.48, d * 0.58]} color={M} />
          <FBox position={[0, h * 0.68, d * 0.34]} size={[w, h * 0.36, d * 0.16]} color={D} />
          <FBox position={[-w * 0.45, h * 0.38, d * 0.02]} size={[w * 0.12, h * 0.44, d * 0.58]} color={M} />
          <FBox position={[w * 0.45, h * 0.38, d * 0.02]} size={[w * 0.12, h * 0.44, d * 0.58]} color={M} />
          {[-0.24, 0.24].map(V => <FBox key={`s${V}`} position={[V * w, h * 0.53, d * 0.06]} size={[w * 0.43, h * 0.12, d * 0.48]} color={A} roughness={0.5} />)}
          {[-0.25, 0.25].map(V => <FBox key={`p${V}`} position={[V * w, h * 0.7, d * 0.22]} size={[w * 0.34, h * 0.22, d * 0.12]} color={D} roughness={0.5} />)}
        </group>
      )
    case '床':
      return (
        <group>
          <FBox position={[0, h * 0.2, 0]} size={[w, h * 0.4, d]} color={M} />
          <FBox position={[0, h * 0.64, -d * 0.43]} size={[w + 0.04, h * 0.78, d * 0.12]} color={D} />
          <FBox position={[0, h * 0.48, d * 0.12]} size={[w * 0.9, h * 0.15, d * 0.72]} color={A} />
          {[-0.24, 0.24].map(V => <FBox key={`bp${V}`} position={[V * w, h * 0.64, -d * 0.21]} size={[w * 0.3, h * 0.18, d * 0.18]} color={mixColor(A, '#ffffff', 0.14)} roughness={0.46} />)}
          <FBox position={[0, h * 0.56, d * 0.22]} size={[w * 0.72, h * 0.05, d * 0.38]} color={mixColor(D, '#ffffff', 0.1)} roughness={0.48} />
        </group>
      )
    case '餐桌': {
      const chair = (V, b, rot) => (
        <group key={`c${V}${b}`} position={[V * w, 0, b * d]} rotation={[0, rot, 0]}>
          <FBox position={[0, Math.max(0.1, h * 0.34), 0]} size={[w * 0.22, h * 0.18, d * 0.2]} color={A} roughness={0.52} />
          <FBox position={[0, Math.max(0.1, h * 0.58), d * 0.09]} size={[w * 0.22, h * 0.34, d * 0.07]} color={D} roughness={0.54} />
          <FBox position={[-0.08 * w, Math.max(0.05, h * 0.18), -d * 0.055]} size={[0.035, h * 0.36, 0.035]} color={D} roughness={0.6} />
          <FBox position={[0.08 * w, Math.max(0.05, h * 0.18), -d * 0.055]} size={[0.035, h * 0.36, 0.035]} color={D} roughness={0.6} />
        </group>
      )
      return (
        <group>
          <FBox position={[0, h - q / 2, 0]} size={[w, q, d]} color={M} roughness={0.5} />
          <FBox position={[0, h + q * 0.12, 0]} size={[w * 0.82, q * 0.18, d * 0.72]} color={mixColor(A, '#ffffff', 0.1)} roughness={0.42} />
          {legs(h - q)}
          {chair(-0.34, -0.72, Math.PI)}
          {chair(0.34, -0.72, Math.PI)}
          {chair(-0.34, 0.72, 0)}
          {chair(0.34, 0.72, 0)}
        </group>
      )
    }
    case '书桌':
      return (
        <group>
          <FBox position={[0, h - q / 2, 0]} size={[w, q, d]} color={M} roughness={0.5} />
          {legs(h - q)}
          <FBox position={[0, h * 0.55, -d * 0.4]} size={[w * 0.48, h * 0.48, d * 0.16]} color={D} />
          <FBox position={[0, h + 0.14, -d * 0.18]} size={[w * 0.34, h * 0.36, 0.045]} color={mixColor(D, '#dff4ff', 0.28)} roughness={0.42} />
          <FBox position={[0, h + 0.015, -d * 0.18]} size={[0.06, 0.08, 0.05]} color={D} roughness={0.56} />
        </group>
      )
    case '衣柜':
      return (
        <group>
          <FBox position={[0, h / 2, 0]} size={[w, h, d]} color={M} />
          <FBox position={[0, h * 0.54, -d / 2 - 0.004]} size={[0.035, h * 0.76, 0.02]} color={D} />
          {[-0.25, 0.25].map(V => <FBox key={`h${V}`} position={[V * w, h * 0.54, -d / 2 - 0.012]} size={[0.018, h * 0.68, 0.018]} color={D} roughness={0.48} />)}
        </group>
      )
    case '橱柜':
      return (
        <group>
          <FBox position={[0, h / 2, 0]} size={[w, h, d]} color={M} />
          <FBox position={[0, h + 0.025, 0]} size={[w + 0.04, 0.05, d + 0.04]} color={D} roughness={0.5} />
          {[-0.22, 0, 0.22].map(V => <FBox key={`l${V}`} position={[V * w, h * 0.54, -d / 2 - 0.012]} size={[0.014, h * 0.62, 0.016]} color={D} roughness={0.48} />)}
        </group>
      )
    case '柜子': {
      // 程序化木柜（家具编辑器可调）：柜体 + 顶部面板 + 上部抽屉(可配) + 下部柜门(可配) + 把手(可关) + 踢脚
      const p = params || {}
      const drawers = p.drawers != null ? p.drawers : 1
      const doors = p.doors != null ? p.doors : 2
      const wood = p.color || '#a08a6f'
      const woodD = p.color ? mixColor(p.color, '#000000', 0.22) : '#7d6a52'
      const hasHandle = p.handles !== false
      const handleC = '#cfd4da'
      const topPanel = p.top !== false
      const drawerH = drawers > 0 ? h * 0.15 : 0
      const doorH = h - drawerH - h * 0.08  // 柜门区高（底部留踢脚）
      const doorY = h - drawerH - h * 0.03 - doorH / 2
      return (
        <group>
          <FBox position={[0, h / 2, 0]} size={[w, h, d]} color={wood} />
          {topPanel && <FBox position={[0, h + 0.014, 0]} size={[w + 0.04, 0.028, d + 0.04]} color={woodD} roughness={0.44} />}
          {/* 上部抽屉 */}
          {Array.from({ length: drawers }).map((_, i) => {
            const y = h - drawerH * (i + 0.5) - h * 0.02
            return (
              <group key={'dr' + i}>
                <FBox position={[0, y, d / 2 + 0.014]} size={[w * 0.9, drawerH * 0.92, 0.02]} color={woodD} roughness={0.52} />
                {hasHandle && <FBox position={[0, y, d / 2 + 0.032]} size={[0.18, 0.016, 0.014]} color={handleC} roughness={0.3} />}
              </group>
            )
          })}
          {/* 下部柜门：每扇绕铰链动画开合，相邻门朝相反方向打开 */}
          {Array.from({ length: doors }).map((_, i) => {
            const doorW = w / doors
            const pivotX = (i + 0.5) * doorW - w / 2 - doorW / 2  // 铰链在门的外侧边
            const angle = doorOpen ? (i % 2 === 0 ? -1.3 : 1.3) : 0
            return (
              <AnimatedRotate key={'dn' + i} to={angle} position={[pivotX, doorY, d / 2 + 0.014]}>
                <FBox position={[doorW / 2, 0, 0]} size={[doorW * 0.94, doorH, 0.022]} color={wood} roughness={0.5} />
                {hasHandle && <FBox position={[doorW / 2, 0, 0.018]} size={[0.16, 0.015, 0.014]} color={handleC} roughness={0.3} />}
              </AnimatedRotate>
            )
          })}
          {/* 底部踢脚 */}
          <FBox position={[0, h * 0.025, 0]} size={[w + 0.02, h * 0.05, d + 0.02]} color={woodD} roughness={0.6} />
        </group>
      )
    }
    case '岛台':
      return (
        <group>
          <FBox position={[0, h * 0.42, 0]} size={[w * 0.92, h * 0.84, d * 0.88]} color={M} />
          <FBox position={[0, h + 0.035, 0]} size={[w + 0.08, 0.07, d + 0.08]} color={D} roughness={0.44} />
          <mesh position={[w * 0.23, h + 0.076, -d * 0.12]} receiveShadow>
            <boxGeometry args={[w * 0.2, 0.012, d * 0.22]} />
            <meshPhysicalMaterial color="#d8e4e8" roughness={0.26} metalness={0.04} clearcoat={0.18} clearcoatRoughness={0.64} />
          </mesh>
          {[-0.08, 0.08].map(V => (
            <mesh key={`b${V}`} position={[w * -0.18 + V, h + 0.083, d * 0.12]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.055, 0.075, 24]} />
              <meshBasicMaterial color="#9fb0b8" transparent opacity={0.48} toneMapped={false} />
            </mesh>
          ))}
        </group>
      )
    case '茶几':
      return (
        <group>
          <mesh position={[0, h, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, Math.min(0.06, h * 0.18), d]} />
            <meshPhysicalMaterial color="#e6efee" roughness={0.22} metalness={0.015} clearcoat={0.22} clearcoatRoughness={0.54} transparent opacity={0.56} />
          </mesh>
          <FBox position={[0, h * 0.48, 0]} size={[w * 0.56, h * 0.16, d * 0.38]} color={M} roughness={0.56} />
          {legs(Math.max(0.16, h * 0.72))}
        </group>
      )
    case '书架':
      return (
        <group>
          <FBox position={[0, h / 2, d * 0.42]} size={[w, h, d * 0.12]} color={D} />
          <FBox position={[-w / 2 + 0.035, h / 2, 0]} size={[0.07, h, d]} color={M} />
          <FBox position={[w / 2 - 0.035, h / 2, 0]} size={[0.07, h, d]} color={M} />
          {[0.18, 0.38, 0.58, 0.78].map(V => <FBox key={`sh${V}`} position={[0, h * V, 0]} size={[w, 0.055, d]} color={M} roughness={0.56} />)}
          {[-0.28, -0.1, 0.1, 0.28].map((V, b) => <FBox key={`bk${V}`} position={[V * w, h * (0.26 + (b % 2) * 0.2), -d * 0.08]} size={[w * 0.1, h * 0.16, d * 0.42]} color={b % 2 ? '#8198a8' : '#9f8d7f'} roughness={0.66} />)}
        </group>
      )
    case '马桶': {
      const ceramic = (smooth) => (
        <meshPhysicalMaterial color="#f4f5f6" roughness={smooth ? 0.2 : 0.26} metalness={0.01} clearcoat={0.5} clearcoatRoughness={0.22} />
      )
      return (
        <group>
          {/* 水箱（矩形，后） */}
          <mesh position={[0, h * 0.55, d * 0.27]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.92, h * 0.5, d * 0.28]} />
            {ceramic(true)}
          </mesh>
          {/* 水箱盖 */}
          <mesh position={[0, h * 0.82, d * 0.27]}>
            <boxGeometry args={[w * 0.98, h * 0.06, d * 0.32]} />
            <meshPhysicalMaterial color="#fafbfc" roughness={0.16} clearcoat={0.6} />
          </mesh>
          {/* 冲水按钮 */}
          <mesh position={[0, h * 0.87, d * 0.27]}>
            <cylinderGeometry args={[w * 0.09, w * 0.09, h * 0.04, 20]} />
            <meshStandardMaterial color="#c2c7cf" metalness={0.5} roughness={0.25} />
          </mesh>
          {/* 座便器桶身（矩形） */}
          <mesh position={[0, h * 0.24, -d * 0.05]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.86, h * 0.36, d * 0.46]} />
            {ceramic(true)}
          </mesh>
          {/* 坐垫（环形，露出孔洞） */}
          <mesh position={[0, h * 0.44, -d * 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[w * 0.34, w * 0.07, 14, 40]} />
            <meshStandardMaterial color="#dfe3e8" roughness={0.35} />
          </mesh>
          {/* 底座（下宽） */}
          <mesh position={[0, h * 0.06, -d * 0.07]}>
            <boxGeometry args={[w * 0.66, h * 0.12, d * 0.4]} />
            {ceramic(false)}
          </mesh>
          {/* 进水管 */}
          <mesh position={[w * 0.46, h * 0.32, d * 0.27]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[w * 0.04, w * 0.04, w * 0.2, 14]} />
            <meshStandardMaterial color="#c2c7cf" metalness={0.55} roughness={0.25} />
          </mesh>
        </group>
      )
    }
    case '空气净化器':
      return (
        <group>
          {/* 方形机身（米家方形净化器） */}
          <mesh position={[0, h * 0.44, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h * 0.85, d]} />
            <meshPhysicalMaterial color="#f2f4f7" roughness={0.32} metalness={0.02} clearcoat={0.28} clearcoatRoughness={0.5} />
          </mesh>
          {/* 顶部出风口（圆环 + 中心 + 辐条） */}
          <mesh position={[0, h * 0.88, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[w * 0.26, w * 0.4, 40]} />
            <meshStandardMaterial color="#bcc2ca" roughness={0.3} />
          </mesh>
          <mesh position={[0, h * 0.885, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[w * 0.26, 40]} />
            <meshStandardMaterial color="#d5dae0" roughness={0.3} />
          </mesh>
          {[0, 60, 120].map((a) => (
            <mesh key={a} position={[0, h * 0.88, 0]} rotation={[0, a * Math.PI / 180, 0]}>
              <boxGeometry args={[w * 0.8, 0.014, 0.014]} />
              <meshStandardMaterial color="#bcc2ca" roughness={0.3} />
            </mesh>
          ))}
          {/* 前面 OLED 圆屏 + 空气质量环（绿色） */}
          <mesh position={[0, h * 0.36, -d * 0.5]}>
            <circleGeometry args={[w * 0.28, 32]} />
            <meshStandardMaterial color="#0d1015" roughness={0.18} metalness={0.3} />
          </mesh>
          <mesh position={[0, h * 0.36, -d * 0.501]} rotation={[0, 0, Math.PI]}>
            <ringGeometry args={[w * 0.28, w * 0.34, 32]} />
            <meshBasicMaterial color="#6ad4a0" />
          </mesh>
          {/* 底部进气细缝 */}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <mesh key={`s${i}`} position={[(i - 3) * w * 0.13, h * 0.04, -d * 0.5]}>
              <boxGeometry args={[0.006, h * 0.08, 0.008]} />
              <meshStandardMaterial color="#cfd4da" roughness={0.32} />
            </mesh>
          ))}
        </group>
      )
    case '电视机':
      return (
        <group>
          {/* 超薄机身 */}
          <mesh position={[0, h * 0.5, 0]} castShadow>
            <boxGeometry args={[w, h * 0.86, 0.028]} />
            <meshStandardMaterial color="#1a1d22" roughness={0.42} metalness={0.1} />
          </mesh>
          {/* 屏幕（反光） */}
          <mesh position={[0, h * 0.5, 0.015]}>
            <boxGeometry args={[w * 0.955, h * 0.8, 0.006]} />
            <meshPhysicalMaterial color="#0b0d10" roughness={0.1} metalness={0.12} clearcoat={0.65} clearcoatRoughness={0.12} />
          </mesh>
          {/* 下边框 logo 条 */}
          <mesh position={[0, h * 0.06, 0.015]}>
            <boxGeometry args={[w * 0.86, h * 0.05, 0.01]} />
            <meshStandardMaterial color="#33383f" roughness={0.5} />
          </mesh>
          {/* 两个八字支脚 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * w * 0.36, h * 0.025, 0]} castShadow>
              <boxGeometry args={[0.05, h * 0.05, d * 0.72]} />
              <meshStandardMaterial color="#272b31" roughness={0.45} metalness={0.35} />
            </mesh>
          ))}
        </group>
      )
    case '壁灯':
      return (
        <group>
          {/* 灯座（贴墙） */}
          <FBox position={[0, 0, 0]} size={[w * 0.6, h * 0.3, d * 0.8]} color={D} />
          {/* 灯罩（朝下的暖光球） */}
          <mesh position={[0, -h * 0.4, 0]}>
            <sphereGeometry args={[w * 0.45, 16, 12]} />
            <meshStandardMaterial color="#f6e7c0" emissive="#ffd98a" emissiveIntensity={0.5} />
          </mesh>
        </group>
      )
    case '挂画':
      return (
        <group>
          {/* 画框（薄板，用户旋转贴墙） */}
          <FBox position={[0, 0, 0]} size={[w, h, d]} color={D} />
          {/* 画心 */}
          <mesh position={[0, 0, d / 2 + 0.003]}>
            <planeGeometry args={[w * 0.82, h * 0.82]} />
            <meshStandardMaterial color="#d8c9a8" roughness={0.55} />
          </mesh>
        </group>
      )
    case '吊灯':
      return (
        <group>
          {/* 吊线（从天花板往下） */}
          <mesh position={[0, -h * 0.55, 0]}>
            <cylinderGeometry args={[0.012, 0.012, h * 0.9, 8]} />
            <meshStandardMaterial color="#3a3f47" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* 灯罩（锥形朝下） */}
          <mesh position={[0, -h, 0]}>
            <coneGeometry args={[w * 0.5, h * 0.4, 20]} />
            <meshStandardMaterial color="#f0e2b6" emissive="#ffd98a" emissiveIntensity={0.55} />
          </mesh>
          {/* 灯芯 */}
          <mesh position={[0, -h * 0.96, 0]}>
            <sphereGeometry args={[w * 0.09, 12, 12]} />
            <meshBasicMaterial color="#fff3c4" />
          </mesh>
        </group>
      )
    case '吸顶灯':
      return (
        <group>
          {/* 贴顶扁圆盘（朝下发光） */}
          <mesh position={[0, -h * 0.4, 0]}>
            <cylinderGeometry args={[w * 0.5, w * 0.48, h, 24]} />
            <meshStandardMaterial color="#f0e2b6" emissive="#ffe9a8" emissiveIntensity={0.5} />
          </mesh>
        </group>
      )
    case '筒灯':
      return (
        <group>
          {/* 嵌入式小圆盘（朝下） */}
          <mesh position={[0, -h * 0.4, 0]}>
            <cylinderGeometry args={[w * 0.5, w * 0.5, h, 20]} />
            <meshStandardMaterial color="#f0e2b6" emissive="#fff0c0" emissiveIntensity={0.45} />
          </mesh>
        </group>
      )
    case '空调':
      return (
        <group>
          {/* 壁挂分体空调：白色扁机身 */}
          <FBox position={[0, 0, 0]} size={[w, h, d]} color="#f5f7fa" roughness={0.32} />
          {/* 出风口格栅 */}
          <mesh position={[0, -h * 0.18, d / 2 + 0.002]}>
            <planeGeometry args={[w * 0.82, h * 0.34]} />
            <meshStandardMaterial color="#c3ccd4" roughness={0.45} />
          </mesh>
          {[-1, 0, 1].map((i) => (
            <mesh key={i} position={[i * w * 0.25, -h * 0.18, d / 2 + 0.004]}>
              <planeGeometry args={[w * 0.2, h * 0.3]} />
              <meshStandardMaterial color="#d8dee4" roughness={0.4} />
            </mesh>
          ))}
          {/* 指示灯 */}
          <mesh position={[w * 0.32, h * 0.16, d / 2 + 0.006]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshBasicMaterial color="#4ade80" />
          </mesh>
        </group>
      )
    case '热水器':
      return (
        <group>
          {/* 储水式电热水器：横卧白色圆筒 */}
          <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[h * 0.5, h * 0.5, d, 24]} />
            <meshStandardMaterial color="#f5f7fa" roughness={0.35} metalness={0.02} />
          </mesh>
          {/* 端盖 */}
          <mesh position={[d / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <circleGeometry args={[h * 0.5, 24]} />
            <meshStandardMaterial color="#e8ecef" roughness={0.35} />
          </mesh>
          {/* 底部进出水管 */}
          <mesh position={[0, -h * 0.5 - 0.02, 0]}>
            <cylinderGeometry args={[0.028, 0.028, 0.3, 8]} />
            <meshStandardMaterial color="#c0c6cc" metalness={0.4} roughness={0.3} />
          </mesh>
        </group>
      )
    case '窗帘': {
      // 逼真窗帘：顶部金属导轨（与闭合帘同宽）+ 左右两片褶皱布帘（缓慢开合动画，闭合占满导轨、打开收拢滑向两侧）+ 帘头
      const cp = curtainPos != null ? Math.max(0, Math.min(100, curtainPos)) : 100
      const targetOpen = cp / 100  // 0=闭合 1=全开
      const folds = 8
      const fabric = (params && params.color) || '#dcd3c4'
      const fabricDark = mixColor(fabric, '#000000', 0.13)
      const fabricLight = mixColor(fabric, '#ffffff', 0.12)
      const rodY = h
      return (
        <group>
          {/* 顶部金属导轨（与闭合窗帘同宽，两端齐平） */}
          <mesh position={[0, rodY + 0.02, 0]}>
            <boxGeometry args={[w, 0.04, 0.045]} />
            <meshStandardMaterial color="#8a9aa8" metalness={0.55} roughness={0.28} />
          </mesh>
          {/* 导轨两端圆头 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (w / 2 - 0.03), rodY + 0.02, 0]}>
              <cylinderGeometry args={[0.022, 0.022, 0.03, 8]} />
              <meshStandardMaterial color="#7d8b99" metalness={0.6} roughness={0.25} />
            </mesh>
          ))}
          <CurtainHalf side={-1} w={w} targetOpen={targetOpen} rodY={rodY} folds={folds} fabric={fabric} fabricDark={fabricDark} fabricLight={fabricLight} shrink={params && params.shrink} />
          <CurtainHalf side={1} w={w} targetOpen={targetOpen} rodY={rodY} folds={folds} fabric={fabric} fabricDark={fabricDark} fabricLight={fabricLight} shrink={params && params.shrink} />
        </group>
      )
    }
    case '门': {
      // 室内门：门框 + 门扇（绕左侧铰链向外开合 90°）+ 门把手，点击/模型状态切换控制 doorOpen
      const wood = (params && params.color) || '#b8a98f'
      const woodD = params && params.color ? mixColor(params.color, '#000000', 0.25) : '#8a7c66'
      return (
        <group>
          {/* 门框 */}
          <FBox position={[0, h / 2, 0]} size={[w + 0.08, h, 0.08]} color={woodD} roughness={0.7} />
          {/* 门扇（绕左侧铰链向外开） */}
          <AnimatedRotate to={doorOpen ? 1.4 : 0} position={[-w / 2 + 0.02, h / 2, 0]}>
            <FBox position={[w / 2 - 0.02, 0, 0]} size={[w - 0.04, h - 0.06, 0.04]} color={wood} roughness={0.6} />
            {/* 门把手 */}
            <FBox position={[w - 0.12, 0, 0.03]} size={[0.02, 0.14, 0.03]} color="#cfd4da" roughness={0.3} />
          </AnimatedRotate>
          {/* 门上沿 */}
          <FBox position={[0, h + 0.04, 0]} size={[w + 0.1, 0.05, 0.08]} color={woodD} roughness={0.7} />
        </group>
      )
    }
    case '传感器':
      return (
        <group>
          {/* 小圆盘（贴墙） */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[w * 0.5, w * 0.5, h, 16]} />
            <meshStandardMaterial color="#eef2f5" roughness={0.35} />
          </mesh>
          {/* 指示灯 */}
          <mesh position={[0, 0, d * 0.3]}>
            <sphereGeometry args={[w * 0.15, 8, 8]} />
            <meshBasicMaterial color="#4ade80" />
          </mesh>
        </group>
      )
    case '灯带':
      return (
        <group>
          {/* 细长发光的灯带 */}
          <mesh position={[0, 0, 0]} castShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color="#ffe9a8" emissive="#FFEBC2" emissiveIntensity={0.8} />
          </mesh>
        </group>
      )
    case '开关':
      return (
        <group>
          {/* 墙面开关：小面板 + 翘板按键 */}
          <FBox position={[0, 0, 0]} size={[w, h, d]} color="#eef2f5" roughness={0.35} />
          <mesh position={[0, h * 0.1, d / 2 + 0.002]}>
            <boxGeometry args={[w * 0.56, h * 0.44, d * 0.25]} />
            <meshStandardMaterial color="#c3ccd4" roughness={0.42} />
          </mesh>
        </group>
      )
    case '感应器':
      return (
        <group>
          {/* 人体感应器：底座 + 半球透镜 */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[w * 0.5, w * 0.5, h, 16]} />
            <meshStandardMaterial color="#eef2f5" roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, d * 0.42]}>
            <sphereGeometry args={[w * 0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#3a4658" roughness={0.2} metalness={0.15} />
          </mesh>
        </group>
      )
    case '风扇':
      return (
        <group>
          {/* 吊扇：中间电机 + 4 片扇叶 */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[w * 0.12, w * 0.12, h * 0.5, 16]} />
            <meshStandardMaterial color="#e8edf2" roughness={0.4} />
          </mesh>
          {[0, 1, 2, 3].map((i) => {
            const ang = i * Math.PI / 2
            return (
              <mesh key={i} position={[Math.cos(ang) * w * 0.3, 0, Math.sin(ang) * w * 0.3]} rotation={[0, -ang, 0]}>
                <boxGeometry args={[w * 0.42, d * 0.04, h * 0.1]} />
                <meshStandardMaterial color="#cfd8e2" roughness={0.5} />
              </mesh>
            )
          })}
        </group>
      )
    default:
      return <FBox position={[0, h / 2, 0]} size={[w, h, d]} color={M} />
  }
}

// 风扇叶片旋转（设备开着时转，axis 指定旋转轴）
function Spinner({ on, speed = 10, axis = 'y', children }) {
  const ref = useRef()
  useFrame((_, dt) => { if (on && ref.current) ref.current.rotation[axis] += dt * speed })
  return <group ref={ref}>{children}</group>
}
// 空调气流着色器（直接照搬 JMGLink 原版 AC 气流动画：流动的空气粒子流）
const AIRFLOW_VERT = `
  precision mediump float;
  uniform float uTime; uniform float uSpeed; uniform float uPhase; uniform float uDrop;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 transformed = position;
    float travel = smoothstep(0.0, 1.0, uv.y);
    float edge = abs(uv.x - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.55, 1.0, edge);
    float spread = 0.72 + travel * 0.46;
    float wave = sin((uv.y * 2.7 - uTime * uSpeed + uPhase) * 6.2831853);
    float surfaceRipple = sin((uv.y * 4.2 + uv.x * 1.15 - uTime * uSpeed * 0.56 + uPhase) * 6.2831853);
    transformed.x = position.x * spread + wave * 0.02 * travel * core;
    transformed.z += pow(travel, 1.34) * uDrop + surfaceRipple * 0.012 * travel * (0.3 + core * 0.7);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`
const AIRFLOW_FRAG = `
  precision mediump float;
  uniform float uTime; uniform vec3 uColor; uniform float uOpacity; uniform float uSpeed; uniform float uPhase;
  varying vec2 vUv;
  void main() {
    float along = vUv.y;
    float across = abs(vUv.x - 0.5) * 2.0;
    float sideFade = pow(1.0 - smoothstep(0.52, 1.0, across), 1.55);
    float startFade = smoothstep(0.02, 0.14, along);
    float endFade = 1.0 - smoothstep(0.78, 1.0, along);
    float pulse = 0.5 + 0.5 * sin((along * 3.4 - uTime * uSpeed + uPhase) * 6.2831853);
    float vein = smoothstep(0.58, 1.0, sin((along * 5.8 + vUv.x * 1.7 - uTime * uSpeed * 0.68 + uPhase) * 6.2831853));
    float coreGlow = pow(1.0 - across, 2.4);
    float alpha = sideFade * startFade * endFade * uOpacity * (0.46 + pulse * 0.18 + vein * 0.18 + coreGlow * 0.22);
    vec3 coolCore = mix(vec3(0.62, 0.93, 1.0), uColor, 0.72);
    vec3 airyColor = mix(coolCore, vec3(1.0), coreGlow * 0.2);
    gl_FragColor = vec4(airyColor, alpha);
    if (gl_FragColor.a < 0.004) discard;
  }
`

// 气流粒子流（原版 mn）
function FlowPlane({ color, drop, length, opacity, phase, speed, startZ, width, scale = 1 }) {
  const mat = useRef()
  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(color) },
    uDrop: { value: drop },
    uOpacity: { value: opacity },
    uPhase: { value: phase },
    uSpeed: { value: speed },
    uTime: { value: 0 },
  }), [])
  useFrame((state) => { if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime })
  return (
    <mesh position={[0, 0, (startZ + length / 2) * scale]} rotation={[Math.PI / 2, 0, 0]} scale={scale} renderOrder={10}>
      <planeGeometry args={[width, length, 12, 56]} />
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={AIRFLOW_VERT} fragmentShader={AIRFLOW_FRAG}
        transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

// 空调气流（原版 Nh：点光 + 发光条 + 两条气流粒子流）
function Airflow({ color, scale = 1 }) {
  const t = mixColor(color, '#28cfff', 0.72)
  const s = mixColor(t, '#ffffff', 0.18)
  return (
    <group position={[0, -0.066 * scale, 0.095 * scale]}>
      <pointLight color={s} intensity={1.34} distance={2.05} position={[0, -0.14 * scale, 0.42 * scale]} decay={2} />
      <mesh position={[0, 0.012 * scale, 0.006 * scale]} renderOrder={11}>
        <planeGeometry args={[0.46 * scale, 0.04 * scale]} />
        <meshBasicMaterial color={s} transparent opacity={0.76} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <FlowPlane color={t} drop={0.44} length={1.08} opacity={0.54} phase={0.08} speed={0.46} startZ={0.03} width={0.58} scale={scale} />
      <FlowPlane color={mixColor(t, '#ffffff', 0.22)} drop={0.37} length={0.92} opacity={0.36} phase={0.38} speed={0.38} startZ={0.06} width={0.36} scale={scale} />
    </group>
  )
}

// ---------- 设备模型（对齐 JMGLink 原版 49 个设备模型，程序化几何） ----------
// rgb_color [r,g,b] 0-255 → '#rrggbb'
function rgbToHex(rgb) {
  try {
    return '#' + rgb.slice(0, 3).map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')
  } catch { return '#FFEBC2' }
}
// 色温 kelvin → 近似 RGB（1000-40000K 的常用近似，2700 暖白 → 6500 冷白）
function kelvinToHex(k) {
  const t = Math.max(1000, Math.min(40000, Number(k) || 4000)) / 100
  let r, g, b
  if (t <= 66) {
    r = 255
    g = 99.47 * Math.log(t) - 161.12
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332)
    g = 288.12 * Math.pow(t - 60, -0.0755)
    b = 255
  }
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)))
  return '#' + [c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('')
}
// id 形如 "light.ceiling" / "switch.wall" / "fan.ceiling"，kind 是第一段，variant 是第二段
export function DeviceModel({ id, w, d, h, isOn, state }) {
  const kind = (id || '').split('.')[0]
  const variant = (id || '').split('.')[1] || ''
  // 灯颜色：优先 rgb_color，其次 color_temp_kelvin（转暖白/冷白），最后默认黄
  const attrs = (state && state.attributes) || {}
  const lightColor = kind === 'light' && isOn
    ? (Array.isArray(attrs.rgb_color) ? rgbToHex(attrs.rgb_color) : (attrs.color_temp_kelvin != null ? kelvinToHex(attrs.color_temp_kelvin) : '#FFEBC2'))
    : '#FFEBC2'
  const light = isOn ? lightColor : '#e8edf2'
  // 窗帘开合比例：优先 current_position(0=关,100=开)，否则按 state 判断（closed=关）
  const coverPos = kind === 'cover' ? (attrs.current_position != null ? Number(attrs.current_position) : (state && state.state === 'closed' ? 0 : 100)) : 100
  const openRatio = Math.max(0, Math.min(100, coverPos)) / 100
  // 门(binary_sensor.door)开合：state 'on' = 开
  const doorOpen = kind === 'binary_sensor' && variant === 'door' ? isOn : false

  if (kind === 'light') {
    if (variant === 'chandelier') {
      return <group>
        <mesh position={[0, h * 0.35, 0]}><cylinderGeometry args={[0.015, 0.015, h * 0.6, 8]} /><meshStandardMaterial color="#8a9aa8" /></mesh>
        <mesh position={[0, 0, 0]}><sphereGeometry args={[w * 0.28, 16, 12]} /><meshStandardMaterial color={light} emissive={light} emissiveIntensity={isOn ? 0.8 : 0.1} /></mesh>
      </group>
    }
    if (variant === 'floor_lamp') {
      return <group>
        <mesh position={[0, h * 0.45, 0]}><cylinderGeometry args={[0.015, 0.015, h * 0.9, 8]} /><meshStandardMaterial color="#8a9aa8" /></mesh>
        <mesh position={[0, 0, 0]}><coneGeometry args={[w * 0.5, h * 0.18, 16]} /><meshStandardMaterial color={light} emissive={light} emissiveIntensity={isOn ? 0.8 : 0.1} /></mesh>
      </group>
    }
    if (variant === 'strip') {
      return <mesh><boxGeometry args={[w, h, d]} /><meshStandardMaterial color="#ffe9a8" emissive="#FFEBC2" emissiveIntensity={0.8} /></mesh>
    }
    if (variant === 'downlight') {
      return <mesh><cylinderGeometry args={[w * 0.5, w * 0.55, h, 16]} /><meshStandardMaterial color={light} emissive={light} emissiveIntensity={isOn ? 0.9 : 0.15} /></mesh>
    }
    // ceiling 吸顶灯
    return <group>
      <mesh><boxGeometry args={[w, h, d]} /><meshStandardMaterial color={light} emissive={light} emissiveIntensity={isOn ? 0.7 : 0.1} /></mesh>
    </group>
  }

  if (kind === 'switch') {
    const n = variant === 'double' ? 2 : variant === 'triple' ? 3 : 1
    return <group>
      <FBox position={[0, 0, 0]} size={[w, h, d]} color="#eef2f5" roughness={0.35} />
      {Array.from({ length: n }).map((_, i) => (
        <mesh key={i} position={[0, (i - (n - 1) / 2) * (h / (n + 1)), d / 2 + 0.002]}>
          <boxGeometry args={[w * 0.5, h / (n + 1) * 0.5, d * 0.2]} />
          <meshStandardMaterial color="#c3ccd4" roughness={0.42} />
        </mesh>
      ))}
    </group>
  }

  if (kind === 'cover') {
    const closed = 1 - openRatio
    return <group>
      <mesh position={[0, h * 0.48, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.02, 0.02, w, 8]} /><meshStandardMaterial color="#8a9aa8" /></mesh>
      {variant === 'blind' ? (
        // 百叶帘：关=叶片铺开下垂，开=叶片收起顶部
        Array.from({ length: 8 }).map((_, i) => (
          <mesh key={i} position={[0, h * 0.42 - i * (h * 0.1) * closed, 0]}><boxGeometry args={[w * 0.92, 0.012, d * 0.4]} /><meshStandardMaterial color="#cfd8e2" /></mesh>
        ))
      ) : (
        // 单向窗帘：关=面板铺满，开=面板收到右侧
        [-0.3, -0.1, 0.1, 0.3].map((V) => (
          <mesh key={V} position={[V * w * closed + 0.4 * w * openRatio, -h * 0.26, 0]}><boxGeometry args={[w * 0.18, h * 0.5, d * 0.5]} /><meshStandardMaterial color="#9fb8c8" roughness={0.7} /></mesh>
        ))
      )}
    </group>
  }

  if (kind === 'climate') {
    if (variant === 'central_ac') {
      return <group>
        <mesh><boxGeometry args={[w, h, d]} /><meshStandardMaterial color="#eef2f5" /></mesh>
        <mesh position={[0, 0, d / 2 + 0.002]}><planeGeometry args={[w * 0.8, h * 0.7]} /><meshStandardMaterial color="#c3ccd4" /></mesh>
      </group>
    }
    if (variant === 'floor_ac') {
      return <group><FBox position={[0, 0, 0]} size={[w, h, d]} color="#f5f7fa" roughness={0.35} /><mesh position={[0, h * 0.36, d / 2 + 0.002]}><planeGeometry args={[w * 0.8, h * 0.18]} /><meshStandardMaterial color="#c3ccd4" /></mesh></group>
    }
    if (variant === 'thermostat') {
      return <group>
        <FBox position={[0, 0, 0]} size={[w, h, d]} color="#eef2f5" roughness={0.35} />
        <mesh position={[0, 0, d / 2 + 0.002]}><planeGeometry args={[w * 0.7, h * 0.6]} /><meshStandardMaterial color="#4a5560" /></mesh>
      </group>
    }
    // wall_ac 壁挂空调（对齐原版：开机制冷出青蓝色气流，制热偏暖色）
    const acOn = isOn
    const acColor = acOn ? '#eef7ff' : '#f5f7fa'
    return <group>
      <FBox position={[0, 0, 0]} size={[w, h, d]} color={acColor} roughness={0.32} />
      <mesh position={[0, -h * 0.18, d / 2 + 0.002]}><planeGeometry args={[w * 0.82, h * 0.34]} /><meshStandardMaterial color="#c3ccd4" emissive={acOn ? '#35cfff' : '#000000'} emissiveIntensity={acOn ? 0.5 : 0} /></mesh>
      <mesh position={[w * 0.32, h * 0.16, d / 2 + 0.004]}><sphereGeometry args={[0.015, 8, 8]} /><meshBasicMaterial color={acOn ? '#35cfff' : '#8899aa'} /></mesh>
      {acOn && <Airflow color="#e8fbff" scale={w / 0.54} />}
    </group>
  }

  if (kind === 'sensor') {
    return <group>
      <mesh><cylinderGeometry args={[w * 0.5, w * 0.5, h, 16]} /><meshStandardMaterial color="#eef2f5" /></mesh>
      <mesh position={[0, 0, d * 0.35]}><sphereGeometry args={[w * 0.14, 8, 8]} /><meshBasicMaterial color="#4ade80" /></mesh>
    </group>
  }

  if (kind === 'binary_sensor') {
    if (variant === 'door') {
      // 门磁：门框 + 可转动的门扇（state on=开，门扇绕左侧铰链转开）
      return <group>
        <FBox position={[-w * 0.42, 0, 0]} size={[w * 0.14, h * 0.9, d * 0.5]} color="#8a9aa8" />
        <FBox position={[w * 0.42, 0, 0]} size={[w * 0.14, h * 0.9, d * 0.5]} color="#8a9aa8" />
        <FBox position={[0, h * 0.42, 0]} size={[w, h * 0.12, d * 0.5]} color="#8a9aa8" />
        <group position={[-w * 0.42, 0, 0]} rotation={[0, -doorOpen * 1.9, 0]}>
          <FBox position={[w * 0.42, 0, 0]} size={[w * 0.84, h * 0.82, d * 0.36]} color={doorOpen ? '#cfe3ee' : '#eef2f5'} />
        </group>
      </group>
    }
    if (variant === 'smoke') {
      return <group>
        <mesh><cylinderGeometry args={[w * 0.5, w * 0.55, h, 20]} /><meshStandardMaterial color="#eef2f5" /></mesh>
        <mesh position={[0, h * 0.15, 0]}><sphereGeometry args={[w * 0.2, 8, 8]} /><meshStandardMaterial color={isOn ? '#ff6b6b' : '#d8dee4'} emissive={isOn ? '#ff4444' : '#000'} emissiveIntensity={isOn ? 0.8 : 0} /></mesh>
      </group>
    }
    if (variant === 'water') {
      return <mesh><boxGeometry args={[w, h, d]} /><meshStandardMaterial color={isOn ? '#ff6b6b' : '#d8e8f0'} /></mesh>
    }
    // motion / presence / wall 人体/存在/通用安防传感器
    return <group>
      <mesh><cylinderGeometry args={[w * 0.5, w * 0.5, h, 16]} /><meshStandardMaterial color="#eef2f5" /></mesh>
      <mesh position={[0, 0, d * 0.4]}><sphereGeometry args={[w * 0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={isOn ? '#ff6b6b' : '#3a4658'} emissive={isOn ? '#ff4444' : '#000'} emissiveIntensity={isOn ? 0.6 : 0} /></mesh>
    </group>
  }

  if (kind === 'camera') {
    if (variant === 'dome') {
      return <group>
        <mesh><cylinderGeometry args={[w * 0.5, w * 0.55, h * 0.5, 16]} /><meshStandardMaterial color="#eef2f5" /></mesh>
        <mesh position={[0, h * 0.25, 0]}><sphereGeometry args={[w * 0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#1a2030" /></mesh>
      </group>
    }
    if (variant === 'bullet') {
      return <group>
        <mesh><boxGeometry args={[w, d, h]} /><meshStandardMaterial color="#eef2f5" /></mesh>
        <mesh position={[w * 0.5, 0, 0]}><cylinderGeometry args={[d * 0.4, d * 0.4, d * 0.1, 16]} /><meshStandardMaterial color="#1a2030" /></mesh>
      </group>
    }
    if (variant === 'doorbell') {
      return <group>
        <FBox position={[0, 0, 0]} size={[w, h, d]} color="#eef2f5" roughness={0.35} />
        <mesh position={[0, 0, d / 2 + 0.002]}><sphereGeometry args={[w * 0.22, 12, 8]} /><meshStandardMaterial color="#1a2030" /></mesh>
      </group>
    }
    // wall 摄像头
    return <group>
      <mesh><boxGeometry args={[w, h, d]} /><meshStandardMaterial color="#eef2f5" /></mesh>
      <mesh position={[0, 0, d / 2 + 0.002]}><cylinderGeometry args={[w * 0.28, w * 0.28, d * 0.2, 16]} /><meshStandardMaterial color="#1a2030" /></mesh>
    </group>
  }

  if (kind === 'lock') {
    return <group>
      <FBox position={[0, 0, 0]} size={[w, h, d]} color="#8a9aa8" roughness={0.3} metalness={0.3} />
      <mesh position={[0, 0, d / 2 + 0.002]}><cylinderGeometry args={[w * 0.18, w * 0.18, d * 0.15, 12]} /><meshStandardMaterial color="#1a2030" emissive={isOn ? '#35cfff' : '#000000'} emissiveIntensity={isOn ? 0.5 : 0} /></mesh>
      <mesh position={[0, h * 0.22, d / 2 + 0.004]}><circleGeometry args={[w * 0.1, 16]} /><meshBasicMaterial color={isOn ? '#35cfff' : '#5a6b7e'} /></mesh>
    </group>
  }

  if (kind === 'fan') {
    if (variant === 'floor') {
      return <group>
        <mesh position={[0, h * 0.42, 0]}><cylinderGeometry args={[0.02, 0.02, h * 0.8, 8]} /><meshStandardMaterial color="#8a9aa8" /></mesh>
        <mesh position={[0, 0, 0]}><cylinderGeometry args={[w * 0.5, w * 0.52, h * 0.12, 24]} /><meshStandardMaterial color="#cfd8e2" /></mesh>
        <Spinner on={isOn} axis="z" speed={14}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} rotation={[0, 0, i * Math.PI * 2 / 3]} position={[0, 0, 0]}>
              <boxGeometry args={[w * 0.42, 0.02, h * 0.1]} />
              <meshStandardMaterial color="#e8edf2" />
            </mesh>
          ))}
        </Spinner>
        <mesh position={[0, 0, 0]}><sphereGeometry args={[w * 0.14, 12, 8]} /><meshStandardMaterial color="#aab6c4" /></mesh>
      </group>
    }
    if (variant === 'tower') {
      return <group>
        <mesh position={[0, h * 0.45, 0]}><cylinderGeometry args={[w * 0.5, w * 0.52, h * 0.9, 22]} /><meshStandardMaterial color="#e8edf2" /></mesh>
        {isOn && <mesh position={[0, 0, 0]}><cylinderGeometry args={[w * 0.4, w * 0.42, h * 0.02, 22]} /><meshBasicMaterial color="#35cfff" transparent opacity={0.6} /></mesh>}
      </group>
    }
    // ceiling 吊扇
    return <group>
      <mesh><cylinderGeometry args={[w * 0.12, w * 0.12, h * 0.5, 16]} /><meshStandardMaterial color="#e8edf2" /></mesh>
      <Spinner on={isOn}>
        {[0, 1, 2, 3].map((i) => {
          const ang = i * Math.PI / 2
          return <mesh key={i} position={[Math.cos(ang) * w * 0.3, 0, Math.sin(ang) * w * 0.3]} rotation={[0, -ang, 0]}><boxGeometry args={[w * 0.42, d * 0.04, h * 0.1]} /><meshStandardMaterial color="#cfd8e2" /></mesh>
        })}
      </Spinner>
    </group>
  }

  if (kind === 'media_player') {
    if (variant === 'speaker') {
      return <mesh><boxGeometry args={[w, h, d]} /><meshStandardMaterial color="#3a4658" /></mesh>
    }
    // tv 电视
    return <group>
      <mesh><boxGeometry args={[w, h, d]} /><meshStandardMaterial color="#11151c" /></mesh>
      <mesh position={[0, 0, d / 2 + 0.002]}><planeGeometry args={[w * 0.94, h * 0.94]} /><meshStandardMaterial color="#1a2030" emissive="#3a5a8a" emissiveIntensity={isOn ? 0.4 : 0.05} /></mesh>
    </group>
  }

  if (kind === 'vacuum') {
    return <group>
      <mesh><cylinderGeometry args={[w * 0.5, w * 0.5, h, 24]} /><meshStandardMaterial color="#eef2f5" /></mesh>
      <mesh position={[0, h * 0.5, 0]}><cylinderGeometry args={[w * 0.35, w * 0.35, h * 0.2, 24]} /><meshStandardMaterial color="#cfd8e2" /></mesh>
    </group>
  }

  if (kind === 'alarm_control_panel') {
    return <group>
      <FBox position={[0, 0, 0]} size={[w, h, d]} color="#eef2f5" roughness={0.35} />
      <mesh position={[0, 0, d / 2 + 0.002]}><planeGeometry args={[w * 0.7, h * 0.6]} /><meshStandardMaterial color="#1a2030" emissive={isOn ? '#ff4444' : '#2f3a48'} emissiveIntensity={isOn ? 0.5 : 0.1} /></mesh>
    </group>
  }

  // custom 通用设备
  return <mesh><boxGeometry args={[w, h, d]} /><meshStandardMaterial color="#8f9fbb" /></mesh>
}

// 选中高亮框（蓝色线框）
function SelectBox({ center, size, rot }) {
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2])
    return new THREE.EdgesGeometry(g)
  }, [size[0], size[1], size[2]])
  return (
    <lineSegments geometry={geo} position={[center[0], center[1], center[2]]} rotation={[0, (rot || 0) * Math.PI / 180, 0]}>
      <lineBasicMaterial color="#3D88FF" />
    </lineSegments>
  )
}

// ---------- 单个家具（支持选择工具下拖动移动） ----------
// 绑定实体的模型顶上的状态灯：点中（selected）时脉冲动画，表示可控制
function StatusPulse({ on, selected, y }) {
  // 绑定实体的状态灯：灰=关 黄=开；不再选中脉动（选中效果由 SelectionEffect 负责）
  return (
    <mesh position={[0, y, 0]}>
      <sphereGeometry args={[0.07, 12, 8]} />
      <meshBasicMaterial color={on ? '#ffd08a' : '#556078'} toneMapped={false} />
    </mesh>
  )
}

// 选中模型指示效果（设置→选中指示）：光环/脉冲/光柱/顶部环/无，呼吸动画（对齐大厂选中交互）
function SelectionEffect({ effect, w, d, h }) {
  const ref = useRef()
  const outlineCfg = useStore((s) => s.selectOutline)
  const { size: canvasSize } = useThree()
  const speed = (outlineCfg && outlineCfg.speed) || 3.5
  const outlineSize = (outlineCfg && outlineCfg.size != null) ? outlineCfg.size : 0.18
  const outlineWidth = (outlineCfg && outlineCfg.width) || 2
  const outlineMode = (outlineCfg && outlineCfg.mode) || 'frame'
  // 外框描边（Line2 可调线宽；useMemo 避免 React 重渲染打断呼吸动画）
  // ⚠️ LineSegments2/LineSegmentsGeometry/LineMaterial 是单独 import 的类，不在 THREE 命名空间（THREE.LineSegments2 不存在会崩）
  const frameLine = useMemo(() => {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + outlineSize, h + outlineSize, d + outlineSize))
    const geo = new LineSegmentsGeometry()
    geo.setPositions(edges.attributes.position.array)
    const mat = new LineMaterial({ color: 0x3D88FF, linewidth: outlineWidth, transparent: true, opacity: 0.85, toneMapped: false })
    const line = new LineSegments2(geo, mat)
    line.position.y = h / 2
    return line
  }, [w, h, d, outlineSize, outlineWidth])
  useFrame(({ clock }) => {
    const r = ref.current
    if (!r) return
    const t = clock.getElapsedTime()
    const s = 1 + Math.sin(t * speed) * 0.12
    r.scale.setScalar(s)
    if (r.material && r.material.opacity != null) r.material.opacity = 0.5 + Math.sin(t * speed) * 0.2
    // Line2 需要渲染器尺寸才能正确显示线宽
    if (r.material && r.material.resolution) r.material.resolution.set(canvasSize.width, canvasSize.height)
  })
  if (effect === 'glow') {
    return (
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[Math.max(w, d) * 0.55, Math.max(w, d) * 0.7, 48]} />
        <meshBasicMaterial color="#3D88FF" transparent opacity={0.6} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    )
  }
  if (effect === 'pulse') {
    return (
      <mesh ref={ref} position={[0, h + 0.18, 0]}>
        <sphereGeometry args={[0.06, 16, 12]} />
        <meshBasicMaterial color="#3D88FF" transparent opacity={0.9} toneMapped={false} />
      </mesh>
    )
  }
  if (effect === 'column') {
    return (
      <mesh ref={ref} position={[0, h + 0.35, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.4, 12]} />
        <meshBasicMaterial color="#3D88FF" transparent opacity={0.85} toneMapped={false} />
      </mesh>
    )
  }
  if (effect === 'ring') {
    return (
      <mesh ref={ref} position={[0, h + 0.28, 0]}>
        <ringGeometry args={[0.16, 0.22, 40]} />
        <meshBasicMaterial color="#3D88FF" transparent opacity={0.85} toneMapped={false} />
      </mesh>
    )
  }
  if (effect === 'outline') {
    // 选中描边（复刻原版 OutlineEffect 风格，可配置宽度/位置/大小/呼吸）
    if (outlineMode === 'halo') {
      return (
        <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <ringGeometry args={[Math.max(w, d) * 0.55, Math.max(w, d) * (0.55 + outlineSize), 48]} />
          <meshBasicMaterial color="#3D88FF" transparent opacity={0.6} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )
    }
    if (outlineMode === 'top') {
      return (
        <mesh ref={ref} position={[0, h + outlineSize + 0.08, 0]}>
          <ringGeometry args={[Math.max(w, d) * 0.5, Math.max(w, d) * (0.5 + outlineSize), 40]} />
          <meshBasicMaterial color="#3D88FF" transparent opacity={0.85} toneMapped={false} />
        </mesh>
      )
    }
    return <primitive object={frameLine} ref={ref} />
  }
  return null
}

// 电视/屏幕画面：<video> → VideoTexture 贴到模型前表面（item.screen = { video, on, scale, offsetX, offsetY, offsetZ }）。
// 开关：on=true 播放，on=false 暂停（返回 null 不渲染 = 画面消失）。muted+playsInline 才能自动播放。
// 「编辑画面」模式（选中 + store.editingScreen）显示两个手柄：
//   绿色（画面中心）= 拖动画面上下左右移动（offsetX/offsetY）；蓝色（右下角）= 等比缩放画面（scale）。
// 拖手柄时临时禁用 OrbitControls（否则镜头被带着转）；offsetZ（前后）在属性面板输入。松手写回 store 保存。
function VideoScreen({ item, w, d, h, selected }) {
  const [tex, setTex] = useState(null)
  const videoRef = useRef(null)
  const editing = useStore((s) => s.editingScreen)
  const showHandles = selected && editing
  const ox = item.screen.offsetX || 0
  const oy = item.screen.offsetY || 0
  const oz = item.screen.offsetZ || 0
  const baseScale = item.screen.scale || 1
  const [drag, setDrag] = useState(null)  // 拖拽中本地值 {scale, ox, oy}，null=未拖拽
  const dragRef = useRef(null)
  const sc = drag ? drag.scale : baseScale
  const dOx = drag ? drag.ox : ox
  const dOy = drag ? drag.oy : oy
  useEffect(() => {
    if (!item.screen || !item.screen.video) return
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.loop = true
    v.muted = true
    v.playsInline = true
    v.autoplay = true
    v.src = item.screen.video  // 相对路径（页面同源，避免跨域纹理污染）
    v.play().catch(() => {})
    const t = new THREE.VideoTexture(v)
    t.colorSpace = THREE.SRGBColorSpace
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    setTex(t)
    videoRef.current = v
    return () => { v.pause(); v.src = ''; v.load(); t.dispose() }
  }, [item.screen && item.screen.video])
  // 开关：打开→播放，关闭→暂停（不渲染）
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (item.screen.on) v.play().catch(() => {})
    else v.pause()
  }, [item.screen.on])
  if (!tex || !item.screen.on) return null
  const hw = (w * 0.94 / 2) * sc
  const hh = (h * 0.88 / 2) * sc
  const sx = dOx, sy = h * 0.5 + dOy, sz = d / 2 + 0.012 + oz
  const beginDrag = (e) => {
    e.stopPropagation()
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId)
    if (window.__orbitControls) window.__orbitControls.enabled = false  // 拖手柄时镜头不动
    dragRef.current = { startX: e.clientX, startY: e.clientY, scale: baseScale, ox, oy }
    setDrag({ scale: baseScale, ox, oy })
  }
  const endDrag = (e) => {
    e.stopPropagation()
    if (window.__orbitControls) window.__orbitControls.enabled = true
    const d = dragRef.current
    dragRef.current = null
    if (!d) { setDrag(null); return }
    const cur = d.cur || { scale: baseScale, ox, oy }
    setDrag(null)
    // 有变化才写回 store（拖拽中本地驱动 mesh，松手才保存）
    if (Math.abs(cur.scale - baseScale) > 0.01 || Math.abs(cur.ox - ox) > 0.005 || Math.abs(cur.oy - oy) > 0.005) {
      const st = getState()
      const fl = st.project.floors[st.currentFloor]
      const target = (fl.furniture || []).find((f) => f.id === item.id)
      if (target) {
        target.screen = { ...(target.screen || item.screen), scale: +cur.scale.toFixed(3), offsetX: +cur.ox.toFixed(3), offsetY: +cur.oy.toFixed(3) }
        setState({ project: { ...st.project }, saved: false })
        api.saveProject(getState().project).catch(() => {})  // 立即保存，避免拖完立刻刷新丢改动
      }
    }
  }
  return (
    <group>
      <mesh position={[sx, sy, sz]} scale={[sc, sc, 1]}>
        <planeGeometry args={[w * 0.94, h * 0.88]} />
        <meshBasicMaterial map={tex} side={THREE.DoubleSide} />
      </mesh>
      {showHandles && (
        <>
          {/* 移动手柄（画面中心，绿色）：拖动画面上下左右（offsetX/offsetY） */}
          <mesh position={[sx, sy, sz + 0.02]}
            onPointerDown={beginDrag}
            onPointerMove={(e) => {
              const d = dragRef.current
              if (!d) return
              const nx = +(ox + (e.clientX - d.startX) * 0.01).toFixed(3)
              const ny = +(oy - (e.clientY - d.startY) * 0.01).toFixed(3)
              d.cur = { scale: baseScale, ox: nx, oy: ny }
              setDrag({ scale: baseScale, ox: nx, oy: ny })
            }}
            onPointerUp={endDrag}>
            <boxGeometry args={[0.1, 0.1, 0.06]} />
            <meshBasicMaterial color="#4CAF50" />
          </mesh>
          {/* 缩放手柄（右下角，蓝色）：等比缩放画面 */}
          <mesh position={[sx + hw, sy + hh, sz + 0.02]}
            onPointerDown={beginDrag}
            onPointerMove={(e) => {
              const d = dragRef.current
              if (!d) return
              const ndx = e.clientX - d.startX
              const ns = Math.max(0.2, Math.min(4, d.scale * (1 + ndx / 150)))
              d.cur = { scale: ns, ox: d.ox, oy: d.oy }
              setDrag({ scale: ns, ox: d.ox, oy: d.oy })
            }}
            onPointerUp={endDrag}>
            <boxGeometry args={[0.14, 0.14, 0.06]} />
            <meshBasicMaterial color="#3D88FF" />
          </mesh>
        </>
      )}
    </group>
  )
}

function Furniture({ item, level, selected, onSelect, onMove, interactive, canDrag }) {
  const pos = item.pos || [0, 0, 0]
  const rot = item.rot || 0
  const scale = item.scale || [1, 1, 1]
  const lib = FURNITURE_LIB.find((f) => f.type === item.type)
  const cat = getCatalogItem(item.type)
  // 自定义家具参数（家具编辑器设置）优先于默认尺寸
  const pw = item.params && item.params.w
  const pd = item.params && item.params.d
  const ph = item.params && item.params.h
  const w = pw || (item.width != null ? item.width : (lib ? lib.w : cat ? cat.w : 1))
  const d = pd || (item.depth != null ? item.depth : (lib ? lib.d : cat ? cat.d : 0.6))
  const h = ph || (item.height != null ? item.height : (lib ? lib.h : cat ? cat.h : 0.6))
  // 家具绑定了实体：显示设备状态（顶上一颗小灯，开=黄 关=灰）
  const entState = useStore((s) => (item.entity_id ? s.haStates[item.entity_id] : null))
  const entDomain = item.entity_id ? item.entity_id.split('.')[0] : ''
  const entOn = item.entity_id ? deviceIsOn(entDomain, entState) : false
  // 窗帘开合百分比（0=闭合 100=全开）：优先本地 curtainPos（用户操作/点模型即时生效），无本地值才读 HA current_position
  const curtainPos = item.type === '窗帘'
    ? (item.curtainPos != null ? item.curtainPos : (entState && entState.attributes && entState.attributes.current_position != null ? entState.attributes.current_position : 100))
    : null
  const { camera, gl } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -level), [level])
  const dragRef = useRef(false)
  const tool = useStore((s) => s.tool)
  const editing = useStore((s) => s.editing)
  const pickItem = useStore((s) => s.pickItem)
  const selectEffect = useStore((s) => s.selectEffect)
  const showStatusPulse = useStore((s) => s.showStatusPulse)
  const isPicked = pickItem && pickItem.type === 'furniture' && pickItem.id === item.id

  const toWorld = (e) => {
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    const p = new THREE.Vector3()
    return raycaster.ray.intersectPlane(plane, p) ? p : null
  }

  // 移动家具（分组：同 group 的一起动，保持相对偏移）
  const moveItem = (nx, nz) => {
    const dx = nx - item.pos[0]
    const dz = nz - item.pos[2]
    item.pos[0] = nx; item.pos[2] = nz
    if (item.group) {
      const st = getState()
      const fl = st.project.floors.find((f) => f.level === level)
      ;(fl && fl.furniture || []).forEach((f) => {
        if (f !== item && f.group === item.group) { f.pos[0] += dx; f.pos[2] += dz }
      })
    }
    onMove(item)
  }

  // 拾起状态下每帧跟随鼠标（不依赖 pointermove，鼠标快速移动也不丢目标）
  useFrame((state) => {
    if (!isPicked) return
    raycaster.setFromCamera(state.pointer, camera)
    const p = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(plane, p)) {
      moveItem(Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10)
    }
  })

  return (
    <group
      position={[pos[0] || 0, level + (pos[1] || 0), pos[2] || 0]}
      rotation={[0, rot * Math.PI / 180, 0]}
      scale={scale}
      onPointerOver={(e) => { if (getState().hoverTip) { e.stopPropagation(); setState({ hoveredItem: { name: item.name || item.type || '模型', x: e.clientX, y: e.clientY } }) } }}
      onPointerOut={() => { if (getState().hoverTip) setState({ hoveredItem: null }) }}
      onClick={(e) => {
        if (isDragClick(e)) return
        e.stopPropagation()
        if (tool === 'move') {
          if (item.locked) { toast('已锁定，无法移动'); return }
          // 移动工具：单击拾起，再单击放下
          if (isPicked) setState({ pickItem: null })
          else { onSelect(item); setState({ pickItem: { type: 'furniture', id: item.id } }) }
        } else if (tool === 'select' || tool === 'delete') {
          onSelect(item)
        }
        // 「模型状态切换」开关（设置）：开时点有状态的模型（柜门/门）直接切换（窗帘的开关在详情弹窗里操作，点模型不切换）
        if (getState().clickToggleState !== false && (tool === 'select' || !editing)) {
          // 用 getState 读项目里的最新数据（不能依赖组件闭包变量 doorOpen——闭包可能是旧渲染值，导致第二次点击不切换）
          const st = getState()
          const fl = st.project.floors[st.currentFloor]
          const target = (fl.furniture || []).find((f) => f.id === item.id)
          if (target && (item.type === '柜子' || item.type === '门')) {
            target.doorOpen = !target.doorOpen
            setState({ project: { ...st.project }, saved: false })
            toast(item.type === '柜子' ? (target.doorOpen ? '🚪 柜门已打开' : '🚪 柜门已关闭') : (target.doorOpen ? '🚪 门已打开' : '🚪 门已关闭'))
          }
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onSelect(item)
        if (editing) setState({ tool: 'move', pickItem: { type: 'furniture', id: item.id } })
      }}
      onPointerDown={canDrag ? (e) => {
        e.stopPropagation()
        if (item.locked) { toast('已锁定，无法移动'); return }
        onSelect(item)
        dragRef.current = true
        e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId)
        // 拖家具时禁用 OrbitControls，否则左键拖家具的同时镜头被带着旋转（「拖动电视镜头乱动」）
        if (window.__orbitControls) window.__orbitControls.enabled = false
      } : undefined}
      onPointerMove={canDrag ? (e) => {
        if (!dragRef.current && !isPicked) return
        e.stopPropagation()
        const p = toWorld(e)
        if (p) moveItem(Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10)
      } : undefined}
      onPointerUp={canDrag ? () => { dragRef.current = false; if (window.__orbitControls) window.__orbitControls.enabled = true } : undefined}
    >
      <FurnitureModel type={item.type} color={item.color} w={w} d={d} h={h} params={item.params} doorOpen={item.doorOpen}
        curtainPos={curtainPos} />
      {item.screen && <VideoScreen item={item} w={w} d={d} h={h} selected={selected} />}
      {item.entity_id && showStatusPulse && <StatusPulse on={entOn} y={h + 0.14} />}
      {selected && <SelectionEffect effect={selectEffect} w={w} d={d} h={h} />}
      {selected && editing && <SelectBox center={[0, (lib && lib.type === '床' ? 1 : h / 2 + 0.1), 0]} size={[w + 0.3, h + 0.3, d + 0.3]} rot={0} />}
    </group>
  )
}

// ---------- 房间（地板 + 2D 描边；墙在 Scene 层统一去重渲染） ----------
// 地板材质：有壁纸贴图用贴图，没贴图用纯色（2D 用 basic，3D 用 physical）
function FloorMaterial({ texture, color, view2d, opacity, vertexColors }) {
  const [map, setMap] = useState(null)
  useEffect(() => {
    if (!texture) { setMap(null); return }
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.crossOrigin = 'anonymous'
    loader.load(MODEL_BASE + 'api/background/' + texture + '?t=' + Date.now(), (t) => {
      if (cancelled) return
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.needsUpdate = true
      setMap(t)
    }, undefined, () => { if (!cancelled) setMap(null) })
    return () => { cancelled = true }
  }, [texture])
  // 顶点颜色时用白底，让顶点颜色直接呈现；贴图时也用白底（贴图本身带色）
  const matColor = (map || vertexColors) ? '#ffffff' : color
  const trans = opacity != null && opacity < 100
  const op = trans ? opacity / 100 : 1
  if (view2d) {
    return <meshBasicMaterial key={map ? map.uuid : 'no-tex'} map={map || undefined} color={matColor} side={THREE.DoubleSide} transparent={trans} opacity={op} vertexColors={!!vertexColors} />
  }
  return (
    <meshPhysicalMaterial key={map ? map.uuid : 'no-tex'} map={map || undefined} color={matColor}
      roughness={0.46} metalness={0.02} clearcoat={map ? 0 : 0.2} clearcoatRoughness={0.82} side={THREE.DoubleSide} transparent={trans} opacity={op} vertexColors={!!vertexColors} />
  )
}

function Room({ room, roomIdx, floor, level, onSelect, interactive }) {
  const pts = room.points || []
  const view2d = useStore((s) => s.view2d)
  const night = useStore((s) => s.night)
  const showCeiling = useStore((s) => s.showCeiling)
  const roofOpacity = useStore((s) => s.roofOpacity)
  const roofColor = useStore((s) => s.roofColor)
  const editing = useStore((s) => s.editing)
  const focusRoomId = useStore((s) => s.focusRoomId)
  const mihomeMode = useStore((s) => s.mihomeMode)
  const glassMode = useStore((s) => s.glassMode)
  const isFocused = focusRoomId === room.id
  // 所有房间地板同一高度（对齐原版 0.025m；房间不重叠，无需高度差）
  const floorY = level + 0.025

  // 地板：按房间多边形实际形状（万能三角剖分，直接水平铺设，法线朝上）
  // 注意：useMemo 必须在早退判断之前调用，避免 hooks 顺序变化导致崩溃
  const floorGeo = useMemo(() => (pts.length >= 3 ? robustFloorGeometry(pts, THREE, room.thickness || 0.05) : null), [JSON.stringify(pts), room.thickness])
  if (pts.length < 3) return null

  return (
    <group onClick={interactive ? (e) => { if (isDragClick(e)) return; e.stopPropagation(); onSelect(room) } : undefined}>
      {/* 地板：只在单房间聚焦时渲染（全部视图用整体地板） */}
      {isFocused && <mesh geometry={floorGeo} position={[0, floorY, 0]} renderOrder={1} receiveShadow>
        <FloorMaterial texture={mihomeMode ? undefined : room.texture} color={mihomeMode ? '#EAE8E5' : ((isFocused && room.soloFloorColor) || room.color || floor.color || (view2d ? '#d5c6a8' : '#EAE8E5'))} view2d={view2d} opacity={mihomeMode ? 100 : ((isFocused && room.soloFloorOpacity != null) ? room.soloFloorOpacity : room.opacity)} />
      </mesh>}
      {/* 主界面屋顶：封闭房间顶上加半透明顶面（和地板同一多边形，只在不同高度，不翻转） */}
      {showCeiling && !editing && !view2d && (
        <mesh geometry={floorGeo} position={[0, level + (room.height || floor.height || 2.8), 0]} renderOrder={2}>
          <meshPhysicalMaterial color={mihomeMode ? '#F7F7F7' : (roofColor || room.color || floor.color || '#F7F7F7')} roughness={0.5} metalness={0.02} transparent opacity={(roofOpacity != null ? roofOpacity : 80) / 100} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* 2D 地板描边：让房间范围一目了然 */}
      {view2d && (
        <lineLoop position={[0, floorY + 0.02, 0]}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[Float32Array.from(pts.flatMap((p) => [p[0], 0, p[1]])), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#6a7a90" />
        </lineLoop>
      )}
    </group>
  )
}

// ---------- 门窗（墙段上的开口：门 4 类型 + 5 色 + 内开外开；窗 4 类型） ----------
// 墙几何：带「门 / 无玻璃窗」开口挖洞（中间真正镂空）。Shape 矩形 + holes，extrude 出厚度
const _wallGeoCache = new Map()
function wallGeometry(len, h, thick, openings) {
  const ops = (openings || []).filter(o => o.type === 'door' || (o.type === 'window' && (o.windowStyle || 'standard') === 'no_glass'))
  const sig = `${len}|${h}|${thick}|` + ops.map(o => `${o.type}|${o.offset}|${o.width}|${o.bottom}|${o.height}|${o.windowStyle}`).join('#')
  if (_wallGeoCache.has(sig)) return _wallGeoCache.get(sig)
  const shape = new THREE.Shape()
  shape.moveTo(-len / 2, -h / 2); shape.lineTo(len / 2, -h / 2); shape.lineTo(len / 2, h / 2); shape.lineTo(-len / 2, h / 2); shape.closePath()
  for (const op of ops) {
    const isDoor = op.type === 'door'
    const cx = ((op.offset || 0.5) - 0.5) * len
    const wd = op.width || 0.9
    const bottom = isDoor ? 0 : (op.bottom ?? 0)
    const wh = isDoor ? (op.height || h * 0.75) : (op.height || 0.9)
    const x0 = Math.max(-len / 2 + 0.001, cx - wd / 2)
    const x1 = Math.min(len / 2 - 0.001, cx + wd / 2)
    const y0 = Math.max(-h / 2 + 0.001, bottom - h / 2)
    const y1 = Math.min(h / 2 - 0.001, bottom + wh - h / 2)
    if (x1 - x0 <= 0.01 || y1 - y0 <= 0.01) continue
    const hole = new THREE.Path()
    hole.moveTo(x0, y0); hole.lineTo(x1, y0); hole.lineTo(x1, y1); hole.lineTo(x0, y1); hole.closePath()
    shape.holes.push(hole)
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false })
  geo.translate(0, 0, -thick / 2)
  if (_wallGeoCache.size > 300) _wallGeoCache.clear()
  _wallGeoCache.set(sig, geo)
  return geo
}

// 圆角矩形路径（Shape 或 Path，r<=0 时是直角矩形）
function roundedRect(p, x0, y0, x1, y1, r) {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2))
  if (rr <= 0.002) { p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.closePath(); return }
  p.moveTo(x0 + rr, y0); p.lineTo(x1 - rr, y0)
  p.quadraticCurveTo(x1, y0, x1, y0 + rr); p.lineTo(x1, y1 - rr)
  p.quadraticCurveTo(x1, y1, x1 - rr, y1); p.lineTo(x0 + rr, y1)
  p.quadraticCurveTo(x0, y1, x0, y1 - rr); p.lineTo(x0, y0 + rr)
  p.quadraticCurveTo(x0, y0, x0 + rr, y0); p.closePath()
}

const _frameGeoCache = new Map()
// 窗框几何（矩形框：四条边一体，圆角/直角 + 厚度）
function windowFrameGeometry(wd, winH, t, rounded) {
  const key = `w|${wd}|${winH}|${t}|${rounded}`
  if (_frameGeoCache.has(key)) return _frameGeoCache.get(key)
  const shape = new THREE.Shape()
  roundedRect(shape, -wd / 2, -winH / 2, wd / 2, winH / 2, rounded ? t * 1.8 : 0)
  const hole = new THREE.Path()
  roundedRect(hole, -wd / 2 + t, -winH / 2 + t, wd / 2 - t, winH / 2 - t, rounded ? t * 1.2 : 0)
  shape.holes.push(hole)
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false })
  geo.translate(0, 0, -t / 2)
  if (_frameGeoCache.size > 200) _frameGeoCache.clear()
  _frameGeoCache.set(key, geo)
  return geo
}
// 门框几何（门字形：左右竖 + 顶部横一体，顶部圆角/直角 + 厚度）
function doorFrameGeometry(wd, doorH, t, rounded) {
  const key = `d|${wd}|${doorH}|${t}|${rounded}`
  if (_frameGeoCache.has(key)) return _frameGeoCache.get(key)
  const shape = new THREE.Shape()
  const r = rounded ? Math.min(t * 1.8, wd / 3) : 0
  shape.moveTo(-wd / 2, 0); shape.lineTo(-wd / 2, doorH - r)
  shape.quadraticCurveTo(-wd / 2, doorH, -wd / 2 + r, doorH)
  shape.lineTo(wd / 2 - r, doorH)
  shape.quadraticCurveTo(wd / 2, doorH, wd / 2, doorH - r)
  shape.lineTo(wd / 2, 0)
  shape.closePath()
  const hole = new THREE.Path()
  const ix0 = -wd / 2 + t, ix1 = wd / 2 - t
  hole.moveTo(ix0, 0); hole.lineTo(ix0, doorH - t); hole.lineTo(ix1, doorH - t); hole.lineTo(ix1, 0); hole.closePath()
  shape.holes.push(hole)
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false })
  geo.translate(0, 0, -t / 2)
  if (_frameGeoCache.size > 200) _frameGeoCache.clear()
  _frameGeoCache.set(key, geo)
  return geo
}

// 把房间边在门/门框位置断开（分割线不穿过门；skipDoors 开启时）
function splitEdgeWithDoors(a, b, floor, skipDoors) {
  if (!skipDoors) return [[a, b]]
  const w = (floor.walls || []).find((x) => wallOnEdge(x, a, b))
  if (!w) return [[a, b]]
  const doors = (floor.openings || []).filter((o) => o.type === 'door' && o.wallId === w.id)
  if (!doors.length) return [[a, b]]
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-8) return [[a, b]]
  const len = Math.sqrt(len2)
  const cuts = []
  for (const d of doors) {
    // 门中心（相对墙 w 的位置），再投影到这条房间边 (a,b) 上——offset 是相对整面墙的，不能直接乘边长
    const t = d.offset || 0.5
    const cx = w.start[0] + (w.end[0] - w.start[0]) * t
    const cy = w.start[1] + (w.end[1] - w.start[1]) * t
    const proj = ((cx - a[0]) * dx + (cy - a[1]) * dy) / len2 // 0~1 比例（相对这条边）
    const half = (d.width || 0.9) / 2 / len
    const c0 = Math.max(0, proj - half)
    const c1 = Math.min(1, proj + half)
    if (c1 - c0 > 0.01) cuts.push([c0, c1])
  }
  if (!cuts.length) return [[a, b]]
  cuts.sort((x, y) => x[0] - y[0])
  const merged = cuts.reduce((acc, c) => {
    const last = acc[acc.length - 1]
    if (last && c[0] < last[1] - 0.01) last[1] = Math.max(last[1], c[1])
    else acc.push([...c])
    return acc
  }, [])
  const segs = []
  const at = (t) => [a[0] + dx * t, a[1] + dy * t]
  let prev = 0
  for (const [c0, c1] of merged) {
    if (c0 - prev > 0.02) segs.push([at(prev), at(c0)])
    prev = c1
  }
  if (1 - prev > 0.02) segs.push([at(prev), at(1)])
  return segs
}

// 房间边界线：LineSegments2（fat line，线宽是像素、不随视角变细消失），贴地板表面，被家具正常遮挡
// 注意用 LineSegments2（独立线段）不是 Line2（连续线）——否则独立线段会被误当成连续点串产生交叉/零长度线
function RoomBorderLines({ floor, level, alwaysVisible, skipDoors }) {
  const { size } = useThree()
  const positions = useMemo(() => {
    const pts = []
    const seen = new Set()
    for (const room of (floor.rooms || [])) {
      const rp = room.points || []
      for (let i = 0; i < rp.length; i++) {
        const a = rp[i], b = rp[(i + 1) % rp.length]
        const key = [Math.round(a[0] * 50), Math.round(a[1] * 50), Math.round(b[0] * 50), Math.round(b[1] * 50)].sort((x, y) => x - y).join(',')
        if (seen.has(key)) continue
        seen.add(key)
        for (const [p, q] of splitEdgeWithDoors(a, b, floor, skipDoors)) {
          pts.push(p[0], level + 0.03, p[1], q[0], level + 0.03, q[1])
        }
      }
    }
    return pts
  }, [floor, level, skipDoors])
  const geo = useMemo(() => {
    if (positions.length < 6) return null
    const g = new LineSegmentsGeometry()
    g.setPositions(positions)
    return g
  }, [positions])
  const mat = useMemo(() => new LineMaterial({ color: '#ffffff', linewidth: 4, transparent: true, opacity: 0.9, depthTest: !alwaysVisible }), [alwaysVisible])
  useEffect(() => { if (mat) mat.resolution.set(size.width, size.height) }, [mat, size.width, size.height])
  if (!geo || !mat) return null
  const line = useMemo(() => { const l = new LineSegments2(geo, mat); l.renderOrder = 100; return l }, [geo, mat])
  return <primitive object={line} />
}

function Opening({ op, floor, level, onSelect }) {
  const wall = (floor.walls || []).find((w) => w.id === op.wallId)
  if (!wall) return null
  const a = wall.start, b = wall.end
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  const h = floor.height || 2.8
  const t = Math.max(0, Math.min(1, op.offset || 0.5))
  const px = a[0] + (b[0] - a[0]) * t
  const pz = a[1] + (b[1] - a[1]) * t
  const wd = op.width || 0.9
  const isDoor = op.type !== 'window'
  const click = onSelect ? (e) => { if (isDragClick(e)) return; e.stopPropagation(); onSelect({ type: 'opening', ref: op }) } : undefined
  if (isDoor) return <group onClick={click}><Door3D op={op} px={px} pz={pz} level={level} ang={ang} h={h} wd={wd} /></group>
  return <group onClick={click}><Window3D op={op} px={px} pz={pz} level={level} ang={ang} h={h} wd={wd} /></group>
}

// 门：门框（左右上）+ 门扇（平开/双开/推拉/门框 + 颜色 + 内开外开 + 翻转）
function Door3D({ op, px, pz, level, ang, h, wd }) {
  const doorH = op.height || h * 0.75
  const style = op.doorStyle || 'swing'
  const color = DOOR_COLORS[op.color] || DOOR_COLORS['木色']
  const frameT = op.frameThickness || 0.06
  const rounded = (op.frameStyle || 'square') === 'rounded'
  const doorFrame = (
    <mesh geometry={doorFrameGeometry(wd, doorH, frameT, rounded)} receiveShadow>
      <meshStandardMaterial color="#e7ebef" roughness={0.56} metalness={0.01} />
    </mesh>
  )
  // 单扇门：铰链在 hingeX，门扇沿 leafDir 方向延伸，绕铰链开合（AnimatedRotate 缓慢动画，像窗帘一样）
  const leaf = (hingeX, leafDir, openAngle, leafW) => (
    <AnimatedRotate to={openAngle} position={[hingeX, 0, 0]}>
      <mesh position={[leafDir * leafW / 2, doorH / 2, 0.03]} castShadow>
        <boxGeometry args={[leafW, doorH * 0.97, 0.045]} />
        <meshStandardMaterial color={color} roughness={0.72} metalness={0.012} />
      </mesh>
      <mesh position={[leafDir * leafW * 0.82, doorH * 0.54, 0.065]}>
        <sphereGeometry args={[0.035, 16, 8]} />
        <meshStandardMaterial color="#71604d" metalness={0.55} roughness={0.28} />
      </mesh>
    </AnimatedRotate>
  )

  if (style === 'frame') {
    // 纯门框：只有框，无门扇
    return (
      <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
        {doorFrame}
      </group>
    )
  }
  if (style === 'closed') {
    // 关门样式：默认关，doorOpen=true 时开门动画
    const hingeLeft = (op.hinge || 'start') === 'start'
    const hingeX = hingeLeft ? -wd / 2 : wd / 2
    const leafDir = hingeLeft ? 1 : -1
    const closedSwing = (op.swing || 'inward') === 'inward' ? 1 : -1
    const closedAngle = (op.doorOpen === true ? 1.4 : 0) * leafDir * closedSwing
    return (
      <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
        {doorFrame}
        {leaf(hingeX, leafDir, closedAngle, wd * 0.96)}
      </group>
    )
  }
  if (style === 'slide') {
    // 推拉门：两扇重叠滑板，doorOpen 控制开合（true=右扇滑开 / false=关闭）
    const slideOffset = op.doorOpen === true ? wd * 0.38 : 0
    return (
      <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
        <mesh position={[0, doorH - frameT / 2, 0]} receiveShadow>
          <boxGeometry args={[wd, frameT, WALL_THICK + 0.01]} />
          <meshStandardMaterial color="#e7ebef" roughness={0.56} metalness={0.01} />
        </mesh>
        <mesh position={[-wd * 0.18, doorH / 2, 0.02]} castShadow>
          <boxGeometry args={[wd * 0.55, doorH * 0.94, 0.04]} />
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.02} />
        </mesh>
        <group position={[slideOffset, 0, 0]}>
          <mesh position={[wd * 0.18, doorH / 2, 0.05]} castShadow>
            <boxGeometry args={[wd * 0.55, doorH * 0.94, 0.04]} />
            <meshStandardMaterial color={color} roughness={0.6} metalness={0.02} />
          </mesh>
        </group>
      </group>
    )
  }
  const swingDir = (op.swing || 'inward') === 'inward' ? 1 : -1
  if (style === 'double') {
    // 双开门：两扇对称，doorOpen 控制开合（true=大开 / false=关闭 / 未设=微开）
    const dblAngle = (op.doorOpen === true ? 1.3 : op.doorOpen === false ? 0.02 : 0.5) * swingDir
    return (
      <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
        {doorFrame}
        {leaf(-wd / 2, 1, -dblAngle, wd * 0.48)}
        {leaf(wd / 2, -1, dblAngle, wd * 0.48)}
      </group>
    )
  }
  // 平开门（单扇）：hinge 决定铰链左/右，swing 决定内/外开
  const hingeLeft = (op.hinge || 'start') === 'start'
  const hingeX = hingeLeft ? -wd / 2 : wd / 2
  const leafDir = hingeLeft ? 1 : -1
  // 门扇开合：doorOpen=true 全开 / false 关闭 / 未设置保持默认微开
  const openAngle = (op.doorOpen === true ? 1.4 : op.doorOpen === false ? 0.06 : 0.5) * leafDir * swingDir
  return (
    <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
      {doorFrame}
      {leaf(hingeX, leafDir, openAngle, wd * 0.96)}
    </group>
  )
}

// 窗：玻璃 + 边框（普通/落地/推拉/飘窗）
function Window3D({ op, px, pz, level, ang, h, wd }) {
  const style = op.windowStyle || 'standard'
  const isFull = style === 'floor_to_ceiling'
  const bottom = isFull ? 0 : (op.bottom ?? 0.9)
  const winH = isFull ? h : (op.height || 0.9)
  const winY = bottom + winH / 2
  const glass = () => (
    <meshPhysicalMaterial color="#d8f2ff" transmission={0.72} transparent opacity={0.5} roughness={0.08} metalness={0.02} side={THREE.DoubleSide} depthWrite={false} />
  )
  const frameT = op.frameThickness || 0.04
  const rounded = (op.frameStyle || 'square') === 'rounded'
  const frameGeo = windowFrameGeometry(wd, winH, frameT, rounded)
  const frameMat = () => (
    <meshBasicMaterial color="#ffffff" transparent opacity={0.58} depthWrite={false} toneMapped={false} />
  )

  return (
    <group position={[px, level + winY, pz]} rotation={[0, -ang, 0]}>
      {style === 'bay' ? (
        <>
          {/* 飘窗：前面玻璃 + 左右斜玻璃 + 窗台板 */}
          <mesh position={[0, 0, -0.18]}><planeGeometry args={[wd, winH]} />{glass()}</mesh>
          <mesh position={[-wd / 2, 0, -0.09]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[0.18, winH]} />{glass()}</mesh>
          <mesh position={[wd / 2, 0, -0.09]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[0.18, winH]} />{glass()}</mesh>
          <mesh position={[0, -winH / 2 - 0.02, -0.09]}><boxGeometry args={[wd, 0.04, 0.2]} /><meshStandardMaterial color="#e7ebef" roughness={0.5} /></mesh>
        </>
      ) : style === 'slide' ? (
        <>
          {/* 推拉窗：两扇玻璃错位重叠 */}
          <mesh position={[-wd * 0.25, 0, 0]}><planeGeometry args={[wd * 0.52, winH]} />{glass()}</mesh>
          <mesh position={[wd * 0.25, 0, 0.02]}><planeGeometry args={[wd * 0.52, winH]} />{glass()}</mesh>
        </>
      ) : style === 'no_glass' ? (
        <>
          {/* 无玻璃窗：只有窗框，无玻璃 */}
          <mesh geometry={frameGeo}>{frameMat()}</mesh>
        </>
      ) : (
        <>
          {/* 普通/落地：单扇玻璃 + 窗框 */}
          <mesh><planeGeometry args={[wd, winH]} />{glass()}</mesh>
          <mesh geometry={frameGeo}>{frameMat()}</mesh>
        </>
      )}
    </group>
  )
}

// 设备「开」状态按域判断（对齐原版各设备的开状态）
function deviceIsOn(domain, state) {
  const h = state && state.state
  if (!h || h === 'unavailable' || h === 'unknown') return false
  switch (domain) {
    case 'climate': return ['cool', 'heat', 'dry', 'fan_only', 'auto'].includes(h)
    case 'lock': return ['unlocked', 'open', 'opening'].includes(h)
    case 'vacuum': return ['cleaning', 'returning', 'on'].includes(h)
    case 'cover': return ['open', 'opening', 'closing'].includes(h)
    case 'media_player': return h === 'playing' || h === 'on'
    case 'fan': return h !== 'off'
    default: return h === 'on'
  }
}

// ---------- 设备标记 ----------
function DeviceMarker({ dev, level, selected, onSelect, interactive, canDrag, onMove }) {
  const state = useStore((s) => s.haStates[dev.entity_id])
  const domain = (dev.entity_id || '').split('.')[0]
  const isOn = deviceIsOn(domain, state)
  const cat = dev.modelId ? getCatalogItem(dev.modelId) : null
  const devModel = dev.modelId ? DEVICE_MODELS.find((m) => m.id === dev.modelId) : null
  const isLight = domain === 'light' || domain === 'switch'
  const { camera, gl } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -level), [level])
  const dragRef = useRef(false)
  const tool = useStore((s) => s.tool)
  const editing = useStore((s) => s.editing)
  const pickItem = useStore((s) => s.pickItem)
  const isPicked = pickItem && pickItem.type === 'device' && pickItem.id === dev.id
  const rot = dev.rot || 0
  const sc = dev.scale || [1, 1, 1]

  const toWorld = (e) => {
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    const p = new THREE.Vector3()
    return raycaster.ray.intersectPlane(plane, p) ? p : null
  }
  useFrame((state) => {
    if (!isPicked) return
    raycaster.setFromCamera(state.pointer, camera)
    const p = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(plane, p)) {
      dev.pos[0] = Math.round(p.x * 10) / 10
      dev.pos[2] = Math.round(p.z * 10) / 10
      onMove && onMove()
    }
  })

  // 设备离线（unavailable/unknown）灰 #999999；在线标识色 #3D88FF 用于选中高亮/描边
  const offline = !state || state.state === 'unavailable' || state.state === 'unknown'
  let color = offline ? '#999999' : '#556677', emissive = offline ? '#000000' : '#334455'
  if (offline) {
    color = '#999999'; emissive = '#000000'
  } else if (domain === 'light' || domain === 'switch') {
    color = isOn ? '#FFEBC2' : '#3a4658'
    emissive = isOn ? '#ffaa33' : '#223044'
  } else if (domain === 'sensor') {
    color = '#79d08a'; emissive = '#79d08a'
  } else if (domain === 'binary_sensor') {
    color = isOn ? '#ff6b6b' : '#79d08a'
    emissive = isOn ? '#ff4444' : '#33aa55'
  } else {
    color = isOn ? '#79d08a' : '#556677'
    emissive = isOn ? '#33aa55' : '#334455'
  }

  return (
    <group
      position={[dev.pos[0], level + (dev.pos[1] || 1.4), dev.pos[2]]}
      rotation={[0, rot * Math.PI / 180, 0]}
      scale={sc}
      onClick={(e) => {
        if (isDragClick(e)) return
        e.stopPropagation()
        if (tool === 'move') {
          if (isPicked) setState({ pickItem: null })
          else { onSelect(dev); setState({ pickItem: { type: 'device', id: dev.id } }) }
        } else if (tool === 'select' || tool === 'delete') {
          onSelect(dev)
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onSelect(dev)
        if (editing) setState({ tool: 'move', pickItem: { type: 'device', id: dev.id } })
      }}
      onPointerDown={canDrag ? (e) => {
        e.stopPropagation()
        onSelect(dev)
        dragRef.current = true
        e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId)
        // 拖设备时禁用 OrbitControls（同家具：拖拽时镜头不动）
        if (window.__orbitControls) window.__orbitControls.enabled = false
      } : undefined}
      onPointerMove={canDrag ? (e) => {
        if (!dragRef.current && !isPicked) return
        e.stopPropagation()
        const p = toWorld(e)
        if (p) {
          dev.pos[0] = Math.round(p.x * 10) / 10
          dev.pos[2] = Math.round(p.z * 10) / 10
          onMove && onMove()
        }
      } : undefined}
      onPointerUp={canDrag ? () => { dragRef.current = false; if (window.__orbitControls) window.__orbitControls.enabled = true } : undefined}
    >
      {cat ? (
        // 下载的 GLB 模型（家具/家电）
        <GltfModel name={cat.glb} w={cat.w} d={cat.d} h={cat.h} />
      ) : devModel ? (
        // 设备模型目录里的程序化模型（灯光/开关/空调/摄像机/风扇…）
        <DeviceModel id={devModel.id} w={devModel.w} d={devModel.d} h={devModel.h} isOn={isOn} state={state} />
      ) : (
        // 无模型：小球兜底
        <mesh>
          <sphereGeometry args={[0.13, 16, 12]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.6} />
        </mesh>
      )}
      {/* 灯/开关亮时加点光源，模型发光 */}
      {isLight && isOn && (
        <pointLight color="#ffd08a" intensity={1.5} distance={2.5} />
      )}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.25, 0.35, 24]} />
          <meshBasicMaterial color="#3D88FF" side={THREE.DoubleSide} transparent opacity={0.8} />
        </mesh>
      )}
      {/* 透明点击区域：让小的设备（吊扇等薄片/小球）也容易选中 */}
      <mesh>
        <sphereGeometry args={[0.32, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

// 渲染模式的光照差异
const MODE_LIGHT = {
  '全屋': { ambient: 0.6, hemi: 0.5, sun: 1.4, sunColor: '#ffffff', tint: '#dfe7ff' },
  '照明': { ambient: 0.4, hemi: 0.4, sun: 0.8, sunColor: '#ffd8a8', tint: '#ffe8c8' },
  '遮阳': { ambient: 0.5, hemi: 0.35, sun: 0.7, sunColor: '#c8d4e8', tint: '#d0d8e8' },
  '环境': { ambient: 0.4, hemi: 0.35, sun: 0.9, sunColor: '#b8d0f0', tint: '#b8d0f0' },
  '安防': { ambient: 0.55, hemi: 0.5, sun: 1.2, sunColor: '#ffffff', tint: '#dfe7ff' },
}

// ---------- 主场景 ----------
// 3D 放置平面（家具工具下点击地面放置）
function PlacePlane({ height, onPlace }) {
  const { camera, gl } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), [height])
  const toWorld = (e) => {
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    const p = new THREE.Vector3()
    return raycaster.ray.intersectPlane(plane, p) ? p : null
  }
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]}
      onClick={(e) => { const p = toWorld(e); if (p) onPlace(p.x, p.z) }}>
      <planeGeometry args={[1000, 1000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

// 墙面材质（支持壁纸贴图）
function WallMaterial({ texture, color, opacity, selected, glassMode, glassOpacity = 0.3 }) {
  const [map, setMap] = useState(null)
  useEffect(() => {
    if (!texture) { setMap(null); return }
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.crossOrigin = 'anonymous'
    loader.load(MODEL_BASE + 'api/background/' + texture + '?t=' + Date.now(), (t) => {
      if (cancelled) return
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.needsUpdate = true
      setMap(t)
    }, undefined, () => { if (!cancelled) setMap(null) })
    return () => { cancelled = true }
  }, [texture])
  const trans = opacity < 0.999
  const matColor = map ? '#ffffff' : color
  if (glassMode) {
    // 原版玻璃墙：clearcoat 0.16 + roughness 0.46 + side DoubleSide + 墙顶白条（清晰），opacity 可调（设置面板）
    return (
      <meshPhysicalMaterial key={map ? map.uuid : 'no-tex'} map={map || undefined} color={matColor}
        emissive={selected ? '#3D88FF' : '#000000'} emissiveIntensity={selected ? 0.45 : 0}
        transparent={true} opacity={glassOpacity} roughness={0.46} metalness={0.004}
        clearcoat={0.16} clearcoatRoughness={0.7} depthWrite={false} side={THREE.DoubleSide} />
    )
  }
  return (
    <meshStandardMaterial key={map ? map.uuid : 'no-tex'} map={map || undefined} color={matColor}
      emissive={selected ? '#3D88FF' : '#000000'} emissiveIntensity={selected ? 0.45 : 0}
      transparent={trans} opacity={opacity} roughness={0.6} metalness={0.05} depthWrite={!trans} />
  )
}

// 天空球（skybox）：按日夜/太阳高度角给一个垂直渐变的天空，罩住整个场景
function SkyDome({ night, elevation, glassMode }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 8; c.height = 256
    const ctx = c.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, 0, 256)
    if (glassMode) {
      // 原版 JMGLink 天空：深蓝灰渐变（玻璃墙透出这层深色，玻璃感强、有辨识度）
      grad.addColorStop(0, '#3f6fb8')
      grad.addColorStop(1, '#b8d4ec')
    } else {
      // 米家天空：白天 #E8F0F8（浅蓝白）、夜间 #2C3442（深灰蓝），扁平单色
      const sky = night ? '#2C3442' : '#E8F0F8'
      grad.addColorStop(0, sky)
      grad.addColorStop(1, sky)
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 8, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [night, elevation != null && elevation < 10, glassMode])
  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[60, 32, 16]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  )
}

export default function Scene({ onSelect, floorIndex }) {
  const project = useStore((s) => s.project)
  const floor = useStore((s) => s.project.floors[floorIndex])
  const night = useStore((s) => s.night)
  const mihomeMode = useStore((s) => s.mihomeMode)
  const glassMode = useStore((s) => s.glassMode)
  const glassOpacity = useStore((s) => (s.settings && s.settings.glassOpacity != null) ? s.settings.glassOpacity : 0.3)
  const glassWallColor = useStore((s) => (s.settings && s.settings.glassWallColor) || '#d5e0f1')
  const roomBorderLines = useStore((s) => s.roomBorderLines !== false)
  const roomBorderAlways = useStore((s) => s.roomBorderAlwaysVisible === true)
  const roomBorderSkipDoors = useStore((s) => s.roomBorderSkipDoors === true)
  const sunElevation = useStore((s) => s.sunElevation)
  const sunLight = useStore((s) => s.sunLight)
  const shadows = useStore((s) => s.shadows)
  const selected = useStore((s) => s.selected)
  const tool = useStore((s) => s.tool)
  const mode = useStore((s) => s.mode)
  const view2d = useStore((s) => s.view2d)
  const editing = useStore((s) => s.editing)
  const showWalls = useStore((s) => s.showWalls)
  const showOpenings = useStore((s) => s.showOpenings)
  const showCeiling = useStore((s) => s.showCeiling)
  const camTarget = useStore((s) => s.camTarget)
  const pickItem = useStore((s) => s.pickItem)
  const wallSelIds = useStore((s) => s.wallSel)
  const multiSelect = useStore((s) => s.multiSelect)
  const focusRoomId = useStore((s) => s.focusRoomId)

  // 放置工具（墙/家具/设备）时不拦截点击，让交互平面接收
  const interactive = tool === 'select' || tool === 'delete'
  const canDrag = tool === 'move' && editing
  const ml = MODE_LIGHT[mode] || MODE_LIGHT['全屋']
  const th = night ? THEME.night : THEME.day

  // 单房间聚焦：focusRoomId 非空时只显示该房间（地板/墙/家具/设备），其他隐藏。
  // 墙在聚焦时直接用 focusRoom.points 边界生成（见墙渲染处），不用从 floor.walls 过滤。
  const focusRoom = focusRoomId ? (floor?.rooms || []).find((r) => r.id === focusRoomId) : null
  // 点（家具/设备位置）在聚焦房间内
  const ptInFocus = (x, z) => !focusRoom || !focusRoom.points || pointInPolygon([x, z], focusRoom.points)
  // 判断门窗是否属于某房间（门窗中心点落在该房间某条边的投影区间内；共用长墙不会误判到别的房间）
  const openingInRoom = (op, room) => {
    const w = (floor?.walls || []).find((x) => x.id === op.wallId)
    if (!w || !room || !room.points) return false
    const t0 = op.offset || 0.5
    const cx = w.start[0] + (w.end[0] - w.start[0]) * t0
    const cy = w.start[1] + (w.end[1] - w.start[1]) * t0
    const pts = room.points
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      if (!wallOnEdge(w, a, b)) continue
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      if (len2 < 1e-10) continue
      const t = ((cx - a[0]) * dx + (cy - a[1]) * dy) / len2
      if (t >= -0.01 && t <= 1.01) return true
    }
    return false
  }
  // 整体地板（全部视图）：union + 顶点颜色，一整块无内部侧面（半透明无缝），每房间独立配色
  const floorThick = ((floor?.rooms || [])[0]?.thickness) || 0.05
  const wholeFloorGeo = useMemo(() => (!focusRoom ? wholeFloorGeometryWithColors(floor?.rooms || [], THREE, floorThick) : null), [JSON.stringify((floor?.rooms || []).map((r) => ({ p: r.points, c: r.color }))), focusRoomId, floorThick])

  // 家具移动：更新位置 + 触发保存
  const handleMoveFurniture = () => {
    setState({ project: { ...project }, saved: false })
  }

  // 3D 放置家具（家具工具下点击地面放置）
  const placeFurniture = (x, z) => {
    const st = getState()
    const ft = st.furnitureType
    const fl = st.project.floors[floorIndex]
    if (!fl) return
    fl.furniture = fl.furniture || []
    const s = st.furnitureScale || 1
    const lib = FURNITURE_LIB.find((f) => f.type === ft)
    const devModel = DEVICE_MODELS.find((m) => m.id === ft)
    const placement = (lib && lib.placement) || (devModel && devModel.placement) || 'floor'
    const floorH = fl.height || 2.8
    const wallH = devModel ? (devModel.defaultHeight || FURNITURE_WALL_HEIGHT) : FURNITURE_WALL_HEIGHT
    const h = placement === 'ceiling' ? floorH : placement === 'wall' ? wallH : 0
    fl.furniture.push({ id: Math.random().toString(36).slice(2, 10), type: ft, pos: [x, h, z], rot: 0, scale: [s, s, s], placement })
    setState({ project: { ...st.project }, saved: false })
  }

  if (!floor) return null
  const level = floor.level || 0
  const sel = selected
  // 放置平面高度：房顶模型用房顶高度平面、墙面用墙面高度，俯视时鼠标才能和模型对齐
  const placePlaneHeight = (() => {
    const ft = getState().furnitureType
    const lib = FURNITURE_LIB.find((f) => f.type === ft)
    const devModel = DEVICE_MODELS.find((m) => m.id === ft)
    const placement = (lib && lib.placement) || (devModel && devModel.placement) || 'floor'
    const floorH = floor.height || 2.8
    if (placement === 'ceiling') return level + floorH
    if (placement === 'wall') return level + (devModel ? (devModel.defaultHeight || FURNITURE_WALL_HEIGHT) : FURNITURE_WALL_HEIGHT)
    return level
  })()

  return (
    <>
      {/* 环境光：glass 模式对齐原版展示模式 0.58（更暗，玻璃不发白） */}
      <ambientLight intensity={night ? 0.4 : Math.max(ml.ambient, 0.7)} />
      {/* 米家：白天天空 #E8F0F8 / 地面 #EAE8E5 柔和自然光；夜间室内环境底色 #444448 */}
      <hemisphereLight args={[night ? '#444448' : '#E8F0F8', night ? '#444448' : '#EAE8E5', night ? 0.35 : Math.max(ml.hemi, 0.6)]} />
      {sunLight && <directionalLight
        position={[8, night ? 8 : (sunElevation != null ? Math.max(6, Math.sin((sunElevation * Math.PI) / 180) * 16) : 14), 9]}
        intensity={night ? 0.7 : Math.max(ml.sun, 1.6)}
        color={night ? ml.sunColor : (sunElevation != null && sunElevation < 10 ? '#ffb070' : ml.sunColor)}
        castShadow={shadows}
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-16} shadow-camera-right={16}
        shadow-camera-top={16} shadow-camera-bottom={-16}
        shadow-bias={-0.00016}
      />}

      <group>
        {/* 2D 模式：无房间时显示白色画图平面（编辑界面用干净表面，背景图不在这里生效） */}
        {view2d && (floor.rooms || []).length === 0 && (
          <mesh position={[0, level - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[80, 80]} />
            <meshBasicMaterial color={night ? '#1c2333' : '#f7fafc'} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* 网格：只在编辑时显示。2D 用加粗清晰网格（1m 格），3D 编辑用细网格（居中到户型中心） */}
        {editing && view2d && <DrawingGrid size={20} cell={1} level={level} night={night} />}
        {editing && !view2d && (
          <gridHelper
            args={[30, 30, night ? '#5a6a8a' : '#b8c6d8', night ? '#3a4a6a' : '#dde6ef']}
            position={[camTarget[0], level + 0.005, camTarget[2]]}
          />
        )}
        {/* 3D 编辑屋顶：和下面地板对应的网格画布（层高高度），方便摆放吊顶/吊灯等 */}
        {editing && !view2d && showCeiling && (
          <gridHelper
            args={[30, 30, night ? '#5a6a8a' : '#b8c6d8', night ? '#3a4a6a' : '#dde6ef']}
            position={[camTarget[0], level + (floor.height || 2.8), camTarget[2]]}
          />
        )}
        {/* 3D 放置平面：家具工具下点击地面/房顶放置；移动工具拾起后点击放下 */}
        {editing && tool === 'furniture' && <PlacePlane height={placePlaneHeight} onPlace={placeFurniture} />}
        {editing && tool === 'move' && pickItem && <PlacePlane height={level} onPlace={() => setState({ pickItem: null })} />}

        {/* 墙（持久化线段，毛玻璃材质对齐原版；删除模式可点；showWalls 关闭则去除墙壁） */}
        {showWalls && (() => {
          // 聚焦单个房间：直接用房间边界（points）重新生成墙，不多不少——贯穿墙/伸出墙都不会出错
          if (focusRoom && focusRoom.points) {
            const pts = focusRoom.points
            const walls = floor.walls || []
            // 找构成这条边的原始墙（共线 + 交叠），继承它的厚度/高度/颜色/透明度。
            // 覆盖单面墙/拼接墙/共用墙三种情况（共用墙端点超出房间边，拼接墙不覆盖整条边，都要能匹配到）
            const matchWall = (a, b) => walls.find((w) => wallOnEdge(w, a, b))
            return pts.map((p, i) => {
              const a = p, b = pts[(i + 1) % pts.length]
              const len = Math.hypot(b[0] - a[0], b[1] - a[1])
              if (len < 0.001) return null
              const w = matchWall(a, b)
              const h = (w && w.height) || focusRoom.height || floor.height || 2.8
              const thick = (w && w.thickness) || WALL_THICK
              const wallColor = glassMode ? ((w && w.color) || glassWallColor) : (mihomeMode ? '#F0F0F0' : ((focusRoom && focusRoom.soloWallColor) || (w && w.color) || th.wallColor))
              const wallOpacityVal = glassMode ? 0.24 : (mihomeMode ? 0.197 : ((focusRoom && focusRoom.soloWallOpacity != null ? focusRoom.soloWallOpacity : (w && w.opacity != null ? w.opacity : 100)) / 100))
              const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2
              const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
              return (
                <group key={i}>
                  <mesh position={[mx, h / 2 + level, mz]} rotation={[0, -ang, 0]} geometry={view2d ? undefined : wallGeometry(len, h, thick, (floor.openings || []).filter(o => o.wallId === (w && w.id) && openingInRoom(o, focusRoom)).map(o => {
                    const t0 = o.offset || 0.5
                    const cx = w.start[0] + (w.end[0] - w.start[0]) * t0
                    const cy = w.start[1] + (w.end[1] - w.start[1]) * t0
                    const dx = b[0] - a[0], dy = b[1] - a[1]
                    const len2 = dx * dx + dy * dy
                    const t = len2 > 1e-10 ? ((cx - a[0]) * dx + (cy - a[1]) * dy) / len2 : 0.5
                    return { ...o, offset: t }
                  }))}>
                    {view2d && <boxGeometry args={[len, 0.01, thick]} />}
                    {view2d
                      ? <meshBasicMaterial color="#3a4a66" />
                      : <WallMaterial color={wallColor} opacity={wallOpacityVal} glassMode={glassMode} glassOpacity={glassOpacity} />}
                  </mesh>
                  {/* 墙顶白色高光条（让墙顶轮廓清晰） */}
                  {!view2d && glassMode && (
                    <mesh position={[mx, h + level + 0.006, mz]} rotation={[0, -ang, 0]} renderOrder={5}>
                      <boxGeometry args={[len, 0.012, thick * 0.86]} />
                      <meshBasicMaterial color={night ? '#f1f8ff' : '#f6faff'} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
                    </mesh>
                  )}
                </group>
              )
            })
          }
          // 正常（显示全部）：渲染持久化墙段，重叠/共用墙去重（相同位置只渲染一层，避免透明墙重叠变厚变暗）
          const seen = new Set()
          const deduped = (floor.walls || []).filter((w) => {
            const k = wallKey({ a: w.start, b: w.end })
            if (seen.has(k)) return false
            seen.add(k); return true
          })
          return deduped.map((w, i) => {
          const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
          if (len < 0.001) return null
          const h = w.height || floor.height || 2.8
          const thick = w.thickness || WALL_THICK
          const wallColor = glassMode ? (w.color || glassWallColor) : (mihomeMode ? '#F0F0F0' : (w.color || th.wallColor))
          const wallOpacityVal = glassMode ? 0.24 : (mihomeMode ? 0.197 : (w.opacity != null ? w.opacity : 100) / 100)
          const mx = (w.start[0] + w.end[0]) / 2
          const mz = (w.start[1] + w.end[1]) / 2
          const ang = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0])
          const isSel = wallSelIds.includes(w.id)
          return (
            <group key={w.id || i}>
              <mesh
                position={[mx, h / 2 + level, mz]}
                rotation={[0, -ang, 0]}
                onClick={!editing ? undefined : tool === 'delete' ? (e) => { e.stopPropagation(); onSelect({ type: 'wall', ref: w, index: i }) }
                  : tool === 'select' ? (e) => {
                    e.stopPropagation()
                    if (e.ctrlKey || e.metaKey || multiSelect) {
                      const cur = getState().wallSel || []
                      const next = cur.includes(w.id) ? cur.filter((x) => x !== w.id) : [...cur, w.id]
                      setState({ wallSel: next, selected: null })
                    } else {
                      setState({ wallSel: [w.id], selected: null })
                    }
                  }
                  : undefined}
                geometry={view2d ? undefined : wallGeometry(len, h, thick, (floor.openings || []).filter(o => o.wallId === w.id))}
              >
                {view2d && <boxGeometry args={[len, 0.01, thick]} />}
                {view2d
                  ? <meshBasicMaterial color={isSel ? '#3D88FF' : '#3a4a66'} />
                  : <WallMaterial texture={w.texture} color={wallColor} opacity={wallOpacityVal} selected={isSel} glassMode={glassMode} glassOpacity={glassOpacity} />}
              </mesh>
              {/* 墙顶白色高光条（让墙顶轮廓清晰） */}
              {!view2d && glassMode && (
                <mesh position={[mx, h + level + 0.006, mz]} rotation={[0, -ang, 0]} renderOrder={5}>
                  <boxGeometry args={[len, 0.012, thick * 0.86]} />
                  <meshBasicMaterial color={night ? '#f1f8ff' : '#f6faff'} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
                </mesh>
              )}
              {/* 选中高亮：外圈蓝色线框（透明墙也看得清） */}
              {isSel && (
                <mesh position={[mx, h / 2 + level, mz]} rotation={[0, -ang, 0]} scale={[1.08, 1.08, 1.08]}>
                  <boxGeometry args={[len, view2d ? 0.02 : h, thick]} />
                  <meshBasicMaterial color="#3D88FF" wireframe transparent opacity={0.8} depthWrite={false} />
                </mesh>
              )}
            </group>
          )
          })
        })()}

        {/* 整体地板（全部视图）：一整块，半透明无缝，每房间颜色用顶点颜色 */}
        {!focusRoom && wholeFloorGeo && (
          <mesh geometry={wholeFloorGeo} position={[0, level + 0.025, 0]} renderOrder={1} receiveShadow>
            <FloorMaterial color={mihomeMode ? '#EAE8E5' : (floor.color || '#EAE8E5')} view2d={view2d} opacity={mihomeMode ? 100 : ((floor?.rooms || [])[0]?.opacity)} vertexColors={!mihomeMode} />
          </mesh>
        )}

        {/* 房间边界线（Line2 宽度恒定，贴地板表面，被家具正常遮挡；roomBorderLines 开关、roomBorderAlways 不被遮挡） */}
        {roomBorderLines && !view2d && !focusRoom && <RoomBorderLines floor={floor} level={level} alwaysVisible={roomBorderAlways} skipDoors={roomBorderSkipDoors} />}

        {/* 房间（地板只在单房间聚焦时渲染，全部视图用整体地板） */}
        {(floor.rooms || []).filter((r) => !focusRoom || r.id === focusRoomId).map((room, idx) => (
          <Room key={room.id} room={room} roomIdx={idx} floor={floor} level={level}
            interactive={interactive}
            onSelect={(r) => onSelect({ type: 'room', ref: r })} />
        ))}

        {/* 门窗（showOpenings 关闭则去除；聚焦房间时只显示属于该房间边的门窗） */}
        {showOpenings && (floor.openings || []).filter((op) => !focusRoom || openingInRoom(op, focusRoom)).map((op) => <Opening key={op.id} op={op} floor={floor} level={level} onSelect={interactive ? onSelect : undefined} />)}

        {/* 家具（结构模式隐藏摆设，只看户型结构） */}
        {mode !== '结构' && (floor.furniture || []).filter((f) => ptInFocus(f.pos[0], f.pos[2])).map((f) => (
          <Furniture key={f.id} item={f} level={level}
            selected={sel && sel.type === 'furniture' && sel.ref.id === f.id}
            interactive={interactive}
            canDrag={canDrag}
            onSelect={(f) => onSelect({ type: 'furniture', ref: f })}
            onMove={handleMoveFurniture} />
        ))}

        {/* 设备（结构模式隐藏） */}
        {mode !== '结构' && (floor.devices || []).filter((d) => ptInFocus(d.pos[0], d.pos[2])).map((dev) => (
          <DeviceMarker key={dev.id} dev={dev} level={level}
            selected={sel && sel.type === 'device' && sel.ref.id === dev.id}
            interactive={interactive}
            canDrag={canDrag}
            onMove={handleMoveFurniture}
            onSelect={(d) => onSelect({ type: 'device', ref: d })} />
        ))}
      </group>
    </>
  )
}
