// Renders the full Abang Ketuk sprite set as deterministic pixel-art PNGs.
//
// No image-generation API is available in this environment, so every frame
// is drawn from a coded pixel map against the DESIGN.md palette/grid tokens
// and written out with a minimal hand-rolled PNG encoder (zero deps beyond
// Bun's built-in `node:zlib`, used only for IDAT deflate). This doubles as
// the reproducible regeneration script the plan requires for the 2-hour
// on-site rebuild (A5). Deterministic + no randomness/timestamps, so re-runs
// are idempotent (byte-identical output).
import { mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const ROOT = new URL('..', import.meta.url).pathname
const OUT_DIR = `${ROOT}assets/character/frames`

const SIZE = 64
const BLOCK = 4 // 16x16 logical grid x 4 = 64x64, Ditoo-style chunky pixel art

type Rgba = readonly [number, number, number, number]

const PALETTE = {
  transparent: [0, 0, 0, 0] as Rgba,
  outline: [0x24, 0x1c, 0x16, 255] as Rgba, // charcoal
  teak: [0x6b, 0x4a, 0x32, 255] as Rgba, // body
  teakShade: [0x4a, 0x32, 0x20, 255] as Rgba, // teak shade, for bare feet
  honey: [0xc9, 0x8a, 0x3b, 255] as Rgba, // mallet / trim
  teal: [0x3c, 0x7a, 0x72, 255] as Rgba, // accent band
  cream: [0xf3, 0xe6, 0xd0, 255] as Rgba, // face plate
  highlight: [0xff, 0xf6, 0xe5, 255] as Rgba // warm-white highlight
} as const

type Canvas = Rgba[][]

function newCanvas(): Canvas {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => PALETTE.transparent))
}

function setPixel(canvas: Canvas, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const row = canvas[y]
  if (row) row[x] = color
}

function fillRectPx(canvas: Canvas, px: number, py: number, w: number, h: number, color: Rgba): void {
  for (let y = py; y < py + h; y++) {
    for (let x = px; x < px + w; x++) setPixel(canvas, x, y, color)
  }
}

// Grid rect with a 2px charcoal outline (DESIGN.md's locked outline token).
function outlinedRect(canvas: Canvas, gx: number, gy: number, gw: number, gh: number, fill: Rgba): void {
  const x = gx * BLOCK
  const y = gy * BLOCK
  const w = gw * BLOCK
  const h = gh * BLOCK
  fillRectPx(canvas, x - 2, y - 2, w + 4, h + 4, PALETTE.outline)
  fillRectPx(canvas, x, y, w, h, fill)
}

type EyeState = 'open' | 'closed' | 'wide'
type MouthState = 'closed' | 'mid' | 'open' | 'smirk' | 'frown' | 'o'

interface Pose {
  eyes: EyeState
  mouth: MouthState
  batonT: number | 'rest'
  brows?: 'angry'
  motionLines?: boolean
  impact?: boolean
  sleepMark?: boolean
  shockMark?: boolean
}

// Face anchors in real pixel space (grid cells 6..9,4..7 = the face plate).
const EYE_L = { x: 24, y: 20 }
const EYE_R = { x: 36, y: 20 }
const MOUTH = { x: 28, y: 24 }

function drawEye(canvas: Canvas, cx: number, cy: number, state: EyeState): void {
  if (state === 'open') fillRectPx(canvas, cx + 1, cy + 1, 2, 2, PALETTE.outline)
  else if (state === 'closed') fillRectPx(canvas, cx, cy + 2, 4, 1, PALETTE.outline)
  else {
    fillRectPx(canvas, cx, cy, 4, 4, PALETTE.outline)
    fillRectPx(canvas, cx + 1, cy + 1, 2, 2, PALETTE.cream)
  }
}

function drawMouth(canvas: Canvas, x: number, y: number, state: MouthState): void {
  if (state === 'closed') fillRectPx(canvas, x, y + 2, 8, 1, PALETTE.outline)
  else if (state === 'mid') fillRectPx(canvas, x + 1, y + 1, 6, 2, PALETTE.outline)
  else if (state === 'open') fillRectPx(canvas, x, y, 8, 4, PALETTE.outline)
  else if (state === 'smirk') {
    fillRectPx(canvas, x, y + 2, 5, 1, PALETTE.outline)
    fillRectPx(canvas, x + 5, y, 2, 2, PALETTE.outline)
  } else if (state === 'frown') {
    fillRectPx(canvas, x + 1, y, 6, 1, PALETTE.outline)
    fillRectPx(canvas, x, y + 2, 1, 2, PALETTE.outline)
    fillRectPx(canvas, x + 7, y + 2, 1, 2, PALETTE.outline)
  } else {
    fillRectPx(canvas, x + 2, y, 4, 4, PALETTE.outline)
    fillRectPx(canvas, x + 3, y + 1, 2, 2, PALETTE.cream)
  }
}

