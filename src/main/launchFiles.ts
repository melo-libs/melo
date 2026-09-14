import path from 'node:path'
import { isTextDocumentPath } from '../shared/fileKinds'

/** Extract user-requested documents from Electron's platform-specific argv. */
export function launchFilePaths(argv: readonly string[], workingDirectory: string): string[] {
  const paths = argv
    .filter((argument) => !argument.startsWith('-') && isTextDocumentPath(argument))
    .map((argument) =>
      path.normalize(
        path.isAbsolute(argument) ? argument : path.resolve(workingDirectory, argument),
      ),
    )

  return [...new Set(paths)]
}
