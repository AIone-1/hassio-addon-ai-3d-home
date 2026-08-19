// 程序化几何构建（坐标方案已验证：墙先旋转后平移、地板 DoubleSide、z 不翻转）

// 家具库：尺寸对齐原版（长×宽×高 m），placement 决定挂哪（floor 地面 / wall 墙面 / ceiling 屋顶）
export const FURNITURE_LIB = [
  { type: '沙发', w: 2.2, d: 0.9, h: 0.68, placement: 'floor' },
  { type: '床', w: 1.8, d: 2.0, h: 0.42, placement: 'floor' },
  { type: '餐桌', w: 1.4, d: 0.82, h: 0.62, placement: 'floor' },
  { type: '书桌', w: 1.2, d: 0.6, h: 0.62, placement: 'floor' },
  { type: '衣柜', w: 1.4, d: 0.6, h: 1.22, placement: 'floor' },
  { type: '橱柜', w: 1.6, d: 0.6, h: 0.72, placement: 'floor' },
  { type: '岛台', w: 1.8, d: 0.9, h: 0.72, placement: 'floor' },
  { type: '茶几', w: 1.0, d: 0.55, h: 0.3, placement: 'floor' },
  { type: '书架', w: 1.1, d: 0.32, h: 1.12, placement: 'floor' },
  { type: '马桶', w: 0.4, d: 0.68, h: 0.75, placement: 'floor' },
  { type: '空气净化器', w: 0.26, d: 0.26, h: 0.62, placement: 'floor' },
  { type: '电视机', w: 1.4, d: 0.3, h: 0.85, placement: 'floor' },
  { type: '壁灯', w: 0.25, d: 0.2, h: 0.35, placement: 'wall' },
  { type: '挂画', w: 0.6, d: 0.06, h: 0.8, placement: 'wall' },
  { type: '吊灯', w: 0.5, d: 0.5, h: 0.7, placement: 'ceiling' },
  { type: '吸顶灯', w: 0.45, d: 0.45, h: 0.16, placement: 'ceiling' },
  { type: '筒灯', w: 0.16, d: 0.16, h: 0.06, placement: 'ceiling' },
  { type: '空调', w: 0.8, d: 0.22, h: 0.3, placement: 'wall' },
  { type: '热水器', w: 0.45, d: 0.6, h: 0.45, placement: 'wall' },
  { type: '窗帘', w: 1.5, d: 0.12, h: 2.0, placement: 'wall' },
  { type: '传感器', w: 0.16, d: 0.16, h: 0.05, placement: 'wall' },
  { type: '开关', w: 0.1, d: 0.04, h: 0.14, placement: 'wall' },
  { type: '感应器', w: 0.14, d: 0.14, h: 0.06, placement: 'wall' },
  { type: '风扇', w: 0.9, d: 0.9, h: 0.28, placement: 'ceiling' },
  { type: '灯带', w: 1.0, d: 0.06, h: 0.03, placement: 'ceiling' },
  { type: '柜子', w: 1.0, d: 0.5, h: 1.5, placement: 'floor' },
  { type: '门', w: 0.9, d: 0.08, h: 2.0, placement: 'floor' },
]

// 挂墙家具默认离地高度（m）；挂顶用层高、地面为 0
export const FURNITURE_WALL_HEIGHT = 1.2

