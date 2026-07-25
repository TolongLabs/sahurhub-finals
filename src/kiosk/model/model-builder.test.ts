import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { CharacterModel } from './index.ts'
import { buildCharacterModel, buildTralalaModel, setFaceMouthOpen } from './model-builder.ts'
import { validateCharacterDef } from './schema.ts'
import type { ExpressionName } from './types.ts'

const SAHUR_CHARACTER_PATH = `${import.meta.dir}/../../../characters/sahur/character.json`

function buildSahur() {
  const raw: unknown = JSON.parse(readFileSync(SAHUR_CHARACTER_PATH, 'utf8'))
  return buildCharacterModel(validateCharacterDef(raw).model)
}

function bounds(root: THREE.Object3D, name: string): THREE.Box3 {
  root.updateMatrixWorld(true)
  const part = root.getObjectByName(name)
  if (!part) throw new Error(`Missing ${name}`)
  return new THREE.Box3().setFromObject(part)
}

function size(box: THREE.Box3): THREE.Vector3 {
  return box.getSize(new THREE.Vector3())
}

function center(box: THREE.Box3): THREE.Vector3 {
  return box.getCenter(new THREE.Vector3())
}

function applyNeutralPose(parts: ReturnType<typeof buildSahur>): void {
  const model = {
    expression: 'sleep' as ExpressionName,
    mouthOpen: 1,
    pose: { browAngle: 0, eyeScale: 1, mouthCurve: 0, mouthBase: 0, headTurn: 0 },
    nextBlinkAt: Number.POSITIVE_INFINITY,
    blinkUntil: 0,
    scheduleNextBlink: () => {},
    parts
  }
  const setExpression = CharacterModel.prototype.setExpression as (this: unknown, name: string) => void
  const setMouth = CharacterModel.prototype.setMouth as (this: unknown, openAmount: number) => void
  const updateFace = Reflect.get(CharacterModel.prototype, 'updateFace') as (this: unknown, time: number) => void

  setExpression.call(model, 'neutral')
  setMouth.call(model, 0)
  updateFace.call(model, 0)
}

function applyTalkingPose(parts: ReturnType<typeof buildSahur>): void {
  const model = {
    expression: 'neutral' as ExpressionName,
    mouthOpen: 0,
    speaking: false,
    speakingTurn: 0,
    pose: { browAngle: 0, eyeScale: 1, mouthCurve: 0, mouthBase: 0, headTurn: 0 },
    nextBlinkAt: Number.POSITIVE_INFINITY,
    blinkUntil: 0,
    activeAction: null,
    scheduleNextBlink: () => {},
    parts
  }
  const setSpeaking = CharacterModel.prototype.setSpeaking as (this: unknown, speaking: boolean) => void
  const setMouth = CharacterModel.prototype.setMouth as (this: unknown, openAmount: number) => void
  const setExpression = CharacterModel.prototype.setExpression as (this: unknown, name: string) => void
  const updateIdle = Reflect.get(CharacterModel.prototype, 'updateIdle') as (this: unknown, time: number) => void
  const updateFace = Reflect.get(CharacterModel.prototype, 'updateFace') as (this: unknown, time: number) => void
  const updateAction = Reflect.get(CharacterModel.prototype, 'updateAction') as (this: unknown, time: number) => void

  setSpeaking.call(model, true)
  setMouth.call(model, 0.6)
  // A non-neutral expression is load-bearing: smug's mouthCurve rotates the
  // mouth group — with a wrong pivot the lips orbit off the face entirely.
  // Enough ticks for the eased pose to converge on the target.
  setExpression.call(model, 'smug')
  for (let i = 0; i < 60; i += 1) {
    const time = i * 0.05
    updateIdle.call(model, time)
    updateFace.call(model, time)
    updateAction.call(model, time)
  }
}

