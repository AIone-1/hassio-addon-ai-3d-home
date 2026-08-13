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
    a.download = `ai3d_home_${Date.now()}.json`
    a.click()
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
        <button className="et-btn" onClick={() => setCatOpen(false) + setFurnOpen(!furnOpen)}>家具</button>
        {furnOpen && (
          <div className="furn-picker">
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
                    onClick={() => { setState({ furnitureType: f.type, tool: 'furniture' }); setFurnOpen(false) }}>
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
                    {items.map((m) => (
                      <button key={m.type}
                        className={`furn-item ${furnitureType === m.type ? 'active' : ''}`}
                        onClick={() => { setState({ furnitureType: m.type, tool: 'furniture' }); setFurnOpen(false) }}>
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
    </>
  )
}
