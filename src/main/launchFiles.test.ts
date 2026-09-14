import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchFilePaths } from './launchFiles'

describe('launchFilePaths', () => {
  it('extracts supported documents and resolves relative paths', () => {
    expect(
      launchFilePaths(
        ['/Applications/Melo.app/Contents/MacOS/Melo', '--flag', 'Notes/One.md', 'Two.MARKDOWN'],
        '/Users/me',
      ),
    ).toEqual([path.normalize('/Users/me/Notes/One.md'), path.normalize('/Users/me/Two.MARKDOWN')])
  })

  it('ignores unsupported arguments and removes duplicates', () => {
    expect(launchFilePaths(['note.pdf', 'note.md', 'note.md', '.'], '/workspace')).toEqual([
      path.normalize('/workspace/note.md'),
    ])
  })
})
