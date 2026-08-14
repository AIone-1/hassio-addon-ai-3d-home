// 网上下载的家具模型目录（从 public/models/manifest.json 加载）
// 每个模型：{ type: 唯一标识, label: 中文分类, glb, thumb, w, d, h }

// 各分类的默认占地尺寸（长×宽×高，单位米），GLB 模型按高度自动缩放
const CATEGORY_DIMS = {
  沙发: [2.2, 0.9, 0.68], 椅子: [0.5, 0.5, 0.85], 单人沙发: [1.0, 0.9, 0.8],
  床: [1.8, 2.0, 0.5], 餐桌: [1.4, 0.8, 0.75], 书桌: [1.2, 0.6, 0.75],
  衣柜: [1.4, 0.6, 2.0], 柜子: [1.0, 0.5, 1.5], 书架: [1.1, 0.32, 1.8],
  茶几: [1.0, 0.55, 0.45], 落地灯: [0.4, 0.4, 1.5], 台灯: [0.3, 0.3, 0.5],
  绿植: [0.5, 0.5, 1.0], 电视: [1.4, 0.3, 0.85], 马桶: [0.4, 0.68, 0.75],
  浴缸: [1.7, 0.75, 0.6], 洗手池: [0.6, 0.5, 0.85], 冰箱: [0.7, 0.7, 1.8],
  洗衣机: [0.6, 0.6, 0.85], 镜子: [0.8, 0.05, 1.0], 床头柜: [0.5, 0.4, 0.55],
  圆凳: [0.4, 0.4, 0.45], 边桌: [0.5, 0.5, 0.55], 梳妆台: [1.2, 0.45, 0.75],
  脚凳: [0.5, 0.5, 0.4], 电视柜: [1.6, 0.4, 0.5], 婴儿床: [1.3, 0.7, 0.9],
  衣帽架: [0.5, 0.5, 1.8], 鞋柜: [1.0, 0.35, 1.0], 屏风: [1.5, 0.05, 1.8],
  吊灯: [0.5, 0.5, 0.6], 壁灯: [0.25, 0.15, 0.3], 花瓶: [0.3, 0.3, 0.5],
  相框: [0.6, 0.05, 0.8], 地毯: [2.0, 3.0, 0.02], 吧台凳: [0.45, 0.45, 0.75],
  钢琴: [1.5, 0.6, 1.2], 微波炉: [0.5, 0.4, 0.3], 咖啡机: [0.3, 0.3, 0.4],
  水壶: [0.25, 0.25, 0.3], 垃圾桶: [0.3, 0.3, 0.4], 音箱: [0.3, 0.3, 0.6],
  打印机: [0.45, 0.4, 0.3], 电脑椅: [0.6, 0.6, 1.1], 文件柜: [0.5, 0.6, 1.3],
  壁炉: [1.2, 0.4, 1.0], 斗柜: [1.2, 0.45, 0.8], 盆栽: [0.4, 0.4, 0.6],
  书本: [0.3, 0.2, 0.25], 蜡烛: [0.15, 0.15, 0.2], 时钟: [0.4, 0.1, 0.5],
  长凳: [1.2, 0.4, 0.45],
  // 厨房
  厨房柜: [1.0, 0.6, 0.9], 烤箱: [0.6, 0.6, 0.6], 油烟机: [0.9, 0.5, 0.3],
  水槽: [0.8, 0.5, 0.2], 灶台: [0.7, 0.5, 0.15], 烤面包机: [0.3, 0.2, 0.25],
  // 电脑办公
  电脑: [0.5, 0.5, 0.5], 显示器: [0.6, 0.2, 0.45], 笔记本: [0.35, 0.25, 0.03],
  键盘: [0.45, 0.15, 0.03], 鼠标: [0.12, 0.06, 0.04],
  // 监控安防
  监控: [0.15, 0.15, 0.2], 烟感器: [0.12, 0.12, 0.05], 门铃: [0.15, 0.08, 0.2],
  // 其他
  路由器: [0.25, 0.15, 0.3], 服务器: [0.6, 0.6, 0.5], 无人机: [0.3, 0.3, 0.12],
  耳机: [0.18, 0.18, 0.2], 榨汁机: [0.2, 0.2, 0.35], 空气炸锅: [0.35, 0.3, 0.3],
  电饭煲: [0.3, 0.3, 0.25],
  // 追加：热水器 / 空调 / 智能音箱
  热水器: [0.4, 0.4, 0.7], 空调: [0.9, 0.2, 0.3], 智能音箱: [0.15, 0.15, 0.25],
  门: [0.9, 0.05, 2.0], 窗: [1.2, 0.05, 1.2],
}

