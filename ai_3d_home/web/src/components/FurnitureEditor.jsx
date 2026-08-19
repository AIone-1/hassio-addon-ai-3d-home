// 家具编辑器：自己配置柜子（尺寸/抽屉/柜门/木色/把手/顶部），3D 实时预览，创建到户型图
import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { FurnitureModel } from './Scene'
import { setState, getState } from '../store'

const WOODS = ['#a08a6f', '#8b6b4e', '#c8a27e', '#6b5a4e', '#d8c9b4', '#7d6a52']
const DRAWER_COUNTS = [0, 1, 2, 3]
const DOOR_COUNTS = [0, 2, 3, 4]

export default function FurnitureEditor({ onClose }) {
  const [params, setParams] = useState({ w: 1.0, h: 1.5, d: 0.5, drawers: 1, doors: 2, color: '#a08a6f', handles: true, top: true })
  const set = (k, v) => setParams((p) => ({ ...p, [k]: v }))
  const seg = (active) => ({ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--panel2)', color: active ? '#081018' : 'var(--text)', cursor: 'pointer', fontSize: 12, minWidth: 30 })
  const row = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }
  const label = { fontSize: 12, color: 'var(--muted)', minWidth: 40, flexShrink: 0 }

  // 创建柜子：放到当前楼层户型中心（可随后移动）
  const createFurniture = () => {
    const st = getState()
    const fl = st.project.floors[st.currentFloor]
    let cx = 0, cz = 0, n = 0
    ;(fl.rooms || []).forEach((r) => (r.points || []).forEach((pt) => { cx += pt[0]; cz += pt[1]; n++ }))
    if (n) { cx /= n; cz /= n }
    fl.furniture = fl.furniture || []
    fl.furniture.push({ id: 'f' + Math.random().toString(36).slice(2, 9), type: '柜子', pos: [cx, 0, cz], params: { ...params } })
    setState({ project: { ...st.project }, saved: false })
    onClose()
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxHeight: '92vh', overflow: 'auto' }}>
        <div className="dname">家具编辑器 · 柜子</div>
        <div style={{ display: 'flex', gap: 14, margin: '12px 0' }}>
          {/* 参数区 */}
          <div style={{ flex: 1, fontSize: 12 }}>
            <div style={{ color: 'var(--muted)', marginBottom: 4 }}>尺寸</div>
            {[['宽', 'w', 0.4, 2.5], ['高', 'h', 0.4, 2.5], ['深', 'd', 0.3, 1.0]].map(([l, k, mn, mx]) => (
              <div key={k} style={row}>
                <span style={label}>{l}</span>
                <input type="range" min={mn} max={mx} step="0.05" value={params[k]} onChange={(e) => set(k, parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: 11, color: 'var(--muted)', width: 40, textAlign: 'right' }}>{params[k].toFixed(2)}m</span>
              </div>
            ))}
            <div style={{ color: 'var(--muted)', marginTop: 10, marginBottom: 4 }}>抽屉（上部）</div>
            <div style={row}>
              {DRAWER_COUNTS.map((n) => <button key={n} onClick={() => set('drawers', n)} style={seg(params.drawers === n)}>{n}</button>)}
            </div>
            <div style={{ color: 'var(--muted)', marginTop: 10, marginBottom: 4 }}>柜门（下部）</div>
            <div style={row}>
              {DOOR_COUNTS.map((n) => <button key={n} onClick={() => set('doors', n)} style={seg(params.doors === n)}>{n}</button>)}
            </div>
            <div style={{ color: 'var(--muted)', marginTop: 10, marginBottom: 4 }}>木色</div>
            <div style={row}>
              {WOODS.map((c) => (
                <button key={c} title={c} onClick={() => set('color', c)}
                  style={{ width: 24, height: 24, borderRadius: 6, border: params.color === c ? '2px solid var(--accent)' : '1px solid var(--border)', background: c, cursor: 'pointer', flexShrink: 0 }} />
              ))}
            </div>
            <div style={row}>
              <span style={label}>把手</span>
              <button onClick={() => set('handles', true)} style={seg(params.handles)}>开</button>
              <button onClick={() => set('handles', false)} style={seg(!params.handles)}>关</button>
              <span style={{ ...label, marginLeft: 14 }}>顶部</span>
              <button onClick={() => set('top', true)} style={seg(params.top)}>开</button>
              <button onClick={() => set('top', false)} style={seg(!params.top)}>关</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>创建后柜子出现在户型中心，可拖动摆放；之后选中它还能再编辑</div>
          </div>
          {/* 3D 实时预览 */}
          <div style={{ width: 250, height: 320, borderRadius: 8, background: 'rgba(0,0,0,0.25)', overflow: 'hidden', flexShrink: 0 }}>
            <Canvas camera={{ position: [1.5, 1.1, 1.5], fov: 38 }} dpr={[1, 2]}>
              <ambientLight intensity={0.75} />
              <directionalLight position={[4, 5, 4]} intensity={1.3} />
              <FurnitureModel type="柜子" w={params.w} d={params.d} h={params.h} params={params} />
            </Canvas>
          </div>
        </div>
        <div className="dev-actions">
          <button className="primary" onClick={createFurniture}>✅ 创建柜子</button>
          <button className="close-btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}
