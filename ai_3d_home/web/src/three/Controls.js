import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MOUSE } from 'three'
import { useStore, getState } from '../store'

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
  const autoRotate = useStore((s) => s.autoRotate)
  const rotateDir = useStore((s) => s.rotateDir)
  const rotateSpeed = useStore((s) => s.rotateSpeed)
  const viewSignal = useStore((s) => s.camViewSignal)

  useEffect(() => {
    const c = new ThreeOrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    // 限制极角：相机不能翻到地面以下（否则户型图底面朝上、穿模）
    c.minPolarAngle = 0.05
    c.maxPolarAngle = Math.PI / 2 - 0.05
    // 相机切换（2D↔3D 正交/透视）时 OrbitControls 会重建，默认 target=(0,0,0)、enableRotate=true。
    // 必须立刻按当前状态重置，否则 2D 视图会偏到原点、还能被旋转（不规整的根因）。
    const st = getState()
    if (st.camTarget) c.target.set(st.camTarget[0], st.camTarget[1], st.camTarget[2])
    c.enableRotate = !st.view2d && st.tool !== 'pan'
    c.mouseButtons = mouseButtons(st.view2d, st.tool)
    c.autoRotate = st.autoRotate
    c.autoRotateSpeed = 1.2 * st.rotateSpeed * st.rotateDir
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

  // 自动旋转（绕 target=户型中心）；方向按 rotateDir、速度按 rotateSpeed
  useEffect(() => {
    if (ref.current) {
      ref.current.autoRotate = autoRotate
      ref.current.autoRotateSpeed = 1.2 * rotateSpeed * rotateDir
    }
  }, [autoRotate, rotateDir, rotateSpeed])

  useEffect(() => {
    if (ref.current && target) ref.current.target.set(target[0], target[1], target[2])
  }, [target && target[0], target && target[1], target && target[2]])

  // 视图切换（上视图/前视图/自定义视图）
  useEffect(() => {
    if (!viewSignal.n || !ref.current || !viewSignal.type) return
    const st = getState()
    const t = st.camTarget
    const dist = st.camDist
    if (viewSignal.type === 'top') {
      ref.current.target.set(t[0], t[1], t[2])
      camera.position.set(t[0], t[1] + dist * 1.4, t[2] + 0.01)
    } else if (viewSignal.type === 'front') {
      ref.current.target.set(t[0], t[1] + 0.3, t[2])
      camera.position.set(t[0], t[1] + 0.3, t[2] + dist)
    } else if (viewSignal.type.startsWith('custom:')) {
      const cv = st.customViews.find((v) => v.id === viewSignal.type.slice(7))
      if (cv) {
        ref.current.target.set(cv.target[0], cv.target[1], cv.target[2])
        camera.position.set(cv.pos[0], cv.pos[1], cv.pos[2])
      } else return
    } else return
    ref.current.update()
  }, [viewSignal.n, camera])

  useEffect(() => {
    if (ref.current) ref.current.enabled = enabled
  }, [enabled])

  // 传 delta 给 update，让 autoRotate 按实际帧耗时缩放（帧率无关，消除卡顿）
  useFrame((_, delta) => {
    const c = ref.current
    if (!c) return
    c.update(delta)
    // 暴露当前相机位置/目标，供「保存视角」读取（不触发 React 重渲染）
    if (!window.__cam3d) window.__cam3d = {}
    window.__cam3d.pos = c.object.position.toArray()
    window.__cam3d.target = c.target.toArray()
  })
  return null
}
