// 极简外部 store（useSyncExternalStore），无依赖
import { useSyncExternalStore } from 'react'

let state = {
  project: { name: '我的家', version: 1, floors: [] },
  settings: {},
  currentFloor: 0,
  camTarget: [0, 0, 2],
  camDist: 10,        // 户型最大尺寸（取景用）
  camViewSignal: { type: null, n: 0 },  // 视图切换信号（top/front/custom），n 自增触发
  customViews: [],    // 自定义视图 [{ id, name, pos: [x,y,z], target: [x,y,z] }]
  recenterKey: 0,
  planRecenterKey: 0, // SVG 2D 编辑器「居中」信号，变化时重置 zoom/pan
  planZoomDelta: 0,   // SVG 2D 编辑器「放大/缩小」信号，+1 放大 / -1 缩小
  planImage: '',      // 2D 编辑器参考底图（data URL，空=无底图）
  planImageOpacity: 0.4,  // 底图透明度
  planImageScale: 1,  // 底图缩放倍数（1=铺满）
  calibrating: false, // 标定模式（在底图上选已知长度）
  calibratePts: [],   // 标定选的点 [[x,y], ...]
  // 工具默认参数（点击左侧工具时右侧面板修改，放置时用）
  wallH: 2.8,          // 墙默认高度
  wallThick: 0.12,     // 墙默认厚度
  wallColor: '#d5e0f1', // 墙默认颜色
  wallOpacity: 100,    // 墙默认不透明度（%）
  doorStyle: 'swing',  // 门默认类型
  doorColor: '木色',   // 门默认颜色
  doorSwing: 'inward', // 门默认开向
  windowStyle: 'standard', // 窗默认类型
  // 视图
  quality: 'high',            // eco | smooth | balanced | high
  shadows: true,
  bloom: true,                // 泛光（发光设备/灯带的光晕）
  autoRotate: false,
  rotateDir: 1,              // 自动旋转方向：1=顺时针，-1=逆时针
  rotateSpeed: 1,            // 自动旋转速度倍率（0.5~3）
  night: false,
  mode: '全屋',               // 全屋 | 照明 | 遮阳 | 环境 | 安防
  view2d: false,              // 2D/3D
  snap: true,
  snapStep: 0.5,            // 吸附精度（米），0.1/0.25/0.5/1
  showLabels: true,
  showFurnitureLabels: true,   // 显示家具名字标签
  showWalls: true,             // 显示墙体（关=去除墙壁只看户型内部）
  showOpenings: true,          // 显示门窗（关=去除门窗）
  showCeiling: true,           // 显示屋顶（关=去除房间顶面）
  roofOpacity: 80,             // 屋顶不透明度（%）
  roofColor: '',               // 屋顶颜色（空=用房间颜色）
  showDimensions: false,       // 显示尺寸标注（墙长度）
  showIntersections: true,     // 显示墙体交点红点（2D 编辑器，判断墙是否闭合/连接）
  immersive: false,           // 纯净沉浸模式（隐藏所有 UI，双击退出）
  deviceListOpen: false,      // 设备列表弹窗（查看已绑定设备）
  // 编辑状态
  editing: false,             // 是否在编辑器
  editingScreen: false,       // 电视/屏幕画面「编辑画面」模式（打开才显示缩放手柄/移动手柄/参数编辑）
  smoothFocus: false,         // 平滑聚焦：开启后点模型相机从当前视角平滑移动过去（不是闪现）
  hoverTip: false,            // 悬停提示：鼠标移到模型上显示名称提示
  clickToggleState: true,     // 点击切换状态：开时点击有状态的模型（窗帘/柜门）直接切换，无需绑定实体
  selectEffect: 'glow',       // 选中模型时的指示效果：glow 底部光环 / outline 描边 / pulse 顶部脉冲球 / column 光柱 / ring 顶部环 / none 无
  selectOutline: { width: 2, speed: 3.5, mode: 'frame', size: 0.18 },  // 描边配置：宽度/呼吸速度/位置(frame外框 halo底部 top顶部)/大小
  showStatusPulse: true,      // 显示设备状态小球（绑定实体的模型顶上：灰=关 黄=开）
  fpsMode: false,             // 第一人称浏览模式：WASD 移动 + 鼠标拖动转向
  fpsKeys: {},                // 第一人称虚拟方向键（手机/平板屏幕按键，w/a/s/d）
  panelOpacity: 0.96,         // 模型详情弹窗背景透明度（0.3~1）
  panelColor: '#0d1526',      // 模型详情弹窗背景颜色
  hoveredItem: null,          // 悬停提示内容 {name, x, y}（鼠标屏幕坐标）
  tool: 'select',             // select|pan|wall|door|window|furniture|device|texture|delete
  furnitureType: '沙发',
  furnitureScale: 1,          // 家具尺寸缩放倍数
  selected: null,             // {type:'room'|'wall'|'furniture'|'device'|'opening', ref, floorIdx}
  wallSel: [],                // 多选墙（最多 2 条）的 id 列表，用于共线/垂直/水平约束
  multiSelect: false,         // 多选模式开关（左侧快捷栏按钮）
  pickItem: null,             // 3D 移动工具「拾起待放置」的对象 {type, id}
  roomDraft: null,            // 画房间/墙的草稿
  pendingEntity: null,        // 待绑定实体
  bindOpen: false,            // 绑定抽屉
  bindCat: '全部',            // 绑定抽屉的分类筛选
  // 数据
  haStates: {},               // entity_id -> state
  haEntities: [],             // 全量实体
  haConnected: false,
  modelCatalog: [],           // 网上下载的家具模型目录
  saved: true,
  toast: '',
  bgImage: '',           // 自定义背景图 URL
  bgMode: 'color',       // 背景效果: color纯色 | image背景图 | gradient渐变 | night夜景
  bgColor: '#5278ae',    // 背景纯色（六边形色盘选的颜色）
  bgGradient1: '#253962', // 渐变色 1（顶）
  bgGradient2: '#46618d', // 渐变色 2（底）
  editorBgImage: '',     // 3D 编辑视图独立背景图（和主界面背景互不影响）
  editorBgMode: 'color', // 3D 编辑视图背景模式
  settingsOpen: false,   // 设置面板
  sceneOpen: false,      // 场景同步面板
  notifOpen: false,      // 通知中心面板
  roomNavOpen: false,    // 房间导航面板（左侧：全部 + 各房间，点击跳转居中）
  focusRoomId: null,     // 聚焦的房间 id（null=显示全部；非 null=只显示该房间，其他隐藏）
  roomView: null,        // 要应用的房间锁定视角 { pos:[x,y,z], target:[x,y,z] }（配合 camViewSignal type='roomview'）
  roomEditId: null,      // 正在编辑的房间 id（房间导航栏点「编辑」后进入 2D 编辑选中该房间）
  mihomeMode: true,      // 米家模式（渲染层覆盖成米家配色，存 settings 持久化，默认开）
  glassMode: true,       // 原版玻璃墙（meshPhysicalMaterial + clearcoat 清漆层，对齐 JMGLink 原版，默认开）
  sunAuto: true,         // 自动跟随 sun.sun 切日夜（手动切日夜则关掉）
  sunElevation: null,    // 太阳高度角（度），用于日照/天空
  sunLight: true,        // 太阳光（方向光）开关
  roomSel: [],           // 多选房间（全选地板/屋顶）的 id 列表
  wallIssues: null,      // 检测出的问题墙 { zeroLen, dupIds, overlapIds, danglingIds, shortWalls }
  detectOpts: {          // 检测项开关 + 短墙阈值（米）
    zeroLen: true,       // 零长度（<1cm）
    shortWall: true,     // 短墙（< shortLen）
    dup: true,           // 重复
    overlap: true,       // 重叠
    dangling: true,      // 伸出（一端接、一端不接）
    isolated: true,      // 孤立（两端都不接）
    shortLen: 0.05,      // 短墙阈值（米），低于此长度判定为短墙
  },
  showToolbar: true,     // 显示底部工具栏（默认选项里可设默认）
  haEntitiesFp: '',      // 全量实体指纹（entity_id 排序拼接），变了才更新 haEntities，避免闪屏
  showFps: true,         // 显示帧率/卡顿（主界面左上角，默认选项里可关）
}

