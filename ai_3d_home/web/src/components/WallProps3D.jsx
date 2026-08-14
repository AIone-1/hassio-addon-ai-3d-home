// 3D 视图里的墙属性面板（简化版：长度/高度/厚度/颜色/不透明度）
// 3D 视图点选墙后可改这几个属性，和 2D 编辑器共用同一份墙数据
import { useStore, setState, getState } from '../store'
import { recomputeRooms } from '../three/geometry'

const WALL_COLORS = ['#ffffff', '#d5e0f1', '#f5f7fa', '#e8e4dc', '#c9c9c9', '#d8e8f0', '#e0d8e8', '#d0e8d8', '#f0e0d0']

export default function WallProps3D({ floorIndex }) {
  const selected = useStore((s) => s.selected)
  const wallOpacity = useStore((s) => s.wallOpacity)
  const wall = selected && selected.type === 'wall' ? selected.ref : null
  if (!wall) return null

  const fl = getState().project.floors[floorIndex]
  const patch = (p) => {
    const target = (fl.walls || []).find((w) => w.id === wall.id)
    if (!target) return
    Object.assign(target, p)
    fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }

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
        <input type="number" step="0.1" min="1" max="6" value={wall.height || 2.8}
          onChange={(e) => patch({ height: Number(e.target.value) || 2.8 })} />
        <span className="plan-props-unit">m</span>
      </div>
      <div className="plan-props-row">
        <span className="plan-props-label">厚度</span>
        <input type="number" step="0.02" min="0.05" max="0.5" value={wall.thickness || 0.12}
          onChange={(e) => patch({ thickness: Number(e.target.value) || 0.12 })} />
        <span className="plan-props-unit">m</span>
      </div>
      <div className="plan-props-row">
        <span className="plan-props-label">颜色</span>
        {WALL_COLORS.map((c) => (
          <button key={c} title={c} onClick={() => patch({ color: c })}
            className={`plan-props-swatch ${(wall.color || '#d5e0f1') === c ? 'active' : ''}`}
            style={{ background: c }} />
        ))}
      </div>
      <div className="plan-props-row">
        <span className="plan-props-label">不透明度</span>
        <input type="range" min="10" max="100" step="5" style={{ flex: 1 }}
          value={wall.opacity != null ? wall.opacity : wallOpacity}
          onChange={(e) => patch({ opacity: Number(e.target.value) })} />
        <span className="plan-props-unit">{wall.opacity != null ? wall.opacity : wallOpacity}%</span>
      </div>
    </div>
  )
}
