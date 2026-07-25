import * as THREE from 'three'
import type { ModelParams } from './types.ts'

const WOOD_DARK = new THREE.Color('#81502e')
const WOOD_MID = new THREE.Color('#a96f3f')
const WOOD_LIGHT = new THREE.Color('#c28a55')
const WOOD_SHADOW = new THREE.Color('#5b321d')
const EYE_WHITE = new THREE.Color('#f3e5cc')
const IRIS_BROWN = new THREE.Color('#5a2d1d')
const PUPIL_BROWN = new THREE.Color('#1d110d')

export interface FaceParts {
  group: THREE.Group
  leftEye: THREE.Mesh
  rightEye: THREE.Mesh
  eyeBaseScaleY: number
  leftBrow: THREE.Mesh
  rightBrow: THREE.Mesh
  leftBrowBaseRotationZ: number
  rightBrowBaseRotationZ: number
  leftLid: THREE.Mesh
  rightLid: THREE.Mesh
  lidBaseScaleY: number
  groupBaseRotationY: number
  mouth: THREE.Group
  mouthBaseRotationZ: number
  jaw: THREE.Group
  jawBasePositionY: number
  jawBaseRotationX: number
  mouthCavity: THREE.Mesh
  mouthCavityBaseScaleY: number
  mouthOpenDistance: number
}

export interface CharacterParts {
  root: THREE.Group
  face: FaceParts
  // The group the transient action animation swings — Sahur's bat arm,
  // Tralala's front sneaker leg. Pivot must sit at the limb's attachment.
  armPivot: THREE.Group
  // Rest rotation.z the action animation settles back to (character-tuned).
  armPivotRestRotationZ: number
  // Peak root yaw while speaking: front-facing builds (Tralala) turn diagonal
  // to show their long profile when talking. 0 = never yaw (Sahur).
  speakingYaw: number
  rootBasePositionY: number
  rootBaseRotationZ: number
  height: number
}

function woodMaterial(color = WOOD_MID): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 })
}

function woodMesh(name: string, geometry: THREE.BufferGeometry, color = WOOD_MID): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, woodMaterial(color))
  mesh.name = name
  return mesh
}

function ellipsoid(name: string, color: THREE.Color, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.72 })
  )
  mesh.name = name
  mesh.scale.set(x, y, z)
  return mesh
}

function capsuleBetween(
  name: string,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  color = WOOD_MID
): THREE.Mesh {
  const length = from.distanceTo(to)
  const capsule = woodMesh(name, new THREE.CapsuleGeometry(radius, Math.max(0.001, length), 5, 10), color)
  capsule.position.copy(from).add(to).multiplyScalar(0.5)
  capsule.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
  return capsule
}

function makeWoodLog(H: number): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(H * 0.11, H * 0.13, H * 0.72, 32, 12)
  const positions = geometry.getAttribute('position')
  const colors = new Float32Array(positions.count * 3)
  const color = new THREE.Color()

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    const grain = Math.sin(Math.atan2(z, x) * 8 + y * 15) * 0.12 + Math.sin(Math.atan2(z, x) * 19 - y * 5) * 0.05
    color.lerpColors(WOOD_DARK, WOOD_LIGHT, THREE.MathUtils.clamp(0.48 + grain, 0, 1))
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const log = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 })
  )
  log.name = 'wood-log'
  log.position.y = H * 0.64
  return log
}

