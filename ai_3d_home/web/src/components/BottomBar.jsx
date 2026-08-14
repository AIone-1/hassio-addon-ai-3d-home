import { useStore, setState, getState, toast } from '../store'
import { useState } from 'react'

const MODES = ['全屋', '照明', '遮阳', '环境', '安防', '纯户型']

export default function BottomBar() {
  const mode = useStore((s) => s.mode)
  const autoRotate = useStore((s) => s.autoRotate)
  const rotateDir = useStore((s) => s.rotateDir)
  const rotateSpeed = useStore((s) => s.rotateSpeed)
  const quality = useStore((s) => s.quality)
  const shadows = useStore((s) => s.shadows)
  const showWalls = useStore((s) => s.showWalls)
  const editing = useStore((s) => s.editing)
  const project = useStore((s) => s.project)
  const deviceCount = new Set(project.floors.flatMap((f) => (f.devices || []).map((d) => d.entity_id))).size
  const [shareOpen, setShareOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.()
  }
  // 导出 3D 截图（count 张，多张时自动旋转不同角度截）
  const export3DPng = (count = 1) => {
    const canvas = document.querySelector('.canvas-wrap canvas')
    if (!canvas) return toast('请先在 3D 视图')
    const snap = (i) => {
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = count <= 1 ? '户型3D.png' : `户型3D_${i}.png`
      a.click()
    }
    if (count <= 1) { snap(1); return }
    const wasRotating = getState().autoRotate
    setState({ autoRotate: true, rotateSpeed: 3 })
    toast(`正在截取 ${count} 张不同角度…`)
    let n = 0
    const timer = setInterval(() => {
      snap(n + 1)
      n++
      if (n >= count) {
        clearInterval(timer)
        if (!wasRotating) setState({ autoRotate: false })
        toast(`已导出 ${count} 张截图`)
      }
    }, 900)
  }
  // 录制 3D 旋转视频（秒数可调，优先 mp4，浏览器不支持则 webm）
  const record3DVideo = (seconds = 6) => {
    const canvas = document.querySelector('.canvas-wrap canvas')
    if (!canvas) return toast('请先在 3D 视图')
    if (typeof MediaRecorder === 'undefined') return toast('浏览器不支持录制')
    const isMp4 = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/mp4')
    const mime = isMp4 ? 'video/mp4' : 'video/webm'
    const ext = isMp4 ? 'mp4' : 'webm'
    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: mime })
    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `户型3D.${ext}`
      a.click()
      toast('3D 视频已导出')
    }
    recorder.start()
    const wasRotating = getState().autoRotate
    setState({ autoRotate: true })
    toast(`正在录制 ${seconds} 秒旋转视频…`)
    setTimeout(() => { recorder.stop(); if (!wasRotating) setState({ autoRotate: false }) }, seconds * 1000)
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
        <button className="bb-btn" onClick={toggleFullscreen} title="全屏">⛶ 全屏</button>
        <button className="bb-btn" onClick={() => setState({ immersive: true })} title="纯净沉浸模式（双击退出）">👁 沉浸</button>
        <div style={{ position: 'relative' }}>
          <button className="bb-btn" onClick={() => setShareOpen(!shareOpen)} title="分享/导出">📤 分享</button>
          {shareOpen && (
            <div className="bb-menu">
              <div className="bb-menu-title">📷 导出 3D 图片</div>
              <button className="bb-menu-item" onClick={() => { export3DPng(1); setShareOpen(false) }}>1 张</button>
              <button className="bb-menu-item" onClick={() => { export3DPng(4); setShareOpen(false) }}>4 张（不同角度）</button>
              <button className="bb-menu-item" onClick={() => { export3DPng(8); setShareOpen(false) }}>8 张（不同角度）</button>
              <div className="bb-menu-sep" />
              <div className="bb-menu-title">🎬 录制 3D 视频</div>
              <button className="bb-menu-item" onClick={() => { record3DVideo(3); setShareOpen(false) }}>3 秒</button>
              <button className="bb-menu-item" onClick={() => { record3DVideo(6); setShareOpen(false) }}>6 秒</button>
              <button className="bb-menu-item" onClick={() => { record3DVideo(10); setShareOpen(false) }}>10 秒</button>
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button className="bb-btn" onClick={() => setQualityOpen(!qualityOpen)} title="画质设置">🎨 画质</button>
          {qualityOpen && (
            <div className="bb-menu">
              {[['eco', '流畅'], ['smooth', '均衡'], ['balanced', '高清'], ['high', '极致']].map(([v, l]) => (
                <button key={v} className={`bb-menu-item ${quality === v ? 'active' : ''}`} onClick={() => { setState({ quality: v }); setQualityOpen(false) }}>{l}</button>
              ))}
              <div className="bb-menu-sep" />
              <button className={`bb-menu-item ${shadows ? 'active' : ''}`} onClick={() => setState({ shadows: !shadows })}>☀️ 投影{shadows ? '：开' : '：关'}</button>
            </div>
          )}
        </div>
        <button className={`bb-btn ${showWalls ? 'active' : ''}`} onClick={() => setState({ showWalls: !showWalls })} title="去除/显示墙壁">
          🧱 墙
        </button>
        <button className="bb-btn" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }} title="玻璃效果（开发中）">璃玻璃</button>
      </div>
      <div className="bb-group">
        <button className="bb-btn" onClick={() => setState({ deviceListOpen: true })} title="查看已绑定设备">设备{deviceCount}</button>
        <button className={`bb-btn ${editing ? 'active' : ''}`} onClick={() => {
          if (editing) setState({ editing: false, view2d: false, tool: 'select' })
          else setState({ editing: true, view2d: true })
        }}>
          {editing ? '退出编辑' : '✏️ 编辑'}
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
