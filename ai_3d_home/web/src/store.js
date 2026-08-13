// 极简外部 store（useSyncExternalStore），无依赖
import { useSyncExternalStore } from 'react'

let state = {
  project: { version: 1, floors: [] },
  settings: {},
  currentFloor: 0,
  camTarget: [0, 0, 2],
  camDist: 10,        // 户型最大尺寸（取景用）
  recenterKey: 0,
  planRecenterKey: 0, // SVG 2D 编辑器「居中」信号，变化时重置 zoom/pan
  planZoomDelta: 0,   // SVG 2D 编辑器「放大/缩小」信号，+1 放大 / -1 缩小
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
  showLabels: true,
  // 编辑状态
  editing: false,             // 是否在编辑器
  tool: 'select',             // select|pan|wall|door|window|furniture|device|texture|delete
  furnitureType: '沙发',
  furnitureScale: 1,          // 家具尺寸缩放倍数
  selected: null,             // {type:'room'|'wall'|'furniture'|'device'|'opening', ref, floorIdx}
  roomDraft: null,            // 画房间/墙的草稿
  pendingEntity: null,        // 待绑定实体
  bindOpen: false,            // 绑定抽屉
  // 数据
  haStates: {},               // entity_id -> state
  haEntities: [],             // 全量实体
  haConnected: false,
  modelCatalog: [],           // 网上下载的家具模型目录
  saved: true,
  toast: '',
  bgImage: '',           // 自定义背景图 URL
  bgMode: 'color',       // 背景效果: color纯色 | image背景图 | gradient渐变 | night夜景
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
export function getState() { return state }
export function setState(partial) {
  const next = typeof partial === 'function' ? partial(state) : partial
  state = { ...state, ...next }
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
