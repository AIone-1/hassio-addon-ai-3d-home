// 模型微调按钮：左右/前后/上下 六个方向，步长用户自填（米/次），2D 和 3D 编辑界面共用
import { useState } from 'react'
import { setState, getState } from '../store'
import { api } from '../api'

export default function MoveControls({ id, floorIndex }) {
  const [step, setStep] = useState(0.1)
  const moveBy = (dx, dy, dz) => {
    const st = getState()
    const fl = st.project.floors[floorIndex != null ? floorIndex : st.currentFloor]
    const target = (fl.furniture || []).find((f) => f.id === id) || (fl.devices || []).find((d) => d.id === id)
    if (!target) return
    // ⚠️ dx/dy/dz 可能 undefined（只传一个方向时）——必须 ||0，否则 pos 变 NaN 导致模型消失
    target.pos = [+(target.pos[0] || 0) + (dx || 0), +(target.pos[1] || 0) + (dy || 0), +(target.pos[2] || 0) + (dz || 0)]
    setState({ project: { ...st.project }, saved: false })
    api.saveProject(getState().project).catch(() => {})
  }
  const btn = { padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, lineHeight: '18px' }
  const B = ({ l, dx, dy, dz }) => <button onClick={() => moveBy(dx, dy, dz)} style={btn}>{l}</button>
  return (
    <div className="plan-props-row" style={{ flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      <span className="plan-props-label">微调</span>
      <input type="number" step="0.05" min="0.01" value={step}
        onChange={(e) => setStep(parseFloat(e.target.value) || 0.1)}
        style={{ width: 58, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12 }} />
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>米/次</span>
      <div style={{ width: '100%', display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
        <B l="←左" dx={-step} />
        <B l="右→" dx={step} />
        <B l="前" dz={step} />
        <B l="后" dz={-step} />
        <B l="上" dy={step} />
        <B l="下" dy={-step} />
      </div>
    </div>
  )
}
