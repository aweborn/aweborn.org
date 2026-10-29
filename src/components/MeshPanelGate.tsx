import { lazy, Suspense } from 'react'
import { useMeshStore } from '../lib/mesh'

// The panel (QR drawing + camera scanning) loads only when someone opens it
const MeshPanel = lazy(() => import('./MeshPanel'))

/** Play nearby (M7b): mounts the dialog while it's open. */
export function MeshPanelGate() {
  const open = useMeshStore((s) => s.panelOpen)
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <MeshPanel />
    </Suspense>
  )
}
