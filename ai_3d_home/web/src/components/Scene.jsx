import { useMemo, useRef, useState, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useStore, setState } from '../store'
import { FURNITURE_LIB, FURNITURE_MAIN, FURNITURE_DETAIL, FURNITURE_ACCENT, WALL_THICK, DOOR_COLORS, robustFloorGeometry } from '../three/geometry'
import { getCatalogItem } from '../catalog'

// 对齐原版主题（glass 视觉风格）：墙=半透明毛玻璃，地板=冷色调色板
const THEME = {
  day: {
    wallColor: '#d5e0f1',
    wallOpacity: 0.197,  // 原版 wallOpacity 0.24 × 0.82
    floorPalette: ['#7789ad', '#8294b7', '#8a9bbd', '#7285aa', '#7e91b5'],
  },
  night: {
    wallColor: '#d0dcee',
    wallOpacity: 0.197,
    floorPalette: ['#7587aa', '#8092b5', '#8799bb', '#7184a8', '#7d90b3'],
  },
}


// 加粗画图网格（用细长方体做线，比 gridHelper 的 1px 清晰得多）
function DrawingGrid({ size = 20, cell = 1, level, night }) {
  const n = Math.round(size / cell)
  const half = size / 2
  const lines = []
  const mainColor = night ? '#6a7a9a' : '#4f7fae'
  const subColor = night ? '#3a4a6a' : '#a8c4e0'
  for (let i = 0; i <= n; i++) {
    const p = -half + i * cell
    const isMajor = i % 5 === 0
    const t = isMajor ? 0.05 : 0.025
    const c = isMajor ? mainColor : subColor
    // X 方向（横线）
    lines.push(
      <mesh key={`h${i}`} position={[0, level + 0.01, p]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size, t]} />
        <meshBasicMaterial color={c} transparent opacity={isMajor ? 0.9 : 0.6} side={THREE.DoubleSide} />
      </mesh>,
      <mesh key={`v${i}`} position={[p, level + 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[t, size]} />
        <meshBasicMaterial color={c} transparent opacity={isMajor ? 0.9 : 0.6} side={THREE.DoubleSide} />
      </mesh>,
    )
  }
  return <group>{lines}</group>
}

// 颜色混合（对齐原版 _ 函数）
function mixColor(a, b, t) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString() }

// 模型文件基础路径（相对页面，HA ingress 下也正确）
const MODEL_BASE = (() => {
  let p = window.location.pathname
  if (p.endsWith('index.html')) p = p.slice(0, -'index.html'.length)
  if (!p.endsWith('/')) p += '/'
  return p
})()

// 加载网上 GLB 模型：等比缩放放进目标 w/d/h 盒子（不拉伸），横竖方向对齐，水平居中、底部贴地、开阴影
export function GltfModel({ name, w, d, h }) {
  const url = MODEL_BASE + 'models/' + name
  const [scene, setScene] = useState(null)

  useEffect(() => {
    let alive = true
    const loader = new GLTFLoader()
    loader.load(url, (gltf) => {
      if (!alive) return
      const s = gltf.scene.clone(true)
      const b0 = new THREE.Box3().setFromObject(s)
      const sz0 = b0.getSize(new THREE.Vector3())
      // 方向对齐：模型竖着（深度>宽度）但目标横着（宽度>深度），或反之，旋转 90°
      if (w && d && sz0.x > 0.001 && sz0.z > 0.001) {
        const modelVertical = sz0.z > sz0.x
        const targetVertical = d > w
        if (modelVertical !== targetVertical) {
          s.rotation.y = Math.PI / 2
          s.updateMatrixWorld(true)
        }
      }
      const box = new THREE.Box3().setFromObject(s)
      const sz = box.getSize(new THREE.Vector3())
      // 等比缩放：保证放进目标 w/d/h（不拉伸，比例正确）
      let scale = 1
      if (w && d && h) {
        scale = Math.min(w / (sz.x || 1), d / (sz.z || 1), h / (sz.y || 1))
      } else if (h) {
        scale = h / (sz.y || 1)
      }
      s.scale.multiplyScalar(scale)
      s.updateMatrixWorld(true)
      const b2 = new THREE.Box3().setFromObject(s)
      const center = b2.getCenter(new THREE.Vector3())
      s.position.set(-center.x, -b2.min.y, -center.z)
      s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      setScene(s)
    }, undefined, () => { /* 加载失败静默 */ })
    return () => { alive = false }
  }, [url, w, d, h])

  if (!scene) return null
  return <primitive object={scene} />
}

// 家具盒子（对齐原版 uA：boxGeometry + physical 材质 clearcoat）
function FBox({ position, size, color, roughness = 0.72 }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshPhysicalMaterial color={color} roughness={roughness} metalness={0.018} clearcoat={0.16} clearcoatRoughness={0.82} />
    </mesh>
  )
}