// 设备模型目录（对齐 JMGLink 原版：id + kind 分类 + label + placement + defaultHeight + 尺寸 w/d/h 米）
// 这里从原版 bundle 里完整提取了设备模型清单，程序化几何渲染在 Scene.jsx 的 DeviceModel
export const DEVICE_MODELS = [
  // 灯光 light
  { id: 'light.ceiling', kind: 'light', label: '吸顶灯', placement: 'ceiling', defaultHeight: 1.62, w: 0.42, d: 0.42, h: 0.1 },
  { id: 'light.downlight', kind: 'light', label: '筒灯/射灯', placement: 'ceiling', defaultHeight: 1.66, w: 0.13, d: 0.13, h: 0.06 },
  { id: 'light.chandelier', kind: 'light', label: '吊灯', placement: 'ceiling', defaultHeight: 1.48, w: 0.4, d: 0.4, h: 0.7 },
  { id: 'light.floor_lamp', kind: 'light', label: '落地灯', placement: 'floor', defaultHeight: 0, w: 0.3, d: 0.3, h: 1.5 },
  { id: 'light.strip', kind: 'light', label: '灯带', placement: 'ceiling', defaultHeight: 1.44, w: 1.0, d: 0.05, h: 0.03 },
  // 开关 switch
  { id: 'switch.wall', kind: 'switch', label: '单键开关', placement: 'wall', defaultHeight: 0.92, w: 0.09, d: 0.03, h: 0.09 },
  { id: 'switch.double', kind: 'switch', label: '双键开关', placement: 'wall', defaultHeight: 0.92, w: 0.09, d: 0.03, h: 0.14 },
  { id: 'switch.triple', kind: 'switch', label: '三键开关', placement: 'wall', defaultHeight: 0.92, w: 0.09, d: 0.03, h: 0.2 },
  { id: 'switch.scene', kind: 'switch', label: '场景按钮', placement: 'wall', defaultHeight: 0.88, w: 0.09, d: 0.03, h: 0.09 },
  { id: 'switch.ac_airflow', kind: 'switch', label: '空调开关', placement: 'wall', defaultHeight: 0.94, w: 0.09, d: 0.03, h: 0.14 },
  { id: 'switch.outlet', kind: 'switch', label: '智能插座', placement: 'wall', defaultHeight: 0.28, w: 0.09, d: 0.04, h: 0.09 },
  // 窗帘 cover
  { id: 'cover.curtain', kind: 'cover', label: '窗帘', placement: 'wall', defaultHeight: 1.12, w: 1.5, d: 0.12, h: 2.0 },
  { id: 'cover.blind', kind: 'cover', label: '百叶/卷帘', placement: 'wall', defaultHeight: 1.12, w: 1.2, d: 0.08, h: 1.5 },
  // 空调 climate
  { id: 'climate.wall_ac', kind: 'climate', label: '壁挂空调', placement: 'wall', defaultHeight: 1.32, w: 0.8, d: 0.22, h: 0.3 },
  { id: 'climate.central_ac', kind: 'climate', label: '中央空调', placement: 'ceiling', defaultHeight: 1.58, w: 0.6, d: 0.6, h: 0.3 },
  { id: 'climate.floor_ac', kind: 'climate', label: '柜式空调', placement: 'floor', defaultHeight: 0, w: 0.5, d: 0.4, h: 1.7 },
  { id: 'climate.thermostat', kind: 'climate', label: '温控面板', placement: 'wall', defaultHeight: 0.96, w: 0.09, d: 0.03, h: 0.13 },
  // 传感器 sensor
  { id: 'sensor.wall', kind: 'sensor', label: '通用传感器', placement: 'wall', defaultHeight: 1, w: 0.12, d: 0.12, h: 0.04 },
  { id: 'sensor.temperature', kind: 'sensor', label: '温度传感器', placement: 'wall', defaultHeight: 0.98, w: 0.08, d: 0.1, h: 0.03 },
  { id: 'sensor.humidity', kind: 'sensor', label: '湿度传感器', placement: 'wall', defaultHeight: 0.98, w: 0.08, d: 0.1, h: 0.03 },
  { id: 'sensor.light_level', kind: 'sensor', label: '照度传感器', placement: 'ceiling', defaultHeight: 1.45, w: 0.1, d: 0.1, h: 0.04 },
  { id: 'sensor.co2', kind: 'sensor', label: 'CO₂ 传感器', placement: 'wall', defaultHeight: 0.98, w: 0.1, d: 0.1, h: 0.04 },
  { id: 'sensor.pm25', kind: 'sensor', label: 'PM2.5 传感器', placement: 'wall', defaultHeight: 0.98, w: 0.1, d: 0.1, h: 0.04 },
  { id: 'sensor.air_quality', kind: 'sensor', label: '空气质量', placement: 'wall', defaultHeight: 0.96, w: 0.1, d: 0.1, h: 0.04 },
  { id: 'sensor.power', kind: 'sensor', label: '电量仪表', placement: 'wall', defaultHeight: 0.9, w: 0.08, d: 0.08, h: 0.03 },
  // 安防感应 binary_sensor
  { id: 'binary_sensor.wall', kind: 'binary_sensor', label: '安防传感器', placement: 'wall', defaultHeight: 1, w: 0.1, d: 0.1, h: 0.04 },
  { id: 'binary_sensor.door', kind: 'binary_sensor', label: '门窗传感器', placement: 'wall', defaultHeight: 1, w: 0.04, d: 0.08, h: 0.02 },
  { id: 'binary_sensor.motion', kind: 'binary_sensor', label: '人体传感器', placement: 'ceiling', defaultHeight: 1.5, w: 0.12, d: 0.12, h: 0.06 },
  { id: 'binary_sensor.presence', kind: 'binary_sensor', label: '存在传感器', placement: 'ceiling', defaultHeight: 1.48, w: 0.1, d: 0.1, h: 0.04 },
  { id: 'binary_sensor.smoke', kind: 'binary_sensor', label: '烟雾燃气', placement: 'ceiling', defaultHeight: 1.55, w: 0.13, d: 0.13, h: 0.05 },
  { id: 'binary_sensor.water', kind: 'binary_sensor', label: '水浸传感器', placement: 'floor', defaultHeight: 0.04, w: 0.06, d: 0.06, h: 0.02 },
  // 摄像机 camera
  { id: 'camera.wall', kind: 'camera', label: '摄像头', placement: 'wall', defaultHeight: 1.25, w: 0.1, d: 0.1, h: 0.09 },
  { id: 'camera.dome', kind: 'camera', label: '云台球机', placement: 'ceiling', defaultHeight: 1.5, w: 0.12, d: 0.12, h: 0.1 },
  { id: 'camera.bullet', kind: 'camera', label: '枪机摄像头', placement: 'wall', defaultHeight: 1.35, w: 0.22, d: 0.1, h: 0.1 },
  { id: 'camera.doorbell', kind: 'camera', label: '可视门铃', placement: 'wall', defaultHeight: 1.08, w: 0.08, d: 0.05, h: 0.16 },
  // 门锁 lock
  { id: 'lock.door', kind: 'lock', label: '智能门锁', placement: 'wall', defaultHeight: 0.96, w: 0.14, d: 0.06, h: 0.3 },
  // 风扇 fan
  { id: 'fan.ceiling', kind: 'fan', label: '吊扇', placement: 'ceiling', defaultHeight: 1.5, w: 0.9, d: 0.9, h: 0.28 },
  { id: 'fan.floor', kind: 'fan', label: '落地扇', placement: 'floor', defaultHeight: 0, w: 0.4, d: 0.4, h: 1.0 },
  { id: 'fan.tower', kind: 'fan', label: '塔扇', placement: 'floor', defaultHeight: 0, w: 0.25, d: 0.25, h: 1.0 },
  // 影音 media_player
  { id: 'media_player.tv', kind: 'media_player', label: '电视', placement: 'wall', defaultHeight: 1, w: 1.4, d: 0.08, h: 0.85 },
  { id: 'media_player.speaker', kind: 'media_player', label: '音箱', placement: 'surface', defaultHeight: 0.55, w: 0.2, d: 0.2, h: 0.3 },
  // 扫地机器人 vacuum
  { id: 'vacuum.robot', kind: 'vacuum', label: '扫地机器人', placement: 'floor', defaultHeight: 0.04, w: 0.35, d: 0.35, h: 0.09 },
  // 安防面板 alarm_control_panel
  { id: 'alarm.panel', kind: 'alarm_control_panel', label: '安防面板', placement: 'wall', defaultHeight: 0.95, w: 0.2, d: 0.05, h: 0.3 },
  // 通用 custom
  { id: 'custom.point', kind: 'custom', label: '通用设备', placement: 'surface', defaultHeight: 0.75, w: 0.15, d: 0.15, h: 0.1 },
]

