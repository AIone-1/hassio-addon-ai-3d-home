// 独立 SVG 2D 户型编辑器（对齐 JMGLink 原版：SVG + viewBox 缩放平移，与 3D WebGL 完全隔离，永远规整）
// 墙是线段（floor.walls 持久化），房间由墙段的封闭环自动检测（recomputeRooms）——这就是"共用墙/相交也封闭"的机制
import { useRef, useState, useEffect, useMemo } from 'react'
import { useStore, setState, getState, uid, toast } from '../store'
import { FURNITURE_LIB, FURNITURE_COLORS, FURNITURE_WALL_HEIGHT, FURNITURE_COLOR_PALETTE, DOOR_COLORS, DOOR_STYLES, WINDOW_STYLES, polygonArea, recomputeRooms, pointToSeg } from '../three/geometry'
import { getCatalogItem, thumbUrl } from '../catalog'

const GRID = 0.5       // 小网格 0.5m（大格 1m）
const CLOSE = 0.8      // 画墙闭合半径（点回起点 <0.8m 闭合，大一点更容易合上）

// 设备模型按设备类型分组（选择设备时按灯光/摄像机/安防等分类显示模型）
const DEVICE_MODEL_GROUPS = [
  { label: '灯光', types: ['吊灯', '吸顶灯', '台灯', '落地灯', '壁灯', '筒灯'] },
  { label: '摄像机', types: ['监控'] },
  { label: '安防', types: ['烟感器', '门铃'] },
]
// 内置程序化设备模型（无缩略图，用 emoji 图标）
const BUILTIN_DEVICES = [
  { type: '空调', icon: '❄️' },
  { type: '热水器', icon: '♨️' },
  { type: '窗帘', icon: '🪟' },
  { type: '传感器', icon: '📡' },
  { type: '灯带', icon: '✨' },
]
// 地板颜色（选中房间可改）
const FLOOR_COLORS = ['#7789ad', '#8a9bbd', '#a58b6f', '#8b8b8b', '#c9a675', '#7d8f7a', '#a08090', '#6b7f9e']
// 墙颜色（选中墙可改）
const WALL_COLORS = ['#d5e0f1', '#f5f7fa', '#e8e4dc', '#c9c9c9', '#d8e8f0', '#e0d8e8', '#d0e8d8', '#f0e0d0']
const WALL_T = 0.12    // 墙线宽
const MIN_ZOOM = 0.12
const MAX_ZOOM = 6

