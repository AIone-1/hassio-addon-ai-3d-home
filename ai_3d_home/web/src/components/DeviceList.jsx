// 设备列表弹窗：查看已绑定的 HA 设备，点「切换」控制开关
import { useStore, setState } from '../store'
import { api } from '../api'

const DOMAIN_ICON = {
  light: '💡', switch: '🔌', cover: '🪟', climate: '❄️', sensor: '📊',
  binary_sensor: '🚨', camera: '📷', fan: '🌀', media_player: '📺', lock: '🔒',
  vacuum: '🧹', alarm_control_panel: '🛡️',
}
const TOGGLEABLE = ['light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'lock', 'vacuum']

export default function DeviceList() {
  const project = useStore((s) => s.project)
  const haStates = useStore((s) => s.haStates)

  const devices = (project.floors || []).flatMap((f) =>
    (f.devices || []).map((d) => ({ ...d, floorName: f.name })))

  const toggle = async (dev) => {
    const domain = dev.entity_id.split('.')[0]
    await api.service(domain, 'toggle', dev.entity_id)
    setTimeout(async () => {
      try { setState({ haStates: await api.states() }) } catch (e) {}
    }, 800)
  }

  return (
    <div className="modal-mask" onClick={() => setState({ deviceListOpen: false })}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="dname">已绑定设备{devices.length ? `（${devices.length}）` : ''}</div>
        {devices.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '10px 0' }}>
            还没有绑定设备。进「编辑」模式，点工具栏「绑定设备」，选一个 HA 实体放到户型里。
          </p>
        ) : (
          <div style={{ maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px', margin: '10px 0' }}>
            {devices.map((dev) => {
              const st = haStates[dev.entity_id]
              const state = st ? st.state : 'unknown'
              const isOn = state === 'on'
              const domain = dev.entity_id.split('.')[0]
              const toggleable = TOGGLEABLE.includes(domain)
              return (
                <div key={dev.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px', borderRadius: '8px', background: 'var(--panel2)' }}>
                  <span>{DOMAIN_ICON[domain] || '🔹'}</span>
                  <span style={{ flex: 1, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dev.name || dev.entity_id}</span>
                  <span style={{ fontSize: '11px', color: isOn ? 'var(--accent2)' : 'var(--muted)' }}>{state}</span>
                  {toggleable && (
                    <button style={{ padding: '3px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--accent)', color: '#081018', fontSize: '11px', cursor: 'pointer' }} onClick={() => toggle(dev)}>切换</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <button className="close-btn" onClick={() => setState({ deviceListOpen: false })}>关闭</button>
      </div>
    </div>
  )
}
