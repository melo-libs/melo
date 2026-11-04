import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentOperation, OrganizationEdits, OrganizationFact } from '@shared/agentCapabilities'
import { Button } from '../ui/Button'
import { Icon } from '../Icon'
import { AgentAttachmentVisual } from './AgentAttachmentVisual'
import { OrganizationFolderPicker } from './OrganizationFolderPicker'
import {
  organizationFolders,
  renamePlannedFolder,
  validOrganizationName,
} from './organizationFolders'

type Organization = Extract<AgentOperation, { kind: 'organize' }>
const folderOf = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '')
const nameOf = (file: string) => file.split('/').pop()!
const extensionOf = (file: string) => /\.[^.]+$/.exec(nameOf(file))?.[0] ?? ''
const stemOf = (file: string) =>
  nameOf(file).slice(0, nameOf(file).length - extensionOf(file).length)

function FileFacts({ facts }: { facts: OrganizationFact[] }) {
  const { t } = useTranslation()
  return (
    <dl className="agent-organization-facts">
      {facts.map((fact, index) => (
        <div key={index}>
          <dt>
            {fact.label}
            {fact.source !== 'content' && (
              <span>{t(`agent.organization.factSource.${fact.source}`)}</span>
            )}
          </dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function AgentOrganization({
  operation,
  pending,
  busy,
  workspaceRoot,
  onRespond,
  onDescribe,
}: {
  operation: Organization
  pending: boolean
  busy: boolean
  workspaceRoot?: string
  onRespond(allow: boolean, run?: boolean, edits?: OrganizationEdits): void
  onDescribe?(name: string): void
}) {
  const { t } = useTranslation()
  const formId = useId()
  const [destinations, setDestinations] = useState(
    () => new Map(operation.files.map((file) => [file.id, file.destination])),
  )
  const [names, setNames] = useState(
    () =>
      new Map(operation.files.map((file) => [file.id, stemOf(file.destination ?? file.source)])),
  )
  const [includeNote, setIncludeNote] = useState(false)
  const files = operation.files.map((file) => ({
    ...file,
    destination: pending ? destinations.get(file.id)! : file.destination,
  }))
  const unread = files.filter((file) => !file.readable && !file.described && !file.destination)
  const needsDescription = unread.length === files.length && !operation.note
  const folders = organizationFolders(
    operation.locations,
    files.map((file) => file.destination),
  )
  const editable = files.filter((file) => !unread.includes(file))
  const validNames = editable.every((file) => validOrganizationName(names.get(file.id)!))
  const targets = files.flatMap((file) => (file.destination ? [file.destination] : []))
  const duplicate = new Set(targets).size !== targets.length
  const update = (id: string, path: string) =>
    setDestinations((current) => new Map(current).set(id, path))
  return (
    <div className="agent-organization">
      <div className="agent-card-heading">
        <strong>
          {t(
            needsDescription ? 'agent.organization.needsDescription' : 'agent.organization.title',
            { count: files.length },
          )}
        </strong>
        <span>
          {t(needsDescription ? 'agent.organization.stayInbox' : 'agent.organization.fromInbox')}
        </span>
      </div>
      {unread.map((file) => (
        <div className="agent-organization-unread" key={file.id}>
          <AgentAttachmentVisual file={file} workspaceRoot={workspaceRoot} />
          <div>
            <strong title={file.name}>{file.name}</strong>
            <p>{file.detail || t('agent.organization.unread')}</p>
            {!!file.facts?.length && <FileFacts facts={file.facts} />}
          </div>
          {pending && (
            <Button size="small" disabled={busy} onClick={() => onDescribe?.(file.name)}>
              {t('agent.organization.describe')}
            </Button>
          )}
        </div>
      ))}
      {editable.map((file) => {
        const destination = file.destination ?? file.source
        const folder = folderOf(destination)
        const name = pending ? names.get(file.id)! : stemOf(destination)
        const nameValid = validOrganizationName(name)
        const fieldId = `${formId}-${file.id}`
        return (
          <section className="agent-organization-item" key={file.id} aria-label={file.name}>
            <div className="agent-organization-file">
              <AgentAttachmentVisual file={file} workspaceRoot={workspaceRoot} />
              <div>
                <span className="agent-organization-original-name">{file.name}</span>
                {!!file.detail && (
                  <strong className="agent-organization-detail">
                    {file.described
                      ? t('agent.organization.userDescription', { detail: file.detail })
                      : file.detail}
                  </strong>
                )}
                {!!file.facts?.length && <FileFacts facts={file.facts} />}
              </div>
            </div>
            <div className="agent-organization-controls">
              <label htmlFor={fieldId}>{t('agent.organization.renameTo')}</label>
              <div className="agent-organization-name-field" data-invalid={!nameValid || undefined}>
                <input
                  id={fieldId}
                  aria-label={`${t('agent.organization.rename')}: ${file.name}`}
                  className="agent-organization-name"
                  value={name}
                  title={name + extensionOf(file.source)}
                  disabled={!pending || busy}
                  aria-invalid={!nameValid}
                  onChange={(event) => {
                    const value = event.target.value
                    setNames((current) => new Map(current).set(file.id, value))
                    if (validOrganizationName(value))
                      update(
                        file.id,
                        [folder, value.trim() + extensionOf(file.source)].filter(Boolean).join('/'),
                      )
                  }}
                  onBlur={() => setNames((current) => new Map(current).set(file.id, name.trim()))}
                  maxLength={200}
                />
                <span className="agent-organization-extension">{extensionOf(file.source)}</span>
                <Icon name="pencil" size={14} />
              </div>
              {!nameValid && (
                <small className="agent-organization-field-error">
                  {t('agent.organization.invalidName')}
                </small>
              )}
              <span>{t('agent.organization.moveTo')}</span>
              <OrganizationFolderPicker
                folder={folder}
                folders={folders}
                locations={operation.locations}
                disabled={!pending || busy}
                onChange={(folder) =>
                  update(file.id, [folder, nameOf(destination)].filter(Boolean).join('/'))
                }
                onRename={(folder, name) =>
                  setDestinations((current) => renamePlannedFolder(current, folder, name))
                }
              />
            </div>
          </section>
        )
      })}
      {duplicate && (
        <p className="agent-organization-field-error" role="alert">
          {t('agent.organization.duplicateName')}
        </p>
      )}
      {operation.note && (
        <div className="agent-organization-note">
          <label>
            <input
              type="checkbox"
              checked={pending ? includeNote : operation.includeNote}
              disabled={!pending || busy}
              onChange={(event) => setIncludeNote(event.target.checked)}
            />
            {t('agent.organization.addToNote', { name: stemOf(operation.note.path) })}
          </label>
          <details>
            <summary>{t('agent.organization.notePreview')}</summary>
            <p>{operation.note.content}</p>
          </details>
        </div>
      )}
      {pending && (
        <div className="agent-card-actions">
          {!needsDescription && (
            <Button
              className="agent-primary"
              disabled={
                busy ||
                !validNames ||
                duplicate ||
                (!files.some((file) => file.destination && file.destination !== file.source) &&
                  !includeNote)
              }
              onClick={() =>
                onRespond(true, false, {
                  destinations: files.map((file) => ({ id: file.id, path: file.destination })),
                  includeNote,
                })
              }
            >
              {t('agent.organization.apply')}
            </Button>
          )}
          <Button className="agent-secondary" disabled={busy} onClick={() => onRespond(false)}>
            {t('agent.organization.keepInbox')}
          </Button>
        </div>
      )}
    </div>
  )
}
