import { useCallback, useMemo, useState } from 'react'
import { Scene } from './components/Scene'
import { LoadingScreen } from './components/LoadingScreen'
import { HUD } from './components/HUD'
import { DonationModal } from './components/DonationModal'

import { CanvasErrorBoundary } from './components/CanvasErrorBoundary'
import { FallbackScene } from './components/FallbackScene'

/** Proactively detect WebGL support instead of relying on error boundaries,
 *  which can't catch imperative THREE.WebGLRenderer context-creation errors. */
function detectWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    return gl != null
  } catch {
    return false
  }
}

export default function App() {
  const webglSupported = useMemo(() => detectWebGLSupport(), [])

  const [loadingProgress, setLoadingProgress] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [showDonationModal, setShowDonationModal] = useState(false)

  const handleLoadComplete = useCallback(() => {
    setIsLoaded(true)
  }, [])

  const handlePortalActivate = useCallback(() => {
    setShowDonationModal(true)
  }, [])

  const handleCloseDonation = useCallback(() => {
    setShowDonationModal(false)
  }, [])

  return (
    <>
      {/* 3D Scene — only attempt when WebGL is available */}
      {webglSupported ? (
        <CanvasErrorBoundary 
          fallback={
            <FallbackScene 
              onReady={handleLoadComplete} 
              onDonate={handlePortalActivate} 
            />
          }
        >
          <Scene
            onPortalActivate={handlePortalActivate}
            onProgress={setLoadingProgress}
          />
        </CanvasErrorBoundary>
      ) : (
        <FallbackScene
          onReady={handleLoadComplete}
          onDonate={handlePortalActivate}
        />
      )}

      {/* Loading screen — fades out when ready (only for 3D path) */}
      {webglSupported && !isLoaded && (
        <LoadingScreen
          progress={loadingProgress}
          onComplete={handleLoadComplete}
        />
      )}

      {/* HUD overlay — shows after loading */}
      {isLoaded && (
        <HUD
          showPrompt={true}
          onPromptClick={handlePortalActivate}
        />
      )}

      {/* Donation modal */}
      <DonationModal
        isOpen={showDonationModal}
        onClose={handleCloseDonation}
      />
    </>
  )
}
