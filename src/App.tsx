import { useCallback, useState } from 'react'
import { Scene } from './components/Scene'
import { LoadingScreen } from './components/LoadingScreen'
import { HUD } from './components/HUD'
import { DonationModal } from './components/DonationModal'

import { CanvasErrorBoundary } from './components/CanvasErrorBoundary'
import { FallbackScene } from './components/FallbackScene'

export default function App() {
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
      {/* 3D Scene with WebGL Error Boundary */}
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

      {/* Loading screen — fades out when ready */}
      {!isLoaded && (
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
