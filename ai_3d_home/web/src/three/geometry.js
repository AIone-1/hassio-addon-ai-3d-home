// 程序化几何构建（坐标方案已验证：墙先旋转后平移、地板 DoubleSide、z 不翻转）

// 家具库：尺寸对齐原版（长×宽×高 m）
export const FURNITURE_LIB = [
  { type: '沙发', w: 2.2, d: 0.9, h: 0.68 },
  { type: '床', w: 1.8, d: 2.0, h: 0.42 },
  { type: '餐桌', w: 1.4, d: 0.82, h: 0.62 },
  { type: '书桌', w: 1.2, d: 0.6, h: 0.62 },
  { type: '衣柜', w: 1.4, d: 0.6, h: 1.22 },
  { type: '橱柜', w: 1.6, d: 0.6, h: 0.72 },
  { type: '岛台', w: 1.8, d: 0.9, h: 0.72 },
  { type: '茶几', w: 1.0, d: 0.55, h: 0.3 },
  { type: '书架', w: 1.1, d: 0.32, h: 1.12 },
]

// 2D 平面图家具描边色（浅色系，对齐原版 floor plan 风格）
export const FURNITURE_COLORS = {
  沙发: '#718b80', 床: '#a58b76', 餐桌: '#a67e5f', 书桌: '#a67e5f',
  衣柜: '#778b7e', 橱柜: '#778b7e', 岛台: '#987c62', 茶几: '#937d70', 书架: '#748774',
}

// 3D 家具主题色（对齐原版 glass 风格：统一蓝灰，不是每件一个色）
export const FURNITURE_MAIN = '#8f9fbb'
export const FURNITURE_DETAIL = '#667897'
export const FURNITURE_ACCENT = '#eaf2ff'

export const WALL_THICK = 0.12

// 地板调色板（对齐原版 glass 风格冷色系，每个房间按序号取色）
export const FLOOR_PALETTE = ['#7789ad', '#8294b7', '#8a9bbd', '#7285aa', '#7e91b5']

// 房间多边形 → 顶点（x, z）数组
export function roomPoints(room) {
  return room.points || []
}

// 房间所有墙段 [ {a:[x,z], b:[x,z]} ]
export function roomWallSegments(room) {
  const pts = roomPoints(room)
  const segs = []
  for (let i = 0; i < pts.length; i++) {
    segs.push({ a: pts[i], b: pts[(i + 1) % pts.length] })
  }
  return segs
}

// 墙段唯一 key（忽略方向），用于去重共享墙
export function wallKey(seg) {
  const a = [Math.round(seg.a[0] * 100), Math.round(seg.a[1] * 100)]
  const b = [Math.round(seg.b[0] * 100), Math.round(seg.b[1] * 100)]
  const lo = (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) ? a : b
  const hi = lo === a ? b : a
  return `${lo[0]},${lo[1]}-${hi[0]},${hi[1]}`
}

// 清洗多边形：去掉连续重复点和共线点，避免生成退化地板
export function cleanPolygon(points) {
  if (!points || points.length < 3) return points
  const out = []
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n]
    const b = points[i]
    const c = points[(i + 1) % n]
    // 重复点
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue
    // 共线点（叉积≈0）
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(cross) < 0.01) continue
    out.push(b)
  }
  return out
}

// 多边形是否有效（面积>阈值）
export function polygonArea(points) {
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area) / 2
}

