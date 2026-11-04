import { lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { AgentOperation, OrganizationProposal } from '../../../shared/agentCapabilities'
import { isMarkdownPath } from '../../../shared/fileKinds'
import { renameFile } from '../../api/fileOperations/fileOperations'
import type { RuntimeRequest } from '../agentTypes'
import { FileIntake, fileFingerprint } from '../storage/fileIntake'
import type { ChangeJournal } from './changeJournal'
import type { WorkspaceDocumentAccess } from './workspaceTypes'

type Organization = Extract<AgentOperation, { kind: 'organize' }>
type Result = { files: { id: string; path: string }[] }

/** Review one plan, then execute its approved values through the normal journal. */
export async function organizeFiles({
  intake,
  documents,
  journal,
  request,
  proposal,
  assertActive,
  review,
}: {
  intake: FileIntake
  documents: WorkspaceDocumentAccess
  journal: ChangeJournal
  request: RuntimeRequest
  proposal: OrganizationProposal
  assertActive(): void
  review(operation: Organization, apply: () => Promise<Result>): Promise<Result>
}): Promise<Result> {
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
  const files = proposal.files.map((file) => {
    const attachment = intake.get(root, file.id)
    if (!attachment.path) throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    const readable = file.reading === 'read'
    const described = file.reading === 'user-described'
    return {
      ...attachment,
      source: attachment.path,
      destination: readable || described ? file.destination : null,
      readable,
      ...(described ? { described: true } : {}),
      detail: file.detail,
      facts: file.facts ?? [],
    }
  })
  if (new Set(files.map((file) => file.id)).size !== files.length)
    throw new Error('Duplicate attachment in organization plan')
  const versions = new Map<string, string>()
  for (const file of files)
    versions.set(file.id, await fileFingerprint(await target(file.source, true)))

  const validate = async (items: Organization['files']) => {
    const destinations = new Set<string>(),
      folders = new Set<string>()
    for (const file of items) {
      if (!file.destination || file.destination === file.source) continue
      if (path.extname(file.destination).toLowerCase() !== path.extname(file.source).toLowerCase())
        throw new Error('Keep the original file extension')
      const destination = await target(file.destination)
      if (destinations.has(destination))
        throw new Error('Duplicate destination in organization plan')
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
  let note: Organization['note']
  if (proposal.note) {
    if (
      !isMarkdownPath(proposal.note.path) ||
      files.some((file) => file.source === proposal.note!.path)
    )
      throw new Error('Choose an existing related Markdown note')
    const before = await documents.read(await target(proposal.note.path, true))
    note = { ...proposal.note, revision: before.revision }
  }
  const operation: Organization = {
    kind: 'organize',
    files,
    folders: await validate(files),
    locations: [''],
    note,
    includeNote: false,
  }
  for (let index = 0; index < operation.locations.length; index++) {
    assertActive()
    for (const entry of await readdir(path.join(root, operation.locations[index]), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && !entry.name.startsWith('.'))
        operation.locations.push(path.join(operation.locations[index], entry.name))
    }
  }
  assertActive()
  return review(operation, async () => {
    // Approval edits destinations in place. Validate every approved value before any write.
    const folders = await validate(operation.files)
    for (const file of operation.files) {
      if (
        intake.get(root, file.id).path !== file.source ||
        (await fileFingerprint(await target(file.source, true))) !== versions.get(file.id)
      )
        throw new Error('AGENT_UNDO_CONFLICT')
    }
    const before =
      operation.includeNote && note
        ? await documents.read(await target(note.path, true))
        : undefined
    if (before && before.revision !== note!.revision)
      throw new Error('Document changed; read again')
    return journal.filing(
      request.conversation,
      operation.files.filter((file) => file.destination && file.destination !== file.source).length,
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
        for (const file of operation.files) {
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
        if (before && note) {
          assertActive()
          const content = `${before.content.trimEnd()}\n\n${note.content}\n`
          const applied = await journal.apply(
            request.conversation,
            { kind: 'edit', path: note.path, batchId },
            () => documents.edit(path.join(root, note.path), before.revision, content),
            before,
            (snapshot) => snapshot.revision,
          )
          request.onEvent({ type: 'change', change: applied.change })
        }
        return result
      },
    )
  })
}
