// 后端 API 封装
async function req(path, opts = {}) {
  const r = await fetch(path, {
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