// ---------- 家具模型（对齐原版：每个家具用多个盒子拼出具体造型，统一蓝灰主题色） ----------
export function FurnitureModel({ type, color, w: cw, d: cd, h: ch }) {
  const lib = FURNITURE_LIB.find((f) => f.type === type)
  // 网上下载的 GLB 模型：直接加载渲染（自动缩放对齐）
  if (lib && lib.glb) return <GltfModel name={lib.glb} w={cw || lib.w} d={cd || lib.d} h={ch || lib.h} />
  const cat = getCatalogItem(type)
  if (cat) return <GltfModel name={cat.glb} w={cw || cat.w} d={cd || cat.d} h={ch || cat.h} />
  const w = cw || (lib ? lib.w : 1)
  const d = cd || (lib ? lib.d : 0.6)
  const h = ch || (lib ? lib.h : 0.6)
  const M = color || FURNITURE_MAIN
  const D = color ? mixColor(color, '#000000', 0.28) : FURNITURE_DETAIL
  const A = color ? mixColor(color, '#ffffff', 0.35) : FURNITURE_ACCENT
  const q = Math.min(0.12, h * 0.16)  // 桌面厚度
  const legs = (V) => [-1, 1].flatMap(x => [-1, 1].map(z => (
    <FBox key={`${x}${z}`} position={[x * (w / 2 - 0.09), V / 2, z * (d / 2 - 0.09)]} size={[0.08, V, 0.08]} color={D} />
  )))

  switch (type) {
    case '沙发':
      return (
        <group>
          <FBox position={[0, h * 0.24, d * 0.14]} size={[w, h * 0.48, d * 0.58]} color={M} />
          <FBox position={[0, h * 0.68, d * 0.34]} size={[w, h * 0.36, d * 0.16]} color={D} />
          <FBox position={[-w * 0.45, h * 0.38, d * 0.02]} size={[w * 0.12, h * 0.44, d * 0.58]} color={M} />
          <FBox position={[w * 0.45, h * 0.38, d * 0.02]} size={[w * 0.12, h * 0.44, d * 0.58]} color={M} />
          {[-0.24, 0.24].map(V => <FBox key={`s${V}`} position={[V * w, h * 0.53, d * 0.06]} size={[w * 0.43, h * 0.12, d * 0.48]} color={A} roughness={0.5} />)}
          {[-0.25, 0.25].map(V => <FBox key={`p${V}`} position={[V * w, h * 0.7, d * 0.22]} size={[w * 0.34, h * 0.22, d * 0.12]} color={D} roughness={0.5} />)}
        </group>
      )
    case '床':
      return (
        <group>
          <FBox position={[0, h * 0.2, 0]} size={[w, h * 0.4, d]} color={M} />
          <FBox position={[0, h * 0.64, -d * 0.43]} size={[w + 0.04, h * 0.78, d * 0.12]} color={D} />
          <FBox position={[0, h * 0.48, d * 0.12]} size={[w * 0.9, h * 0.15, d * 0.72]} color={A} />
          {[-0.24, 0.24].map(V => <FBox key={`bp${V}`} position={[V * w, h * 0.64, -d * 0.21]} size={[w * 0.3, h * 0.18, d * 0.18]} color={mixColor(A, '#ffffff', 0.14)} roughness={0.46} />)}
          <FBox position={[0, h * 0.56, d * 0.22]} size={[w * 0.72, h * 0.05, d * 0.38]} color={mixColor(D, '#ffffff', 0.1)} roughness={0.48} />
        </group>
      )
    case '餐桌': {
      const chair = (V, b, rot) => (
        <group key={`c${V}${b}`} position={[V * w, 0, b * d]} rotation={[0, rot, 0]}>
          <FBox position={[0, Math.max(0.1, h * 0.34), 0]} size={[w * 0.22, h * 0.18, d * 0.2]} color={A} roughness={0.52} />
          <FBox position={[0, Math.max(0.1, h * 0.58), d * 0.09]} size={[w * 0.22, h * 0.34, d * 0.07]} color={D} roughness={0.54} />
          <FBox position={[-0.08 * w, Math.max(0.05, h * 0.18), -d * 0.055]} size={[0.035, h * 0.36, 0.035]} color={D} roughness={0.6} />
          <FBox position={[0.08 * w, Math.max(0.05, h * 0.18), -d * 0.055]} size={[0.035, h * 0.36, 0.035]} color={D} roughness={0.6} />
        </group>
      )
      return (
        <group>
          <FBox position={[0, h - q / 2, 0]} size={[w, q, d]} color={M} roughness={0.5} />
          <FBox position={[0, h + q * 0.12, 0]} size={[w * 0.82, q * 0.18, d * 0.72]} color={mixColor(A, '#ffffff', 0.1)} roughness={0.42} />
          {legs(h - q)}
          {chair(-0.34, -0.72, Math.PI)}
          {chair(0.34, -0.72, Math.PI)}
          {chair(-0.34, 0.72, 0)}
          {chair(0.34, 0.72, 0)}
        </group>
      )
    }
    case '书桌':
      return (
        <group>
          <FBox position={[0, h - q / 2, 0]} size={[w, q, d]} color={M} roughness={0.5} />
          {legs(h - q)}
          <FBox position={[0, h * 0.55, -d * 0.4]} size={[w * 0.48, h * 0.48, d * 0.16]} color={D} />
          <FBox position={[0, h + 0.14, -d * 0.18]} size={[w * 0.34, h * 0.36, 0.045]} color={mixColor(D, '#dff4ff', 0.28)} roughness={0.42} />
          <FBox position={[0, h + 0.015, -d * 0.18]} size={[0.06, 0.08, 0.05]} color={D} roughness={0.56} />
        </group>
      )
    case '衣柜':
      return (
        <group>
          <FBox position={[0, h / 2, 0]} size={[w, h, d]} color={M} />
          <FBox position={[0, h * 0.54, -d / 2 - 0.004]} size={[0.035, h * 0.76, 0.02]} color={D} />
          {[-0.25, 0.25].map(V => <FBox key={`h${V}`} position={[V * w, h * 0.54, -d / 2 - 0.012]} size={[0.018, h * 0.68, 0.018]} color={D} roughness={0.48} />)}
        </group>
      )
    case '橱柜':
      return (
        <group>
          <FBox position={[0, h / 2, 0]} size={[w, h, d]} color={M} />
          <FBox position={[0, h + 0.025, 0]} size={[w + 0.04, 0.05, d + 0.04]} color={D} roughness={0.5} />
          {[-0.22, 0, 0.22].map(V => <FBox key={`l${V}`} position={[V * w, h * 0.54, -d / 2 - 0.012]} size={[0.014, h * 0.62, 0.016]} color={D} roughness={0.48} />)}
        </group>
      )
    case '岛台':
      return (
        <group>
          <FBox position={[0, h * 0.42, 0]} size={[w * 0.92, h * 0.84, d * 0.88]} color={M} />
          <FBox position={[0, h + 0.035, 0]} size={[w + 0.08, 0.07, d + 0.08]} color={D} roughness={0.44} />
          <mesh position={[w * 0.23, h + 0.076, -d * 0.12]} receiveShadow>
            <boxGeometry args={[w * 0.2, 0.012, d * 0.22]} />
            <meshPhysicalMaterial color="#d8e4e8" roughness={0.26} metalness={0.04} clearcoat={0.18} clearcoatRoughness={0.64} />
          </mesh>
          {[-0.08, 0.08].map(V => (
            <mesh key={`b${V}`} position={[w * -0.18 + V, h + 0.083, d * 0.12]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.055, 0.075, 24]} />
              <meshBasicMaterial color="#9fb0b8" transparent opacity={0.48} toneMapped={false} />
            </mesh>
          ))}
        </group>
      )
    case '茶几':
      return (
        <group>
          <mesh position={[0, h, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, Math.min(0.06, h * 0.18), d]} />
            <meshPhysicalMaterial color="#e6efee" roughness={0.22} metalness={0.015} clearcoat={0.22} clearcoatRoughness={0.54} transparent opacity={0.56} />
          </mesh>
          <FBox position={[0, h * 0.48, 0]} size={[w * 0.56, h * 0.16, d * 0.38]} color={M} roughness={0.56} />
          {legs(Math.max(0.16, h * 0.72))}
        </group>
      )
    case '书架':
      return (
        <group>
          <FBox position={[0, h / 2, d * 0.42]} size={[w, h, d * 0.12]} color={D} />
          <FBox position={[-w / 2 + 0.035, h / 2, 0]} size={[0.07, h, d]} color={M} />
          <FBox position={[w / 2 - 0.035, h / 2, 0]} size={[0.07, h, d]} color={M} />
          {[0.18, 0.38, 0.58, 0.78].map(V => <FBox key={`sh${V}`} position={[0, h * V, 0]} size={[w, 0.055, d]} color={M} roughness={0.56} />)}
          {[-0.28, -0.1, 0.1, 0.28].map((V, b) => <FBox key={`bk${V}`} position={[V * w, h * (0.26 + (b % 2) * 0.2), -d * 0.08]} size={[w * 0.1, h * 0.16, d * 0.42]} color={b % 2 ? '#8198a8' : '#9f8d7f'} roughness={0.66} />)}
        </group>
      )
    case '马桶': {
      const ceramic = (smooth) => (
        <meshPhysicalMaterial color="#f4f5f6" roughness={smooth ? 0.2 : 0.26} metalness={0.01} clearcoat={0.5} clearcoatRoughness={0.22} />
      )
      return (
        <group>
          {/* 水箱（矩形，后） */}
          <mesh position={[0, h * 0.55, d * 0.27]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.92, h * 0.5, d * 0.28]} />
            {ceramic(true)}
          </mesh>
          {/* 水箱盖 */}
          <mesh position={[0, h * 0.82, d * 0.27]}>
            <boxGeometry args={[w * 0.98, h * 0.06, d * 0.32]} />
            <meshPhysicalMaterial color="#fafbfc" roughness={0.16} clearcoat={0.6} />
          </mesh>
          {/* 冲水按钮 */}
          <mesh position={[0, h * 0.87, d * 0.27]}>
            <cylinderGeometry args={[w * 0.09, w * 0.09, h * 0.04, 20]} />
            <meshStandardMaterial color="#c2c7cf" metalness={0.5} roughness={0.25} />
          </mesh>
          {/* 座便器桶身（矩形） */}
          <mesh position={[0, h * 0.24, -d * 0.05]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.86, h * 0.36, d * 0.46]} />
            {ceramic(true)}
          </mesh>
          {/* 坐垫（环形，露出孔洞） */}
          <mesh position={[0, h * 0.44, -d * 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[w * 0.34, w * 0.07, 14, 40]} />
            <meshStandardMaterial color="#dfe3e8" roughness={0.35} />
          </mesh>
          {/* 底座（下宽） */}
          <mesh position={[0, h * 0.06, -d * 0.07]}>
            <boxGeometry args={[w * 0.66, h * 0.12, d * 0.4]} />
            {ceramic(false)}
          </mesh>
          {/* 进水管 */}
          <mesh position={[w * 0.46, h * 0.32, d * 0.27]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[w * 0.04, w * 0.04, w * 0.2, 14]} />
            <meshStandardMaterial color="#c2c7cf" metalness={0.55} roughness={0.25} />
          </mesh>
        </group>
      )
    }
    case '空气净化器':
      return (
        <group>
          {/* 方形机身（米家方形净化器） */}
          <mesh position={[0, h * 0.44, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h * 0.85, d]} />
            <meshPhysicalMaterial color="#f2f4f7" roughness={0.32} metalness={0.02} clearcoat={0.28} clearcoatRoughness={0.5} />
          </mesh>
          {/* 顶部出风口（圆环 + 中心 + 辐条） */}
          <mesh position={[0, h * 0.88, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[w * 0.26, w * 0.4, 40]} />
            <meshStandardMaterial color="#bcc2ca" roughness={0.3} />
          </mesh>
          <mesh position={[0, h * 0.885, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[w * 0.26, 40]} />
            <meshStandardMaterial color="#d5dae0" roughness={0.3} />
          </mesh>
          {[0, 60, 120].map((a) => (
            <mesh key={a} position={[0, h * 0.88, 0]} rotation={[0, a * Math.PI / 180, 0]}>
              <boxGeometry args={[w * 0.8, 0.014, 0.014]} />
              <meshStandardMaterial color="#bcc2ca" roughness={0.3} />
            </mesh>
          ))}
          {/* 前面 OLED 圆屏 + 空气质量环（绿色） */}
          <mesh position={[0, h * 0.36, -d * 0.5]}>
            <circleGeometry args={[w * 0.28, 32]} />
            <meshStandardMaterial color="#0d1015" roughness={0.18} metalness={0.3} />
          </mesh>
          <mesh position={[0, h * 0.36, -d * 0.501]} rotation={[0, 0, Math.PI]}>
            <ringGeometry args={[w * 0.28, w * 0.34, 32]} />
            <meshBasicMaterial color="#6ad4a0" />
          </mesh>
          {/* 底部进气细缝 */}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <mesh key={`s${i}`} position={[(i - 3) * w * 0.13, h * 0.04, -d * 0.5]}>
              <boxGeometry args={[0.006, h * 0.08, 0.008]} />
              <meshStandardMaterial color="#cfd4da" roughness={0.32} />
            </mesh>
          ))}
        </group>
      )
    case '电视机':
      return (
        <group>
          {/* 超薄机身 */}
          <mesh position={[0, h * 0.5, 0]} castShadow>
            <boxGeometry args={[w, h * 0.86, 0.028]} />
            <meshStandardMaterial color="#1a1d22" roughness={0.42} metalness={0.1} />
          </mesh>
          {/* 屏幕（反光） */}
          <mesh position={[0, h * 0.5, 0.015]}>
            <boxGeometry args={[w * 0.955, h * 0.8, 0.006]} />
            <meshPhysicalMaterial color="#0b0d10" roughness={0.1} metalness={0.12} clearcoat={0.65} clearcoatRoughness={0.12} />
          </mesh>
          {/* 下边框 logo 条 */}
          <mesh position={[0, h * 0.06, 0.015]}>
            <boxGeometry args={[w * 0.86, h * 0.05, 0.01]} />
            <meshStandardMaterial color="#33383f" roughness={0.5} />
          </mesh>
          {/* 两个八字支脚 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * w * 0.36, h * 0.025, 0]} castShadow>
              <boxGeometry args={[0.05, h * 0.05, d * 0.72]} />
              <meshStandardMaterial color="#272b31" roughness={0.45} metalness={0.35} />
            </mesh>
          ))}
        </group>
      )
    case '壁灯':
      return (
        <group>
          {/* 灯座（贴墙） */}
          <FBox position={[0, 0, 0]} size={[w * 0.6, h * 0.3, d * 0.8]} color={D} />
          {/* 灯罩（朝下的暖光球） */}
          <mesh position={[0, -h * 0.4, 0]}>
            <sphereGeometry args={[w * 0.45, 16, 12]} />
            <meshStandardMaterial color="#f6e7c0" emissive="#ffd98a" emissiveIntensity={0.5} />
          </mesh>
        </group>
      )
    case '挂画':
      return (
        <group>
          {/* 画框（薄板，用户旋转贴墙） */}
          <FBox position={[0, 0, 0]} size={[w, h, d]} color={D} />
          {/* 画心 */}
          <mesh position={[0, 0, d / 2 + 0.003]}>
            <planeGeometry args={[w * 0.82, h * 0.82]} />
            <meshStandardMaterial color="#d8c9a8" roughness={0.55} />
          </mesh>
        </group>
      )
    case '吊灯':
      return (
        <group>
          {/* 吊线（从天花板往下） */}
          <mesh position={[0, -h * 0.55, 0]}>
            <cylinderGeometry args={[0.012, 0.012, h * 0.9, 8]} />
            <meshStandardMaterial color="#3a3f47" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* 灯罩（锥形朝下） */}
          <mesh position={[0, -h, 0]}>
            <coneGeometry args={[w * 0.5, h * 0.4, 20]} />
            <meshStandardMaterial color="#f0e2b6" emissive="#ffd98a" emissiveIntensity={0.55} />
          </mesh>
          {/* 灯芯 */}
          <mesh position={[0, -h * 0.96, 0]}>
            <sphereGeometry args={[w * 0.09, 12, 12]} />
            <meshBasicMaterial color="#fff3c4" />
          </mesh>
        </group>
      )
    case '吸顶灯':
      return (
        <group>
          {/* 贴顶扁圆盘（朝下发光） */}
          <mesh position={[0, -h * 0.4, 0]}>
            <cylinderGeometry args={[w * 0.5, w * 0.48, h, 24]} />
            <meshStandardMaterial color="#f0e2b6" emissive="#ffe9a8" emissiveIntensity={0.5} />
          </mesh>
        </group>
      )
    case '筒灯':
      return (
        <group>
          {/* 嵌入式小圆盘（朝下） */}
          <mesh position={[0, -h * 0.4, 0]}>
            <cylinderGeometry args={[w * 0.5, w * 0.5, h, 20]} />
            <meshStandardMaterial color="#f0e2b6" emissive="#fff0c0" emissiveIntensity={0.45} />
          </mesh>
        </group>
      )
    case '空调':
      return (
        <group>
          {/* 壁挂分体空调：白色扁机身 */}
          <FBox position={[0, 0, 0]} size={[w, h, d]} color="#f5f7fa" roughness={0.32} />
          {/* 出风口格栅 */}
          <mesh position={[0, -h * 0.18, d / 2 + 0.002]}>
            <planeGeometry args={[w * 0.82, h * 0.34]} />
            <meshStandardMaterial color="#c3ccd4" roughness={0.45} />
          </mesh>
          {[-1, 0, 1].map((i) => (
            <mesh key={i} position={[i * w * 0.25, -h * 0.18, d / 2 + 0.004]}>
              <planeGeometry args={[w * 0.2, h * 0.3]} />
              <meshStandardMaterial color="#d8dee4" roughness={0.4} />
            </mesh>
          ))}
          {/* 指示灯 */}
          <mesh position={[w * 0.32, h * 0.16, d / 2 + 0.006]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshBasicMaterial color="#4ade80" />
          </mesh>
        </group>
      )
    case '热水器':
      return (
        <group>
          {/* 储水式电热水器：横卧白色圆筒 */}
          <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[h * 0.5, h * 0.5, d, 24]} />
            <meshStandardMaterial color="#f5f7fa" roughness={0.35} metalness={0.02} />
          </mesh>
          {/* 端盖 */}
          <mesh position={[d / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <circleGeometry args={[h * 0.5, 24]} />
            <meshStandardMaterial color="#e8ecef" roughness={0.35} />
          </mesh>
          {/* 底部进出水管 */}
          <mesh position={[0, -h * 0.5 - 0.02, 0]}>
            <cylinderGeometry args={[0.028, 0.028, 0.3, 8]} />
            <meshStandardMaterial color="#c0c6cc" metalness={0.4} roughness={0.3} />
          </mesh>
        </group>
      )
    case '窗帘':
      return (
        <group>
          {/* 窗帘杆（横卧圆杆） */}
          <mesh position={[0, h * 0.48, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.02, 0.02, w, 8]} />
            <meshStandardMaterial color="#8a9aa8" metalness={0.4} roughness={0.3} />
          </mesh>
          {/* 窗帘布（几片竖条） */}
          {[-0.3, -0.1, 0.1, 0.3].map((V) => (
            <mesh key={V} position={[V * w, -h * 0.26, 0]} castShadow>
              <boxGeometry args={[w * 0.18, h * 0.5, d * 0.5]} />
              <meshStandardMaterial color="#9fb8c8" roughness={0.7} />
            </mesh>
          ))}
        </group>
      )
    case '传感器':
      return (
        <group>
          {/* 小圆盘（贴墙） */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[w * 0.5, w * 0.5, h, 16]} />
            <meshStandardMaterial color="#eef2f5" roughness={0.35} />
          </mesh>
          {/* 指示灯 */}
          <mesh position={[0, 0, d * 0.3]}>
            <sphereGeometry args={[w * 0.15, 8, 8]} />
            <meshBasicMaterial color="#4ade80" />
          </mesh>
        </group>
      )
    default:
      return <FBox position={[0, h / 2, 0]} size={[w, h, d]} color={M} />
  }
}

