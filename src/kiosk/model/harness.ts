// Standalone dev harness (docs/plan.md T9a deliverable 5): mounts the Sahur
// model at 480x320 and wires expression/action buttons + a mouth slider so
// the renderer can be exercised (and screenshotted) without the kiosk page
// or a live WS connection. Built via `bun build` (see harness.html for the
// exact command) — not part of the kiosk runtime.

import { mount, validateCharacterDef } from './index.ts'

async function main(): Promise<void> {
  const stage = document.getElementById('stage')
  const status = document.getElementById('status')
  if (!(stage instanceof HTMLElement) || !(status instanceof HTMLElement)) throw new Error('harness DOM not found')

  const response = await fetch('/characters/sahur/character.json')
  const raw: unknown = await response.json()
  const characterDef = validateCharacterDef(raw)

  const model = mount(stage, characterDef)
  status.textContent = `mounted ${characterDef.displayName}`

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-expression]')) {
    button.addEventListener('click', () => {
      const name = button.dataset.expression ?? ''
      model.setExpression(name)
      status.textContent = `expression: ${name}`
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    button.addEventListener('click', () => {
      const name = button.dataset.action ?? ''
      const intensity = Number(button.dataset.intensity ?? '1')
      model.playAction(name, intensity)
      status.textContent = `action: ${name} (tier ${intensity})`
    })
  }

  const mouthSlider = document.getElementById('mouth')
  if (mouthSlider instanceof HTMLInputElement) {
    mouthSlider.addEventListener('input', () => {
      model.setMouth(Number(mouthSlider.value) / 100)
    })
  }

  const speakingToggle = document.getElementById('speaking')
  if (speakingToggle instanceof HTMLInputElement) {
    speakingToggle.addEventListener('change', () => {
      model.setSpeaking(speakingToggle.checked)
    })
  }
}

main().catch((error: unknown) => {
  const status = document.getElementById('status')
  const message = error instanceof Error ? error.message : String(error)
  if (status) status.textContent = `error: ${message}`
  console.error(error)
})
