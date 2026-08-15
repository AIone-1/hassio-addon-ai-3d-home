import { useStore, setState, getState, toast } from '../store'
import { api } from '../api'
import { useState, useEffect } from 'react'

const MODES = ['全屋', '结构']

// 线图图标（统一 stroke 风格，简单清晰）
const Ic = ({ children }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 3 }}>
    {children}
  </svg>
)

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
  const sceneOpen = useStore((s) => s.sceneOpen)
  const notifOpen = useStore((s) => s.notifOpen)
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
          <Ic><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></Ic>居中
        </button>
        <button className="bb-btn" onClick={toggleFullscreen} title="全屏">
          <Ic><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></Ic>全屏
        </button>
        <button className="bb-btn" onClick={() => setState({ immersive: true })} title="纯净沉浸模式（双击退出）">
          <Ic><path d="M17.94 17.94A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" /></Ic>沉浸
        </button>
        <button className={`bb-btn ${showWalls ? 'active' : ''}`} onClick={() => setState({ showWalls: !showWalls })} title="去除/显示墙壁">
          <Ic><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18M3 15h18M9 9v6M15 15v6" /></Ic>墙
        </button>
        <button className={`bb-btn ${showOpenings ? 'active' : ''}`} onClick={() => setState({ showOpenings: !showOpenings })} title="显示/去除门窗">
          <Ic><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M12 3v18" /><circle cx="16" cy="12" r="0.5" /></Ic>门窗
        </button>
        <button className={`bb-btn ${showCeiling ? 'active' : ''}`} onClick={() => setState({ showCeiling: !showCeiling })} title="显示/去除屋顶">
          <Ic><path d="M3 10l9-7 9 7" /><path d="M5 9v11h14V9" /></Ic>屋顶
        </button>
        <div style={{ position: 'relative' }}>
          <button className="bb-btn" onClick={() => setViewOpen(!viewOpen)} title="切换视角">
            <Ic><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Ic>视图
          </button>
          {viewOpen && (
            <div className="bb-menu">
              <button className="bb-menu-item" onClick={() => setView('default')}><Ic><path d="M3 10l9-7 9 7" /><path d="M5 9v11h14V9" /></Ic>主视图</button>
              <button className="bb-menu-item" onClick={() => setView('top')}><Ic><path d="M12 3v18M6 15l6 6 6-6" /></Ic>上视图</button>
              <button className="bb-menu-item" onClick={() => setView('front')}><Ic><path d="M12 21V3M6 9l6-6 6 6" /></Ic>前视图</button>
              <div className="bb-menu-sep" />
              <button className="bb-menu-item" onClick={() => { saveView(); setViewOpen(false) }}><Ic><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></Ic>保存当前视角</button>
              {customViews.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="bb-menu-item" style={{ flex: 1 }} onClick={() => setView('custom:' + v.id)}><Ic><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></Ic>{v.name}</button>
                  <button style={{ padding: '2px 6px', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }} onClick={() => delView(v.id)} title="删除">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className={`bb-btn ${night ? 'active' : ''}`} onClick={() => setState({ night: !night, sunAuto: false })} title="日间/夜间（点一次后改为手动，不再跟太阳）">
          {night
            ? <Ic><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Ic>
            : <Ic><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Ic>}
          {night ? '夜间' : '日间'}
        </button>
      </div>
      <div className="bb-group">
        <button className={`bb-btn ${sceneOpen ? 'active' : ''}`} onClick={() => setState((s) => ({ sceneOpen: !s.sceneOpen }))} title="场景同步">
          <Ic><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></Ic>场景
        </button>
        <button className={`bb-btn notif-btn ${notifOpen ? 'active' : ''}`} onClick={() => setState((s) => ({ notifOpen: !s.notifOpen }))} title="通知中心">
          <Ic><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></Ic>通知
        </button>
        <button className="bb-btn" onClick={() => setState({ deviceListOpen: true })} title="查看已绑定设备">
          <Ic><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" /></Ic>设备{deviceCount}
        </button>
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