function buildFace(H: number): FaceParts {
  const group = new THREE.Group()
  group.name = 'sculpted-face'
  const eyeSurface = H * 0.114
  const eyeCenterZ = eyeSurface - H * 0.02

  const eyeBaseScaleY = H * 0.035
  const leftEye = ellipsoid('left-eye-sclera', EYE_WHITE, H * 0.035, eyeBaseScaleY, H * 0.035)
  leftEye.position.set(-H * 0.045, H * 0.86, eyeCenterZ)
  const rightEye = leftEye.clone()
  rightEye.name = 'right-eye-sclera'
  rightEye.position.x *= -1
  group.add(leftEye, rightEye)

  for (const [side, x] of [
    ['left', -H * 0.045],
    ['right', H * 0.045]
  ] as const) {
    const iris = ellipsoid(`${side}-eye-iris`, IRIS_BROWN, H * 0.018, H * 0.018, H * 0.003)
    iris.position.set(x, H * 0.86, eyeCenterZ + H * 0.034)
    const pupil = ellipsoid(`${side}-eye-pupil`, PUPIL_BROWN, H * 0.008, H * 0.01, H * 0.002)
    pupil.position.set(x, H * 0.86, eyeCenterZ + H * 0.038)
    group.add(iris, pupil)
  }

  const leftBrow = woodMesh('left-brow-ridge', new THREE.BoxGeometry(H * 0.05, H * 0.012, H * 0.012), WOOD_SHADOW)
  leftBrow.position.set(-H * 0.045, H * 0.91, eyeCenterZ + H * 0.018)
  leftBrow.rotation.z = -0.1
  const rightBrow = leftBrow.clone()
  rightBrow.name = 'right-brow-ridge'
  rightBrow.position.x *= -1
  rightBrow.rotation.z *= -1
  group.add(leftBrow, rightBrow)

  const lidBaseScaleY = H * 0.008
  const leftLid = ellipsoid('left-upper-lid', WOOD_MID, H * 0.034, lidBaseScaleY, H * 0.006)
  leftLid.position.set(-H * 0.045, H * 0.884, eyeCenterZ + H * 0.029)
  const rightLid = leftLid.clone()
  rightLid.name = 'right-upper-lid'
  rightLid.position.x *= -1
  group.add(leftLid, rightLid)

  const noseBridge = woodMesh('nose-bridge', new THREE.BoxGeometry(H * 0.022, H * 0.055, H * 0.018), WOOD_LIGHT)
  noseBridge.position.set(0, H * 0.81, eyeSurface + H * 0.009)
  const noseTip = ellipsoid('nose-tip', WOOD_LIGHT, H * 0.018, H * 0.014, H * 0.014)
  noseTip.position.set(0, H * 0.778, eyeSurface + H * 0.014)
  group.add(noseBridge, noseTip)

  // The mouth/jaw groups pivot at the mouth center — mouthCurve (rotation.z)
  // and the jaw hinge (rotation.x) must rotate the lips in place, not orbit
  // them around the model origin at the feet. Child positions are relative;
  // world positions at rest are unchanged.
  const mouth = new THREE.Group()
  mouth.name = 'mouth'
  mouth.position.set(0, H * 0.745, H * 0.1245)
  const upperLip = ellipsoid('upper-lip', WOOD_LIGHT, H * 0.04, H * 0.008, H * 0.01)
  upperLip.position.set(0, H * 0.01, H * 0.0045)
  mouth.add(upperLip)

  const jaw = new THREE.Group()
  jaw.name = 'jaw'
  const mouthCavity = ellipsoid('mouth-cavity', PUPIL_BROWN, H * 0.035, H * 0.0075, H * 0.01)
  mouthCavity.position.set(0, 0, -H * 0.0055)
  const lowerLip = ellipsoid('lower-lip', WOOD_LIGHT, H * 0.04, H * 0.008, H * 0.01)
  lowerLip.position.set(0, -H * 0.01, H * 0.0055)
  jaw.add(mouthCavity, lowerLip)
  mouth.add(jaw)
  group.add(mouth)

  return {
    group,
    leftEye,
    rightEye,
    eyeBaseScaleY,
    leftBrow,
    rightBrow,
    leftBrowBaseRotationZ: leftBrow.rotation.z,
    rightBrowBaseRotationZ: rightBrow.rotation.z,
    leftLid,
    rightLid,
    lidBaseScaleY,
    groupBaseRotationY: group.rotation.y,
    mouth,
    mouthBaseRotationZ: mouth.rotation.z,
    jaw,
    jawBasePositionY: jaw.position.y,
    jawBaseRotationX: jaw.rotation.x,
    mouthCavity,
    mouthCavityBaseScaleY: mouthCavity.scale.y,
    mouthOpenDistance: H * 0.025
  }
}

