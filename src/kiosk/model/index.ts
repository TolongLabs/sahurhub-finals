// Character-agnostic Three.js renderer (docs/plan.md T9a; docs/trd.md §3.8).
// `mount(el, characterDef)` builds a primitive-composition model from the
// character's `model` params and returns a handle exposing the shared
// renderer API (`setExpression`/`setMouth`/`playAction`/`setSpeaking`/
// `dispose`) — any future character preset reuses this module by shipping
// its own character.json rather than a new renderer. Scene is tuned for the
// 480x320 kiosk panel: a fixed orthographic camera, soft relief lighting,
// and a pixel-ratio cap for Pi GPU headroom.

import * as THREE from 'three'
import { type CharacterParts, buildCharacterModel, buildTralalaModel, setFaceMouthOpen } from './model-builder.ts'
import { resolveAction } from './schema.ts'
import type { CharacterDef, ExpressionName } from './types.ts'
import { EXPRESSION_NAMES } from './types.ts'

export type { CharacterDef, ExpressionName, ModelColors, ModelParams, ModelProportions, VoiceSeam } from './types.ts'
export { validateCharacterDef, resolveAction, CharacterDefValidationError } from './schema.ts'
export type { ResolvedAction } from './schema.ts'

const PANEL_WIDTH = 480
const PANEL_HEIGHT = 320
// Pi GPU headroom cap (docs/plan.md T9a deliverable 1: "pixel-ratio capped
// for Pi GPU headroom").
const MAX_PIXEL_RATIO = 1.5

interface ExpressionPose {
  browAngle: number
  eyeScale: number
  mouthCurve: number
  mouthBase: number
  headTurn: number
}

const EXPRESSION_POSES: Record<ExpressionName, ExpressionPose> = {
  neutral: { browAngle: 0, eyeScale: 1, mouthCurve: 0, mouthBase: 0, headTurn: 0 },
  smug: { browAngle: 0.18, eyeScale: 0.75, mouthCurve: 0.4, mouthBase: 0.12, headTurn: 0.12 },
  angry: { browAngle: -0.4, eyeScale: 0.7, mouthCurve: -0.35, mouthBase: 0.05, headTurn: 0 },
  sulk: { browAngle: -0.15, eyeScale: 0.6, mouthCurve: -0.25, mouthBase: 0, headTurn: 0.65 },
  shock: { browAngle: 0.45, eyeScale: 1.3, mouthCurve: 0, mouthBase: 0.65, headTurn: 0 },
  sleep: { browAngle: 0, eyeScale: 0.05, mouthCurve: 0, mouthBase: 0, headTurn: 0 }
}

