// 独立 SVG 2D 户型编辑器（对齐 JMGLink 原版：SVG + viewBox 缩放平移，与 3D WebGL 完全隔离，永远规整）
// 墙是线段（floor.walls 持久化），房间由墙段的封闭环自动检测（recomputeRooms）——这就是"共用墙/相交也封闭"的机制
import { useRef, useState, useEffect, useMemo } from 'react'
import { useStore, setState, getState, uid, toast } from '../store'
import { FURNITURE_LIB, FURNITURE_COLORS, polygonArea, recomputeRooms } from '../three/geometry'

const GRID = 0.5       // 小网格 0.5m（大格 1m）
const SNAP = 0.5       // 吸附 0.5m
const CLOSE = 0.5      // 画墙闭合半径（点回起点 <0.5m 闭合）
const WALL_T = 0.12    // 墙线宽
const MIN_ZOOM = 0.12
const MAX_ZOOM = 6

// 户型包围盒（房间/家具/设备都算进去；空项目给默认范围）
function floorBounds(floor) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  ;(floor?.rooms || []).forEach(r => (r.points || []).forEach(p => add(p[0], p[1])))
  ;(floor?.walls || []).forEach(w => { add(w.start[0], w.start[1]); add(w.end[0], w.end[1]) })
  ;(floor?.furniture || []).forEach(f => add(f.pos[0], f.pos[2]))
  ;(floor?.devices || []).forEach(d => add(d.pos[0], d.pos[2]))
  if (!isFinite(minX)) { minX = -5; minY = -5; maxX = 5; maxY = 5 }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

// 按画布宽高比扩展包围盒，保证 viewBox 不拉伸（对齐原版 hg）
function fitBounds(b, aspect) {
  let { minX, minY, width, height } = b
  if (width / height > aspect) {
    const nh = width / aspect
    minY -= (nh - height) / 2
    height = nh
  } else {
    const nw = height * aspect
    minX -= (nw - width) / 2
    width = nw
  }
  return { minX, minY, width, height }
}

// 设备标记颜色（按域/状态，对齐 3D 里的 DeviceMarker）
function deviceColor(dev, haStates) {
  const domain = (dev.entity_id || '').split('.')[0]
  const st = haStates[dev.entity_id]
  const isOn = st && st.state === 'on'
  if (domain === 'light' || domain === 'switch') return isOn ? '#ffd166' : '#3a4658'
  if (domain === 'sensor') return '#79d08a'
  if (domain === 'binary_sensor') return isOn ? '#ff6b6b' : '#79d08a'
  return isOn ? '#79d08a' : '#556677'
}