function buildLeg(name: string, side: -1 | 1, H: number): THREE.Group {
  const leg = new THREE.Group()
  leg.name = name
  const hip = new THREE.Vector3(side * H * 0.05, H * 0.28, 0)
  const knee = new THREE.Vector3(side * H * 0.062, H * 0.15, H * 0.006)
  const ankle = new THREE.Vector3(side * H * 0.05, H * 0.035, H * 0.015)
  leg.add(capsuleBetween(`${name}-thigh`, hip, knee, H * 0.015))
  leg.add(capsuleBetween(`${name}-shin`, knee, ankle, H * 0.015))
  return leg
}

function buildFoot(name: string, side: -1 | 1, H: number): THREE.Group {
  const foot = new THREE.Group()
  foot.name = name
  const sole = woodMesh(`${name}-sole`, new THREE.CapsuleGeometry(H * 0.012, H * 0.036, 4, 8), WOOD_MID)
  sole.rotation.x = Math.PI / 2
  sole.rotation.z = side * 0.08
  sole.position.set(side * H * 0.053, H * 0.012, H * 0.03)
  const toe = ellipsoid(`${name}-toe`, WOOD_LIGHT, H * 0.012, H * 0.007, H * 0.01)
  toe.position.set(side * H * 0.058, H * 0.012, H * 0.067)
  foot.add(sole, toe)
  return foot
}

function buildBat(H: number): THREE.Mesh {
  const profile = [
    new THREE.Vector2(H * 0.012, 0),
    new THREE.Vector2(H * 0.012, -H * 0.1),
    new THREE.Vector2(H * 0.021, -H * 0.14),
    new THREE.Vector2(H * 0.035, -H * 0.31),
    new THREE.Vector2(H * 0.03, -H * 0.38)
  ]
  return woodMesh('bat', new THREE.LatheGeometry(profile, 20), WOOD_DARK)
}

function buildArm(name: string, side: -1 | 1, H: number, holdsBat: boolean): THREE.Group {
  const arm = new THREE.Group()
  arm.name = name
  const shoulder = new THREE.Vector3()
  const elbow = new THREE.Vector3(side * H * 0.025, -H * 0.15, H * 0.005)
  const handPosition = new THREE.Vector3(side * H * 0.008, -H * 0.3, H * 0.025)
  arm.add(capsuleBetween(`${name}-upper`, shoulder, elbow, H * 0.012))
  arm.add(capsuleBetween(`${name}-forearm`, elbow, handPosition, H * 0.012))
  const hand = ellipsoid(`${name}-hand`, WOOD_LIGHT, H * 0.02, H * 0.02, H * 0.02)
  hand.position.copy(handPosition)
  arm.add(hand)

  if (holdsBat) {
    const bat = buildBat(H)
    bat.position.copy(handPosition)
    bat.rotation.z = THREE.MathUtils.degToRad(40)
    arm.add(bat)
  }

  return arm
}

export function setFaceMouthOpen(face: FaceParts, openAmount: number): void {
  const amount = THREE.MathUtils.clamp(openAmount, 0, 1)
  face.jaw.position.y = face.jawBasePositionY - face.mouthOpenDistance * amount
  face.jaw.rotation.x = face.jawBaseRotationX + THREE.MathUtils.degToRad(12) * amount
  face.mouthCavity.scale.y = face.mouthCavityBaseScaleY * THREE.MathUtils.lerp(1, 10 / 3, amount)
}

export function buildCharacterModel(params: ModelParams): CharacterParts {
  const H = params.proportions.bodyHeight / 0.72
  const root = new THREE.Group()
  root.name = 'sahur-model'

  root.add(makeWoodLog(H))
  const topRim = woodMesh('cut-top-rim', new THREE.TorusGeometry(H * 0.104, H * 0.006, 8, 32), WOOD_LIGHT)
  topRim.rotation.x = Math.PI / 2
  topRim.position.y = H * 0.994
  const topCut = woodMesh('cut-top', new THREE.CylinderGeometry(H * 0.106, H * 0.106, H * 0.008, 32), WOOD_LIGHT)
  topCut.position.y = H * 0.996
  root.add(topRim, topCut)

  root.add(buildLeg('left-leg', -1, H), buildLeg('right-leg', 1, H))
  root.add(buildFoot('left-foot', -1, H), buildFoot('right-foot', 1, H))

  const face = buildFace(H)
  root.add(face.group)

  const leftArm = buildArm('left-arm', -1, H, false)
  leftArm.position.set(-H * 0.132, H * 0.62, 0)
  const armPivot = buildArm('right-arm', 1, H, true)
  armPivot.position.set(H * 0.132, H * 0.62, 0)
  root.add(leftArm, armPivot)

  return {
    root,
    face,
    armPivot,
    armPivotRestRotationZ: -0.08,
    speakingYaw: 0,
    rootBasePositionY: root.position.y,
    rootBaseRotationZ: root.rotation.z,
    height: H
  }
}

