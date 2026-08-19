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

// 可编辑按钮的默认顺序（id 列表）
const DEFAULT_ORDER = ['rotate', 'center', 'room', 'fps', 'fullscreen', 'immersive', 'wall', 'openings', 'ceiling', 'view', 'night', 'scene', 'notif', 'device', 'edit', 'settings', 'baredit']

// 设置里的选项（可加到工具栏作为实时开关；改的是 store 状态，不持久化——刷新后回设置里的默认值）
const SETTING_TOGGLES = [
  { key: 'showLabels', label: '显示设备名' },
  { key: 'camFocusOnModel', label: '模型聚焦' },
  { key: 'smoothFocus', label: '平滑聚焦' },
  { key: 'hoverTip', label: '悬停提示' },
  { key: 'mihomeMode', label: '米家模式' },
  { key: 'glassMode', label: '原版玻璃' },
  { key: 'showWalls', label: '显示墙' },
  { key: 'showOpenings', label: '显示门窗' },
  { key: 'showCeiling', label: '显示屋顶' },
  { key: 'showFps', label: '帧率' },
  { key: 'shadows', label: '投影' },
  { key: 'bloom', label: '泛光' },
  { key: 'sunLight', label: '太阳光' },
  { key: 'roomBorderLines', label: '分隔线' },
  { key: 'roomBorderAlwaysVisible', label: '分隔线不隐藏' },
  { key: 'roomBorderSkipDoors', label: '分隔线跳过门' },
]
// 这些设置选项已有对应的图标工具栏按钮（不重复添加）
const SETTING_EXISTING_BTN = { showWalls: 'wall', showOpenings: 'openings', showCeiling: 'ceiling' }

