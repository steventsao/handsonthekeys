import { useEffect, useRef } from "react"
import * as THREE from "three"

interface ThreeMetronomeProps {
  readonly running: boolean
  readonly bpm: number
  readonly meter: readonly [number, number]
  readonly beat: number
  readonly accented: boolean
  readonly sequence: number
}

interface VisualState {
  readonly running: boolean
  readonly bpm: number
  readonly meter: readonly [number, number]
  readonly sequence: number
}

const taperedPlane = (
  bottomWidth: number,
  topWidth: number,
  height: number,
  depth = 0
): THREE.BufferGeometry => {
  const halfHeight = height / 2
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -bottomWidth / 2,
        -halfHeight,
        depth,
        bottomWidth / 2,
        -halfHeight,
        depth,
        topWidth / 2,
        halfHeight,
        depth,
        -topWidth / 2,
        halfHeight,
        depth
      ],
      3
    )
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  return geometry
}

const taperedCase = (): THREE.BufferGeometry => {
  const positions = [
    -1.34, -1.72, 0, 1.34, -1.72, 0, 0.5, 1.72, 0, -0.5, 1.72, 0, -1.34, -1.72, -0.76, 1.34, -1.72, -0.76,
    0.5, 1.72, -0.76, -0.5, 1.72, -0.76
  ]
  const indices = [
    0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

const disposeScene = (scene: THREE.Scene): void => {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
}

export const ThreeMetronome = ({ running, bpm, meter, sequence }: ThreeMetronomeProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const visualStateRef = useRef<VisualState>({ running, bpm, meter, sequence })

  useEffect(() => {
    visualStateRef.current = { running, bpm, meter, sequence }
  }, [bpm, meter, running, sequence])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const host = canvas.parentElement
    if (host === null) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
      })
    } catch {
      canvas.dataset.renderer = "unavailable"
      return
    }

    canvas.dataset.renderer = "webgl"
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 30)
    camera.position.set(0, 0.12, 7.25)
    camera.lookAt(0, -0.1, 0)

    scene.add(new THREE.HemisphereLight(0xf7f3e8, 0x4a4a46, 2.1))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(-3.5, 5, 5.5)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.left = -4
    keyLight.shadow.camera.right = 4
    keyLight.shadow.camera.top = 5
    keyLight.shadow.camera.bottom = -4
    scene.add(keyLight)

    const metronome = new THREE.Group()
    metronome.position.y = 0.15
    scene.add(metronome)

    const caseMaterial = new THREE.MeshStandardMaterial({
      color: 0xe7e2d6,
      metalness: 0.02,
      roughness: 0.92
    })
    const body = new THREE.Mesh(taperedCase(), caseMaterial)
    body.castShadow = true
    body.receiveShadow = true
    metronome.add(body)

    const face = new THREE.Mesh(
      taperedPlane(1.62, 0.48, 2.72, 0.018),
      new THREE.MeshStandardMaterial({ color: 0x1c1c1b, metalness: 0.08, roughness: 0.86 })
    )
    face.position.y = 0.06
    metronome.add(face)

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2.84, 0.16, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x20201e, metalness: 0.05, roughness: 0.9 })
    )
    base.position.set(0, -1.78, -0.34)
    base.castShadow = true
    base.receiveShadow = true
    metronome.add(base)

    const scaleMaterial = new THREE.MeshBasicMaterial({ color: 0xb7b3aa })
    const scaleGroup = new THREE.Group()
    scaleGroup.position.z = 0.045
    metronome.add(scaleGroup)
    for (let index = 0; index < 17; index += 1) {
      const major = index % 4 === 0
      const mark = new THREE.Mesh(new THREE.BoxGeometry(major ? 0.24 : 0.11, 0.012, 0.008), scaleMaterial)
      mark.position.set(major ? 0.34 : 0.405, -0.82 + index * 0.115, 0)
      scaleGroup.add(mark)
    }

    const pendulum = new THREE.Group()
    pendulum.position.set(0, -0.92, 0.13)
    metronome.add(pendulum)

    const metalMaterial = new THREE.MeshStandardMaterial({
      color: 0xc9c7c0,
      metalness: 0.66,
      roughness: 0.48
    })
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 3.28, 10), metalMaterial)
    rod.position.y = 0.72
    rod.castShadow = true
    pendulum.add(rod)

    const weight = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.44, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xd54a38, metalness: 0.08, roughness: 0.72 })
    )
    weight.position.z = 0.08
    weight.castShadow = true
    pendulum.add(weight)

    const counterweight = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.45, 20), metalMaterial)
    counterweight.rotation.z = Math.PI / 2
    counterweight.position.y = -0.82
    counterweight.castShadow = true
    pendulum.add(counterweight)

    const pivot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.1, 28),
      new THREE.MeshStandardMaterial({ color: 0x171716, metalness: 0.45, roughness: 0.5 })
    )
    pivot.rotation.x = Math.PI / 2
    pivot.position.set(0, -0.92, 0.24)
    metronome.add(pivot)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ color: 0xc9c5ba, metalness: 0, roughness: 1 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -1.73, -0.1)
    floor.receiveShadow = true
    scene.add(floor)

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let renderedSequence = visualStateRef.current.sequence
    let beatStartedAt = performance.now()
    let frame = 0
    let disposed = false

    const resize = (): void => {
      const bounds = host.getBoundingClientRect()
      const width = Math.max(1, Math.round(bounds.width))
      const height = Math.max(1, Math.round(bounds.height))
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.position.z = 7.25 * Math.max(1, 0.68 / camera.aspect)
      camera.updateProjectionMatrix()
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    resize()

    const draw = (now: number): void => {
      if (disposed) return
      const state = visualStateRef.current
      const denominator = state.meter[1]
      const pulseDuration = (60_000 / state.bpm) * (4 / denominator)

      if (state.sequence !== renderedSequence) {
        renderedSequence = state.sequence
        beatStartedAt = now
      }

      const pulsePhase = Math.min(1, Math.max(0, (now - beatStartedAt) / pulseDuration))
      const easedPhase = pulsePhase * pulsePhase * (3 - 2 * pulsePhase)
      const from = state.sequence % 2 === 0 ? 1 : -1
      const swing = THREE.MathUtils.lerp(from, -from, easedPhase)
      const targetAngle = state.running && !reducedMotion ? swing * 0.3 : 0
      pendulum.rotation.z = THREE.MathUtils.lerp(pendulum.rotation.z, targetAngle, state.running ? 0.2 : 0.08)
      weight.position.y = THREE.MathUtils.lerp(1.42, 0.18, (state.bpm - 40) / 200)

      renderer.render(scene, camera)
      frame = window.requestAnimationFrame(draw)
    }

    frame = window.requestAnimationFrame(draw)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      disposeScene(scene)
      renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="session-three-canvas" aria-hidden="true" />
}