// 选中高亮框（蓝色线框）
function SelectBox({ center, size, rot }) {
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2])
    return new THREE.EdgesGeometry(g)
  }, [size[0], size[1], size[2]])
  return (
    <lineSegments geometry={geo} position={[center[0], center[1], center[2]]} rotation={[0, (rot || 0) * Math.PI / 180, 0]}>
      <lineBasicMaterial color="#2f7fe0" />
    </lineSegments>
  )
}

// ---------- 单个家具（支持选择工具下拖动移动） ----------
function Furniture({ item, level, selected, onSelect, onMove, interactive, canDrag }) {
  const pos = item.pos || [0, 0, 0]
  const rot = item.rot || 0
  const scale = item.scale || [1, 1, 1]
  const lib = FURNITURE_LIB.find((f) => f.type === item.type)
  const cat = getCatalogItem(item.type)
  const w = item.width != null ? item.width : (lib ? lib.w : cat ? cat.w : 1)
  const d = item.depth != null ? item.depth : (lib ? lib.d : cat ? cat.d : 0.6)
  const h = item.height != null ? item.height : (lib ? lib.h : cat ? cat.h : 0.6)
  const { camera, gl } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -level), [level])
  const dragRef = useRef(false)

  const toWorld = (e) => {
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    const p = new THREE.Vector3()
    return raycaster.ray.intersectPlane(plane, p) ? p : null
  }

  return (
    <group
      position={[pos[0], level + (pos[1] || 0), pos[2]]}
      rotation={[0, rot * Math.PI / 180, 0]}
      scale={scale}
      onClick={interactive ? (e) => { e.stopPropagation(); onSelect(item) } : undefined}
      onPointerDown={canDrag ? (e) => {
        e.stopPropagation()
        onSelect(item)
        dragRef.current = true
        e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId)
      } : undefined}
      onPointerMove={canDrag ? (e) => {
        if (!dragRef.current) return
        e.stopPropagation()
        const p = toWorld(e)
        if (p) {
          item.pos[0] = Math.round(p.x * 10) / 10
          item.pos[2] = Math.round(p.z * 10) / 10
          onMove(item)
        }
      } : undefined}
      onPointerUp={canDrag ? () => { dragRef.current = false } : undefined}
    >
      <FurnitureModel type={item.type} color={item.color} w={w} d={d} h={h} />
      {selected && <SelectBox center={[0, (lib && lib.type === '床' ? 1 : h / 2 + 0.1), 0]} size={[w + 0.3, h + 0.3, d + 0.3]} rot={0} />}
    </group>
  )
}

