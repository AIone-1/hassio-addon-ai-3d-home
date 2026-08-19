// 独立 SVG 2D 户型编辑器（对齐 JMGLink 原版：SVG + viewBox 缩放平移，与 3D WebGL 完全隔离，永远规整）
// 墙是线段（floor.walls 持久化），房间由墙段的封闭环自动检测（recomputeRooms）——这就是"共用墙/相交也封闭"的机制
import { useRef, useState, useEffect, useMemo } from 'react'
import { useStore, setState, getState, uid, toast } from '../store'
import { FURNITURE_LIB, FURNITURE_COLORS, FURNITURE_WALL_HEIGHT, FURNITURE_COLOR_PALETTE, DOOR_COLORS, DOOR_STYLES, WINDOW_STYLES, polygonArea, recomputeRooms, pointToSeg, pointOnSeg, segmentIntersect, SNAP_TOL, autoTrimWalls, pointInPolygon, wallOnEdge, mergeCollinearWalls, snapWallEndpoints, straightenWalls, DEVICE_MODELS, DEVICE_KINDS } from '../three/geometry'
import { getCatalogItem, thumbUrl } from '../catalog'
import HexColorPicker from './HexColorPicker'
import NumInput from './NumInput'
import EntityPicker from './EntityPicker'
import MoveControls from './MoveControls'
import { api, BASE } from '../api'

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
  { type: '开关', icon: '🔘' },
  { type: '感应器', icon: '👁️' },
  { type: '风扇', icon: '🌀' },
  { type: '灯带', icon: '✨' },
]
// 地板颜色（选中房间可改）
const FLOOR_COLORS = ['#7789ad', '#8a9bbd', '#a58b6f', '#8b8b8b', '#c9a675', '#7d8f7a', '#a08090', '#6b7f9e']
// 墙颜色（选中墙可改）
const WALL_COLORS = ['#ffffff', '#d5e0f1', '#f5f7fa', '#e8e4dc', '#c9c9c9', '#d8e8f0', '#e0d8e8', '#d0e8d8', '#f0e0d0']

// 描述两墙的几何状态与关系（墙1方向 · 墙2方向 · 关系）
function wallRelText(ids, walls) {
  const a = walls.find(w => w.id === ids[0])
  const b = walls.find(w => w.id === ids[1])
  if (!a || !b) return ''
  const dir = (w) => {
    const dx = w.end[0] - w.start[0], dy = w.end[1] - w.start[1]
    return Math.abs(dy) < 0.01 ? '水平' : Math.abs(dx) < 0.01 ? '竖直' : '斜线'
  }
  const dax = a.end[0] - a.start[0], day = a.end[1] - a.start[1]
  const dbx = b.end[0] - b.start[0], dby = b.end[1] - b.start[1]
  const dot = dax * dbx + day * dby
  const cross = dax * dby - day * dbx
  let rel = '斜交'
  if (Math.abs(dot) < 0.01) rel = '垂直'
  else if (Math.abs(cross) < 0.01) rel = '共线/平行'
  return `墙1:${dir(a)} · 墙2:${dir(b)} · 关系:${rel}`
}
const WALL_T = 0.12    // 墙线宽
const MIN_ZOOM = 0.12
const MAX_ZOOM = 6

