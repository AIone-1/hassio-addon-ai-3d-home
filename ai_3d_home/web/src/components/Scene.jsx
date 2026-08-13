import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore, setState } from '../store'
import { roomWallSegments, FURNITURE_COLORS, FURNITURE_LIB, WALL_THICK, robustFloorGeometry } from '../three/geometry'

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

// ---------- 房间（地板 + 墙） ----------
function Room({ room, roomIdx, floor, level, selected, onSelect, interactive }) {
  const pts = room.points || []
  const view2d = useStore((s) => s.view2d)
  if (pts.length < 3) return null
  const h = room.height || floor.height || 2.8
  // 2D 用深色清晰实线（floor plan 感），3D 用浅色墙
  const wallColor = selected ? '#2f7fe0' : (view2d ? '#3a4a66' : '#f5f2ec')
  // 每个房间地板明显高度差（0.05m），彻底避免重叠房间 z-fighting 互相盖住
  const floorY = level + roomIdx * 0.05

  // 地板：按房间多边形实际形状（万能三角剖分，直接水平铺设，法线朝上）
  const floorGeo = useMemo(() => robustFloorGeometry(pts, THREE), [JSON.stringify(pts)])

  return (
    <group onClick={interactive ? (e) => { e.stopPropagation(); onSelect(room) } : undefined}>
      {/* 地板：多边形形状，法线朝上，renderOrder 强制绘制在前 */}
      <mesh geometry={floorGeo} position={[0, floorY, 0]} renderOrder={1}>
        {view2d
          ? <meshBasicMaterial color={room.color || floor.color || '#d5c6a8'} side={THREE.DoubleSide} />
          : <meshStandardMaterial color={room.color || floor.color || '#d8cbb2'} roughness={0.9} side={THREE.DoubleSide} />}
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
      {/* 墙（2D 深色实线；3D 毛玻璃材质对齐原版） */}
      {roomWallSegments(room).map((seg, i) => {
        const len = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1])
        if (len < 0.001) return null
        const mx = (seg.a[0] + seg.b[0]) / 2
        const mz = (seg.a[1] + seg.b[1]) / 2
        const ang = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0])
        return (
          <mesh key={i} position={[mx, h / 2 + level, mz]} rotation={[0, -ang, 0]}>
            <boxGeometry args={[len, view2d ? 0.01 : h, view2d ? WALL_THICK : WALL_THICK]} />
            {view2d
              ? <meshBasicMaterial color={wallColor} />
              : <meshPhysicalMaterial color={wallColor} transparent opacity={selected ? 0.6 : 0.35} roughness={0.2} clearcoat={1} clearcoatRoughness={0.2} />}
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
  const autoRotate = useStore((s) => s.autoRotate)
  const selected = useStore((s) => s.selected)
  const tool = useStore((s) => s.tool)
  const mode = useStore((s) => s.mode)
  const view2d = useStore((s) => s.view2d)
  const editing = useStore((s) => s.editing)
  const rootRef = useRef()

  // 放置工具（墙/家具/设备）时不拦截点击，让交互平面接收
  const interactive = tool === 'select' || tool === 'delete'
  const canDrag = tool === 'select' && view2d
  const ml = MODE_LIGHT[mode] || MODE_LIGHT['全屋']

  // 家具移动：更新位置 + 触发保存
  const handleMoveFurniture = () => {
    setState({ project: { ...project }, saved: false })
  }

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
              <boxGeometry args={[len, view2d ? 0.01 : h, WALL_THICK]} />
              {view2d
                ? <meshBasicMaterial color="#3a4a66" />
                : <meshPhysicalMaterial color="#ffffff" transparent opacity={0.45} roughness={0.2} clearcoat={1} clearcoatRoughness={0.2} />}
            </mesh>
          )
        })}

        {/* 房间 */}
        {(floor.rooms || []).map((room, idx) => (
          <Room key={room.id} room={room} roomIdx={idx} floor={floor} level={level}
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
