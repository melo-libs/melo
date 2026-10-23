import { describe, expect, it } from 'vitest'
import { en } from '@shared/locales/en'
import { zhCN } from '@shared/locales/zh-CN'
import { nextTourStep, previousTourStep, TOUR_FEATURES, TOUR_PAGES, TOUR_STEPS } from './tour'

describe('the CODE welcome tour', () => {
  it('visits CODE and file management before the real folder entry', () => {
    let step = TOUR_STEPS[0]
    const visited = [step]
    for (let index = 1; index < TOUR_STEPS.length; index += 1) {
      step = nextTourStep(step)
      visited.push(step)
    }
    expect(visited).toEqual([
      'welcome',
      'collect',
      'organize',
      'distill',
      'express',
      'files',
      'start',
    ])
    expect(nextTourStep('start')).toBe('start')
  })
  it('allows going back without wrapping to a different screen', () => {
    expect(previousTourStep('welcome')).toBe('welcome')
    expect(previousTourStep('collect')).toBe('welcome')
    expect(previousTourStep('start')).toBe('files')
    expect(previousTourStep('files')).toBe('express')
    expect(TOUR_FEATURES.map((feature) => feature.letter).join('')).toBe('CODE')
  })
  for (const [language, copy] of [
    ['en', en.onboarding],
    ['zh-CN', zhCN.onboarding],
  ] as const) {
    it(`provides welcome and feature copy in ${language}`, () => {
      expect(copy.welcomeTitle.trim()).not.toBe('')
      expect(copy.welcomeDescription.trim()).not.toBe('')
      for (const { id } of TOUR_PAGES) {
        expect(copy.features[id].title.trim()).not.toBe('')
        expect(copy.features[id].description.trim()).not.toBe('')
        expect(copy.features[id].label.trim()).not.toBe('')
      }
      for (const id of ['collect', 'express'] as const) {
        expect(copy.features[id].result.trim()).not.toBe('')
      }
    })
  }
})
