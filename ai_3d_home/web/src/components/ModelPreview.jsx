// 模型 3D 预览：独立 Canvas，自动旋转，可拖拽旋转查看
import { useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GltfModel, FurnitureModel } from './Scene'

function PreviewControls() {
  const { camera, gl } = useThree()
  const ref = useRef()
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.autoRotate = true
    c.autoRotateSpeed = 1.6
    c.target.set(0, 0.3, 0)
    ref.current = c
    return () => c.dispose()
  }, [camera, gl])
  return null
}

export default function ModelPreview({ model }) {
  return (
    <Canvas camera={{ position: [1.3, 0.9, 1.3], fov: 40 }} dpr={[1, 2]}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[5, 6, 5]} intensity={1.5} />
      <hemisphereLight args={['#ffffff', '#8899bb', 0.5]} />
      {model.builtin ? (
        <FurnitureModel type={model.type} />
      ) : (
        <GltfModel name={model.glb} w={model.w} d={model.d} h={model.h} />
      )}
      <PreviewControls />
    </Canvas>
  )
}
