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
import { roomsToWalls, recomputeRooms } from './three/geometry'
import { loadCatalog } from './catalog'

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
  const sceneOpen = useStore((s) => s.sceneOpen)
  const notifOpen = useStore((s) => s.notifOpen)
  const saveTimer = useRef(null)
  const fpsRef = useRef(null)

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
          autoRotate: !!settings.autoRotate,
          rotateDir: settings.rotateDir || 1,
          rotateSpeed: settings.rotateSpeed || 1,
          immersive: !!settings.immersive,
          night: !!settings.night,
          bgImage: settings.bgImage || '',
          bgMode: settings.bgMode || 'color',
          bgColor: settings.bgColor || '#5278ae',
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
      // 拉全量实体（绑定用）
      const pollEntities = async () => {
        try {
          const ents = await api.entities()
          if (Array.isArray(ents)) setState({ haEntities: ents, haConnected: true })
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
            } else if (msg.type === 'state' && msg.entity_id) {
              const next = { ...getState().haStates }
              if (msg.new_state) next[msg.entity_id] = msg.new_state
              else delete next[msg.entity_id]
              setState({ haStates: next, haConnected: true })
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
      if (sel && sel.type === 'device') {
        setDeviceModal(sel.ref)
        return
      }
      // 缩放区域：查看态点房间 → 相机飞到房间中心（预设 iso 视角）
      if (sel && sel.type === 'room' && sel.ref.points && sel.ref.points.length) {
        const pts = sel.ref.points
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0
        pts.forEach((p) => { cx += p[0]; cz += p[1]; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]) })
        cx /= pts.length; cz /= pts.length
        const dist = Math.max(5, (maxX - minX) * 1.6, (maxZ - minZ) * 1.8)
        setState({ selected: sel, wallSel: [], camTarget: [cx, 0.55, cz], camDist: dist, camViewSignal: { type: 'default', n: st.camViewSignal.n + 1 } })
        return
      }
      setState({ selected: sel, wallSel: [] })
    } else {
      setState({ selected: sel, wallSel: [] })
    }
  }, [editing])

  // ---------- 设备控制 ----------
  const refreshStates = () => setTimeout(async () => {
    try { setState({ haStates: await api.states() }) } catch (e) {}
  }, 800)
  const toggleDevice = async (dev) => {
    const domain = dev.entity_id.split('.')[0]
    await api.service(domain, 'toggle', dev.entity_id)
    refreshStates()
    toast(`已发送 ${dev.name} 切换指令`)
  }
  // 灯：调亮度 / 色温 / 颜色（data 直接透传给 light.turn_on）
  const lightControl = async (dev, data) => {
    await api.service('light', 'turn_on', dev.entity_id, data)
    refreshStates()
  }
  // 窗帘：开 / 关 / 停
  const coverControl = async (dev, action) => {
    await api.service('cover', action, dev.entity_id)
    refreshStates()
  }
  // 场景激活
  const activateScene = async (entity_id) => {
    await api.service('scene', 'turn_on', entity_id)
    toast('已激活场景')
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

  // 保存默认选项到 settings（下次打开生效）
  const saveDefault = (patch) => {
    const s = { ...getState().settings, ...patch }
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
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

  // 自动跟随太阳切日夜（sun.sun；手动切日夜时关掉 sunAuto）
  useEffect(() => {
    if (!sunEnt || !getState().sunAuto) return
    const elev = sunEnt.attributes && sunEnt.attributes.elevation != null ? Number(sunEnt.attributes.elevation) : null
    const below = sunEnt.state !== 'above_horizon'
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
        setState({ editing: false, bindOpen: false, pendingEntity: null, selected: null, view2d: false, settingsOpen: false, tool: 'select' })
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

  const devState = deviceModal ? haStates[deviceModal.entity_id] : null
  // 场景列表（scene.* 实体）+ 当前选中设备属性
  const scenes = (haEntities || []).filter(e => e.entity_id.startsWith('scene.'))
  const devAttrs = devState && devState.attributes ? devState.attributes : {}
  const devDomain = deviceModal ? deviceModal.entity_id.split('.')[0] : ''
  // 太阳（sun.sun）：自动切日夜 + 日照高度角
  const sunEnt = (haEntities || []).find(e => e.entity_id === 'sun.sun')
  // 天气 + 温度（左上角信息）
  const WEATHER_ICON = { sunny: '☀️', 'clear-night': '🌙', partlycloudy: '⛅', cloudy: '☁️', rainy: '🌧️', pouring: '🌧️', snowy: '❄️', snowyrainy: '🌨️', lightning: '⛈️', fog: '🌫️', windy: '💨', hail: '🌨️' }
  const weatherEnt = (haEntities || []).find(e => e.entity_id.startsWith('weather.'))
  const weatherSt = weatherEnt ? haStates[weatherEnt.entity_id] : null
  const tempEnt = (haEntities || []).find(e => e.entity_id.startsWith('sensor.') && (e.attributes?.device_class === 'temperature' || /temperature|temp|_temp|温度/.test(e.entity_id)))
  const tempSt = tempEnt ? haStates[tempEnt.entity_id] : null

  return (
    <div className="app" onDoubleClick={() => immersive && setState({ immersive: false })}>
      {view2d ? <PlanEditor onSelect={handleSelect} floorIndex={currentFloor} /> : <Viewer onSelect={handleSelect} floorIndex={currentFloor} />}

      {/* 左上角状态（沉浸模式隐藏） */}
      {!immersive && <div className="status-tl">
        <span className="dot" style={{ background: haConnected ? 'var(--ok)' : 'var(--danger)' }} />
        {haConnected ? 'Home Assistant 已连接' : '未连接'}
        <span style={{ color: 'var(--accent2)' }}>
          {editing ? `· 房间 ${project.floors.reduce((n, f) => n + (f.rooms || []).length, 0)} 个` : ''}
        </span>
        {weatherSt && (
          <span>{(WEATHER_ICON[weatherSt.state] || '🌡️')} {weatherSt.state}</span>
        )}
        {tempSt && (
          <span>🌡️ {tempSt.state}{tempSt.attributes?.unit_of_measurement || '°C'}</span>
        )}
        <span ref={fpsRef} style={{ fontSize: '16px', fontWeight: 700 }} />
      </div>}

      {!immersive && <BottomBar />}

      {editing && <Editor />}

      {bindOpen && <BindDrawer />}

      {deviceListOpen && <DeviceList />}

      {/* 设备控制弹窗（overlay 控制面板） */}
      {deviceModal && (
        <div className="modal-mask" onClick={() => setDeviceModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="dname">{deviceModal.name || deviceModal.entity_id}</div>
            <div className="dstate big">{devState ? devState.state : 'unknown'}</div>
            <div className="dentity">{deviceModal.entity_id}</div>

            {TOGGLE_DOMAINS.has(devDomain) && (
              <div className="dev-actions">
                <button className="primary" onClick={() => toggleDevice(deviceModal)}>⏻ 切换</button>
              </div>
            )}

            {/* 灯：亮度 / 色温 / 颜色 */}
            {devDomain === 'light' && (
              <div className="field" style={{ margin: '12px 0' }}>
                <label>亮度</label>
                <input type="range" min="0" max="255" step="1" style={{ width: '100%' }}
                  value={devAttrs.brightness != null ? devAttrs.brightness : 255}
                  onChange={(e) => lightControl(deviceModal, { brightness: Number(e.target.value) })} />
                <label style={{ marginTop: 10 }}>色温（K）</label>
                <input type="range" min="2000" max="6500" step="100" style={{ width: '100%' }}
                  value={devAttrs.color_temp_kelvin || 4000}
                  onChange={(e) => lightControl(deviceModal, { color_temp_kelvin: Number(e.target.value) })} />
                <label style={{ marginTop: 10 }}>颜色</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {[['#ffdd66', '暖黄'], ['#ffffff', '白'], ['#ff9b9b', '红'], ['#9bd4ff', '蓝'], ['#a8ffa8', '绿'], ['#e0a8ff', '紫']].map(([hex, name]) => (
                    <button key={hex} title={name} style={{ width: 30, height: 30, borderRadius: 6, border: '2px solid var(--border)', background: hex, cursor: 'pointer' }}
                      onClick={() => lightControl(deviceModal, { rgb_color: hexToRgb(hex) })} />
                  ))}
                  <label style={{ width: 30, height: 30, borderRadius: 6, border: '2px solid var(--border)', overflow: 'hidden', cursor: 'pointer', display: 'inline-block' }}>
                    <input type="color" value={rgbToHex(devAttrs.rgb_color)} onChange={(e) => lightControl(deviceModal, { rgb_color: hexToRgb(e.target.value) })}
                      style={{ width: '200%', height: '200%', margin: '-50%', cursor: 'pointer', border: 0, padding: 0 }} />
                  </label>
                </div>
              </div>
            )}

            {/* 窗帘：开 / 停 / 关 */}
            {devDomain === 'cover' && (
              <div className="dev-actions" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => coverControl(deviceModal, 'open_cover')}>开</button>
                <button onClick={() => coverControl(deviceModal, 'stop_cover')}>停</button>
                <button onClick={() => coverControl(deviceModal, 'close_cover')}>关</button>
              </div>
            )}

            <button className="close-btn" onClick={() => setDeviceModal(null)}>关闭</button>
          </div>
        </div>
      )}

      {/* 场景同步面板 */}
      {sceneOpen && (
        <div className="modal-mask" onClick={() => setState({ sceneOpen: false })}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="dname">🎬 场景</div>
            {scenes.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>没有 scene 实体</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: '60vh', overflowY: 'auto' }}>
                {scenes.map((s) => (
                  <button key={s.entity_id} onClick={() => { activateScene(s.entity_id); setState({ sceneOpen: false }) }}
                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}>
                    {(s.attributes && s.attributes.friendly_name) || s.entity_id.split('.').pop()}
                  </button>
                ))}
              </div>
            )}
            <button className="close-btn" onClick={() => setState({ sceneOpen: false })}>关闭</button>
          </div>
        </div>
      )}

      {/* 通知中心面板 */}
      {notifOpen && (
        <div className="modal-mask" onClick={() => setState({ notifOpen: false })}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="dname">🔔 通知</div>
            {notifications.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>没有通知</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, maxHeight: '60vh', overflowY: 'auto' }}>
                {notifications.map((n) => (
                  <div key={n.notification_id} style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{n.created_at || ''}</span>
                      <button onClick={() => dismissNotification(n.notification_id)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4 }}>{n.message || ''}</div>
                    {n.title && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{n.title}</div>}
                  </div>
                ))}
              </div>
            )}
            <button className="close-btn" onClick={() => setState({ notifOpen: false })}>关闭</button>
          </div>
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}

      {/* 设置面板：背景图 */}
      {settingsOpen && (
        <div className="modal-mask" onClick={() => setState({ settingsOpen: false })}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto' }}>
            <div className="dname">设置</div>
            {/* 三个 tab 切换 */}
            <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
              {[['default', '默认选项'], ['background', '背景配置'], ['quality', '画质'], ['share', '分享']].map(([k, l]) => (
                <button key={k} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: '1px solid var(--border)', background: settingsTab === k ? 'var(--accent)' : 'var(--panel2)', color: settingsTab === k ? '#081018' : 'var(--text)', cursor: 'pointer', fontSize: 12 }} onClick={() => setSettingsTab(k)}>{l}</button>
              ))}
            </div>
            {settingsTab === 'default' && (
            <div className="field" style={{ margin: '12px 0' }}>
              <label>默认选项（下次打开生效）</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 52 }}>旋转</span>
                {[['none', '停止', !settings.autoRotate], ['cw', '顺时针', !!settings.autoRotate && settings.rotateDir === 1], ['ccw', '逆时针', !!settings.autoRotate && settings.rotateDir === -1]].map(([v, l, active]) => (
                  <button key={v} onClick={() => saveDefault(v === 'none' ? { autoRotate: false } : { autoRotate: true, rotateDir: v === 'cw' ? 1 : -1 })}
                    style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--panel2)', color: active ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>{l}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 52 }}>速度</span>
                <input type="number" step="0.1" min="0.5" max="5" value={settings.rotateSpeed || 1}
                  onChange={(e) => saveDefault({ rotateSpeed: parseFloat(e.target.value) || 1 })}
                  style={{ width: 64, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }} />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>×</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 52 }}>画质</span>
                {[['eco', '流畅'], ['smooth', '均衡'], ['balanced', '高清'], ['high', '极致']].map(([v, l]) => (
                  <button key={v} onClick={() => saveDefault({ quality: v })}
                    style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: (settings.quality || 'high') === v ? 'var(--accent)' : 'var(--panel2)', color: (settings.quality || 'high') === v ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>{l}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 52 }}>投影</span>
                <button onClick={() => saveDefault({ shadows: true })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: settings.shadows !== false ? 'var(--accent)' : 'var(--panel2)', color: settings.shadows !== false ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>开</button>
                <button onClick={() => saveDefault({ shadows: false })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: settings.shadows === false ? 'var(--accent)' : 'var(--panel2)', color: settings.shadows === false ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>关</button>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 52, marginLeft: 10 }}>全屏</span>
                <button onClick={() => saveDefault({ fullscreen: true })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: settings.fullscreen ? 'var(--accent)' : 'var(--panel2)', color: settings.fullscreen ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>开</button>
                <button onClick={() => saveDefault({ fullscreen: false })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: !settings.fullscreen ? 'var(--accent)' : 'var(--panel2)', color: !settings.fullscreen ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>关</button>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 52, marginLeft: 10 }}>沉浸</span>
                <button onClick={() => saveDefault({ immersive: true })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: settings.immersive ? 'var(--accent)' : 'var(--panel2)', color: settings.immersive ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>开</button>
                <button onClick={() => saveDefault({ immersive: false })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: !settings.immersive ? 'var(--accent)' : 'var(--panel2)', color: !settings.immersive ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>关</button>
              </div>
            </div>
            )}
            {settingsTab === 'background' && (<>
            <div className="field" style={{ margin: '12px 0' }}>
              <label>背景颜色（六边形色盘）</label>
              <HexColorPicker value={bgColor} onChange={(c) => { setState({ bgColor: c, bgMode: 'color', bgImage: '' }); api.saveSettings({ ...getState().settings, bgColor: c, bgMode: 'color', bgImage: '' }).catch(() => {}) }} />
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
            {settingsTab === 'quality' && (
            <div className="field" style={{ margin: '12px 0' }}>
              <label>画质</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {[['eco', '流畅'], ['smooth', '均衡'], ['balanced', '高清'], ['high', '极致']].map(([v, l]) => (
                  <button key={v} onClick={() => setState({ quality: v })}
                    style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: quality === v ? 'var(--accent)' : 'var(--panel2)', color: quality === v ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>{l}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 52 }}>投影</span>
                <button onClick={() => setState({ shadows: true })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: shadows ? 'var(--accent)' : 'var(--panel2)', color: shadows ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>开</button>
                <button onClick={() => setState({ shadows: false })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: !shadows ? 'var(--accent)' : 'var(--panel2)', color: !shadows ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>关</button>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 52, marginLeft: 10 }}>泛光</span>
                <button onClick={() => setState({ bloom: true })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: bloom ? 'var(--accent)' : 'var(--panel2)', color: bloom ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>开</button>
                <button onClick={() => setState({ bloom: false })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: !bloom ? 'var(--accent)' : 'var(--panel2)', color: !bloom ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>关</button>
              </div>
            </div>
            )}
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
        </div>
      )}
    </div>
  )
}