describe('buildCharacterModel', () => {
  test('constructs Sahur as a wood log with a sculpted face and wooden club', () => {
    const parts = buildSahur()

    expect(parts.root.getObjectByName('wood-log')?.type).toBe('Mesh')
    expect((parts.root.getObjectByName('wood-log') as THREE.Mesh).geometry).toBeInstanceOf(THREE.CylinderGeometry)
    expect(parts.root.getObjectByName('bat')?.type).toBe('Mesh')
    expect((parts.root.getObjectByName('bat') as THREE.Mesh).geometry).toBeInstanceOf(THREE.LatheGeometry)
    expect(parts.root.getObjectByName('left-eye-sclera')?.type).toBe('Mesh')
    expect(parts.root.getObjectByName('right-eye-pupil')?.type).toBe('Mesh')
    expect(parts.root.getObjectByName('nose-bridge')?.type).toBe('Mesh')
    expect(parts.root.getObjectByName('upper-lip')?.type).toBe('Mesh')
    expect(parts.root.getObjectByName('lower-lip')?.type).toBe('Mesh')
    expect(parts.root.getObjectByName('left-foot-toe')?.type).toBe('Mesh')
  })

  test('keeps every visible Sahur part within the H-normalized silhouette contract', () => {
    const parts = buildSahur()
    const { root } = parts
    const H = parts.height
    const rootBox = new THREE.Box3().setFromObject(root)
    const log = bounds(root, 'wood-log')
    const leftEye = bounds(root, 'left-eye-sclera')
    const rightEye = bounds(root, 'right-eye-sclera')
    const face = bounds(root, 'sculpted-face')
    const cavity = bounds(root, 'mouth-cavity')
    const leftArm = bounds(root, 'left-arm')
    const rightArm = bounds(root, 'right-arm')
    const leftLeg = bounds(root, 'left-leg')
    const rightLeg = bounds(root, 'right-leg')
    const leftFoot = bounds(root, 'left-foot-sole')
    const bat = bounds(root, 'bat')

    expect(size(rootBox).y / H).toBeCloseTo(1, 2)
    expect(log.min.y / H).toBeCloseTo(0.28, 2)
    expect(log.max.y / H).toBeCloseTo(1, 2)
    expect(size(log).y / H).toBeCloseTo(0.72, 2)
    expect(size(log).x / H).toBeCloseTo(0.26, 2)
    expect((root.getObjectByName('wood-log') as THREE.Mesh).geometry).toBeInstanceOf(THREE.CylinderGeometry)
    expect(
      ((root.getObjectByName('wood-log') as THREE.Mesh).geometry as THREE.CylinderGeometry).parameters.radialSegments
    ).toBe(32)

    expect(face.min.y / H).toBeGreaterThanOrEqual(0.72)
    expect(face.max.y / H).toBeLessThanOrEqual(0.97)
    for (const eye of [leftEye, rightEye]) expect(size(eye).y / H).toBeLessThanOrEqual(0.09)
    expect(center(leftEye).x / H).toBeCloseTo(-0.045, 2)
    expect(center(rightEye).x / H).toBeCloseTo(0.045, 2)
    expect(center(leftEye).y / H).toBeCloseTo(0.86, 2)
    expect(center(rightEye).y / H).toBeCloseTo(0.86, 2)

    expect(size(cavity).x / H).toBeCloseTo(0.07, 2)
    expect(size(cavity).y / H).toBeCloseTo(0.015, 2)
    expect(size(cavity).z / H).toBeCloseTo(0.02, 2)
    setFaceMouthOpen(parts.face, 1)
    expect(size(bounds(root, 'mouth-cavity')).y / H).toBeCloseTo(0.05, 2)

    expect(leftArm.min.y / H).toBeLessThanOrEqual(0.3)
    expect(rightArm.min.y / H).toBeLessThanOrEqual(0.3)
    expect(leftArm.min.x / H).toBeLessThan(-0.13)
    expect(rightArm.max.x / H).toBeGreaterThan(0.13)
    expect(leftLeg.min.y / H).toBeLessThanOrEqual(0.02)
    expect(rightLeg.min.y / H).toBeLessThanOrEqual(0.02)
    expect(size(leftFoot).z / H).toBeCloseTo(0.06, 2)

    expect(size(bat).y / H).toBeCloseTo(0.34, 1)
    expect(size(bat).x / H).toBeCloseTo(0.3, 1)
    expect(bat.min.y / H).toBeLessThanOrEqual(0.02)
  })

  test('keeps face parts proportionate after a neutral pose update', () => {
    const parts = buildSahur()
    const { root, height: H } = parts

    applyNeutralPose(parts)

    for (const name of ['left-eye-sclera', 'right-eye-sclera']) {
      expect(size(bounds(root, name)).y / H).toBeLessThanOrEqual(0.09)
    }
    expect(size(bounds(root, 'mouth-cavity')).y / H).toBeLessThanOrEqual(0.06)
    for (const name of ['upper-lip', 'lower-lip', 'left-brow-ridge', 'right-brow-ridge']) {
      expect(size(bounds(root, name)).y / H).toBeLessThanOrEqual(0.03)
    }
  })

  test('keeps the speaking face attached and proportionate after animation ticks', () => {
    const parts = buildSahur()
    const { root, height: H } = parts
    const leftBrowRestRotation = parts.face.leftBrow.rotation.z
    const rightBrowRestRotation = parts.face.rightBrow.rotation.z

    applyTalkingPose(parts)

    // Smug raises the brows (browAngle 0.18) on top of their rest rotation.
    expect(parts.face.leftBrow.rotation.z).toBeCloseTo(leftBrowRestRotation + 0.18, 1)
    expect(parts.face.rightBrow.rotation.z).toBeCloseTo(rightBrowRestRotation - 0.18, 1)

    for (const name of ['left-eye-sclera', 'right-eye-sclera']) {
      const sclera = root.getObjectByName(name)
      expect(sclera?.visible).toBe(true)
      expect(size(bounds(root, name)).y / H).toBeGreaterThanOrEqual(0.02)
      expect(size(bounds(root, name)).y / H).toBeLessThanOrEqual(0.09)
    }

    for (const name of ['upper-lip', 'lower-lip', 'mouth-cavity']) {
      const partCenter = center(bounds(root, name))
      expect(Math.abs(partCenter.x) / H).toBeLessThanOrEqual(0.1)
      expect(partCenter.y / H).toBeGreaterThanOrEqual(0.7)
      expect(partCenter.y / H).toBeLessThanOrEqual(0.8)
      expect(partCenter.z).toBeGreaterThan(0)
    }

    const headCenter = center(bounds(root, 'sculpted-face'))
    root.updateMatrixWorld(true)
    parts.face.group.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return
      expect(part.getWorldPosition(new THREE.Vector3()).distanceTo(headCenter) / H).toBeLessThanOrEqual(0.2)
    })
  })
})

