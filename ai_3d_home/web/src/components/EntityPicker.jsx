import { useState } from 'react'
import { useStore } from '../store'
import { DOMAIN_ICON } from '../api'
import { inferDeviceModel } from '../catalog'

const CATS = [
  { id: '全部', match: () => true },
  { id: '灯光', match: (d) => d === 'light' },
  { id: '开关', match: (d) => d === 'switch' },
  { id: '窗帘', match: (d) => d === 'cover' },
  { id: '空调', match: (d) => d === 'climate' },
  { id: '传感器', match: (d) => d === 'sensor' },
  { id: '感应器', match: (d) => d === 'binary_sensor' },
  { id: '摄像机', match: (d) => d === 'camera' },
  { id: '风扇', match: (d) => d === 'fan' },
  { id: '安防', match: (d) => d === 'lock' || d === 'alarm_control_panel' },
]

// 内联实体选择器：在设备属性面板里直接选 HA 实体绑定（onPick 收到 { entity_id, name, modelId }）
export default function EntityPicker({ onPick, onClose }) {
  const haEntities = useStore((s) => s.haEntities)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('全部')

  const filtered = haEntities.filter((e) => {
    const domain = e.entity_id.split('.')[0]
    const c = CATS.find((x) => x.id === cat)
    if (c && !c.match(domain)) return false
    if (!search) return true
    const name = e.attributes?.friendly_name || ''
    const q = search.toLowerCase()
    return e.entity_id.toLowerCase().includes(q) || name.toLowerCase().includes(q)
  }).slice(0, 150)

  return (
    <div className="bind-drawer entity-picker">
      <div className="bd-header">
        <span>绑定设备</span>
        <button onClick={onClose}>✕</button>
      </div>
      <input className="bd-search" placeholder="搜索 实体ID / 名称..." value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="bd-cats">
        {CATS.map((c) => (
          <button key={c.id} className={`bd-cat ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>{c.id}</button>
        ))}
      </div>
      <div className="bd-list">
        {filtered.map((e) => {
          const name = e.attributes?.friendly_name || e.entity_id
          return (
            <div key={e.entity_id} className="bd-item" onClick={() => onPick({ entity_id: e.entity_id, name, modelId: inferDeviceModel(e.entity_id, name) })}>
              <span>{DOMAIN_ICON[e.entity_id.split('.')[0]] || '🔹'}</span>
              <span className="ename">{e.attributes?.friendly_name || e.entity_id.split('.').pop()}</span>
              <span className="eid">{e.entity_id}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
