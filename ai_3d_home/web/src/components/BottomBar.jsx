import { useStore, setState } from '../store'

const MODES = ['全屋', '照明', '遮阳', '环境', '安防']

export default function BottomBar() {
  const mode = useStore((s) => s.mode)
  const autoRotate = useStore((s) => s.autoRotate)
  const quality = useStore((s) => s.quality)
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
        <button className={`bb-btn ${autoRotate ? 'active' : ''}`} onClick={() => setState({ autoRotate: !autoRotate })}>
          🔄 旋转
        </button>
        <button className="bb-btn" onClick={() => setState((s) => ({ recenterKey: s.recenterKey + 1 }))} title="居中视角">
          ⌖ 居中
        </button>
        <button className="bb-btn" onClick={cycleQuality} title="切换画质">
          {qLabel}
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
