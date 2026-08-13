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
export function glbUrl(name) { return modelBase() + 'models/' + name }
export function thumbUrl(name) { return modelBase() + 'models/thumbs/' + name }