// 户型包围盒（按房间+家具+设备+墙取景；正在画的墙不纳入，否则视口会缩到第一段墙导致后续点超出屏幕）
function floorBounds(floor, walls) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  ;(floor?.rooms || []).forEach(r => (r.points || []).forEach(p => add(p[0], p[1])))
  ;(floor?.furniture || []).forEach(f => add(f.pos[0], f.pos[2]))
  ;(floor?.devices || []).forEach(d => add(d.pos[0], d.pos[2]))
  ;(walls || []).forEach(w => { add(w.start[0], w.start[1]); add(w.end[0], w.end[1]) })
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
  const showIntersections = useStore(s => s.showIntersections)
  const wallH = useStore(s => s.wallH)
  const wallThick = useStore(s => s.wallThick)
  const wallColor = useStore(s => s.wallColor)
  const wallOpacity = useStore(s => s.wallOpacity)
  const doorStyle = useStore(s => s.doorStyle)
  const doorColor = useStore(s => s.doorColor)
  const doorSwing = useStore(s => s.doorSwing)
  const windowStyle = useStore(s => s.windowStyle)
  const planImage = useStore(s => s.planImage)
  const planImageOpacity = useStore(s => s.planImageOpacity)
  const planImageScale = useStore(s => s.planImageScale)
  const selected = useStore(s => s.selected)
  const wallSelIds = useStore(s => s.wallSel)
  const roomSelIds = useStore(s => s.roomSel)
  const wallIssues = useStore(s => s.wallIssues)
  const multiSelect = useStore(s => s.multiSelect)
  const furnitureType = useStore(s => s.furnitureType)
  const pendingEntity = useStore(s => s.pendingEntity)
  const modelCatalog = useStore(s => s.modelCatalog)
  const haStates = useStore(s => s.haStates)
  const recenterKey = useStore(s => s.planRecenterKey)
  const zoomDelta = useStore(s => s.planZoomDelta)
  const roomEditId = useStore(s => s.roomEditId)   // 点房间「编辑」进 2D 后要聚焦的房间 id（null=显示整个户型）

  const svgRef = useRef(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState([0, 0])
  const [draft, setDraft] = useState(null)     // { pts: [[x,y],...], walls: [墙对象] } 画墙草稿
  const [frozenRooms, setFrozenRooms] = useState(null)  // 画墙前冻结的 rooms 快照（画墙期间取景不随新房间变）
  const [frozenWalls, setFrozenWalls] = useState(null)  // 画墙前冻结的 walls 快照
  const [cursor, setCursor] = useState(null)    // [x,y] 世界坐标（已吸附）
  const [cursorWall, setCursorWall] = useState(null)  // 光标吸附到已有墙时的墙点（蓝色提示）
  const [cutPoint, setCutPoint] = useState(null)      // 裁剪时的交点提示（橙色）
  const [bgList, setBgList] = useState([])            // 已上传背景图（地板壁纸缩略图用）
  const [deviceBindOpen, setDeviceBindOpen] = useState(false)  // 设备属性面板里的绑定设备选择器
  const dragRef = useRef(null)                  // 拖动的家具/设备对象
  const openingDragRef = useRef(null)           // 拖动的门窗对象（沿墙移动）
  const openingResizeRef = useRef(null)         // 拖动调整宽度的门窗 { op, center:[x,y], dir:[x,y] }
  const wallDragRef = useRef(null)              // 拖动的墙端点（旋转，绕另一端保持长度） { wall, which: 'start'|'end' }
  const wallMoveRef = useRef(null)              // 拖动的整面墙（整体平移） { wall, last: [x,y] }
  const panRef = useRef(null)                   // { w:[x,y], p:[x,y] } 平移起点
  const planMoveRef = useRef(null)              // 移动户型的起点世界坐标
  const rightClickRef = useRef(0)               // 最近一次右键时间戳，用于区分单击取消 / 双击切移动

  useEffect(() => { api.backgrounds().then((r) => setBgList(r.images || [])).catch(() => {}) }, [])

  // 单房间聚焦：点房间「编辑」进 2D 后只显示这个房间的平面图（roomEditId 非空），不是整个户型
  const editingRoom = roomEditId ? (floor?.rooms || []).find(r => r.id === roomEditId) : null
  // 墙是否属于这个房间的边界：两个端点都落在房间边界上即可。
  // 注意房间的一条边可能由多面墙拼接（如右边墙 = 上下两段），不能要求「单面墙完整覆盖整条边」，
  // 否则拼接墙会被误判成「不属于房间」，导致 2D 里缺墙、全选墙选不中。
  const wallCoversRoomEdge = (w) => {
    if (!editingRoom) return true
    const pts = editingRoom.points || []
    // 墙属于房间边界：和房间某条边共线且有交叠（覆盖单面墙/拼接墙/共用墙三种情况）
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      if (wallOnEdge(w, a, b)) return true
    }
    return false
  }
  // 家具/设备位置是否在聚焦房间内
  const posInEditingRoom = (x, z) => !editingRoom || pointInPolygon([x, z], editingRoom.points || [])

  // 取景范围：画墙前冻结 rooms/walls 快照，画墙期间（含画完闭合）取景完全不变、视口不跳；
  // 只有「居中」或「切出画墙工具」才解冻，重新按当前户型取景
  const bounds = useMemo(() => {
    if (editingRoom && editingRoom.points) {
      // 单房间聚焦：只按这个房间的包围盒取景（房间居中、紧凑放大，不铺满整个户型）
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      editingRoom.points.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]) })
      const pad = 1.5
      return { minX: minX - pad, minY: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 }
    }
    const rooms = frozenRooms !== null ? frozenRooms : floor?.rooms
    const walls = frozenWalls !== null ? frozenWalls : (floor?.walls || [])
    return floorBounds({ ...floor, rooms }, walls)
  }, [floor, frozenRooms, frozenWalls, editingRoom])
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

  // 吸附到已有墙（含中点，不只端点），排除本次草稿已画的墙（避免光标吸回刚画的墙）
  const wallSnapPoint = (pt) => {
    const exclude = new Set((draft?.walls || []).map((w) => w.id))
    // 优先吸附端点：光标靠近墙端点（<0.15m）直接吸到端点——保证相邻墙共享角点精确重合，不留错位缝隙
    let bestEp = null, bestEpD = 0.15
    for (const w of (floor?.walls || [])) {
      if (exclude.has(w.id)) continue
      for (const ep of [w.start, w.end]) {
        const d = Math.hypot(pt[0] - ep[0], pt[1] - ep[1])
        if (d < bestEpD) { bestEpD = d; bestEp = ep }
      }
    }
    if (bestEp) return [...bestEp]
    // 否则墙段吸附（含中点，用于共用墙/分割墙精准连接）
    let best = null, bd = 0.3
    for (const w of (floor?.walls || [])) {
      if (exclude.has(w.id)) continue
      const r = pointToSeg(pt, w.start, w.end)
      if (r.dist < bd) {
        bd = r.dist
        best = [w.start[0] + (w.end[0] - w.start[0]) * r.t, w.start[1] + (w.end[1] - w.start[1]) * r.t]
      }
    }
    return best
  }

  // 网格吸附 + 画墙轴向吸附（水平/垂直，让房间规整）+ 墙吸附（含中点，便于共用墙/分割墙精准连接）
  const snap = (pt) => {
    let [x, y] = pt
    if (tool === 'wall' && draft && draft.pts.length) {
      // 起点吸附优先：靠近画墙起点时吸附（闭合），优先于墙吸附
      const first = draft.pts[0]
      if (Math.hypot(x - first[0], y - first[1]) < CLOSE) return [first[0], first[1]]
    }
    if (tool === 'wall') {
      // 墙吸附优先于网格吸附，否则网格吸附会把点从墙上挪开导致分割墙/共用墙连不上
      const wp = wallSnapPoint(pt)
      if (wp) return wp
    }
    if (snapOn) { x = Math.round(x / snapStep) * snapStep; y = Math.round(y / snapStep) * snapStep }
    if (tool === 'wall' && draft && draft.pts.length) {
      // 轴向吸附：靠近水平/垂直方向时对齐到上一个点，让房间规整
      const last = draft.pts[draft.pts.length - 1]
      const dx = x - last[0], dy = y - last[1]
      if (Math.abs(dx) > 0.01 && Math.abs(dy / dx) < 0.0875) y = last[1]
      else if (Math.abs(dy) > 0.01 && Math.abs(dx / dy) < 0.0875) x = last[0]
    }
    return [x, y]
  }

  // 轴向吸附：把 pt 吸附到相对 anchor 的水平/垂直方向（拖动墙端点时用，水平/竖直有停顿感）
  const snapAxis = (pt, anchor) => {
    const dx = pt[0] - anchor[0], dy = pt[1] - anchor[1]
    if (Math.abs(dx) > 0.01 && Math.abs(dy / dx) < 0.0875) return [pt[0], anchor[1]]
    if (Math.abs(dy) > 0.01 && Math.abs(dx / dy) < 0.0875) return [anchor[0], pt[1]]
    return pt
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
      const cw = { id: uid(), start: [...last], end: [...first], height: getState().wallH, thickness: getState().wallThick, color: getState().wallColor, ...(getState().wallOpacity !== 100 ? { opacity: getState().wallOpacity } : {}) }
      fl.walls.push(cw)
    }
    fl.walls = straightenWalls(fl.walls)   // 拉直斜墙（消除方向误差）
    fl.walls = snapWallEndpoints(fl.walls)   // 吸附错位端点（相邻墙共享角点精确重合）
    fl.walls = mergeCollinearWalls(fl.walls)   // 合并共线相连的墙（从源头杜绝拼接墙）
    fl.walls = straightenWalls(fl.walls)   // 再拉直一次（合并两条独立墙后消除残留斜）
    fl.walls = autoTrimWalls(fl.walls)   // 自动修剪伸出墙，避免悬空墙干扰房间
    fl.rooms = recomputeRooms(fl)
    setDraft(null)
    setState({ project: { ...getState().project }, saved: false, __noUndo: true })
    toast(fl.rooms.length ? `已识别 ${fl.rooms.length} 个房间` : '墙体尚未形成封闭房间')
  }

  const addWallPoint = (raw) => {
    const fl = getState().project.floors[floorIndex]
    fl.walls = fl.walls || []
    if (!draft || !draft.pts.length) {
      // 只在「未冻结」时冻结一次：连续画多个房间时保持第一次的冻结快照，
      // 否则每画一个新房间的第一面墙，快照又被更新成「含上一个房间」，取景突变、视口跳
      if (frozenRooms === null) {
        setFrozenRooms(floor.rooms)
        setFrozenWalls(floor.walls)
      }
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
    const isFirst = draft.walls.length === 0  // 第一段墙才占一步撤销，后续段归到同一步
    const w = { id: uid(), start: [...last], end: [x, y], height: getState().wallH, thickness: getState().wallThick, color: getState().wallColor, ...(getState().wallOpacity !== 100 ? { opacity: getState().wallOpacity } : {}) }
    fl.walls.push(w)
    // 每加一面墙就增量识别一次：墙一闭合（含和已有墙重合/共用墙）就立刻出房间，不用非得点回起点或按 Enter
    const prevCount = (fl.rooms || []).length
    fl.rooms = recomputeRooms(fl)
    if (fl.rooms.length > prevCount) {
      // 已靠已有墙闭合出新房间 → 自动结束本次画墙（不加闭合墙，避免和共用墙重复）
      fl.walls = straightenWalls(fl.walls)   // 拉直斜墙
      fl.walls = snapWallEndpoints(fl.walls)   // 吸附错位端点
      fl.walls = mergeCollinearWalls(fl.walls)   // 合并共线相连的墙（从源头杜绝拼接墙）
      fl.walls = straightenWalls(fl.walls)   // 再拉直一次（消除合并残留斜）
      fl.walls = autoTrimWalls(fl.walls)   // 自动修剪伸出墙
      fl.rooms = recomputeRooms(fl)
      setDraft(null)
      toast(fl.rooms.length ? `已识别 ${fl.rooms.length} 个房间` : '墙体尚未形成封闭房间')
    } else {
      setDraft({ pts: [...draft.pts, [x, y]], walls: [...draft.walls, w] })
    }
    setState({ project: { ...getState().project }, saved: false, ...(isFirst ? {} : { __noUndo: true }) })
  }

  const cancelDraft = () => {
    if (!draft) return
    const fl = getState().project.floors[floorIndex]
    // 右键取消：结束画墙，但保留已画的墙（哪怕没封闭成房间也不删）
    fl.rooms = recomputeRooms(fl)
    setDraft(null)
    setState({ project: { ...getState().project }, saved: false, __noUndo: true })
    toast('已取消画墙（保留已画的墙）')
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

  useEffect(() => { setZoom(1); setPan([0, 0]); setDraft(null); setFrozenRooms(null); setFrozenWalls(null); dragRef.current = null }, [recenterKey])
  // 切换楼层时解冻取景（冻结的是旧楼层的 rooms/walls，换楼层必须重新取景）。
  // 注意：切工具不解冻——用户要求「不点居中就不自动居中」，切工具也要保持视口不动
  useEffect(() => { setFrozenRooms(null); setFrozenWalls(null) }, [floorIndex])

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
      // 双击右键 = 切移动工具；单击右键 = 取消（取消选中 / 取消移动 / 取消墙体/门窗/家具/设备的放置 / 取消删除 / 取消画墙草稿 / 退出标定）
      const now = Date.now()
      const isDouble = now - rightClickRef.current < 300
      rightClickRef.current = isDouble ? 0 : now
      if (draft) cancelDraft()
      if (getState().calibrating) setState({ calibrating: false, calibratePts: [] })
      setState({ tool: isDouble ? 'move' : 'select', selected: null, wallSel: [] })
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
    if (e.button === 1 || tool === 'pan' || tool === 'browse') {
      e.preventDefault()
      panRef.current = { w: toWorld(e), p: [pan[0], pan[1]] }
      svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return

    if (tool === 'wall') { addWallPoint(toWorld(e)); return }
    if (tool === 'cut') {
      // 裁剪：找离点击最近的墙，在与其它墙的交点处切成两段
      const t = findCutTarget(toWorld(e))
      if (t) cutWall(t.wall, t.point)
      else toast('请点击要裁剪的墙（和其它墙相交处）')
      return
    }
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
      const devModel = DEVICE_MODELS.find(m => m.id === furnitureType)
      const placement = (lib && lib.placement) || (devModel && devModel.placement) || 'floor'
      const floorH = fl.height || 2.8
      // 按放置面决定初始高度：地面 0 / 墙面默认离地（设备用其 defaultHeight）/ 屋顶贴天花板
      const wallH = devModel ? (devModel.defaultHeight || FURNITURE_WALL_HEIGHT) : FURNITURE_WALL_HEIGHT
      const h = placement === 'ceiling' ? floorH : placement === 'wall' ? wallH : 0
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
    if (tool === 'select' || tool === 'move') setState({ selected: null, wallSel: [], roomSel: [] })
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
    if (wallMoveRef.current) {
      // 移动整面墙：整体平移，保持长度和方向（用初始墙位置 + 鼠标位移，避免累积误差）
      const { wall, startPos, startMouse } = wallMoveRef.current
      const [x, y] = snap(w)
      const dx = x - startMouse[0], dy = y - startMouse[1]
      wall.start = [startPos[0] + dx, startPos[1] + dy]
      wall.end = [startPos[2] + dx, startPos[3] + dy]
      const fl = getState().project.floors[floorIndex]
      fl.rooms = recomputeRooms(fl)
      setState({ project: { ...getState().project }, saved: false })
      return
    }
    if (wallDragRef.current) {
      // 旋转：拖动端点绕另一端旋转，保持墙的长度不变
      const { wall, which } = wallDragRef.current
      const anchor = which === 'start' ? wall.end : wall.start
      const [x, y] = snap(w)
      const len = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
      const d = [x - anchor[0], y - anchor[1]]
      const dl = Math.hypot(d[0], d[1])
      if (dl > 0.01) {
        wall[which] = [anchor[0] + (d[0] / dl) * len, anchor[1] + (d[1] / dl) * len]
      }
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
    if (openingResizeRef.current) {
      // 门窗宽度拖动：指针沿墙方向投影相对中心 = 半宽，新宽 = 2×|投影|（限制 0.3 ~ 墙长）
      const { op, center, dir } = openingResizeRef.current
      const wall = (floor?.walls || []).find(x => x.id === op.wallId)
      const wallLen = wall ? Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) : 10
      const proj = (w[0] - center[0]) * dir[0] + (w[1] - center[1]) * dir[1]
      const newWidth = Math.max(0.3, Math.min(wallLen, Math.abs(proj) * 2))
      op.width = Math.round(newWidth * 100) / 100
      setState({ project: { ...getState().project }, saved: false })
      return
    }
    if (dragRef.current) {
      const [x, y] = snap(w)
      const d = dragRef.current
      // 分组：同 group 的家具保持相对偏移一起移动
      d.members.forEach((m, i) => {
        m.pos[0] = Math.round((x - d.offsets[i][0]) * 10) / 10
        m.pos[2] = Math.round((y - d.offsets[i][1]) * 10) / 10
      })
      setState({ project: { ...getState().project }, saved: false })
      setCursor([x, y])
      return
    }
    if (tool === 'cut') {
      const t = findCutTarget(w)
      setCutPoint(t ? t.point : null)
      setCursorWall(null)
      setCursor(null)
    } else if (tool === 'wall') {
      setCursor(snap(w))
      setCursorWall(wallSnapPoint(w))
      setCutPoint(null)
    } else {
      setCursor((tool === 'furniture' || tool === 'device') ? snap(w) : w)
      setCursorWall(null)
      setCutPoint(null)
    }
  }

  const handleUp = () => {
    panRef.current = null
    dragRef.current = null
    openingDragRef.current = null
    openingResizeRef.current = null
    wallDragRef.current = null
    wallMoveRef.current = null
    planMoveRef.current = null
  }

  // 开始拖动门窗宽度（两端手柄）
  const startResizeOpening = (e, op) => {
    if (tool !== 'move') return
    e.stopPropagation()
    const wall = (floor?.walls || []).find(x => x.id === op.wallId)
    if (!wall) return
    const t = Math.max(0, Math.min(1, op.offset || 0.5))
    const cx = wall.start[0] + (wall.end[0] - wall.start[0]) * t
    const cy = wall.start[1] + (wall.end[1] - wall.start[1]) * t
    const len = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) || 1
    openingResizeRef.current = { op, center: [cx, cy], dir: [(wall.end[0] - wall.start[0]) / len, (wall.end[1] - wall.start[1]) / len] }
    setState({ selected: { type: 'opening', ref: op } })
    svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
  }

  const startDrag = (e, type, obj) => {
    if (tool !== 'move') return
    e.stopPropagation()
    if (obj.locked) { toast('已锁定，无法移动'); return }
    setState({ selected: { type, ref: obj } })
    // 分组：同 group 的家具一起移动（记录成员和相对偏移）
    if (type === 'furniture' && obj.group) {
      const fl = getState().project.floors[floorIndex]
      const members = (fl.furniture || []).filter((f) => f.group === obj.group)
      dragRef.current = { obj, members, offsets: members.map((m) => [obj.pos[0] - m.pos[0], obj.pos[2] - m.pos[2]]) }
    } else {
      dragRef.current = { obj, members: [obj], offsets: [[0, 0]] }
    }
    svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
  }
  // 双击 = 选中并切到移动工具（后续按住即可拖动）
  const doubleClickDrag = (e, type, obj) => {
    if (type !== 'furniture' && type !== 'device' && type !== 'opening' && type !== 'wall') return
    e.stopPropagation()
    if (type === 'wall') setState({ wallSel: [obj.id], selected: null, tool: 'move' })
    else setState({ selected: { type, ref: obj }, tool: 'move' })
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
    setState({ wallSel: [] })  // 点非墙对象时清掉墙多选
    onSelect({ type, ref })
  }
  // 多选墙（最多 2 条），用于共线/垂直/水平约束；点已选中的墙则取消选中
  const toggleWallSel = (id) => {
    const cur = getState().wallSel || []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    setState({ wallSel: next, selected: null })
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
  // 房间属性（改名/颜色）；recomputeRooms 会重建房间对象，这里按 id 取最新的，避免拿到旧引用
  const selRoom = selected && selected.type === 'room'
    ? ((getState().project.floors[floorIndex]?.rooms || []).find(x => x.id === selected.ref.id) || selected.ref)
    : null
  // 房间包围盒尺寸（长=横向 X，宽=纵向 Z）
  const roomDims = (() => {
    const pts = selRoom && selRoom.points || []
    if (!pts.length) return { w: 0, d: 0 }
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1])
    return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }
  })()
  // 房间作用域下，把 patch 里的「颜色类」字段（color/opacity）路由到房间独立配色（solo），
  // 其余几何字段（height/thickness/texture 等）返回照旧改对象。户型作用域不用这个。
  const applyRoomPatch = (room, patch, isWall) => {
    const geom = {}
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'color') { if (isWall) room.soloWallColor = v; else room.soloFloorColor = v }
      else if (k === 'opacity') { if (isWall) room.soloWallOpacity = v; else room.soloFloorOpacity = v }
      else geom[k] = v
    }
    return geom
  }
  const patchRoom = (r, patch) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    const target = (fl.rooms || []).find(x => x.id === r.id)
    if (!target) return
    const editingRoom = st.roomEditId ? (fl.rooms || []).find(x => x.id === st.roomEditId) : null
    if (editingRoom && editingRoom.id === target.id) {
      // 房间作用域：颜色/透明度存到房间独立配色（solo），不影响户型图整体；几何字段照旧改房间
      const geom = applyRoomPatch(target, patch, false)
      if (Object.keys(geom).length) Object.assign(target, geom)
    } else {
      Object.assign(target, patch)
    }
    setState({ project: { ...st.project }, saved: false })
  }
  // 批量改所有选中的房间（全选地板/屋顶后改颜色/透明度/贴图）
  const patchRooms = (patch) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    const ids = st.roomSel || []
    const editingRoom = st.roomEditId ? (fl.rooms || []).find(x => x.id === st.roomEditId) : null
    ;(fl.rooms || []).forEach((r) => {
      if (!ids.includes(r.id)) return
      if (editingRoom && r.id === editingRoom.id) {
        const geom = applyRoomPatch(r, patch, false)
        if (Object.keys(geom).length) Object.assign(r, geom)
      } else {
        Object.assign(r, patch)
      }
    })
    setState({ project: { ...st.project }, saved: false })
  }
  // 改房间长/宽：对每个墙端点做「分段坐标变换」——本房间左侧的墙整体左移、右侧右移、
  // 上方上移、下方下移，落在本房间边界上的端点随四角外扩/内收。这样缩放后所有共享角的
  // 墙端点始终重合，户型永远封闭、不会分家；左右邻居整体让位、大小不变。
  // 锁定的房间（locked）不做分段变换，而是整体平移（沿缩放方向），保持自身长宽不变。
  const resizeRoom = (r, newW, newD) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    const room = (fl.rooms || []).find(x => x.id === r.id) || r
    // 尺寸锁定：这个房间的长宽不能改，先解锁才能编辑
    if (room.locked) { toast('该房间已锁定尺寸，先解锁再改长宽'); return }
    const pts = room.points || []
    if (pts.length < 3) return
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    pts.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]) })
    const curW = maxX - minX, curD = maxZ - minZ
    const dx = (newW - curW) / 2   // 每侧外扩量（正=放大向外，负=缩小向内）
    const dz = (newD - curD) / 2
    const eps = 0.08
    const boundary = (rpts) => (p) => {
      for (let i = 0; i < rpts.length; i++) {
        const a = rpts[i], b = rpts[(i + 1) % rpts.length]
        if (pointToSeg(p, a, b).dist < eps) return true
      }
      return false
    }
    const bboxOf = (rpts) => {
      let bx = Infinity, bX = -Infinity, bz = Infinity, bZ = -Infinity
      rpts.forEach(p => { bx = Math.min(bx, p[0]); bX = Math.max(bX, p[0]); bz = Math.min(bz, p[1]); bZ = Math.max(bZ, p[1]) })
      return { minX: bx, maxX: bX, minZ: bz, maxZ: bZ }
    }
    const transform = (p) => {
      let x = p[0], z = p[1]
      if (x <= minX + eps) x -= dx
      else if (x >= maxX - eps) x += dx
      if (z <= minZ + eps) z -= dz
      else if (z >= maxZ - eps) z += dz
      return [x, z]
    }

    // 切分贯穿本房间边框的墙（一条墙跨多个房间时先切开，锁定房间的边界段才能独立识别/整体平移）
    const boxSegs = [
      { a: [minX, minZ], b: [minX, maxZ] },
      { a: [maxX, minZ], b: [maxX, maxZ] },
      { a: [minX, minZ], b: [maxX, minZ] },
      { a: [minX, maxZ], b: [maxX, maxZ] },
    ]
    const ownOn = boundary(pts)
    const split = []
    for (const w of (fl.walls || [])) {
      // 整条就是本房间边界墙 → 不切分（否则共线误差会被误切出假交点）
      if (ownOn(w.start) && ownOn(w.end)) { split.push(w); continue }
      const cuts = []
      for (const s of boxSegs) {
        const ip = segmentIntersect(w.start, w.end, s.a, s.b)
        if (!ip) continue
        if (Math.hypot(ip[0] - w.start[0], ip[1] - w.start[1]) > eps && Math.hypot(ip[0] - w.end[0], ip[1] - w.end[1]) > eps) {
          if (!cuts.some(c => Math.hypot(c[0] - ip[0], c[1] - ip[1]) < eps)) cuts.push(ip)
        }
      }
      if (!cuts.length) { split.push(w); continue }
      const dir = [w.end[0] - w.start[0], w.end[1] - w.start[1]]
      const len2 = dir[0] * dir[0] + dir[1] * dir[1] || 1
      cuts.sort((p, q) => (((p[0] - w.start[0]) * dir[0] + (p[1] - w.start[1]) * dir[1]) - ((q[0] - w.start[0]) * dir[0] + (q[1] - w.start[1]) * dir[1])) / len2)
      const pieces = [w.start, ...cuts, w.end]
      for (let k = 0; k < pieces.length - 1; k++) {
        split.push({ ...w, id: k === 0 ? w.id : `${w.id}-s${k}`, start: [...pieces[k]], end: [...pieces[k + 1]] })
      }
    }
    fl.walls = split

    // 锁定房间：锁定墙完全不动（保持尺寸）；同方向（改长推左右、改宽推上下）整体平移；
    // 跨方向（改长影响上下、改宽影响左右）锁定房间不动，房2 扩出的部分用新墙段补上（补段）
    const lockedRooms = (fl.rooms || []).filter(rr => rr.locked && rr.id !== room.id)
    const lockedWallSet = new Set()
    lockedRooms.forEach(rr => {
      const onRr = boundary(rr.points || [])
      ;(fl.walls || []).forEach(w => { if (onRr(w.start) && onRr(w.end)) lockedWallSet.add(w) })
    })

    // 记录未锁定墙端点（缩放前），补段要用缩放前的位置判断「原本重合」——分段变换后端点已移动
    const preEndpoints = []
    ;(fl.walls || []).forEach(w => {
      if (lockedWallSet.has(w)) return
      preEndpoints.push([...w.start], [...w.end])
    })

    // 非锁定墙：分段变换（锁定墙跳过，保持不动）
    ;(fl.walls || []).forEach((w) => {
      if (lockedWallSet.has(w)) return
      w.start = transform(w.start)
      w.end = transform(w.end)
    })

    // 同方向锁定房间：整体平移（保持尺寸、被推开）
    lockedRooms.forEach(rr => {
      const bb = bboxOf(rr.points || [])
      let mx = 0, mz = 0
      if (dx !== 0 && bb.maxX <= minX + eps) mx = -dx
      else if (dx !== 0 && bb.minX >= maxX - eps) mx = dx
      if (dz !== 0 && bb.maxZ <= minZ + eps) mz = -dz
      else if (dz !== 0 && bb.minZ >= maxZ - eps) mz = dz
      if (mx === 0 && mz === 0) return
      const onRr = boundary(rr.points || [])
      ;(fl.walls || []).forEach(w => {
        if (onRr(w.start) && onRr(w.end)) {
          w.start = [w.start[0] + mx, w.start[1] + mz]
          w.end = [w.end[0] + mx, w.end[1] + mz]
        }
      })
    })

    // 通用补段：锁定墙端点不动，缩放前与它重合的未锁定墙端点移动后错位，在错位处补新墙段。
    // 用缩放前记录的 preEndpoints 判断「原本重合」
    const newWalls = []
    lockedWallSet.forEach(w => {
      ;[w.start, w.end].forEach(p => {
        preEndpoints.forEach(p2 => {
          if (Math.hypot(p2[0] - p[0], p2[1] - p[1]) < eps) {
            const q = transform(p2)
            if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.01) {
              const dup = newWalls.some(nw =>
                (Math.hypot(nw.start[0] - p[0], nw.start[1] - p[1]) < 0.01 && Math.hypot(nw.end[0] - q[0], nw.end[1] - q[1]) < 0.01) ||
                (Math.hypot(nw.start[0] - q[0], nw.start[1] - q[1]) < 0.01 && Math.hypot(nw.end[0] - p[0], nw.end[1] - p[1]) < 0.01)
              )
              if (!dup) newWalls.push({ ...w, id: uid(), start: [...p], end: [...q] })
            }
          }
        })
      })
    })
    ;(fl.walls || []).push(...newWalls)

    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...st.project }, saved: false })
  }
  // 墙属性（高度）
  // 单选墙（用于属性面板）；墙改成用 wallSel 多选（最多 2 条），这里取唯一选中的那条
  const selWall = wallSelIds.length === 1 ? (floor?.walls || []).find(w => w.id === wallSelIds[0]) || null : null
  const patchWall = (w, patch) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    const editingRoom = st.roomEditId ? (fl.rooms || []).find(x => x.id === st.roomEditId) : null
    if (editingRoom) {
      // 房间作用域：颜色/透明度存到房间独立配色（solo），不影响户型图整体；几何字段照旧改墙
      const geom = applyRoomPatch(editingRoom, patch, true)
      if (Object.keys(geom).length) {
        const target = (fl.walls || []).find(x => x.id === w.id)
        if (target) Object.assign(target, geom)
      }
    } else {
      const target = (fl.walls || []).find(x => x.id === w.id)
      if (!target) return
      Object.assign(target, patch)
    }
    setState({ project: { ...st.project }, saved: false })
  }
  // 批量改所有选中的墙（全选后也能改颜色/高度/厚度/不透明度）
  const patchWalls = (patch) => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    const ids = st.wallSel || []
    const editingRoom = st.roomEditId ? (fl.rooms || []).find(x => x.id === st.roomEditId) : null
    ;(fl.walls || []).forEach((w) => {
      if (!ids.includes(w.id)) return
      if (editingRoom) {
        const geom = applyRoomPatch(editingRoom, patch, true)
        if (Object.keys(geom).length) Object.assign(w, geom)
      } else {
        Object.assign(w, patch)
      }
    })
    setState({ project: { ...st.project }, saved: false })
  }
  // 批量删除所有选中的墙
  const deleteWalls = () => {
    const st = getState()
    const fl = st.project.floors[floorIndex]
    const ids = st.wallSel || []
    fl.walls = (fl.walls || []).filter((w) => !ids.includes(w.id))
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...st.project }, saved: false, wallSel: [] })
    toast(`已删除 ${ids.length} 面墙`)
  }
  // 改墙长度：起点固定，终点沿墙方向移动。加长=向终点方向延伸，缩短=向起点方向收
  const setWallLength = (w, len) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.walls || []).find(x => x.id === w.id)
    if (!target) return
    const dx = target.end[0] - target.start[0], dy = target.end[1] - target.start[1]
    const cur = Math.hypot(dx, dy)
    if (cur < 1e-6 || !(len > 0)) return
    const k = len / cur
    target.end = [target.start[0] + dx * k, target.start[1] + dy * k]
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }
  // 两墙约束：垂直 / 共线 / 水平（都作用在第 2 面墙，保持第 1 面墙不动）
  const applyWallConstraint = (type) => {
    const fl = getState().project.floors[floorIndex]
    const ids = getState().wallSel || []
    if (ids.length < 2) return
    const a = (fl.walls || []).find(w => w.id === ids[0])  // 第 1 条是基准，保持不动
    if (!a) return
    const la = Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1])
    if (la < 1e-6) return
    const da = [(a.end[0] - a.start[0]) / la, (a.end[1] - a.start[1]) / la]  // a 方向单位向量
    // 对后面所有选中的墙应用约束（支持多条，不再只限 2 条）
    for (const id of ids.slice(1)) {
      const b = (fl.walls || []).find(w => w.id === id)
      if (!b) continue
      const lb = Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1]) || 1
      if (type === 'horizontal') {
        // 水平：b 变成水平（保持 b 起点、长度）
        b.end = [b.start[0] + (b.end[0] - b.start[0] >= 0 ? 1 : -1) * lb, b.start[1]]
      } else if (type === 'perp') {
        // 垂直：b 变成垂直于 a（a 的法向），保持 b 起点、长度
        const n = [-da[1], da[0]]
        b.end = [b.start[0] + n[0] * lb, b.start[1] + n[1] * lb]
      } else if (type === 'collinear') {
        // 共线：b 的方向对齐 a 的方向，且 b 的起点投影到 a 的直线上（同一条直线，不要求线段首尾相接/重合）
        const t = (b.start[0] - a.start[0]) * da[0] + (b.start[1] - a.start[1]) * da[1]
        const proj = [a.start[0] + da[0] * t, a.start[1] + da[1] * t]
        const dir = ((b.end[0] - b.start[0]) * da[0] + (b.end[1] - b.start[1]) * da[1]) >= 0 ? 1 : -1
        b.start = proj
        b.end = [proj[0] + dir * da[0] * lb, proj[1] + dir * da[1] * lb]
      } else if (type === 'samepoint') {
        // 同点：找两墙最近的端点对，把 b 平移到和 a 端点重合
        const p1 = [a.start, a.end], p2 = [b.start, b.end]
        let bi = 0, bj = 0, bd = Infinity
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const d = Math.hypot(p1[i][0] - p2[j][0], p1[i][1] - p2[j][1])
          if (d < bd) { bd = d; bi = i; bj = j }
        }
        const dx = p1[bi][0] - p2[bj][0], dy = p1[bi][1] - p2[bj][1]
        b.start = [b.start[0] + dx, b.start[1] + dy]
        b.end = [b.end[0] + dx, b.end[1] + dy]
      }
    }
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false, wallSel: ids })
  }
  // 绕起点旋转 ±90°
  const rotateWall90 = (w, dir) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.walls || []).find(v => v.id === w.id)
    if (!target) return
    const dx = target.end[0] - target.start[0], dy = target.end[1] - target.start[1]
    if (Math.hypot(dx, dy) < 1e-6) return
    // +90°（逆时针）：(dx,dy)->(-dy,dx)；-90°（顺时针）：(dx,dy)->(dy,-dx)
    target.end = dir > 0
      ? [target.start[0] - dy, target.start[1] + dx]
      : [target.start[0] + dy, target.start[1] - dx]
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }
  // 找裁剪目标：离 p 最近的墙 + 它和别的墙的交点（交点不能在端点）
  const findCutTarget = (p) => {
    const fl = getState().project.floors[floorIndex]
    let wBest = null, wD = 0.5
    for (const w of (fl.walls || [])) {
      const r = pointToSeg(p, w.start, w.end)
      if (r.dist < wD) { wD = r.dist; wBest = w }
    }
    if (!wBest) return null
    let best = null, bd = Infinity
    for (const o of (fl.walls || [])) {
      if (o.id === wBest.id) continue
      const ip = segmentIntersect(wBest.start, wBest.end, o.start, o.end)
      if (ip) {
        const d = Math.hypot(ip[0] - p[0], ip[1] - p[1])
        if (d < bd) { bd = d; best = ip }
      }
    }
    if (!best) return null
    if (Math.hypot(best[0] - wBest.start[0], best[1] - wBest.start[1]) < 0.01 ||
        Math.hypot(best[0] - wBest.end[0], best[1] - wBest.end[1]) < 0.01) return null
    return { wall: wBest, point: best }
  }
  // 裁剪：把墙在与其它墙的交点处切成两段（吸附到交点，切完房间仍闭合）
  const cutWall = (target, pt) => {
    const fl = getState().project.floors[floorIndex]
    const w2 = { id: uid(), start: [...pt], end: [...target.end], height: target.height, thickness: target.thickness, color: target.color, opacity: target.opacity }
    target.end = [...pt]
    fl.walls.push(w2)
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false, wallSel: [target.id, w2.id] })
    toast('已裁剪成两段')
  }
  // 改墙起点 / 终点（坐标直接改）
  const setWallStart = (w, x, y) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.walls || []).find(v => v.id === w.id)
    if (!target) return
    target.start = [x, y]
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }
  const setWallEnd = (w, x, y) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.walls || []).find(v => v.id === w.id)
    if (!target) return
    target.end = [x, y]
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }
  // 调换起点/终点
  const swapWall = (w) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.walls || []).find(v => v.id === w.id)
    if (!target) return
    const s = target.start
    target.start = target.end
    target.end = s
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }
  // 删除选中墙
  const deleteWall = (w) => {
    const fl = getState().project.floors[floorIndex]
    fl.walls = (fl.walls || []).filter(x => x.id !== w.id)
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false, wallSel: [], selected: null })
    toast('已删除墙')
  }
  // 方向改成水平/竖直（以起点为基准，保持长度，保持左/右、上/下的朝向符号）
  const setWallDir = (w, dir) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.walls || []).find(v => v.id === w.id)
    if (!target) return
    const dx = target.end[0] - target.start[0], dy = target.end[1] - target.start[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return
    if (dir === 'horizontal') {
      const s = dx >= 0 ? 1 : -1
      target.end = [target.start[0] + s * len, target.start[1]]
    } else {
      const s = dy >= 0 ? 1 : -1
      target.end = [target.start[0], target.start[1] + s * len]
    }
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }
  // 按角度改方向（度，以起点为基准、保持长度）
  const setWallAngle = (w, deg) => {
    const fl = getState().project.floors[floorIndex]
    const target = (fl.walls || []).find(v => v.id === w.id)
    if (!target) return
    const dx = target.end[0] - target.start[0], dy = target.end[1] - target.start[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return
    const rad = (Number(deg) || 0) * Math.PI / 180
    target.end = [target.start[0] + Math.cos(rad) * len, target.start[1] + Math.sin(rad) * len]
    fl.rooms = recomputeRooms(fl)
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
        {/* 房间地板壁纸贴图（每 1 米平铺一次） */}
        {rooms.filter(r => r.texture).map(r => (
          <pattern key={r.id} id={`room-tex-${r.id}`} patternUnits="userSpaceOnUse" width="1" height="1">
            <image href={BASE + 'api/background/' + r.texture} x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid slice" />
          </pattern>
        ))}
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

      {/* 房间：多边形 + 名字 + 面积（单房间聚焦时只显示这一个房间） */}
      {rooms.filter(r => !editingRoom || r.id === roomEditId).map(room => {
        const cx = room.points.reduce((s, p) => s + p[0], 0) / room.points.length
        const cy = room.points.reduce((s, p) => s + p[1], 0) / room.points.length
        const selRoom = isSel('room', room.id)
        return (
          <g key={room.id} onClick={e => clickEl(e, 'room', room)}>
            <polygon
              points={room.points.map(p => p.join(',')).join(' ')}
              className={`plan-room ${selRoom ? 'selected' : ''}`}
              style={selRoom ? undefined : (room.texture ? { fill: `url(#room-tex-${room.id})` } : ((editingRoom && editingRoom.id === room.id && editingRoom.soloFloorColor) || room.color) ? { fill: (editingRoom && editingRoom.id === room.id && editingRoom.soloFloorColor) || room.color } : undefined)}
            />
            <text x={cx} y={cy - 0.06} className={`plan-room-name ${selRoom ? 'selected' : ''}`}>{room.name}</text>
            <text x={cx} y={cy + 0.22} className="plan-room-area">{polygonArea(room.points).toFixed(1)} m²</text>
          </g>
        )
      })}

      {/* 墙（持久化线段：select 多选（最多2条），delete 删除；单房间聚焦时只显示该房间边界墙） */}
      {walls.filter(w => wallCoversRoomEdge(w)).map((w, i) => {
        const selW = wallSelIds.includes(w.id)
        const wlen = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
        const wmx = (w.start[0] + w.end[0]) / 2
        const wmy = (w.start[1] + w.end[1]) / 2
        // 检测标注：问题墙显示红色/橙色 + 问题类型标签
        let issue = null
        if (wallIssues) {
          if (wallIssues.zeroLen.includes(w.id)) issue = { label: '零长度', color: '#ff6b6b' }
          else if ((wallIssues.shortWalls || []).includes(w.id)) issue = { label: '短墙', color: '#ff6b6b' }
          else if (wallIssues.dupIds.includes(w.id)) issue = { label: '重复', color: '#ff9b54' }
          else if (wallIssues.overlapIds.includes(w.id)) issue = { label: '重叠', color: '#ffd166' }
          else if (wallIssues.danglingIds.includes(w.id)) issue = { label: '伸出', color: '#ff6b9d' }
          else if ((wallIssues.isolatedIds || []).includes(w.id)) issue = { label: '孤立', color: '#ff6b9d' }
        }
        return (
          <g key={w.id || `w${i}`}>
            <line
              x1={w.start[0]} y1={w.start[1]} x2={w.end[0]} y2={w.end[1]}
              className={`plan-wall ${selW ? 'selected' : ''}`}
              stroke={issue ? issue.color : ((editingRoom && editingRoom.soloWallColor) || w.color || undefined)}
              strokeWidth={issue ? WALL_T * 1.6 : WALL_T}
              strokeOpacity={((editingRoom && editingRoom.soloWallOpacity != null ? editingRoom.soloWallOpacity : (w.opacity != null ? w.opacity : wallOpacity)) / 100)}
              onPointerDown={(e) => {
                if (tool === 'delete') { e.stopPropagation(); onSelect({ type: 'wall', ref: w, index: i }) }
                else if (tool === 'select') {
                  // 用 onPointerDown + stopPropagation：阻止 SVG 的 handleFloorDown 先清掉 wallSel，
                  // 否则多选时点第二面墙会把第一面的选择清掉
                  e.stopPropagation()
                  if (e.ctrlKey || e.metaKey || multiSelect) toggleWallSel(w.id)
                  else setState({ wallSel: [w.id], selected: null })
                } else if (tool === 'move') {
                  // 移动模式下按住墙整体平移
                  e.stopPropagation()
                  setState({ wallSel: [w.id], selected: null })
                  wallMoveRef.current = { wall: w, startPos: [...w.start, ...w.end], startMouse: toWorld(e) }
                  svgRef.current && svgRef.current.setPointerCapture(e.pointerId)
                }
              }}
              onDoubleClick={(e) => doubleClickDrag(e, 'wall', w)}
            />
            {issue && (
              <>
                <text x={wmx} y={wmy - 0.18} className="plan-issue-label" textAnchor="middle">{issue.label}</text>
                {issue.label === '伸出' && (() => {
                  // 标出自由端（伸出去的那一头）：红色圆圈，让人看清在哪里伸出
                  const touchesAny = (p) => walls.some((other) => {
                    if (other.id === w.id) return false
                    return pointToSeg(p, other.start, other.end).dist < 0.08
                  })
                  return (
                    <>
                      {!touchesAny(w.start) && <circle cx={w.start[0]} cy={w.start[1]} r={0.22} fill="none" stroke="#ff2d55" strokeWidth={0.07} />}
                      {!touchesAny(w.end) && <circle cx={w.end[0]} cy={w.end[1]} r={0.22} fill="none" stroke="#ff2d55" strokeWidth={0.07} />}
                    </>
                  )
                })()}
              </>
            )}
            {selW && (tool === 'select' || tool === 'move') && (
              <>
                <circle cx={w.start[0]} cy={w.start[1]} r={0.16} className="plan-wall-handle start" onPointerDown={(e) => startWallDrag(e, w, 'start')} />
                <circle cx={w.end[0]} cy={w.end[1]} r={0.16} className="plan-wall-handle end" onPointerDown={(e) => startWallDrag(e, w, 'end')} />
              </>
            )}
            {showDimensions && wlen > 0.01 && (
              <text x={wmx} y={wmy} className="plan-dim">{wlen.toFixed(2)}m</text>
            )}
          </g>
        )
      })}

      {/* 墙体交点：红点标记（判断线是否闭合/连接，容差与房间检测 SNAP_TOL 一致） */}
      {showIntersections && !editingRoom && (() => {
        const pts = []
        const seen = new Set()
        const add = (p) => {
          const k = `${Math.round(p[0] / SNAP_TOL)},${Math.round(p[1] / SNAP_TOL)}`
          if (seen.has(k)) return
          seen.add(k)
          pts.push(p)
        }
        // 端点几乎碰到另一条墙（T形连接）：投影到那条墙上，容差 SNAP_TOL
        const snap = (p, s) => {
          const r = pointToSeg(p, s.start, s.end)
          if (r.dist < SNAP_TOL) add([s.start[0] + r.t * (s.end[0] - s.start[0]), s.start[1] + r.t * (s.end[1] - s.start[1])])
        }
        for (let i = 0; i < walls.length; i++) {
          for (let j = i + 1; j < walls.length; j++) {
            const a = walls[i], b = walls[j]
            const ip = segmentIntersect(a.start, a.end, b.start, b.end)
            if (ip) add(ip)
            snap(a.start, b); snap(a.end, b); snap(b.start, a); snap(b.end, a)
          }
        }
        return pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={0.12} className="plan-intersection-dot" />
        ))
      })()}

      {/* 门窗（对齐原版：墙洞白线 + 门扇 + 开启弧；单房间聚焦时只显示该房间边界墙上的门窗） */}
      {openings.filter(op => { if (!editingRoom) return true; const ow = walls.find(x => x.id === op.wallId); return !!ow && wallCoversRoomEdge(ow) }).map(op => {
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
            {selO && (
              <>
                <circle cx={-wd / 2} cy={0} r={0.12} fill="#2f7fe0" stroke="#fff" strokeWidth={0.04}
                  onPointerDown={(e) => startResizeOpening(e, op)} style={{ cursor: 'ew-resize' }} />
                <circle cx={wd / 2} cy={0} r={0.12} fill="#2f7fe0" stroke="#fff" strokeWidth={0.04}
                  onPointerDown={(e) => startResizeOpening(e, op)} style={{ cursor: 'ew-resize' }} />
              </>
            )}
          </g>
        )
      })}

      {/* 家具（单房间聚焦时只显示该房间内的） */}
      {furniture.filter(f => posInEditingRoom(f.pos[0], f.pos[2])).map(f => {
        const lib = FURNITURE_LIB.find(x => x.type === f.type)
        const cat = getCatalogItem(f.type)
        const devModel = DEVICE_MODELS.find(m => m.id === f.type)
        const w = (f.width != null ? f.width : (lib ? lib.w : cat ? cat.w : devModel ? devModel.w : 1)) * (f.scale ? f.scale[0] : 1)
        const d = (f.depth != null ? f.depth : (lib ? lib.d : cat ? cat.d : devModel ? devModel.d : 0.6)) * (f.scale ? f.scale[2] : 1)
        const label = f.name || (lib ? f.type : (cat ? cat.label : devModel ? devModel.label : f.type))
        const selF = isSel('furniture', f.id)
        const placement = f.placement || (lib && lib.placement) || (devModel && devModel.placement) || 'floor'
        return (
          <g
            key={f.id}
            transform={`translate(${f.pos[0] || 0} ${f.pos[2] || 0}) rotate(${f.rot || 0})`}
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

      {/* 设备（单房间聚焦时只显示该房间内的） */}
      {devices.filter(dev => posInEditingRoom(dev.pos[0], dev.pos[2])).map(dev => {
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

      {/* 画墙实时长度（上一个点 → 光标，移动鼠标实时变） */}
      {draft && draft.pts.length > 0 && cursor && tool === 'wall' && (() => {
        const last = draft.pts[draft.pts.length - 1]
        const len = Math.hypot(cursor[0] - last[0], cursor[1] - last[1])
        if (len < 0.01) return null
        const mx = (last[0] + cursor[0]) / 2, my = (last[1] + cursor[1]) / 2
        return <text x={mx} y={my + 0.32} className="plan-dim" textAnchor="middle">{len.toFixed(2)}m</text>
      })()}

      {/* 画墙时水平/垂直提示（当前段被轴向吸附成水平或垂直时显示） */}
      {draft && draft.pts.length > 0 && cursor && tool === 'wall' && (() => {
        const last = draft.pts[draft.pts.length - 1]
        const dx = cursor[0] - last[0], dy = cursor[1] - last[1]
        let label = null
        if (Math.abs(dy) < 0.01 && Math.abs(dx) > 0.01) label = '水平'
        else if (Math.abs(dx) < 0.01 && Math.abs(dy) > 0.01) label = '垂直'
        if (!label) return null
        const mx = (last[0] + cursor[0]) / 2, my = (last[1] + cursor[1]) / 2
        return <text x={mx} y={my - 0.14} className="plan-align-hint">{label}</text>
      })()}

      {/* 画墙起点标记（绿色圆点，鼠标靠近时放大提示可闭合） */}
      {draft && draft.pts.length > 0 && tool === 'wall' && (() => {
        const near = cursor && Math.hypot(cursor[0] - draft.pts[0][0], cursor[1] - draft.pts[0][1]) < CLOSE
        return (
          <g transform={`translate(${draft.pts[0][0]} ${draft.pts[0][1]})`} className={`plan-start-marker ${near ? 'near' : ''}`}>
            <circle r={near ? 0.32 : 0.18} />
          </g>
        )
      })()}

      {/* 画墙碰到已有墙时的蓝色提示（吸附点） */}
      {tool === 'wall' && cursorWall && (
        <g transform={`translate(${cursorWall[0]} ${cursorWall[1]})`} className="plan-cursor-wall">
          <circle r="0.24" />
        </g>
      )}
      {/* 放置/画墙时的吸附点标记（非墙上） */}
      {(tool === 'furniture' || tool === 'device' || (tool === 'wall' && !cursorWall)) && cursor && (
        <g transform={`translate(${cursor[0]} ${cursor[1]})`} className="plan-cursor">
          <circle r="0.14" />
        </g>
      )}
      {/* 裁剪时的交点提示（橙色，吸附到两条墙的交点） */}
      {tool === 'cut' && cutPoint && (
        <g transform={`translate(${cutPoint[0]} ${cutPoint[1]})`} className="plan-cut-point">
          <circle r="0.26" />
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
        <div className="plan-props-row">
          <span className="plan-props-label">不透明度</span>
          <input type="range" min="10" max="100" step="5" style={{ flex: 1 }} value={wallOpacity} onChange={(e) => setState({ wallOpacity: Number(e.target.value) })} />
          <span className="plan-props-unit">{wallOpacity}%</span>
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
          <span className="plan-props-label">分组</span>
          <input type="text" value={selFurniture.group || ''} placeholder="同组名一起移动"
            onChange={(e) => patchFurniture(selFurniture, { group: e.target.value || undefined })} />
        </div>
        <MoveControls id={selFurniture.id} floorIndex={floorIndex} />
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
          <button className="plan-props-seg" onClick={() => patchFurniture(selFurniture, { locked: !selFurniture.locked })}>
            {selFurniture.locked ? '🔒 已锁定（点击解锁）' : '🔓 锁定（防止移动）'}
          </button>
          <button className="plan-props-seg" onClick={() => duplicateFurniture(selFurniture)}>⧉ 复制</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">实体</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selFurniture.entity_id || '未绑定'}</span>
          <button className="plan-props-seg" onClick={() => setDeviceBindOpen(true)}>绑定</button>
        </div>
        {deviceBindOpen && (
          <div style={{ marginTop: 8 }}>
            <EntityPicker onPick={(e) => { patchFurniture(selFurniture, e); setDeviceBindOpen(false); toast(`已绑定 ${e.name}`) }} onClose={() => setDeviceBindOpen(false)} />
          </div>
        )}
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
            <div className="plan-props-row">
              <span className="plan-props-label">高度</span>
              <input type="number" step="0.1" min="0.5" max="3" value={Math.round((selOpening.height || 2.1) * 10) / 10}
                onChange={(e) => patchOpening(selOpening, { height: Math.min(3, Math.max(0.5, Number(e.target.value) || 2.1)) })} />
              <span className="plan-props-unit">m</span>
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
        <div className="plan-props-row">
          <span className="plan-props-label">框角</span>
          <button className={`plan-props-seg ${(selOpening.frameStyle || 'square') === 'square' ? 'active' : ''}`}
            onClick={() => patchOpening(selOpening, { frameStyle: 'square' })}>直角</button>
          <button className={`plan-props-seg ${(selOpening.frameStyle || 'square') === 'rounded' ? 'active' : ''}`}
            onClick={() => patchOpening(selOpening, { frameStyle: 'rounded' })}>圆角</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">框厚</span>
          <input type="number" step="0.01" min="0.02" max="0.12" value={Math.round(((selOpening.frameThickness || (selOpening.type === 'door' ? 0.06 : 0.04)) * 100)) / 100}
            onChange={(e) => patchOpening(selOpening, { frameThickness: Math.min(0.12, Math.max(0.02, Number(e.target.value) || 0.04)) })} />
          <span className="plan-props-unit">m</span>
        </div>
      </div>
    )}
    {selDevice && (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>{selDevice.name || selDevice.entity_id}</span>
          <button className="plan-props-del" onClick={() => deleteDevice(selDevice)}>删除</button>
        </div>
        <MoveControls id={selDevice.id} floorIndex={floorIndex} />
        <div className="plan-props-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span className="plan-props-label">模型（点缩略图选）</span>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button onClick={() => patchDevice(selDevice, { modelId: undefined })}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: !selDevice.modelId ? 'var(--accent)' : 'var(--panel2)', color: !selDevice.modelId ? '#081018' : 'var(--text)', cursor: 'pointer', fontSize: 12, alignSelf: 'flex-start' }}>无（圆球）</button>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 3px' }}>设备模型</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {DEVICE_KINDS.map((k) => {
                  const items = DEVICE_MODELS.filter((m) => m.kind === k.kind)
                  if (items.length === 0) return null
                  return (
                    <div key={k.kind} style={{ width: '100%', marginTop: 2 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', margin: '2px 0' }}>{k.label}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {items.map((m) => (
                          <button key={m.id} title={m.label} onClick={() => patchDevice(selDevice, { modelId: m.id })}
                            style={{ padding: '3px 8px', borderRadius: 6, border: selDevice.modelId === m.id ? '2px solid var(--accent)' : '1px solid var(--border)', background: 'var(--panel2)', color: selDevice.modelId === m.id ? 'var(--accent)' : 'var(--text)', cursor: 'pointer', fontSize: 11 }}>
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
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
          <span className="plan-props-label">高度</span>
          <input type="number" step="0.1" min="0" max="6" value={Math.round((selDevice.pos[1] || 1.4) * 100) / 100}
            onChange={(e) => patchDevice(selDevice, { pos: [selDevice.pos[0], Number(e.target.value) || 0, selDevice.pos[2]] })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">实体</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selDevice.entity_id || '未绑定'}</span>
          <button className="plan-props-seg" onClick={() => setDeviceBindOpen(true)}>绑定</button>
        </div>
        {deviceBindOpen && (
          <div style={{ marginTop: 8 }}>
            <EntityPicker onPick={(e) => { patchDevice(selDevice, e); setDeviceBindOpen(false); toast(`已绑定 ${e.name}`) }} onClose={() => setDeviceBindOpen(false)} />
          </div>
        )}
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
          <span className="plan-props-label">尺寸锁定</span>
          <button style={{ padding: '4px 12px', borderRadius: 6, border: selRoom.locked ? '1px solid var(--accent)' : '1px solid var(--border)', background: selRoom.locked ? 'var(--accent)' : 'var(--panel2)', color: selRoom.locked ? '#081018' : 'var(--text)', cursor: 'pointer', fontSize: 12 }}
            onClick={() => patchRoom(selRoom, { locked: !selRoom.locked })}>
            {selRoom.locked ? '🔒 已锁定' : '锁定'}
          </button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">长</span>
          <button disabled={selRoom.locked} style={{ opacity: selRoom.locked ? 0.4 : 1 }} onClick={() => resizeRoom(selRoom, Math.max(0.5, roomDims.w - 0.1), roomDims.d)}>−</button>
          <NumInput disabled={selRoom.locked} value={Math.round(roomDims.w * 100) / 100} step={0.1} min={0.5} onChange={(v) => resizeRoom(selRoom, v, roomDims.d)} />
          <button disabled={selRoom.locked} style={{ opacity: selRoom.locked ? 0.4 : 1 }} onClick={() => resizeRoom(selRoom, roomDims.w + 0.1, roomDims.d)}>＋</button>
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">宽</span>
          <button disabled={selRoom.locked} style={{ opacity: selRoom.locked ? 0.4 : 1 }} onClick={() => resizeRoom(selRoom, roomDims.w, Math.max(0.5, roomDims.d - 0.1))}>−</button>
          <NumInput disabled={selRoom.locked} value={Math.round(roomDims.d * 100) / 100} step={0.1} min={0.5} onChange={(v) => resizeRoom(selRoom, roomDims.w, v)} />
          <button disabled={selRoom.locked} style={{ opacity: selRoom.locked ? 0.4 : 1 }} onClick={() => resizeRoom(selRoom, roomDims.w, roomDims.d + 0.1)}>＋</button>
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">高度</span>
          <NumInput value={selRoom.height || floor?.height || 2.8} step={0.1} min={0.5} max={8} onChange={(v) => patchRoom(selRoom, { height: v })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">厚度</span>
          <NumInput value={selRoom.thickness || 0.05} step={0.01} min={0.02} max={1} onChange={(v) => patchRoom(selRoom, { thickness: v })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span className="plan-props-label">颜色</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {FLOOR_COLORS.map((c) => (
              <button key={c} title={c} onClick={() => patchRoom(selRoom, { color: c })}
                className="plan-props-swatch" style={{ background: c }} />
            ))}
          </div>
          <HexColorPicker value={selRoom.color || '#7789ad'} onChange={(c) => patchRoom(selRoom, { color: c })} />
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">透明度</span>
          <input type="range" min="10" max="100" step="5" style={{ flex: 1 }}
            value={selRoom.opacity != null ? selRoom.opacity : 100}
            onChange={(e) => patchRoom(selRoom, { opacity: Number(e.target.value) })} />
          <span className="plan-props-unit">{selRoom.opacity != null ? selRoom.opacity : 100}%</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">壁纸</span>
          <input type="file" accept="image/*" id="floor-texture-file" style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = async () => {
                try {
                  const r = await fetch(BASE + 'api/background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: reader.result }) })
                  const res = await r.json()
                  if (res.ok && res.name) { patchRoom(selRoom, { texture: res.name }); setBgList([{ name: res.name }, ...bgList]); toast('地板壁纸已上传') }
                } catch (err) { toast('上传失败') }
              }
              reader.readAsDataURL(file)
            }} />
          <button onClick={() => document.getElementById('floor-texture-file').click()}>{selRoom.texture ? '更换壁纸' : '上传壁纸'}</button>
          {selRoom.texture && <button style={{ color: 'var(--danger)' }} onClick={() => patchRoom(selRoom, { texture: '' })}>清除</button>}
        </div>
        {bgList.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
            {bgList.map((img) => (
              <img key={img.name} src={BASE + 'api/background/' + img.name} alt=""
                style={{ width: 48, height: 32, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: selRoom.texture === img.name ? '2px solid var(--accent)' : '1px solid var(--border)' }}
                onClick={() => patchRoom(selRoom, { texture: img.name })} />
            ))}
          </div>
        )}
      </div>
    )}
    {roomSelIds.length > 0 && (
      <div className="plan-props">
        <div className="plan-props-head"><span>批量房间（{roomSelIds.length} 个）</span></div>
        <div className="plan-props-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span className="plan-props-label">颜色</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {FLOOR_COLORS.map((c) => (
              <button key={c} title={c} onClick={() => patchRooms({ color: c })}
                className="plan-props-swatch" style={{ background: c }} />
            ))}
          </div>
          <HexColorPicker value="#7789ad" onChange={(c) => patchRooms({ color: c })} />
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">透明度</span>
          <input type="range" min="10" max="100" step="5" style={{ flex: 1 }} defaultValue={100}
            onChange={(e) => patchRooms({ opacity: Number(e.target.value) })} />
          <span className="plan-props-unit">%</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">厚度</span>
          <NumInput value={(() => { const r = (getState().project.floors[floorIndex]?.rooms || []).find(x => roomSelIds.includes(x.id)); return (r && r.thickness != null) ? r.thickness : 0.05 })()} step={0.01} min={0.02} max={1} onChange={(v) => patchRooms({ thickness: v })} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">贴图</span>
          <input type="file" accept="image/*" id="room-batch-texture-file" style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = async () => {
                try {
                  const r = await fetch(BASE + 'api/background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: reader.result }) })
                  const res = await r.json()
                  if (res.ok && res.name) { patchRooms({ texture: res.name }); setBgList([{ name: res.name }, ...bgList]); toast('地板贴图已上传') }
                } catch (err) { toast('上传失败') }
              }
              reader.readAsDataURL(file)
            }} />
          <button onClick={() => document.getElementById('room-batch-texture-file').click()}>上传贴图</button>
          <button style={{ color: 'var(--danger)' }} onClick={() => patchRooms({ texture: '' })}>清除</button>
        </div>
        {bgList.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
            {bgList.map((img) => (
              <img key={img.name} src={BASE + 'api/background/' + img.name} alt=""
                style={{ width: 48, height: 32, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)' }}
                onClick={() => patchRooms({ texture: img.name })} />
            ))}
          </div>
        )}
      </div>
    )}
    {selWall && (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>墙</span>
          <button className="plan-props-del" onClick={() => swapWall(selWall)} title="调换起点/终点">⇅ 调换</button>
          <button className="plan-props-del" onClick={() => deleteWall(selWall)}>删除</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">起点</span>
          <input type="number" step="0.1" title="X" value={Math.round(selWall.start[0] * 100) / 100}
            onChange={(e) => setWallStart(selWall, Number(e.target.value) || 0, selWall.start[1])} />
          <input type="number" step="0.1" title="Y" value={Math.round(selWall.start[1] * 100) / 100}
            onChange={(e) => setWallStart(selWall, selWall.start[0], Number(e.target.value) || 0)} />
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">终点</span>
          <input type="number" step="0.1" title="X" value={Math.round(selWall.end[0] * 100) / 100}
            onChange={(e) => setWallEnd(selWall, Number(e.target.value) || 0, selWall.end[1])} />
          <input type="number" step="0.1" title="Y" value={Math.round(selWall.end[1] * 100) / 100}
            onChange={(e) => setWallEnd(selWall, selWall.end[0], Number(e.target.value) || 0)} />
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">长度</span>
          <input type="number" step="0.1" min="0.1"
            value={Math.round(Math.hypot(selWall.end[0] - selWall.start[0], selWall.end[1] - selWall.start[1]) * 100) / 100}
            onChange={(e) => setWallLength(selWall, Number(e.target.value) || 0)}
            title="起点固定，终点沿墙方向伸缩" />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">方向</span>
          <span style={{ fontSize: 12, color: 'var(--text)' }}>
            {Math.abs(selWall.end[1] - selWall.start[1]) < 0.01 ? '水平' : Math.abs(selWall.end[0] - selWall.start[0]) < 0.01 ? '竖直' : '斜线'}
          </span>
          <button className="plan-props-seg" onClick={() => setWallDir(selWall, 'horizontal')}>水平</button>
          <button className="plan-props-seg" onClick={() => setWallDir(selWall, 'vertical')}>竖直</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">角度</span>
          <input type="number" step="5"
            value={Math.round(Math.atan2(selWall.end[1] - selWall.start[1], selWall.end[0] - selWall.start[0]) * 180 / Math.PI)}
            onChange={(e) => setWallAngle(selWall, Number(e.target.value) || 0)} />
          <span className="plan-props-unit">°</span>
          <button onClick={() => rotateWall90(selWall, 1)} title="逆时针转 90°">+90°</button>
          <button onClick={() => rotateWall90(selWall, -1)} title="顺时针转 90°">-90°</button>
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
        <div className="plan-props-row">
          <span className="plan-props-label">不透明度</span>
          <input type="range" min="10" max="100" step="5" style={{ flex: 1 }}
            value={selWall.opacity != null ? selWall.opacity : wallOpacity}
            onChange={(e) => patchWall(selWall, { opacity: Number(e.target.value) })} />
          <span className="plan-props-unit">{selWall.opacity != null ? selWall.opacity : wallOpacity}%</span>
        </div>
      </div>
    )}
    {wallSelIds.length === 2 && (
      <div className="plan-props">
        <div className="plan-props-head"><span>两墙约束</span></div>
        <div className="plan-props-row">
          <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>
            已选 2 面墙：{wallRelText(wallSelIds, walls)}
          </span>
        </div>
        <div className="plan-props-row">
          <button className="plan-props-seg" onClick={() => applyWallConstraint('perp')}>垂直</button>
          <button className="plan-props-seg" onClick={() => applyWallConstraint('collinear')}>共线</button>
          <button className="plan-props-seg" onClick={() => applyWallConstraint('horizontal')}>水平</button>
          <button className="plan-props-seg" onClick={() => applyWallConstraint('samepoint')}>同点</button>
        </div>
      </div>
    )}
    {wallSelIds.length > 2 && (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>批量墙（{wallSelIds.length} 面）</span>
          <button className="plan-props-del" onClick={deleteWalls}>删除</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">高度</span>
          <input type="number" step="0.1" min="1" max="6" placeholder="统一" onChange={(e) => { if (e.target.value) patchWalls({ height: Number(e.target.value) || 2.8 }) }} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">厚度</span>
          <input type="number" step="0.02" min="0.05" max="0.5" placeholder="统一" onChange={(e) => { if (e.target.value) patchWalls({ thickness: Number(e.target.value) || 0.12 }) }} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span className="plan-props-label">颜色</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {WALL_COLORS.map((c) => (
              <button key={c} title={c} onClick={() => patchWalls({ color: c })}
                className="plan-props-swatch" style={{ background: c }} />
            ))}
          </div>
          <HexColorPicker value="#d5e0f1" onChange={(c) => patchWalls({ color: c })} />
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">不透明度</span>
          <input type="range" min="10" max="100" step="5" style={{ flex: 1 }} defaultValue={wallOpacity}
            onChange={(e) => patchWalls({ opacity: Number(e.target.value) })} />
          <span className="plan-props-unit">%</span>
        </div>
      </div>
    )}
    </div>
  )
}
