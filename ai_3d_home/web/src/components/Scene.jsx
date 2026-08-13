import { useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore, setState } from '../store'
import { FURNITURE_LIB, FURNITURE_MAIN, FURNITURE_DETAIL, FURNITURE_ACCENT, WALL_THICK, robustFloorGeometry } from '../three/geometry'

// 对齐原版主题（glass 视觉风格）：墙=半透明毛玻璃，地板=冷色调色板
const THEME = {
  day: {
    wallColor: '#d5e0f1',
    wallOpacity: 0.197,  // 原版 wallOpacity 0.24 × 0.82
    floorPalette: ['#7789ad', '#8294b7', '#8a9bbd', '#7285aa', '#7e91b5'],
  },
  night: {
    wallColor: '#d0dcee',
    wallOpacity: 0.197,
    floorPalette: ['#7587aa', '#8092b5', '#8799bb', '#7184a8', '#7d90b3'],
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
function FurnitureModel({ type }) {
  const lib = FURNITURE_LIB.find((f) => f.type === type)
  const w = lib ? lib.w : 1
  const d = lib ? lib.d : 0.6
  const h = lib ? lib.h : 0.6
  const M = FURNITURE_MAIN
  const D = FURNITURE_DETAIL
  const A = FURNITURE_ACCENT
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
    default:
      return <FBox position={[0, h / 2, 0]} size={[w, h, d]} color={M} />
  }
}

// 选中高亮框（蓝色线框）
function SelectBox({ center, size, rot }) {
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2])
    return new THREE.EdgesGeometry(g)
  }, [size[0], size[1], size[2]])
  return (
    <lineSegments geometry={geo} position={[center[0], center[1], center[2]]} rotation={[0, (rot || 0) * Math.PI / 180, 0]}>
      <lineBasicMaterial color="#2f7fe0" />
    </lineSegments>
  )
}

// ---------- 单个家具（支持选择工具下拖动移动） ----------
function Furniture({ item, level, selected, onSelect, onMove, interactive, canDrag }) {
  const pos = item.pos || [0, 0, 0]
  const rot = item.rot || 0
  const scale = item.scale || [1, 1, 1]
  const lib = FURNITURE_LIB.find((f) => f.type === item.type)
  const w = (lib ? lib.w : 1) * (scale[0] || 1)
  const d = (lib ? lib.d : 0.6) * (scale[2] || 1)
  const { camera, gl } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -level), [level])
  const dragRef = useRef(false)

  const toWorld = (e) => {
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    const p = new THREE.Vector3()
    return raycaster.ray.intersectPlane(plane, p) ? p : null
  }

  return (
    <group
      position={[pos[0], level + (pos[1] || 0), pos[2]]}
      rotation={[0, rot * Math.PI / 180, 0]}
      scale={scale}
      onClick={interactive ? (e) => { e.stopPropagation(); onSelect(item) } : undefined}
      onPointerDown={canDrag ? (e) => {
        e.stopPropagation()
        onSelect(item)
        dragRef.current = true
        e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId)
      } : undefined}
      onPointerMove={canDrag ? (e) => {
        if (!dragRef.current) return
        e.stopPropagation()
        const p = toWorld(e)
        if (p) {
          item.pos[0] = Math.round(p.x * 10) / 10
          item.pos[2] = Math.round(p.z * 10) / 10
          onMove(item)
        }
      } : undefined}
      onPointerUp={canDrag ? () => { dragRef.current = false } : undefined}
    >
      <FurnitureModel type={item.type} />
      {selected && <SelectBox center={[0, (lib && lib.type === '床' ? 1 : 0.6), 0]} size={[w + 0.3, 1.4, d + 0.3]} rot={0} />}
    </group>
  )
}

