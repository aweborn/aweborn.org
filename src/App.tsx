import { CreatePanel } from './components/CreatePanel'
import { PlannerPanel } from './components/PlannerPanel'
import { ManaTracker } from './components/ManaTracker'
import { LibraryPanel } from './components/LibraryPanel'
import { HeldItemBar } from './components/HeldItemBar'
import { ChatPanel } from './components/ChatPanel'
import { PlayerActions } from './components/PlayerActions'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Scene } from './components/Scene'
import { LoadingScreen } from './components/LoadingScreen'
import { HUD } from './components/HUD'
import { WorldTransition } from './components/WorldTransition'
import { DonationModal } from './components/DonationModal'
import { MoreSheet } from './components/MoreSheet'
import { OPEN_GIVE_EVENT } from './stores/hudPrefsStore'
import { SyncBridge } from './components/SyncBridge'
import { PlantWorldPanel } from './components/PlantWorldPanel'
import { TouchDock } from './components/TouchDock'
import { TeleportToast } from './components/TeleportToast'
import { OnboardingHint } from './components/OnboardingHint'
import { teleportSystem } from './systems/TeleportSystem'
import { WorldIndex } from './components/WorldIndex'
import { CardReveal } from './components/CardReveal'
import { startWorldIndex } from './stores/worldIndexStore'
import { startLocationPersistence } from './stores/locationStore'
import { startWaveWatcher } from './stores/waveStore'
import { WaveBanner } from './components/WaveBanner'
import { startAudio } from './audio/startAudio'

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

  // Procedural sound (ambience follows the pool; wave, creation, discovery, warp).
  useEffect(() => {
    if (webglSupported) startAudio()
  }, [webglSupported])

  const handlePortalActivate = useCallback(() => {
    setShowDonationModal(true)
  }, [])

  const handleCloseDonation = useCallback(() => {
    setShowDonationModal(false)
  }, [])

  // ••• More → Give (touch) opens the same gift modal as the Origin portal.
  useEffect(() => {
    window.addEventListener(OPEN_GIVE_EVENT, handlePortalActivate)
    return () => window.removeEventListener(OPEN_GIVE_EVENT, handlePortalActivate)
  }, [handlePortalActivate])

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
      {isLoaded && <WorldTransition />}

      {/* Teleport link arrival / error notice */}
      {isLoaded && <TeleportToast />}

      {/* 3-step controls onboarding hint */}
      {isLoaded && webglSupported && <OnboardingHint />}

      {/* World Index (M) + first-visit card reveal */}
      {isLoaded && webglSupported && <WorldIndex />}
            {isLoaded && webglSupported && (
        <>
          <CreatePanel />
          <PlannerPanel />
          <ManaTracker />
          <LibraryPanel />
          <HeldItemBar />
          <ChatPanel />
          <PlayerActions />
          <PlantWorldPanel />
          <TouchDock />
          <MoreSheet />
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