// 设备模型按 kind 分组（显示用）
export const DEVICE_KINDS = [
  { kind: 'light', label: '灯光' },
  { kind: 'switch', label: '开关' },
  { kind: 'cover', label: '窗帘' },
  { kind: 'climate', label: '空调' },
  { kind: 'sensor', label: '传感器' },
  { kind: 'binary_sensor', label: '感应器' },
  { kind: 'camera', label: '摄像机' },
  { kind: 'fan', label: '风扇' },
  { kind: 'lock', label: '门锁' },
  { kind: 'media_player', label: '影音' },
  { kind: 'vacuum', label: '扫地机' },
  { kind: 'alarm_control_panel', label: '安防' },
  { kind: 'custom', label: '通用' },
]

// 门颜色（5 色）+ 门/窗类型（key 存数据，label 面板显示）
export const DOOR_COLORS = { 木色: '#a97c50', 白: '#e8ecef', 灰: '#8b9298', 黑: '#2c3035', 蓝: '#4a7ab5' }

// 家具自定义颜色（8 色，选空=默认蓝灰主题色）
export const FURNITURE_COLOR_PALETTE = { 木色: '#a97c50', 白: '#e8ecef', 灰: '#8b9298', 黑: '#2c3035', 蓝: '#4a7ab5', 红: '#c0504d', 绿: '#5a9c6a', 橙: '#d08a4a' }
export const DOOR_STYLES = [
  { key: 'swing', label: '平开门' },
  { key: 'closed', label: '关门' },
  { key: 'double', label: '双开门' },
  { key: 'slide', label: '推拉门' },
  { key: 'frame', label: '门框' },
]
export const WINDOW_STYLES = [
  { key: 'standard', label: '普通窗' },
  { key: 'floor_to_ceiling', label: '落地窗' },
  { key: 'slide', label: '推拉窗' },
  { key: 'bay', label: '飘窗' },
  { key: 'no_glass', label: '无玻璃窗' },
]

