import { Suspense, useCallback, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Environment } from './Environment'
import { DonationPortal } from './DonationPortal'
import { UniverseWorlds } from './UniverseWorlds'
import { PlayerStars } from './PlayerStars'
import { WorldInterior } from './WorldInterior'
import { useUniverseStore } from '../stores/universeStore'

interface SceneProps {
  onPortalActivate: () => void
  onProgress: (progress: number) => void
}

/**
 * Universe view — the star map with worlds, players, and the portal.
 * Hidden when the player is inside a world.
 */
function UniverseView({ onPortalActivate }: { onPortalActivate: () => void }) {
  return (
    <>
      {/* Environment — the cosmos (starfield, clouds, nebula) */}
      <Environment />

      {/* Synced worlds from Universe CRDT (with LOD) */}
      <UniverseWorlds />

      {/* Other players as glowing orbs */}
      <PlayerStars />

      {/* Donation Portal — the discoverable object */}
      <DonationPortal onActivate={onPortalActivate} />
    </>
  )
}

function SceneContent({ onPortalActivate }: { onPortalActivate: () => void }) {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const isInWorld = activeWorldId !== null

  return (
    <>
      {/* Camera controls */}
      <OrbitControls
        enablePan={isInWorld}
        enableZoom={true}
        minDistance={isInWorld ? 1 : 3}
        maxDistance={isInWorld ? 50 : 25}
        autoRotate={!isInWorld}
        autoRotateSpeed={0.3}
        maxPolarAngle={isInWorld ? Math.PI * 0.95 : Math.PI * 0.75}
        minPolarAngle={isInWorld ? Math.PI * 0.05 : Math.PI * 0.25}
        dampingFactor={0.05}
        enableDamping
        target={isInWorld ? [0, 1, 0] : [0, 0, 0]}
      />

      {/* Fog — different for universe vs world interior */}
      <fog attach="fog" args={[
        isInWorld ? '#050510' : '#050510',
        isInWorld ? 15 : 8,
        isInWorld ? 50 : 45,
      ]} />

      {/* Universe view — star map (hidden when inside a world) */}
      {!isInWorld && <UniverseView onPortalActivate={onPortalActivate} />}

      {/* World interior — inside a world (shown when entered) */}
      {isInWorld && <WorldInterior />}

      {/* Post-processing */}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.3}
          luminanceSmoothing={0.9}
          intensity={isInWorld ? 0.8 : 1.2}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.15} darkness={isInWorld ? 0.6 : 0.8} />
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
