// 3D 视图里的属性面板（简化版）：墙/家具/设备 选中后弹面板改常用属性
// 和 2D 编辑器共用同一份数据；墙=长度/高度/厚度/颜色/不透明度/壁纸，家具=高度/旋转/缩放/删除，设备=高度/删除
import { useState, useEffect } from 'react'
import * as THREE from 'three'
import { useStore, setState, getState, toast } from '../store'
import { recomputeRooms } from '../three/geometry'
import { api, BASE } from '../api'

const WALL_COLORS = ['#ffffff', '#d5e0f1', '#f5f7fa', '#e8e4dc', '#c9c9c9', '#d8e8f0', '#e0d8e8', '#d0e8d8', '#f0e0d0']

// 全色系调色板（蜂窝/网格状选色器：每个色相两档明度 + 灰度）
const FULL_PALETTE = (() => {
  const out = []
  for (let h = 0; h < 360; h += 15) {
    out.push(`hsl(${h}, 72%, 55%)`)
    out.push(`hsl(${h}, 88%, 72%)`)
    out.push(`hsl(${h}, 60%, 38%)`)
  }
  out.push('#ffffff', '#e5e7eb', '#cbd5e1', '#94a3b8', '#64748b', '#334155', '#0f172a', '#1f2937')
  return out
})()

// 常用颜色（localStorage 持久化）
const FAV_KEY = 'ai3d_fav_colors'
const getFav = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] } }
const saveFav = (list) => { try { localStorage.setItem(FAV_KEY, JSON.stringify(list)) } catch {} }

