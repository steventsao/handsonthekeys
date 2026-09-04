import { useEffect, useRef } from "react"

interface KaraokeRoomCanvasProps {
  readonly playing: boolean
  readonly microphoneActive: boolean
}

const polygon = (
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  fill: string | CanvasGradient | CanvasPattern
) => {
  context.beginPath()
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.closePath()
  context.fillStyle = fill
  context.fill()
}

const roundedPanel = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string
) => {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
  context.fillStyle = fill
  context.fill()
  if (stroke !== undefined) {
    context.strokeStyle = stroke
    context.stroke()
  }
}

const drawRoom = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  playing: boolean,
  microphoneActive: boolean
) => {
  const scale = Math.max(0.7, Math.min(1.25, width / 1440))
  const horizon = height * 0.69
  const inset = Math.max(60, width * 0.095)
  const pulse = playing ? 0.72 + Math.sin(time * 0.0032) * 0.12 : 0.64

  context.clearRect(0, 0, width, height)

  const wall = context.createLinearGradient(0, 0, 0, horizon)
  wall.addColorStop(0, "#51483a")
  wall.addColorStop(0.22, "#7b6c55")
  wall.addColorStop(1, "#443a2e")
  context.fillStyle = wall
  context.fillRect(0, 0, width, horizon)

  const backWall = context.createLinearGradient(0, height * 0.08, 0, horizon)
  backWall.addColorStop(0, "#9e8d70")
  backWall.addColorStop(0.5, "#75664f")
  backWall.addColorStop(1, "#5e513f")
  polygon(
    context,
    [
      [inset, height * 0.08],
      [width - inset, height * 0.08],
      [width - inset * 0.48, horizon],
      [inset * 0.48, horizon]
    ],
    backWall
  )

  polygon(
    context,
    [
      [0, 0],
      [inset, height * 0.08],
      [inset * 0.48, horizon],
      [0, height * 0.82]
    ],
    "#342d25"
  )
  polygon(
    context,
    [
      [width, 0],
      [width - inset, height * 0.08],
      [width - inset * 0.48, horizon],
      [width, height * 0.82]
    ],
    "#302921"
  )

  const ceiling = context.createLinearGradient(0, 0, 0, height * 0.22)
  ceiling.addColorStop(0, "#191714")
  ceiling.addColorStop(1, "#3e392f")
  polygon(
    context,
    [
      [0, 0],
      [width, 0],
      [width - inset, height * 0.08],
      [inset, height * 0.08]
    ],
    ceiling
  )

  const floor = context.createLinearGradient(0, horizon, 0, height)
  floor.addColorStop(0, "#463a2f")
  floor.addColorStop(1, "#171513")
  polygon(
    context,
    [
      [inset * 0.48, horizon],
      [width - inset * 0.48, horizon],
      [width, height],
      [0, height]
    ],
    floor
  )

  context.save()
  context.globalAlpha = 0.24
  context.strokeStyle = "#b08a4b"
  context.lineWidth = Math.max(1, scale)
  for (let row = 0; row < 8; row += 1) {
    const y = horizon + ((row + 1) / 8) ** 1.6 * (height - horizon)
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }
  for (let column = -6; column <= 6; column += 1) {
    context.beginPath()
    context.moveTo(width / 2 + column * 22 * scale, horizon)
    context.lineTo(width / 2 + column * width * 0.14, height)
    context.stroke()
  }
  context.restore()

  const panelTop = height * 0.125
  const panelBottom = horizon * 0.91
  const panelWidth = (width - inset * 2.4) / 13
  for (let index = 0; index < 13; index += 1) {
    const x = inset * 1.2 + index * panelWidth
    context.fillStyle = index % 2 === 0 ? "rgba(51, 43, 33, 0.5)" : "rgba(197, 170, 119, 0.08)"
    context.fillRect(x, panelTop, panelWidth * 0.76, panelBottom - panelTop)
  }

  const lampGlow = context.createRadialGradient(
    width * 0.5,
    height * 0.04,
    0,
    width * 0.5,
    height * 0.04,
    width * 0.3
  )
  lampGlow.addColorStop(0, `rgba(255, 220, 151, ${pulse})`)
  lampGlow.addColorStop(0.18, "rgba(233, 174, 88, 0.2)")
  lampGlow.addColorStop(1, "rgba(233, 174, 88, 0)")
  context.fillStyle = lampGlow
  context.fillRect(0, 0, width, height * 0.48)

  roundedPanel(
    context,
    width * 0.37,
    height * 0.012,
    width * 0.26,
    12 * scale,
    2,
    "rgba(255, 235, 190, 0.88)",
    "rgba(73, 54, 31, 0.8)"
  )

  const exitX = width - inset * 1.1
  roundedPanel(context, exitX, height * 0.12, 58 * scale, 22 * scale, 2, "#163d30", "#79a77d")
  context.fillStyle = "#b8d6a8"
  context.font = `${10 * scale}px "Noto Sans JP", sans-serif`
  context.textAlign = "center"
  context.fillText("非常口", exitX + 29 * scale, height * 0.12 + 15 * scale)

  const speakerY = height * 0.19
  for (const x of [inset * 0.9, width - inset * 0.9 - 56 * scale]) {
    roundedPanel(context, x, speakerY, 56 * scale, 90 * scale, 5, "#1b1a18", "#6b5e4b")
    context.fillStyle = "#080908"
    context.beginPath()
    context.arc(x + 28 * scale, speakerY + 57 * scale, 20 * scale, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = "#4d493e"
    context.stroke()
    context.beginPath()
    context.arc(x + 28 * scale, speakerY + 24 * scale, 7 * scale, 0, Math.PI * 2)
    context.fill()
  }

  const benchTop = horizon - 56 * scale
  const benchBottom = Math.min(height, horizon + 112 * scale)
  polygon(
    context,
    [
      [0, benchTop - 46 * scale],
      [inset * 1.1, benchTop],
      [width * 0.31, benchBottom],
      [0, height * 0.96]
    ],
    "#4e1e1b"
  )
  polygon(
    context,
    [
      [width, benchTop - 46 * scale],
      [width - inset * 1.1, benchTop],
      [width * 0.69, benchBottom],
      [width, height * 0.96]
    ],
    "#461a18"
  )
  context.strokeStyle = "rgba(235, 164, 97, 0.32)"
  context.lineWidth = 2 * scale
  context.beginPath()
  context.moveTo(0, benchTop - 8 * scale)
  context.lineTo(width * 0.28, benchBottom - 8 * scale)
  context.moveTo(width, benchTop - 8 * scale)
  context.lineTo(width * 0.72, benchBottom - 8 * scale)
  context.stroke()

  const tableY = height * 0.83
  polygon(
    context,
    [
      [width * 0.35, tableY],
      [width * 0.65, tableY],
      [width * 0.74, height],
      [width * 0.26, height]
    ],
    "#231c17"
  )
  polygon(
    context,
    [
      [width * 0.365, tableY + 5 * scale],
      [width * 0.635, tableY + 5 * scale],
      [width * 0.69, height * 0.985],
      [width * 0.31, height * 0.985]
    ],
    "#6f5335"
  )
  context.strokeStyle = "rgba(239, 194, 123, 0.26)"
  context.lineWidth = 1
  for (let line = 0; line < 9; line += 1) {
    const y = tableY + 12 * scale + line * 13 * scale
    context.beginPath()
    context.moveTo(width * 0.36, y)
    context.bezierCurveTo(width * 0.45, y - 8, width * 0.56, y + 7, width * 0.66, y)
    context.stroke()
  }

  const remoteX = width * 0.44
  const remoteY = tableY + 18 * scale
  context.save()
  context.translate(remoteX, remoteY)
  context.rotate(-0.045)
  roundedPanel(context, 0, 0, 132 * scale, 74 * scale, 7, "#2a2925", "#92836a")
  roundedPanel(context, 10 * scale, 9 * scale, 77 * scale, 29 * scale, 2, "#263c2d", "#101a13")
  context.fillStyle = "rgba(188, 219, 133, 0.7)"
  context.fillRect(17 * scale, 17 * scale, 56 * scale, 2 * scale)
  for (let button = 0; button < 6; button += 1) {
    context.fillStyle = button === 0 ? "#a94731" : "#b7aa8d"
    context.beginPath()
    context.arc(
      (99 + (button % 2) * 18) * scale,
      (17 + Math.floor(button / 2) * 18) * scale,
      5 * scale,
      0,
      Math.PI * 2
    )
    context.fill()
  }
  context.restore()

  const micX = width * 0.57
  const micY = tableY + 42 * scale
  context.save()
  context.translate(micX, micY)
  context.rotate(0.34)
  roundedPanel(context, 0, 0, 76 * scale, 15 * scale, 8, microphoneActive ? "#8f332a" : "#151716", "#8e8370")
  context.fillStyle = "#282b29"
  context.beginPath()
  context.ellipse(4 * scale, 7.5 * scale, 14 * scale, 11 * scale, 0, 0, Math.PI * 2)
  context.fill()
  if (microphoneActive) {
    context.shadowColor = "#e15d3f"
    context.shadowBlur = 13 * scale
    context.fillStyle = "#ef8062"
    context.beginPath()
    context.arc(62 * scale, 7.5 * scale, 2.5 * scale, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()

  context.strokeStyle = "rgba(12, 13, 12, 0.78)"
  context.lineWidth = 3 * scale
  context.beginPath()
  context.moveTo(micX + 64 * scale, micY + 34 * scale)
  context.bezierCurveTo(width * 0.78, height * 0.94, width * 0.76, height, width * 0.86, height)
  context.stroke()

  if (playing) {
    const colors = ["#d55a3d", "#d8b74f", "#5da29c"] as const
    context.save()
    context.globalCompositeOperation = "screen"
    for (let dot = 0; dot < 20; dot += 1) {
      const x = ((dot * 193 + time * (0.012 + (dot % 3) * 0.004)) % (width + 80)) - 40
      const y = height * (0.16 + ((dot * 47) % 48) / 100)
      context.globalAlpha = 0.12 + (dot % 4) * 0.035
      context.fillStyle = colors[dot % colors.length] ?? colors[0]
      context.beginPath()
      context.arc(x, y, (3 + (dot % 3) * 2) * scale, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }

  const vignette = context.createRadialGradient(
    width / 2,
    height * 0.48,
    width * 0.2,
    width / 2,
    height * 0.48,
    width * 0.76
  )
  vignette.addColorStop(0, "rgba(8, 7, 6, 0)")
  vignette.addColorStop(1, "rgba(8, 7, 6, 0.76)")
  context.fillStyle = vignette
  context.fillRect(0, 0, width, height)

  context.save()
  context.globalAlpha = 0.055
  context.fillStyle = "#f7dfb3"
  for (let x = 0; x < width; x += 8) {
    const offset = (x * 17) % 11
    for (let y = offset; y < height; y += 11) context.fillRect(x, y, 1, 1)
  }
  context.restore()
}

export const KaraokeRoomCanvas = ({ playing, microphoneActive }: KaraokeRoomCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext("2d", { alpha: false })
    if (context === null) return

    let width = 0
    let height = 0
    let frame = 0
    let lastFrame = -Infinity
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const density = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.round(width * density)
      canvas.height = Math.round(height * density)
      context.setTransform(density, 0, 0, density, 0, 0)
      drawRoom(context, width, height, performance.now(), playing, microphoneActive)
    }

    const render = (time: number) => {
      if (time - lastFrame >= 1000 / 24) {
        lastFrame = time
        drawRoom(context, width, height, time, playing, microphoneActive)
      }
      if (!reducedMotion) frame = window.requestAnimationFrame(render)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    if (!reducedMotion) frame = window.requestAnimationFrame(render)

    return () => {
      observer.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [microphoneActive, playing])

  return (
    <canvas
      ref={canvasRef}
      className="karaoke-room-canvas"
      data-testid="karaoke-room-canvas"
      aria-hidden="true"
    />
  )
}