let toastTimer = null
export function toast(msg, ms = 2200) {
  state = { ...state, toast: msg }
  listeners.forEach((l) => l(state))
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    state = { ...state, toast: '' }
    listeners.forEach((l) => l(state))
  }, ms)
}

const listeners = new Set()
let undoStack = []  // 撤销历史（project 深拷贝快照）
let redoStack = []  // 重做历史
let lastClean = JSON.parse(JSON.stringify(state.project))  // 上一次已提交的 project 深拷贝（就地修改时快照的基准）
export function getState() { return state }
export function setState(partial) {
  const next = typeof partial === 'function' ? partial(state) : partial
  // 修改 project 时保存快照（撤销用），限 50 步；新改动清空重做历史
  // __noUndo：连续改动（如画墙的每个点）不单独占一步撤销，只在第一步存一次快照
  if (next.project && next.project !== state.project) {
    if (!next.__noUndo) {
      undoStack.push(lastClean)
      if (undoStack.length > 50) undoStack.shift()
      redoStack = []
    }
    lastClean = JSON.parse(JSON.stringify(next.project))
    delete next.__noUndo
    // 浅拷贝每层 floor：patchRoom/patchWall 等是「原地 Object.assign 墙/房间对象」再 setState，
    // project 只是浅拷贝、floor 引用不变的话，useSyncExternalStore 用 Object.is 比较 selector 返回的
    // floor 对象发现没变 → 组件不重渲染 → 「改了颜色/透明度数据保存了但界面没刷新」。
    // 这里让 floor 引用也变一次，触发依赖 floor 的组件重渲染（floor 内部数组/对象还是原引用，原地改的值能读到）。
    next.project = { ...next.project, floors: (next.project.floors || []).map((f) => ({ ...f })) }
  }
  state = { ...state, ...next }
  listeners.forEach((l) => l(state))
}
export function undo() {
  const prev = undoStack.pop()
  if (!prev) { toast('已到撤销上限'); return }
  redoStack.push(lastClean)
  lastClean = prev
  state = { ...state, project: prev, saved: false, selected: null, wallSel: [] }
  listeners.forEach((l) => l(state))
  toast(`已撤销（还可撤销 ${undoStack.length} 步）`)
}
export function redo() {
  const next = redoStack.pop()
  if (!next) { toast('已到恢复上限'); return }
  undoStack.push(lastClean)
  lastClean = next
  state = { ...state, project: next, saved: false, selected: null, wallSel: [] }
  listeners.forEach((l) => l(state))
  toast(`已恢复（还可恢复 ${redoStack.length} 步）`)
}
// 加载项目（启动/恢复），不保存撤销快照
export function loadProject(p) {
  state = { ...state, project: p }
  lastClean = JSON.parse(JSON.stringify(p))
  undoStack = []
  redoStack = []
  listeners.forEach((l) => l(state))
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }

export function useStore(selector) {
  return useSyncExternalStore(subscribe, () => selector(state))
}

// 工具函数
export const uid = () => Math.random().toString(36).slice(2, 10)
export const snap = (v, g = 0.1) => Math.round(v / g) * g
export function currentFloor(s = state) {
  const f = s.project.floors[s.currentFloor]
  if (!f) return null
  return f
}
