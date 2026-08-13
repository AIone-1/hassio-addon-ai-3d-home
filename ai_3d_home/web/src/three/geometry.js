// 程序化几何构建（坐标方案已验证：墙先旋转后平移、地板 DoubleSide、z 不翻转）

// 家具库：尺寸对齐原版（长×宽 m）
export const FURNITURE_LIB = [
  { type: '沙发', w: 2.2, d: 0.9 },
  { type: '床', w: 1.8, d: 2.0 },
  { type: '餐桌', w: 1.4, d: 0.82 },
  { type: '书桌', w: 1.2, d: 0.6 },
  { type: '衣柜', w: 1.4, d: 0.6 },
  { type: '橱柜', w: 1.6, d: 0.6 },
  { type: '岛台', w: 1.8, d: 0.9 },
  { type: '茶几', w: 1.0, d: 0.55 },
  { type: '书架', w: 1.1, d: 0.32 },
]

export const FURNITURE_COLORS = {
  沙发: '#4f6a88', 床: '#5f5378', 餐桌: '#8a5f38', 书桌: '#7a5030',
  衣柜: '#5a4528', 橱柜: '#5a4528', 岛台: '#6f5f4a', 茶几: '#8a5f38', 书架: '#6f4a30',
}

export const WALL_THICK = 0.12

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
