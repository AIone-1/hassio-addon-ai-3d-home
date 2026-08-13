import { useStore, setState } from '../store'

const MODES = ['全屋', '照明', '遮阳', '环境', '安防']

export default function BottomBar() {
  const mode = useStore((s) => s.mode)
  const autoRotate = useStore((s) => s.autoRotate)
  const rotateDir = useStore((s) => s.rotateDir)
  const rotateSpeed = useStore((s) => s.rotateSpeed)
  const quality = useStore((s) => s.quality)
  const shadows = useStore((s) => s.shadows)
  const editing = useStore((s) => s.editing)
  const project = useStore((s) => s.project)
  const deviceCount = project.floors.reduce((n, f) => n + (f.devices || []).length, 0)

  const qLabel = { eco: '流畅', smooth: '均衡', balanced: '高清', high: '极致' }[quality] || '高清'

  const cycleQuality = () => {
    const order = ['eco', 'smooth', 'balanced', 'high']
    const next = order[(order.indexOf(quality) + 1) % order.length]
    setState({ quality: next })
  }

  return (
    <div className="bottom-bar">
      <div className="bb-group">
        <button className={`bb-btn ${autoRotate ? 'active' : ''}`} onClick={() => {
          // 循环：停止 → 顺时针 → 逆时针 → 停止
          if (!autoRotate) setState({ autoRotate: true, rotateDir: 1 })
          else if (rotateDir === 1) setState({ rotateDir: -1 })
          else setState({ autoRotate: false })
        }}>
          {autoRotate ? (rotateDir === 1 ? '🔄 顺时针' : '🔄 逆时针') : '🔄 旋转'}
        </button>
        {autoRotate && (
          <span className="bb-speed" title="转速">
            <input type="range" min="0.5" max="5" step="0.1" value={rotateSpeed}
              onChange={(e) => setState({ rotateSpeed: parseFloat(e.target.value) })} />
            <span className="bb-speed-val">{rotateSpeed.toFixed(1)}×</span>
          </span>
        )}
        <button className="bb-btn" onClick={() => setState((s) => ({ recenterKey: s.recenterKey + 1 }))} title="居中视角">
          ⌖ 居中
        </button>
        <button className="bb-btn" onClick={cycleQuality} title="切换画质（流畅/均衡/高清/极致）">
          ⚙️ {qLabel}
        </button>
        <button className={`bb-btn ${shadows ? 'active' : ''}`} onClick={() => setState({ shadows: !shadows })} title="切换投影">
          ☀️ 投影
        </button>
        <button className="bb-btn" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }} title="玻璃效果（开发中）">璃玻璃</button>
      </div>
      <div className="bb-group">
        <span className="bb-btn" style={{ cursor: 'default' }}>设备{deviceCount}</span>
        <button className="bb-btn" onClick={() => setState({ bindOpen: true })}>绑定</button>
        <button className={`bb-btn ${editing ? 'active' : ''}`} onClick={() => {
          if (editing) setState({ editing: false, view2d: false, tool: 'select' })
          else setState({ editing: true, view2d: true })
        }}>
          {editing ? '退出编辑' : '编辑'}
        </button>
        <button className="bb-btn" onClick={() => setState({ settingsOpen: true })}>设置</button>
      </div>
      <div className="bb-group">
        {MODES.map((m) => (
          <button key={m} className={`bb-btn ${mode === m ? 'active' : ''}`} onClick={() => setState({ mode: m })}>
            {m}
          </button>
        ))}
      </div>
    </div>
  )
}
