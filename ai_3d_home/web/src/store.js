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
  showDimensions: false,       // 显示尺寸标注（墙长度）
  immersive: false,           // 纯净沉浸模式（隐藏所有 UI，双击退出）
  deviceListOpen: false,      // 设备列表弹窗（查看已绑定设备）
  // 编辑状态
  editing: false,             // 是否在编辑器
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
  editorBgImage: '',     // 3D 编辑视图独立背景图（和主界面背景互不影响）
  editorBgMode: 'color', // 3D 编辑视图背景模式
  settingsOpen: false,   // 设置面板
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
  if (next.project && next.project !== state.project) {
    undoStack.push(lastClean)
    if (undoStack.length > 50) undoStack.shift()
    redoStack = []
    lastClean = JSON.parse(JSON.stringify(next.project))
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