// ---------- 房间（地板 + 2D 描边；墙在 Scene 层统一去重渲染） ----------
function Room({ room, roomIdx, floor, level, onSelect, interactive }) {
  const pts = room.points || []
  const view2d = useStore((s) => s.view2d)
  if (pts.length < 3) return null
  // 所有房间地板同一高度（对齐原版 0.025m；房间不重叠，无需高度差）
  const floorY = level + 0.025

  // 地板：按房间多边形实际形状（万能三角剖分，直接水平铺设，法线朝上）
  const floorGeo = useMemo(() => robustFloorGeometry(pts, THREE), [JSON.stringify(pts)])

  return (
    <group onClick={interactive ? (e) => { e.stopPropagation(); onSelect(room) } : undefined}>
      {/* 地板：多边形形状，法线朝上，renderOrder 强制绘制在前 */}
      <mesh geometry={floorGeo} position={[0, floorY, 0]} renderOrder={1} receiveShadow>
        {view2d
          ? <meshBasicMaterial color={room.color || floor.color || '#d5c6a8'} side={THREE.DoubleSide} />
          : <meshPhysicalMaterial color={room.color || floor.color || '#7789ad'} roughness={0.46} metalness={0.02} clearcoat={0.2} clearcoatRoughness={0.82} side={THREE.DoubleSide} />}
      </mesh>
      {/* 2D 地板描边：让房间范围一目了然 */}
      {view2d && (
        <lineLoop position={[0, floorY + 0.02, 0]}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[Float32Array.from(pts.flatMap((p) => [p[0], 0, p[1]])), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#6a7a90" />
        </lineLoop>
      )}
    </group>
  )
}

// ---------- 门窗（墙段上的开口：门 4 类型 + 5 色 + 内开外开；窗 4 类型） ----------
function Opening({ op, floor, level }) {
  const wall = (floor.walls || []).find((w) => w.id === op.wallId)
  if (!wall) return null
  const a = wall.start, b = wall.end
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  const h = floor.height || 2.8
  const t = Math.max(0, Math.min(1, op.offset || 0.5))
  const px = a[0] + (b[0] - a[0]) * t
  const pz = a[1] + (b[1] - a[1]) * t
  const wd = op.width || 0.9
  const isDoor = op.type !== 'window'
  if (isDoor) return <Door3D op={op} px={px} pz={pz} level={level} ang={ang} h={h} wd={wd} />
  return <Window3D op={op} px={px} pz={pz} level={level} ang={ang} h={h} wd={wd} />
}

// 门：门框（左右上）+ 门扇（平开/双开/推拉/门框 + 颜色 + 内开外开 + 翻转）
function Door3D({ op, px, pz, level, ang, h, wd }) {
  const doorH = op.height || h * 0.75
  const style = op.doorStyle || 'swing'
  const color = DOOR_COLORS[op.color] || DOOR_COLORS['木色']
  const frameT = 0.06
  const frame = (x, y, w, hh) => (
    <mesh position={[x, y, 0]} receiveShadow>
      <boxGeometry args={[w, hh, WALL_THICK + 0.01]} />
      <meshStandardMaterial color="#e7ebef" roughness={0.56} metalness={0.01} />
    </mesh>
  )
  // 单扇门：铰链在 hingeX，门扇沿 leafDir 方向延伸，绕铰链微开 openAngle
  const leaf = (hingeX, leafDir, openAngle, leafW) => (
    <group position={[hingeX, 0, 0]} rotation={[0, openAngle, 0]}>
      <mesh position={[leafDir * leafW / 2, doorH / 2, 0.03]} castShadow>
        <boxGeometry args={[leafW, doorH * 0.97, 0.045]} />
        <meshStandardMaterial color={color} roughness={0.72} metalness={0.012} />
      </mesh>
      <mesh position={[leafDir * leafW * 0.82, doorH * 0.54, 0.065]}>
        <sphereGeometry args={[0.035, 16, 8]} />
        <meshStandardMaterial color="#71604d" metalness={0.55} roughness={0.28} />
      </mesh>
    </group>
  )

  if (style === 'frame') {
    // 纯门框：只有框，无门扇
    return (
      <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
        {frame(-wd / 2, doorH / 2, frameT, doorH)}
        {frame(wd / 2, doorH / 2, frameT, doorH)}
        {frame(0, doorH - frameT / 2, wd, frameT)}
      </group>
    )
  }
  if (style === 'slide') {
    // 推拉门：两扇重叠滑板
    return (
      <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
        {frame(0, doorH - frameT / 2, wd, frameT)}
        <mesh position={[-wd * 0.18, doorH / 2, 0.02]} castShadow>
          <boxGeometry args={[wd * 0.55, doorH * 0.94, 0.04]} />
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.02} />
        </mesh>
        <mesh position={[wd * 0.18, doorH / 2, 0.05]} castShadow>
          <boxGeometry args={[wd * 0.55, doorH * 0.94, 0.04]} />
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.02} />
        </mesh>
      </group>
    )
  }
  const swingDir = (op.swing || 'inward') === 'inward' ? 1 : -1
  if (style === 'double') {
    // 双开门：两扇对称微开
    return (
      <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
        {frame(-wd / 2, doorH / 2, frameT, doorH)}
        {frame(wd / 2, doorH / 2, frameT, doorH)}
        {frame(0, doorH - frameT / 2, wd, frameT)}
        {leaf(-wd / 2, 1, -0.5 * swingDir, wd * 0.48)}
        {leaf(wd / 2, -1, 0.5 * swingDir, wd * 0.48)}
      </group>
    )
  }
  // 平开门（单扇）：hinge 决定铰链左/右，swing 决定内/外开
  const hingeLeft = (op.hinge || 'start') === 'start'
  const hingeX = hingeLeft ? -wd / 2 : wd / 2
  const leafDir = hingeLeft ? 1 : -1
  const openAngle = 0.5 * leafDir * swingDir
  return (
    <group position={[px, level, pz]} rotation={[0, -ang, 0]}>
      {frame(-wd / 2, doorH / 2, frameT, doorH)}
      {frame(wd / 2, doorH / 2, frameT, doorH)}
      {frame(0, doorH - frameT / 2, wd, frameT)}
      {leaf(hingeX, leafDir, openAngle, wd * 0.96)}
    </group>
  )
}

