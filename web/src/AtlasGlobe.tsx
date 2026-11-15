import { useEffect, useRef } from 'react'
// Natural Earth public-domain coastlines, via world-atlas 2.0.2 (land-110m.json).
import topology from './atlas-land.json'

const radians = Math.PI / 180
const centerLat = 23 * radians
const sinLat = Math.sin(centerLat)
const cosLat = Math.cos(centerLat)
const mapWidth = 1440
const mapHeight = 720

function landMask() {
  const canvas = document.createElement('canvas')
  canvas.width = mapWidth
  canvas.height = mapHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const { arcs, transform: { scale, translate } } = topology
  const points = arcs.map((arc) => {
    let x = 0, y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]]
    })
  })
  ctx.fillStyle = '#fff'
  for (const polygon of topology.objects.land.geometries[0].arcs) {
    ctx.beginPath()
    for (const ring of polygon) {
      const coordinates = ring.flatMap((index) => index < 0 ? [...points[~index]].reverse() : points[index])
      for (const offset of [-360, 0, 360]) {
        let previous = coordinates[0][0]
        for (const [i, [lon, lat]] of coordinates.entries()) {
          const unwrapped = lon + 360 * Math.round((previous - lon) / 360)
          previous = unwrapped
          const x = (unwrapped + offset + 180) * 4
          const y = (90 - lat) * 4
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
      }
    }
    ctx.fill('evenodd')
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

const grid = (degrees: number) => Math.abs(degrees - 15 * Math.round(degrees / 15))

function prepareGlobe(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  const maskImage = landMask()
  if (!ctx || !maskImage) return null
  const { data: mask } = maskImage
  const land = new Uint8Array(mapWidth * mapHeight)
  const coastline = new Uint8Array(land.length)
  const meridian = Float32Array.from({ length: mapWidth }, (_, x) => Math.max(0, 1 - grid(x / 4) / 0.42) * 45)
  for (let i = 0; i < land.length; i++) land[i] = mask[4 * i + 3]
  for (let i = 0; i < land.length; i++) {
    const x = i % mapWidth
    const row = i - x
    coastline[i] = Math.max(land[row + (x + 2) % mapWidth], land[row + (x + mapWidth - 2) % mapWidth],
      land[Math.max(x, i - 2 * mapWidth)], land[Math.min(land.length - mapWidth + x, i + 2 * mapWidth)]) - land[i]
  }
  const size = canvas.width
  const center = size / 2
  const radius = center - 2
  const image = ctx.createImageData(size, size)
  const { data } = image
  const pixels = new Int32Array(size * size)
  const longitude = new Uint16Array(pixels.length)
  const latitude = new Int32Array(pixels.length)
  const shading = new Float32Array(pixels.length)
  const parallel = new Float32Array(pixels.length)
  let count = 0
  for (let py = 0; py < size; py++) {
    const y = (center - py) / radius
    for (let px = 0; px < size; px++) {
      const x = (px - center) / radius
      const rho = Math.hypot(x, y)
      if (rho > 1) continue
      const z = Math.sqrt(1 - rho * rho)
      const lat = Math.asin(y * cosLat + z * sinLat) / radians
      const lon = Math.atan2(x, z * cosLat - y * sinLat) / radians
      const index = (py * size + px) * 4
      pixels[count] = index
      longitude[count] = Math.floor((lon + 180) * 4) % mapWidth
      latitude[count] = Math.min(mapHeight - 1, Math.max(0, Math.floor((90 - lat) * 4))) * mapWidth
      shading[count] = 1 - Math.max(0, 0.67 * z - 0.41 * x + 0.6 * y)
      parallel[count] = Math.max(0, 1 - grid(lat) / (0.26 + 0.18 * rho)) * 45
      data[index + 3] = Math.min(255, (1 - rho) * radius * 255)
      count++
    }
  }
  return (angle: number) => {
    const shift = (Math.floor(angle * 4) % mapWidth + mapWidth) % mapWidth
    for (let i = 0; i < count; i++) {
      const x = (longitude[i] + shift) % mapWidth
      const sample = latitude[i] + x
      const green = land[sample] / 255
      const ink = coastline[sample] * (50 / 255) + Math.max(parallel[i], meridian[x])
      const shade = shading[i]
      const index = pixels[i]
      data[index] = 223 - 16 * shade - 86 * green - ink
      data[index + 1] = 243 - 11 * shade - 42 * green - ink * 0.8
      data[index + 2] = 241 - 10 * shade - 68 * green - ink * 0.72
    }
    ctx.putImageData(image, 0, 0)
  }
}

function spinGlobe(canvas: HTMLCanvasElement, isPaused: () => boolean) {
  const draw = prepareGlobe(canvas)
  if (!draw) return null
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let angle = -63
  let frameId = 0
  let last = 0

  const frame = (now: number) => {
    if (!last) last = now
    if (now - last >= 24) {
      angle = (angle + Math.min(75, now - last) * 0.008) % 360
      draw(angle)
      last = now
    }
    frameId = requestAnimationFrame(frame)
  }
  const syncMotion = () => {
    cancelAnimationFrame(frameId)
    last = 0
    if (!reducedMotion.matches && !isPaused()) frameId = requestAnimationFrame(frame)
  }

  draw(angle)
  syncMotion()
  reducedMotion.addEventListener('change', syncMotion)
  return {
    sync: syncMotion,
    stop: () => {
      cancelAnimationFrame(frameId)
      reducedMotion.removeEventListener('change', syncMotion)
    },
  }
}

/** `paused` is the landing page's pause control (WCAG 2.2.2): the spin runs for as long as the page is open. */
export default function AtlasGlobe({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pausedRef = useRef(paused)
  const spin = useRef<ReturnType<typeof spinGlobe>>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    spin.current = spinGlobe(element, () => pausedRef.current)
    return () => { spin.current?.stop(); spin.current = null }
  }, [])
  useEffect(() => {
    pausedRef.current = paused
    spin.current?.sync()
  }, [paused])
  return <canvas ref={canvas} width={504} height={504} />
}
