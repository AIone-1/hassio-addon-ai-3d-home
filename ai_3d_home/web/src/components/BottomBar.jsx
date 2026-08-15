import { useStore, setState, getState, toast } from '../store'
import { api } from '../api'
import { useState, useEffect } from 'react'

const MODES = ['全屋', '结构']

export default function BottomBar() {
  const mode = useStore((s) => s.mode)
  const autoRotate = useStore((s) => s.autoRotate)
  const rotateDir = useStore((s) => s.rotateDir)
  const rotateSpeed = useStore((s) => s.rotateSpeed)
  const showWalls = useStore((s) => s.showWalls)
  const showOpenings = useStore((s) => s.showOpenings)
  const showCeiling = useStore((s) => s.showCeiling)
  const night = useStore((s) => s.night)
  const editing = useStore((s) => s.editing)
  const project = useStore((s) => s.project)
  const deviceCount = new Set(project.floors.flatMap((f) => (f.devices || []).map((d) => d.entity_id))).size
  const [viewOpen, setViewOpen] = useState(false)
  const customViews = useStore((s) => s.customViews)

  const setView = (type) => {
    setState((s) => ({ camViewSignal: { type, n: s.camViewSignal.n + 1 } }))
    setViewOpen(false)
  }
  // 视角存 settings（跨设备通用）
  const persistViews = (vs) => {
    try { localStorage.setItem('ai3d_custom_views', JSON.stringify(vs)) } catch (e) {}
    const s = { ...getState().settings, customViews: vs }
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
  }
  const saveView = () => {
    const cam = window.__cam3d
    if (!cam || !cam.pos) { toast('相机还没就绪'); return }
    const name = prompt('给这个视角起个名字：', `视角${customViews.length + 1}`)
    if (!name || !name.trim()) return
    const v = { id: 'v' + Date.now(), name: name.trim(), pos: [...cam.pos], target: [...cam.target] }
    const next = [...customViews, v]
    setState({ customViews: next })
    persistViews(next)
    toast('已保存视角「' + v.name + '」')
  }
  const delView = (id) => {
    const next = customViews.filter((v) => v.id !== id)
    setState({ customViews: next })
    persistViews(next)
  }

  // 点击空白处关闭 视图 菜单
  useEffect(() => {
    const onDown = (e) => {
      if (!viewOpen) return
      const t = e.target
      if (t.closest && t.closest('.bb-menu')) return
      setViewOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [viewOpen])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.()
  }

  return (
    <div className="bottom-bar">
      <div className="bb-group">
        <button className={`bb-btn ${autoRotate ? 'active' : ''}`} onClick={() => {
          // 只负责：启动旋转 / 切换顺逆时针
          if (!autoRotate) setState({ autoRotate: true, rotateDir: 1 })
          else setState({ rotateDir: rotateDir === 1 ? -1 : 1 })
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 3 }}>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          {autoRotate ? (rotateDir === 1 ? '顺时针' : '逆时针') : '旋转'}
        </button>
        {autoRotate && (
          <button className="bb-btn" onClick={() => setState({ autoRotate: false })} title="停止旋转">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 3 }}>
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            停止
          </button>
        )}
        {autoRotate && (
          <span className="bb-speed" title="转速">
            <input type="range" min="0.5" max="5" step="0.1" value={rotateSpeed}
              onChange={(e) => setState({ rotateSpeed: parseFloat(e.target.value) })} />
            <span className="bb-speed-val">{rotateSpeed.toFixed(1)}×</span>
          </span>
        )}
        <button className="bb-btn" onClick={() => setState((s) => ({ recenterKey: s.recenterKey + 1 }))} title="居中视角">
          ⌖ 居中
        </button>
        <button className="bb-btn" onClick={toggleFullscreen} title="全屏">⛶ 全屏</button>
        <button className="bb-btn" onClick={() => setState({ immersive: true })} title="纯净沉浸模式（双击退出）">👁 沉浸</button>
        <button className={`bb-btn ${showWalls ? 'active' : ''}`} onClick={() => setState({ showWalls: !showWalls })} title="去除/显示墙壁">
          🧱 墙
        </button>
        <button className={`bb-btn ${showOpenings ? 'active' : ''}`} onClick={() => setState({ showOpenings: !showOpenings })} title="显示/去除门窗">
          🚪 门窗
        </button>
        <button className={`bb-btn ${showCeiling ? 'active' : ''}`} onClick={() => setState({ showCeiling: !showCeiling })} title="显示/去除屋顶">
          🏠 屋顶
        </button>
        <div style={{ position: 'relative' }}>
          <button className="bb-btn" onClick={() => setViewOpen(!viewOpen)} title="切换视角">👁 视图</button>
          {viewOpen && (
            <div className="bb-menu">
              <button className="bb-menu-item" onClick={() => setView('default')}>🏠 默认视图</button>
              <button className="bb-menu-item" onClick={() => setView('top')}>⬇ 上视图</button>
              <button className="bb-menu-item" onClick={() => setView('front')}>⬆ 前视图</button>
              <div className="bb-menu-sep" />
              <button className="bb-menu-item" onClick={() => { saveView(); setViewOpen(false) }}>💾 保存当前视角</button>
              {customViews.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="bb-menu-item" style={{ flex: 1 }} onClick={() => setView('custom:' + v.id)}>📷 {v.name}</button>
                  <button style={{ padding: '2px 6px', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }} onClick={() => delView(v.id)} title="删除">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className={`bb-btn ${night ? 'active' : ''}`} onClick={() => setState({ night: !night })} title="日间/夜间">
          {night ? '🌙 夜间' : '☀️ 日间'}
        </button>
      </div>
      <div className="bb-group">
        <button className="bb-btn" onClick={() => setState({ sceneOpen: true })} title="场景同步">🎬 场景</button>
        <button className="bb-btn" onClick={() => setState({ notifOpen: true })} title="通知中心">🔔 通知</button>
        <button className="bb-btn" onClick={() => setState({ deviceListOpen: true })} title="查看已绑定设备">设备{deviceCount}</button>
        <button className={`bb-btn ${editing ? 'active' : ''}`} onClick={() => {
          if (editing) setState({ editing: false, view2d: false, tool: 'select' })
          else setState({ editing: true, view2d: true })
        }}>
          {editing ? '退出编辑' : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 3 }}>
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              编辑
            </>
          )}
        </button>
        <button className="bb-btn" onClick={() => setState({ settingsOpen: true })}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 3 }}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          设置
        </button>
      </div>
      <div className="bb-group">
        {MODES.map((m) => (
          <button key={m} className={`bb-btn ${mode === m ? 'active' : ''}`} onClick={() => setState({ mode: m })}>
            {m}
          </button>
        ))}
      </div>
    </div>
  )
}
