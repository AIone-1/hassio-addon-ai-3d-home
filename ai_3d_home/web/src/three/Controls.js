import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MOUSE } from 'three'
import { useStore } from '../store'

// 鼠标按键映射：平移工具 / 2D 时左键=平移
function mouseButtons(view2d, tool) {
  if (view2d || tool === 'pan') {
    return { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
  }
  return { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
}

// R3F 与 three 自带 OrbitControls 的桥接
export function Controls({ enabled = true }) {
  const { camera, gl } = useThree()
  const ref = useRef()
  const target = useStore((s) => s.camTarget)
  const view2d = useStore((s) => s.view2d)
  const tool = useStore((s) => s.tool)

  useEffect(() => {
    const c = new ThreeOrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    ref.current = c
    return () => c.dispose()
  }, [camera, gl])

  // 2D 模式或平移工具：禁旋转，左键平移；否则左键旋转
  useEffect(() => {
    if (ref.current) {
      ref.current.enableRotate = !view2d && tool !== 'pan'
      ref.current.mouseButtons = mouseButtons(view2d, tool)
    }
  }, [view2d, tool])

  useEffect(() => {
    if (ref.current && target) ref.current.target.set(target[0], target[1], target[2])
  }, [target && target[0], target && target[1], target && target[2]])

  useEffect(() => {
    if (ref.current) ref.current.enabled = enabled
  }, [enabled])

  useFrame(() => ref.current?.update())
  return null
}
