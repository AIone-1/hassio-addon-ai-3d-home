import * as THREE from 'three'
import { useStore, setState, currentFloor, uid, snap as doSnap, toast } from '../store'

// 编辑器交互：画墙/放家具/放设备/开门窗/删除
export default function EditorController() {
  const tool = useStore((s) => s.tool)
  const editing = useStore((s) => s.editing)
  const furnitureType = useStore((s) => s.furnitureType)
  const pendingEntity = useStore((s) => s.pendingEntity)
  const snapOn = useStore((s) => s.snap)
  const project = useStore((s) => s.project)

  const floor = currentFloor()
  if (!floor) return null
  const level = floor.level || 0

  const pointOnFloor = (event) => {
    // event.point 是世界坐标（已命中交互平面）
    let x = event.point.x, z = event.point.z
    if (snapOn) { x = doSnap(x); z = doSnap(z) }
    return [x, z]
  }

  const handleFloorClick = (event) => {
    event.stopPropagation()
    if (!editing) return
    const [x, z] = pointOnFloor(event)

    switch (tool) {
      case 'wall': {
        // 画墙：每点一下立即生成一段可见墙体；回到起点闭合 → 自动生成房间
        floor.walls = floor.walls || []
        if (!window.__wallDraft) window.__wallDraft = { pts: [] }
        const draft = window.__wallDraft
        const first = draft.pts[0]
        // 回到起点（<0.3m）闭合
        if (first && Math.hypot(x - first[0], z - first[1]) < 0.3) {
          if (draft.pts.length >= 3) {
            floor.rooms = floor.rooms || []
            floor.rooms.push({
              id: uid(), name: `房间${floor.rooms.length + 1}`,
              height: floor.height || 2.8, color: '#d8cbb2', points: draft.pts,
            })
            // 房间自带墙，清除手绘墙段避免重复
            floor.walls = []
          }
          window.__wallDraft = null
          setState({ project: { ...project }, saved: false })
          toast('房间已生成！可继续画下一个')
          break
        }
        // 从上一个点连到新点，生成可见墙段
        if (draft.pts.length > 0) {
          const prev = draft.pts[draft.pts.length - 1]
          floor.walls.push({ a: [...prev], b: [x, z] })
        }
        draft.pts.push([x, z])
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
      case 'delete': {
        break // 删除由具体对象点击处理
      }
      default: break
    }
  }

  return (
    <>
      {/* 交互平面（透明，捕获空白处点击） */}
      <mesh
        position={[0, level - 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={editing}
        onPointerDown={handleFloorClick}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* 画墙草稿预览 */}
      {editing && tool === 'wall' && window.__wallDraft && window.__wallDraft.pts.length > 0 && (
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={window.__wallDraft.pts.length}
              array={Float32Array.from(window.__wallDraft.pts.flatMap((p) => [p[0], level + 0.02, p[1]]))}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#5aa2ff" />
        </line>
      )}
    </>
  )
}
