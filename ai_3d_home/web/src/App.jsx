import { useEffect, useRef, useState, useCallback } from 'react'
import Viewer from './components/Viewer'
import PlanEditor from './components/PlanEditor'
import BottomBar from './components/BottomBar'
import Editor from './components/Editor'
import BindDrawer from './components/BindDrawer'
import DeviceList from './components/DeviceList'
import { useStore, setState, getState, toast, loadProject } from './store'
import { api, TOGGLE_DOMAINS, BASE } from './api'
import { roomsToWalls, recomputeRooms } from './three/geometry'
import { loadCatalog } from './catalog'

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
  const view2d = useStore((s) => s.view2d)
  const immersive = useStore((s) => s.immersive)
  const settings = useStore((s) => s.settings)
  const quality = useStore((s) => s.quality)
  const shadows = useStore((s) => s.shadows)
  const autoRotate = useStore((s) => s.autoRotate)
  const rotateDir = useStore((s) => s.rotateDir)
  const rotateSpeed = useStore((s) => s.rotateSpeed)
  const [deviceModal, setDeviceModal] = useState(null)
  const [bgImages, setBgImages] = useState([])
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
          quality: settings.quality || 'high',
          shadows: settings.shadows !== undefined ? settings.shadows : true,
          autoRotate: !!settings.autoRotate,
          rotateDir: settings.rotateDir || 1,
          rotateSpeed: settings.rotateSpeed || 1,
          immersive: !!settings.immersive,
          night: !!settings.night,
          bgImage: settings.bgImage || '',
          bgMode: settings.bgMode || 'color',
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

  // ---------- 键盘快捷键 ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // ESC：退出编辑 + 清选中/弹窗（画墙草稿由 PlanEditor 自身管理，随卸载清空）
        setDeviceModal(null)
        setState({ editing: false, bindOpen: false, pendingEntity: null, selected: null, view2d: false, settingsOpen: false, tool: 'select' })
      }
      // 工具快捷键 V/M/G/H/W/D/N/F/E/B
      const map = { v: 'select', m: 'move', g: 'movePlan', h: 'pan', w: 'wall', d: 'door', n: 'window', x: 'cut', f: 'furniture', e: 'device', b: 'texture' }
      if (map[e.key.toLowerCase()] && editing) {
        setState({ tool: map[e.key.toLowerCase()] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const devState = deviceModal ? haStates[deviceModal.entity_id] : null
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
            <div className="dname">设置</div>
            {/* 默认选项 */}
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