export default function BottomBar() {
  const mode = useStore((s) => s.mode)
  // 订阅所有可加到工具栏的设置选项（点击实时切换、按钮高亮跟随）
  const toggleVals = Object.fromEntries(SETTING_TOGGLES.map((t) => [t.key, useStore((s) => s[t.key])]))
  const autoRotate = useStore((s) => s.autoRotate)
  const rotateDir = useStore((s) => s.rotateDir)
  const rotateSpeed = useStore((s) => s.rotateSpeed)
  const showWalls = useStore((s) => s.showWalls)
  const showOpenings = useStore((s) => s.showOpenings)
  const showCeiling = useStore((s) => s.showCeiling)
  const night = useStore((s) => s.night)
  const sunAuto = useStore((s) => s.sunAuto)
  const editing = useStore((s) => s.editing)
  const project = useStore((s) => s.project)
  const settings = useStore((s) => s.settings)
  const sceneOpen = useStore((s) => s.sceneOpen)
  const notifOpen = useStore((s) => s.notifOpen)
  const roomNavOpen = useStore((s) => s.roomNavOpen)
  const fpsMode = useStore((s) => s.fpsMode)
  const deviceCount = new Set(project.floors.flatMap((f) => (f.devices || []).map((d) => d.entity_id))).size
  const [viewOpen, setViewOpen] = useState(false)
  const [barEditOpen, setBarEditOpen] = useState(false)
  // 工具栏编辑面板：点击空白处收回（点面板内或工具栏按钮不关）
  useEffect(() => {
    if (!barEditOpen) return
    const onDown = (e) => {
      if (e.target.closest && (e.target.closest('.bb-edit-panel') || e.target.closest('.bb-btn'))) return
      setBarEditOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [barEditOpen])
  const customViews = useStore((s) => s.customViews)

  const setView = (type) => {
    setState((s) => ({ camViewSignal: { type, n: s.camViewSignal.n + 1 } }))
    setViewOpen(false)
  }
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

  useEffect(() => {
    if (!viewOpen) return
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('.bb-menu')) return
      setViewOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [viewOpen])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.()
  }

  // ---------- 工具栏按钮（数据驱动：id -> 渲染函数，支持排序/隐藏） ----------
  const BTNS = {
    fps: {
      label: '第一人称',
      render: () => (
        <button key="fps" className={`bb-btn ${fpsMode ? 'active' : ''}`} onClick={() => setState((s) => ({ fpsMode: !s.fpsMode, editing: false, settingsOpen: false, view2d: false, roomNavOpen: false, selected: null }))} title="第一人称浏览：WASD 移动 + 鼠标左键拖动转向">
          <Ic><path d="M12 3v18M4 8l8-5 8 5M4 16l8 5 8-5" /></Ic>第一人称
        </button>
      ),
    },
    rotate: {
      label: '旋转',
      render: () => (
        <span key="rotate" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button className={`bb-btn ${autoRotate ? 'active' : ''}`} onClick={() => {
            if (!autoRotate) setState({ autoRotate: true, rotateDir: 1 })
            else setState({ rotateDir: rotateDir === 1 ? -1 : 1 })
          }}>
            <Ic><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></Ic>
            {autoRotate ? (rotateDir === 1 ? '顺时针' : '逆时针') : '旋转'}
          </button>
          {autoRotate && (
            <button className="bb-btn" onClick={() => setState({ autoRotate: false })} title="停止旋转">
              <Ic><rect x="6" y="6" width="12" height="12" rx="1" /></Ic>停止
            </button>
          )}
          {autoRotate && (
            <span className="bb-speed" title="转速">
              <input type="range" min="0.5" max={settings.rotateSpeedMax || 5} step="0.1" value={rotateSpeed}
                onChange={(e) => setState({ rotateSpeed: parseFloat(e.target.value) })} />
              <span className="bb-speed-val">{rotateSpeed.toFixed(1)}×</span>
            </span>
          )}
        </span>
      ),
    },
    center: {
      label: '居中',
      render: () => (
        <button key="center" className="bb-btn" onClick={() => setState((s) => ({ recenterKey: s.recenterKey + 1 }))} title="居中视角">
          <Ic><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></Ic>居中
        </button>
      ),
    },
    room: {
      label: '房间',
      render: () => (
        <button key="room" className={`bb-btn room-btn ${roomNavOpen ? 'active' : ''}`} onClick={() => setState((s) => ({ roomNavOpen: !s.roomNavOpen }))} title="房间导航（跳转到单个房间/全部）">
          <Ic><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Ic>房间
        </button>
      ),
    },
    fullscreen: {
      label: '全屏',
      render: () => (
        <button key="fullscreen" className="bb-btn" onClick={toggleFullscreen} title="全屏">
          <Ic><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></Ic>全屏
        </button>
      ),
    },
    immersive: {
      label: '沉浸',
      render: () => (
        <button key="immersive" className="bb-btn" onClick={() => setState({ immersive: true })} title="纯净沉浸模式（双击退出）">
          <Ic><path d="M17.94 17.94A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" /></Ic>沉浸
        </button>
      ),
    },
    wall: {
      label: '墙',
      render: () => (
        <button key="wall" className={`bb-btn ${showWalls ? 'active' : ''}`} onClick={() => setState({ showWalls: !showWalls })} title="去除/显示墙壁">
          <Ic><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18M3 15h18M9 9v6M15 15v6" /></Ic>墙
        </button>
      ),
    },
    openings: {
      label: '门窗',
      render: () => (
        <button key="openings" className={`bb-btn ${showOpenings ? 'active' : ''}`} onClick={() => setState({ showOpenings: !showOpenings })} title="显示/去除门窗">
          <Ic><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M12 3v18" /><circle cx="16" cy="12" r="0.5" /></Ic>门窗
        </button>
      ),
    },
    ceiling: {
      label: '屋顶',
      render: () => (
        <button key="ceiling" className={`bb-btn ${showCeiling ? 'active' : ''}`} onClick={() => setState({ showCeiling: !showCeiling })} title="显示/去除屋顶">
          <Ic><path d="M3 10l9-7 9 7" /><path d="M5 9v11h14V9" /></Ic>屋顶
        </button>
      ),
    },
    view: {
      label: '视图',
      render: () => (
        <span key="view" style={{ position: 'relative', display: 'inline-block' }}>
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
        </span>
      ),
    },
    night: {
      label: '日间/夜间',
      render: () => (
        <button key="night" className={`bb-btn ${sunAuto || night ? 'active' : ''}`} onClick={() => {
          const s = getState()
          if (s.sunAuto) setState({ sunAuto: false, night: false })   // 自动 → 日间
          else if (!s.night) setState({ night: true })                 // 日间 → 夜间
          else setState({ sunAuto: true })                             // 夜间 → 自动
        }} title="日夜：自动(跟太阳) / 日间 / 夜间 循环切换">
          {sunAuto
            ? <Ic><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Ic>
            : night
              ? <Ic><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Ic>
              : <Ic><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Ic>}
          {sunAuto ? '自动' : (night ? '夜间' : '日间')}
        </button>
      ),
    },
    scene: {
      label: '场景',
      render: () => (
        <button key="scene" className={`bb-btn ${sceneOpen ? 'active' : ''}`} onClick={() => setState((s) => ({ sceneOpen: !s.sceneOpen }))} title="场景同步">
          <Ic><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></Ic>场景
        </button>
      ),
    },
    notif: {
      label: '通知',
      render: () => (
        <button key="notif" className={`bb-btn notif-btn ${notifOpen ? 'active' : ''}`} onClick={() => setState((s) => ({ notifOpen: !s.notifOpen }))} title="通知中心">
          <Ic><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></Ic>通知
        </button>
      ),
    },
    device: {
      label: '设备',
      render: () => (
        <button key="device" className="bb-btn" onClick={() => setState({ deviceListOpen: true })} title="查看已绑定设备">
          <Ic><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" /></Ic>设备{deviceCount}
        </button>
      ),
    },
    edit: {
      label: '编辑',
      render: () => (
        <button key="edit" className={`bb-btn ${editing ? 'active' : ''}`} onClick={() => {
          if (editing) setState((s) => ({ editing: false, view2d: false, tool: 'select', focusRoomId: s.roomEditId, roomEditId: null }))
          else setState({ editing: true, view2d: true, roomEditId: null, focusRoomId: null, roomNavOpen: false })
        }}>
          {editing ? '退出编辑' : (
            <>
              <Ic><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></Ic>编辑
            </>
          )}
        </button>
      ),
    },
    settings: {
      label: '设置',
      render: () => (
        <button key="settings" className="bb-btn settings-btn" onClick={() => setState((s) => ({ settingsOpen: !s.settingsOpen }))}>
          <Ic><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Ic>设置
        </button>
      ),
    },
    baredit: {
      label: '工具栏',
      render: () => (
        <button key="baredit" className={`bb-btn ${barEditOpen ? 'active' : ''}`} onClick={() => setBarEditOpen(!barEditOpen)} title="编辑工具栏按钮顺序/有无">
          <Ic><path d="M4 6h16M4 12h16M4 18h10" /></Ic>工具栏
        </button>
      ),
    },
  }

  // 设置里的选项也加进工具栏（实时切换，不持久化——刷新后回设置里的默认值；已有图标按钮的跳过）
  for (const t of SETTING_TOGGLES) {
    if (BTNS[t.key]) continue
    if (SETTING_EXISTING_BTN[t.key] && BTNS[SETTING_EXISTING_BTN[t.key]]) continue
    BTNS[t.key] = {
      label: t.label,
      render: () => (
        <button key={t.key} className={`bb-btn ${toggleVals[t.key] ? 'active' : ''}`} onClick={() => setState({ [t.key]: !toggleVals[t.key] })} title={t.label}>
          {t.label}
        </button>
      ),
    }
  }

  // ---------- 顺序 + 隐藏 ----------
  // 用户可能自定义过 toolbarOrder（不含后来新增的按钮），这里把 DEFAULT_ORDER 里缺失的按钮补插进去
  const order = (() => {
    const base = (settings.toolbarOrder && settings.toolbarOrder.length) ? settings.toolbarOrder : DEFAULT_ORDER
    const o = [...base]
    for (const id of DEFAULT_ORDER) {
      if (o.includes(id)) continue
      const di = DEFAULT_ORDER.indexOf(id)
      let insertAt = -1
      for (let j = di - 1; j >= 0; j--) {
        const p = o.indexOf(DEFAULT_ORDER[j])
        if (p >= 0) { insertAt = p; break }
      }
      o.splice(insertAt + 1, 0, id)
    }
    return o
  })()
  const hidden = settings.toolbarHidden || []

  const persistBar = (nextOrder, nextHidden) => {
    const s = { ...getState().settings, toolbarOrder: nextOrder, toolbarHidden: nextHidden }
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
  }
  const moveBtn = (id, dir) => {
    const idx = order.indexOf(id)
    const j = idx + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    persistBar(next, hidden)
  }
  const removeBtn = (id) => {
    // 叉移除 = 加入隐藏列表（从工具栏消失，进入下方可添加区；保留在 order 里，避免 DEFAULT_ORDER 补插逻辑把它加回来）
    persistBar(order, [...hidden.filter((x) => x !== id), id])
  }

  // 渲染可见按钮
  const visible = order.filter((id) => BTNS[id] && !hidden.includes(id))

  return (
    <div className="bottom-bar">
      <div className="bb-group">
        {visible.map((id) => BTNS[id].render())}
      </div>
      <div className="bb-group">
        {MODES.map((m) => (
          <button key={m} className={`bb-btn ${mode === m ? 'active' : ''}`} onClick={() => setState({ mode: m })}>
            {m}
          </button>
        ))}
      </div>

      {/* 工具栏编辑面板 */}
      {barEditOpen && (
        <div className="bb-edit-panel">
          <div className="bb-edit-head">工具栏按钮（↑↓排序 · ✕移除后到下方可加回）</div>
          {order.filter((id) => id !== 'baredit' && !hidden.includes(id)).map((id) => {
            const b = BTNS[id]
            if (!b) return null
            return (
              <div key={id} className="bb-edit-row">
                <button className="bb-edit-arrow" onClick={() => moveBtn(id, -1)} title="上移">↑</button>
                <button className="bb-edit-arrow" onClick={() => moveBtn(id, 1)} title="下移">↓</button>
                <span className="bb-edit-label">{b.label}</span>
                <button className="bb-edit-del" onClick={() => removeBtn(id)} title="移除">✕</button>
              </div>
            )
          })}
          <div className="bb-edit-add">
            <div className="bb-edit-head">已移除 / 可添加（点击加入工具栏）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 10px 8px' }}>
              {hidden.filter((id) => id !== 'baredit' && BTNS[id]).map((id) => (
                <button key={id} className="bb-edit-addbtn" onClick={() => persistBar(order, hidden.filter((x) => x !== id))}>+ {BTNS[id].label}</button>
              ))}
              {SETTING_TOGGLES.filter((t) => !order.includes(t.key) && !(SETTING_EXISTING_BTN[t.key] && BTNS[SETTING_EXISTING_BTN[t.key]])).map((t) => (
                <button key={t.key} className="bb-edit-addbtn" onClick={() => persistBar([...order, t.key], hidden)}>+ {t.label}</button>
              ))}
            </div>
          </div>
          <button className="bb-edit-close" onClick={() => setBarEditOpen(false)}>完成</button>
        </div>
      )}
    </div>
  )
}
