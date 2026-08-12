import { useRef } from 'react'
import * as THREE from 'three'
import { useStore, setState, currentFloor, uid, snap as doSnap, toast } from '../store'

// 编辑器交互：画墙（点→拖虚线预览→点生成）、放家具、放设备、删除
export default function EditorController() {
  const tool = useStore((s) => s.tool)
  const editing = useStore((s) => s.editing)
  const furnitureType = useStore((s) => s.furnitureType)
  const pendingEntity = useStore((s) => s.pendingEntity)
  const snapOn = useStore((s) => s.snap)
  const project = useStore((s) => s.project)
  const previewRef = useRef(null)

  const floor = currentFloor()
  if (!floor) return null
  const level = floor.level || 0

  const pointOnFloor = (event) => {
    let x = event.point.x, z = event.point.z
    if (snapOn) { x = doSnap(x); z = doSnap(z) }
    return [x, z]
  }

  // 按下：画墙点/放家具/放设备
  const handleFloorDown = (event) => {
    event.stopPropagation()
    if (!editing) return
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
          window.__wallPreview = null
          if (previewRef.current) previewRef.current.visible = false
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
  }

  // 移动：画墙时更新虚线预览
  const handleFloorMove = (event) => {
    if (!editing || tool !== 'wall' || !window.__wallDraft || !previewRef.current) return
    const draft = window.__wallDraft
    if (!draft.pts.length) return
    const [x, z] = pointOnFloor(event)
    const prev = draft.pts[draft.pts.length - 1]
    previewRef.current.visible = true
    const geo = previewRef.current.geometry
    geo.setFromPoints([
      new THREE.Vector3(prev[0], level + 0.03, prev[1]),
      new THREE.Vector3(x, level + 0.03, z),
    ])
    previewRef.current.computeLineDistances()
  }

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

      {/* 画墙虚线预览（点住拖动时显示） */}
      <line ref={previewRef} visible={false}>
        <bufferGeometry />
        <lineDashedMaterial color="#5aa2ff" dashSize={0.3} gapSize={0.15} />
      </line>
    </>
  )
}