// 2D 平面图家具描边色（浅色系，对齐原版 floor plan 风格）
export const FURNITURE_COLORS = {
  沙发: '#718b80', 床: '#a58b76', 餐桌: '#a67e5f', 书桌: '#a67e5f',
  衣柜: '#778b7e', 橱柜: '#778b7e', 岛台: '#987c62', 茶几: '#937d70', 书架: '#748774', 柜子: '#a08a6f', 门: '#b8a98f',
  马桶: '#9aa7b5', 空气净化器: '#9aa7b5', 电视机: '#5a6470',
  壁灯: '#d8b06a', 挂画: '#c0906a', 吊灯: '#d8b06a', 吸顶灯: '#d8b06a', 筒灯: '#d8b06a',
  空调: '#e8edf2', 热水器: '#e8edf2', 窗帘: '#9fb8c8', 传感器: '#c9d4dc', 开关: '#d8dee4', 感应器: '#c9d4dc', 风扇: '#8f9fbb', 灯带: '#ffd166',
}

// 3D 家具主题色（对齐原版 glass 风格：统一蓝灰，不是每件一个色）
export const FURNITURE_MAIN = '#8f9fbb'
export const FURNITURE_DETAIL = '#667897'
export const FURNITURE_ACCENT = '#eaf2ff'

export const WALL_THICK = 0.12

// 地板调色板（对齐原版 glass 风格冷色系，每个房间按序号取色）
export const FLOOR_PALETTE = ['#EAE8E5', '#EEECE9', '#E6E4E1', '#F0EEEC', '#EDEBE8']

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
export function robustFloorGeometry(points, THREE, thickness = 0) {
  // 有厚度：用 Shape 挤出成薄板（顶面 + 侧面 + 底面），顶面 UV 用 Shape 坐标 = 世界 XZ（和平面一致）
  if (thickness > 0.001) {
    const shape = new THREE.Shape()
    points.forEach((p, i) => {
      if (i === 0) shape.moveTo(p[0], p[1])
      else shape.lineTo(p[0], p[1])
    })
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
    // Shape 在 XY 平面、挤出 +Z；rotateX(90°) 让上表面（shape）法线朝 +Y、厚度向 -Y（向下），顶面 y=0
    geo.rotateX(Math.PI / 2)
    return geo
  }
  // 零厚度：平面三角剖分
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
  const uvs = []
  for (const f of faces) {
    for (const idx of f) {
      positions.push(points[idx][0], 0, points[idx][1])  // 直接水平：x, 0, z
      uvs.push(points[idx][0], points[idx][1])  // UV 用世界 XZ 坐标，1 米 = 1 个贴图重复（否则贴图显示不出来）
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.computeVertexNormals()
  return geo
}

// 吸附墙端点：距离 < tol 的端点聚类合并成质心（消除画墙时端点没对齐的错位）。
// 相邻房间的共享墙端点「几乎重合」但差几厘米，用这个把它们并成同一个点，地板/房间边界就精确重合了。
export function snapWallEndpoints(walls, tol = 0.08) {
  if (!walls || walls.length < 2) return walls
  const pts = []
  walls.forEach((w) => { pts.push(w.start); pts.push(w.end) })
  const n = pts.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < tol) union(i, j)
    }
  }
  const sum = new Map(), cnt = new Map()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!sum.has(r)) { sum.set(r, [0, 0]); cnt.set(r, 0) }
    const s = sum.get(r); s[0] += pts[i][0]; s[1] += pts[i][1]
    cnt.set(r, cnt.get(r) + 1)
  }
  const merged = new Map()
  for (const [r, s] of sum) merged.set(r, [s[0] / cnt.get(r), s[1] / cnt.get(r)])
  let idx = 0
  walls.forEach((w) => {
    w.start = [...merged.get(find(idx++))]
    w.end = [...merged.get(find(idx++))]
  })
  return walls
}

// 拉直斜墙：把「几乎竖直/水平」的墙精确拉直（x 或 y 对齐到平均），消除画墙/拖动端点的方向误差。
// 画墙时轴向吸附 5° 兜底，但拖动端点后可能斜几厘米（长墙 0.19° 就偏 2.4cm），画完/加载后拉直。
export function straightenWalls(walls) {
  if (!walls) return walls
  walls.forEach((w) => {
    const dx = w.end[0] - w.start[0]
    const dy = w.end[1] - w.start[1]
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
    if (Math.abs(dy) > Math.abs(dx) * 5) {
      // 竖直墙：x 对齐到平均
      const x = (w.start[0] + w.end[0]) / 2
      w.start[0] = x; w.end[0] = x
    } else if (Math.abs(dx) > Math.abs(dy) * 5) {
      // 水平墙：y 对齐到平均
      const y = (w.start[1] + w.end[1]) / 2
      w.start[1] = y; w.end[1] = y
    }
  })
  return walls
}

