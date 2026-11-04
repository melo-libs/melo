import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { OrganizationRequest } from '../../../shared/agentCapabilities'
import { renameFile } from '../../api/fileOperations/fileOperations'
import type { RuntimeRequest } from '../agentTypes'
import { FileIntake, fileFingerprint } from '../storage/fileIntake'
import type { ChangeJournal } from './changeJournal'
import type { WorkspaceDocumentAccess } from './workspaceTypes'

type Result = { files: { id: string; path: string }[] }

/** Execute conversationally agreed destinations through the workspace journal. */
export async function organizeFiles({
  intake,
  documents,
  journal,
  request,
  organization,
  assertActive,
}: {
  intake: FileIntake
  documents: WorkspaceDocumentAccess
  journal: ChangeJournal
  request: RuntimeRequest
  organization: OrganizationRequest
  assertActive(): void
}): Promise<Result> {
  assertActive()
  journal.reconcileAttachments()
  const root = request.conversation.workspaceRoot
  const target = async (relative: string, existing = false): Promise<string> => {
    if (
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((part) => !part || part.startsWith('.'))
    )
      throw new Error('Use a visible workspace-relative path')
    const file = path.join(root, relative)
    let cursor = root
    for (const part of relative.split('/')) {
      cursor = path.join(cursor, part)
      try {
        if ((await realpath(cursor)) !== cursor)
          throw new Error('Organization does not follow symbolic links')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || existing) throw error
        break
      }
    }
    return file
  }
  const files = organization.files.map((file) => {
    const attachment = intake.get(root, file.id)
    if (!attachment.path) throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    return {
      id: file.id,
      source: attachment.path,
      destination: file.reading === 'unread' ? null : file.destination,
    }
  })
  if (new Set(files.map((file) => file.id)).size !== files.length)
    throw new Error('Duplicate attachment in organization request')
  const versions = new Map<string, string>()
  for (const file of files)
    versions.set(file.id, await fileFingerprint(await target(file.source, true)))

  const validate = async () => {
    const destinations = new Set<string>(),
      folders = new Set<string>()
    for (const file of files) {
      if (!file.destination || file.destination === file.source) continue
      if (path.extname(file.destination).toLowerCase() !== path.extname(file.source).toLowerCase())
        throw new Error('Keep the original file extension')
      const destination = await target(file.destination)
      if (destinations.has(destination))
        throw new Error('Duplicate destination in organization request')
      destinations.add(destination)
      try {
        await lstat(destination)
        throw new Error('AGENT_ATTACHMENT_NAME_CONFLICT')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      let parent = path.dirname(file.destination)
      while (parent !== '.') {
        const directory = await target(parent)
        try {
          if (!(await lstat(directory)).isDirectory())
            throw new Error('Destination parent is not a folder')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          folders.add(parent)
        }
        parent = path.dirname(parent)
      }
    }
    if ([...folders].some((folder) => destinations.has(path.join(root, folder))))
      throw new Error('A file destination conflicts with a folder')
    return [...folders].sort((a, b) => a.split('/').length - b.split('/').length)
  }
  const folders = await validate()
  assertActive()
  for (const file of files) {
    if (
      intake.get(root, file.id).path !== file.source ||
      (await fileFingerprint(await target(file.source, true))) !== versions.get(file.id)
    )
      throw new Error('AGENT_UNDO_CONFLICT')
  }
  if (!files.some((file) => file.destination && file.destination !== file.source))
    return { files: files.map((file) => ({ id: file.id, path: file.source })) }
  return journal.filing(
    request.conversation,
    files.filter((file) => file.destination && file.destination !== file.source).length,
    (batchId) => request.onEvent({ type: 'filing', batchId }),
    async (batchId) => {
      for (const folder of folders) {
        assertActive()
        const applied = await journal.apply(
          request.conversation,
          { kind: 'create-folder', path: folder, batchId },
          () => mkdir(path.join(root, folder)),
        )
        request.onEvent({ type: 'change', change: applied.change })
      }
      const result: Result = { files: [] }
      for (const file of files) {
        const destination = file.destination ?? file.source
        if (destination !== file.source) {
          const from = await target(file.source, true),
            to = await target(destination)
          await documents.fileOperation(from, async () => {
            assertActive()
            if ((await fileFingerprint(from)) !== versions.get(file.id))
              throw new Error('AGENT_UNDO_CONFLICT')
            const applied = await journal.apply(
              request.conversation,
              { kind: 'move', source: file.source, path: destination, batchId },
              () => renameFile(from, to),
            )
            request.onEvent({ type: 'change', change: applied.change })
          })
        }
        result.files.push({ id: file.id, path: destination })
      }
      return result
    },
  )
}
