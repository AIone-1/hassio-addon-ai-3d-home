import { useState, useMemo, useEffect } from 'react'
import { useStore, setState, currentFloor, getState, toast, undo, redo, loadProject } from '../store'
import { api, BASE } from '../api'
import { FURNITURE_LIB, FURNITURE_COLORS, polygonArea, DEVICE_MODELS, DEVICE_KINDS } from '../three/geometry'
import { thumbUrl } from '../catalog'
import ModelPreview from './ModelPreview'

// 内置家具图标（程序化建模无缩略图，用 emoji 表示）
const FURNITURE_ICONS = {
  沙发: '🛋️', 床: '🛏️', 餐桌: '🍽️', 书桌: '🪑', 衣柜: '🚪',
  橱柜: '🗄️', 岛台: '🍳', 茶几: '🪵', 书架: '📚', 马桶: '🚽',
  空气净化器: '🌀', 电视机: '📺', 壁灯: '💡', 挂画: '🖼️', 吊灯: '🛎️',
  吸顶灯: '💡', 筒灯: '💡', 空调: '❄️', 热水器: '♨️', 灯带: '✨',
  开关: '🔘', 感应器: '👁️', 风扇: '🌀',
}

// 地板颜色（选中房间可改）
const FLOOR_COLORS = ['#7789ad', '#8a9bbd', '#a58b6f', '#8b8b8b', '#c9a675', '#7d8f7a', '#a08090', '#6b7f9e']

// 存档文件名 → 显示标签（去掉 .json 和旧 backup_ 前缀，新命名是「项目名_日期」）
const backupLabel = (name) => {
  const s = (name || '').replace(/\.json$/, '')
  return s.startsWith('backup_') ? s.slice(7) : s
}