// 合并两个正交矩形（完美对齐才合并，用于正交户型的 union，保留凹处不打斜）
function mergeTwoRects(a, b, tol = 0.01) {
  const xeq = (v, w) => Math.abs(v - w) < tol
  const zeq = (v, w) => Math.abs(v - w) < tol
  if (xeq(a.minX, b.minX) && xeq(a.maxX, b.maxX)) {
    if (zeq(a.maxZ, b.minZ)) return { minX: a.minX, minZ: a.minZ, maxX: a.maxX, maxZ: b.maxZ }
    if (zeq(a.minZ, b.maxZ)) return { minX: a.minX, minZ: b.minZ, maxX: a.maxX, maxZ: a.maxZ }
  }
  if (zeq(a.minZ, b.minZ) && zeq(a.maxZ, b.maxZ)) {
    if (xeq(a.maxX, b.minX)) return { minX: a.minX, minZ: a.minZ, maxX: b.maxX, maxZ: a.maxZ }
    if (xeq(a.minX, b.maxX)) return { minX: b.minX, minZ: a.minZ, maxX: a.maxX, maxZ: a.maxZ }
  }
  return null
}

// 矩形并集：反复合并完美对齐的正交矩形，返回不相交的矩形集合（覆盖 union，保留凹处）
export function unionRectangles(rects) {
  let result = [...rects]
  let changed = true
  while (changed) {
    changed = false
    const out = []
    const used = new Set()
    for (let i = 0; i < result.length; i++) {
      if (used.has(i)) continue
      let r = result[i]
      for (let j = i + 1; j < result.length; j++) {
        if (used.has(j)) continue
        const m = mergeTwoRects(r, result[j])
        if (m) { r = m; used.add(j); changed = true }
      }
      out.push(r)
    }
    result = out
  }
  return result
}

// 整体地板（union + 顶点颜色）：顶面每个房间三角形涂各自颜色，侧面/底面用 union 矩形挤出。
// 消除房间边界（union 无内部侧面），保留每房间独立配色（顶点颜色），有实心厚度。
export function wholeFloorGeometryWithColors(rooms, THREE, thickness) {
  if (!rooms || !rooms.length) return null
  const defaultColor = new THREE.Color(FLOOR_PALETTE[0])
  const pos = [], col = [], uv = []
  // 1. 顶面：每个房间三角形 + 顶点颜色
  for (const room of rooms) {
    const pts = room.points || []
    if (pts.length < 3) continue
    const c = new THREE.Color(room.color || FLOOR_PALETTE[0])
    // 房间 bbox（snap 1cm），顶点对齐到 bbox 边 → 相邻房间共享边严格重合，顶面无缝隙（否则连接处露底面暖白细线）
    let bminX = Infinity, bmaxX = -Infinity, bminZ = Infinity, bmaxZ = -Infinity
    for (const p of pts) { bminX = Math.min(bminX, p[0]); bmaxX = Math.max(bmaxX, p[0]); bminZ = Math.min(bminZ, p[1]); bmaxZ = Math.max(bmaxZ, p[1]) }
    bminX = Math.round(bminX * 100) / 100; bmaxX = Math.round(bmaxX * 100) / 100; bminZ = Math.round(bminZ * 100) / 100; bmaxZ = Math.round(bmaxZ * 100) / 100
    const align = (p) => {
      let x = p[0], z = p[1]
      if (Math.abs(x - bminX) < 0.015) x = bminX
      else if (Math.abs(x - bmaxX) < 0.015) x = bmaxX
      if (Math.abs(z - bminZ) < 0.015) z = bminZ
      else if (Math.abs(z - bmaxZ) < 0.015) z = bmaxZ
      return [x, z]
    }
    const verts = pts.map((p) => new THREE.Vector2(p[0], p[1]))
    let faces = []
    try { faces = THREE.ShapeUtils.triangulateShape(verts, []) } catch (e) { faces = [] }
    if (!faces.length) for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1])
    for (const f of faces) for (const idx of f) {
      const [px, pz] = align(pts[idx])
      pos.push(px, 0, pz)
      col.push(c.r, c.g, c.b)
      uv.push(px, pz)
    }
  }
  // 2. union 矩形（正交并集）
  const rects = rooms.map((r) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    ;(r.points || []).forEach((p) => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]) })
    // snap 到 1cm，让相邻房间的 bbox 边对齐，否则合并后的侧面在连接处露暖白细线
    return { minX: Math.round(minX * 100) / 100, minZ: Math.round(minZ * 100) / 100, maxX: Math.round(maxX * 100) / 100, maxZ: Math.round(maxZ * 100) / 100 }
  })
  const union = unionRectangles(rects)
  const pushTri = (a, b, c) => {
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2])
      col.push(defaultColor.r, defaultColor.g, defaultColor.b)
      uv.push(p[0], p[2])
    }
  }
  // 3. 底面：每个 union 矩形三角剖分，y=-thickness
  for (const r of union) {
    pushTri([r.minX, -thickness, r.minZ], [r.maxX, -thickness, r.minZ], [r.maxX, -thickness, r.maxZ])
    pushTri([r.minX, -thickness, r.minZ], [r.maxX, -thickness, r.maxZ], [r.minX, -thickness, r.maxZ])
  }
  // 4. 侧面：只渲染外轮廓边（被一个矩形独享的边），内部共享边不渲染（避免内部侧面重叠）
  const edges = []
  for (const r of union) {
    const corners = [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]]
    for (let i = 0; i < 4; i++) {
      const p = corners[i], q = corners[(i + 1) % 4]
      const key = (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1])) ? `${p[0]},${p[1]}|${q[0]},${q[1]}` : `${q[0]},${q[1]}|${p[0]},${p[1]}`
      edges.push({ a: p, b: q, key })
    }
  }
  const ecnt = new Map()
  for (const e of edges) ecnt.set(e.key, (ecnt.get(e.key) || 0) + 1)
  for (const e of edges) {
    if (ecnt.get(e.key) !== 1) continue
    const [ax, az] = e.a, [bx, bz] = e.b
    pushTri([ax, 0, az], [bx, 0, bz], [bx, -thickness, bz])
    pushTri([ax, 0, az], [bx, -thickness, bz], [ax, -thickness, az])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
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

// 判断墙段 w 是否构成房间边 a-b 的一部分（共线 + 有交叠）。覆盖三种情况：
// ①单面墙=整条边；②拼接墙（墙是边的一段）；③共用墙（墙覆盖边并延伸到房间外）。
// 共线用「到直线的垂直距离」判断——不能用 pointToSeg（它 clamp 到线段端点，共用墙端点超出边会误判成不共线）。
export function wallOnEdge(w, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-10) return false
  const distToLine = (p) => Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.sqrt(len2)
  if (distToLine(w.start) >= 0.08 || distToLine(w.end) >= 0.08) return false
  const proj = (p) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  const lo = Math.min(proj(w.start), proj(w.end))
  const hi = Math.max(proj(w.start), proj(w.end))
  // 交叠长度（米）：墙投影区间和边 [0,1] 的重叠必须 > 5cm，排除端点处吸附误差产生的几毫米假交叠
  const overlap = Math.min(hi, 1) - Math.max(lo, 0)
  return overlap * Math.sqrt(len2) > 0.05
}

