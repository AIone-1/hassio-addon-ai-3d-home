import { useState } from 'react'
import { useStore, setState, currentFloor } from '../store'
import { FURNITURE_LIB } from '../three/geometry'

const LEFT_TOOLS = [
  { id: 'select', label: '选择', k: 'V' },
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
  const showLabels = useStore((s) => s.showLabels)
  const view2d = useStore((s) => s.view2d)
  const mode = useStore((s) => s.mode)
  const project = useStore((s) => s.project)
  const floor = currentFloor()
  const [furnOpen, setFurnOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)

  const setTool = (t) => {
    setState({ tool: t })
    if (t === 'furniture') setFurnOpen(true)
    else if (t === 'device') { setState({ bindOpen: true }); setFurnOpen(false) }
    else { setFurnOpen(false); setCatOpen(false) }
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
        <button className="et-btn" title="参考底图（开发中）">参考底图</button>
        <button className="et-btn" onClick={importJson}>导入 JSON</button>
        <button className="et-btn" onClick={exportJson}>导出 JSON</button>
        <button className="et-btn" title="最近备份（开发中）">最近备份</button>
        <button className="et-btn" onClick={resetFloor} style={{ color: 'var(--danger)' }}>重置当前户型</button>
        <div className="et-sep" />

        {/* 家具库 */}
        <button className="et-btn" onClick={() => setCatOpen(false) + setFurnOpen(!furnOpen)}>家具</button>
        {furnOpen && (
          <div className="furn-picker">
            {FURNITURE_LIB.map((f) => (
              <button key={f.type}
                className={`furn-item ${furnitureType === f.type ? 'active' : ''}`}
                onClick={() => { setState({ furnitureType: f.type, tool: 'furniture' }); setFurnOpen(false) }}>
                {f.type}<span style={{ fontSize: 9, opacity: 0.6 }}> {f.w}×{f.d}m</span>
              </button>
            ))}
          </div>
        )}
        <div className="et-sep" />

        {/* 设备分类 */}
        <button className="et-btn" onClick={() => setFurnOpen(false) + setCatOpen(!catOpen)}>设备</button>
        {catOpen && (
          <div className="furn-picker">
            {['全部', '灯光', '开关', '窗帘', '空调', '传感器', '感应器', '摄像机', '风扇', '安防'].map((c) => (
              <button key={c} className="furn-item" onClick={() => { setState({ tool: 'device', bindOpen: true }); setCatOpen(false) }}>{c}</button>
            ))}
          </div>
        )}
        <div className="et-sep" />

        <button className={`et-btn ${snap ? 'active' : ''}`} onClick={() => setState({ snap: !snap })}>吸附</button>
        <button className={`et-btn ${showLabels ? 'active' : ''}`} onClick={() => setState({ showLabels: !showLabels })}>标签</button>
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

      {/* 底部右侧：缩放/楼层 */}
      <div className="editor-bottom">
        <button className="eb-btn" onClick={() => setState({ zoom: (window.__zoom || 1) - 0.1 })}>−</button>
        <button className="eb-btn" onClick={() => setState({ zoom: (window.__zoom || 1) + 0.1 })}>＋</button>
        <button className="eb-btn" title="居中">居中</button>
        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
        <button className="eb-btn" onClick={duplicateFloor}>复制当前层</button>
        <button className="eb-btn" onClick={deleteFloor} style={{ color: 'var(--danger)' }}>删除楼层</button>
      </div>
    </>
  )
}
