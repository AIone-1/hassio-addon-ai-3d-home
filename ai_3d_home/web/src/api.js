// 后端 API 封装
// ⚠️ HA ingress 下页面路径是 /api/hassio_ingress/<token>/，API 必须用相对路径拼
// 否则 fetch('/api/...') 会打到 HA 根路径 404
function apiBase() {
  let p = location.pathname
  if (p.endsWith('index.html')) p = p.slice(0, -'index.html'.length)
  if (!p.endsWith('/')) p += '/'
  return p
}
const BASE = apiBase()
export { BASE }

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  return r.json()
}

export const api = {
  health: () => req('/api/health'),
  project: () => req('/api/project'),
  saveProject: (p) => req('/api/project', { method: 'POST', body: p }),
  settings: () => req('/api/settings'),
  saveSettings: (s) => req('/api/settings', { method: 'POST', body: s }),
  entities: () => req('/api/ha/entities'),
  states: () => req('/api/ha/states'),
  service: (domain, service, entity_id) =>
    req('/api/ha/service', { method: 'POST', body: { domain, service, entity_id } }),
}

// 实体友好名 / 图标
export const DOMAIN_ICON = {
  light: '💡', switch: '🔌', sensor: '🌡️', binary_sensor: '🔘', climate: '❄️',
  cover: '🪟', fan: '🌬️', media_player: '📺', humidifier: '💨', vacuum: '🤖',
  lock: '🔒', camera: '📹', button: '🔘', number: '#', select: '☰',
}
export const TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'cover', 'media_player', 'climate', 'humidifier', 'vacuum', 'lock'])

export function friendlyName(eid, entities) {
  const e = (entities || []).find((x) => x.entity_id === eid)
  if (e && e.attributes && e.attributes.friendly_name) return e.attributes.friendly_name
  return eid.split('.').pop().replace(/_/g, ' ')
}
