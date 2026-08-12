import { useEffect, useRef, useState, useCallback } from 'react'
import Viewer from './components/Viewer'
import BottomBar from './components/BottomBar'
import Editor from './components/Editor'
import EditorController from './components/EditorController'
import BindDrawer from './components/BindDrawer'
import { useStore, setState, getState, toast } from './store'
import { api, TOGGLE_DOMAINS } from './api'

export default function App() {
  const project = useStore((s) => s.project)
  const editing = useStore((s) => s.editing)
  const bindOpen = useStore((s) => s.bindOpen)
  const currentFloor = useStore((s) => s.currentFloor)
  const selected = useStore((s) => s.selected)
  const haConnected = useStore((s) => s.haConnected)
  const haStates = useStore((s) => s.haStates)
  const toast = useStore((s) => s.toast)
  const [deviceModal, setDeviceModal] = useState(null)
  const saveTimer = useRef(null)

  // ---------- 启动 ----------
  useEffect(() => {
    (async () => {
      try {
        const settings = await api.settings()
        setState({
          settings,
          quality: settings.quality || 'balanced',
          shadows: settings.shadows !== undefined ? settings.shadows : true,
          autoRotate: !!settings.autoRotate,
          night: !!settings.night,
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
      // 状态轮询
      const pollStates = async () => {
        try {
          const st = await api.states()
          if (st && typeof st === 'object') setState({ haStates: st, haConnected: true })
        } catch (e) { setState({ haConnected: false }) }
      }
      pollStates()
      setInterval(pollStates, 3000)
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

  // ---------- 选择处理 ----------
  const handleSelect = useCallback((sel) => {
    if (!editing) {
      // 非编辑模式：点到设备打开控制弹窗
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
      if (e.key === 'Enter') {
        // 闭合画墙草稿 → 生成房间
        if (window.__wallDraft && window.__wallDraft.pts.length >= 3) {
          const draft = window.__wallDraft
          const floor = getState().project.floors[getState().currentFloor]
          floor.rooms = floor.rooms || []
          floor.rooms.push({
            id: Math.random().toString(36).slice(2, 10), name: `房间${floor.rooms.length + 1}`,
            height: floor.height || 2.8, color: '#d8cbb2', points: draft.pts,
          })
          floor.walls = [] // 房间自带墙
          window.__wallDraft = null
          setState({ project: { ...getState().project }, saved: false })
          toast('房间已生成！')
        } else if (window.__wallDraft) {
          toast('至少点 3 个点才能闭合')
        }
      }
      if (e.key === 'Escape') {
        window.__wallDraft = null
        setDeviceModal(null)
        setState({ bindOpen: false, pendingEntity: null, selected: null })
      }
      // 工具快捷键 V/H/W/D/N/F/E/B
      const map = { v: 'select', h: 'pan', w: 'wall', d: 'door', n: 'window', f: 'furniture', e: 'device', b: 'texture' }
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
      <Viewer onSelect={handleSelect} floorIndex={currentFloor} />

      {/* 左上角状态 */}
      <div className="status-tl">
        <span className="dot" style={{ background: haConnected ? 'var(--ok)' : 'var(--danger)' }} />
        {haConnected ? 'Home Assistant 已连接' : '未连接'}
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