// 模型文件基础路径（相对页面，HA ingress 下也正确）
export function modelBase() {
  let p = window.location.pathname
  if (p.endsWith('index.html')) p = p.slice(0, -'index.html'.length)
  if (!p.endsWith('/')) p += '/'
  return p
}

let catalog = []

export async function loadCatalog() {
  try {
    const r = await fetch(modelBase() + 'models/manifest.json')
    const list = await r.json()
    catalog = (list || []).map((m) => {
      const [w, d, h] = CATEGORY_DIMS[m.type] || [0.6, 0.6, 0.7]
      return {
        type: m.name,           // 唯一标识（文件名）
        label: m.type,          // 中文分类
        glb: m.glb,
        thumb: m.thumb,
        w, d, h,
      }
    })
  } catch (e) {
    catalog = []
  }
  return catalog
}

export function getCatalog() { return catalog }
export function getCatalogItem(type) { return catalog.find((m) => m.type === type) }

// 根据实体域/名推断设备默认模型（返回 DEVICE_MODELS 的 id，对齐 JMGLink 原版 no 映射 + 名字细分）
export function inferDeviceModel(entityId, name = '') {
  const domain = (entityId || '').split('.')[0]
  const s = `${name} ${entityId}`.toLowerCase()
  const defaultByDomain = {
    light: 'light.ceiling', switch: 'switch.wall', cover: 'cover.curtain',
    climate: 'climate.wall_ac', sensor: 'sensor.wall', binary_sensor: 'binary_sensor.wall',
    camera: 'camera.wall', fan: 'fan.ceiling', lock: 'lock.door',
    media_player: 'media_player.tv', vacuum: 'vacuum.robot', alarm_control_panel: 'alarm.panel',
  }
  const dflt = defaultByDomain[domain]
  if (domain === 'light' || domain === 'switch') {
    if (/(吊灯|chandelier|pendant)/.test(s)) return 'light.chandelier'
    if (/(落地灯|floor ?lamp)/.test(s)) return 'light.floor_lamp'
    if (/(筒灯|射灯|downlight|spotlight)/.test(s)) return 'light.downlight'
    if (/(灯带|strip|led ?strip)/.test(s)) return 'light.strip'
    return dflt || 'light.ceiling'
  }
  if (domain === 'fan') {
    if (/(塔扇|tower)/.test(s)) return 'fan.tower'
    if (/(落地|floor|stand|pedestal|circulator)/.test(s)) return 'fan.floor'
    return 'fan.ceiling'
  }
  if (domain === 'cover') {
    if (/(百叶|卷帘|blind|shutter)/.test(s)) return 'cover.blind'
    return 'cover.curtain'
  }
  if (domain === 'climate') {
    if (/(中央|central)/.test(s)) return 'climate.central_ac'
    if (/(柜|立式|floor|tower)/.test(s)) return 'climate.floor_ac'
    if (/(温控|面板|thermostat)/.test(s)) return 'climate.thermostat'
    return 'climate.wall_ac'
  }
  if (domain === 'camera') {
    if (/(球机|云台|dome|ptz)/.test(s)) return 'camera.dome'
    if (/(枪机|bullet)/.test(s)) return 'camera.bullet'
    if (/(门铃|doorbell)/.test(s)) return 'camera.doorbell'
    return 'camera.wall'
  }
  if (domain === 'binary_sensor') {
    if (/(门|窗|door|window)/.test(s)) return 'binary_sensor.door'
    if (/(人|motion|pir|move)/.test(s)) return 'binary_sensor.motion'
    if (/(存在|presence|mmwave)/.test(s)) return 'binary_sensor.presence'
    if (/(烟|气|smoke|gas)/.test(s)) return 'binary_sensor.smoke'
    if (/(水|leak|water|flood)/.test(s)) return 'binary_sensor.water'
    return 'binary_sensor.wall'
  }
  if (domain === 'sensor') {
    if (/(温度|temperature)/.test(s)) return 'sensor.temperature'
    if (/(湿度|humidity)/.test(s)) return 'sensor.humidity'
    if (/(光照|照度|illuminance)/.test(s)) return 'sensor.light_level'
    if (/(co2|二氧化碳)/.test(s)) return 'sensor.co2'
    if (/(pm2\.5|pm25|颗粒)/.test(s)) return 'sensor.pm25'
    if (/(空气质量|air ?quality)/.test(s)) return 'sensor.air_quality'
    if (/(电量|功率|power|energy|electric)/.test(s)) return 'sensor.power'
    return 'sensor.wall'
  }
  if (domain === 'media_player') {
    if (/(音箱|音响|speaker|sound|sonos|homepod)/.test(s)) return 'media_player.speaker'
    return 'media_player.tv'
  }
  return dflt || 'custom.point'
}
export function glbUrl(name) { return modelBase() + 'models/' + name }
export function thumbUrl(name) { return modelBase() + 'models/thumbs/' + name }