// 万能地板几何：按多边形实际形状，直接铺在水平面 (x, 0, z)，法线朝上
// 用 triangulateShape 剖分，失败则扇形剖分（保证任何形状都有地板）
export function robustFloorGeometry(points, THREE) {
  const verts = points.map((p) => new THREE.Vector2(p[0], p[1]))
  let faces = []
  try {
    faces = THREE.ShapeUtils.triangulateShape(verts, [])
  } catch (e) {
    faces = []
  }
  if (!faces.length && points.length >= 3) {
    faces = []
    for (let i = 1; i < points.length - 1; i++) {
      faces.push([0, i, i + 1])
    }
  }
  const positions = []
  for (const f of faces) {
    for (const idx of f) {
      positions.push(points[idx][0], 0, points[idx][1])  // 直接水平：x, 0, z
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

// ==================== 墙体多边形化（对齐原版 _l + $l） ====================
// 墙是线段（start/end），房间从墙段的封闭环自动检测出来——这就是"共用墙/相交线也封闭"的机制

// 线段-线段交点（含端点），无交点返回 null
export function segmentIntersect(a, b, c, d) {
  const ab = [b[0] - a[0], b[1] - a[1]]
  const cd = [d[0] - c[0], d[1] - c[1]]
  const cross = ab[0] * cd[1] - ab[1] * cd[0]
  if (Math.abs(cross) < 1e-6) return null
  const ac = [c[0] - a[0], c[1] - a[1]]
  const t = (ac[0] * cd[1] - ac[1] * cd[0]) / cross
  const u = (ac[0] * ab[1] - ac[1] * ab[0]) / cross
  if (t < -1e-5 || t > 1 + 1e-5 || u < -1e-5 || u > 1 + 1e-5) return null
  return [a[0] + t * ab[0], a[1] + t * ab[1]]
}

// 点到线段的最短距离 + 投影参数 t（0-1，沿线段位置）
export function pointToSeg(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]]
  const ap = [p[0] - a[0], p[1] - a[1]]
  const len2 = ab[0] * ab[0] + ab[1] * ab[1]
  if (len2 < 1e-10) return { dist: Math.hypot(ap[0], ap[1]), t: 0 }
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / len2))
  const proj = [a[0] + t * ab[0], a[1] + t * ab[1]]
  return { dist: Math.hypot(p[0] - proj[0], p[1] - proj[1]), t }
}

// 点是否在线段上
export function pointOnSeg(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]]
  const ap = [p[0] - a[0], p[1] - a[1]]
  if (Math.abs(ab[0] * ap[1] - ab[1] * ap[0]) > 1e-5) return false
  const dot = ap[0] * ab[0] + ap[1] * ab[1]
  const len2 = ab[0] * ab[0] + ab[1] * ab[1]
  return dot >= -1e-5 && dot <= len2 + 1e-5
}