// 窗：玻璃 + 边框（普通/落地/推拉/飘窗）
function Window3D({ op, px, pz, level, ang, h, wd }) {
  const style = op.windowStyle || 'standard'
  const isFull = style === 'floor_to_ceiling'
  const bottom = isFull ? 0 : (op.bottom ?? 0.9)
  const winH = isFull ? h : (op.height || 0.9)
  const winY = bottom + winH / 2
  const glass = () => (
    <meshPhysicalMaterial color="#d8f2ff" transmission={0.72} transparent opacity={0.5} roughness={0.08} metalness={0.02} side={THREE.DoubleSide} depthWrite={false} />
  )
  const bar = (x, y, w, hh) => (
    <mesh position={[x, y, 0]}>
      <boxGeometry args={[w, hh, 0.04]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.58} depthWrite={false} toneMapped={false} />
    </mesh>
  )

  return (
    <group position={[px, level + winY, pz]} rotation={[0, -ang, 0]}>
      {style === 'bay' ? (
        <>
          {/* 飘窗：前面玻璃 + 左右斜玻璃 + 窗台板 */}
          <mesh position={[0, 0, -0.18]}><planeGeometry args={[wd, winH]} />{glass()}</mesh>
          <mesh position={[-wd / 2, 0, -0.09]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[0.18, winH]} />{glass()}</mesh>
          <mesh position={[wd / 2, 0, -0.09]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[0.18, winH]} />{glass()}</mesh>
          <mesh position={[0, -winH / 2 - 0.02, -0.09]}><boxGeometry args={[wd, 0.04, 0.2]} /><meshStandardMaterial color="#e7ebef" roughness={0.5} /></mesh>
        </>
      ) : style === 'slide' ? (
        <>
          {/* 推拉窗：两扇玻璃错位重叠 */}
          <mesh position={[-wd * 0.25, 0, 0]}><planeGeometry args={[wd * 0.52, winH]} />{glass()}</mesh>
          <mesh position={[wd * 0.25, 0, 0.02]}><planeGeometry args={[wd * 0.52, winH]} />{glass()}</mesh>
        </>
      ) : (
        <>
          {/* 普通/落地：单扇玻璃 + 四边框 */}
          <mesh><planeGeometry args={[wd, winH]} />{glass()}</mesh>
          {bar(0, winH / 2, wd, 0.03)}
          {bar(0, -winH / 2, wd, 0.03)}
          {bar(-wd / 2, 0, 0.03, winH)}
          {bar(wd / 2, 0, 0.03, winH)}
        </>
      )}
    </group>
  )
}

