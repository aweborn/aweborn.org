import { useCallback, useState } from 'react'
import { Scene } from './components/Scene'
import { LoadingScreen } from './components/LoadingScreen'
import { HUD } from './components/HUD'
import { DonationModal } from './components/DonationModal'

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
      {/* 3D Scene — always mounted for loading */}
      <Scene
        onPortalActivate={handlePortalActivate}
        onProgress={setLoadingProgress}
      />

      {/* Loading screen — fades out when ready */}
      <LoadingScreen
        progress={loadingProgress}
        onComplete={handleLoadComplete}
      />

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