// ---------- 房间（地板 + 2D 描边；墙在 Scene 层统一去重渲染） ----------
function Room({ room, roomIdx, floor, level, onSelect, interactive }) {
  const pts = room.points || []
  const view2d = useStore((s) => s.view2d)
  if (pts.length < 3) return null
  // 所有房间地板同一高度（对齐原版 0.025m；房间不重叠，无需高度差）
  const floorY = level + 0.025

  // 地板：按房间多边形实际形状（万能三角剖分，直接水平铺设，法线朝上）
  const floorGeo = useMemo(() => robustFloorGeometry(pts, THREE), [JSON.stringify(pts)])

  return (
    <group onClick={interactive ? (e) => { e.stopPropagation(); onSelect(room) } : undefined}>
      {/* 地板：多边形形状，法线朝上，renderOrder 强制绘制在前 */}
      <mesh geometry={floorGeo} position={[0, floorY, 0]} renderOrder={1}>
        {view2d
          ? <meshBasicMaterial color={room.color || floor.color || '#d5c6a8'} side={THREE.DoubleSide} />
          : <meshPhysicalMaterial color={room.color || floor.color || '#7789ad'} roughness={0.46} metalness={0.02} clearcoat={0.2} clearcoatRoughness={0.82} side={THREE.DoubleSide} />}
      </mesh>
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

// ---------- 门窗（墙段上的开口，对齐原版） ----------
function Opening({ op, floor, level }) {
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
  const depth = WALL_THICK + 0.01

  if (isDoor) {
    // 门：门框（左右+上）+ 门扇（木色微开）+ 把手
    const doorH = h * 0.75
    const frameT = 0.06
    const frame = (x, y, w, hh) => (
      <mesh position={[x, y, 0]} receiveShadow>
        <boxGeometry args={[w, hh, depth]} />
        <meshStandardMaterial color="#e7ebef" roughness={0.56} metalness={0.01} />
      </mesh>
    )
    return (
      <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
        {frame(-wd / 2, doorH / 2, frameT, doorH)}
        {frame(wd / 2, doorH / 2, frameT, doorH)}
        {frame(0, doorH - frameT / 2, wd, frameT)}
        {/* 门扇（以左侧为轴，微开） */}
        <group position={[-wd / 2, 0, 0]} rotation={[0, -0.58, 0]}>
          <mesh position={[wd / 2, doorH / 2, 0.03]} castShadow>
            <boxGeometry args={[wd * 0.96, doorH * 0.97, 0.045]} />
            <meshStandardMaterial color="#4a7ab5" roughness={0.72} metalness={0.012} />
          </mesh>
          {/* 把手 */}
          <mesh position={[wd * 0.8, doorH * 0.54, 0.065]}>
            <sphereGeometry args={[0.035, 16, 8]} />
            <meshStandardMaterial color="#71604d" metalness={0.55} roughness={0.28} />
          </mesh>
        </group>
      </group>
    )
  }
  // 窗：玻璃（透光）+ 边框（上下左右 4 条）
  const winH = 0.9
  const winY = h - 1.4
  const bar = (x, y, w, hh) => (
    <mesh position={[x, y, 0]}>
      <boxGeometry args={[w, hh, 0.04]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.58} depthWrite={false} toneMapped={false} />
    </mesh>
  )
  return (
    <group position={[px, level + winY + winH / 2, pz]} rotation={[0, -ang, 0]}>
      <mesh>
        <planeGeometry args={[wd, winH]} />
        <meshPhysicalMaterial color="#d8f2ff" transmission={0.72} transparent opacity={0.5} roughness={0.08} metalness={0.02} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {bar(0, winH / 2, wd, 0.03)}
      {bar(0, -winH / 2, wd, 0.03)}
      {bar(-wd / 2, 0, 0.03, winH)}
      {bar(wd / 2, 0, 0.03, winH)}
    </group>
  )
}

// ---------- 设备标记 ----------
function DeviceMarker({ dev, level, selected, onSelect, interactive }) {
  const state = useStore((s) => s.haStates[dev.entity_id])
  const domain = (dev.entity_id || '').split('.')[0]
  const isOn = state && state.state === 'on'

  let color = '#556677', emissive = '#334455'
  if (domain === 'light' || domain === 'switch') {
    color = isOn ? '#ffd166' : '#3a4658'
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
    <group position={[dev.pos[0], level + (dev.pos[1] || 1.4), dev.pos[2]]}>
      <mesh onClick={interactive ? (e) => { e.stopPropagation(); onSelect(dev) } : undefined}>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.6} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.25, 0.35, 24]} />
          <meshBasicMaterial color="#2f7fe0" side={THREE.DoubleSide} transparent opacity={0.8} />
        </mesh>
      )}
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
export default function Scene({ onSelect, floorIndex }) {
  const project = useStore((s) => s.project)
  const floor = useStore((s) => s.project.floors[floorIndex])
  const night = useStore((s) => s.night)
  const shadows = useStore((s) => s.shadows)
  const selected = useStore((s) => s.selected)
  const tool = useStore((s) => s.tool)
  const mode = useStore((s) => s.mode)
  const view2d = useStore((s) => s.view2d)
  const editing = useStore((s) => s.editing)

  // 放置工具（墙/家具/设备）时不拦截点击，让交互平面接收
  const interactive = tool === 'select' || tool === 'delete'
  const canDrag = tool === 'move' && editing
  const ml = MODE_LIGHT[mode] || MODE_LIGHT['全屋']
  const th = night ? THEME.night : THEME.day

  // 家具移动：更新位置 + 触发保存
  const handleMoveFurniture = () => {
    setState({ project: { ...project }, saved: false })
  }

  if (!floor) return null
  const level = floor.level || 0
  const sel = selected

  return (
    <>
      {/* 环境光（随渲染模式变化，默认提亮便于看清） */}
      <ambientLight intensity={night ? 0.4 : Math.max(ml.ambient, 0.7)} />
      <hemisphereLight args={[ml.tint, '#6a7a9a', night ? 0.35 : Math.max(ml.hemi, 0.6)]} />
      <directionalLight
        position={[8, 14, 9]} intensity={night ? 0.7 : Math.max(ml.sun, 1.6)} color={ml.sunColor}
        castShadow={shadows}
        shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-left={-16} shadow-camera-right={16}
        shadow-camera-top={16} shadow-camera-bottom={-16}
        shadow-bias={-0.00016}
      />

      <group>
        {/* 2D 模式：无房间时显示白色画图平面（编辑界面用干净表面，背景图不在这里生效） */}
        {view2d && (floor.rooms || []).length === 0 && (
          <mesh position={[0, level - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[80, 80]} />
            <meshBasicMaterial color={night ? '#1c2333' : '#f7fafc'} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* 网格：只在编辑时显示。2D 用加粗清晰网格（1m 格），3D 编辑用细网格 */}
        {editing && view2d && <DrawingGrid size={20} cell={1} level={level} night={night} />}
        {editing && !view2d && (
          <gridHelper
            args={[30, 30, night ? '#5a6a8a' : '#b8c6d8', night ? '#3a4a6a' : '#dde6ef']}
            position={[0, level + 0.005, 0]}
          />
        )}

        {/* 墙（持久化线段，毛玻璃材质对齐原版；删除模式可点） */}
        {(floor.walls || []).map((w, i) => {
          const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
          if (len < 0.001) return null
          const h = floor.height || 2.8
          const mx = (w.start[0] + w.end[0]) / 2
          const mz = (w.start[1] + w.end[1]) / 2
          const ang = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0])
          return (
            <mesh
              key={w.id || i}
              position={[mx, h / 2 + level, mz]}
              rotation={[0, -ang, 0]}
              onClick={tool === 'delete' ? (e) => { e.stopPropagation(); onSelect({ type: 'wall', ref: w, index: i }) } : undefined}
            >
              <boxGeometry args={[len, view2d ? 0.01 : h, WALL_THICK]} />
              {view2d
                ? <meshBasicMaterial color="#3a4a66" />
                : <meshPhysicalMaterial color={th.wallColor} transparent opacity={th.wallOpacity} roughness={0.5} metalness={0} clearcoat={0.16} clearcoatRoughness={0.72} depthWrite={false} />}
            </mesh>
          )
        })}

        {/* 房间 */}
        {(floor.rooms || []).map((room, idx) => (
          <Room key={room.id} room={room} roomIdx={idx} floor={floor} level={level}
            interactive={interactive}
            onSelect={(r) => onSelect({ type: 'room', ref: r })} />
        ))}

        {/* 门窗 */}
        {(floor.openings || []).map((op) => <Opening key={op.id} op={op} floor={floor} level={level} />)}

        {/* 家具 */}
        {(floor.furniture || []).map((f) => (
          <Furniture key={f.id} item={f} level={level}
            selected={sel && sel.type === 'furniture' && sel.ref.id === f.id}
            interactive={interactive}
            canDrag={canDrag}
            onSelect={(f) => onSelect({ type: 'furniture', ref: f })}
            onMove={handleMoveFurniture} />
        ))}

        {/* 设备 */}
        {(floor.devices || []).map((dev) => (
          <DeviceMarker key={dev.id} dev={dev} level={level}
            selected={sel && sel.type === 'device' && sel.ref.id === dev.id}
            interactive={interactive}
            onSelect={(d) => onSelect({ type: 'device', ref: d })} />
        ))}
      </group>
    </>
  )
}
