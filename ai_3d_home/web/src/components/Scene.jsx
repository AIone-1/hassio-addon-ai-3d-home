import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import { roomWallSegments, FURNITURE_COLORS, FURNITURE_LIB, WALL_THICK } from '../three/geometry'

// ---------- 家具模型（按类型用基础体组合，原点在底部中心） ----------
function FurnitureModel({ type }) {
  const lib = FURNITURE_LIB.find((f) => f.type === type)
  const w = lib ? lib.w : 1
  const d = lib ? lib.d : 0.6
  const c = FURNITURE_COLORS[type] || '#9aa7b5'

  switch (type) {
    case '沙发': return (
      <group>
        <mesh position={[0, 0.2, 0]}><boxGeometry args={[w, 0.4, d]} /><meshStandardMaterial color={c} /></mesh>
        <mesh position={[0, 0.65, -d / 2 + 0.1]}><boxGeometry args={[w, 0.6, 0.2]} /><meshStandardMaterial color={c} /></mesh>
        <mesh position={[-w / 2 + 0.09, 0.3, 0]}><boxGeometry args={[0.18, 0.6, d]} /><meshStandardMaterial color={c} /></mesh>
        <mesh position={[w / 2 - 0.09, 0.3, 0]}><boxGeometry args={[0.18, 0.6, d]} /><meshStandardMaterial color={c} /></mesh>
      </group>
    )
    case '床': return (
      <group>
        <mesh position={[0, 0.175, 0]}><boxGeometry args={[w, 0.35, d]} /><meshStandardMaterial color={c} /></mesh>
        <mesh position={[0, 0.55, -d / 2 + 0.06]}><boxGeometry args={[w, 0.7, 0.12]} /><meshStandardMaterial color={c} /></mesh>
        <mesh position={[0, 0.42, d * 0.3]}><boxGeometry args={[0.5, 0.1, 0.6]} /><meshStandardMaterial color="#f0f0f0" /></mesh>
      </group>
    )
    case '餐桌': case '书桌': case '茶几': {
      const topH = type === '书桌' ? 0.75 : 0.75
      return (
        <group>
          <mesh position={[0, topH, 0]}><boxGeometry args={[w, 0.06, d]} /><meshStandardMaterial color={c} /></mesh>
          {[[-w/2+0.05, -d/2+0.05], [w/2-0.05, -d/2+0.05], [-w/2+0.05, d/2-0.05], [w/2-0.05, d/2-0.05]].map(([x, z], i) => (
            <mesh key={i} position={[x, topH/2, z]}><cylinderGeometry args={[0.04, 0.04, topH, 6]} /><meshStandardMaterial color="#555" /></mesh>
          ))}
        </group>
      )
    }
    case '衣柜': case '橱柜': return (
      <group>
        <mesh position={[0, 0.45, 0]}><boxGeometry args={[w, 0.9, d]} /><meshStandardMaterial color={c} /></mesh>
        <mesh position={[0, 0.45, d/2 + 0.01]}><boxGeometry args={[w*0.8, 0.04, 0.02]} /><meshStandardMaterial color="#333" /></mesh>
      </group>
    )
    case '岛台': return (
      <group>
        <mesh position={[0, 0.45, 0]}><boxGeometry args={[w, 0.9, d]} /><meshStandardMaterial color={c} /></mesh>
        <mesh position={[0, 0.5, 0]}><boxGeometry args={[w*0.9, 0.1, d*0.9]} /><meshStandardMaterial color="#e8e0d0" /></mesh>
      </group>
    )
    case '书架': return (
      <group>
        <mesh position={[0, 0.6, 0]}><boxGeometry args={[w, 1.2, d]} /><meshStandardMaterial color={c} /></mesh>
        <mesh position={[0, 0.6, d/2+0.02]}><boxGeometry args={[w*0.9, 1.1, 0.03]} /><meshStandardMaterial color="#f5f0e8" /></mesh>
      </group>
    )
    default: return (
      <mesh position={[0, 0.25, 0]}><boxGeometry args={[w, 0.5, d]} /><meshStandardMaterial color={c} /></mesh>
    )
  }
}

