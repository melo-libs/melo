export const TOUR_FEATURES = [
  { id: 'collect', letter: 'C', english: 'Collect' },
  { id: 'organize', letter: 'O', english: 'Organize' },
  { id: 'distill', letter: 'D', english: 'Distill' },
  { id: 'express', letter: 'E', english: 'Express' },
] as const

export type TourFeature = (typeof TOUR_FEATURES)[number]['id']
export type TourStep = 'welcome' | TourFeature | 'start'
export const TOUR_COMPLETED_KEY = 'melo.onboarding.completed'
export const TOUR_STEPS: readonly TourStep[] = [
  'welcome',
  ...TOUR_FEATURES.map((feature) => feature.id),
  'start',
]

export function nextTourStep(step: TourStep): TourStep {
  return TOUR_STEPS[Math.min(TOUR_STEPS.indexOf(step) + 1, TOUR_STEPS.length - 1)]
}

export function previousTourStep(step: TourStep): TourStep {
  return TOUR_STEPS[Math.max(TOUR_STEPS.indexOf(step) - 1, 0)]
}