function isExpressionName(name: string): name is ExpressionName {
  return (EXPRESSION_NAMES as readonly string[]).includes(name)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

interface TransientAction {
  kind: BuiltinAnimation
  tier: number
  startedAt: number
  duration: number
}

// Built-in animation names the renderer knows how to play. A character's
// action-mapping (docs/trd.md §3.7) points a generic action (e.g. 'remind')
// at one of these; an unrecognised animation name is a no-op + console
// warning, not a crash, so a future character's unmapped action degrades
// gracefully.
type BuiltinAnimation = 'knock' | 'postureShift' | 'stomp' | 'strut' | 'flinch' | 'swipe'

function isBuiltinAnimation(name: string): name is BuiltinAnimation {
  return (
    name === 'knock' ||
    name === 'postureShift' ||
    name === 'stomp' ||
    name === 'strut' ||
    name === 'flinch' ||
    name === 'swipe'
  )
}

// Per-character model constructors, keyed by character.json id. Unknown ids
// fall back to the Sahur builder so a new bundle degrades visibly rather
// than crashing the kiosk.
const MODEL_BUILDERS: Record<string, (params: import('./types.ts').ModelParams) => CharacterParts> = {
  sahur: buildCharacterModel,
  tralala: buildTralalaModel
}

export class CharacterModel {
  private readonly def: CharacterDef
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly renderer: THREE.WebGLRenderer
  private readonly parts: CharacterParts
  private readonly pose: ExpressionPose = { ...EXPRESSION_POSES.neutral }
  private readonly clock = new THREE.Clock()

  private expression: ExpressionName = 'neutral'
  private mouthOpen = 0
  private speaking = false
  private speakingTurn = 0
  private disposed = false
  private frameHandle = 0
  private nextBlinkAt = 0
  private blinkUntil = 0
  private activeAction: TransientAction | null = null

  constructor(el: HTMLElement, def: CharacterDef) {
    this.def = def
    this.scene = new THREE.Scene()

    const width = el.clientWidth || PANEL_WIDTH
    const height = el.clientHeight || PANEL_HEIGHT
    const { proportions } = def.model
    // Frame the full H-normalized character at 85% of the 480×320 viewport.
    const characterTop = proportions.bodyHeight / 0.72
    const centerY = characterTop / 2
    const viewHeight = characterTop / 0.85
    const viewWidth = viewHeight * (width / height)

    this.camera = new THREE.OrthographicCamera(-viewWidth / 2, viewWidth / 2, viewHeight / 2, -viewHeight / 2, 0.1, 20)
    this.camera.position.set(0, centerY, 6)
    this.camera.lookAt(0, centerY, 0)

    // A warm key and cool fill model the shallow wood carving without relying
    // on costly shadows on the Pi's small panel.
    this.scene.add(new THREE.HemisphereLight(0xf7d6ab, 0x241811, 1.15))
    const key = new THREE.DirectionalLight(0xffd0a0, 1.25)
    key.position.set(-2, 3, 4)
    const fill = new THREE.DirectionalLight(0xaec8e0, 0.35)
    fill.position.set(3, 1, 2)
    this.scene.add(key)
    this.scene.add(fill)

    const buildModel = MODEL_BUILDERS[def.id] ?? buildCharacterModel
    if (!MODEL_BUILDERS[def.id]) console.warn(`[kiosk/model] no builder for character "${def.id}", using the default`)
    this.parts = buildModel(def.model)
    this.scene.add(this.parts.root)

    const canvasProvided = el instanceof HTMLCanvasElement
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvasProvided ? el : undefined,
      alpha: true,
      antialias: true
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    this.renderer.setSize(width, height)
    if (!canvasProvided) el.appendChild(this.renderer.domElement)

    this.scheduleNextBlink(0)
    this.frameHandle = requestAnimationFrame(this.tick)
  }

  setExpression(name: string): void {
    if (!isExpressionName(name)) {
      console.warn(`[kiosk/model] unknown expression "${name}", ignoring`)
      return
    }
    this.expression = name
  }

  setMouth(openAmount: number): void {
    this.mouthOpen = Math.min(1, Math.max(0, openAmount))
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking
  }

  // Generic reminder/escalation action, resolved against this character's
  // action-mapping + escalationFlavor (docs/plan.md T9a: "e.g. 'remind' ->
  // the character's mapped animation").
  playAction(name: string, intensity = 1): void {
    let resolved: ReturnType<typeof resolveAction>
    if (isBuiltinAnimation(name)) {
      resolved = { animation: name, tier: Math.max(1, Math.min(3, Math.round(intensity))), flavor: '' }
    } else {
      try {
        resolved = resolveAction(this.def, name, intensity)
      } catch (error) {
        console.warn(`[kiosk/model] ${error instanceof Error ? error.message : `invalid action "${name}"`}`)
        return
      }
    }

    if (!isBuiltinAnimation(resolved.animation)) {
      console.warn(`[kiosk/model] no built-in animation for "${resolved.animation}" (action "${name}")`)
      return
    }

    const now = this.clock.getElapsedTime()
    const durations: Record<BuiltinAnimation, number> = {
      knock: 0.4 + resolved.tier * 0.25,
      postureShift: 0.6,
      stomp: 0.45 + resolved.tier * 0.25,
      strut: 0.9,
      // Long and slow on purpose: designed to stay readable at the SPI
      // panel's ~15fps, where fast oscillations sample into mush.
      flinch: 1.6,
      swipe: 1.4
    }
    this.activeAction = {
      kind: resolved.animation,
      tier: resolved.tier,
      startedAt: now,
      duration: durations[resolved.animation]
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frameHandle)
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const material = object.material
      if (Array.isArray(material)) for (const m of material) m.dispose()
      else material.dispose()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private scheduleNextBlink(t: number): void {
    this.nextBlinkAt = t + 2.5 + Math.random() * 2.5
  }

  private readonly tick = (): void => {
    if (this.disposed) return
    const t = this.clock.getElapsedTime()
    this.updateIdle(t)
    this.updateFace(t)
    this.updateAction(t)
    this.renderer.render(this.scene, this.camera)
    this.frameHandle = requestAnimationFrame(this.tick)
  }

  private updateIdle(t: number): void {
    // Speaking motion is deliberately theatrical: the SPI panel delivers only
    // a few frames per second, so consecutive frames must differ by whole
    // poses (big amplitudes, slow cycles) or the character reads as frozen
    // with only the mouth twitching.
    const breatheSpeed = this.speaking ? 2.2 : 1.6
    const breatheAmplitude = this.speaking ? this.parts.height * 0.06 : 0.03
    this.parts.root.position.y = this.parts.rootBasePositionY + Math.sin(t * breatheSpeed) * breatheAmplitude
    const sway = this.speaking ? Math.sin(t * 1.3) * 0.13 : Math.sin(t * 0.5) * 0.02
    this.parts.root.rotation.z = this.parts.rootBaseRotationZ + sway

    // Front-facing builds (speakingYaw > 0) never stand stock-still: a gentle
    // side-to-side sway at idle deepens into the full diagonal turn while
    // talking, then eases back to the sway when the speech ends.
    this.speakingTurn = lerp(this.speakingTurn, this.speaking ? 1 : 0, 0.04)
    const yawAmplitude = lerp(0.28, 1, this.speakingTurn)
    this.parts.root.rotation.y = this.parts.speakingYaw * yawAmplitude * Math.sin(t * 0.9)
  }

  private updateFace(t: number): void {
    const target = EXPRESSION_POSES[this.expression]
    const ease = 0.12
    this.pose.browAngle = lerp(this.pose.browAngle, target.browAngle, ease)
    this.pose.mouthCurve = lerp(this.pose.mouthCurve, target.mouthCurve, ease)
    this.pose.mouthBase = lerp(this.pose.mouthBase, target.mouthBase, ease)
    this.pose.headTurn = lerp(this.pose.headTurn, target.headTurn, ease)

    if (t >= this.nextBlinkAt) {
      this.blinkUntil = t + 0.12
      this.scheduleNextBlink(t)
    }
    const blinkScale = t < this.blinkUntil ? 0.05 : 1
    this.pose.eyeScale = lerp(this.pose.eyeScale, target.eyeScale * blinkScale, ease)

    const { face } = this.parts
    face.leftBrow.rotation.z = face.leftBrowBaseRotationZ + this.pose.browAngle
    face.rightBrow.rotation.z = face.rightBrowBaseRotationZ - this.pose.browAngle
    face.leftEye.scale.y = face.eyeBaseScaleY * this.pose.eyeScale
    face.rightEye.scale.y = face.eyeBaseScaleY * this.pose.eyeScale
    const lidScale = lerp(1, 4.2, 1 - this.pose.eyeScale)
    face.leftLid.scale.y = face.lidBaseScaleY * lidScale
    face.rightLid.scale.y = face.lidBaseScaleY * lidScale
    face.group.rotation.y = face.groupBaseRotationY + this.pose.headTurn
    // Half-strength tilt: full mouthCurve reads as dislocation on the carved
    // face; half of it reads as a smirk/frown.
    face.mouth.rotation.z = face.mouthBaseRotationZ + this.pose.mouthCurve * 0.5

    const effectiveOpen = Math.min(1, this.pose.mouthBase + this.mouthOpen * (1 - this.pose.mouthBase))
    setFaceMouthOpen(face, effectiveOpen)
  }

  private updateAction(t: number): void {
    const action = this.activeAction
    const { armPivot, root, rootBaseRotationZ, armPivotRestRotationZ: restAngle } = this.parts
    if (!action) {
      // While speaking, the free limb gesticulates in big slow arcs (Sahur's
      // bat arm, Tralala's front leg) so speech reads at the panel's low fps.
      const gesture = this.speaking ? Math.sin(t * 1.9) * 0.55 : 0
      armPivot.rotation.z = lerp(armPivot.rotation.z, restAngle + gesture, 0.1)
      if (!this.speaking) root.rotation.z = lerp(root.rotation.z, rootBaseRotationZ, 0.1)
      return
    }

    const progress = Math.min(1, (t - action.startedAt) / action.duration)
    if (action.kind === 'knock') {
      // Beast register: the whole body commits to the hit. Bigger arm arcs,
      // a hard counter-lunge on the trunk, and a per-impact jolt hop so each
      // tung lands as a full-pose change at the panel's low fps.
      const amplitude = 0.55 + action.tier * 0.35
      const swing = Math.sin(progress * Math.PI * (1 + action.tier)) * amplitude * (1 - progress)
      armPivot.rotation.z = restAngle + swing
      root.rotation.z = rootBaseRotationZ - swing * 0.3
      root.position.y += Math.abs(swing) * this.parts.height * 0.05
    } else if (action.kind === 'stomp') {
      // Lift-and-slam on the pivot leg; beast tiers slam harder with a heavy
      // body heave and a crouch dip on each impact.
      const cycle = Math.sin(progress * Math.PI * (1 + action.tier))
      const lift = Math.abs(cycle) * (0.6 + action.tier * 0.25) * (1 - progress * 0.5)
      armPivot.rotation.z = restAngle + lift
      root.rotation.z = rootBaseRotationZ + cycle * (0.08 + action.tier * 0.03)
      root.position.y -= Math.abs(cycle) * this.parts.height * 0.03
    } else if (action.kind === 'strut') {
      // Side-to-side runway sway, cadence and amplitude scale with tier.
      root.rotation.z =
        rootBaseRotationZ + Math.sin(progress * Math.PI * 2 * (1 + action.tier)) * (0.1 + action.tier * 0.04)
    } else if (action.kind === 'swipe') {
      // Poke retaliation: wind up, lunge at the glass, and swing the baton in
      // furious arcs across the viewer's face — all air, never a depicted hit.
      // The ortho camera can't dolly, so "closing in" is scale + forward lean.
      const windup = Math.min(1, progress / 0.2)
      const active = Math.max(0, Math.min(1, (progress - 0.2) / 0.6))
      const settle = Math.max(0, (progress - 0.85) / 0.15)
      const lunge = Math.sin(active * Math.PI)
      root.scale.setScalar(1 + 0.22 * lunge)
      root.rotation.x = -0.24 * lunge
      const flurry = Math.sin(active * Math.PI * (2 + action.tier)) * (0.9 + action.tier * 0.2) * (1 - settle)
      armPivot.rotation.z = restAngle - 1.1 * windup * (1 - active) + flurry
      root.rotation.z = rootBaseRotationZ + flurry * 0.15
    } else if (action.kind === 'flinch') {
      // Whole-body startle tuned for low fps: an early hop, two heavy slow
      // sways, and one big decaying limb swing — large amplitudes, few cycles.
      const hop = Math.sin(Math.min(progress * 3, 1) * Math.PI) * this.parts.height * 0.05
      root.position.y += hop
      root.rotation.z = rootBaseRotationZ + 0.2 * Math.sin(progress * Math.PI * 2) * (1 - progress * 0.4)
      armPivot.rotation.z = restAngle + 1.0 * Math.sin(progress * Math.PI) * (1 - progress * 0.3)
    } else {
      const lean = 0.12 * action.tier * Math.sin(progress * Math.PI)
      root.rotation.z = rootBaseRotationZ + lean
    }

    if (progress >= 1) {
      if (action.kind === 'swipe') {
        root.scale.setScalar(1)
        root.rotation.x = 0
      }
      this.activeAction = null
    }
  }
}

export function mount(el: HTMLElement, characterDef: CharacterDef): CharacterModel {
  return new CharacterModel(el, characterDef)
}