export default function WallProps3D({ floorIndex }) {
  const selected = useStore((s) => s.selected)
  const wallSelIds = useStore((s) => s.wallSel)
  const wallOpacity = useStore((s) => s.wallOpacity)
  const [favColors, setFavColors] = useState(getFav())
  const [bgList, setBgList] = useState([])
  useEffect(() => { api.backgrounds().then((r) => setBgList(r.images || [])).catch(() => {}) }, [])
  if (!selected && wallSelIds.length === 0) return null

  const toggleFav = (c) => {
    const next = favColors.includes(c) ? favColors.filter((x) => x !== c) : [...favColors, c]
    setFavColors(next)
    saveFav(next)
  }

  const fl = getState().project.floors[floorIndex]
  const commit = (fn) => {
    fn()
    if (wallSelIds.length > 0) fl.rooms = recomputeRooms(fl)
    setState({ project: { ...getState().project }, saved: false })
  }

  // ---------- 批量墙（多选） ----------
  if (wallSelIds.length > 1) {
    const walls = (fl.walls || []).filter((w) => wallSelIds.includes(w.id))
    const setAll = (patch) => commit(() => walls.forEach((w) => Object.assign(w, patch)))
    const curColor = walls.length ? (walls[0].color || '#d5e0f1') : '#d5e0f1'
    return (
      <div className="plan-props">
        <div className="plan-props-head"><span>已选 {walls.length} 面墙</span></div>
        <div className="plan-props-row">
          <span className="plan-props-label">高度</span>
          <input type="number" step="0.1" min="1" max="6" placeholder="统一" onChange={(e) => { if (e.target.value) setAll({ height: Number(e.target.value) || 2.8 }) }} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">厚度</span>
          <input type="number" step="0.02" min="0.05" max="0.5" placeholder="统一" onChange={(e) => { if (e.target.value) setAll({ thickness: Number(e.target.value) || 0.12 }) }} />
          <span className="plan-props-unit">m</span>
        </div>
        <div className="plan-props-row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="plan-props-label">颜色</span>
          {WALL_COLORS.map((c) => (
            <button key={c} title={c} className={`plan-props-swatch ${curColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setAll({ color: c })} />
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', margin: '4px 0 8px' }}>
          {FULL_PALETTE.map((c) => (
            <button key={c} title={c} style={{ width: 16, height: 16, margin: 1, borderRadius: 3, border: curColor === c ? '2px solid var(--accent)' : '1px solid var(--border)', background: c, cursor: 'pointer', padding: 0 }} onClick={() => setAll({ color: c })} />
          ))}
        </div>
        <div className="plan-props-row">
          <span className="plan-props-label">不透明度</span>
          <input type="range" min="10" max="100" step="5" style={{ flex: 1 }} value={walls.length ? (walls[0].opacity != null ? walls[0].opacity : wallOpacity) : wallOpacity} onChange={(e) => setAll({ opacity: Number(e.target.value) })} />
          <span className="plan-props-unit">{walls.length ? (walls[0].opacity != null ? walls[0].opacity : wallOpacity) : wallOpacity}%</span>
        </div>
      </div>
    )
  }

  // ---------- 墙（单选） ----------
  if (wallSelIds.length === 1) {
    const wall = (fl.walls || []).find((w) => w.id === wallSelIds[0])
    if (!wall) return null
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
        <div className="plan-props-row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="plan-props-label">颜色</span>
          {WALL_COLORS.map((c) => (
            <button key={c} title={c}
              className={`plan-props-swatch ${(wall.color || '#d5e0f1') === c ? 'active' : ''}`}
              style={{ background: c }} onClick={() => commit(() => { wall.color = c })} />
          ))}
          <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => toggleFav(wall.color || '#d5e0f1')}>
            {favColors.includes(wall.color || '#d5e0f1') ? '★ 已收藏' : '☆ 收藏'}
          </button>
        </div>
        {favColors.length > 0 && (
          <div className="plan-props-row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="plan-props-label">常用</span>
            {favColors.map((c) => (
              <button key={c} title={c}
                className={`plan-props-swatch ${wall.color === c ? 'active' : ''}`}
                style={{ background: c }} onClick={() => commit(() => { wall.color = c })} />
            ))}
          </div>
        )}
        {/* RGB 数值输入 */}
        {(() => {
          const cc = new THREE.Color(wall.color || '#d5e0f1')
          const r = Math.round(cc.r * 255), g = Math.round(cc.g * 255), b = Math.round(cc.b * 255)
          const setRgb = (nr, ng, nb) => {
            const hex = '#' + [nr, ng, nb].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
            commit(() => { wall.color = hex })
          }
          return (
            <div className="plan-props-row">
              <span className="plan-props-label">RGB</span>
              <input type="number" min="0" max="255" value={r} onChange={(e) => setRgb(Number(e.target.value) || 0, g, b)} style={{ width: 52 }} />
              <input type="number" min="0" max="255" value={g} onChange={(e) => setRgb(r, Number(e.target.value) || 0, b)} style={{ width: 52 }} />
              <input type="number" min="0" max="255" value={b} onChange={(e) => setRgb(r, g, Number(e.target.value) || 0)} style={{ width: 52 }} />
            </div>
          )
        })()}
        {/* 全色系蜂窝布局（大六边形由小六边形组成） */}
        {(() => {
          const lens = [7, 9, 11, 13, 13, 11, 9, 7]  // 上下短中间长，整体呈六边形
          const rows = []
          let idx = 0
          for (const l of lens) { rows.push(FULL_PALETTE.slice(idx, idx + l)); idx += l }
          const hex = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
          return (
            <div style={{ margin: '4px 0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {rows.map((row, ri) => (
                <div key={ri} style={{ display: 'flex', marginTop: ri > 0 ? -6 : 0 }}>
                  {row.map((c) => (
                    <button key={c} title={c} style={{ width: 22, height: 25, margin: '0 1px', clipPath: hex, border: 'none', background: c, cursor: 'pointer', padding: 0, outline: wall.color === c ? '2px solid var(--accent)' : 'none' }} onClick={() => commit(() => { wall.color = c })} />
                  ))}
                </div>
              ))}
            </div>
          )
        })()}
        <div className="plan-props-row">
          <span className="plan-props-label">壁纸</span>
          <input type="file" accept="image/*" id="wall-texture-file" style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = async () => {
                try {
                  const r = await fetch(BASE + 'api/background', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: reader.result }),
                  })
                  const res = await r.json()
                  if (res.ok && res.name) { commit(() => { wall.texture = res.name }); setBgList([{ name: res.name }, ...bgList]); toast('壁纸已上传') }
                } catch (err) { toast('上传失败') }
              }
              reader.readAsDataURL(file)
            }} />
          <button onClick={() => document.getElementById('wall-texture-file').click()}>{wall.texture ? '更换壁纸' : '上传壁纸'}</button>
          {wall.texture && <button style={{ color: 'var(--danger)' }} onClick={() => commit(() => { wall.texture = '' })}>清除</button>}
        </div>
        {bgList.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
            {bgList.map((img) => (
              <img key={img.name} src={BASE + 'api/background/' + img.name} alt=""
                style={{ width: 48, height: 32, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: wall.texture === img.name ? '2px solid var(--accent)' : '1px solid var(--border)' }}
                onClick={() => commit(() => { wall.texture = img.name })} />
            ))}
          </div>
        )}
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
