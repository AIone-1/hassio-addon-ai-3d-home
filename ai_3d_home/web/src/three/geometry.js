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
  沙发: '#6f8fae', 床: '#8a7f9e', 餐桌: '#b08968', 书桌: '#a07850',
  衣柜: '#7d6848', 橱柜: '#7d6848', 岛台: '#9a8a78', 茶几: '#b08968', 书架: '#8a6b4f',
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

// 几何变换辅助：构造一个贴墙的长方体
export function wallBoxGeometry(len, h, thickness) {
  // 这里用 JSX 直接画 box，不需要手动构造 BufferGeometry
  return { len, h, thickness }
}
