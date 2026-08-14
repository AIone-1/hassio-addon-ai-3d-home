// 3D 视图里的属性面板（简化版）：墙/家具/设备 选中后弹面板改常用属性
// 和 2D 编辑器共用同一份数据；墙=长度/高度/厚度/颜色/不透明度，家具=高度/旋转/缩放/删除，设备=高度/删除
import { useStore, setState, getState, toast } from '../store'
import { recomputeRooms } from '../three/geometry'

const WALL_COLORS = ['#ffffff', '#d5e0f1', '#f5f7fa', '#e8e4dc', '#c9c9c9', '#d8e8f0', '#e0d8e8', '#d0e8d8', '#f0e0d0']

export default function WallProps3D({ floorIndex }) {
  const selected = useStore((s) => s.selected)
  const wallOpacity = useStore((s) => s.wallOpacity)
  if (!selected) return null

  const fl = getState().project.floors[floorIndex]
  const commit = (fn) => {
    fn()
    if (selected.type === 'wall') fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }

  // ---------- 墙 ----------
  if (selected.type === 'wall') {
    const wall = selected.ref
    return (
      <div className="plan-props">
        <div className="plan-props-head"><span>墙</span></div>
        <div className="plan-props-row">
          <span className="plan-props-label">长度</span>
          <span style={{ fontSize: 12, color: 'var(--text)' }}>
            {Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]).toFixed(2)} m
          </span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">高度</span>
          <button onClick={() => commit(() => { wall.height = Math.max(1, (wall.height || 2.8) - 0.1) })}>−</button>
          <input type="number" step="0.1" min="1" max="6" value={wall.height || 2.8}
            onChange={(e) => commit(() => { wall.height = Number(e.target.value) || 2.8 })} />
          <button onClick={() => commit(() => { wall.height = (wall.height || 2.8) + 0.1 })}>＋</button>
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">厚度</span>
          <button onClick={() => commit(() => { wall.thickness = Math.max(0.05, (wall.thickness || 0.12) - 0.02) })}>−</button>
          <input type="number" step="0.02" min="0.05" max="0.5" value={wall.thickness || 0.12}
            onChange={(e) => commit(() => { wall.thickness = Number(e.target.value) || 0.12 })} />
          <button onClick={() => commit(() => { wall.thickness = (wall.thickness || 0.12) + 0.02 })}>＋</button>
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">颜色</span>
          {WALL_COLORS.map((c) => (
            <button key={c} title={c}
              className={`plan-props-swatch ${(wall.color || '#d5e0f1') === c ? 'active' : ''}`}
              style={{ background: c }} onClick={() => commit(() => { wall.color = c })} />
          ))}
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">不透明度</span>
          <input type="range" min="10" max="100" step="5" style={{ flex: 1 }}
            value={wall.opacity != null ? wall.opacity : wallOpacity}
            onChange={(e) => commit(() => { wall.opacity = Number(e.target.value) })} />
          <span className="plan-props-unit">{wall.opacity != null ? wall.opacity : wallOpacity}%</span>
        </div>
      </div>
    )
  }

  // ---------- 家具 ----------
  if (selected.type === 'furniture') {
    const f = selected.ref
    const s = f.scale ? f.scale[0] : 1
    return (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>{f.name || f.type}</span>
          <button className="plan-props-del" onClick={() => commit(() => {
            fl.furniture = (fl.furniture || []).filter((x) => x.id !== f.id)
            setState({ selected: null })
            toast('已删除家具')
          })}>删除</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">高度</span>
          <button onClick={() => commit(() => { f.pos[1] = Math.max(0, (f.pos[1] || 0) - 0.1) })}>−</button>
          <input type="number" step="0.1" min="0" max="6" value={Math.round((f.pos[1] || 0) * 100) / 100}
            onChange={(e) => commit(() => { f.pos[1] = Number(e.target.value) || 0 })} />
          <button onClick={() => commit(() => { f.pos[1] = (f.pos[1] || 0) + 0.1 })}>＋</button>
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">位置</span>
          <button className="plan-props-seg" onClick={() => commit(() => { f.pos[1] = 0; f.placement = 'floor' })}>地面</button>
          <button className="plan-props-seg" onClick={() => commit(() => { f.pos[1] = fl.height || 2.8; f.placement = 'ceiling' })}>屋顶</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">旋转</span>
          <button onClick={() => commit(() => { f.rot = ((f.rot || 0) - 15 + 360) % 360 })}>−</button>
          <input type="number" step="5" value={Math.round(f.rot || 0)}
            onChange={(e) => commit(() => { f.rot = (Number(e.target.value) % 360 + 360) % 360 })} />
          <button onClick={() => commit(() => { f.rot = ((f.rot || 0) + 15) % 360 })}>＋</button>
          <span className="plan-props-unit">°</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">缩放</span>
          <button onClick={() => { const v = Math.max(0.1, s - 0.1); commit(() => { f.scale = [v, v, v] }) }}>−</button>
          <input type="number" step="5" min="10" value={Math.round(s * 100)}
            onChange={(e) => { const v = Math.max(0.1, (Number(e.target.value) || 100) / 100); commit(() => { f.scale = [v, v, v] }) }} />
          <button onClick={() => { const v = s + 0.1; commit(() => { f.scale = [v, v, v] }) }}>＋</button>
          <span className="plan-props-unit">%</span>
        </div>
      </div>
    )
  }

  // ---------- 设备 ----------
  if (selected.type === 'device') {
    const d = selected.ref
    return (
      <div className="plan-props">
        <div className="plan-props-head">
          <span>{d.name || d.entity_id}</span>
          <button className="plan-props-del" onClick={() => commit(() => {
            fl.devices = (fl.devices || []).filter((x) => x.id !== d.id)
            setState({ selected: null })
            toast('已删除设备')
          })}>删除</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">高度</span>
          <button onClick={() => commit(() => { d.pos[1] = Math.max(0, (d.pos[1] || 1.4) - 0.1) })}>−</button>
          <input type="number" step="0.1" min="0" max="6" value={Math.round((d.pos[1] || 1.4) * 100) / 100}
            onChange={(e) => commit(() => { d.pos[1] = Number(e.target.value) || 0 })} />
          <button onClick={() => commit(() => { d.pos[1] = (d.pos[1] || 1.4) + 0.1 })}>＋</button>
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">位置</span>
          <button className="plan-props-seg" onClick={() => commit(() => { d.pos[1] = 0 })}>地面</button>
          <button className="plan-props-seg" onClick={() => commit(() => { d.pos[1] = fl.height || 2.8 })}>屋顶</button>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">旋转</span>
          <button onClick={() => commit(() => { d.rot = ((d.rot || 0) - 15 + 360) % 360 })}>−</button>
          <input type="number" step="5" value={Math.round(d.rot || 0)}
            onChange={(e) => commit(() => { d.rot = (Number(e.target.value) % 360 + 360) % 360 })} />
          <button onClick={() => commit(() => { d.rot = ((d.rot || 0) + 15) % 360 })}>＋</button>
          <span className="plan-props-unit">°</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">缩放</span>
          <button onClick={() => { const v = Math.max(0.1, (d.scale ? d.scale[0] : 1) - 0.1); commit(() => { d.scale = [v, v, v] }) }}>−</button>
          <input type="number" step="5" min="10" value={Math.round((d.scale ? d.scale[0] : 1) * 100)}
            onChange={(e) => { const v = Math.max(0.1, (Number(e.target.value) || 100) / 100); commit(() => { d.scale = [v, v, v] }) }} />
          <button onClick={() => { const v = (d.scale ? d.scale[0] : 1) + 0.1; commit(() => { d.scale = [v, v, v] }) }}>＋</button>
          <span className="plan-props-unit">%</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">实体</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.entity_id}</span>
        </div>
      </div>
    )
  }

  return null
}
