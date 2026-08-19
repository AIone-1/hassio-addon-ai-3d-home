import { useEffect, useRef, useState, useCallback } from 'react'
import Viewer from './components/Viewer'
import PlanEditor from './components/PlanEditor'
import BottomBar from './components/BottomBar'
import Editor from './components/Editor'
import BindDrawer from './components/BindDrawer'
import DeviceList from './components/DeviceList'
import HexColorPicker from './components/HexColorPicker'
import { useStore, setState, getState, toast, loadProject } from './store'
import { api, TOGGLE_DOMAINS, BASE } from './api'
import { roomsToWalls, recomputeRooms, pointToSeg } from './three/geometry'
import { loadCatalog } from './catalog'

// 电视屏幕默认画面视频（相对路径，ingress 下同源加载；后端 serve webui/videos/）
const DEFAULT_TV_VIDEO = 'videos/demo.mp4'

// 颜色换算：#rrggbb ↔ [r,g,b] 0-255
function hexToRgb(hex) {
  try {
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  } catch { return [255, 209, 102] }
}
function rgbToHex(rgb) {
  if (!Array.isArray(rgb)) return '#ffd166'
  try {
    return '#' + rgb.slice(0, 3).map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')
  } catch { return '#ffd166' }
}

export default function App() {
  const project = useStore((s) => s.project)
  const editing = useStore((s) => s.editing)
  const bindOpen = useStore((s) => s.bindOpen)
  const deviceListOpen = useStore((s) => s.deviceListOpen)
  const currentFloor = useStore((s) => s.currentFloor)
  const selected = useStore((s) => s.selected)
  const haConnected = useStore((s) => s.haConnected)
  const haStates = useStore((s) => s.haStates)
  const haEntities = useStore((s) => s.haEntities)
  const toastMsg = useStore((s) => s.toast)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const bgImage = useStore((s) => s.bgImage)
  const bgMode = useStore((s) => s.bgMode)
  const bgColor = useStore((s) => s.bgColor)
  const bgGradient1 = useStore((s) => s.bgGradient1)
  const bgGradient2 = useStore((s) => s.bgGradient2)
  const roofOpacity = useStore((s) => s.roofOpacity)
  const roofColor = useStore((s) => s.roofColor)
  const view2d = useStore((s) => s.view2d)
  const immersive = useStore((s) => s.immersive)
  const showToolbar = useStore((s) => s.showToolbar)
  const showFps = useStore((s) => s.showFps)
  const settings = useStore((s) => s.settings)
  const quality = useStore((s) => s.quality)
  const shadows = useStore((s) => s.shadows)
  const bloom = useStore((s) => s.bloom)
  const autoRotate = useStore((s) => s.autoRotate)
  const rotateDir = useStore((s) => s.rotateDir)
  const rotateSpeed = useStore((s) => s.rotateSpeed)
  const [deviceModal, setDeviceModal] = useState(null)
  const [bgImages, setBgImages] = useState([])
  const [settingsTab, setSettingsTab] = useState('default')
  const [notifications, setNotifications] = useState([])
  const [runningSceneId, setRunningSceneId] = useState(null)
  const [lastSceneId, setLastSceneId] = useState(null)
  const sceneOpen = useStore((s) => s.sceneOpen)
  const notifOpen = useStore((s) => s.notifOpen)
  const roomNavOpen = useStore((s) => s.roomNavOpen)
  const focusRoomId = useStore((s) => s.focusRoomId)
  const roomEditId = useStore((s) => s.roomEditId)
  const mihomeMode = useStore((s) => s.mihomeMode)
  const glassMode = useStore((s) => s.glassMode)
  const editingScreen = useStore((s) => s.editingScreen)
  const hoveredItem = useStore((s) => s.hoveredItem)
  const selectEffect = useStore((s) => s.selectEffect)
  const selectOutline = useStore((s) => s.selectOutline)
  const panelOpacity = useStore((s) => s.panelOpacity)
  const panelColor = useStore((s) => s.panelColor)
  const fpsMode = useStore((s) => s.fpsMode)
  const saveTimer = useRef(null)
  const fpsRef = useRef(null)

  // 窗帘实体状态同步：HA（小爱语音/HA 面板等外部控制）改变实体状态时，同步本地 curtainPos 让模型跟随。
  // ⚠️ 不是所有 cover 实体都有 current_position（百分比）属性——没有时按 state 判断：open=100 / closed=0。
  const syncCurtainFromHA = (states) => {
    if (!states) return
    const st = getState()
    let changed = false
    st.project.floors.forEach((fl) => {
      ;(fl.furniture || []).forEach((f) => {
        if (f.type === '窗帘' && f.entity_id && states[f.entity_id]) {
          const s = states[f.entity_id]
          let pos = null
          if (s.attributes && s.attributes.current_position != null) {
            pos = s.attributes.current_position
          } else if (s.state === 'open') {
            pos = 100
          } else if (s.state === 'closed') {
            pos = 0
          }
          if (pos != null && f.curtainPos !== pos) { f.curtainPos = pos; changed = true }
        }
      })
    })
    if (changed) setState({ project: { ...st.project } })
  }

  // FPS + 最大卡顿计数（直接写 DOM，不经过 React setState，避免每秒重渲染制造垃圾）
  useEffect(() => {
    let frames = 0
    let last = performance.now()
    let prev = performance.now()
    let maxGap = 0
    let raf
    const loop = (now) => {
      const gap = now - prev
      if (gap > maxGap) maxGap = gap
      prev = now
      frames++
      if (now - last >= 1000) {
        const f = Math.round(frames * 1000 / (now - last))
        const el = fpsRef.current
        if (el) {
          el.textContent = `${f} FPS · 卡顿 ${Math.round(maxGap)}ms`
          el.style.color = f >= 50 ? 'var(--ok)' : f >= 30 ? 'var(--accent2)' : 'var(--danger)'
        }
        frames = 0
        maxGap = 0
        last = now
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---------- 启动 ----------
  useEffect(() => {
    (async () => {
      loadCatalog().then((cat) => setState({ modelCatalog: cat }))  // 加载网上家具模型目录
      try {
        const settings = await api.settings()
        setState({
          settings,
          customViews: settings.customViews || [],
          quality: settings.quality || 'high',
          shadows: settings.shadows !== undefined ? settings.shadows : true,
          bloom: settings.bloom !== undefined ? settings.bloom : true,
          sunLight: settings.sunLight !== false,
          mihomeMode: settings.mihomeMode !== false,
          glassMode: settings.glassMode !== false,
          camFocusOnModel: settings.camFocusOnModel === true,
          smoothFocus: settings.smoothFocus === true,
          hoverTip: settings.hoverTip === true,
          clickToggleState: settings.clickToggleState !== false,
          selectEffect: settings.selectEffect || 'glow',
          selectOutline: settings.selectOutline || { width: 2, speed: 3.5, mode: 'frame', size: 0.18 },
          showStatusPulse: settings.showStatusPulse !== false,
          panelOpacity: settings.panelOpacity != null ? settings.panelOpacity : 0.96,
          panelColor: settings.panelColor || '#0d1526',
          autoRotate: !!settings.autoRotate,
          rotateDir: settings.rotateDir || 1,
          rotateSpeed: settings.rotateSpeed || 1,
          immersive: !!settings.immersive,
          night: !!settings.night,
          sunAuto: settings.sunAuto !== false,
          showWalls: settings.showWalls !== undefined ? settings.showWalls : true,
          showOpenings: settings.showOpenings !== undefined ? settings.showOpenings : true,
          showCeiling: settings.showCeiling !== undefined ? settings.showCeiling : true,
          showToolbar: settings.showToolbar !== undefined ? settings.showToolbar : true,
          showFps: settings.showFps !== undefined ? settings.showFps : true,
          roomBorderLines: settings.roomBorderLines !== false,
          roomBorderAlwaysVisible: settings.roomBorderAlwaysVisible === true,
          roomBorderSkipDoors: settings.roomBorderSkipDoors === true,
          sceneOpen: !!settings.defaultScene,
          roomNavOpen: !!settings.defaultRoomNav,
          bgImage: settings.bgImage || '',
          bgMode: settings.bgMode || 'color',
          bgColor: settings.bgColor || '#5278ae',
          bgGradient1: settings.bgGradient1 || '#253962',
          bgGradient2: settings.bgGradient2 || '#46618d',
          editorBgImage: settings.editorBgImage || '',
          editorBgMode: settings.editorBgMode || 'color',
          // 编辑器默认选项
          snap: settings.snap !== undefined ? settings.snap : true,
          showLabels: settings.showLabels !== undefined ? settings.showLabels : true,
          showFurnitureLabels: settings.showFurnitureLabels !== undefined ? settings.showFurnitureLabels : true,
          furnitureScale: settings.furnitureScale || 1,
          view2d: !!settings.defaultView2d,
        })
        // 默认全屏：打开即自动进入浏览器全屏
        if (settings.fullscreen) {
          try { document.documentElement.requestFullscreen?.() } catch (e) {}
        }
      } catch (e) { /* 本地开发 */ }
      try {
        const p = await api.project()
        if (p && Array.isArray(p.floors)) {
          // 无楼层时自动创建默认楼层（否则编辑器交互平面不渲染，画不了）
          if (p.floors.length === 0) {
            p.floors.push({
              id: Math.random().toString(36).slice(2, 10), name: '一层', level: 0,
              height: 2.8, color: '#e6dcc8', rooms: [], walls: [], furniture: [], devices: [], openings: [],
            })
          }
          // 迁移 + 一致化：墙是主数据，房间自动检测
          p.floors.forEach((f) => {
            // 旧数据：有房间但没墙 → 从房间多边形反推墙段
            if ((!f.walls || f.walls.length === 0) && (f.rooms || []).length > 0) {
              f.walls = roomsToWalls(f.rooms)
            }
            // 只要有墙，就重算房间；重算失败（返回空）但原本有房间时，保留原房间避免户型丢失
            if (f.walls && f.walls.length > 0) {
              const recomputed = recomputeRooms(f)
              if (recomputed.length > 0 || !(f.rooms && f.rooms.length > 0)) {
                f.rooms = recomputed
              }
            }
          })
          loadProject(p)
          setState({ currentFloor: 0 })
        }
      } catch (e) {}
      // 拉全量实体（绑定用）；只比较 entity_id 做指纹，变了才 setState（避免每 30s 无谓重渲染导致闪屏）
      const pollEntities = async () => {
        try {
          const ents = await api.entities()
          if (Array.isArray(ents)) {
            const fp = ents.map((e) => e.entity_id).sort().join(',')
            const prev = getState().haEntitiesFp
            if (prev !== fp) setState({ haEntities: ents, haEntitiesFp: fp, haConnected: true })
            else setState({ haConnected: true })
          }
        } catch (e) { setState({ haConnected: false }) }
      }
      pollEntities()
      setInterval(pollEntities, 30000)
      // 状态轮询（只比较 state 字段做轻量指纹，避免 JSON.stringify 大对象阻塞主线程导致卡顿）
      const stateFp = (o) => {
        if (!o) return ''
        let s = ''
        for (const k in o) { const v = o[k]; s += k + '=' + (v && v.state) + ';' }
        return s
      }
      const pollStates = async () => {
        try {
          const st = await api.states()
          if (st && typeof st === 'object') {
            const prev = getState().haStates
            if (!prev || stateFp(prev) !== stateFp(st)) {
              setState({ haStates: st, haConnected: true })
              syncCurtainFromHA(st)
            }
          }
        } catch (e) { setState({ haConnected: false }) }
      }
      pollStates()
      setInterval(pollStates, 5000)
      // WebSocket 实时推送（SSE）：后端连 HA WebSocket 订阅 state_changed，状态变化即时推下来；
      // EventSource 断了会自动重连，pollStates 每 5s 兜底。
      try {
        const es = new EventSource((BASE + 'api/ha/stream').replace(/\/{2,}/g, '/'))
        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data)
            if (msg.type === 'snapshot' && msg.states) {
              setState({ haStates: msg.states, haConnected: true })
              syncCurtainFromHA(msg.states)
            } else if (msg.type === 'state' && msg.entity_id) {
              const next = { ...getState().haStates }
              if (msg.new_state) next[msg.entity_id] = msg.new_state
              else delete next[msg.entity_id]
              setState({ haStates: next, haConnected: true })
              syncCurtainFromHA(next)
            } else if (msg.type === 'notification' && msg.message) {
              // HA 那边发通知（notify / 持久通知），app 里实时弹提示
              toast(String(msg.message))
            }
          } catch (e) { /* 忽略坏消息 */ }
        }
      } catch (e) { /* EventSource 不支持则只靠轮询 */ }
    })()
  }, [])

  // ---------- 自动保存 ----------
  useEffect(() => {
    const s = getState()
    if (s.saved) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await api.saveProject(getState().project)
        setState({ saved: true })
      } catch (e) { /* 静默 */ }
    }, 800)
  }, [project])

  // 保存当前相机视角为「设备聚焦视角」（永久保存；点击绑定模型时用它跳转，可随时重新保存覆盖）
  const saveDeviceView = () => {
    const cam = window.__cam3d
    if (!cam || !cam.pos || !cam.target) { toast('相机还没就绪'); return }
    const s = { ...getState().settings, deviceView: { pos: [...cam.pos], target: [...cam.target] } }
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
    toast('设备视角已保存')
  }
  const clearDeviceView = () => {
    const s = { ...getState().settings }
    delete s.deviceView
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
    toast('已清除设备视角')
  }

  // 全部显示：清聚焦 + 按整个户型包围盒居中。
  // 不能只靠 recenterKey（CameraFocus 只设 camera.position/lookAt，OrbitControls 的 target 不更新、
  // 下一帧 update 又把相机朝向拽回之前聚焦的房间中心），要像 focusRoom 一样直接设 camTarget + camViewSignal。
  const focusAll = useCallback(() => {
    const st = getState()
    const fl = st.project.floors[currentFloor] || {}
    const rooms = fl.rooms || []
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    const add = (x, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z) }
    if (rooms.length) {
      rooms.forEach((r) => (r.points || []).forEach((p) => add(p[0], p[1])))
    } else {
      ;(fl.walls || []).forEach((w) => { add(w.start[0], w.start[1]); add(w.end[0], w.end[1]) })
    }
    ;(fl.furniture || []).forEach((f) => add(f.pos[0], f.pos[2]))
    if (!isFinite(minX)) { setState({ focusRoomId: null, selected: null, wallSel: [], recenterKey: st.recenterKey + 1 }); return }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
    const floorH = fl.height || 2.8
    const dist = Math.max(9.5, (maxX - minX) * 1.42, (maxZ - minZ) * 1.7, floorH * 1.3)
    setState({ focusRoomId: null, selected: null, wallSel: [], camTarget: [cx, 0.55, cz], camDist: dist, camViewSignal: { type: 'default', n: st.camViewSignal.n + 1 } })
  }, [currentFloor])

  // ---------- 选择/删除处理 ----------
  const handleSelect = useCallback((sel) => {
    const st = getState()
    if (st.tool === 'delete') {
      // 删除模式：点谁删谁
      const floor = st.project.floors[st.currentFloor]
      if (sel.type === 'room') floor.rooms = floor.rooms.filter((r) => r.id !== sel.ref.id)
      else if (sel.type === 'furniture') floor.furniture = floor.furniture.filter((f) => f.id !== sel.ref.id)
      else if (sel.type === 'device') floor.devices = floor.devices.filter((d) => d.id !== sel.ref.id)
      else if (sel.type === 'opening') floor.openings = (floor.openings || []).filter((o) => o.id !== sel.ref.id)
      else if (sel.type === 'wall' && sel.index != null) {
        floor.walls.splice(sel.index, 1)
        floor.rooms = recomputeRooms(floor)
      }
      setState({ project: { ...st.project }, saved: false, selected: null })
      toast('已删除')
      return
    }
    if (!editing) {
      // 点击空白处（3D 场景没点到任何东西）：
      //   房间导航选了房间（focusRoomId 非空）→ 回到该房间的居中（不是整个户型）；
      //   只开「模型聚焦」→ 关面板 + 整体居中；
      //   都不开 → 保持原状态（不居中、不关面板）
      if (!sel) {
        if (st.focusRoomId != null) {
          setDeviceModal(null)
          const fl = st.project.floors[st.currentFloor] || {}
          const room = (fl.rooms || []).find((r) => r.id === st.focusRoomId)
          if (room && room.points && room.points.length) {
            if (room.lockedView && room.lockedView.pos && room.lockedView.target) {
              setState({ roomView: room.lockedView, camViewSignal: { type: 'roomview', n: st.camViewSignal.n + 1 } })
            } else {
              let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0
              room.points.forEach((p) => { cx += p[0]; cz += p[1]; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]) })
              cx /= room.points.length; cz /= room.points.length
              const roomH = room.height || fl.height || 2.8
              const dist = Math.max(2.5, (maxX - minX) * 1.6, (maxZ - minZ) * 1.8, roomH * 2)
              setState({ camTarget: [cx, 0.55, cz], camDist: dist, camViewSignal: { type: 'default', n: st.camViewSignal.n + 1 } })
            }
          } else {
            focusAll()
          }
          return
        }
        // 只开「模型聚焦」：点空白 → 关面板 + 整体居中
        if (getState().camFocusOnModel === true) { setDeviceModal(null); focusAll(); return }
        // 都不开：点空白保持原状态（不居中、不关面板）
        return
      }
      // 点击任何模型/设备时（开关「模型聚焦」开）相机聚焦：优先用该模型自己保存的视角，没保存就默认放大
      // ⚠️ 读顶层 camFocusOnModel（设置面板 saveDefault 和底部工具栏按钮都改它），别读 settings 对象——工具栏按钮只改顶层，读 settings 会导致「关了开关还放大」
      const camFocus = getState().camFocusOnModel === true
      if (camFocus && sel && (sel.type === 'furniture' || sel.type === 'device')) {
        const v = sel.ref.view
        const st = getState()
        if (v && v.pos && v.target) {
          setState({ roomView: v, camViewSignal: { type: 'roomview', n: st.camViewSignal.n + 1 } })
        } else {
          const p = sel.ref.pos || [0, 1, 0]
          // 默认放大：相机离模型稍远从斜上方看（太近会跳进墙里黑屏）
          setState({ camTarget: [p[0], Math.max(1.5, (p[1] || 0) + 1.5), p[2]], camDist: 4, camViewSignal: { type: 'default', n: st.camViewSignal.n + 1 } })
        }
      }
      // 主界面点击设备/模型 → 右侧弹窗（视角保存/删除 + 绑定实体则控制）；同时选中它（点空白时据此判断聚焦、退出聚焦整体居中）
      if (sel && sel.type === 'device') {
        setState({ selected: sel })
        setDeviceModal(sel.ref)
        return
      }
      if (sel && sel.type === 'furniture') {
        setState({ selected: sel })
        setDeviceModal(sel.ref)
        return
      }
      // 点击门洞（opening 门）→ 弹窗（门控制：开门/关门）
      if (sel && sel.type === 'opening' && sel.ref && sel.ref.doorStyle) {
        setState({ selected: sel })
        setDeviceModal(sel.ref)
        return
      }
      // 缩放区域：查看态点房间 → 相机飞到房间中心（预设 iso 视角）
      if (sel && sel.type === 'room' && sel.ref.points && sel.ref.points.length) {
        const s2 = getState()
        // 面板开着（点过家具/设备）时点房间（地板）：
        //   开了「模型聚焦」→ 视为点空白 → 关面板 + 整体居中；
        //   不开 → 保持原状态（不聚焦房间，面板留着）
        if (s2.deviceModal) {
          if (s2.camFocusOnModel === true) {
            setDeviceModal(null)
            focusAll()
          }
          return
        }
        const pts = sel.ref.points
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0
        pts.forEach((p) => { cx += p[0]; cz += p[1]; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]) })
        cx /= pts.length; cz /= pts.length
        const roomH = (sel.ref && sel.ref.height) || (st.project.floors[st.currentFloor] || {}).height || 2.8
        // 同时按地板宽高 + 房间 3D 高度算距离（对齐原版 floorH*1.3），否则小房间的墙会超出屏幕
        const dist = Math.max(2.5, (maxX - minX) * 1.6, (maxZ - minZ) * 1.8, roomH * 2)
        setState({ selected: sel, wallSel: [], camTarget: [cx, 0.55, cz], camDist: dist, camViewSignal: { type: 'default', n: st.camViewSignal.n + 1 } })
        return
      }
      setState({ selected: sel, wallSel: [] })
    } else {
      setState({ selected: sel, wallSel: [] })
    }
  }, [editing, focusAll])

  // ---------- 房间导航（左侧面板：全部 + 各房间，点击只显示该房间并居中） ----------
  const focusRoom = (room) => {
    const st = getState()
    setState({ focusRoomId: room ? room.id : null })
    const pts = room && room.points
    if (!pts || !pts.length) return
    // 有锁定视角就用锁定视角，否则按包围盒默认居中
    if (room.lockedView && room.lockedView.pos && room.lockedView.target) {
      setState({ roomView: room.lockedView, camViewSignal: { type: 'roomview', n: st.camViewSignal.n + 1 } })
      return
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0
    pts.forEach((p) => { cx += p[0]; cz += p[1]; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]) })
    cx /= pts.length; cz /= pts.length
    const roomH = (room && room.height) || (project.floors[currentFloor] || {}).height || 2.8
    // 同时按地板宽高 + 房间 3D 高度算距离（对齐原版 floorH*1.3），否则小房间的墙会超出屏幕
    const dist = Math.max(2.5, (maxX - minX) * 1.6, (maxZ - minZ) * 1.8, roomH * 2)
    setState({ camTarget: [cx, 0.55, cz], camDist: dist, camViewSignal: { type: 'default', n: st.camViewSignal.n + 1 } })
  }
  // 锁定当前视角到房间（下次点房间就跳这个视角）
  const lockRoomView = (room) => {
    const cam = window.__cam3d
    if (!cam || !cam.pos || !cam.target) { toast('相机还没就绪'); return }
    const fl = getState().project.floors[currentFloor]
    const target = (fl.rooms || []).find((r) => r.id === room.id)
    if (!target) return
    target.lockedView = { pos: [...cam.pos], target: [...cam.target] }
    setState({ project: { ...getState().project }, saved: false })
    toast(`已锁定「${target.name || '房间'}」视角`)
  }
  const navRooms = (project.floors[currentFloor] || {}).rooms || []
  const focusedRoom = focusRoomId ? navRooms.find((r) => r.id === focusRoomId) : null

  // 点铅笔 → 进入 2D 编辑并选中该房间（改颜色/透明度用右侧属性面板）。
  // 同时设 focusRoomId=该房间，编辑期间切 3D、以及退出编辑后，3D 都聚焦在这个房间（单房间隔离显示）
  const editRoom = (room) => setState({ editing: true, view2d: true, selected: { type: 'room', ref: room }, focusRoomId: room.id, roomNavOpen: false, roomEditId: room.id })

  // ---------- 设备控制 ----------
  const refreshStates = () => setTimeout(async () => {
    try { setState({ haStates: await api.states() }) } catch (e) {}
  }, 800)
  // 保存当前相机视角到当前模型（deviceModal）——下次点这个模型就用这个视角
  const saveModelView = () => {
    const cam = window.__cam3d
    if (!cam || !cam.pos || !cam.target || !deviceModal) { toast('相机还没就绪'); return }
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    const target = (fl.furniture || []).find((f) => f.id === deviceModal.id) || (fl.devices || []).find((d) => d.id === deviceModal.id)
    if (!target) return
    target.view = { pos: [...cam.pos], target: [...cam.target] }
    setState({ project: { ...st.project }, saved: false })
    toast('已保存该模型视角')
  }
  // 删除当前模型的视角（恢复默认放大）
  const deleteModelView = () => {
    if (!deviceModal) return
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    const target = (fl.furniture || []).find((f) => f.id === deviceModal.id) || (fl.devices || []).find((d) => d.id === deviceModal.id)
    if (!target) return
    delete target.view
    setState({ project: { ...st.project }, saved: false })
    toast('已删除该模型视角')
  }

  const toggleDevice = async (dev) => {
    const domain = dev.entity_id.split('.')[0]
    await api.service(domain, 'toggle', dev.entity_id)
    refreshStates()
    toast(`已发送 ${dev.name} 切换指令`)
  }
  // Climate control: set target temperature
  const setTemperature = async (dev, temp) => {
    await api.service('climate', 'set_temperature', dev.entity_id, { temperature: temp })
    refreshStates()
  }
  // Climate control: set HVAC mode (cool/heat/auto/fan_only/dry/off)
  const setHvacMode = async (dev, mode) => {
    await api.service('climate', 'set_hvac_mode', dev.entity_id, { hvac_mode: mode })
    refreshStates()
  }
  // 立即保存（不等 auto-save，避免调整后立刻刷新丢改动）
  const saveProjectNow = () => { api.saveProject(getState().project).catch(() => {}) }
  // 只有电视类模型（type 含「电视」或画面已打开）才显示「打开/关闭电视」+「编辑画面」
  const isTvModel = (dev) => dev && ((dev.type && String(dev.type).includes('电视')) || !!(dev.screen && dev.screen.on))
  // 模型重命名
  const renameModel = (dev) => {
    const newName = window.prompt('给这个模型起个名字：', dev.name || dev.type || '')
    if (newName == null || !newName.trim()) return
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    const target = (fl.furniture || []).find((f) => f.id === dev.id) || (fl.devices || []).find((d) => d.id === dev.id)
    if (!target) return
    target.name = newName.trim()
    setState({ project: { ...st.project }, saved: false })
    saveProjectNow()
    toast('已重命名')
  }
  // 电视/屏幕画面开关：打开=播放内置视频，关闭=暂停画面（item.screen 存进项目数据）
  const toggleTv = (dev) => {
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    const target = (fl.furniture || []).find((f) => f.id === dev.id) || (fl.devices || []).find((d) => d.id === dev.id)
    if (!target) return
    const next = { on: !(target.screen && target.screen.on), video: (target.screen && target.screen.video) || DEFAULT_TV_VIDEO }
    target.screen = next
    setState({ project: { ...st.project }, saved: false })
    saveProjectNow()
    toast(next.on ? '📺 已打开电视画面' : '📺 电视已关闭')
  }
  // 画面参数更新（编辑画面模式：位置 X/Y/Z 偏移 + 大小，微调按钮或 3D 手柄拖拽）
  const updateScreen = (dev, patch) => {
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    const target = (fl.furniture || []).find((f) => f.id === dev.id) || (fl.devices || []).find((d) => d.id === dev.id)
    if (!target) return
    target.screen = { ...(target.screen || { video: DEFAULT_TV_VIDEO, on: true }), ...patch }
    setState({ project: { ...st.project }, saved: false })
    saveProjectNow()
  }
  // 门开关：开门/关门（弹窗按钮控制，模型立即切换 + 保存；支持家具门 + 门洞 opening）
  const toggleDoor = (dev) => {
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    const target = (fl.furniture || []).find((f) => f.id === dev.id) || (fl.openings || []).find((o) => o.id === dev.id)
    if (!target) return
    target.doorOpen = !target.doorOpen
    setState({ project: { ...st.project }, saved: false })
    saveProjectNow()
    toast(target.doorOpen ? '🚪 门已打开' : '🚪 门已关闭')
  }
  // 第一人称初始位置：保存当前相机位置/朝向，进入第一人称时放这里
  const saveFpsStart = () => {
    const cam = window.__cam3d
    const st = getState()
    const pos = cam && cam.pos ? cam.pos : null
    if (!pos) { toast('相机还没就绪'); return }
    const yaw = window.__camera ? window.__camera.rotation.y : 0
    const s = { ...st.settings, fpsStart: { pos: [...pos], yaw, pitch: 0 } }
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
    toast('已保存第一人称初始位置')
  }
  const clearFpsStart = () => {
    const st = getState()
    const s = { ...st.settings }
    delete s.fpsStart
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
    toast('已清除初始位置')
  }
  // 窗帘参数更新（宽/长/颜色，点窗帘后面板可调）
  const updateCurtain = (dev, patch) => {
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    const target = (fl.furniture || []).find((f) => f.id === dev.id)
    if (!target) return
    if (patch.params) target.params = { ...(target.params || {}), ...patch.params }
    if (patch.width != null) target.width = patch.width
    if (patch.height != null) target.height = patch.height
    if (patch.curtainPos != null) target.curtainPos = patch.curtainPos
    setState({ project: { ...st.project }, saved: false })
    saveProjectNow()
  }
  // 灯：调亮度 / 色温 / 颜色（data 直接透传给 light.turn_on）
  const lightControl = async (dev, data) => {
    await api.service('light', 'turn_on', dev.entity_id, data)
    refreshStates()
  }
  // 窗帘：开 / 关 / 停 / 百分比（data 透传 set_cover_position 的 position）
  const coverControl = async (dev, action, data) => {
    await api.service('cover', action, dev.entity_id, data)
    // 同步本地窗帘状态（模型立即跟随，不等 HA 轮询）：开=100 关=0 百分比=data.position
    if (dev.type === '窗帘') {
      const st = getState()
      const fl = st.project.floors[st.currentFloor]
      const target = (fl.furniture || []).find((f) => f.id === dev.id)
      if (target) {
        if (action === 'open_cover') target.curtainPos = 100
        else if (action === 'close_cover') target.curtainPos = 0
        else if (action === 'set_cover_position' && data && data.position != null) target.curtainPos = Number(data.position)
        setState({ project: { ...st.project }, saved: false })
        saveProjectNow()
      }
    }
    refreshStates()
  }
  // 场景激活（对标 JMGLink：执行中 + 刚刚执行状态）
  const activateScene = async (entity_id) => {
    setRunningSceneId(entity_id)
    try {
      await api.service('scene', 'turn_on', entity_id)
    } catch (e) {
      toast('场景执行失败')
    } finally {
      setTimeout(() => {
        setRunningSceneId(null)
        setLastSceneId(entity_id)
      }, 800)
    }
  }
  // 通知：拉取 / 关闭
  const loadNotifications = async () => {
    try {
      const r = await api.notifications()
      setNotifications(r.notifications || [])
    } catch (e) { setNotifications([]) }
  }
  const dismissNotification = async (nid) => {
    await api.notificationDismiss(nid)
    loadNotifications()
  }

  // 保存默认选项到 settings（持久化，下次打开生效）——同时更新 store 顶层状态（改完立即生效）
  const saveDefault = (patch) => {
    const s = { ...getState().settings, ...patch }
    setState({ settings: s, ...patch })
    api.saveSettings(s).catch(() => {})
  }
  // 保存描边配置（宽度/呼吸速度/位置/大小）
  const saveSelectOutline = (patch) => {
    const next = { ...(getState().selectOutline || {}), ...patch }
    setState({ selectOutline: next })
    api.saveSettings({ ...getState().settings, selectOutline: next }).catch(() => {})
  }

  // 米家模式：渲染层覆盖开关（开/关），存 settings 持久化（不改数据、刷新后状态还在）
  const setMiHome = (v) => {
    setState({ mihomeMode: v })
    api.saveSettings({ ...getState().settings, mihomeMode: v }).catch(() => {})
  }
  const setGlass = (v) => {
    setState({ glassMode: v })
    api.saveSettings({ ...getState().settings, glassMode: v }).catch(() => {})
  }

  // 背景图：加载列表 / 选中 / 删除
  const loadBgImages = async () => {
    try {
      const r = await api.backgrounds()
      setBgImages(r.images || [])
    } catch (e) { setBgImages([]) }
  }
  const selectBg = (name) => {
    setState({ bgImage: name, bgMode: 'image' })
    api.saveSettings({ ...getState().settings, bgImage: name, bgMode: 'image' }).catch(() => {})
  }
  const deleteBg = async (name) => {
    if (!confirm('删除这张背景图？')) return
    try {
      await api.backgroundDelete(name)
      if (getState().bgImage === name) setState({ bgImage: '', bgMode: 'color' })
      loadBgImages()
    } catch (e) { toast('删除失败') }
  }
  useEffect(() => {
    if (settingsOpen) loadBgImages()
  }, [settingsOpen])
  useEffect(() => {
    if (notifOpen) loadNotifications()
  }, [notifOpen])
  // 通知面板：点空白处 / 切换其它按钮时自动收起（点通知面板内或通知按钮本身不关）
  useEffect(() => {
    if (!notifOpen) return
    const onDown = (e) => {
      const t = e.target
      if (t && t.closest && (t.closest('.notif-panel') || t.closest('.notif-btn'))) return
      setState({ notifOpen: false })
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [notifOpen])

  // 房间导航面板：和场景弹窗一致——点「房间」按钮本身 toggle 开关，点击空白/其它按钮都不收回

  // 设备控制面板：不再用 mousedown 监听关面板（拖拽旋转视角时按下也会触发 → 弹窗被误关）。
  // 关闭只由「点击空白」（handleSelect(null)，带拖拽 delta 过滤）和面板内「关闭」按钮触发。
  // 调整角度/拖拽视角时弹窗保持不动，只有点其它模型或空白处才收起。

  // 进编辑界面：关闭所有主界面弹窗（模型面板/设置/场景/通知/设备列表/绑定/画面编辑），编辑态不应残留主界面 UI
  useEffect(() => {
    if (!editing) return
    setDeviceModal(null)
    setState({ settingsOpen: false, sceneOpen: false, notifOpen: false, deviceListOpen: false, bindOpen: false, editingScreen: false })
  }, [editing])

  // 设置面板：点空白处收回（点设置面板内或设置按钮本身不关）
  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e) => {
      const t = e.target
      if (t && t.closest && (t.closest('.settings-panel') || t.closest('.settings-btn'))) return
      setState({ settingsOpen: false })
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [settingsOpen])

  // 太阳（sun.sun）：自动切日夜 + 日照高度角（要放在 useEffect 之前，否则 TDZ 报错）
  const sunEnt = (haEntities || []).find(e => e.entity_id === 'sun.sun')
  // 自动跟随太阳切日夜（sun.sun；手动切日夜时关掉 sunAuto）
  useEffect(() => {
    window.__nightDebug = { night: getState().night, sunAuto: getState().sunAuto, sunEnt: !!sunEnt, sunState: sunEnt && sunEnt.state, sunElev: sunEnt && sunEnt.attributes && sunEnt.attributes.elevation }
    if (!sunEnt || !getState().sunAuto) return
    const elev = sunEnt.attributes && sunEnt.attributes.elevation != null ? Math.round(Number(sunEnt.attributes.elevation)) : null
    // 用 elevation 判断日夜：elevation >= -6 算日间（含黎明/黄昏曙光——天亮了就是白天，别用 state 否则太阳没完全升起时误判夜间）
    const below = elev != null ? elev < -6 : sunEnt.state !== 'above_horizon'
    if (getState().night !== below) setState({ night: below })
    if (elev != null && getState().sunElevation !== elev) setState({ sunElevation: elev })
  }, [sunEnt && sunEnt.state, sunEnt && sunEnt.attributes && sunEnt.attributes.elevation])

  // ---------- 3D 导出（分享 tab） ----------
  const export3DPng = (count = 1) => {
    const canvas = document.querySelector('.canvas-wrap canvas')
    if (!canvas) return toast('请先在 3D 视图')
    const snap = (i) => {
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = count <= 1 ? '户型3D.png' : `户型3D_${i}.png`
      a.click()
    }
    if (count <= 1) { snap(1); return }
    const wasRotating = getState().autoRotate
    setState({ autoRotate: true, rotateSpeed: 3 })
    toast(`正在截取 ${count} 张不同角度…`)
    let n = 0
    const timer = setInterval(() => {
      snap(n + 1)
      n++
      if (n >= count) {
        clearInterval(timer)
        if (!wasRotating) setState({ autoRotate: false })
        toast(`已导出 ${count} 张截图`)
      }
    }, 900)
  }
  const record3DVideo = (seconds = 6) => {
    const canvas = document.querySelector('.canvas-wrap canvas')
    if (!canvas) return toast('请先在 3D 视图')
    if (typeof MediaRecorder === 'undefined') return toast('浏览器不支持录制')
    const isMp4 = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/mp4')
    const mime = isMp4 ? 'video/mp4' : 'video/webm'
    const ext = isMp4 ? 'mp4' : 'webm'
    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: mime })
    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `户型3D.${ext}`
      a.click()
      toast('3D 视频已导出')
    }
    recorder.start()
    const wasRotating = getState().autoRotate
    setState({ autoRotate: true })
    toast(`正在录制 ${seconds} 秒旋转视频…`)
    setTimeout(() => { recorder.stop(); if (!wasRotating) setState({ autoRotate: false }) }, seconds * 1000)
  }

  // ---------- 键盘快捷键 ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // ESC：退出编辑 + 清选中/弹窗（画墙草稿由 PlanEditor 自身管理，随卸载清空）
        setDeviceModal(null)
        setState((s) => ({ editing: false, bindOpen: false, pendingEntity: null, selected: null, view2d: false, settingsOpen: false, tool: 'select', focusRoomId: s.roomEditId, roomEditId: null }))
      }
      // 工具快捷键 V/M/G/H/W/D/N/F/E/B
      const map = { v: 'select', m: 'move', g: 'movePlan', h: 'browse', w: 'wall', d: 'door', n: 'window', x: 'cut', f: 'furniture', e: 'device', b: 'texture' }
      if (map[e.key.toLowerCase()] && editing) {
        setState({ tool: map[e.key.toLowerCase()] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const devState = deviceModal && deviceModal.entity_id ? haStates[deviceModal.entity_id] : null
  // 场景列表（scene.* 实体）+ 当前选中设备属性
  const scenes = (haEntities || []).filter(e => e.entity_id.startsWith('scene.'))
  const devAttrs = devState && devState.attributes ? devState.attributes : {}
  // ⚠️ entity_id 可能为空（未绑定设备的家具/模型被点击弹面板）——split 前必须先判空，否则 null.split 抛错 → React 整个应用卸载黑屏
  const devDomain = deviceModal && deviceModal.entity_id ? deviceModal.entity_id.split('.')[0] : ''
  // 设备类型图标/名称（弹窗头部 + 摘要卡片）
  const DOMAIN_ICON = { light: '💡', cover: '🪟', fan: '🌀', media_player: '📺', sensor: '🌡️', switch: '🔌', climate: '❄️', camera: '📷', humidifier: '💨' }
  const DOMAIN_NAME = { light: '灯', cover: '窗帘', fan: '风扇', media_player: '媒体', sensor: '传感器', switch: '开关', climate: '空调', camera: '摄像头', humidifier: '加湿器' }
  const devIcon = DOMAIN_ICON[devDomain] || '🔹'
  const devTypeName = DOMAIN_NAME[devDomain] || devDomain || '未绑定'
  // 弹窗统一卡片/按钮样式（暗色毛玻璃风格）
  const panelCard = { padding: '13px 15px', borderRadius: 14, marginBottom: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }
  const hexToRgba = (hex, a) => { const h = (hex || '#0d1526').replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return `rgba(${r},${g},${b},${a})` }
  // 第一人称虚拟方向键（手机/平板屏幕按键 + 桌面鼠标，按住移动；派发键盘事件让 Controls 移动）
  const FpsBtn = ({ k, children }) => {
    const press = (e) => { e.preventDefault(); e.stopPropagation(); setState((s) => ({ fpsKeys: { ...s.fpsKeys, [k]: true } })); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })) }
    const release = () => { setState((s) => ({ fpsKeys: { ...s.fpsKeys, [k]: false } })); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })) }
    return (
      <button
        onMouseDown={press}
        onMouseUp={release}
        onMouseLeave={release}
        onTouchStart={press}
        onTouchEnd={release}
        onTouchCancel={release}
        style={{ width: 58, height: 58, borderRadius: 16, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: 22, cursor: 'pointer', touchAction: 'none', userSelect: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >{children}</button>
    )
  }
  const cardTitle = { fontSize: 12, color: 'rgba(230,235,245,0.55)', marginBottom: 8, fontWeight: 700, letterSpacing: '0.03em' }
  const panelBtn = { padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#e6ebf5', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s ease' }
  const panelBtnPrimary = { ...panelBtn, background: 'rgba(90,162,255,0.2)', borderColor: 'rgba(90,162,255,0.4)', color: '#5aa2ff' }
  const panelBtnDanger = { ...panelBtn, background: 'rgba(255,107,107,0.15)', borderColor: 'rgba(255,107,107,0.3)', color: '#ff6b6b' }
  // 天气 + 温度（左上角信息）
  const WEATHER_ICON = { sunny: '☀️', 'clear-night': '🌙', partlycloudy: '⛅', cloudy: '☁️', rainy: '🌧️', pouring: '🌧️', snowy: '❄️', snowyrainy: '🌨️', lightning: '⛈️', fog: '🌫️', windy: '💨', hail: '🌨️' }
  const weatherEnt = (haEntities || []).find(e => e.entity_id.startsWith('weather.'))
  const weatherSt = weatherEnt ? haStates[weatherEnt.entity_id] : null
  const tempEnt = (haEntities || []).find(e => e.entity_id.startsWith('sensor.') && (e.attributes?.device_class === 'temperature' || /temperature|temp|_temp|温度/.test(e.entity_id)))
  const tempSt = tempEnt ? haStates[tempEnt.entity_id] : null

  return (
    <div className={`app ${settingsOpen ? 'settings-open' : ''}`} onDoubleClick={() => immersive && setState({ immersive: false })}>
      {view2d ? <PlanEditor onSelect={handleSelect} floorIndex={currentFloor} /> : <Viewer onSelect={handleSelect} floorIndex={currentFloor} />}

      {/* 左上角状态（沉浸模式隐藏）：HA 连接状态（闪烁绿点）+ 房间数 + 天气 + 温度 + 帧率 */}
      {!immersive && <div className="status-tl">
        <span className="dot blink" style={{ background: haConnected ? 'var(--ok)' : 'var(--danger)' }} />
        <span>{haConnected ? 'Home Assistant 已连接' : 'Home Assistant 未连接'}</span>
        <span style={{ color: 'var(--accent2)' }}>
          {editing ? `房间 ${project.floors.reduce((n, f) => n + (f.rooms || []).length, 0)} 个` : ''}
        </span>
        {weatherSt && (
          <span>{(WEATHER_ICON[weatherSt.state] || '🌡️')} {weatherSt.state}</span>
        )}
        {tempSt && (
          <span>🌡️ {tempSt.state}{tempSt.attributes?.unit_of_measurement || '°C'}</span>
        )}
        {showFps && <span ref={fpsRef} style={{ fontSize: '14px', fontWeight: 700 }} />}
      </div>}

      {!immersive && showToolbar && <BottomBar />}

      {/* 房间导航面板（左侧，样式对齐原版楼层切换：全部 + 各房间，点击只显示该房间并居中） */}
      {!immersive && roomNavOpen && !view2d && !editing && (
        <div className="room-nav" data-room-nav="1">
          <div className="room-nav-head">房间</div>
          <button className={`room-nav-item ${focusRoomId === null ? 'active' : ''}`} onClick={focusAll}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
            <span>全部</span>
          </button>
          {navRooms.map((r, i) => (
            <div key={r.id} className="room-nav-row">
              <button className={`room-nav-item ${focusRoomId === r.id ? 'active' : ''}`} onClick={() => focusRoom(r)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" /></svg>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || `房间${i + 1}`}</span>
              </button>
              <button className={`room-lock ${r.lockedView ? 'locked' : ''}`} onClick={() => lockRoomView(r)} title={r.lockedView ? '已锁定视角，点重新锁定' : '锁定当前视角'}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </button>
              <button className={`room-lock ${roomEditId === r.id ? 'locked' : ''}`} onClick={() => editRoom(r)} title="编辑房间（改颜色/透明度）">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
            </div>
          ))}
          {navRooms.length === 0 && <p className="room-nav-empty">还没有房间</p>}
        </div>
      )}

      {editing && <Editor />}

      {bindOpen && <BindDrawer />}

      {deviceListOpen && <DeviceList />}

      {/* 设备控制面板（暗色毛玻璃风格） */}
      {deviceModal && (
        <div className="side-panel device-panel" style={{
          background: 'rgba(18,26,46,0.92)',
          borderRadius: 18,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderLeft: '1px solid rgba(255,255,255,0.12)',
          backdropFilter: 'blur(24px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
        }}>
          {/* 头部：返回 + 设备类型 + 名称 + 状态 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', marginBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <button onClick={() => setDeviceModal(null)} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#e6ebf5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>←</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: 'rgba(230,235,245,0.45)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>已连接设备</div>
              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3, color: '#e6ebf5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deviceModal.name || deviceModal.entity_id || '模型'}</div>
              <div style={{ fontSize: 9, color: 'rgba(230,235,245,0.35)', marginTop: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{devState ? (devState.state === 'on' || devState.state === 'open' ? '已开启' : devState.state === 'off' || devState.state === 'closed' ? '已关闭' : devState.state) : '未连接'}</div>
            </div>
          </div>

          {/* 摘要卡片：状态 + 类型 + 位置 */}
          <div style={{ padding: '12px 16px', borderRadius: 14, margin: '0 0 12px', fontSize: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
              <span style={{ color: 'rgba(230,235,245,0.5)' }}>状态</span>
              <span style={{ fontWeight: 600, color: devState && (devState.state === 'on' || devState.state === 'open') ? '#2ecc71' : '#e6ebf5' }}>
                {devState ? (devState.state === 'on' ? '已开启' : devState.state === 'off' ? '已关闭' : devState.state === 'open' ? '已打开' : devState.state === 'closed' ? '已关闭' : devState.state) : '未知'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
              <span style={{ color: 'rgba(230,235,245,0.5)' }}>类型</span>
              <span style={{ color: '#e6ebf5' }}>{devIcon} {devTypeName}</span>
            </div>
            {deviceModal.pos && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                <span style={{ color: 'rgba(230,235,245,0.5)' }}>位置</span>
                <span style={{ color: '#e6ebf5' }}>({deviceModal.pos[0].toFixed(1)}, {deviceModal.pos[2].toFixed(1)})</span>
              </div>
            )}
          </div>

          {/* 空调专属：温度摘要 + 模式 + 开关 */}
          {devDomain === 'climate' && (() => {
            const hvacMode = devAttrs.hvac_mode || 'off'
            const curTemp = devAttrs.current_temperature != null ? devAttrs.current_temperature : '—'
            const targetTemp = devAttrs.temperature != null ? devAttrs.temperature : 16
            const HVAC_LABELS = { cool: '制冷', heat: '制热', auto: '自动', fan_only: '送风', dry: '除湿', off: '关闭' }
            const HVAC_MODES = ['cool', 'fan_only', 'off', 'auto', 'heat', 'dry']
            return (
              <>
                {/* 温度摘要（三格） */}
                <div style={{ display: 'flex', gap: 8, margin: '0 0 12px' }}>
                  {[['当前', curTemp + '°C', '🌡️'], ['目标', targetTemp + '°C', '🎯'], ['模式', HVAC_LABELS[hvacMode] || hvacMode, '⚙️']].map(([label, value, icon]) => (
                    <div key={label} style={{ flex: 1, padding: '10px 8px', borderRadius: 12, textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: 10, color: 'rgba(230,235,245,0.45)', marginBottom: 4 }}>{icon} {label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#e6ebf5' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* 开关按钮组 */}
                <div style={{ ...panelCard }}>
                  <div style={cardTitle}>开关</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={{ ...panelBtnPrimary, flex: 1 }} onClick={() => setHvacMode(deviceModal, hvacMode === 'off' ? 'cool' : 'off')}>
                      ⏻ {hvacMode === 'off' ? '启动' : '关闭'}
                    </button>
                    <button style={{ ...panelBtn, flex: 1 }} onClick={() => toggleDevice(deviceModal)}>🔄 切换</button>
                  </div>
                </div>

                {/* 目标温度滑块 */}
                <div style={{ ...panelCard }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={cardTitle}>目标温度</span>
                    <span style={{ fontSize: 11, color: 'rgba(230,235,245,0.4)' }}>16°C – 30°C</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: 'rgba(230,235,245,0.5)' }}>🌡️</span>
                    <input type="range" min="16" max="30" step="1" style={{ flex: 1, accentColor: '#5aa2ff', height: 4 }}
                      value={targetTemp}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setTemperature(deviceModal, v)
                      }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#5aa2ff', minWidth: 36, textAlign: 'right' }}>{targetTemp}°C</span>
                  </div>
                </div>

                {/* 运行模式按钮网格 */}
                <div style={{ ...panelCard }}>
                  <div style={cardTitle}>运行模式</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {HVAC_MODES.map((m) => {
                      const active = hvacMode === m
                      return (
                        <button key={m} onClick={() => setHvacMode(deviceModal, m)}
                          style={{ padding: '10px 0', borderRadius: 10, border: active ? '1px solid rgba(90,162,255,0.5)' : '1px solid rgba(255,255,255,0.1)',
                            background: active ? 'rgba(90,162,255,0.2)' : 'rgba(255,255,255,0.06)',
                            color: active ? '#5aa2ff' : 'rgba(230,235,245,0.7)', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500,
                            transition: 'all 0.15s ease' }}>
                          {HVAC_LABELS[m]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )
          })()}

          {/* 操作按钮（非空调设备通用） */}
          {devDomain !== 'climate' && (
            <div style={{ ...panelCard }}>
              <div style={cardTitle}>操作</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {isTvModel(deviceModal) && (
                  <>
                    <button style={{ ...panelBtnPrimary, background: deviceModal.screen && deviceModal.screen.on ? 'rgba(255,107,107,0.15)' : 'rgba(90,162,255,0.2)', borderColor: deviceModal.screen && deviceModal.screen.on ? 'rgba(255,107,107,0.3)' : 'rgba(90,162,255,0.4)', color: deviceModal.screen && deviceModal.screen.on ? '#ff6b6b' : '#5aa2ff' }} onClick={() => toggleTv(deviceModal)} title="打开/关闭电视画面">
                      {deviceModal.screen && deviceModal.screen.on ? '📺 关闭电视' : '📺 打开电视'}
                    </button>
                    <button style={{ ...panelBtn, background: editingScreen ? 'rgba(90,162,255,0.2)' : 'rgba(255,255,255,0.08)', borderColor: editingScreen ? 'rgba(90,162,255,0.4)' : 'rgba(255,255,255,0.15)', color: editingScreen ? '#5aa2ff' : '#e6ebf5' }} onClick={() => setState((s) => ({ editingScreen: !s.editingScreen }))} title="打开后显示画面编辑手柄（绿色=移动 / 蓝色=缩放）">
                      {editingScreen ? '✅ 完成编辑' : '🛠 编辑画面'}
                    </button>
                  </>
                )}
                <button style={panelBtn} onClick={() => renameModel(deviceModal)} title="给这个模型起个名字">✏️ 重命名</button>
                <button style={panelBtn} onClick={saveModelView} title="把当前相机视角保存到这个模型，下次点它就用这个视角">
                  {deviceModal.view ? '重新保存视角' : '保存当前视角'}
                </button>
                {deviceModal.view && (
                  <button style={panelBtnDanger} onClick={deleteModelView}>删除视角</button>
                )}
              </div>
            </div>
          )}

          {/* 编辑画面模式：位置（上下左右前后）+ 大小 微调按钮（−/+）；也可在 3D 里拖手柄 */}
          {editingScreen && isTvModel(deviceModal) && (() => {
            const microBtn = { padding: '2px 10px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#e6ebf5', cursor: 'pointer', fontSize: 12, lineHeight: '16px' }
            const val = (k, dft = 0) => (deviceModal.screen && deviceModal.screen[k]) != null ? deviceModal.screen[k] : dft
            const rows = [['左右 X', 'offsetX', 0.05], ['上下 Y', 'offsetY', 0.05], ['前后 Z', 'offsetZ', 0.05]]
            return (
              <div style={{ ...panelCard }}>
                <div style={cardTitle}>画面参数（也可拖 3D 手柄：绿=上下左右 / 蓝=缩放）</div>
                {rows.map(([label, key, step]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                    <span style={{ color: 'rgba(230,235,245,0.5)', width: 50, flexShrink: 0 }}>{label}</span>
                    <button onClick={() => updateScreen(deviceModal, { [key]: +(val(key) - step).toFixed(2) })} style={microBtn}>−</button>
                    <span style={{ width: 46, textAlign: 'center', fontSize: 12, color: '#e6ebf5' }}>{val(key).toFixed(2)}</span>
                    <button onClick={() => updateScreen(deviceModal, { [key]: +(val(key) + step).toFixed(2) })} style={microBtn}>＋</button>
                    <button onClick={() => updateScreen(deviceModal, { [key]: 0 })} style={microBtn}>清零</button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                  <span style={{ color: 'rgba(230,235,245,0.5)', width: 50, flexShrink: 0 }}>大小</span>
                  <button onClick={() => updateScreen(deviceModal, { scale: +(val('scale', 1) - 0.1).toFixed(2) })} style={microBtn}>−</button>
                  <span style={{ width: 46, textAlign: 'center', fontSize: 12, color: '#e6ebf5' }}>{val('scale', 1).toFixed(2)}</span>
                  <button onClick={() => updateScreen(deviceModal, { scale: +(val('scale', 1) + 0.1).toFixed(2) })} style={microBtn}>＋</button>
                  <button onClick={() => updateScreen(deviceModal, { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0 })} style={microBtn}>重置</button>
                </div>
              </div>
            )
          })()}

          {/* 开关（非空调通用设备） */}
          {devDomain !== 'climate' && TOGGLE_DOMAINS.has(devDomain) && (
            <div style={{ ...panelCard }}>
              <div style={cardTitle}>开关</div>
              <button style={panelBtnPrimary} onClick={() => toggleDevice(deviceModal)}>⏻ 切换</button>
            </div>
          )}

          {/* 灯：亮度 / 色温 / 颜色 */}
          {devDomain === 'light' && (
            <div style={{ ...panelCard }}>
              <div style={cardTitle}>灯控制</div>
              <label style={{ color: 'rgba(230,235,245,0.7)', fontSize: 12 }}>亮度</label>
              <input type="range" min="0" max="255" step="1" style={{ width: '100%', accentColor: '#5aa2ff' }}
                value={devAttrs.brightness != null ? devAttrs.brightness : 255}
                onChange={(e) => lightControl(deviceModal, { brightness: Number(e.target.value) })} />
              <label style={{ marginTop: 10, color: 'rgba(230,235,245,0.7)', fontSize: 12 }}>色温（K）</label>
              <input type="range" min="2000" max="6500" step="100" style={{ width: '100%', accentColor: '#5aa2ff' }}
                value={devAttrs.color_temp_kelvin || 4000}
                onChange={(e) => lightControl(deviceModal, { color_temp_kelvin: Number(e.target.value) })} />
              <label style={{ marginTop: 10, color: 'rgba(230,235,245,0.7)', fontSize: 12 }}>颜色</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {[['#ffdd66', '暖黄'], ['#ffffff', '白'], ['#ff9b9b', '红'], ['#9bd4ff', '蓝'], ['#a8ffa8', '绿'], ['#e0a8ff', '紫']].map(([hex, name]) => (
                  <button key={hex} title={name} style={{ width: 30, height: 30, borderRadius: 6, border: '2px solid rgba(255,255,255,0.15)', background: hex, cursor: 'pointer' }}
                    onClick={() => lightControl(deviceModal, { rgb_color: hexToRgb(hex) })} />
                ))}
                <label style={{ width: 30, height: 30, borderRadius: 6, border: '2px solid rgba(255,255,255,0.15)', overflow: 'hidden', cursor: 'pointer', display: 'inline-block' }}>
                  <input type="color" value={rgbToHex(devAttrs.rgb_color)} onChange={(e) => lightControl(deviceModal, { rgb_color: hexToRgb(e.target.value) })}
                    style={{ width: '200%', height: '200%', margin: '-50%', cursor: 'pointer', border: 0, padding: 0 }} />
                </label>
              </div>
            </div>
          )}

          {/* 门控制（点门模型或门洞弹窗里开门/关门） */}
          {(deviceModal.type === '门' || deviceModal.doorStyle) && (
            <div style={{ ...panelCard }}>
              <div style={cardTitle}>门控制</div>
              <button style={deviceModal.doorOpen ? panelBtnDanger : panelBtnPrimary} onClick={() => toggleDoor(deviceModal)}>
                {deviceModal.doorOpen ? '🚪 关门' : '🚪 开门'}
              </button>
            </div>
          )}
          {/* 窗帘参数（点窗帘可调宽/长/颜色） */}
          {deviceModal.type === '窗帘' && (
            <div style={{ ...panelCard }}>
              <div style={cardTitle}>窗帘参数</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                <span style={{ color: 'rgba(230,235,245,0.5)', width: 34, flexShrink: 0 }}>宽</span>
                <input type="range" min="0.6" max="3" step="0.1" style={{ flex: 1, accentColor: '#5aa2ff' }}
                  value={deviceModal.width || 1.5}
                  onChange={(e) => updateCurtain(deviceModal, { width: parseFloat(e.target.value) })} />
                <span style={{ fontSize: 11, color: 'rgba(230,235,245,0.5)', width: 32, textAlign: 'right' }}>{(deviceModal.width || 1.5).toFixed(1)}m</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                <span style={{ color: 'rgba(230,235,245,0.5)', width: 34, flexShrink: 0 }}>长</span>
                <input type="range" min="1" max="3" step="0.1" style={{ flex: 1, accentColor: '#5aa2ff' }}
                  value={deviceModal.height || 2.0}
                  onChange={(e) => updateCurtain(deviceModal, { height: parseFloat(e.target.value) })} />
                <span style={{ fontSize: 11, color: 'rgba(230,235,245,0.5)', width: 32, textAlign: 'right' }}>{(deviceModal.height || 2.0).toFixed(1)}m</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ color: 'rgba(230,235,245,0.5)', width: 34, flexShrink: 0 }}>颜色</span>
                {['#dcd3c4', '#c8b8a8', '#a8b8c8', '#c8d8c8', '#d8c8c8', '#8a7a6a'].map((c) => (
                  <button key={c} onClick={() => updateCurtain(deviceModal, { params: { color: c } })}
                    style={{ width: 22, height: 22, borderRadius: 5, border: ((deviceModal.params && deviceModal.params.color) || '#dcd3c4') === c ? '2px solid #5aa2ff' : '1px solid rgba(255,255,255,0.15)', background: c, cursor: 'pointer', flexShrink: 0 }} />
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                <span style={{ color: 'rgba(230,235,245,0.5)', width: 34, flexShrink: 0 }}>收缩</span>
                <input type="range" min="0.2" max="0.8" step="0.05" style={{ flex: 1, accentColor: '#5aa2ff' }}
                  value={(deviceModal.params && deviceModal.params.shrink) || 0.5}
                  onChange={(e) => updateCurtain(deviceModal, { params: { shrink: parseFloat(e.target.value) } })} />
                <span style={{ fontSize: 11, color: 'rgba(230,235,245,0.5)', width: 32, textAlign: 'right' }}>{Math.round(((deviceModal.params && deviceModal.params.shrink) || 0.5) * 100)}%</span>
              </div>
            </div>
          )}
          {/* 窗帘（cover 实体）：开合百分比 + 开 / 停 / 关 */}
          {devDomain === 'cover' && (
            <div style={{ ...panelCard }}>
              <div style={cardTitle}>窗帘控制</div>
              <label style={{ color: 'rgba(230,235,245,0.7)', fontSize: 12 }}>开合百分比</label>
              <input type="range" min="0" max="100" step="1" style={{ width: '100%', accentColor: '#5aa2ff' }}
                value={deviceModal.curtainPos != null ? deviceModal.curtainPos : (devAttrs.current_position != null ? devAttrs.current_position : 50)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  updateCurtain(deviceModal, { curtainPos: v })  // 模型窗帘立即跟随
                  coverControl(deviceModal, 'set_cover_position', { position: v })  // 实物窗帘走
                }} />
              <span style={{ fontSize: 12, color: 'rgba(230,235,245,0.5)' }}>{deviceModal.curtainPos != null ? deviceModal.curtainPos : (devAttrs.current_position != null ? devAttrs.current_position : 50)}%（0 全关 / 100 全开）</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={panelBtnPrimary} onClick={() => coverControl(deviceModal, 'open_cover')}>开</button>
                <button style={panelBtn} onClick={() => coverControl(deviceModal, 'stop_cover')}>停</button>
                <button style={panelBtn} onClick={() => coverControl(deviceModal, 'close_cover')}>关</button>
              </div>
            </div>
          )}

          {/* 关闭按钮 */}
          <div style={{ padding: '0 0 4px', display: 'flex', justifyContent: 'flex-end' }}>
            <button style={{ ...panelBtn, fontSize: 11, padding: '6px 16px' }} onClick={() => setDeviceModal(null)}>关闭</button>
          </div>
        </div>
      )}

      {/* 场景同步面板（右侧半透明，常驻；其它面板打开时自动隐藏，关掉后再显示） */}
      {sceneOpen && !editing && !notifOpen && !deviceModal && !settingsOpen && !deviceListOpen && !bindOpen && (
        <div className="side-panel scene-panel">
          <div className="ha-scene-list">
            {scenes.map((s) => {
              const name = (s.attributes && s.attributes.friendly_name) || s.entity_id.split('.').pop()
              const running = runningSceneId === s.entity_id
              const recent = lastSceneId === s.entity_id
              return (
                <button key={s.entity_id} type="button" className={`ha-scene-item ${running ? 'running' : ''} ${recent ? 'recent' : ''}`.trim()}
                  disabled={!!runningSceneId} onClick={() => activateScene(s.entity_id)} title={`执行 ${name}`}>
                  <span className="ha-scene-icon">✦</span>
                  <span className="ha-scene-copy">
                    <strong>{name}</strong>
                    {(running || recent) && <small>{running ? '执行中' : '刚刚执行'}</small>}
                  </span>
                  <span className="ha-scene-run">
                    {running
                      ? <span className="scene-spinner" />
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 21 12 7 20 7 4" /></svg>}
                  </span>
                </button>
              )
            })}
            {scenes.length === 0 && <div className="ha-scene-empty">在 Home Assistant 中创建 scene.* 后会显示在这里。</div>}
          </div>
        </div>
      )}

      {/* 通知中心面板（右侧半透明，临时弹窗） */}
      {notifOpen && (
        <div className="side-panel notif-panel">
          <div className="side-panel-head">🔔 通知</div>
          {notifications.length === 0 ? (
            <p className="side-panel-empty">没有通知</p>
          ) : (
            notifications.map((n) => (
              <div key={n.notification_id} className="side-panel-item" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{n.created_at || ''}</span>
                  <button onClick={() => dismissNotification(n.notification_id)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
                {n.title && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{n.title}</div>}
                <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{n.message || ''}</div>
              </div>
            ))
          )}
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}

      {/* 悬停提示（开关：设置→悬停提示）：鼠标移到模型上显示名字 */}
      {hoveredItem && (
        <div style={{ position: 'fixed', left: (hoveredItem.x || 0) + 16, top: (hoveredItem.y || 0) - 10, zIndex: 90, background: 'rgba(10,16,30,0.94)', border: '1px solid rgba(61,136,255,0.45)', color: '#fff', padding: '6px 12px', borderRadius: 9, fontSize: 13, boxShadow: '0 6px 20px rgba(0,0,0,0.45)', pointerEvents: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6, transform: 'translateY(-50%)' }}>
          <span style={{ color: '#3D88FF', fontSize: 14 }}>◈</span>
          {hoveredItem.name}
        </div>
      )}

      {/* 第一人称虚拟方向键（手机/平板屏幕按键，按住移动） */}
      {fpsMode && (
        <div style={{ position: 'fixed', bottom: 24, left: 20, zIndex: 70, display: 'grid', gridTemplateColumns: 'repeat(3, 58px)', gap: 6, touchAction: 'none', userSelect: 'none' }}>
          <div />
          <FpsBtn k="w">▲</FpsBtn>
          <div />
          <FpsBtn k="a">◀</FpsBtn>
          <div />
          <FpsBtn k="d">▶</FpsBtn>
          <div />
          <FpsBtn k="s">▼</FpsBtn>
          <div />
        </div>
      )}

      {/* 设置面板：右侧半屏（左侧主视图仍可旋转/点击） */}
      {settingsOpen && (
        <div className="settings-panel">
          <div className="dname">设置</div>
            {/* 三个 tab 切换 */}
            <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
              {[['default', '默认选项'], ['background', '背景配置'], ['share', '分享']].map(([k, l]) => (
                <button key={k} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: '1px solid var(--border)', background: settingsTab === k ? 'var(--accent)' : 'var(--panel2)', color: settingsTab === k ? '#081018' : 'var(--text)', cursor: 'pointer', fontSize: 12 }} onClick={() => setSettingsTab(k)}>{l}</button>
              ))}
            </div>
            {settingsTab === 'default' && (() => {
              const seg = (active) => ({ padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--panel2)', color: active ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 })
              const labelStyle = { fontSize: 12, color: 'var(--muted)', minWidth: 88, flexShrink: 0 }
              const row = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }
              const toggle = (label, cur, key) => (
                <div key={key} style={row}>
                  <span style={labelStyle}>{label}</span>
                  <button onClick={() => saveDefault({ [key]: true })} style={seg(cur !== false)}>开</button>
                  <button onClick={() => saveDefault({ [key]: false })} style={seg(cur === false)}>关</button>
                </div>
              )
              return (
                <div className="field" style={{ margin: '12px 0' }}>
                  <label>默认选项（下次打开生效，每条一行）</label>
                  <div style={row}>
                    <span style={labelStyle}>米家模式</span>
                    <button onClick={() => setMiHome(true)} style={seg(mihomeMode)}>开</button>
                    <button onClick={() => setMiHome(false)} style={seg(!mihomeMode)}>关</button>
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>原版玻璃</span>
                    <button onClick={() => setGlass(true)} style={seg(glassMode)}>开</button>
                    <button onClick={() => setGlass(false)} style={seg(!glassMode)}>关</button>
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>玻璃透度</span>
                    <input type="range" min="0.1" max="0.9" step="0.05" value={settings.glassOpacity != null ? settings.glassOpacity : 0.3}
                      onChange={(e) => saveDefault({ glassOpacity: parseFloat(e.target.value) })}
                      style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 32, textAlign: 'right' }}>{Math.round((settings.glassOpacity != null ? settings.glassOpacity : 0.3) * 100)}%</span>
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>玻璃墙色</span>
                    {[['#d5e0f1', '灰蓝'], ['#f3f1ed', '浅灰白'], ['#c9d3e0', '蓝灰'], ['#ffffff', '纯白'], ['#f0f0f0', '米白'], ['#b0c4de', '深灰蓝']].map(([c, name]) => (
                      <button key={c} title={name} onClick={() => saveDefault({ glassWallColor: c })}
                        style={{ width: 22, height: 22, borderRadius: 5, border: ((settings.glassWallColor || '#d5e0f1') === c) ? '2px solid var(--accent)' : '1px solid var(--border)', background: c, cursor: 'pointer', flexShrink: 0 }} />
                    ))}
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>旋转</span>
                    {[['none', '停止', !settings.autoRotate], ['cw', '顺时针', !!settings.autoRotate && settings.rotateDir === 1], ['ccw', '逆时针', !!settings.autoRotate && settings.rotateDir === -1]].map(([v, l, active]) => (
                      <button key={v} onClick={() => saveDefault(v === 'none' ? { autoRotate: false } : { autoRotate: true, rotateDir: v === 'cw' ? 1 : -1 })} style={seg(active)}>{l}</button>
                    ))}
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>速度</span>
                    <input type="number" step="0.1" min="0.5" max="5" value={settings.rotateSpeed || 1}
                      onChange={(e) => saveDefault({ rotateSpeed: parseFloat(e.target.value) || 1 })}
                      style={{ width: 64, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>×</span>
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>速度上限</span>
                    <input type="number" step="0.1" min="0.5" max="100" value={settings.rotateSpeedMax || 5}
                      onChange={(e) => saveDefault({ rotateSpeedMax: parseFloat(e.target.value) || 5 })}
                      style={{ width: 64, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>×（滑动条上限）</span>
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>画质</span>
                    {[['eco', '流畅'], ['smooth', '均衡'], ['balanced', '高清'], ['high', '极致']].map(([v, l]) => (
                      <button key={v} onClick={() => saveDefault({ quality: v })} style={seg((settings.quality || 'high') === v)}>{l}</button>
                    ))}
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>日间/夜间</span>
                    <button onClick={() => saveDefault({ night: false, sunAuto: false })} style={seg(settings.night !== true && settings.sunAuto !== true)}>日间</button>
                    <button onClick={() => saveDefault({ night: true, sunAuto: false })} style={seg(settings.night === true)}>夜间</button>
                    <button onClick={() => saveDefault({ sunAuto: true })} style={seg(settings.sunAuto !== false)}>自动</button>
                  </div>
                  {toggle('显示墙', settings.showWalls !== undefined ? settings.showWalls : true, 'showWalls')}
                  {toggle('显示设备名', settings.showLabels !== undefined ? settings.showLabels : true, 'showLabels')}
                  {toggle('模型聚焦', settings.camFocusOnModel === true, 'camFocusOnModel')}
                  {toggle('平滑聚焦', settings.smoothFocus === true, 'smoothFocus')}
                  {toggle('悬停提示', settings.hoverTip === true, 'hoverTip')}
                  {toggle('模型状态切换', settings.clickToggleState !== false, 'clickToggleState')}
                  {toggle('状态小球', settings.showStatusPulse !== false, 'showStatusPulse')}
                  <div style={row}>
                    <span style={labelStyle}>弹窗透明度</span>
                    <input type="range" min="0.3" max="1" step="0.05" value={panelOpacity} onChange={(e) => saveDefault({ panelOpacity: parseFloat(e.target.value) })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)', width: 38, textAlign: 'right' }}>{Math.round(panelOpacity * 100)}%</span>
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>弹窗颜色</span>
                    {['#0d1526', '#1a2030', '#2a3145', '#3d4a66', '#232c40', '#101a2e'].map((c) => (
                      <button key={c} title={c} onClick={() => saveDefault({ panelColor: c })}
                        style={{ width: 22, height: 22, borderRadius: 6, border: panelColor === c ? '2px solid var(--accent)' : '1px solid var(--border)', background: c, cursor: 'pointer', flexShrink: 0 }} />
                    ))}
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>初始位置</span>
                    <button style={panelBtn} onClick={saveFpsStart}>保存当前位置</button>
                    <button style={panelBtn} onClick={clearFpsStart}>清除</button>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{settings.fpsStart ? '已保存' : '未保存'}</span>
                  </div>
                  <div style={row}>
                    <span style={labelStyle}>选中指示</span>
                    {[['glow', '光环'], ['outline', '描边'], ['pulse', '脉冲'], ['column', '光柱'], ['ring', '顶部环'], ['none', '无']].map(([v, l]) => (
                      <button key={v} onClick={() => saveDefault({ selectEffect: v })} style={seg(selectEffect === v)}>{l}</button>
                    ))}
                  </div>
                  {selectEffect === 'outline' && (
                    <div style={{ marginTop: 6, padding: '6px 8px', background: 'rgba(61,136,255,0.06)', borderRadius: 6 }}>
                      <div style={row}>
                        <span style={labelStyle}>线宽</span>
                        <input type="range" min="1" max="5" step="1" value={selectOutline.width || 2} onChange={(e) => saveSelectOutline({ width: Number(e.target.value) })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                        <span style={{ fontSize: 11, color: 'var(--muted)', width: 20, textAlign: 'right' }}>{selectOutline.width || 2}</span>
                      </div>
                      <div style={row}>
                        <span style={labelStyle}>呼吸</span>
                        <input type="range" min="1" max="8" step="0.5" value={selectOutline.speed || 3.5} onChange={(e) => saveSelectOutline({ speed: parseFloat(e.target.value) })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                        <span style={{ fontSize: 11, color: 'var(--muted)', width: 22, textAlign: 'right' }}>{selectOutline.speed || 3.5}</span>
                      </div>
                      <div style={row}>
                        <span style={labelStyle}>位置</span>
                        {[['frame', '外框'], ['halo', '底部'], ['top', '顶部']].map(([v, l]) => (
                          <button key={v} onClick={() => saveSelectOutline({ mode: v })} style={seg(selectOutline.mode === v)}>{l}</button>
                        ))}
                      </div>
                      <div style={row}>
                        <span style={labelStyle}>大小</span>
                        <input type="range" min="0.05" max="0.5" step="0.05" value={selectOutline.size || 0.18} onChange={(e) => saveSelectOutline({ size: parseFloat(e.target.value) })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                        <span style={{ fontSize: 11, color: 'var(--muted)', width: 34, textAlign: 'right' }}>{(selectOutline.size || 0.18).toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                  <div style={row}>
                    <span style={labelStyle}>设备视角</span>
                    <button style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }} onClick={saveDeviceView}>保存当前视角</button>
                    <button style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }} onClick={clearDeviceView}>清除</button>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{settings.deviceView ? '已保存' : '未保存'}</span>
                  </div>
                  {toggle('房间分隔线', settings.roomBorderLines !== false, 'roomBorderLines')}
                  {toggle('分隔线旋转不隐藏', settings.roomBorderAlwaysVisible === true, 'roomBorderAlwaysVisible')}
                  {toggle('分隔线跳过门', settings.roomBorderSkipDoors === true, 'roomBorderSkipDoors')}
                  {toggle('显示门窗', settings.showOpenings !== undefined ? settings.showOpenings : true, 'showOpenings')}
                  {toggle('显示屋顶', settings.showCeiling !== undefined ? settings.showCeiling : true, 'showCeiling')}
                  {toggle('显示工具栏', settings.showToolbar !== undefined ? settings.showToolbar : true, 'showToolbar')}
                  {toggle('显示场景', !!settings.defaultScene, 'defaultScene')}
                  {toggle('显示房间', !!settings.defaultRoomNav, 'defaultRoomNav')}
                  {toggle('投影', settings.shadows !== false, 'shadows')}
                  {toggle('泛光', settings.bloom !== false, 'bloom')}
                  {toggle('太阳光', settings.sunLight !== false, 'sunLight')}
                  {toggle('帧率/卡顿', settings.showFps !== false, 'showFps')}
                  {toggle('全屏', !!settings.fullscreen, 'fullscreen')}
                  {toggle('沉浸', !!settings.immersive, 'immersive')}
                </div>
              )
            })()}
            {settingsTab === 'background' && (<>
            <div className="field" style={{ margin: '12px 0' }}>
              <label>背景颜色（六边形色盘）</label>
              <HexColorPicker value={bgColor} onChange={(c) => { setState({ bgColor: c, bgMode: 'color', bgImage: '' }); api.saveSettings({ ...getState().settings, bgColor: c, bgMode: 'color', bgImage: '' }).catch(() => {}) }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {[['#5278ae', '玻璃蓝'], ['#f2f3f0', '浅灰白'], ['#e9eef0', '浅蓝灰'], ['#070a14', '深蓝黑'], ['#ffffff', '纯白']].map(([c, name]) => (
                  <button key={c} title={name} onClick={() => { setState({ bgColor: c, bgMode: 'color', bgImage: '' }); api.saveSettings({ ...getState().settings, bgColor: c, bgMode: 'color', bgImage: '' }).catch(() => {}) }}
                    style={{ width: 26, height: 26, borderRadius: 5, border: bgColor === c ? '2px solid var(--accent)' : '1px solid var(--border)', background: c, cursor: 'pointer', flexShrink: 0 }} />
                ))}
              </div>
            </div>
            <div className="field" style={{ margin: '12px 0' }}>
              <label>上传图片（作为背景）</label>
              <input
                type="file" accept="image/*"
                style={{ width: '100%', padding: '6px', color: '#fff' }}
                onChange={async (e) => {
                  const file = e.target.files[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = async () => {
                    try {
                      const r = await fetch(BASE + 'api/background', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data: reader.result }),
                      })
                      const res = await r.json()
                      if (res.ok && res.name) {
                        setState({ bgImage: res.name, bgMode: 'image' })
                        api.saveSettings({ ...getState().settings, bgImage: res.name, bgMode: 'image' }).catch(() => {})
                        toast('背景图已上传')
                        loadBgImages()
                      }
                    } catch (err) { toast('上传失败') }
                  }
                  reader.readAsDataURL(file)
                }}
              />
            </div>
            <div className="field" style={{ margin: '12px 0' }}>
              <label>已保存的背景图（点选使用，✕删除）</label>
              {bgImages.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>还没有上传背景图</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {bgImages.map((img) => (
                    <div key={img.name} style={{ position: 'relative' }}>
                      <img src={BASE + 'api/background/' + img.name} alt={img.name}
                        style={{ width: 72, height: 48, objectFit: 'cover', borderRadius: 6, cursor: 'pointer',
                          border: bgImage === img.name ? '2px solid var(--accent)' : '1px solid var(--border)' }}
                        onClick={() => selectBg(img.name)} />
                      <button title="删除" onClick={() => deleteBg(img.name)}
                        style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, lineHeight: '16px', textAlign: 'center',
                          borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--panel-solid)', color: 'var(--danger)',
                          fontSize: 10, cursor: 'pointer', padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="field" style={{ margin: '12px 0' }}>
              <label>或填图片 URL（网络图片）</label>
              <input
                type="text" id="bg-url"
                placeholder="https://example.com/bg.jpg"
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: '#0e1628', color: '#fff' }}
              />
            </div>
            <div className="dev-actions">
              <button className="primary" onClick={() => {
                const input = document.getElementById('bg-url')
                const url = input ? input.value.trim() : ''
                setState({ bgImage: url, bgMode: 'image', settingsOpen: false })
                api.saveSettings({ ...getState().settings, bgImage: url, bgMode: 'image' }).catch(() => {})
              }}>应用 URL</button>
              <button className="close-btn" onClick={() => { setState({ bgImage: '', settingsOpen: false }); api.saveSettings({ ...getState().settings, bgImage: '' }).catch(() => {}) }}>清除</button>
            </div>
            <div className="field" style={{ margin: '12px 0' }}>
              <label>渐变（选两个颜色）</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, alignItems: 'center' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>颜色 1（顶）</div>
                  <HexColorPicker value={bgGradient1} onChange={(c) => { setState({ bgGradient1: c, bgMode: 'gradient', bgImage: '' }); api.saveSettings({ ...getState().settings, bgGradient1: c, bgMode: 'gradient', bgImage: '' }).catch(() => {}) }} />
                </div>
                <div style={{ width: '100%' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>颜色 2（底）</div>
                  <HexColorPicker value={bgGradient2} onChange={(c) => { setState({ bgGradient2: c, bgMode: 'gradient', bgImage: '' }); api.saveSettings({ ...getState().settings, bgGradient2: c, bgMode: 'gradient', bgImage: '' }).catch(() => {}) }} />
                </div>
              </div>
            </div>
            <div className="field" style={{ margin: '12px 0' }}>
              <label>屋顶</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>不透明度</span>
                <input type="range" min="10" max="100" step="5" style={{ flex: 1 }} value={roofOpacity != null ? roofOpacity : 80}
                  onChange={(e) => { const v = Number(e.target.value); setState({ roofOpacity: v }); api.saveSettings({ ...getState().settings, roofOpacity: v }).catch(() => {}) }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{roofOpacity != null ? roofOpacity : 80}%</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <HexColorPicker value={roofColor || '#7789ad'} onChange={(c) => { setState({ roofColor: c }); api.saveSettings({ ...getState().settings, roofColor: c }).catch(() => {}) }} />
              </div>
            </div>
            </>)}
            {settingsTab === 'share' && (
            <div className="field" style={{ margin: '12px 0' }}>
              <label>分享 / 导出</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <button className="primary" onClick={() => export3DPng(1)}>📷 导出 3D 图片</button>
                <button style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }} onClick={() => export3DPng(4)}>4 张（不同角度）</button>
                <button style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }} onClick={() => record3DVideo(6)}>🎬 录制 3D 视频</button>
              </div>
            </div>
            )}
        </div>
      )}
    </div>
  )
}