// ---------- 单个家具 ----------
function Furniture({ item, level, selected, onSelect, interactive }) {
  const pos = item.pos || [0, 0, 0]
  const rot = item.rot || 0
  const scale = item.scale || [1, 1, 1]
  return (
    <group
      position={[pos[0], level + (pos[1] || 0), pos[2]]}
      rotation={[0, rot * Math.PI / 180, 0]}
      scale={scale}
      onClick={interactive ? (e) => { e.stopPropagation(); onSelect(item) } : undefined}
    >
      <FurnitureModel type={item.type} />
      {selected && <mesh position={[0, 0.02, 0]}><boxGeometry args={[2.4, 0.02, 1.4]} /><meshStandardMaterial color="#5aa2ff" transparent opacity={0.4} /></mesh>}
    </group>
  )
}

// ---------- 房间（地板 + 墙） ----------
function Room({ room, floor, level, selected, onSelect, interactive }) {
  const pts = room.points || []
  if (pts.length < 3) return null
  const h = room.height || floor.height || 2.8
  const wallColor = selected ? '#6aa2ff' : '#f5f2ec'

  const shape = useMemo(() => {
    const s = new THREE.Shape()
    pts.forEach((p, i) => (i === 0 ? s.moveTo(p[0], p[1]) : s.lineTo(p[0], p[1])))
    s.closePath()
    return s
  }, [JSON.stringify(pts)])

  return (
    <group onClick={interactive ? (e) => { e.stopPropagation(); onSelect(room) } : undefined}>
      {/* 地板 */}
      <mesh position={[0, level, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={room.color || floor.color || '#e6dcc8'} side={THREE.DoubleSide} roughness={0.9} />
      </mesh>
      {/* 墙（毛玻璃材质对齐原版） */}
      {roomWallSegments(room).map((seg, i) => {
        const len = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1])
        if (len < 0.001) return null
        const mx = (seg.a[0] + seg.b[0]) / 2
        const mz = (seg.a[1] + seg.b[1]) / 2
        const ang = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0])
        return (
          <mesh key={i} position={[mx, h / 2 + level, mz]} rotation={[0, -ang, 0]}>
            <boxGeometry args={[len, h, WALL_THICK]} />
            <meshPhysicalMaterial color={wallColor} transparent opacity={selected ? 0.6 : 0.35} roughness={0.2} clearcoat={1} clearcoatRoughness={0.2} />
          </mesh>
        )
      })}
    </group>
  )
}

// ---------- 门窗 ----------
function Opening({ op, floor, level }) {
  const room = (floor.rooms || []).find((r) => r.id === op.roomId)
  if (!room || op.wallIndex == null) return null
  const pts = room.points || []
  const a = pts[op.wallIndex % pts.length]
  const b = pts[(op.wallIndex + 1) % pts.length]
  if (!a || !b) return null
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  const h = room.height || floor.height || 2.8
  const t = Math.max(0, Math.min(1, op.offset || 0.5))
  const px = a[0] + (b[0] - a[0]) * t
  const pz = a[1] + (b[1] - a[1]) * t
  const wd = op.width || 0.9
  const isDoor = op.type !== 'window'
  return (
    <mesh position={[px, level + (isDoor ? h * 0.275 : h - 1.4), pz]} rotation={[0, -ang, 0]}>
      {isDoor
        ? <boxGeometry args={[wd, h * 0.55, 0.06]} />
        : <boxGeometry args={[wd, 0.9, 0.05]} />}
      <meshStandardMaterial color={isDoor ? '#8a6b4f' : '#bfe3ff'} roughness={0.6} />
    </mesh>
  )
}

// ---------- 设备标记 ----------
function DeviceMarker({ dev, level, onSelect, interactive }) {
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
    </group>
  )
}