// --- Tralala (three-legged shark in generic blue sneakers) -----------------
// Front-facing build for the frontal orthographic kiosk camera: the fusiform
// body runs along the z axis (snout toward the camera, tail behind), so the
// default posture is the head-on meme framing — round head, wide grin, two
// front legs bowed outward — and the long shark profile only reveals itself
// via speakingYaw when it talks. Sneakers stay unbranded
// (docs/project-requirements.md §5 — no brand marks, ever). Reuses the exact
// FaceParts contract so every expression/blink/talking behavior in index.ts
// drives this face unchanged. All rotating groups pivot at their own centers
// (the Sahur mouth-orbit lesson).

interface TralalaPalette {
  body: THREE.Color
  bodyDark: THREE.Color
  belly: THREE.Color
  sneaker: THREE.Color
  sole: THREE.Color
  dark: THREE.Color
  sclera: THREE.Color
}

function colorMesh(name: string, geometry: THREE.BufferGeometry, color: THREE.Color, roughness = 0.6): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }))
  mesh.name = name
  return mesh
}

function buildTralalaFace(H: number, p: TralalaPalette): FaceParts {
  const group = new THREE.Group()
  group.name = 'tralala-face'
  // Pivot at the head center so headTurn yaws the face in place.
  group.position.set(0, H * 0.34, H * 0.14)

  const eyeBaseScaleY = H * 0.024
  const leftEye = ellipsoid('left-eye-sclera', p.sclera, H * 0.024, eyeBaseScaleY, H * 0.016)
  leftEye.position.set(-H * 0.075, H * 0.06, H * 0.13)
  const rightEye = leftEye.clone()
  rightEye.name = 'right-eye-sclera'
  rightEye.position.x *= -1
  group.add(leftEye, rightEye)

  for (const [side, x] of [
    ['left', -H * 0.075],
    ['right', H * 0.075]
  ] as const) {
    const pupil = ellipsoid(`${side}-eye-pupil`, p.dark, H * 0.011, H * 0.013, H * 0.005)
    pupil.position.set(x, H * 0.06, H * 0.145)
    group.add(pupil)
  }

  const leftBrow = colorMesh('left-brow-ridge', new THREE.BoxGeometry(H * 0.055, H * 0.01, H * 0.01), p.bodyDark, 0.7)
  leftBrow.position.set(-H * 0.075, H * 0.098, H * 0.132)
  leftBrow.rotation.z = -0.12
  const rightBrow = leftBrow.clone()
  rightBrow.name = 'right-brow-ridge'
  rightBrow.position.x *= -1
  rightBrow.rotation.z *= -1
  group.add(leftBrow, rightBrow)

  const lidBaseScaleY = H * 0.007
  const leftLid = ellipsoid('left-upper-lid', p.body, H * 0.024, lidBaseScaleY, H * 0.007)
  leftLid.position.set(-H * 0.075, H * 0.078, H * 0.136)
  const rightLid = leftLid.clone()
  rightLid.name = 'right-upper-lid'
  rightLid.position.x *= -1
  group.add(leftLid, rightLid)

  // Wide under-snout grin; mouth + jaw pivot at the mouth center.
  const mouth = new THREE.Group()
  mouth.name = 'mouth'
  mouth.position.set(0, -H * 0.1, H * 0.13)
  const upperLip = ellipsoid('upper-lip', p.belly, H * 0.095, H * 0.011, H * 0.02)
  upperLip.position.set(0, H * 0.012, H * 0.004)
  mouth.add(upperLip)

  for (let i = 0; i < 5; i += 1) {
    const tooth = colorMesh(`tooth-${i + 1}`, new THREE.ConeGeometry(H * 0.007, H * 0.014, 4), p.sclera, 0.4)
    tooth.rotation.x = Math.PI
    tooth.position.set(-H * 0.06 + i * H * 0.03, H * 0.002, H * 0.01)
    mouth.add(tooth)
  }

  const jaw = new THREE.Group()
  jaw.name = 'jaw'
  const mouthCavity = ellipsoid('mouth-cavity', p.dark, H * 0.082, H * 0.013, H * 0.016)
  mouthCavity.position.set(0, -H * 0.007, -H * 0.004)
  const lowerLip = ellipsoid('lower-lip', p.belly, H * 0.088, H * 0.011, H * 0.018)
  lowerLip.position.set(0, -H * 0.018, H * 0.003)
  jaw.add(mouthCavity, lowerLip)
  mouth.add(jaw)
  group.add(mouth)

  return {
    group,
    leftEye,
    rightEye,
    eyeBaseScaleY,
    leftBrow,
    rightBrow,
    leftBrowBaseRotationZ: leftBrow.rotation.z,
    rightBrowBaseRotationZ: rightBrow.rotation.z,
    leftLid,
    rightLid,
    lidBaseScaleY,
    groupBaseRotationY: group.rotation.y,
    mouth,
    mouthBaseRotationZ: mouth.rotation.z,
    jaw,
    jawBasePositionY: jaw.position.y,
    jawBaseRotationX: jaw.rotation.x,
    mouthCavity,
    mouthCavityBaseScaleY: mouthCavity.scale.y,
    mouthOpenDistance: H * 0.045
  }
}

