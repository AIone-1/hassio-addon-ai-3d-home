import { useEffect, useRef, useState, useCallback } from 'react'
import Viewer from './components/Viewer'
import PlanEditor from './components/PlanEditor'
import BottomBar from './components/BottomBar'
import Editor from './components/Editor'
import BindDrawer from './components/BindDrawer'
import { useStore, setState, getState, toast } from './store'
import { api, TOGGLE_DOMAINS, BASE } from './api'
import { roomsToWalls, recomputeRooms } from './three/geometry'
import { loadCatalog } from './catalog'

export default function App() {
  const project = useStore((s) => s.project)
  const editing = useStore((s) => s.editing)
  const bindOpen = useStore((s) => s.bindOpen)
  const currentFloor = useStore((s) => s.currentFloor)
  const selected = useStore((s) => s.selected)
  const haConnected = useStore((s) => s.haConnected)
  const haStates = useStore((s) => s.haStates)
  const toastMsg = useStore((s) => s.toast)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const bgImage = useStore((s) => s.bgImage)
  const bgMode = useStore((s) => s.bgMode)
  const view2d = useStore((s) => s.view2d)
  const [deviceModal, setDeviceModal] = useState(null)
  const [fps, setFps] = useState(0)
  const saveTimer = useRef(null)

  // FPS 计数（诊断卡顿用）
  useEffect(() => {
    let frames = 0
    let last = performance.now()
    let raf
    const loop = (now) => {
      frames++
      if (now - last >= 500) {
        setFps(Math.round(frames * 1000 / (now - last)))
        frames = 0
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
          quality: settings.quality || 'balanced',
          shadows: settings.shadows !== undefined ? settings.shadows : true,
          autoRotate: !!settings.autoRotate,
          night: !!settings.night,
          bgImage: settings.bgImage || '',
          bgMode: settings.bgMode || 'color',
        })
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
            // 只要有墙，就重算房间（覆盖旧数据 + 房间为空的异常态）
            if (f.walls && f.walls.length > 0) {
              f.rooms = recomputeRooms(f)
            }
          })
          setState({ project: p, currentFloor: 0 })
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
        // 自动旋转时跳过轮询，避免 fetch/解析打断 3D 渲染导致卡顿；转完下一个周期恢复
        if (getState().autoRotate) return
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
      setState({ selected: sel })
    } else {
      setState({ selected: sel })
    }
  }, [editing])

  // ---------- 设备控制 ----------
  const toggleDevice = async (dev) => {
    const domain = dev.entity_id.split('.')[0]
    await api.service(domain, 'toggle', dev.entity_id)
    setTimeout(async () => {
      try { setState({ haStates: await api.states() }) } catch (e) {}
    }, 800)
    toast(`已发送 ${dev.name} 切换指令`)
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
      const map = { v: 'select', m: 'move', g: 'movePlan', h: 'pan', w: 'wall', d: 'door', n: 'window', f: 'furniture', e: 'device', b: 'texture' }
      if (map[e.key.toLowerCase()] && editing) {
        setState({ tool: map[e.key.toLowerCase()] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const devState = deviceModal ? haStates[deviceModal.entity_id] : null

  return (
    <div className="app">
      {view2d ? <PlanEditor onSelect={handleSelect} floorIndex={currentFloor} /> : <Viewer onSelect={handleSelect} floorIndex={currentFloor} />}

      {/* 左上角状态 */}
      <div className="status-tl">
        <span className="dot" style={{ background: haConnected ? 'var(--ok)' : 'var(--danger)' }} />
        {haConnected ? 'Home Assistant 已连接' : '未连接'}
        <span style={{ color: 'var(--accent2)' }}>
          {editing ? `· 房间 ${project.floors.reduce((n, f) => n + (f.rooms || []).length, 0)} 个` : ''}
        </span>
        <span style={{ color: fps >= 50 ? 'var(--ok)' : fps >= 30 ? 'var(--accent2)' : 'var(--danger)' }}>
          {fps > 0 ? `· ${fps} FPS` : ''}
        </span>
      </div>

      <BottomBar />

      {editing && <Editor />}

      {bindOpen && <BindDrawer />}

      {/* 设备控制弹窗 */}
      {deviceModal && (
        <div className="modal-mask" onClick={() => setDeviceModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="dname">{deviceModal.name || deviceModal.entity_id}</div>
            <div className="dstate big">{devState ? devState.state : 'unknown'}</div>
            <div className="dentity">{deviceModal.entity_id}</div>
            {TOGGLE_DOMAINS.has(deviceModal.entity_id.split('.')[0]) && (
              <div className="dev-actions">
                <button className="primary" onClick={() => toggleDevice(deviceModal)}>⏻ 切换</button>
              </div>
            )}
            <button className="close-btn" onClick={() => setDeviceModal(null)}>关闭</button>
          </div>
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}

      {/* 设置面板：背景图 */}
      {settingsOpen && (
        <div className="modal-mask" onClick={() => setState({ settingsOpen: false })}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="dname">设置 · 背景</div>
            <div className="field" style={{ margin: '12px 0' }}>
              <label>背景效果</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['color', '纯色'], ['image', '背景图'], ['gradient', '渐变'], ['night', '夜景']].map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => { setState({ bgMode: v }); api.saveSettings({ ...getState().settings, bgMode: v }).catch(() => {}) }}
                    style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: bgMode === v ? 'var(--accent)' : 'var(--panel2)', color: bgMode === v ? '#081018' : '#fff', cursor: 'pointer' }}
                  >{l}</button>
                ))}
              </div>
            </div>
            {bgMode === 'image' && (
              <>
                <div className="field" style={{ margin: '12px 0' }}>
              <label>上传图片（推荐，本地图片用它）</label>
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
                      if (res.ok) {
                        const url = BASE + 'api/background'
                        setState({ bgImage: url, bgMode: 'image', settingsOpen: false })
                        api.saveSettings({ ...getState().settings, bgImage: url, bgMode: 'image' }).catch(() => {})
                        toast('背景图已上传')
                      }
                    } catch (err) { toast('上传失败') }
                  }
                  reader.readAsDataURL(file)
                }}
              />
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
