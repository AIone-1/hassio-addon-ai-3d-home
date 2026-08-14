// 六边形 HSV 色盘（React 组件，canvas 逐像素绘制，无外部库）
// 核心：角度=色相 H、到中心距离/到边缘距离=饱和度 S、明度 V 单独滑块
import { useEffect, useRef, useState } from 'react'

const N = 6                 // 边数（改 8 = 八边形）
const SIZE = 200            // canvas 边长

function hsvToRgb(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v - c
  let r, g, b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}
function toHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') }
function hexToHsv(hex) {
  const s = hex.replace('#', '')
  const r = parseInt(s.slice(0, 2), 16) / 255, g = parseInt(s.slice(2, 4), 16) / 255, b = parseInt(s.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60; if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}
// 正 N 边形中心到边缘距离（按角度）
function edgeRadius(theta, R) {
  const sector = Math.PI / N
  const t = ((theta % (2 * sector)) + 2 * sector) % (2 * sector)
  return R * Math.cos(sector) / Math.cos(t - sector)
}

export default function HexColorPicker({ value = '#5879ad', onChange }) {
  const canvasRef = useRef(null)
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const [hex, setHex] = useState(value)
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv

  const emit = (h, s, v) => {
    setHsv([h, s, v])
    const [r, g, b] = hsvToRgb(h, s, v)
    const hx = toHex(r, g, b)
    setHex(hx)
    onChange && onChange(hx)
  }

  // 绘制六边形色盘（逐像素：角度→H，距离→S，V=1）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const cx = SIZE / 2, cy = SIZE / 2, R = SIZE / 2 - 6
    const img = ctx.createImageData(SIZE, SIZE)
    const data = img.data
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.hypot(dx, dy)
        const theta = Math.atan2(dy, dx)
        const er = edgeRadius(theta, R)
        if (dist > er) continue
        const hue = (theta * 180 / Math.PI + 360) % 360
        const sat = dist / er
        const [r, g, b] = hsvToRgb(hue, sat, 1)
        const idx = (y * SIZE + x) * 4
        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [])

  // 拾取颜色（从 canvas 内的点击/拖动位置）
  const pick = (clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (clientX - rect.left) * (SIZE / rect.width)
    const y = (clientY - rect.top) * (SIZE / rect.height)
    const dx = x - SIZE / 2, dy = y - SIZE / 2
    const dist = Math.hypot(dx, dy)
    const theta = Math.atan2(dy, dx)
    const er = edgeRadius(theta, SIZE / 2 - 6)
    if (dist > er) return
    const H = (theta * 180 / Math.PI + 360) % 360
    const S = Math.min(1, dist / er)
    emit(H, S, hsvRef.current[2])
  }

  const dragging = useRef(false)

  const [r, g, b] = hsvToRgb(hsv[0], hsv[1], hsv[2])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <canvas
        ref={canvasRef}
        width={SIZE} height={SIZE}
        style={{ width: SIZE, height: SIZE, cursor: 'crosshair', borderRadius: 8 }}
        onMouseDown={(e) => { dragging.current = true; pick(e.clientX, e.clientY) }}
        onMouseMove={(e) => { if (dragging.current) pick(e.clientX, e.clientY) }}
        onMouseUp={() => { dragging.current = false }}
        onMouseLeave={() => { dragging.current = false }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>明度</span>
        <input type="range" min="0" max="100" value={Math.round(hsv[2] * 100)} style={{ flex: 1 }}
          onChange={(e) => emit(hsv[0], hsv[1], Number(e.target.value) / 100)} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: hex, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>H{Math.round(hsv[0])}° S{Math.round(hsv[1] * 100)}% V{Math.round(hsv[2] * 100)}%</span>
        <input type="text" value={hex} maxLength={7}
          style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12, fontFamily: 'Menlo, monospace' }}
          onChange={(e) => {
            const v = e.target.value.trim()
            if (!/^#?[0-9a-fA-F]{6}$/.test(v)) return
            const [h, s, vv] = hexToHsv(v.replace('#', ''))
            emit(h, s, vv)
          }} />
      </div>
    </div>
  )
}
