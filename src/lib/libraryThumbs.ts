/**
 * Library thumbnails, drawn in the browser.
 *
 * Models made before the server kept preview images (and any whose provider
 * sent none) have no thumbnail, so we render one ourselves: load the same
 * optimized GLB the world uses, frame it at a three-quarter angle, snapshot a
 * small image, and remember it on this device. One model at a time, so the
 * panel never competes with the world for the GPU.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { AUTH_URL } from './player'

const SIZE = 160
const CACHE_PREFIX = 'aweborn-thumb:'

const memory = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
const loader = new GLTFLoader()

/** Serialized: each job waits for the one before it. */
let chain: Promise<unknown> = Promise.resolve()

function stage() {
  if (renderer && scene && camera) return { renderer, scene, camera }
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(SIZE, SIZE, false)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7fb0, 1.6))
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4)
  sun.position.set(3, 5, 4)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0x9db4ff, 0.8)
  fill.position.set(-4, 2, -3)
  scene.add(fill)
  camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100)
  return { renderer, scene, camera }
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry?.dispose()
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
        if (v instanceof THREE.Texture) v.dispose()
      }
      mat.dispose()
    }
  })
}

async function render(file: string): Promise<string> {
  const gltf = await loader.loadAsync(`${AUTH_URL}/assets/${file}?v=2`)
  const { renderer, scene, camera } = stage()
  const model = gltf.scene
  try {
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const radius = Math.max(size.length() / 2, 1e-6)
    model.position.sub(centre)
    scene.add(model)
    // Three-quarter view from slightly above, far enough to hold the whole bounding sphere
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.98
    camera.position.set(dist * 0.62, dist * 0.42, dist * 0.78)
    camera.near = dist / 100
    camera.far = dist * 4
    camera.updateProjectionMatrix()
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)
    return renderer.domElement.toDataURL('image/webp', 0.85)
  } finally {
    scene.remove(model)
    disposeTree(model)
  }
}

function readCache(sha: string): string | null {
  try {
    return localStorage.getItem(CACHE_PREFIX + sha)
  } catch {
    return null
  }
}

function writeCache(sha: string, url: string) {
  try {
    localStorage.setItem(CACHE_PREFIX + sha, url)
  } catch {
    /* storage full or blocked: the thumbnail still shows this session */
  }
}

/** A thumbnail data URL for the model, or null if it couldn't be drawn (cached on this device once made). */
export function libraryThumb(sha: string, file: string): Promise<string | null> {
  if (memory.has(sha)) return Promise.resolve(memory.get(sha) ?? null)
  const cached = readCache(sha)
  if (cached) {
    memory.set(sha, cached)
    return Promise.resolve(cached)
  }
  let job = pending.get(sha)
  if (!job) {
    job = new Promise<string | null>((resolve) => {
      chain = chain.then(async () => {
        try {
          const url = await render(file)
          memory.set(sha, url)
          writeCache(sha, url)
          resolve(url)
        } catch (err) {
          console.warn('[library] thumbnail failed:', file, err)
          memory.set(sha, null) // don't retry every time the list redraws
          resolve(null)
        } finally {
          pending.delete(sha)
        }
      })
    })
    pending.set(sha, job)
  }
  return job
}