// 尝试合并两面共线且相连/重叠的墙，成功返回合并后的墙，否则 null。
// 这是从源头杜绝「一条边由多段墙拼成」的关键：画墙后调用，共线相连的墙段自动合成一面。
function mergeWallPair(a, b) {
  const da = [a.end[0] - a.start[0], a.end[1] - a.start[1]]
  const db = [b.end[0] - b.start[0], b.end[1] - b.start[1]]
  const la = Math.hypot(da[0], da[1])
  const lb = Math.hypot(db[0], db[1])
  if (la < 1e-6 || lb < 1e-6) return null
  // 共线：b 端点到 a 直线距离 < SNAP_TOL，且 a 端点到 b 直线距离 < SNAP_TOL（4 端点互相验证）
  const dlA = (p) => Math.abs(da[0] * (p[1] - a.start[1]) - da[1] * (p[0] - a.start[0])) / la
  const dlB = (p) => Math.abs(db[0] * (p[1] - b.start[1]) - db[1] * (p[0] - b.start[0])) / lb
  if (dlA(b.start) > SNAP_TOL || dlA(b.end) > SNAP_TOL) return null
  if (dlB(a.start) > SNAP_TOL || dlB(a.end) > SNAP_TOL) return null
  // 投影区间（沿 a 方向）相连（间隔 < SNAP_TOL）或重叠
  const proj = (p) => ((p[0] - a.start[0]) * da[0] + (p[1] - a.start[1]) * da[1]) / la
  let loA = proj(a.start), hiA = proj(a.end)
  if (loA > hiA) { const t = loA; loA = hiA; hiA = t }
  let loB = proj(b.start), hiB = proj(b.end)
  if (loB > hiB) { const t = loB; loB = hiB; hiB = t }
  if (loB - hiA > SNAP_TOL || loA - hiB > SNAP_TOL) return null
  // 合并：取投影最小/最大的两个端点
  const pts = [a.start, a.end, b.start, b.end].map((p) => [p, proj(p)])
  let minP = pts[0][0], maxP = pts[0][0], minT = pts[0][1], maxT = pts[0][1]
  for (const [p, t] of pts) {
    if (t < minT) { minT = t; minP = p }
    if (t > maxT) { maxT = t; maxP = p }
  }
  // 保留 a 的属性（id/color/height/thickness/opacity），端点换成合并后的范围
  return { ...a, start: [...minP], end: [...maxP] }
}