const LEFT_TOOLS = [
  { id: 'browse', label: '浏览', k: 'H' },
  { id: 'select', label: '选择', k: 'V' },
  { id: 'move', label: '移动', k: 'M' },
  { id: 'movePlan', label: '移动户型', k: 'G' },
  { id: 'wall', label: '墙体', k: 'W' },
  { id: 'door', label: '门', k: 'D' },
  { id: 'window', label: '窗', k: 'N' },
  { id: 'cut', label: '裁剪', k: 'X' },
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
  const showDimensions = useStore((s) => s.showDimensions)
  const planImage = useStore((s) => s.planImage)
  const settings = useStore((s) => s.settings)
  const view2d = useStore((s) => s.view2d)
  const mode = useStore((s) => s.mode)
  const project = useStore((s) => s.project)
  const modelCatalog = useStore((s) => s.modelCatalog)
  const furnitureScale = useStore((s) => s.furnitureScale)
  const selected = useStore((s) => s.selected)
  const multiSelect = useStore((s) => s.multiSelect)
  const wallSelIds = useStore((s) => s.wallSel)
  const floor = currentFloor()
  const currentFloorIdx = useStore((s) => s.currentFloor)
  const [furnOpen, setFurnOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [openCats, setOpenCats] = useState({})
  const [backups, setBackups] = useState([])
  const [defaultOpen, setDefaultOpen] = useState(false)
  const [previewModel, setPreviewModel] = useState(null)
  const [show3d, setShow3d] = useState(false)
  const [floorManagerOpen, setFloorManagerOpen] = useState(false)
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [editorBgOpen, setEditorBgOpen] = useState(false)
  const [bgList, setBgList] = useState([])
  const editorBgImage = useStore((s) => s.editorBgImage)

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
    if (t === 'browse') { setFurnOpen(false); setCatOpen(false); setState({ selected: null, wallSel: [], pickItem: null }) }
    else if (t === 'furniture') setFurnOpen(true)
    else if (t === 'device') { setState({ bindOpen: true }); setFurnOpen(false) }
    else if (t === 'wall') {
      setFurnOpen(false); setCatOpen(false)
      toast('画墙：点画布放墙点，点回起点或按 Enter 闭合生成房间')
    } else if (t === 'cut') {
      setFurnOpen(false); setCatOpen(false)
      setState({ wallSel: [] })
      toast('裁剪：点一面墙，在与其它墙的交点处切成两段')
    } else { setFurnOpen(false); setCatOpen(false) }
  }

  // 全部锁定 / 解锁当前楼层家具
  const lockAllFurniture = (locked) => {
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    const fs = (fl && fl.furniture) || []
    fs.forEach((f) => { f.locked = locked })
    setState({ project: { ...st.project }, saved: false })
    toast(locked ? `已锁定 ${fs.length} 个家具` : `已解锁 ${fs.length} 个家具`)
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
  const closePreview = () => { setPreviewModel(null); setShow3d(false) }

  // 点击空白处关闭 模型选择器/设备分类 弹窗
  useEffect(() => {
    const onDown = (e) => {
      if (!furnOpen && !catOpen) return
      const t = e.target
      if (t.closest && (t.closest('.furn-picker') || t.closest('.furn-item') || t.closest('.furn-cat'))) return
      setFurnOpen(false); setCatOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [furnOpen, catOpen])

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
          loadProject(p); setState({ currentFloor: 0 })
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
  // 加载最近项目（存档）列表
  const loadBackups = async () => {
    try {
      const r = await api.backups()
      setBackups(r.backups || [])
    } catch (e) { setBackups([]) }
  }
  // 打开项目 = 恢复存档
  const openBackup = async (name) => {
    if (!confirm(`打开项目「${name}」？将覆盖当前户型。`)) return
    try {
      const r = await api.backupRestore(name)
      if (r.ok && r.project) {
        loadProject(r.project); setState({ currentFloor: 0, selected: null, saved: true })
        toast('已打开项目')
        setProjectManagerOpen(false)
      }
    } catch (e) { toast('打开失败') }
  }
  // 删除项目 = 删除存档
  const deleteBackup = async (name) => {
    if (!confirm(`删除项目「${name}」？将删除该存档，不可恢复。`)) return
    try {
      await api.backupDelete(name)
      toast('已删除项目')
      loadBackups()
    } catch (e) { toast('删除失败') }
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
  // 新建空白楼层
  const newFloor = () => {
    const n = project.floors.length
    const fl = { id: Math.random().toString(36).slice(2, 10), name: `第${n + 1}层`, level: n * 3, height: 2.8, color: '#e6dcc8', rooms: [], walls: [], furniture: [], devices: [], openings: [] }
    project.floors.push(fl)
    setState({ project: { ...project }, currentFloor: n, saved: false })
    toast(`已新建「${fl.name}」`)
  }

  const deleteFloor = () => {
    if (project.floors.length <= 1) { alert('至少保留一层'); return }
    if (!confirm(`删除楼层「${floor.name}」？`)) return
    const idx = project.floors.findIndex((f) => f === floor)
    project.floors.splice(idx, 1)
    setState({ project: { ...project }, currentFloor: Math.max(0, idx - 1) })
  }

  // 户型信息统计
  const infoArea = (floor?.rooms || []).reduce((s, r) => s + polygonArea(r.points || []), 0)
  const infoRoomCount = (floor?.rooms || []).length
  const infoFurnCount = (floor?.furniture || []).length
  const infoDevCount = new Set((floor?.devices || []).map(d => d.entity_id)).size
  const infoWalls = floor?.walls || []
  const infoWallCount = infoWalls.length
  const infoHorizCount = infoWalls.filter(w => Math.abs(w.end[1] - w.start[1]) < 0.01).length
  const infoVertCount = infoWalls.filter(w => Math.abs(w.end[0] - w.start[0]) < 0.01).length
  const infoDiagCount = infoWallCount - infoHorizCount - infoVertCount
  const prevFloor = () => { if (currentFloorIdx > 0) setState({ currentFloor: currentFloorIdx - 1 }) }
  const nextFloor = () => { if (currentFloorIdx < project.floors.length - 1) setState({ currentFloor: currentFloorIdx + 1 }) }
  const selRoom = selected && selected.type === 'room' ? selected.ref : null
  const renameRoom = (name) => {
    const fl = getState().project.floors[currentFloorIdx]
    const target = (fl.rooms || []).find(r => r.id === selRoom.id)
    if (target) { target.name = name; setState({ project: { ...getState().project }, saved: false }) }
  }
  const selWall = selected && selected.type === 'wall' ? selected.ref : null
  const setWallHeight = (h) => {
    const fl = getState().project.floors[currentFloorIdx]
    const target = (fl.walls || []).find(w => w.id === selWall.id)
    if (target) { target.height = h; setState({ project: { ...getState().project }, saved: false }) }
  }

  return (
    <>
      {/* 顶部工具栏 */}
      <div className="editor-top">
        <button className="et-btn" onClick={() => { loadBackups(); setProjectManagerOpen(true) }}>项目</button>
        <button className="et-btn" onClick={() => undo()} title="撤销">↩️</button>
        <button className="et-btn" onClick={() => redo()} title="重做">↪️</button>
        <button className="et-btn" onClick={() => setFloorManagerOpen(true)}>楼层管理</button>
        <button className="et-btn" onClick={importPlanImage}>导入底图</button>
        {planImage && (
          <button className="et-btn" onClick={() => { setState({ calibrating: true, calibratePts: [] }); toast('标定：点底图选一段已知长度的起点') }} title="底图比例尺标定">标定</button>
        )}
        <button className="et-btn" onClick={() => setDefaultOpen(true)}>默认</button>
        <button className="et-btn" onClick={async () => { try { const r = await api.backgrounds(); setBgList(r.images || []) } catch (e) {} setEditorBgOpen(true) }}>背景</button>
        {planImage && (
          <>
            <button className="et-btn" onClick={() => setState(s => ({ planImageScale: (s.planImageScale || 1) * 1.25 }))} title="放大底图">底图＋</button>
            <button className="et-btn" onClick={() => setState(s => ({ planImageScale: (s.planImageScale || 1) / 1.25 }))} title="缩小底图">底图−</button>
            <button className="et-btn" onClick={removePlanImage} style={{ color: 'var(--danger)' }}>删除底图</button>
          </>
        )}
        <button className="et-btn" onClick={clearAll} style={{ color: 'var(--danger)' }}>清空全部</button>
        <button className="et-btn" onClick={() => { saveNow(); createBackup() }} style={{ color: 'var(--accent)' }}>保存</button>
        <div className="et-sep" />
        <button className="et-btn" onClick={() => setState(s => ({ planZoomDelta: s.planZoomDelta - 1 }))} title="缩小">−</button>
        <button className="et-btn" onClick={() => setState(s => ({ planZoomDelta: s.planZoomDelta + 1 }))} title="放大">＋</button>
        <button className="et-btn" onClick={() => setState(s => ({ planRecenterKey: s.planRecenterKey + 1 }))} title="居中">居中</button>
        <div className="et-sep" />

        {/* 家具库 */}
        <button className="et-btn" onClick={() => setCatOpen(false) + setFurnOpen(!furnOpen)}>模型</button>
        {furnOpen && (
          <div className="furn-picker">
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '0 4px 8px' }}>
              共 {FURNITURE_LIB.length + modelCatalog.filter((m) => !(settings.hiddenModels || []).includes(m.type)).length} 个模型
            </div>
            {/* 内置家具（程序化建模） */}
            <div className="furn-cat" onClick={() => setOpenCats(o => ({ ...o, 内置: !o['内置'] }))}>
              <span className="furn-cat-label">内置家具</span>
              <span className="furn-cat-count">{FURNITURE_LIB.length}</span>
              <span className="furn-cat-arrow">{openCats['内置'] ? '▾' : '▸'}</span>
            </div>
            {openCats['内置'] && (
              <div className="furn-items">
                {FURNITURE_LIB.filter((f) => !(settings.hiddenModels || []).includes(f.type)).map((f) => (
                  <button key={f.type}
                    className={`furn-item ${furnitureType === f.type ? 'active' : ''}`}
                    onClick={() => { setPreviewModel({ type: f.type, label: f.type, w: f.w, d: f.d, h: f.h, color: FURNITURE_COLORS[f.type] || '#888', builtin: true }); setShow3d(true) }} title="点击预览">
                    <span className="furn-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{FURNITURE_ICONS[f.type] || '📦'}</span>
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
            {/* 设备模型（开关/灯/空调/摄像机/风扇…统一管理，点击即可放置） */}
            <div className="furn-cat" onClick={() => setOpenCats(o => ({ ...o, '设备模型': !o['设备模型'] }))}>
              <span className="furn-cat-label">设备模型</span>
              <span className="furn-cat-count">{DEVICE_MODELS.length}</span>
              <span className="furn-cat-arrow">{openCats['设备模型'] ? '▾' : '▸'}</span>
            </div>
            {openCats['设备模型'] && (
              <div style={{ padding: '0 0 8px 12px' }}>
                {DEVICE_KINDS.map((k) => {
                  const items = DEVICE_MODELS.filter((m) => m.kind === k.kind)
                  if (items.length === 0) return null
                  return (
                    <div key={k.kind}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>{k.label}</div>
                      <div className="furn-items">
                        {items.map((m) => (
                          <button key={m.id} className={`furn-item ${furnitureType === m.id ? 'active' : ''}`}
                            onClick={() => { setState({ furnitureType: m.id, tool: 'furniture' }); setFurnOpen(false) }} title={m.label}>
                            <span>{m.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
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
        <button className={`et-btn ${showDimensions ? 'active' : ''}`} onClick={() => setState({ showDimensions: !showDimensions })} title="显示墙长度尺寸">尺寸</button>
        <button className="et-btn" onClick={() => lockAllFurniture(true)} title="锁定当前楼层所有家具（防止移动）">🔒 全部锁定</button>
        <button className="et-btn" onClick={() => lockAllFurniture(false)} title="解锁当前楼层所有家具">🔓 全部解锁</button>
        <button className={`et-btn ${view2d ? 'active' : ''}`} onClick={() => setState({ view2d: !view2d })}>2D</button>
        <button className={`et-btn ${!view2d ? 'active' : ''}`} onClick={() => setState({ view2d: false, tool: 'select', pickItem: null, wallSel: [] })}>3D</button>
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
        <button
          className={`el-btn ${multiSelect ? 'active' : ''}`}
          onClick={() => setState({ multiSelect: !multiSelect })}
          title="开启后点击墙即可多选（不用按住 Ctrl）">
          多选<span className="k">{multiSelect ? '开' : '关'}</span>
        </button>
      </div>

      {/* 右侧信息栏（未选中、不是墙体/门/窗工具、且没选墙时显示户型信息；否则和墙面板/约束面板重叠） */}
      {!selected && !['wall', 'door', 'window'].includes(tool) && wallSelIds.length === 0 && (
        <div className="editor-info">
          <div className="editor-info-title">户型信息</div>
          <div className="editor-info-row"><span>楼层</span><b>{currentFloorIdx + 1} / {project.floors.length}</b></div>
          <div className="editor-info-row"><span>面积</span><b>{infoArea.toFixed(1)} ㎡</b></div>
          <div className="editor-info-row"><span>房间</span><b>{infoRoomCount} 个</b></div>
          <div className="editor-info-row"><span>墙</span><b>{infoWallCount} 条</b></div>
          <div className="editor-info-row"><span>水平</span><b>{infoHorizCount} 条</b></div>
          <div className="editor-info-row"><span>竖直</span><b>{infoVertCount} 条</b></div>
          <div className="editor-info-row"><span>斜线</span><b>{infoDiagCount} 条</b></div>
          <div className="editor-info-row"><span>家具</span><b>{infoFurnCount} 个</b></div>
          <div className="editor-info-row"><span>设备</span><b>{infoDevCount} 个</b></div>
        </div>
      )}

      {/* 项目弹窗（合并备份：最近项目=存档列表，可打开/删除） */}
      {projectManagerOpen && (
        <div className="modal-mask" onClick={() => setProjectManagerOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ width: 420, maxHeight: '82vh', overflowY: 'auto' }}>
            <div className="dname">项目</div>
            <div style={{ margin: '10px 0' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>项目名</div>
              <input type="text" value={project.name || ''}
                onChange={(e) => { project.name = e.target.value; setState({ project: { ...project }, saved: false }) }}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', margin: '10px 0 6px' }}>最近项目</div>
            {backups.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>还没有项目快照。点「保存」会自动生成一份项目快照。</p>
            ) : (
              <div style={{ maxHeight: '38vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
                {backups.map((b) => (
                  <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, background: 'var(--panel2)' }}>
                    <span title={new Date(b.time * 1000).toLocaleString()} style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{backupLabel(b.name)}</span>
                    <button style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--accent)', color: '#081018', fontSize: 11, cursor: 'pointer' }} onClick={() => openBackup(b.name)}>打开</button>
                    <button style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', fontSize: 11, cursor: 'pointer' }} onClick={() => deleteBackup(b.name)}>删除</button>
                  </div>
                ))}
              </div>
            )}
            <div className="dev-actions" style={{ margin: '0 0 10px' }}>
              <button className="primary" onClick={async () => {
                const name = prompt('新项目名字：', '我的家')
                if (name && name.trim()) {
                  // 先保存当前项目为存档（项目名_日期），再开新项目，避免之前的项目丢失
                  try { await api.saveProject(getState().project) } catch (e) {}
                  await createBackup()
                  const p = { name: name.trim(), version: 1, floors: [{ id: Math.random().toString(36).slice(2, 10), name: '一层', level: 0, height: 2.8, color: '#e6dcc8', rooms: [], walls: [], furniture: [], devices: [], openings: [] }] }
                  loadProject(p); setState({ saved: false }); setProjectManagerOpen(false)
                  toast('已新建项目，之前的项目已存为最近项目')
                }
              }}>新建项目</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }} onClick={exportPNG}>📷 导出图</button>
              <button style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }} onClick={exportSVG}>📐 导出 SVG</button>
              <button style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }} onClick={exportJson}>📄 导出 JSON</button>
            </div>
            <button className="close-btn" onClick={() => setProjectManagerOpen(false)}>关闭</button>
          </div>
        </div>
      )}

      {/* 楼层管理弹窗 */}
      {floorManagerOpen && (
        <div className="modal-mask" onClick={() => setFloorManagerOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="dname">楼层管理</div>
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, margin: '10px 0' }}>
              {project.floors.map((f, i) => (
                <div key={f.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: i === currentFloorIdx ? 'var(--accent)' : 'var(--panel2)', color: i === currentFloorIdx ? '#081018' : 'var(--text)', fontSize: 12 }}>
                  <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => { setState({ currentFloor: i }); setFloorManagerOpen(false) }}>{f.name}{i === currentFloorIdx ? '（当前）' : ''}</span>
                  <input type="number" step="0.1" min="2" max="6" value={f.height || 2.8}
                    onChange={(e) => { f.height = Number(e.target.value) || 2.8; setState({ project: { ...project }, saved: false }) }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 46, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 11 }} />
                  <span style={{ fontSize: 10, opacity: 0.7 }}>米</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              <button style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--accent)', color: '#081018', cursor: 'pointer', fontSize: 12 }} onClick={() => { newFloor(); setFloorManagerOpen(false) }}>新建楼层</button>
              <button style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }} onClick={() => { duplicateFloor(); setFloorManagerOpen(false) }}>复制当前层</button>
              <button style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }} onClick={() => { resetFloor(); setFloorManagerOpen(false) }}>清空当前层</button>
              <button style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: 12 }} onClick={() => { deleteFloor(); setFloorManagerOpen(false) }}>删除楼层</button>
            </div>
            <button className="close-btn" onClick={() => setFloorManagerOpen(false)}>关闭</button>
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
      {/* 3D 视图背景弹窗（独立于主界面背景） */}
      {editorBgOpen && (
        <div className="modal-mask" onClick={() => setEditorBgOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="dname">3D 视图背景</div>
            <div style={{ margin: '10px 0' }}>
              <input type="file" accept="image/*" id="editor-bg-file" style={{ display: 'none' }}
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
                        setState({ editorBgImage: res.name, editorBgMode: 'image' })
                        setBgList([{ name: res.name, time: Date.now() / 1000 }, ...bgList])
                        toast('3D 背景已上传')
                      }
                    } catch (err) { toast('上传失败') }
                  }
                  reader.readAsDataURL(file)
                }} />
              {/* 已上传背景图缩略图 */}
              {bgList.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {bgList.map((img) => (
                    <div key={img.name} style={{ position: 'relative' }}>
                      <img src={BASE + 'api/background/' + img.name} alt=""
                        style={{ width: 56, height: 38, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: editorBgImage === img.name ? '2px solid var(--accent)' : '1px solid var(--border)' }}
                        onClick={() => setState({ editorBgImage: img.name, editorBgMode: 'image' })} />
                      <button title="删除" onClick={async () => {
                        if (!confirm('删除这张背景图？')) return
                        await api.backgroundDelete(img.name)
                        setBgList(bgList.filter((x) => x.name !== img.name))
                        if (getState().editorBgImage === img.name) setState({ editorBgImage: '', editorBgMode: 'color' })
                      }} style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, lineHeight: '14px', borderRadius: '50%', background: 'var(--panel-solid)', color: 'var(--danger)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 10, padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <button className="primary" onClick={() => document.getElementById('editor-bg-file').click()}>上传背景图</button>
              <button style={{ marginLeft: 8, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}
                onClick={() => { setState({ editorBgImage: '', editorBgMode: 'color' }); toast('已恢复默认蓝色背景') }}>默认</button>
              <button style={{ marginLeft: 8, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}
                onClick={() => { setState({ editorBgImage: getState().bgImage, editorBgMode: getState().bgMode }); toast('已同步主界面背景') }}>同步主界面背景</button>
            </div>
            <button className="close-btn" onClick={() => setEditorBgOpen(false)}>关闭</button>
          </div>
        </div>
      )}
      {/* 模型预览弹窗（3D 预览 + 尺寸 + 缩放 + 放置/删除） */}
      {previewModel && (
        <div className="modal-mask" onClick={() => closePreview()}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
            <div className="dname">{previewModel.label}</div>
            {show3d ? (
              <div style={{ height: 400, borderRadius: 8, background: 'rgba(0,0,0,0.25)', margin: '10px 0', overflow: 'hidden' }}>
                <ModelPreview model={previewModel} />
              </div>
            ) : previewModel.builtin ? (
              <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(255,255,255,0.08)', margin: '10px 0' }}>
                <span style={{ width: 110, height: 110, borderRadius: 12, background: previewModel.color, border: '2px solid rgba(255,255,255,0.3)' }} />
              </div>
            ) : (
              <img src={thumbUrl(previewModel.thumb)} alt={previewModel.label}
                style={{ width: '100%', maxHeight: 400, objectFit: 'contain', borderRadius: 8, background: 'rgba(255,255,255,0.08)', margin: '10px 0' }} />
            )}
            <button onClick={() => setShow3d(!show3d)}
              style={{ display: 'block', width: '100%', padding: '7px', marginBottom: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>
              {show3d ? '🖼️ 返回图片' : '🧊 3D预览'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              尺寸约 {previewModel.w}×{previewModel.d}×{previewModel.h} 米
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>缩放</span>
              {[0.6, 0.8, 1, 1.2, 1.5].map((s) => (
                <button key={s} onClick={() => setState({ furnitureScale: s })}
                  style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: furnitureScale === s ? 'var(--accent)' : 'var(--panel2)', color: furnitureScale === s ? '#081018' : 'var(--text)', cursor: 'pointer', fontSize: 11 }}>
                  {Math.round(s * 100)}%
                </button>
              ))}
            </div>
            <div className="dev-actions">
              <button className="primary" onClick={() => { setState({ furnitureType: previewModel.type, tool: 'furniture' }); setFurnOpen(false); closePreview() }}>放置</button>
              <button style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: 13 }}
                onClick={() => { if (confirm(`确认删除「${previewModel.label}」？`)) { hideModel(previewModel); closePreview() } }}>删除</button>
              <button className="close-btn" onClick={() => closePreview()}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
