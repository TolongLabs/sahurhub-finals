import { type CharacterDef, type CharacterModel, mount } from './model/index.ts'

export type KioskRenderer = Pick<
  CharacterModel,
  'setExpression' | 'setMouth' | 'playAction' | 'setSpeaking' | 'dispose'
>

export function mountRenderer(stage: HTMLElement, character: CharacterDef): KioskRenderer {
  return mount(stage, character)
}
