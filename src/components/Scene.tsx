import { Suspense, useCallback, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Environment } from './Environment'
import { DonationPortal } from './DonationPortal'

interface SceneProps {
  onPortalActivate: () => void
  onProgress: (progress: number) => void
}

function SceneContent({ onPortalActivate }: { onPortalActivate: () => void }) {
  return (
    <>
      {/* Camera controls — orbit around the scene */}
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={3}
        maxDistance={25}
        autoRotate
        autoRotateSpeed={0.3}
        maxPolarAngle={Math.PI * 0.75}
        minPolarAngle={Math.PI * 0.25}
        dampingFactor={0.05}
        enableDamping
      />

      {/* Fog for depth */}
      <fog attach="fog" args={['#050510', 8, 45]} />

      {/* Environment — the cosmos */}
      <Environment />

      {/* Donation Portal — the discoverable object */}
      <DonationPortal onActivate={onPortalActivate} />

      {/* Post-processing */}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.3}
          luminanceSmoothing={0.9}
          intensity={1.2}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.15} darkness={0.8} />
      </EffectComposer>

      <Preload all />
    </>
  )
}

export function Scene({ onPortalActivate, onProgress }: SceneProps) {
  const [, setReady] = useState(false)

  const handleCreated = useCallback(() => {
    // Simulate loading progress (assets are lightweight for this scene)
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 15 + 5
      if (progress >= 100) {
        progress = 100
        clearInterval(interval)
        setReady(true)
      }
      onProgress(progress)
    }, 200)
  }, [onProgress])

  return (
    <div className="canvas-container">
      <Canvas
        camera={{ position: [0, 2, 10], fov: 60, near: 0.1, far: 100 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          toneMapping: 3, // ACESFilmicToneMapping
          toneMappingExposure: 1.0,
        }}
        onCreated={handleCreated}
      >
        <Suspense fallback={null}>
          <SceneContent onPortalActivate={onPortalActivate} />
        </Suspense>
      </Canvas>
    </div>
  )
}
