import { expect, it } from 'vitest'
import { runtimeOutput } from './runtimeOutput'

it('redacts API keys even when split across streaming chunks', () => {
  for (let split = 0; split <= 'private-key'.length; split++) {
    const output = runtimeOutput('private-key')
    const value =
      output.push(`Error: ${'private-key'.slice(0, split)}`) +
      output.push(`${'private-key'.slice(split)} refused`) +
      output.flush()
    expect(value).toBe('Error: [redacted] refused')
  }
})
it('preserves normal output and handles repeated credentials', () => {
  const output = runtimeOutput('secret')
  expect(output.push('secret secret file') + output.flush()).toBe('[redacted] [redacted] file')
  expect(output.push('Those papers') + output.flush()).toBe('Those papers')
})
