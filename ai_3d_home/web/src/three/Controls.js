import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as THREE from 'three'
import { MOUSE } from 'three'
import { useStore, getState, setState } from '../store'

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
  const smoothRef = useRef(null)  // 平滑聚焦动画 {fromPos,toPos,fromTarget,toTarget,t,dur}
  const target = useStore((s) => s.camTarget)
  const view2d = useStore((s) => s.view2d)
  const tool = useStore((s) => s.tool)
  const autoRotate = useStore((s) => s.autoRotate)
  const rotateDir = useStore((s) => s.rotateDir)
  const rotateSpeed = useStore((s) => s.rotateSpeed)
  const viewSignal = useStore((s) => s.camViewSignal)
  const fpsMode = useStore((s) => s.fpsMode)
  const fpsKeys = useStore((s) => s.fpsKeys)
  // 第一人称浏览：WASD 移动 + 鼠标左键拖动转向 + 点击地面行走 + 空格跳跃 + 墙碰撞（不穿墙）
  const fps = useRef({ keys: {}, yaw: 0, pitch: 0, dragging: false, down: false, lx: 0, ly: 0, vy: 0, onGround: true, walkTarget: null })
  // 点到墙段（2D x/z）最短距离，用于碰撞检测（相机不穿墙；已开的门洞区域可穿过）
  const wallDist = (x, z) => {
    try {
      const st = getState()
      const fl = st.project.floors[st.currentFloor]
      const openings = fl.openings || []
      let min = Infinity
      ;(fl.walls || []).forEach((w) => {
        const ax = w.start[0], az = w.start[1], bx = w.end[0], bz = w.end[1]
        const dx = bx - ax, dz = bz - az
        const len2 = dx * dx + dz * dz
        const projT = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0
        const t = Math.max(0, Math.min(1, projT))
        const cx = ax + t * dx, cz = az + t * dz
        const d = Math.hypot(x - cx, z - cz)
        // 已开的门洞：相机投影在门洞区间内时该墙段不阻挡（否则第一人称进不去门）
        const openDoor = openings.find((o) => o.wallId === w.id && o.type !== 'window' && o.doorOpen)
        let inDoor = false
        if (openDoor) {
          const ot = Math.max(0, Math.min(1, openDoor.offset || 0.5))
          const halfW = (openDoor.width || 0.9) / 2
          if (Math.abs(projT - ot) * Math.sqrt(len2) < halfW + 0.2) inDoor = true
        }
        if (!inDoor && d < min) min = d
      })
      return min === Infinity ? Infinity : min
    } catch { return Infinity }
  }

  // 进入/退出第一人称：放初始位置（设置里保存的 fpsStart，否则户型中心）→ 人眼高度；禁用 OrbitControls
  useEffect(() => {
    if (fpsMode) {
      const st = getState()
      const start = st.settings && st.settings.fpsStart
      if (start && start.pos) {
        camera.position.set(start.pos[0], start.pos[1] != null ? start.pos[1] : 1.6, start.pos[2])
        fps.current.yaw = start.yaw || 0
        fps.current.pitch = start.pitch || 0
      } else {
        // 户型中心（房间内），避免进入时落在户型外/墙内看不见
        const fl = st.project.floors[st.currentFloor]
        const rooms = fl ? fl.rooms : []
        let cx = 0, cz = 0, n = 0
        ;(rooms || []).forEach((r) => (r.points || []).forEach((p) => { cx += p[0]; cz += p[1]; n++ }))
        if (n) { camera.position.set(cx / n, 1.6, cz / n) }
        else camera.position.y = 1.6
        fps.current.yaw = camera.rotation.y
        fps.current.pitch = 0
      }
      fps.current.onGround = true
      fps.current.vy = 0
      fps.current.walkTarget = null
      if (ref.current) ref.current.enabled = false
      setState({ selected: null })
    } else if (ref.current) {
      ref.current.enabled = true
    }
  }, [fpsMode])

  // 第一人称：键盘 WASD + 空格跳跃 + 鼠标左键拖动转向 + 点击地面行走
  useEffect(() => {
    if (!fpsMode) return
    const kd = (e) => {
      const k = e.key.toLowerCase()
      fps.current.keys[k] = e.type === 'keydown'
      if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault()
    }
    const md = (e) => { if (e.button === 0) { fps.current.down = true; fps.current.dragging = false; fps.current.lx = e.clientX; fps.current.ly = e.clientY } }
    const mm = (e) => {
      if (!fps.current.down) return
      const dx = e.clientX - fps.current.lx, dy = e.clientY - fps.current.ly
      if (!fps.current.dragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) fps.current.dragging = true
      if (fps.current.dragging) {
        fps.current.lx = e.clientX; fps.current.ly = e.clientY
        fps.current.yaw -= dx * 0.004
        fps.current.pitch = Math.max(-1.4, Math.min(1.4, fps.current.pitch - dy * 0.004))
      }
    }
    const up = (e) => {
      // 左键「点击」（未拖动）→ 点地面行走
      if (fps.current.down && !fps.current.dragging && e.button === 0) {
        const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
        const ray = new THREE.Raycaster()
        ray.setFromCamera(ndc, camera)
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const p = new THREE.Vector3()
        if (ray.ray.intersectPlane(ground, p)) fps.current.walkTarget = new THREE.Vector3(p.x, 0, p.z)
      }
      fps.current.down = false
      fps.current.dragging = false
    }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', kd)
    window.addEventListener('pointerdown', md)
    window.addEventListener('pointermove', mm)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', kd)
      window.removeEventListener('pointerdown', md)
      window.removeEventListener('pointermove', mm)
      window.removeEventListener('pointerup', up)
      fps.current.keys = {}
    }
  }, [fpsMode])

  useEffect(() => {
    const c = new ThreeOrbitControls(camera, gl.domElement)
    // 阻尼：对齐原版 JMGLink（enableDamping + dampingFactor=0.08），松手后有丝滑的惯性滑动感。
    // 之前「乱甩/突然放大」的真根因是 click 误触发跳视角 + 极角钳制（已分别修复），不是阻尼本身
    c.enableDamping = true
    c.dampingFactor = 0.08
    // 限制极角：相机不能翻到地面以下（否则户型图底面朝上、穿模）
    c.minPolarAngle = 0.02
    c.maxPolarAngle = Math.PI / 2 - 0.02
    // 相机切换（2D↔3D 正交/透视）时 OrbitControls 会重建，默认 target=(0,0,0)、enableRotate=true。
    // 必须立刻按当前状态重置，否则 2D 视图会偏到原点、还能被旋转（不规整的根因）。
    const st = getState()
    if (st.camTarget) c.target.set(st.camTarget[0], st.camTarget[1], st.camTarget[2])
    c.enableRotate = !st.view2d && st.tool !== 'pan'
    c.mouseButtons = mouseButtons(st.view2d, st.tool)
    c.autoRotate = st.autoRotate
    c.autoRotateSpeed = 1.2 * st.rotateSpeed * st.rotateDir
    ref.current = c
    // 暴露给屏幕画面拖拽手柄：拖拽时临时禁用 OrbitControls，否则拖手柄的同时镜头会被带着转（用户「拖画面镜头乱动」）
    window.__orbitControls = c
    return () => { c.dispose(); window.__orbitControls = null }
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
    } else if (viewSignal.type === 'default') {
      // 默认 iso 视角（对齐 CameraFocus 原版公式）
      const b = dist * 0.88
      const toPos = new THREE.Vector3(t[0] + 0.86 * b, 0.55 + 0.86 * b, t[2] + 1.04 * b)
      const toTarget = new THREE.Vector3(t[0], 0.55, t[2])
      if (getState().smoothFocus) {
        // 平滑聚焦（开关）：镜头从当前视角缓慢移动到目标，不闪现
        smoothRef.current = { fromPos: camera.position.clone(), toPos, fromTarget: ref.current.target.clone(), toTarget, t: 0, dur: 0.9 }
      } else {
        ref.current.target.copy(toTarget)
        camera.position.copy(toPos)
        if (camera.fov !== 36) { camera.fov = 36; camera.updateProjectionMatrix() }
        camera.lookAt(toTarget)
      }
    } else if (viewSignal.type === 'front') {
      ref.current.target.set(t[0], t[1] + 0.3, t[2])
      camera.position.set(t[0], t[1] + 0.3, t[2] + dist)
    } else if (viewSignal.type.startsWith('custom:')) {
      const cv = st.customViews.find((v) => v.id === viewSignal.type.slice(7))
      if (cv) {
        ref.current.target.set(cv.target[0], cv.target[1], cv.target[2])
        camera.position.set(cv.pos[0], cv.pos[1], cv.pos[2])
      } else return
    } else if (viewSignal.type === 'roomview') {
      // 应用房间锁定视角（room.lockedView / 模型保存视角）——平滑聚焦开启时同样平滑移动
      const rv = st.roomView
      if (rv && rv.pos && rv.target) {
        const toPos = new THREE.Vector3(rv.pos[0], rv.pos[1], rv.pos[2])
        const toTarget = new THREE.Vector3(rv.target[0], rv.target[1], rv.target[2])
        if (getState().smoothFocus) {
          smoothRef.current = { fromPos: camera.position.clone(), toPos, fromTarget: ref.current.target.clone(), toTarget, t: 0, dur: 0.9 }
        } else {
          ref.current.target.copy(toTarget)
          camera.position.copy(toPos)
        }
      } else return
    } else return
    ref.current.update()
  }, [viewSignal.n, camera])

  useEffect(() => {
    if (ref.current) ref.current.enabled = enabled
  }, [enabled])

  // 传 delta 给 update，让 autoRotate 按实际帧耗时缩放（帧率无关，消除卡顿）
  useFrame((_, delta) => {
    // 第一人称浏览：WASD 移动（墙碰撞不穿墙）+ 点击地面行走 + 空格跳跃（不跑 OrbitControls）
    if (fpsMode) {
      const f = fps.current
      // 碰撞：目标点安全（>0.28）或比当前位置离墙更远（允许从墙边脱出，否则卡死在墙边动不了）
      const moveTo = (nx, nz) => {
        const curD = wallDist(camera.position.x, camera.position.z)
        const nextD = wallDist(nx, nz)
        if (nextD > 0.28 || nextD > curD) { camera.position.x = nx; camera.position.z = nz }
      }
      // 点击地面行走（自动走向目标）
      if (f.walkTarget) {
        const t = f.walkTarget
        const dx = t.x - camera.position.x, dz = t.z - camera.position.z
        const dist = Math.hypot(dx, dz)
        if (dist < 0.15) f.walkTarget = null
        else { const step = 3 * Math.min(delta, 0.05); moveTo(camera.position.x + (dx / dist) * step, camera.position.z + (dz / dist) * step) }
      }
      // 键盘移动（碰撞阻挡）；合并虚拟方向键（手机/平板屏幕按键，用 getState 实时读，不依赖重渲染）
      const k = { ...f.keys, ...getState().fpsKeys }
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      const forward = new THREE.Vector3(dir.x, 0, dir.z)
      if (forward.lengthSq() > 0.0001) forward.normalize()
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
      const speed = 2.6 * Math.min(delta, 0.05)
      if (k['w']) moveTo(camera.position.x + forward.x * speed, camera.position.z + forward.z * speed)
      if (k['s']) moveTo(camera.position.x - forward.x * speed, camera.position.z - forward.z * speed)
      if (k['a']) moveTo(camera.position.x - right.x * speed, camera.position.z - right.z * speed)
      if (k['d']) moveTo(camera.position.x + right.x * speed, camera.position.z + right.z * speed)
      // 跳跃（空格）：重力 + 落地恢复 1.6m
      if (f.keys[' '] && f.onGround) { f.vy = 3.6; f.onGround = false }
      if (!f.onGround) {
        f.vy -= 9.8 * delta
        camera.position.y += f.vy * delta
        if (camera.position.y <= 1.6) { camera.position.y = 1.6; f.vy = 0; f.onGround = true }
      }
      // 朝向完全由 yaw/pitch 控制（避免 OrbitControls target 拽回）
      camera.rotation.set(0, 0, 0)
      camera.rotateY(f.yaw)
      camera.rotateX(f.pitch)
      if (!window.__cam3d) window.__cam3d = {}
      window.__cam3d.pos = camera.position.toArray()
      window.__cam3d.target = camera.position.toArray()
      return
    }
    const c = ref.current
    if (!c) return
    // 平滑聚焦动画：每帧插值相机位置 + 目标（smoothstep 缓动），到目标后清除
    const s = smoothRef.current
    if (s) {
      s.t += delta
      const k = Math.min(1, s.t / s.dur)
      const e = k * k * (3 - 2 * k)
      camera.position.lerpVectors(s.fromPos, s.toPos, e)
      c.target.lerpVectors(s.fromTarget, s.toTarget, e)
      if (k >= 1) smoothRef.current = null
    }
    // 限制单帧 delta：卡顿一帧时阻尼不会「跳」导致视角突变（突然放大/乱转）
    c.update(Math.min(delta, 0.05))
    // 暴露当前相机位置/目标，供「保存视角」读取（不触发 React 重渲染）
    if (!window.__cam3d) window.__cam3d = {}
    window.__cam3d.pos = c.object.position.toArray()
    window.__cam3d.target = c.target.toArray()
  })
  return null
}