// Short, chunky leg bowing outward toward `side` (-1 left, 1 right, 0 rear),
// ending in a generic unbranded sneaker whose toe points at the camera.
// Pivot at the hip so the stomp animation swings the whole leg in place.
function buildSharkLeg(name: string, side: -1 | 0 | 1, H: number, p: TralalaPalette): THREE.Group {
  const leg = new THREE.Group()
  leg.name = name
  const hip = new THREE.Vector3(0, 0, 0)
  const knee = new THREE.Vector3(side * H * 0.05, -H * 0.105, H * 0.015)
  const ankle = new THREE.Vector3(side * H * 0.09, -H * 0.2, H * 0.02)
  leg.add(capsuleBetween(`${name}-thigh`, hip, knee, H * 0.04, p.body))
  leg.add(capsuleBetween(`${name}-shin`, knee, ankle, H * 0.034, p.body))

  const foot = new THREE.Group()
  foot.name = `${name}-foot`
  foot.position.copy(ankle)
  foot.rotation.y = side * 0.3
  const sole = colorMesh(`${name}-sneaker-sole`, new THREE.BoxGeometry(H * 0.075, H * 0.028, H * 0.165), p.sole, 0.35)
  sole.position.set(0, -H * 0.045, H * 0.03)
  const upper = ellipsoid(`${name}-sneaker-upper`, p.sneaker, H * 0.048, H * 0.042, H * 0.075)
  upper.position.set(0, -H * 0.018, H * 0.02)
  const toe = ellipsoid(`${name}-sneaker-toe`, p.sneaker, H * 0.034, H * 0.024, H * 0.045)
  toe.position.set(0, -H * 0.032, H * 0.095)
  foot.add(sole, upper, toe)
  leg.add(foot)
  return leg
}

