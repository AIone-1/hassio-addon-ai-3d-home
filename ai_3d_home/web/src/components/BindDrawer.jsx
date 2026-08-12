import { useState } from 'react'
import { useStore, setState } from '../store'
import { DOMAIN_ICON } from '../api'

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

export default function BindDrawer() {
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

  const pick = (e) => {
    setState({
      pendingEntity: { entity_id: e.entity_id, name: e.attributes?.friendly_name || e.entity_id },
      bindOpen: false,
      tool: 'device',
    })
  }

  return (
    <div className="bind-drawer">
      <div className="bd-header">
        <span>绑定 HA 实体</span>
        <button onClick={() => setState({ bindOpen: false })}>✕</button>
      </div>
      <input className="bd-search" placeholder="搜索 实体ID / 名称..." value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="bd-cats">
        {CATS.map((c) => (
          <button key={c.id} className={`bd-cat ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>{c.id}</button>
        ))}
      </div>
      <div className="bd-list">
        {filtered.map((e) => (
          <div key={e.entity_id} className="bd-item" onClick={() => pick(e)}>
            <span>{DOMAIN_ICON[e.entity_id.split('.')[0]] || '🔹'}</span>
            <span className="ename">{e.attributes?.friendly_name || e.entity_id.split('.').pop()}</span>
            <span className="estate">{e.state}</span>
            <span className="eid">{e.entity_id}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