// ---------- 设备标记 ----------
function DeviceMarker({ dev, level, selected, onSelect, interactive }) {
  const state = useStore((s) => s.haStates[dev.entity_id])
  const domain = (dev.entity_id || '').split('.')[0]
  const isOn = state && state.state === 'on'
  const cat = dev.modelId ? getCatalogItem(dev.modelId) : null
  const isLight = domain === 'light' || domain === 'switch'

  let color = '#556677', emissive = '#334455'
  if (domain === 'light' || domain === 'switch') {
    color = isOn ? '#ffd166' : '#3a4658'
    emissive = isOn ? '#ffaa33' : '#223044'
  } else if (domain === 'sensor') {
    color = '#79d08a'; emissive = '#79d08a'
  } else if (domain === 'binary_sensor') {
    color = isOn ? '#ff6b6b' : '#79d08a'
    emissive = isOn ? '#ff4444' : '#33aa55'
  } else {
    color = isOn ? '#79d08a' : '#556677'
    emissive = isOn ? '#33aa55' : '#334455'
  }

  return (
    <group
      position={[dev.pos[0], level + (dev.pos[1] || 1.4), dev.pos[2]]}
      onClick={interactive ? (e) => { e.stopPropagation(); onSelect(dev) } : undefined}
    >
      {cat ? (
        // 有绑定的模型：用下载的 GLB 模型渲染（灯/热水器/空调等）
        <GltfModel name={cat.glb} w={cat.w} d={cat.d} h={cat.h} />
      ) : (
        // 无模型：小球兜底
        <mesh>
          <sphereGeometry args={[0.13, 16, 12]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.6} />
        </mesh>
      )}
      {/* 灯/开关亮时加点光源，模型发光 */}
      {isLight && isOn && (
        <pointLight color="#ffd08a" intensity={1.5} distance={2.5} />
      )}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.25, 0.35, 24]} />
          <meshBasicMaterial color="#2f7fe0" side={THREE.DoubleSide} transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  )
}