function drawAngryBrows(canvas: Canvas): void {
  fillRectPx(canvas, EYE_L.x, EYE_L.y - 2, 4, 1, PALETTE.outline)
  fillRectPx(canvas, EYE_L.x + 1, EYE_L.y - 3, 3, 1, PALETTE.outline)
  fillRectPx(canvas, EYE_R.x - 1, EYE_R.y - 3, 3, 1, PALETTE.outline)
  fillRectPx(canvas, EYE_R.x, EYE_R.y - 2, 4, 1, PALETTE.outline)
}

function drawSleepMark(canvas: Canvas): void {
  fillRectPx(canvas, 44, 2, 3, 3, PALETTE.honey)
  fillRectPx(canvas, 49, 6, 2, 2, PALETTE.honey)
  fillRectPx(canvas, 53, 9, 2, 2, PALETTE.honey)
}

function drawShockMark(canvas: Canvas): void {
  fillRectPx(canvas, 14, 2, 2, 6, PALETTE.honey)
  fillRectPx(canvas, 14, 10, 2, 2, PALETTE.honey)
}

function drawMotionLines(canvas: Canvas, gx: number, gy: number): void {
  const x = gx * BLOCK
  const y = gy * BLOCK
  fillRectPx(canvas, x - 6, y + 2, 4, 1, PALETTE.outline)
  fillRectPx(canvas, x - 5, y + 6, 3, 1, PALETTE.outline)
  fillRectPx(canvas, x - 4, y - 2, 3, 1, PALETTE.outline)
}

// Non-lethal impact star at the strike point — a knock, never a weapon hit.
function drawImpactMark(canvas: Canvas): void {
  const x = BATON_STRIKE.x * BLOCK
  const y = BATON_STRIKE.y * BLOCK
  fillRectPx(canvas, x - 6, y + 1, 4, 1, PALETTE.honey)
  fillRectPx(canvas, x + 8, y + 1, 4, 1, PALETTE.honey)
  fillRectPx(canvas, x + 1, y - 6, 1, 4, PALETTE.honey)
  fillRectPx(canvas, x + 1, y + 8, 1, 4, PALETTE.honey)
}

interface Point {
  x: number
  y: number
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

// The baton swings along a fixed arc from a raised/ready point down to the
// knock strike point near the body; batonT (0..1) parameterizes the swing.
const BATON_RAISED: Point = { x: 12, y: 2 }
const BATON_STRIKE: Point = { x: 7, y: 9 }

function drawCharacter(pose: Pose): Canvas {
  const canvas = newCanvas()

  outlinedRect(canvas, 6, 2, 4, 11, PALETTE.teak) // log/plank body
  fillRectPx(canvas, 26, 10, 2, 6, PALETTE.highlight) // wood-grain sheen
  outlinedRect(canvas, 6, 4, 4, 4, PALETTE.cream) // face plate
  outlinedRect(canvas, 6, 9, 4, 1, PALETTE.teal) // sash accent band
  outlinedRect(canvas, 6, 13, 2, 2, PALETTE.teakShade) // left bare foot
  outlinedRect(canvas, 8, 13, 2, 2, PALETTE.teakShade) // right bare foot
  outlinedRect(canvas, 10, 6, 1, 2, PALETTE.teak) // shoulder/arm nub

  if (pose.batonT === 'rest') {
    outlinedRect(canvas, 10, 7, 1, 3, PALETTE.honey)
    outlinedRect(canvas, 9, 10, 2, 1, PALETTE.honey)
  } else {
    const pos = lerp(BATON_RAISED, BATON_STRIKE, pose.batonT)
    const gx = Math.round(pos.x)
    const gy = Math.round(pos.y)
    outlinedRect(canvas, gx, gy, 1, 2, PALETTE.honey)
    outlinedRect(canvas, gx - 1, gy + 2, 2, 1, PALETTE.honey)
    if (pose.motionLines) drawMotionLines(canvas, gx, gy)
    if (pose.impact) drawImpactMark(canvas)
  }

  drawEye(canvas, EYE_L.x, EYE_L.y, pose.eyes)
  drawEye(canvas, EYE_R.x, EYE_R.y, pose.eyes)
  drawMouth(canvas, MOUTH.x, MOUTH.y, pose.mouth)
  if (pose.brows === 'angry') drawAngryBrows(canvas)
  if (pose.sleepMark) drawSleepMark(canvas)
  if (pose.shockMark) drawShockMark(canvas)

  return canvas
}

function drawEyesOverlay(state: EyeState): Canvas {
  const canvas = newCanvas()
  drawEye(canvas, EYE_L.x, EYE_L.y, state)
  drawEye(canvas, EYE_R.x, EYE_R.y, state)
  return canvas
}

function drawMouthOverlay(state: MouthState): Canvas {
  const canvas = newCanvas()
  drawMouth(canvas, MOUTH.x, MOUTH.y, state)
  return canvas
}

// --- Minimal PNG encoder (RGBA8, no filtering/interlacing) -----------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0, 0)
  return b
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  return Buffer.concat([u32(data.length), body, u32(crc32(body))])
}

