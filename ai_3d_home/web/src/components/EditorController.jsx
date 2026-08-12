import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { useStore, setState, currentFloor, uid, snap as doSnap, toast } from '../store'

// 画墙虚线预览：用细长方块拼成粗虚线（1px 的 line 太细看不清）
function DashedPreview({ a, b, level }) {
  const segs = useMemo(() => {
    if (!a || !b) return []
    const dx = b[0] - a[0], dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < 0.01) return []
    const n = Math.max(4, Math.round(len / 0.4))
    const out = []
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 0.55) / n
      out.push({
        x: a[0] + dx * t0, z: a[1] + dz * t0,
        len: Math.hypot(dx * (t1 - t0), dz * (t1 - t0)),
        ang: Math.atan2(dz, dx),
      })
    }
    return out
  }, [a && a[0], a && a[1], b && b[0], b && b[1]])

  return (
    <group>
      {segs.map((s, i) => (
        <mesh key={i} position={[s.x, level + 0.06, s.z]} rotation={[0, -s.ang, 0]}>
          <boxGeometry args={[s.len + 0.03, 0.03, 0.07]} />
          <meshBasicMaterial color="#2f7fe0" />
        </mesh>
      ))}
    </group>
  )
}

// 编辑器交互：画墙（点→拖虚线预览→点生成）、放家具、放设备、删除
export default function EditorController() {
  const tool = useStore((s) => s.tool)
  const editing = useStore((s) => s.editing)
  const furnitureType = useStore((s) => s.furnitureType)
  const pendingEntity = useStore((s) => s.pendingEntity)
  const snapOn = useStore((s) => s.snap)
  const project = useStore((s) => s.project)
  const [preview, setPreview] = useState(null)
  const [hover, setHover] = useState(null)

  const floor = currentFloor()
  if (!floor) return null
  const level = floor.level || 0

  const pointOnFloor = (event) => {
    let x = event.point.x, z = event.point.z
    if (snapOn) { x = doSnap(x, 0.5); z = doSnap(z, 0.5) }
    return [x, z]
  }

  // 按下：画墙点/放家具/放设备（只允许左键，右键平移不误触）
  const handleFloorDown = (event) => {
    event.stopPropagation()
    if (!editing) return
    if (event.button !== 0) return  // 非左键（右键/中键）忽略，避免和 OrbitControls 平移冲突
    const [x, z] = pointOnFloor(event)

    switch (tool) {
      case 'wall': {
        floor.walls = floor.walls || []
        if (!window.__wallDraft) window.__wallDraft = { pts: [] }
        const draft = window.__wallDraft
        const first = draft.pts[0]
        // 点回起点（<0.3m）闭合 → 生成房间
        if (first && Math.hypot(x - first[0], z - first[1]) < 0.3) {
          if (draft.pts.length >= 3) {
            floor.rooms = floor.rooms || []
            floor.rooms.push({
              id: uid(), name: `房间${floor.rooms.length + 1}`,
              height: floor.height || 2.8, color: '#d8cbb2', points: draft.pts,
            })
            floor.walls = [] // 房间自带墙
          }
          window.__wallDraft = null
          setPreview(null)
          toast('房间已生成！')
        } else {
          // 从上一个点连到新点，生成线段
          if (draft.pts.length > 0) {
            const prev = draft.pts[draft.pts.length - 1]
            floor.walls.push({ a: [...prev], b: [x, z] })
          }
          draft.pts.push([x, z])
        }
        setState({ project: { ...project }, saved: false })
        break
      }
      case 'furniture': {
        floor.furniture = floor.furniture || []
        floor.furniture.push({ id: uid(), type: furnitureType, pos: [x, 0, z], rot: 0, scale: [1, 1, 1] })
        setState({ project: { ...project }, saved: false })
        break
      }
      case 'device': {
        if (!pendingEntity) return
        floor.devices = floor.devices || []
        floor.devices.push({
          id: uid(), name: pendingEntity.name || pendingEntity.entity_id,
          entity_id: pendingEntity.entity_id, pos: [x, 1.4, z],
        })
        setState({ project: { ...project }, pendingEntity: null, bindOpen: false, saved: false })
        break
      }
      default: break
    }
    // 空白点击取消选中
    if (tool === 'select') {
      setState({ selected: null })
    }
  }

  // 移动：画墙时更新虚线预览 + 吸附点位置
  const handleFloorMove = (event) => {
    if (!editing) return
    const [x, z] = pointOnFloor(event)
    // 吸附点：墙/家具/设备工具下显示
    if (tool === 'wall' || tool === 'furniture' || tool === 'device') {
      setHover([x, z])
    }
    if (tool === 'wall' && window.__wallDraft && window.__wallDraft.pts.length) {
      setPreview([x, z])
    }
  }

  const draft = window.__wallDraft
  const lastPt = draft && draft.pts.length ? draft.pts[draft.pts.length - 1] : null

  return (
    <>
      {/* 交互平面（透明，捕获空白处点击） */}
      <mesh
        position={[0, level - 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={editing}
        onPointerDown={handleFloorDown}
        onPointerMove={handleFloorMove}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* 吸附点标记（墙/家具/设备工具下，鼠标位置显示，吸附开时对齐 0.5m） */}
      {editing && (tool === 'wall' || tool === 'furniture' || tool === 'device') && hover && (
        <group position={[hover[0], level + 0.03, hover[1]]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.12, 0.18, 24]} />
            <meshBasicMaterial color="#2f7fe0" side={THREE.DoubleSide} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.05, 10, 10]} />
            <meshBasicMaterial color="#2f7fe0" />
          </mesh>
        </group>
      )}

      {/* 画墙虚线预览（点住拖动时显示，粗虚线清晰） */}
      {editing && tool === 'wall' && lastPt && preview && (
        <DashedPreview a={lastPt} b={preview} level={level} />
      )}
    </>
  )
}
