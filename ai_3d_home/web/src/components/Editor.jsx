import { useState, useMemo } from 'react'
import { useStore, setState, currentFloor, getState, toast } from '../store'
import { api } from '../api'
import { FURNITURE_LIB, FURNITURE_COLORS } from '../three/geometry'
import { thumbUrl } from '../catalog'

const LEFT_TOOLS = [
  { id: 'select', label: '选择', k: 'V' },
  { id: 'move', label: '移动', k: 'M' },
  { id: 'movePlan', label: '移动户型', k: 'G' },
  { id: 'pan', label: '平移', k: 'H' },
  { id: 'wall', label: '墙体', k: 'W' },
  { id: 'door', label: '门', k: 'D' },
  { id: 'window', label: '窗', k: 'N' },
  { id: 'furniture', label: '家具', k: 'F' },
  { id: 'device', label: '设备', k: 'E' },
  { id: 'texture', label: '贴图', k: 'B' },
  { id: 'delete', label: '删除', k: 'Del' },
]

export default function Editor() {
  const tool = useStore((s) => s.tool)
  const furnitureType = useStore((s) => s.furnitureType)
  const snap = useStore((s) => s.snap)
  const snapStep = useStore((s) => s.snapStep)
  const showLabels = useStore((s) => s.showLabels)
  const showFurnitureLabels = useStore((s) => s.showFurnitureLabels)
  const planImage = useStore((s) => s.planImage)
  const settings = useStore((s) => s.settings)
  const view2d = useStore((s) => s.view2d)
  const mode = useStore((s) => s.mode)
  const project = useStore((s) => s.project)
  const modelCatalog = useStore((s) => s.modelCatalog)
  const furnitureScale = useStore((s) => s.furnitureScale)
  const floor = currentFloor()
  const [furnOpen, setFurnOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [openCats, setOpenCats] = useState({})
  const [backups, setBackups] = useState([])
  const [backupOpen, setBackupOpen] = useState(false)
  const [defaultOpen, setDefaultOpen] = useState(false)
  const [previewModel, setPreviewModel] = useState(null)

  // 下载模型按中文分类分组
  const groupedCatalog = useMemo(() => {
    const m = {}
    for (const it of modelCatalog) {
      if (!m[it.label]) m[it.label] = []
      m[it.label].push(it)
    }
    return m
  }, [modelCatalog])

  const setTool = (t) => {
    setState({ tool: t })
    if (t === 'furniture') setFurnOpen(true)
    else if (t === 'device') { setState({ bindOpen: true }); setFurnOpen(false) }
    else if (t === 'wall') {
      setFurnOpen(false); setCatOpen(false)
      toast('画墙：点画布放墙点，点回起点或按 Enter 闭合生成房间')
    } else { setFurnOpen(false); setCatOpen(false) }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `户型图.json`
    a.click()
  }
  // 取 2D 平面图 SVG（内联 .plan-* 样式，否则导出黑白的）
  const getPlanSvg = () => {
    const svg = document.querySelector('.plan-editor')
    if (!svg) return null
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const r = svg.getBoundingClientRect()
    clone.setAttribute('width', r.width)
    clone.setAttribute('height', r.height)
    let css = ''
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes('plan-')) {
            css += rule.cssText + '\n'
          }
        }
      } catch (e) {}
    }
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = css
    clone.insertBefore(style, clone.firstChild)
    return clone
  }
  // 导出 SVG 矢量平面图
  const exportSVG = () => {
    const svg = getPlanSvg()
    if (!svg) return toast('请先进 2D 编辑模式')
    const xml = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([xml], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '户型图.svg'
    a.click()
  }
  // 导出 PNG 图片（2D 平面图截图）
  const exportPNG = () => {
    const svg = getPlanSvg()
    if (!svg) return toast('请先进 2D 编辑模式')
    const xml = new XMLSerializer().serializeToString(svg)
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, img.width, img.height)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = '户型图.png'
      a.click()
    }
    img.src = url
  }
  // 导入底图（照着画户型）
  const importPlanImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const f = input.files[0]
      if (!f) return
      const reader = new FileReader()
      reader.onload = () => { setState({ planImage: reader.result }); toast('底图已导入，可拖拽缩放对齐后照着画') }
      reader.readAsDataURL(f)
    }
    input.click()
  }
  const removePlanImage = () => { setState({ planImage: '' }); toast('底图已删除') }
  const saveDefault = (patch) => {
    const s = { ...getState().settings, ...patch }
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
  }
  // 隐藏（删除）某个下载模型，不再显示
  const hideModel = (m) => {
    const hidden = getState().settings.hiddenModels || []
    if (hidden.includes(m.type)) return
    const s = { ...getState().settings, hiddenModels: [...hidden, m.type] }
    setState({ settings: s })
    api.saveSettings(s).catch(() => {})
    toast(`已隐藏「${m.label}」`)
  }

  const importJson = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const f = input.files[0]
      if (!f) return
      try {
        const p = JSON.parse(await f.text())
        if (p && Array.isArray(p.floors)) {
          setState({ project: p, currentFloor: 0 })
        }
      } catch (e) { alert('JSON 解析失败') }
    }
    input.click()
  }

  const resetFloor = () => {
    if (!floor) return
    if (!confirm(`重置当前户型「${floor.name}」？将清空该楼层所有内容。`)) return
    floor.rooms = []; floor.walls = []; floor.furniture = []; floor.devices = []; floor.openings = []
    setState({ project: { ...project }, saved: false })
  }

  const clearAll = () => {
    if (!confirm('一键清空图纸？将删除所有楼层和房间（不可撤销）。')) return
    setState({
      project: { version: 1, floors: [{ id: Math.random().toString(36).slice(2, 10), name: '一层', level: 0, height: 2.8, color: '#e6dcc8', rooms: [], walls: [], furniture: [], devices: [], openings: [] }] },
      currentFloor: 0, selected: null, saved: false,
    })
    toast('图纸已清空')
  }

  const saveNow = async () => {
    try {
      await api.saveProject(getState().project)
      setState({ saved: true })
      toast('已保存 ✓')
    } catch (e) { toast('保存失败') }
  }
  // 存档：创建带时间戳的副本
  const createBackup = async () => {
    try { await api.backup() } catch (e) {}
  }
  const openBackups = async () => {
    try {
      const r = await api.backups()
      setBackups(r.backups || [])
    } catch (e) { setBackups([]) }
    setBackupOpen(true)
  }
  const restoreBackup = async (name) => {
    if (!confirm(`恢复存档 ${name}？将覆盖当前户型。`)) return
    try {
      const r = await api.backupRestore(name)
      if (r.ok && r.project) {
        setState({ project: r.project, currentFloor: 0, selected: null, saved: true })
        toast('已恢复存档')
        setBackupOpen(false)
      }
    } catch (e) { toast('恢复失败') }
  }

  const duplicateFloor = () => {
    const idx = project.floors.findIndex((f) => f === floor)
    const copy = JSON.parse(JSON.stringify(floor))
    copy.id = Math.random().toString(36).slice(2, 10)
    copy.name = `${floor.name} 副本`
    copy.level = (floor.level || 0) + 3
    project.floors.splice(idx + 1, 0, copy)
    setState({ project: { ...project }, currentFloor: idx + 1 })
  }

  const deleteFloor = () => {
    if (project.floors.length <= 1) { alert('至少保留一层'); return }
    if (!confirm(`删除楼层「${floor.name}」？`)) return
    const idx = project.floors.findIndex((f) => f === floor)
    project.floors.splice(idx, 1)
    setState({ project: { ...project }, currentFloor: Math.max(0, idx - 1) })
  }

  return (
    <>
      {/* 顶部工具栏 */}
      <div className="editor-top">
        <button className="et-btn" onClick={() => setState({ mode: '全屋' })}>{mode}</button>
        <button className="et-btn" onClick={openBackups}>最近备份</button>
        <button className="et-btn" onClick={importPlanImage}>导入底图</button>
        <button className="et-btn" onClick={() => setDefaultOpen(true)}>默认</button>
        {planImage && (
          <>
            <button className="et-btn" onClick={() => setState(s => ({ planImageScale: (s.planImageScale || 1) * 1.25 }))} title="放大底图">底图＋</button>
            <button className="et-btn" onClick={() => setState(s => ({ planImageScale: (s.planImageScale || 1) / 1.25 }))} title="缩小底图">底图−</button>
            <button className="et-btn" onClick={removePlanImage} style={{ color: 'var(--danger)' }}>删除底图</button>
          </>
        )}
        <button className="et-btn" onClick={exportPNG}>导出图</button>
        <button className="et-btn" onClick={exportSVG}>导出 SVG</button>
        <button className="et-btn" onClick={exportJson}>导出 JSON</button>
        <button className="et-btn" onClick={resetFloor} style={{ color: 'var(--danger)' }}>清空当前层</button>
        <button className="et-btn" onClick={clearAll} style={{ color: 'var(--danger)' }}>清空全部</button>
        <button className="et-btn" onClick={() => { saveNow(); createBackup() }} style={{ color: 'var(--accent)' }}>保存</button>
        <div className="et-sep" />
        <button className="et-btn" onClick={() => setState(s => ({ planZoomDelta: s.planZoomDelta - 1 }))} title="缩小">−</button>
        <button className="et-btn" onClick={() => setState(s => ({ planZoomDelta: s.planZoomDelta + 1 }))} title="放大">＋</button>
        <button className="et-btn" onClick={() => setState(s => ({ planRecenterKey: s.planRecenterKey + 1 }))} title="居中">居中</button>
        <div className="et-sep" />
        <button className="et-btn" onClick={duplicateFloor}>复制当前层</button>
        <button className="et-btn" onClick={deleteFloor} style={{ color: 'var(--danger)' }}>删除楼层</button>
        <div className="et-sep" />

        {/* 家具库 */}
        <button className="et-btn" onClick={() => setCatOpen(false) + setFurnOpen(!furnOpen)}>模型</button>
        {furnOpen && (
          <div className="furn-picker">
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '0 4px 8px' }}>
              共 {FURNITURE_LIB.length + modelCatalog.filter((m) => !(settings.hiddenModels || []).includes(m.type)).length} 个模型
            </div>
            {/* 尺寸选择 */}
            <div className="furn-size">
              <span className="furn-size-label">尺寸</span>
              {[0.6, 0.8, 1, 1.2, 1.5].map((s) => (
                <button key={s} className={`furn-size-btn ${furnitureScale === s ? 'active' : ''}`}
                  onClick={() => setState({ furnitureScale: s })}>
                  {Math.round(s * 100)}%
                </button>
              ))}
            </div>
            {/* 内置家具（程序化建模） */}
            <div className="furn-cat" onClick={() => setOpenCats(o => ({ ...o, 内置: !o['内置'] }))}>
              <span className="furn-cat-label">内置家具</span>
              <span className="furn-cat-count">{FURNITURE_LIB.length}</span>
              <span className="furn-cat-arrow">{openCats['内置'] ? '▾' : '▸'}</span>
            </div>
            {openCats['内置'] && (
              <div className="furn-items">
                {FURNITURE_LIB.map((f) => (
                  <button key={f.type}
                    className={`furn-item ${furnitureType === f.type ? 'active' : ''}`}
                    onClick={() => setPreviewModel({ type: f.type, label: f.type, w: f.w, d: f.d, h: f.h, color: FURNITURE_COLORS[f.type] || '#888', builtin: true })} title="点击预览">
                    <span className="furn-swatch" style={{ background: FURNITURE_COLORS[f.type] || '#888' }} />
                    {f.type}
                    <span className="furn-dim"> {f.w}×{f.d}m</span>
                  </button>
                ))}
              </div>
            )}
            {/* 下载模型（按分类折叠） */}
            {Object.entries(groupedCatalog).map(([label, items]) => (
              <div key={label}>
                <div className="furn-cat" onClick={() => setOpenCats(o => ({ ...o, [label]: !o[label] }))}>
                  <span className="furn-cat-label">{label}</span>
                  <span className="furn-cat-count">{items.length}</span>
                  <span className="furn-cat-arrow">{openCats[label] ? '▾' : '▸'}</span>
                </div>
                {openCats[label] && (
                  <div className="furn-items">
                    {items.filter((m) => !(settings.hiddenModels || []).includes(m.type)).map((m) => (
                      <button key={m.type}
                        className={`furn-item ${furnitureType === m.type ? 'active' : ''}`}
                        onClick={() => setPreviewModel(m)} title="点击预览">
                        <img className="furn-thumb" src={thumbUrl(m.thumb)} alt={m.label} loading="lazy" />
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="et-sep" />

        {/* 设备分类 */}
        <button className="et-btn" onClick={() => setFurnOpen(false) + setCatOpen(!catOpen)}>设备</button>
        <button className="et-btn" onClick={() => { setState({ tool: 'device', bindOpen: true, bindCat: '全部' }); setFurnOpen(false); setCatOpen(false) }}>绑定设备</button>
        {catOpen && (
          <div className="furn-picker">
            {['全部', '灯光', '开关', '窗帘', '空调', '传感器', '感应器', '摄像机', '风扇', '安防'].map((c) => (
              <button key={c} className="furn-item" onClick={() => { setState({ tool: 'device', bindOpen: true, bindCat: c }); setCatOpen(false) }}>{c}</button>
            ))}
          </div>
        )}
        <div className="et-sep" />

        <button className={`et-btn ${snap ? 'active' : ''}`} onClick={() => setState({ snap: !snap })}>吸附</button>
        <button className="et-btn" title="吸附精度（点击切换）"
          onClick={() => { const o = [0.1, 0.25, 0.5, 1]; setState({ snapStep: o[(o.indexOf(snapStep) + 1) % o.length] }) }}>
          {snapStep}m</button>
        <button className={`et-btn ${showLabels ? 'active' : ''}`} onClick={() => setState({ showLabels: !showLabels })}>标签</button>
        <button className={`et-btn ${showFurnitureLabels ? 'active' : ''}`} onClick={() => setState({ showFurnitureLabels: !showFurnitureLabels })}>名字</button>
        <button className={`et-btn ${view2d ? 'active' : ''}`} onClick={() => setState({ view2d: !view2d })}>2D</button>
        <button className={`et-btn ${!view2d ? 'active' : ''}`} onClick={() => setState({ view2d: false })}>3D</button>
        <div style={{ flex: 1 }} />
        <span className="et-label">HA 已连接</span>
      </div>

      {/* 左侧竖排工具 */}
      <div className="editor-left">
        {LEFT_TOOLS.map((t) => (
          <button key={t.id}
            className={`el-btn ${tool === t.id ? 'active' : ''} ${t.id === 'delete' ? 'danger' : ''}`}
            onClick={() => setTool(t.id)}
            title={t.label}>
            {t.label}<span className="k">{t.k}</span>
          </button>
        ))}
      </div>

      {/* 存档列表弹窗 */}
      {backupOpen && (
        <div className="modal-mask" onClick={() => setBackupOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="dname">历史存档</div>
            {backups.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '10px 0' }}>还没有存档。点「保存」会自动创建一份存档。</p>
            ) : (
              <div style={{ maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px', margin: '10px 0' }}>
                {backups.map((b) => (
                  <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px', borderRadius: '8px', background: 'var(--panel2)' }}>
                    <span style={{ flex: 1, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{new Date(b.time * 1000).toLocaleString()}</span>
                    <button style={{ padding: '3px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--accent)', color: '#081018', fontSize: '11px', cursor: 'pointer' }} onClick={() => restoreBackup(b.name)}>恢复</button>
                  </div>
                ))}
              </div>
            )}
            <button className="close-btn" onClick={() => setBackupOpen(false)}>关闭</button>
          </div>
        </div>
      )}
      {/* 默认选项面板 */}
      {defaultOpen && (
        <div className="modal-mask" onClick={() => setDefaultOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="dname">默认选项（下次进入编辑生效）</div>
            <div style={{ margin: '10px 0' }}>
              {[['吸附', 'snap'], ['标签', 'showLabels'], ['名字', 'showFurnitureLabels']].map(([label, key]) => (
                <div key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 48 }}>{label}</span>
                  <button onClick={() => saveDefault({ [key]: true })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: settings[key] !== false ? 'var(--accent)' : 'var(--panel2)', color: settings[key] !== false ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>开</button>
                  <button onClick={() => saveDefault({ [key]: false })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: settings[key] === false ? 'var(--accent)' : 'var(--panel2)', color: settings[key] === false ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>关</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 48 }}>默认视图</span>
                <button onClick={() => saveDefault({ defaultView2d: true })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: settings.defaultView2d ? 'var(--accent)' : 'var(--panel2)', color: settings.defaultView2d ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>2D</button>
                <button onClick={() => saveDefault({ defaultView2d: false })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: !settings.defaultView2d ? 'var(--accent)' : 'var(--panel2)', color: !settings.defaultView2d ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>3D</button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 48 }}>缩放</span>
                {[0.6, 0.8, 1, 1.2, 1.5].map((s) => (
                  <button key={s} onClick={() => saveDefault({ furnitureScale: s })} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: (settings.furnitureScale || 1) === s ? 'var(--accent)' : 'var(--panel2)', color: (settings.furnitureScale || 1) === s ? '#081018' : '#fff', cursor: 'pointer', fontSize: 12 }}>{Math.round(s * 100)}%</button>
                ))}
              </div>
            </div>
            <button className="close-btn" onClick={() => setDefaultOpen(false)}>关闭</button>
          </div>
        </div>
      )}
      {/* 模型预览弹窗 */}
      {previewModel && (
        <div className="modal-mask" onClick={() => setPreviewModel(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="dname">{previewModel.label}</div>
            {previewModel.builtin ? (
              <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(255,255,255,0.08)', margin: '10px 0' }}>
                <span style={{ width: 110, height: 110, borderRadius: 12, background: previewModel.color, border: '2px solid rgba(255,255,255,0.3)' }} />
              </div>
            ) : (
              <img src={thumbUrl(previewModel.thumb)} alt={previewModel.label}
                style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8, background: 'rgba(255,255,255,0.08)', margin: '10px 0' }} />
            )}
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              尺寸约 {previewModel.w}×{previewModel.d}×{previewModel.h} 米
            </div>
            <div className="dev-actions">
              <button className="primary" onClick={() => { setState({ furnitureType: previewModel.type, tool: 'furniture' }); setFurnOpen(false); setPreviewModel(null) }}>放置</button>
              {!previewModel.builtin && (
                <button style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: 13 }} onClick={() => { hideModel(previewModel); setPreviewModel(null) }}>删除</button>
              )}
              <button className="close-btn" onClick={() => setPreviewModel(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