const _pk = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`
const _dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

// 有符号面积（shoelace，正=逆时针，负=顺时针）——去重时只用正值，排除外环/反向重复面
function _signedArea(points) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return area / 2
}

// 去掉连续重复点 / 共线点（闭合环清洗）
function cleanLoop(points) {
  let t = points
  let changed = true
  while (changed && t.length > 3) {
    changed = false
    t = t.filter((p, i) => {
      const l = t[(i - 1 + t.length) % t.length]
      const h = t[(i + 1) % t.length]
      const dup = _dist2(p, l) < 1e-10
      const dup2 = _dist2(l, h) < 1e-10
      const cross = (h[0] - p[0]) * (l[1] - p[1]) - (h[1] - p[1]) * (l[0] - p[0])
      const collinear = Math.abs(cross) <= 1e-5
      if (dup || dup2 || collinear) changed = true
      return !dup && !dup2 && !collinear
    })
  }
  return t
}

// 多边形质心
export function centroid(points) {
  const a = polygonArea(points)
  if (a < 1e-9) return points.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((v) => v / points.length)
  let cx = 0, cy = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length]
    const cross = p[0] * q[1] - q[0] * p[1]
    cx += (p[0] + q[0]) * cross
    cy += (p[1] + q[1]) * cross
  }
  return [cx / (6 * a), cy / (6 * a)]
}

// 点是否在多边形内（射线法）
export function pointInPolygon(p, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

// 从旧版房间多边形反推墙段（迁移用，去重共享墙）
export function roomsToWalls(rooms) {
  const seen = new Set()
  const walls = []
  for (const room of rooms || []) {
    const pts = room.points || room.polygon || []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      const k = wallKey({ a, b })
      if (!seen.has(k)) {
        seen.add(k)
        walls.push({ id: `w-${walls.length}`, start: a, end: b })
      }
    }
  }
  return walls
}

// 从墙段数组检测所有封闭房间（返回多边形顶点数组 [x,z]）
// walls: [{ start:[x,z], end:[x,z] }]
export function detectRooms(walls) {
  if (!walls || walls.length < 3) return []
  // 1. 每条墙段收集其上的所有交点 + 落在其上的其它墙端点
  const wallPts = walls.map((w) => [w.start, w.end])
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i], b = walls[j]
      const ip = segmentIntersect(a.start, a.end, b.start, b.end)
      if (ip) { wallPts[i].push(ip); wallPts[j].push(ip) }
      if (pointOnSeg(b.start, a.start, a.end)) wallPts[i].push(b.start)
      if (pointOnSeg(b.end, a.start, a.end)) wallPts[i].push(b.end)
      if (pointOnSeg(a.start, b.start, b.end)) wallPts[j].push(a.start)
      if (pointOnSeg(a.end, b.start, b.end)) wallPts[j].push(a.end)
    }
  }
  // 2. 每条墙段内去重点并沿方向排序 → 建平面图（节点/边/邻接）
  const nodes = new Map()
  const edges = new Map()
  walls.forEach((w, idx) => {
    const dir = [w.end[0] - w.start[0], w.end[1] - w.start[1]]
    const len2 = dir[0] * dir[0] + dir[1] * dir[1] || 1
    const sorted = [...new Map(wallPts[idx].map((p) => [_pk(p), p])).values()].sort((p, q) => {
      const tp = ((p[0] - w.start[0]) * dir[0] + (p[1] - w.start[1]) * dir[1]) / len2
      const tq = ((q[0] - w.start[0]) * dir[0] + (q[1] - w.start[1]) * dir[1]) / len2
      return tp - tq
    })
    for (let k = 0; k < sorted.length - 1; k++) {
      const a = sorted[k], b = sorted[k + 1]
      if (_dist2(a, b) < 1e-10) continue
      const ka = _pk(a), kb = _pk(b)
      nodes.set(ka, a); nodes.set(kb, b)
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      edges.set(ek, [ka, kb])
    }
  })
  const adj = new Map()
  for (const [a, b] of edges.values()) {
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a).add(b); adj.get(b).add(a)
  }
  // 3. 面遍历（右手规则）找封闭环
  const visited = new Set()
  const dkey = (a, b) => `${a}>${b}`
  const trace = (a, b) => {
    const loop = []
    let cur = a, next = b
    const maxSteps = edges.size * 2 + 2
    for (let s = 0; s < maxSteps; s++) {
      const dk = dkey(cur, next)
      if (visited.has(dk)) return null
      visited.add(dk)
      loop.push(cur)
      const pt = nodes.get(next)
      const nbrs = [...(adj.get(next) || [])]
      if (!pt || nbrs.length < 1) return null
      nbrs.sort((x, y) => {
        const px = nodes.get(x), py = nodes.get(y)
        return Math.atan2(px[1] - pt[1], px[0] - pt[0]) - Math.atan2(py[1] - pt[1], py[0] - pt[0])
      })
      const gi = nbrs.indexOf(cur)
      if (gi < 0) return null
      const turn = nbrs[(gi - 1 + nbrs.length) % nbrs.length]
      cur = next; next = turn
      if (cur === a && next === b) break
    }
    if (loop.length < 3) return null
    return cleanLoop(loop.map((k) => nodes.get(k)))
  }
  const rooms = []
  for (const [a, b] of edges.values()) {
    for (const [u, v] of [[a, b], [b, a]]) {
      if (visited.has(dkey(u, v))) continue
      const face = trace(u, v)
      if (face && _signedArea(face) > 0.25) rooms.push(face)
    }
  }
  return rooms
}

// 从墙段重算房间（检测封闭环 + 按质心重叠匹配旧房间，保留 id/名字/颜色）
export function recomputeRooms(floor) {
  const polys = detectRooms(floor.walls || [])
  const old = floor.rooms || []
  const used = new Set()
  return polys.map((poly, i) => {
    const c = centroid(poly)
    const match = old
      .filter((r) => !used.has(r.id))
      .map((r) => ({ room: r, center: centroid(r.points || r.polygon || []) }))
      .filter(({ room, center }) => pointInPolygon(c, room.points || room.polygon) || pointInPolygon(center, poly))
      .sort((a, b) => _dist2(c, a.center) - _dist2(c, b.center))[0]
    if (match) used.add(match.room.id)
    return {
      id: match ? match.room.id : `r-${i}-${Math.random().toString(36).slice(2, 7)}`,
      name: match ? match.room.name : `房间${i + 1}`,
      points: poly,
      height: (match ? match.room.height : undefined) || floor.height || 2.8,
      color: FLOOR_PALETTE[i % FLOOR_PALETTE.length],
    }
  })
}