export function buildTralalaModel(params: ModelParams): CharacterParts {
  const H = params.proportions.bodyHeight / 0.72
  const p: TralalaPalette = {
    body: new THREE.Color(params.colors.body),
    bodyDark: new THREE.Color(params.colors.mallet),
    belly: new THREE.Color(params.colors.face),
    sneaker: new THREE.Color(params.colors.foot),
    sole: new THREE.Color(params.colors.accent),
    dark: new THREE.Color(params.colors.eye),
    sclera: new THREE.Color('#f4f7f9')
  }

  const root = new THREE.Group()
  root.name = 'tralala-model'

  // One fusiform body along z: overlapping same-color segments read as a
  // single continuous shark from snout to caudal peduncle.
  const head = ellipsoid('shark-body', p.body, H * 0.155, H * 0.125, H * 0.19)
  head.position.set(0, H * 0.34, H * 0.12)
  const snout = ellipsoid('shark-snout', p.body, H * 0.085, H * 0.055, H * 0.06)
  snout.position.set(0, H * 0.33, H * 0.26)
  const mid = ellipsoid('shark-mid', p.body, H * 0.14, H * 0.115, H * 0.2)
  mid.position.set(0, H * 0.37, -H * 0.1)
  const rear = ellipsoid('shark-rear', p.body, H * 0.095, H * 0.08, H * 0.16)
  rear.position.set(0, H * 0.41, -H * 0.3)
  const peduncle = ellipsoid('shark-peduncle', p.body, H * 0.045, H * 0.042, H * 0.09)
  peduncle.position.set(0, H * 0.44, -H * 0.44)
  root.add(head, snout, mid, rear, peduncle)

  const belly = ellipsoid('shark-belly', p.belly, H * 0.125, H * 0.095, H * 0.185)
  belly.position.set(0, H * 0.27, H * 0.08)
  root.add(belly)

  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const gill = colorMesh(
        `gill-${side === -1 ? 'left' : 'right'}-${i + 1}`,
        new THREE.BoxGeometry(H * 0.006, H * 0.05, H * 0.018),
        p.dark,
        0.7
      )
      gill.position.set(side * H * 0.148, H * 0.37, H * (0.06 - i * 0.04))
      root.add(gill)
    }
  }

  // Tall swept-back dorsal fin; a small second dorsal near the tail.
  const dorsal = colorMesh('dorsal-fin', new THREE.ConeGeometry(H * 0.085, H * 0.24, 6), p.bodyDark)
  dorsal.scale.x = 0.22
  dorsal.position.set(0, H * 0.62, -H * 0.06)
  dorsal.rotation.x = -0.38
  const secondDorsal = colorMesh('second-dorsal-fin', new THREE.ConeGeometry(H * 0.035, H * 0.09, 6), p.bodyDark)
  secondDorsal.scale.x = 0.25
  secondDorsal.position.set(0, H * 0.51, -H * 0.34)
  secondDorsal.rotation.x = -0.45
  root.add(dorsal, secondDorsal)

  // Single vertical crescent tail fin at the back.
  const tail = new THREE.Group()
  tail.name = 'tail-fin'
  tail.position.set(0, H * 0.45, -H * 0.5)
  const upperLobe = ellipsoid('tail-upper-lobe', p.bodyDark, H * 0.014, H * 0.15, H * 0.045)
  upperLobe.position.set(0, H * 0.1, -H * 0.03)
  upperLobe.rotation.x = -0.35
  const lowerLobe = ellipsoid('tail-lower-lobe', p.bodyDark, H * 0.012, H * 0.095, H * 0.035)
  lowerLobe.position.set(0, -H * 0.065, -H * 0.02)
  lowerLobe.rotation.x = 0.35
  tail.add(upperLobe, lowerLobe)
  root.add(tail)

  const face = buildTralalaFace(H, p)
  root.add(face.group)

  const rightFrontLeg = buildSharkLeg('front-leg', 1, H, p)
  rightFrontLeg.position.set(H * 0.07, H * 0.28, H * 0.1)
  const leftFrontLeg = buildSharkLeg('mid-leg', -1, H, p)
  leftFrontLeg.position.set(-H * 0.07, H * 0.28, H * 0.1)
  const backLeg = buildSharkLeg('back-leg', 0, H, p)
  backLeg.position.set(0, H * 0.29, -H * 0.28)
  root.add(rightFrontLeg, leftFrontLeg, backLeg)

  return {
    root,
    face,
    armPivot: rightFrontLeg,
    armPivotRestRotationZ: 0,
    speakingYaw: 0.75,
    rootBasePositionY: root.position.y,
    rootBaseRotationZ: root.rotation.z,
    height: H
  }
}
