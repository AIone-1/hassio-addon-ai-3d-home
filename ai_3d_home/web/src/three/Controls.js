import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useStore } from '../store'

// R3F 与 three 自带 OrbitControls 的桥接
export function Controls({ enabled = true }) {
  const { camera, gl } = useThree()
  const ref = useRef()
  const target = useStore((s) => s.camTarget)

  useEffect(() => {
    const c = new ThreeOrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    ref.current = c
    return () => c.dispose()
  }, [camera, gl])

  useEffect(() => {
    if (ref.current && target) ref.current.target.set(target[0], target[1], target[2])
  }, [target && target[0], target && target[1], target && target[2]])

  useEffect(() => {
    if (ref.current) ref.current.enabled = enabled
  }, [enabled])

  useFrame(() => ref.current?.update())
  return null
}