// 合并所有共线且相连/重叠的墙（反复直到无合并）。画墙完成（闭合）后调用。
export function mergeCollinearWalls(walls) {
  if (!walls || walls.length < 2) return walls
  let list = walls.slice()
  let changed = true
  while (changed) {
    changed = false
    const out = []
    const used = new Set()
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue
      let cur = list[i]
      for (let j = i + 1; j < list.length; j++) {
        if (used.has(j)) continue
        const m = mergeWallPair(cur, list[j])
        if (m) { cur = m; used.add(j); changed = true }
      }
      out.push(cur)
    }
    list = out
  }
  return list
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
      // distance from p to the line through its neighbors (scales with segment length)
      const hl = Math.hypot(h[0] - l[0], h[1] - l[1])
      const collinear = hl > 0 && Math.abs(cross) / hl <= COLLINEAR_EPS
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

// Vertex snapping tolerance (meters): covers the 2-4mm drag error but is far below wall
// thickness / real gaps (>10cm), so it never merges two genuinely separate walls.
// Exported so the 2D intersection-dot marker uses the exact same tolerance as room detection.
export const SNAP_TOL = 0.02
// Collinear cleanup tolerance (meters): snapping leaves ~1mm residuals on straight walls,
// so drop a loop vertex whose distance to the line through its neighbors is below this.
const COLLINEAR_EPS = 0.01

// Detect all closed rooms from wall segments (returns array of polygon vertices [x,z]).
// walls: [{ start:[x,z], end:[x,z] }]
//
// Rebuilt as a half-edge DCEL with tolerance snapping. The old exact-coordinate planar graph
// broke when dragged walls left endpoints 2-4mm off (real data has -8.98/-5.97/-5.1 non-integer
// values), so points that should coincide became two points a few mm apart -> broken topology ->
// missing rooms. A DCEL snaps near-coincident points into one vertex first, then traces faces
// with the right-hand rule, which is robust to that drag noise.
export function detectRooms(walls) {
  if (!walls || walls.length < 3) return []
  const segs = walls.map((w) => ({ a: [w.start[0], w.start[1]], b: [w.end[0], w.end[1]] }))

  // ---- Step 1: collect candidate vertices (endpoints + T-junction snaps + intersections) ----
  const raw = []
  for (const s of segs) raw.push(s.a, s.b)
  // T-junction snap: an endpoint that nearly touches another wall is projected onto it,
  // otherwise a T-connection breaks and the room on that side never closes.
  for (let i = 0; i < segs.length; i++) {
    for (const p of [segs[i].a, segs[i].b]) {
      let bestJ = -1, bestD = SNAP_TOL
      for (let j = 0; j < segs.length; j++) {
        if (j === i) continue
        const r = pointToSeg(p, segs[j].a, segs[j].b)
        if (r.dist < bestD) { bestD = r.dist; bestJ = j }
      }
      if (bestJ >= 0) {
        const g = segs[bestJ], r = pointToSeg(p, g.a, g.b)
        raw.push([g.a[0] + r.t * (g.b[0] - g.a[0]), g.a[1] + r.t * (g.b[1] - g.a[1])])
      }
    }
  }
  // pairwise intersections
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const ip = segmentIntersect(segs[i].a, segs[i].b, segs[j].a, segs[j].b)
      if (ip) raw.push(ip)
    }
  }

  // ---- Step 2: union-find cluster within SNAP_TOL; cluster centroid = final vertex ----
  const n = raw.length
  const parent = Array.from({ length: n }, (_, k) => k)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (_dist2(raw[i], raw[j]) < SNAP_TOL * SNAP_TOL) union(i, j)
    }
  }
  const rootVid = new Map()
  const vertOf = new Map()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!rootVid.has(r)) rootVid.set(r, rootVid.size)
    vertOf.set(i, rootVid.get(r))
  }
  const V = rootVid.size
  const sum = Array.from({ length: V }, () => [0, 0, 0])
  for (let i = 0; i < n; i++) {
    const v = vertOf.get(i)
    sum[v][0] += raw[i][0]; sum[v][1] += raw[i][1]; sum[v][2] += 1
  }
  const verts = sum.map(([sx, sy, c]) => [sx / c, sy / c])

  // ---- Step 3: split each wall into atomic half-edges at the vertices lying on it ----
  const dk = (u, v) => `${u}>${v}`
  const half = []
  const seen = new Set()
  const addEdge = (u, v) => {
    if (u === v) return
    const k1 = dk(u, v), k2 = dk(v, u)
    if (!seen.has(k1)) { seen.add(k1); half.push([u, v]) }
    if (!seen.has(k2)) { seen.add(k2); half.push([v, u]) }
  }
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const on = []
    for (let v = 0; v < V; v++) {
      const r = pointToSeg(verts[v], s.a, s.b)
      if (r.dist < SNAP_TOL) on.push({ v, t: r.t })
    }
    const uniq = [...new Map(on.map((o) => [o.v, o])).values()].sort((p, q) => p.t - q.t)
    for (let k = 0; k + 1 < uniq.length; k++) addEdge(uniq[k].v, uniq[k + 1].v)
  }

  // ---- Step 4: build per-vertex sorted outgoing edge lists (by angle) ----
  const out = new Map()
  for (const [u, v] of half) {
    if (!out.has(u)) out.set(u, [])
    out.get(u).push({ to: v, ang: Math.atan2(verts[v][1] - verts[u][1], verts[v][0] - verts[u][0]) })
  }
  for (const list of out.values()) list.sort((p, q) => p.ang - q.ang)

  // ---- Step 5: face traversal (right-hand rule) to extract closed loops ----
  const visited = new Set()
  const rooms = []
  for (const [u, v] of half) {
    const start = dk(u, v)
    if (visited.has(start)) continue
    const loop = []
    let cur = u, next = v, ok = true
    for (let step = 0; step <= half.length + 1; step++) {
      visited.add(dk(cur, next))
      loop.push(cur)
      const list = out.get(next)
      if (!list || !list.length) { ok = false; break }
      const gi = list.findIndex((e) => e.to === cur)
      if (gi < 0) { ok = false; break }
      // most-right turn: outgoing edge immediately counter-clockwise from the incoming one
      const nxt = list[(gi - 1 + list.length) % list.length]
      cur = next; next = nxt.to
      if (cur === u && next === v) break
    }
    if (ok && loop.length >= 3) {
      const pts = cleanLoop(loop.map((vi) => verts[vi]))
      if (pts.length >= 3 && _signedArea(pts) > 0.25) rooms.push(pts)
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
      color: (match && match.room.color) || FLOOR_PALETTE[0],
      texture: match ? match.room.texture : undefined,   // 地板壁纸
      thickness: match ? match.room.thickness : undefined,  // 地板厚度
      opacity: match ? match.room.opacity : undefined,   // 地板透明度
      locked: match ? !!match.room.locked : false,       // 尺寸锁定（缩放相邻房间时保持本房间长宽）
      lockedView: match ? match.room.lockedView : undefined,  // 锁定的视角 { pos:[x,y,z], target:[x,y,z] }
      soloWallColor: match ? match.room.soloWallColor : undefined,   // 房间独立墙色（房间单独视图用，undefined=跟随户型图）
      soloFloorColor: match ? match.room.soloFloorColor : undefined, // 房间独立地板色（房间单独视图用，undefined=跟随户型图）
      soloWallOpacity: match ? match.room.soloWallOpacity : undefined,   // 房间独立墙透明度（房间单独视图用，undefined=跟随户型图）
      soloFloorOpacity: match ? match.room.soloFloorOpacity : undefined, // 房间独立地板透明度（房间单独视图用，undefined=跟随户型图）
    }
  })
}