const TRALALA_CHARACTER_PATH = `${import.meta.dir}/../../../characters/tralala/character.json`

function buildTralala() {
  const raw: unknown = JSON.parse(readFileSync(TRALALA_CHARACTER_PATH, 'utf8'))
  return buildTralalaModel(validateCharacterDef(raw).model)
}

describe('buildTralalaModel', () => {
  test('constructs the three-legged sneaker shark with the full FaceParts contract', () => {
    const parts = buildTralala()
    const { root } = parts

    expect(root.getObjectByName('shark-body')?.type).toBe('Mesh')
    expect(root.getObjectByName('dorsal-fin')?.type).toBe('Mesh')
    expect(root.getObjectByName('tail-fin')?.type).toBe('Group')
    for (const leg of ['front-leg', 'mid-leg', 'back-leg']) {
      expect(root.getObjectByName(leg)?.type).toBe('Group')
      expect(root.getObjectByName(`${leg}-sneaker-sole`)?.type).toBe('Mesh')
      expect(root.getObjectByName(`${leg}-sneaker-upper`)?.type).toBe('Mesh')
    }
    expect(parts.armPivot.name).toBe('front-leg')
    expect(parts.armPivotRestRotationZ).toBe(0)
    expect(root.getObjectByName('tooth-1')?.type).toBe('Mesh')
  })

  test('keeps the shark inside the H-normalized silhouette and on the ground', () => {
    const parts = buildTralala()
    const H = parts.height
    const whole = bounds(parts.root, 'tralala-model')
    expect(whole.min.y / H).toBeGreaterThanOrEqual(-0.02)
    expect(whole.max.y / H).toBeLessThanOrEqual(1.02)
    expect(Math.abs(whole.min.x) / H).toBeLessThanOrEqual(0.6)
    expect(Math.abs(whole.max.x) / H).toBeLessThanOrEqual(0.6)
    for (const leg of ['front-leg', 'mid-leg', 'back-leg']) {
      expect(bounds(parts.root, `${leg}-sneaker-sole`).min.y / H).toBeLessThanOrEqual(0.06)
    }
  })

  test('keeps the talking shark face attached after expressive animation ticks', () => {
    const parts = buildTralala()
    const H = parts.height
    applyTalkingPose(parts)

    const headCenter = center(bounds(parts.root, 'tralala-face'))
    parts.root.updateMatrixWorld(true)
    parts.face.group.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return
      expect(part.getWorldPosition(new THREE.Vector3()).distanceTo(headCenter) / H).toBeLessThanOrEqual(0.2)
    })
    for (const name of ['left-eye-sclera', 'right-eye-sclera']) {
      expect(parts.root.getObjectByName(name)?.visible).toBe(true)
      expect(size(bounds(parts.root, name)).y / H).toBeGreaterThanOrEqual(0.01)
      expect(size(bounds(parts.root, name)).y / H).toBeLessThanOrEqual(0.09)
    }
    setFaceMouthOpen(parts.face, 1)
    parts.root.updateMatrixWorld(true)
    const openLower = center(bounds(parts.root, 'lower-lip'))
    expect(openLower.distanceTo(headCenter) / H).toBeLessThanOrEqual(0.2)
  })

  test('stomp and strut animation ticks keep the pivot leg and root bounded', () => {
    const parts = buildTralala()
    const updateAction = Reflect.get(CharacterModel.prototype, 'updateAction') as (this: unknown, time: number) => void
    for (const kind of ['stomp', 'strut', 'flinch'] as const) {
      const model = { parts, activeAction: { kind, tier: 3, startedAt: 0, duration: 0.75 } }
      for (const time of [0.1, 0.3, 0.5, 0.7, 0.74]) updateAction.call(model, time)
      expect(Math.abs(parts.armPivot.rotation.z)).toBeLessThanOrEqual(1.2)
      expect(Math.abs(parts.root.rotation.z - parts.rootBaseRotationZ)).toBeLessThanOrEqual(0.3)
      const noAction = { parts, activeAction: null }
      for (let i = 0; i < 40; i += 1) updateAction.call(noAction, i * 0.05)
      expect(Math.abs(parts.armPivot.rotation.z - parts.armPivotRestRotationZ)).toBeLessThanOrEqual(0.02)
    }
  })
})