// 渲染模式的光照差异
const MODE_LIGHT = {
  '全屋': { ambient: 0.6, hemi: 0.5, sun: 1.4, sunColor: '#ffffff', tint: '#dfe7ff' },
  '照明': { ambient: 0.4, hemi: 0.4, sun: 0.8, sunColor: '#ffd8a8', tint: '#ffe8c8' },
  '遮阳': { ambient: 0.5, hemi: 0.35, sun: 0.7, sunColor: '#c8d4e8', tint: '#d0d8e8' },
  '环境': { ambient: 0.55, hemi: 0.55, sun: 1.2, sunColor: '#e8f0d8', tint: '#dce8d0' },
  '安防': { ambient: 0.35, hemi: 0.3, sun: 0.6, sunColor: '#e0d8f0', tint: '#c8c8e0' },
}

// ---------- 主场景 ----------
export default function Scene({ onSelect, floorIndex }) {
  const project = useStore((s) => s.project)
  const floor = useStore((s) => s.project.floors[floorIndex])
  const night = useStore((s) => s.night)
  const shadows = useStore((s) => s.shadows)
  const autoRotate = useStore((s) => s.autoRotate)
  const selected = useStore((s) => s.selected)
  const tool = useStore((s) => s.tool)
  const mode = useStore((s) => s.mode)
  const view2d = useStore((s) => s.view2d)
  const editing = useStore((s) => s.editing)
  const rootRef = useRef()

  // 放置工具（墙/家具/设备）时不拦截点击，让交互平面接收
  const interactive = tool === 'select' || tool === 'delete'
  const ml = MODE_LIGHT[mode] || MODE_LIGHT['全屋']

  useFrame((_, delta) => {
    if (autoRotate && rootRef.current) {
      rootRef.current.rotation.y += (20 * Math.PI / 180) * Math.min(delta, 0.1)
    }
  })

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

      <group ref={rootRef}>
        {/* 2D 模式：纯白干净的画图平面 */}
        {view2d && (
          <mesh position={[0, level, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[80, 80]} />
            <meshBasicMaterial color={night ? '#1c2333' : '#f7fafc'} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* 网格：只在编辑时显示；2D 是清晰画图网格（1m 格），退出编辑无网格 */}
        {editing && (
          <gridHelper
            args={[view2d ? 20 : 30, view2d ? 20 : 30, night ? '#5a6a8a' : (view2d ? '#5d84b0' : '#b8c6d8'), night ? '#3a4a6a' : (view2d ? '#b8cae0' : '#dde6ef')]}
            position={[0, level + 0.005, 0]}
          />
        )}

        {/* 手绘墙段（墙体工具直接画的，毛玻璃材质对齐原版；删除模式可点） */}
        {(floor.walls || []).map((w, i) => {
          const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
          if (len < 0.01) return null
          const h = floor.height || 2.8
          const mx = (w.a[0] + w.b[0]) / 2
          const mz = (w.a[1] + w.b[1]) / 2
          const ang = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0])
          return (
            <mesh
              key={i}
              position={[mx, h / 2 + level, mz]}
              rotation={[0, -ang, 0]}
              onClick={tool === 'delete' ? (e) => { e.stopPropagation(); onSelect({ type: 'wall', ref: w, index: i }) } : undefined}
            >
              <boxGeometry args={[len, h, WALL_THICK]} />
              <meshPhysicalMaterial color="#ffffff" transparent opacity={0.45} roughness={0.2} clearcoat={1} clearcoatRoughness={0.2} />
            </mesh>
          )
        })}

        {/* 房间 */}
        {(floor.rooms || []).map((room) => (
          <Room key={room.id} room={room} floor={floor} level={level}
            selected={sel && sel.type === 'room' && sel.ref.id === room.id}
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
            onSelect={(f) => onSelect({ type: 'furniture', ref: f })} />
        ))}

        {/* 设备 */}
        {(floor.devices || []).map((dev) => (
          <DeviceMarker key={dev.id} dev={dev} level={level}
            interactive={interactive}
            onSelect={(d) => onSelect({ type: 'device', ref: d })} />
        ))}
      </group>
    </>
  )
}