// 渲染模式的光照差异
const MODE_LIGHT = {
  '全屋': { ambient: 0.6, hemi: 0.5, sun: 1.4, sunColor: '#ffffff', tint: '#dfe7ff' },
  '照明': { ambient: 0.4, hemi: 0.4, sun: 0.8, sunColor: '#ffd8a8', tint: '#ffe8c8' },
  '遮阳': { ambient: 0.5, hemi: 0.35, sun: 0.7, sunColor: '#c8d4e8', tint: '#d0d8e8' },
  '环境': { ambient: 0.4, hemi: 0.35, sun: 0.9, sunColor: '#b8d0f0', tint: '#b8d0f0' },
  '安防': { ambient: 0.55, hemi: 0.5, sun: 1.2, sunColor: '#ffffff', tint: '#dfe7ff' },
}

// ---------- 主场景 ----------
export default function Scene({ onSelect, floorIndex }) {
  const project = useStore((s) => s.project)
  const floor = useStore((s) => s.project.floors[floorIndex])
  const night = useStore((s) => s.night)
  const shadows = useStore((s) => s.shadows)
  const selected = useStore((s) => s.selected)
  const tool = useStore((s) => s.tool)
  const mode = useStore((s) => s.mode)
  const view2d = useStore((s) => s.view2d)
  const editing = useStore((s) => s.editing)
  const showWalls = useStore((s) => s.showWalls)

  // 放置工具（墙/家具/设备）时不拦截点击，让交互平面接收
  const interactive = tool === 'select' || tool === 'delete'
  const canDrag = tool === 'move' && editing
  const ml = MODE_LIGHT[mode] || MODE_LIGHT['全屋']
  const th = night ? THEME.night : THEME.day

  // 家具移动：更新位置 + 触发保存
  const handleMoveFurniture = () => {
    setState({ project: { ...project }, saved: false })
  }

  if (!floor) return null
  const level = floor.level || 0
  const sel = selected

  return (
    <>
      {/* 环境光（随渲染模式变化，默认提亮便于看清） */}
      <ambientLight intensity={night ? 0.4 : Math.max(ml.ambient, 0.7)} />
      <hemisphereLight args={[ml.tint, '#6a7a9a', night ? 0.35 : Math.max(ml.hemi, 0.6)]} />
      <directionalLight
        position={[8, 14, 9]} intensity={night ? 0.7 : Math.max(ml.sun, 1.6)} color={ml.sunColor}
        castShadow={shadows}
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-16} shadow-camera-right={16}
        shadow-camera-top={16} shadow-camera-bottom={-16}
        shadow-bias={-0.00016}
      />

      <group>
        {/* 2D 模式：无房间时显示白色画图平面（编辑界面用干净表面，背景图不在这里生效） */}
        {view2d && (floor.rooms || []).length === 0 && (
          <mesh position={[0, level - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[80, 80]} />
            <meshBasicMaterial color={night ? '#1c2333' : '#f7fafc'} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* 网格：只在编辑时显示。2D 用加粗清晰网格（1m 格），3D 编辑用细网格 */}
        {editing && view2d && <DrawingGrid size={20} cell={1} level={level} night={night} />}
        {editing && !view2d && (
          <gridHelper
            args={[30, 30, night ? '#5a6a8a' : '#b8c6d8', night ? '#3a4a6a' : '#dde6ef']}
            position={[0, level + 0.005, 0]}
          />
        )}

        {/* 墙（持久化线段，毛玻璃材质对齐原版；删除模式可点；showWalls 关闭则去除墙壁） */}
        {showWalls && (floor.walls || []).map((w, i) => {
          const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
          if (len < 0.001) return null
          const h = w.height || floor.height || 2.8
          const mx = (w.start[0] + w.end[0]) / 2
          const mz = (w.start[1] + w.end[1]) / 2
          const ang = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0])
          return (
            <mesh
              key={w.id || i}
              position={[mx, h / 2 + level, mz]}
              rotation={[0, -ang, 0]}
              onClick={tool === 'delete' ? (e) => { e.stopPropagation(); onSelect({ type: 'wall', ref: w, index: i }) } : undefined}
            >
              <boxGeometry args={[len, view2d ? 0.01 : h, WALL_THICK]} />
              {view2d
                ? <meshBasicMaterial color="#3a4a66" />
                : <meshPhysicalMaterial color={th.wallColor} transparent opacity={th.wallOpacity} roughness={0.5} metalness={0} clearcoat={0.16} clearcoatRoughness={0.72} depthWrite={false} />}
            </mesh>
          )
        })}

        {/* 房间 */}
        {(floor.rooms || []).map((room, idx) => (
          <Room key={room.id} room={room} roomIdx={idx} floor={floor} level={level}
            interactive={interactive}
            onSelect={(r) => onSelect({ type: 'room', ref: r })} />
        ))}

        {/* 门窗 */}
        {(floor.openings || []).map((op) => <Opening key={op.id} op={op} floor={floor} level={level} />)}

        {/* 家具（纯户型图模式隐藏摆设，只看户型结构） */}
        {mode !== '纯户型' && (floor.furniture || []).map((f) => (
          <Furniture key={f.id} item={f} level={level}
            selected={sel && sel.type === 'furniture' && sel.ref.id === f.id}
            interactive={interactive}
            canDrag={canDrag}
            onSelect={(f) => onSelect({ type: 'furniture', ref: f })}
            onMove={handleMoveFurniture} />
        ))}

        {/* 设备（纯户型图模式隐藏） */}
        {mode !== '纯户型' && (floor.devices || []).map((dev) => (
          <DeviceMarker key={dev.id} dev={dev} level={level}
            selected={sel && sel.type === 'device' && sel.ref.id === dev.id}
            interactive={interactive}
            onSelect={(d) => onSelect({ type: 'device', ref: d })} />
        ))}
      </group>
    </>
  )
}