// 自动优化墙体：把「伸出墙」（一端悬空不接别的墙）缩回到最近交点，两端都悬空的孤立墙删除。
// 画墙完成/加载后调用，让户型干净，房间检测不再被伸出墙干扰。
export function autoTrimWalls(walls) {
  if (!walls || !walls.length) return walls
  const eps = 0.05
  const touches = (p, self) => walls.some((o) => {
    if (o === self) return false
    return pointToSeg(p, o.start, o.end).dist < eps
  })
  const out = []
  for (const w of walls) {
    const sTouch = touches(w.start, w)
    const eTouch = touches(w.end, w)
    if (sTouch && eTouch) { out.push(w); continue }   // 两端都接，正常墙
    if (!sTouch && !eTouch) continue                  // 两端都悬空，删除（孤立墙）
    // 一端悬空：缩回到离锚点最近的、与别的墙的交点
    const freeIsStart = !sTouch
    const anchor = freeIsStart ? w.end : w.start
    let best = null, bestD = Infinity
    for (const o of walls) {
      if (o === w) continue
      const ip = segmentIntersect(w.start, w.end, o.start, o.end)
      if (!ip) continue
      const d = Math.hypot(ip[0] - anchor[0], ip[1] - anchor[1])
      if (d < 0.05) continue   // 交点就是锚点本身，跳过
      if (d < bestD) { bestD = d; best = ip }
    }
    if (best) {
      if (freeIsStart) w.start = best
      else w.end = best
      out.push(w)
    }
    // 没有交点（完全伸出去），缩不回来，删除
  }
  return out
}


