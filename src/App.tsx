import { CreatePanel } from './components/CreatePanel'
import { PlannerPanel } from './components/PlannerPanel'
import { ManaTracker } from './components/ManaTracker'
import { LibraryPanel } from './components/LibraryPanel'
import { ChatPanel } from './components/ChatPanel'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Scene } from './components/Scene'
import { LoadingScreen } from './components/LoadingScreen'
import { HUD } from './components/HUD'
import { DonationModal } from './components/DonationModal'
import { SyncBridge } from './components/SyncBridge'
import { PlantWorldPanel } from './components/PlantWorldPanel'
import { TouchDock } from './components/TouchDock'
import { TeleportToast } from './components/TeleportToast'
import { teleportSystem } from './systems/TeleportSystem'
import { WorldIndex } from './components/WorldIndex'
import { CardReveal } from './components/CardReveal'
import { startWorldIndex } from './stores/worldIndexStore'
import { startLocationPersistence } from './stores/locationStore'
import { startWaveWatcher } from './stores/waveStore'
import { WaveBanner } from './components/WaveBanner'

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

  // Teleport links (/w/<worldId>, from NFC cards / QR codes): resolve once on boot.
  // Starts during the loading screen so the lookup overlaps asset loading.
  useEffect(() => {
    if (webglSupported) void teleportSystem.handleBootLink()
  }, [webglSupported])

  // World Index: sightings, visits, offline queue (from boot, so link arrivals count).
  useEffect(() => {
    if (webglSupported) startWorldIndex()
  }, [webglSupported])

  // Remember where the player is, and put them back there on reload.
  useEffect(() => {
    if (webglSupported) startLocationPersistence()
  }, [webglSupported])

  // Solidification wave: every client online celebrates each new gift.
  useEffect(() => {
    if (webglSupported) startWaveWatcher()
  }, [webglSupported])

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
      {isLoaded && <HUD />}

      {/* Teleport link arrival / error notice */}
      {isLoaded && <TeleportToast />}

      {/* World Index (M) + first-visit card reveal */}
      {isLoaded && webglSupported && <WorldIndex />}
            {isLoaded && webglSupported && (
        <>
          <CreatePanel />
          <PlannerPanel />
          <ManaTracker />
          <LibraryPanel />
          <ChatPanel />
          <PlantWorldPanel />
          <TouchDock />
        </>
      )}
      {isLoaded && webglSupported && <CardReveal />}

      {/* Solidification wave: recognition line + golden flash */}
      {isLoaded && webglSupported && <WaveBanner />}

      {/* Donation modal */}
      <DonationModal
        isOpen={showDonationModal}
        onClose={handleCloseDonation}
      />

      {/* Sync connection (universe/world rooms, presence, chat) + offline chip.
          Replaced the backtick dev panel on 2026-10-21. */}
      <SyncBridge />
    </>
  )
}