// 户型包围盒（只按已完成的房间+家具+设备取景；正在画的墙不纳入，否则视口会缩到第一段墙导致后续点超出屏幕）
function floorBounds(floor) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  ;(floor?.rooms || []).forEach(r => (r.points || []).forEach(p => add(p[0], p[1])))
  ;(floor?.furniture || []).forEach(f => add(f.pos[0], f.pos[2]))
  ;(floor?.devices || []).forEach(d => add(d.pos[0], d.pos[2]))
  if (!isFinite(minX)) { minX = -5; minY = -5; maxX = 5; maxY = 5 }
  // 四周留 5m 边距，保证画完一个房间后视口还有空间画相邻房间（否则视口缩到房间边缘，共用墙的第二个房间画不下）
  const pad = 5
  minX -= pad; maxX += pad; minY -= pad; maxY += pad
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
  const snapStep = useStore(s => s.snapStep)
  const showFurnitureLabels = useStore(s => s.showFurnitureLabels)
  const showDimensions = useStore(s => s.showDimensions)
  const wallH = useStore(s => s.wallH)
  const wallThick = useStore(s => s.wallThick)
  const wallColor = useStore(s => s.wallColor)
  const doorStyle = useStore(s => s.doorStyle)
  const doorColor = useStore(s => s.doorColor)
  const doorSwing = useStore(s => s.doorSwing)
  const windowStyle = useStore(s => s.windowStyle)
  const planImage = useStore(s => s.planImage)
  const planImageOpacity = useStore(s => s.planImageOpacity)
  const planImageScale = useStore(s => s.planImageScale)
  const selected = useStore(s => s.selected)
  const furnitureType = useStore(s => s.furnitureType)
  const pendingEntity = useStore(s => s.pendingEntity)
  const modelCatalog = useStore(s => s.modelCatalog)
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
  const openingDragRef = useRef(null)           // 拖动的门窗对象（沿墙移动）
  const wallDragRef = useRef(null)              // 拖动的墙端点 { wall, which: 'start'|'end' }
  const panRef = useRef(null)                   // { w:[x,y], p:[x,y] } 平移起点
  const planMoveRef = useRef(null)              // 移动户型的起点世界坐标

  // 房间由 recomputeRooms 返回新数组，引用变化会触发重算（画墙过程中视口保持稳定）
  const bounds = useMemo(() => floorBounds(floor), [floor?.rooms, floor?.furniture, floor?.devices])
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
    if (snapOn) { x = Math.round(x / snapStep) * snapStep; y = Math.round(y / snapStep) * snapStep }
    if (tool === 'wall' && draft && draft.pts.length) {
      // 起点吸附：靠近画墙起点时吸附，便于闭合（肉眼看不到闭合点，靠这个）
      const first = draft.pts[0]
      if (Math.hypot(x - first[0], y - first[1]) < CLOSE) { x = first[0]; y = first[1] }
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
      fl.walls.push({ id: uid(), start: [...last], end: [...first], height: getState().wallH, thickness: getState().wallThick, color: getState().wallColor })
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
    // 先吸附（含起点吸附），再用吸附后的点判断闭合/重复——否则起点吸附生效了但闭合判断没生效
    const [x, y] = snap(raw)
    const first = draft.pts[0]
    if (draft.pts.length >= 3 && Math.hypot(x - first[0], y - first[1]) < CLOSE) {
      closeDraft()
      return
    }
    const last = draft.pts[draft.pts.length - 1]
    if (Math.hypot(x - last[0], y - last[1]) < 0.01) return  // 点重复，忽略
    const w = { id: uid(), start: [...last], end: [x, y], height: getState().wallH, thickness: getState().wallThick, color: getState().wallColor }
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
      // 右键 = 取消：取消画墙草稿 + 取消删除/画墙工具 + 取消选中 + 退出标定
      if (draft) cancelDraft()
      if (tool === 'wall' || tool === 'delete') setState({ tool: 'select' })
      setState({ selected: null })
      if (getState().calibrating) setState({ calibrating: false, calibratePts: [] })
      return
    }
    // 标定模式：点底图选已知长度
    if (getState().calibrating) {
      const [x, y] = toWorld(e)
      const pts = getState().calibratePts
      if (pts.length === 0) {
        setState({ calibratePts: [[x, y]] })
        toast('标定起点已选，点底图选终点')
      } else if (pts.length === 1) {
        const dist = Math.hypot(x - pts[0][0], y - pts[0][1])
        const real = prompt('这段线代表的实际长度（米）：', '3')
        if (real && Number(real) > 0) {
          const realLen = Number(real)
          const scale = getState().planImageScale || 1
          setState({ planImageScale: scale * realLen / dist, calibrating: false, calibratePts: [] })
          toast(`已标定：${realLen} 米`)
        } else {
          setState({ calibrating: false, calibratePts: [] })
        }
      }
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
      const s = getState().furnitureScale || 1
      const lib = FURNITURE_LIB.find(f => f.type === furnitureType)
      const placement = (lib && lib.placement) || 'floor'
      const floorH = fl.height || 2.8
      // 按放置面决定初始高度：地面 0 / 墙面默认离地 / 屋顶贴天花板
      const h = placement === 'ceiling' ? floorH : placement === 'wall' ? FURNITURE_WALL_HEIGHT : 0
      fl.furniture.push({ id: uid(), type: furnitureType, pos: [x, h, y], rot: 0, scale: [s, s, s], placement })
      setState({ project: { ...getState().project }, saved: false })
      return
    }
    if (tool === 'door' || tool === 'window') {
      // 点墙放置门/窗：找最近的墙段，沿墙计算 offset
      const p = toWorld(e)
      let best = null, bd = 0.5
      for (const w of (floor?.walls || [])) {
        const r = pointToSeg(p, w.start, w.end)
        if (r.dist < bd) { bd = r.dist; best = { wall: w, t: r.t } }
      }
      if (best) {
        const fl = getState().project.floors[floorIndex]
        fl.openings = fl.openings || []
        const isDoor = tool === 'door'
        fl.openings.push({
          id: uid(), wallId: best.wall.id, offset: best.t,
          width: isDoor ? 0.9 : 1.2, type: isDoor ? 'door' : 'window',
          ...(isDoor
            ? { doorStyle: getState().doorStyle, color: getState().doorColor, swing: getState().doorSwing, hinge: 'start', height: 2.1 }
            : { windowStyle: getState().windowStyle, bottom: 0.9, height: 0.9 }),
        })
        setState({ project: { ...getState().project }, saved: false })
        toast(isDoor ? '已放置门' : '已放置窗')
      } else {
        toast('请点击墙体放置门窗')
      }
      return
    }
    if (tool === 'device') {
      if (!pendingEntity) return
      const [x, y] = snap(toWorld(e))
      const fl = getState().project.floors[floorIndex]
      fl.devices = fl.devices || []
      fl.devices.push({ id: uid(), name: pendingEntity.name || pendingEntity.entity_id, entity_id: pendingEntity.entity_id, modelId: pendingEntity.modelId, pos: [x, 1.4, y] })
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
    if (wallDragRef.current) {
      const [x, y] = snap(w)
      const { wall, which } = wallDragRef.current
      wall[which] = [x, y]
      const fl = getState().project.floors[floorIndex]
      fl.rooms = recomputeRooms(fl)
      setState({ project: { ...getState().project }, saved: false })
      return
    }
    if (openingDragRef.current) {
      // 门窗沿墙移动：找最近墙，更新 wallId + offset
      let best = null, bd = 0.6
      for (const wall of (floor?.walls || [])) {
        const r = pointToSeg(w, wall.start, wall.end)
        if (r.dist < bd) { bd = r.dist; best = { wall, t: r.t } }
      }
      if (best) {
        openingDragRef.current.wallId = best.wall.id
        openingDragRef.current.offset = best.t
        setState({ project: { ...getState().project }, saved: false })
      }
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
    openingDragRef.current = null
    wallDragRef.current = null
    planMoveRef.current = null
  }

  const startDrag = (e, type, obj) => {
    if (tool !== 'move') return
    e.stopPropagation()
    setState({ selected: { type, ref: obj } })
    dragRef.current = obj
    svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
  }
  // 双击 = 选中并切到移动工具（后续按住即可拖动）
  const doubleClickDrag = (e, type, obj) => {
    if (type !== 'furniture' && type !== 'device' && type !== 'opening') return
    e.stopPropagation()
    setState({ selected: { type, ref: obj }, tool: 'move' })
  }
  // 拖动墙端点拉伸墙段
  const startWallDrag = (e, wall, which) => {
    e.stopPropagation()
    wallDragRef.current = { wall, which }
    svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
  }
  const clickEl = (e, type, ref) => {
    if (tool !== 'select' && tool !== 'delete') return
    e.stopPropagation()
    onSelect({ type, ref })
  }

  const isSel = (type, id) => selected && selected.type === type && selected.ref && selected.ref.id === id

  // ---------- 家具属性编辑（旋转 / 放置面 / 高度 / 删除） ----------
  const selFurniture = selected && selected.type === 'furniture' ? selected.ref : null
  const selLib = selFurniture ? FURNITURE_LIB.find(x => x.type === selFurniture.type) : null
  const curW = selFurniture ? (selFurniture.width != null ? selFurniture.width : (selLib ? selLib.w : 1)) : 1
  const curD = selFurniture ? (selFurniture.depth != null ? selFurniture.depth : (selLib ? selLib.d : 0.6)) : 0.6
  const curH = selFurniture ? (selFurniture.height != null ? selFurniture.height : (selLib ? selLib.h : 0.6)) : 0.6

  const curFurniture = (f) => {
    const fl = getState().project.floors[floorIndex]
    return (fl.furniture || []).find(x => x.id === f.id) || f
  }
  const patchFurniture = (f, patch) => {
    Object.assign(curFurniture(f), patch)
    setState({ project: { ...getState().project }, saved: false })
  }
  const rotateFurniture = (f, deg) => {
    const cur = curFurniture(f)
    patchFurniture(cur, { rot: (((cur.rot || 0) + deg) % 360 + 360) % 360 })
  }
  const setFurniturePlacement = (f, placement) => {
    const floorH = getState().project.floors[floorIndex].height || 2.8
    const h = placement === 'floor' ? 0 : placement === 'wall' ? FURNITURE_WALL_HEIGHT : floorH
    patchFurniture(f, { placement, pos: [f.pos[0], h, f.pos[2]] })
  }
  const setFurnitureHeight = (f, h) => {
    patchFurniture(f, { pos: [f.pos[0], h, f.pos[2]] })
  }
  const deleteFurniture = (f) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    fl.furniture = (fl.furniture || []).filter(x => x.id !== f.id)
    setState({ project: { ...st.project }, saved: false, selected: null })
    toast('已删除家具')
  }
  const duplicateFurniture = (f) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    const copy = JSON.parse(JSON.stringify(f))
    copy.id = uid()
    copy.pos = [f.pos[0] + 0.3, f.pos[1], f.pos[2] + 0.3]
    fl.furniture = fl.furniture || []
    const idx = fl.furniture.findIndex(x => x.id === f.id)
    fl.furniture.splice(idx + 1, 0, copy)
    setState({ project: { ...st.project }, saved: false, selected: { type: 'furniture', ref: copy } })
    toast('已复制家具')
  }
  const setFurnitureScale = (f, pct) => {
    const s = Math.max(0.1, (pct || 100) / 100)
    patchFurniture(f, { scale: [s, s, s] })
  }

  // ---------- 门窗属性编辑（类型 / 颜色 / 内开外开 / 翻转 / 删除） ----------
  const selOpening = selected && selected.type === 'opening' ? selected.ref : null

  const patchOpening = (o, patch) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.openings || []).find(x => x.id === o.id)
    if (!target) return
    Object.assign(target, patch)
    setState({ project: { ...getState().project }, saved: false })
  }
  const deleteOpening = (o) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    fl.openings = (fl.openings || []).filter(x => x.id !== o.id)
    setState({ project: { ...st.project }, saved: false, selected: null })
    toast('已删除')
  }

  // ---------- 设备属性编辑（选模型 / 删除） ----------
  const selDevice = selected && selected.type === 'device' ? selected.ref : null
  const patchDevice = (d, patch) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.devices || []).find(x => x.id === d.id)
    if (!target) return
    Object.assign(target, patch)
    setState({ project: { ...getState().project }, saved: false })
  }
  const deleteDevice = (d) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    fl.devices = (fl.devices || []).filter(x => x.id !== d.id)
    setState({ project: { ...st.project }, saved: false, selected: null })
    toast('已删除设备')
  }
  // 房间属性（改名/颜色）
  const selRoom = selected && selected.type === 'room' ? selected.ref : null
  const patchRoom = (r, patch) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.rooms || []).find(x => x.id === r.id)
    if (!target) return
    Object.assign(target, patch)
    setState({ project: { ...getState().project }, saved: false })
  }
  // 墙属性（高度）
  const selWall = selected && selected.type === 'wall' ? selected.ref : null
  const patchWall = (w, patch) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.walls || []).find(x => x.id === w.id)
    if (!target) return
    Object.assign(target, patch)
    setState({ project: { ...getState().project }, saved: false })
  }
  // 下载模型按分类分组（设备选模型用）
  const groupedCatalog = useMemo(() => {
    const m = {}
    for (const it of modelCatalog) {
      if (!m[it.label]) m[it.label] = []
      m[it.label].push(it)
    }
    return Object.entries(m)
  }, [modelCatalog])

  const rooms = floor?.rooms || []
  const walls = floor?.walls || []
  const openings = floor?.openings || []
  const furniture = floor?.furniture || []
  const devices = floor?.devices || []

  return (
    <div className="plan-wrap">
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

      {/* 参考底图（照着画户型，半透明不可交互，可缩放） */}
      {planImage && (() => {
        const s = planImageScale || 1
        const imgW = vbW * s
        const imgH = vbH * s
        const imgX = vbX + (vbW - imgW) / 2
        const imgY = vbY + (vbH - imgH) / 2
        return (
          <image
            href={planImage}
            x={imgX} y={imgY} width={imgW} height={imgH}
            opacity={planImageOpacity}
            preserveAspectRatio="xMidYMid meet"
            style={{ pointerEvents: 'none' }}
          />
        )
      })()}

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

      {/* 墙（持久化线段：select 选中可拉伸端点，delete 删除） */}
      {walls.map((w, i) => {
        const selW = isSel('wall', w.id)
        const wlen = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
        const wmx = (w.start[0] + w.end[0]) / 2
        const wmy = (w.start[1] + w.end[1]) / 2
        return (
          <g key={w.id || `w${i}`}>
            <line
              x1={w.start[0]} y1={w.start[1]} x2={w.end[0]} y2={w.end[1]}
              className={`plan-wall ${selW ? 'selected' : ''}`}
              strokeWidth={WALL_T}
              onClick={(e) => {
                if (tool === 'delete') { e.stopPropagation(); onSelect({ type: 'wall', ref: w, index: i }) }
                else if (tool === 'select') { e.stopPropagation(); onSelect({ type: 'wall', ref: w }) }
              }}
            />
            {selW && tool === 'select' && (
              <>
                <circle cx={w.start[0]} cy={w.start[1]} r={0.16} className="plan-wall-handle" onPointerDown={(e) => startWallDrag(e, w, 'start')} />
                <circle cx={w.end[0]} cy={w.end[1]} r={0.16} className="plan-wall-handle" onPointerDown={(e) => startWallDrag(e, w, 'end')} />
              </>
            )}
            {showDimensions && wlen > 0.01 && (
              <text x={wmx} y={wmy} className="plan-dim">{wlen.toFixed(2)}m</text>
            )}
          </g>
        )
      })}

      {/* 门窗（对齐原版：墙洞白线 + 门扇 + 开启弧） */}
      {openings.map(op => {
        const w = walls.find(x => x.id === op.wallId)
        if (!w) return null
        const t = Math.max(0, Math.min(1, op.offset || 0.5))
        const px = w.start[0] + (w.end[0] - w.start[0]) * t
        const py = w.start[1] + (w.end[1] - w.start[1]) * t
        const ang = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]) * 180 / Math.PI
        const wd = op.width || 0.9
        const isDoor = op.type === 'door'
        const doorColor = DOOR_COLORS[op.color] || DOOR_COLORS['木色']
        const doorStyle = op.doorStyle || 'swing'
        const selO = isSel('opening', op.id)
        return (
          <g key={op.id} transform={`translate(${px} ${py}) rotate(${ang})`} className="plan-opening"
            onClick={e => clickEl(e, 'opening', op)}
            onDoubleClick={e => doubleClickDrag(e, 'opening', op)}
            onPointerDown={tool === 'move' ? (e) => { e.stopPropagation(); setState({ selected: { type: 'opening', ref: op } }); openingDragRef.current = op; svgRef.current && svgRef.current.setPointerCapture(e.pointerId) } : undefined}>
            <line x1={-wd / 2} y1={0} x2={wd / 2} y2={0} className="opening-track" />
            <line x1={-wd / 2} y1={0} x2={wd / 2} y2={0} className={`opening-line ${isDoor ? 'door' : 'window'} ${selO ? 'selected' : ''}`} />
            {isDoor && doorStyle === 'swing' && (
              <>
                <line x1={-wd / 2} y1={0} x2={wd / 2} y2={-wd} className="door-leaf" stroke={doorColor} />
                <path d={`M ${-wd / 2} 0 A ${wd} ${wd} 0 0 1 ${wd / 2} ${-wd}`} className="door-swing" />
              </>
            )}
            {isDoor && doorStyle === 'double' && (
              <>
                <line x1={-wd / 2} y1={0} x2={0} y2={-wd / 2} className="door-leaf" stroke={doorColor} />
                <line x1={wd / 2} y1={0} x2={0} y2={-wd / 2} className="door-leaf" stroke={doorColor} />
                <path d={`M ${-wd / 2} 0 A ${wd / 2} ${wd / 2} 0 0 1 0 ${-wd / 2}`} className="door-swing" />
                <path d={`M ${wd / 2} 0 A ${wd / 2} ${wd / 2} 0 0 0 0 ${-wd / 2}`} className="door-swing" />
              </>
            )}
            {isDoor && doorStyle === 'slide' && (
              <>
                <line x1={-wd / 2} y1={-0.06} x2={wd / 2} y2={-0.06} className="door-leaf" stroke={doorColor} />
                <line x1={-wd / 2} y1={0.06} x2={wd / 2} y2={0.06} className="door-leaf" stroke={doorColor} />
              </>
            )}
          </g>
        )
      })}

      {/* 家具 */}
      {furniture.map(f => {
        const lib = FURNITURE_LIB.find(x => x.type === f.type)
        const cat = getCatalogItem(f.type)
        const w = (f.width != null ? f.width : (lib ? lib.w : cat ? cat.w : 1)) * (f.scale ? f.scale[0] : 1)
        const d = (f.depth != null ? f.depth : (lib ? lib.d : cat ? cat.d : 0.6)) * (f.scale ? f.scale[2] : 1)
        const label = f.name || (lib ? f.type : (cat ? cat.label : f.type))
        const selF = isSel('furniture', f.id)
        const placement = f.placement || (lib && lib.placement) || 'floor'
        return (
          <g
            key={f.id}
            transform={`translate(${f.pos[0]} ${f.pos[2]}) rotate(${f.rot || 0})`}
            onClick={e => clickEl(e, 'furniture', f)}
            onDoubleClick={e => doubleClickDrag(e, 'furniture', f)}
            onPointerDown={e => startDrag(e, 'furniture', f)}
          >
            <rect
              x={-w / 2} y={-d / 2} width={w} height={d}
              className={`plan-furniture ${placement !== 'floor' ? 'plan-furniture-' + placement : ''} ${selF ? 'selected' : ''}`}
              stroke={selF ? '#2f7fe0' : (f.color || FURNITURE_COLORS[lib ? f.type : (cat ? cat.label : f.type)] || '#9aa7b5')}
            />
            {showFurnitureLabels && <text y="0.06" className="plan-furniture-label">{label}</text>}
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
            onDoubleClick={e => doubleClickDrag(e, 'device', dev)}
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

      {/* 画墙起点标记（绿色圆点，鼠标靠近时放大提示可闭合） */}
      {draft && draft.pts.length > 0 && tool === 'wall' && (() => {
        const near = cursor && Math.hypot(cursor[0] - draft.pts[0][0], cursor[1] - draft.pts[0][1]) < CLOSE
        return (
          <g transform={`translate(${draft.pts[0][0]} ${draft.pts[0][1]})`} className={`plan-start-marker ${near ? 'near' : ''}`}>
            <circle r={near ? 0.32 : 0.18} />
          </g>
        )
      })()}

      {/* 放置/画墙时的吸附点标记 */}
      {(tool === 'furniture' || tool === 'device' || tool === 'wall') && cursor && (
        <g transform={`translate(${cursor[0]} ${cursor[1]})`} className="plan-cursor">
          <circle r="0.14" />
        </g>
      )}
    </svg>
    {/* 工具设置面板（点击左侧工具时右侧显示，改默认参数） */}
    {tool === 'wall' && !selected && (
      <div className="plan-props">
        <div className="plan-props-head"><span>墙体设置</span></div>
        <div className="plan-props-row">
          <span className="plan-props-label">高度</span>
          <input type="number" step="0.1" min="1" max="6" value={wallH} onChange={(e) => setState({ wallH: Number(e.target.value) || 2.8 })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">厚度</span>
          <input type="number" step="0.02" min="0.05" max="0.5" value={wallThick} onChange={(e) => setState({ wallThick: Number(e.target.value) || 0.12 })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">颜色</span>
          {WALL_COLORS.map((c) => (
            <button key={c} title={c} className={`plan-props-swatch ${wallColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setState({ wallColor: c })} />
          ))}
        </div>
      </div>
    )}
    {tool === 'door' && !selected && (
      <div className="plan-props">
        <div className="plan-props-head"><span>门设置</span></div>
        <div className="plan-props-row">
          <span className="plan-props-label">类型</span>
          {DOOR_STYLES.map(s => (
            <button key={s.key} className={`plan-props-seg ${doorStyle === s.key ? 'active' : ''}`} onClick={() => setState({ doorStyle: s.key })}>{s.label}</button>
          ))}
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">颜色</span>
          {Object.entries(DOOR_COLORS).map(([name, hex]) => (
            <button key={name} title={name} className={`plan-props-swatch ${doorColor === name ? 'active' : ''}`} style={{ background: hex }} onClick={() => setState({ doorColor: name })} />
          ))}
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">开向</span>
          <button className={`plan-props-seg ${doorSwing === 'inward' ? 'active' : ''}`} onClick={() => setState({ doorSwing: 'inward' })}>内开</button>
          <button className={`plan-props-seg ${doorSwing === 'outward' ? 'active' : ''}`} onClick={() => setState({ doorSwing: 'outward' })}>外开</button>
        </div>
      </div>
    )}
    {tool === 'window' && !selected && (
      <div className="plan-props">
        <div className="plan-props-head"><span>窗设置</span></div>
        <div className="plan-props-row">
          <span className="plan-props-label">类型</span>
          {WINDOW_STYLES.map(s => (
            <button key={s.key} className={`plan-props-seg ${windowStyle === s.key ? 'active' : ''}`} onClick={() => setState({ windowStyle: s.key })}>{s.label}</button>
          ))}
        </div>
      </div>
    )}
    {selFurniture && (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>{selFurniture.name || selFurniture.type}</span>
          <button className="plan-props-del" onClick={() => deleteFurniture(selFurniture)}>删除</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">名字</span>
          <input type="text" value={selFurniture.name || ''} placeholder={selFurniture.type}
            onChange={(e) => patchFurniture(selFurniture, { name: e.target.value })} />
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">大小</span>
          <input type="number" step="0.1" min="0.1" value={Math.round(curW * 100) / 100} title="宽"
            onChange={(e) => patchFurniture(selFurniture, { width: Number(e.target.value) || undefined })} />
          <input type="number" step="0.1" min="0.1" value={Math.round(curD * 100) / 100} title="深"
            onChange={(e) => patchFurniture(selFurniture, { depth: Number(e.target.value) || undefined })} />
          <input type="number" step="0.1" min="0.1" value={Math.round(curH * 100) / 100} title="高"
            onChange={(e) => patchFurniture(selFurniture, { height: Number(e.target.value) || undefined })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">缩放</span>
          <input type="number" step="5" min="10" value={Math.round((selFurniture.scale ? selFurniture.scale[0] : 1) * 100)}
            onChange={(e) => setFurnitureScale(selFurniture, Number(e.target.value) || 100)} />
          <span className="plan-props-unit">%</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">旋转</span>
          <button onClick={() => rotateFurniture(selFurniture, -90)} title="逆时针 90°">⟲</button>
          <input type="number" step="5" value={Math.round(selFurniture.rot || 0)}
            onChange={(e) => patchFurniture(selFurniture, { rot: (Number(e.target.value) % 360 + 360) % 360 })} />
          <span className="plan-props-unit">°</span>
          <button onClick={() => rotateFurniture(selFurniture, 90)} title="顺时针 90°">⟳</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">放置</span>
          {[['floor', '地面'], ['wall', '墙面'], ['ceiling', '屋顶']].map(([p, label]) => (
            <button key={p} className={`plan-props-seg ${(selFurniture.placement || 'floor') === p ? 'active' : ''}`}
              onClick={() => setFurniturePlacement(selFurniture, p)}>{label}</button>
          ))}
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">颜色</span>
          <button title="默认" className={`plan-props-swatch ${!selFurniture.color ? 'active' : ''}`} style={{ background: '#8f9fbb' }}
            onClick={() => patchFurniture(selFurniture, { color: '' })} />
          {Object.entries(FURNITURE_COLOR_PALETTE).map(([name, hex]) => (
            <button key={name} title={name} className={`plan-props-swatch ${selFurniture.color === name ? 'active' : ''}`} style={{ background: hex }}
              onClick={() => patchFurniture(selFurniture, { color: name })} />
          ))}
        </div>
        {(selFurniture.placement || 'floor') !== 'floor' && (
          <div className="plan-props-row">
            <span className="plan-props-label">高度</span>
            <input type="number" step="0.1" min="0" max="6" value={Math.round((selFurniture.pos[1] || 0) * 10) / 10}
              onChange={(e) => setFurnitureHeight(selFurniture, Number(e.target.value) || 0)} />
            <span className="plan-props-unit">m</span>
          </div>
        )}
        <div className="plan-props-row">
          <button className="plan-props-seg" onClick={() => duplicateFurniture(selFurniture)}>⧉ 复制</button>
        </div>
      </div>
    )}
    {selOpening && (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>{selOpening.type === 'door' ? '门' : '窗'}</span>
          <button className="plan-props-del" onClick={() => deleteOpening(selOpening)}>删除</button>
        </div>
        {selOpening.type === 'door' ? (
          <>
            <div className="plan-props-row">
              <span className="plan-props-label">类型</span>
              {DOOR_STYLES.map(s => (
                <button key={s.key} className={`plan-props-seg ${(selOpening.doorStyle || 'swing') === s.key ? 'active' : ''}`}
                  onClick={() => patchOpening(selOpening, { doorStyle: s.key })}>{s.label}</button>
              ))}
            </div>
            <div className="plan-props-row">
              <span className="plan-props-label">颜色</span>
              {Object.entries(DOOR_COLORS).map(([name, hex]) => (
                <button key={name} title={name} className={`plan-props-swatch ${(selOpening.color || '木色') === name ? 'active' : ''}`}
                  style={{ background: hex }}
                  onClick={() => patchOpening(selOpening, { color: name })} />
              ))}
            </div>
            {(selOpening.doorStyle || 'swing') !== 'frame' && (selOpening.doorStyle || 'swing') !== 'slide' && (
              <div className="plan-props-row">
                <span className="plan-props-label">开向</span>
                <button className={`plan-props-seg ${(selOpening.swing || 'inward') === 'inward' ? 'active' : ''}`}
                  onClick={() => patchOpening(selOpening, { swing: 'inward' })}>内开</button>
                <button className={`plan-props-seg ${(selOpening.swing || 'inward') === 'outward' ? 'active' : ''}`}
                  onClick={() => patchOpening(selOpening, { swing: 'outward' })}>外开</button>
                <button onClick={() => patchOpening(selOpening, { hinge: (selOpening.hinge || 'start') === 'start' ? 'end' : 'start' })}>翻转门扇</button>
              </div>
            )}
          </>
        ) : (
          <div className="plan-props-row">
            <span className="plan-props-label">类型</span>
            {WINDOW_STYLES.map(s => (
              <button key={s.key} className={`plan-props-seg ${(selOpening.windowStyle || 'standard') === s.key ? 'active' : ''}`}
                onClick={() => {
                  const floorH = getState().project.floors[floorIndex].height || 2.8
                  if (s.key === 'floor_to_ceiling') patchOpening(selOpening, { windowStyle: s.key, bottom: 0, height: floorH })
                  else if (s.key === 'standard') patchOpening(selOpening, { windowStyle: s.key, bottom: 0.9, height: 0.9 })
                  else patchOpening(selOpening, { windowStyle: s.key })
                }}>{s.label}</button>
            ))}
          </div>
        )}
      </div>
    )}
    {selDevice && (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>{selDevice.name || selDevice.entity_id}</span>
          <button className="plan-props-del" onClick={() => deleteDevice(selDevice)}>删除</button>
        </div>
        <div className="plan-props-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span className="plan-props-label">模型（点缩略图选）</span>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button onClick={() => patchDevice(selDevice, { modelId: undefined })}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: !selDevice.modelId ? 'var(--accent)' : 'var(--panel2)', color: !selDevice.modelId ? '#081018' : 'var(--text)', cursor: 'pointer', fontSize: 12, alignSelf: 'flex-start' }}>无（圆球）</button>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 3px' }}>家电/设备</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {BUILTIN_DEVICES.map((b) => (
                  <button key={b.type} title={b.type} onClick={() => patchDevice(selDevice, { modelId: b.type })}
                    style={{ padding: 5, borderRadius: 6, border: selDevice.modelId === b.type ? '2px solid var(--accent)' : '1px solid var(--border)', background: 'var(--panel2)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
                    {b.icon}
                  </button>
                ))}
              </div>
            </div>
            {DEVICE_MODEL_GROUPS.map((g) => {
              const items = groupedCatalog.filter(([label]) => g.types.includes(label)).flatMap(([, its]) => its)
              if (items.length === 0) return null
              return (
                <div key={g.label}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 3px' }}>{g.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {items.map((m) => (
                      <button key={m.type} title={m.label} onClick={() => patchDevice(selDevice, { modelId: m.type })}
                        style={{ padding: 3, borderRadius: 6, border: selDevice.modelId === m.type ? '2px solid var(--accent)' : '1px solid var(--border)', background: 'var(--panel2)', cursor: 'pointer' }}>
                        <img src={thumbUrl(m.thumb)} alt={m.label} style={{ width: 36, height: 36, objectFit: 'contain', display: 'block', borderRadius: 4 }} />
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">实体</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selDevice.entity_id}</span>
        </div>
      </div>
    )}
    {selRoom && (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>房间</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">名字</span>
          <input type="text" value={selRoom.name || ''}
            onChange={(e) => patchRoom(selRoom, { name: e.target.value })} />
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">面积</span>
          <span style={{ fontSize: 12, color: 'var(--text)' }}>{polygonArea(selRoom.points || []).toFixed(1)} ㎡</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">颜色</span>
          {FLOOR_COLORS.map((c) => (
            <button key={c} title={c} onClick={() => patchRoom(selRoom, { color: c })}
              className={`plan-props-swatch ${selRoom.color === c ? 'active' : ''}`}
              style={{ background: c }} />
          ))}
        </div>
      </div>
    )}
    {selWall && (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>墙</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">高度</span>
          <input type="number" step="0.1" min="1" max="6" value={selWall.height || floor?.height || 2.8}
            onChange={(e) => patchWall(selWall, { height: Number(e.target.value) || 2.8 })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">厚度</span>
          <input type="number" step="0.02" min="0.05" max="0.5" value={selWall.thickness || 0.12}
            onChange={(e) => patchWall(selWall, { thickness: Number(e.target.value) || 0.12 })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">颜色</span>
          {WALL_COLORS.map((c) => (
            <button key={c} title={c} onClick={() => patchWall(selWall, { color: c })}
              className={`plan-props-swatch ${(selWall.color || '#d5e0f1') === c ? 'active' : ''}`}
              style={{ background: c }} />
          ))}
        </div>
      </div>
    )}
    </div>
  )
}