function encodePng(canvas: Canvas): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = pngChunk('IHDR', Buffer.concat([u32(SIZE), u32(SIZE), Buffer.from([8, 6, 0, 0, 0])]))

  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
  let offset = 0
  for (let y = 0; y < SIZE; y++) {
    raw[offset++] = 0 // filter type: none
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = canvas[y]?.[x] ?? PALETTE.transparent
      raw[offset++] = r
      raw[offset++] = g
      raw[offset++] = b
      raw[offset++] = a
    }
  }
  const idat = pngChunk('IDAT', deflateSync(raw))
  const iend = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([signature, ihdr, idat, iend])
}

// --- Frame table -------------------------------------------------------

function restPose(eyes: EyeState, mouth: MouthState): Pose {
  return { eyes, mouth, batonT: 'rest' }
}

const basePose = restPose('open', 'closed')

const FRAMES: { file: string; canvas: Canvas }[] = [
  { file: 'base.png', canvas: drawCharacter(basePose) },
  { file: 'emotion_neutral.png', canvas: drawCharacter(basePose) },
  { file: 'emotion_smug.png', canvas: drawCharacter(restPose('closed', 'smirk')) },
  { file: 'emotion_angry.png', canvas: drawCharacter({ eyes: 'open', mouth: 'open', batonT: 0, brows: 'angry' }) },
  { file: 'emotion_sulk.png', canvas: drawCharacter(restPose('closed', 'frown')) },
  {
    file: 'emotion_shock.png',
    canvas: drawCharacter({ eyes: 'wide', mouth: 'o', batonT: 0.1, shockMark: true })
  },
  {
    file: 'emotion_sleep.png',
    canvas: drawCharacter({ ...restPose('closed', 'closed'), sleepMark: true })
  },

  { file: 'eyes_open.png', canvas: drawEyesOverlay('open') },
  { file: 'eyes_closed.png', canvas: drawEyesOverlay('closed') },

  { file: 'mouth_closed.png', canvas: drawMouthOverlay('closed') },
  { file: 'mouth_mid.png', canvas: drawMouthOverlay('mid') },
  { file: 'mouth_open.png', canvas: drawMouthOverlay('open') },

  { file: 'tung1_a.png', canvas: drawCharacter({ eyes: 'open', mouth: 'closed', batonT: 0.15 }) },
  { file: 'tung1_b.png', canvas: drawCharacter({ eyes: 'open', mouth: 'mid', batonT: 0.55 }) },

  { file: 'tung2_a.png', canvas: drawCharacter({ eyes: 'open', mouth: 'closed', batonT: 0 }) },
  { file: 'tung2_b.png', canvas: drawCharacter({ eyes: 'open', mouth: 'mid', batonT: 0.5 }) },
  {
    file: 'tung2_c.png',
    canvas: drawCharacter({ eyes: 'open', mouth: 'open', batonT: 0.95, motionLines: true })
  },

  {
    file: 'tung3_a.png',
    canvas: drawCharacter({ eyes: 'open', mouth: 'open', batonT: 0, brows: 'angry' })
  },
  {
    file: 'tung3_b.png',
    canvas: drawCharacter({ eyes: 'open', mouth: 'open', batonT: 0.35, brows: 'angry', motionLines: true })
  },
  {
    file: 'tung3_c.png',
    canvas: drawCharacter({
      eyes: 'open',
      mouth: 'open',
      batonT: 1,
      brows: 'angry',
      motionLines: true,
      impact: true
    })
  },
  {
    file: 'tung3_d.png',
    canvas: drawCharacter({ eyes: 'open', mouth: 'mid', batonT: 0.75, brows: 'angry', motionLines: true })
  }
]

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const frame of FRAMES) {
    await Bun.write(`${OUT_DIR}/${frame.file}`, encodePng(frame.canvas))
  }
  console.log(`OK: generated ${FRAMES.length} sprite frames -> ${OUT_DIR}`)
}

await main()