export default function PlanEditor({ onSelect, floorIndex }) {
  const floor = useStore(s => s.project.floors[floorIndex])
  const tool = useStore(s => s.tool)
  const snapOn = useStore(s => s.snap)
  const selected = useStore(s => s.selected)
  const furnitureType = useStore(s => s.furnitureType)
  const pendingEntity = useStore(s => s.pendingEntity)
  const haStates = useStore(s => s.haStates)
  const recenterKey = useStore(s => s.planRecenterKey)
  const zoomDelta = useStore(s => s.planZoomDelta)

  const svgRef = useRef(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState([0, 0])
  const [draft, setDraft] = useState(null)     // { pts: [[x,y],...], walls: [墙对象] } 画墙草稿
  const [cursor, setCursor] = useState(null)    // [x,y] 世界坐标（已吸附）
  const dragRef = useRef(null)                  // 拖动的家具/设备对象
  const panRef = useRef(null)                   // { w:[x,y], p:[x,y] } 平移起点
  const planMoveRef = useRef(null)              // 移动户型的起点世界坐标

  const bounds = useMemo(() => floorBounds(floor), [floor?.rooms, floor?.walls, floor?.furniture, floor?.devices])
  const aspect = size.w / size.h
  const fitted = useMemo(() => fitBounds(bounds, aspect), [bounds, aspect])
  const vbW = fitted.width / zoom
  const vbH = fitted.height / zoom
  const vbX = fitted.minX + (fitted.width - vbW) / 2 + pan[0]
  const vbY = fitted.minY + (fitted.height - vbH) / 2 + pan[1]

  // ---------- 坐标 / 吸附 / 缩放 ----------
  const toWorld = (e) => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const w = pt.matrixTransform(svg.getScreenCTM().inverse())
    return [w.x, w.y]
  }

  // 网格吸附 + 画墙轴向吸附（水平/垂直，让房间规整）+ 端点吸附
  const snap = (pt) => {
    let [x, y] = pt
    if (snapOn) { x = Math.round(x / SNAP) * SNAP; y = Math.round(y / SNAP) * SNAP }
    if (tool === 'wall' && draft && draft.pts.length) {
      const last = draft.pts[draft.pts.length - 1]
      const dx = x - last[0], dy = y - last[1]
      if (Math.abs(dx) > 0.01 && Math.abs(dy / dx) < 0.18) y = last[1]
      else if (Math.abs(dy) > 0.01 && Math.abs(dx / dy) < 0.18) x = last[0]
    }
    // 端点吸附：吸附到已有墙段端点，便于共用墙精准连接
    if (tool === 'wall') {
      let best = null, bd = 0.25
      for (const w of (floor?.walls || [])) {
        for (const p of [w.start, w.end]) {
          const d = Math.hypot(x - p[0], y - p[1])
          if (d < bd) { bd = d; best = p }
        }
      }
      if (best) { x = best[0]; y = best[1] }
    }
    return [x, y]
  }

  // 缩放到目标倍数，保持光标下的世界点不动（对齐原版 pi）
  const zoomTo = (client, target) => {
    const svg = svgRef.current
    const t = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target))
    if (Math.abs(t - zoom) < 0.0001) return
    if (!svg) { setZoom(t); return }
    const r = svg.getBoundingClientRect()
    if (!r.width || !r.height) { setZoom(t); return }
    const sx = Math.max(0, Math.min(1, (client[0] - r.left) / r.width))
    const sy = Math.max(0, Math.min(1, (client[1] - r.top) / r.height))
    const oW = fitted.width / zoom, oH = fitted.height / zoom
    const oX = fitted.minX + (fitted.width - oW) / 2 + pan[0]
    const oY = fitted.minY + (fitted.height - oH) / 2 + pan[1]
    const wx = oX + sx * oW, wy = oY + sy * oH
    const nW = fitted.width / t, nH = fitted.height / t
    const nX0 = fitted.minX + (fitted.width - nW) / 2
    const nY0 = fitted.minY + (fitted.height - nH) / 2
    setPan([wx - nX0 - sx * nW, wy - nY0 - sy * nH])
    setZoom(t)
  }

  // ---------- 画墙：墙段持久化 + 自动检测房间 ----------
  const closeDraft = () => {
    if (!draft || draft.pts.length < 3) { setDraft(null); return }
    const fl = getState().project.floors[floorIndex]
    fl.walls = fl.walls || []
    const first = draft.pts[0], last = draft.pts[draft.pts.length - 1]
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) > 0.01) {
      fl.walls.push({ id: uid(), start: [...last], end: [...first] })
    }
    fl.rooms = recomputeRooms(fl)
    setDraft(null)
    setState({ project: { ...getState().project }, saved: false })
    toast(fl.rooms.length ? `已识别 ${fl.rooms.length} 个房间` : '墙体尚未形成封闭房间')
  }

  const addWallPoint = (raw) => {
    const fl = getState().project.floors[floorIndex]
    fl.walls = fl.walls || []
    if (!draft || !draft.pts.length) {
      setDraft({ pts: [snap(raw)], walls: [] })
      return
    }
    const first = draft.pts[0]
    const gx = snapOn ? Math.round(raw[0] / SNAP) * SNAP : raw[0]
    const gy = snapOn ? Math.round(raw[1] / SNAP) * SNAP : raw[1]
    if (draft.pts.length >= 3 && Math.hypot(gx - first[0], gy - first[1]) < CLOSE) {
      closeDraft()
      return
    }
    const [x, y] = snap(raw)
    const last = draft.pts[draft.pts.length - 1]
    if (Math.hypot(x - last[0], y - last[1]) < 0.01) return  // 点重复，忽略
    const w = { id: uid(), start: [...last], end: [x, y] }
    fl.walls.push(w)
    setDraft({ pts: [...draft.pts, [x, y]], walls: [...draft.walls, w] })
    setState({ project: { ...getState().project }, saved: false })
  }

  const cancelDraft = () => {
    if (!draft) return
    const fl = getState().project.floors[floorIndex]
    fl.walls = (fl.walls || []).filter(w => !draft.walls.includes(w))
    fl.rooms = recomputeRooms(fl)
    setDraft(null)
    setState({ project: { ...getState().project }, saved: false })
    toast('已取消')
  }

  // ---------- 移动整个户型 ----------
  const moveFloorBy = (dx, dy) => {
    const fl = getState().project.floors[floorIndex]
    ;(fl.rooms || []).forEach(r => { r.points = (r.points || []).map(p => [p[0] + dx, p[1] + dy]) })
    ;(fl.walls || []).forEach(w => { w.start = [w.start[0] + dx, w.start[1] + dy]; w.end = [w.end[0] + dx, w.end[1] + dy] })
    ;(fl.furniture || []).forEach(f => { f.pos[0] += dx; f.pos[2] += dy })
    ;(fl.devices || []).forEach(d => { d.pos[0] += dx; d.pos[2] += dy })
  }

  // ---------- 副作用 ----------
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => {
      const r = svg.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { setZoom(1); setPan([0, 0]); setDraft(null); dragRef.current = null }, [recenterKey])

  useEffect(() => {
    if (!zoomDelta) return
    const svg = svgRef.current
    const r = svg ? svg.getBoundingClientRect() : null
    const center = r ? [r.left + r.width / 2, r.top + r.height / 2] : [0, 0]
    zoomTo(center, zoom * (zoomDelta > 0 ? 1.25 : 1 / 1.25))
    setState({ planZoomDelta: 0 })
  }, [zoomDelta])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && draft && draft.pts.length >= 3) closeDraft()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, floorIndex])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e) => {
      e.preventDefault()
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.002 : 0.0012))
      zoomTo([e.clientX, e.clientY], zoom * f)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoom, pan, fitted])

  // ---------- 交互 ----------
  const handleFloorDown = (e) => {
    if (e.button === 2) {
      if (draft) cancelDraft()
      return
    }
    if (e.button === 1 || tool === 'pan') {
      e.preventDefault()
      panRef.current = { w: toWorld(e), p: [pan[0], pan[1]] }
      svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return

    if (tool === 'wall') { addWallPoint(toWorld(e)); return }
    if (tool === 'movePlan') {
      planMoveRef.current = toWorld(e)
      svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'furniture') {
      const [x, y] = snap(toWorld(e))
      const fl = getState().project.floors[floorIndex]
      fl.furniture = fl.furniture || []
      fl.furniture.push({ id: uid(), type: furnitureType, pos: [x, 0, y], rot: 0, scale: [1, 1, 1] })
      setState({ project: { ...getState().project }, saved: false })
      return
    }
    if (tool === 'device') {
      if (!pendingEntity) return
      const [x, y] = snap(toWorld(e))
      const fl = getState().project.floors[floorIndex]
      fl.devices = fl.devices || []
      fl.devices.push({ id: uid(), name: pendingEntity.name || pendingEntity.entity_id, entity_id: pendingEntity.entity_id, pos: [x, 1.4, y] })
      setState({ project: { ...getState().project }, pendingEntity: null, bindOpen: false, saved: false })
      return
    }
    if (tool === 'select' || tool === 'move') setState({ selected: null })
  }

  const handleMove = (e) => {
    const w = toWorld(e)
    if (panRef.current) {
      const p = panRef.current
      setPan([p.p[0] + p.w[0] - w[0], p.p[1] + p.w[1] - w[1]])
      return
    }
    if (planMoveRef.current) {
      const dx = w[0] - planMoveRef.current[0], dy = w[1] - planMoveRef.current[1]
      moveFloorBy(dx, dy)
      planMoveRef.current = w
      setState({ project: { ...getState().project }, saved: false })
      return
    }
    if (dragRef.current) {
      const [x, y] = snap(w)
      dragRef.current.pos[0] = Math.round(x * 10) / 10
      dragRef.current.pos[2] = Math.round(y * 10) / 10
      setState({ project: { ...getState().project }, saved: false })
      setCursor([x, y])
      return
    }
    setCursor((tool === 'wall' || tool === 'furniture' || tool === 'device') ? snap(w) : w)
  }

  const handleUp = () => {
    panRef.current = null
    dragRef.current = null
    planMoveRef.current = null
  }

  const startDrag = (e, type, obj) => {
    if (tool !== 'move') return
    e.stopPropagation()
    setState({ selected: { type, ref: obj } })
    dragRef.current = obj
    svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
  }
  const clickEl = (e, type, ref) => {
    if (tool !== 'select' && tool !== 'delete') return
    e.stopPropagation()
    onSelect({ type, ref })
  }

  const isSel = (type, id) => selected && selected.type === type && selected.ref && selected.ref.id === id
  const rooms = floor?.rooms || []
  const walls = floor?.walls || []
  const furniture = floor?.furniture || []
  const devices = floor?.devices || []

  return (
    <svg
      ref={svgRef}
      className="plan-editor"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={handleFloorDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerLeave={handleUp}
      onPointerCancel={handleUp}
      onContextMenu={e => e.preventDefault()}
    >
      <defs>
        <pattern id="plan-minor-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} className="plan-grid-minor" fill="none" />
        </pattern>
        <pattern id="plan-major-grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="url(#plan-minor-grid)" />
          <path d="M 1 0 L 0 0 0 1" className="plan-grid-major" fill="none" />
        </pattern>
      </defs>

      {/* 网格背景（覆盖可视区 + 留白） */}
      <rect
        x={vbX - 10} y={vbY - 10} width={vbW + 20} height={vbH + 20}
        className="plan-grid-bg"
        fill="url(#plan-major-grid)"
      />

      {/* 中心点标记（原点 = 3D 旋转中心，帮助对齐） */}
      <g className="plan-origin">
        <line x1={-0.5} y1={0} x2={0.5} y2={0} />
        <line x1={0} y1={-0.5} x2={0} y2={0.5} />
        <circle r={0.12} />
      </g>

      {/* 房间：多边形 + 名字 + 面积 */}
      {rooms.map(room => {
        const cx = room.points.reduce((s, p) => s + p[0], 0) / room.points.length
        const cy = room.points.reduce((s, p) => s + p[1], 0) / room.points.length
        const selRoom = isSel('room', room.id)
        return (
          <g key={room.id} onClick={e => clickEl(e, 'room', room)}>
            <polygon
              points={room.points.map(p => p.join(',')).join(' ')}
              className={`plan-room ${selRoom ? 'selected' : ''}`}
            />
            <text x={cx} y={cy - 0.06} className={`plan-room-name ${selRoom ? 'selected' : ''}`}>{room.name}</text>
            <text x={cx} y={cy + 0.22} className="plan-room-area">{polygonArea(room.points).toFixed(1)} m²</text>
          </g>
        )
      })}

      {/* 墙（持久化线段，删除模式可点） */}
      {walls.map((w, i) => (
        <line
          key={w.id || `w${i}`}
          x1={w.start[0]} y1={w.start[1]} x2={w.end[0]} y2={w.end[1]}
          className="plan-wall"
          strokeWidth={WALL_T}
          onClick={tool === 'delete' ? (e) => { e.stopPropagation(); onSelect({ type: 'wall', ref: w, index: i }) } : undefined}
        />
      ))}

      {/* 家具 */}
      {furniture.map(f => {
        const lib = FURNITURE_LIB.find(x => x.type === f.type)
        const w = (lib ? lib.w : 1) * (f.scale ? f.scale[0] : 1)
        const d = (lib ? lib.d : 0.6) * (f.scale ? f.scale[2] : 1)
        const selF = isSel('furniture', f.id)
        return (
          <g
            key={f.id}
            transform={`translate(${f.pos[0]} ${f.pos[2]}) rotate(${f.rot || 0})`}
            onClick={e => clickEl(e, 'furniture', f)}
            onPointerDown={e => startDrag(e, 'furniture', f)}
          >
            <rect
              x={-w / 2} y={-d / 2} width={w} height={d}
              className={`plan-furniture ${selF ? 'selected' : ''}`}
              stroke={selF ? '#2f7fe0' : (FURNITURE_COLORS[f.type] || '#9aa7b5')}
            />
            <text y="0.06" className="plan-furniture-label">{f.type}</text>
          </g>
        )
      })}

      {/* 设备 */}
      {devices.map(dev => {
        const selD = isSel('device', dev.id)
        const color = deviceColor(dev, haStates)
        return (
          <g
            key={dev.id}
            transform={`translate(${dev.pos[0]} ${dev.pos[2]})`}
            onClick={e => clickEl(e, 'device', dev)}
            onPointerDown={e => startDrag(e, 'device', dev)}
          >
            {selD && <circle r="0.34" className="plan-device-halo" />}
            <circle r="0.18" className="plan-device" fill={color} stroke={selD ? '#2f7fe0' : 'none'} />
            <text y="-0.26" className={`plan-device-label ${selD ? 'selected' : ''}`}>{dev.name || dev.entity_id}</text>
          </g>
        )
      })}

      {/* 画墙虚线预览（最后一个点 → 光标） */}
      {draft && draft.pts.length > 0 && cursor && tool === 'wall' && (
        <line
          x1={draft.pts[draft.pts.length - 1][0]} y1={draft.pts[draft.pts.length - 1][1]}
          x2={cursor[0]} y2={cursor[1]}
          className="plan-preview"
          strokeDasharray="0.3 0.28"
        />
      )}

      {/* 放置/画墙时的吸附点标记 */}
      {(tool === 'furniture' || tool === 'device' || tool === 'wall') && cursor && (
        <g transform={`translate(${cursor[0]} ${cursor[1]})`} className="plan-cursor">
          <circle r="0.14" />
        </g>
      )}
    </svg>
  )
}
