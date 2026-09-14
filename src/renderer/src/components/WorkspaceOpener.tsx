import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import meloIcon from '../../../../resources/icon.png'

/* ============================================================
   WorkspaceOpener — shown before a workspace or standalone file is open.
   Workspace is the recommended, full-product path; a single file is the
   lightweight path for a quick read or edit.
   ============================================================ */

export const WorkspaceOpener = ({
  onOpenWorkspace,
  onOpenFile,
}: {
  onOpenWorkspace: () => void
  onOpenFile: () => void
}) => {
  const { t } = useTranslation()

  return (
    <div className="ws-opener">
      <main className="ws-opener-welcome" aria-labelledby="ws-opener-title">
        <div className="ws-opener-brand">
          <img src={meloIcon} alt="" aria-hidden="true" />
        </div>

        <h1 id="ws-opener-title">{t('opener.headline')}</h1>
        <p className="ws-opener-lead">{t('opener.intro')}</p>

        <section className="ws-opener-folder-stage" aria-labelledby="ws-opener-folder-title">
          <div className="ws-opener-folder-back" aria-hidden="true" />
          <div className="ws-opener-folder-tab" aria-hidden="true">
            {t('opener.workspaceTab')}
          </div>
          <div className="ws-opener-paper" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          <div className="ws-opener-folder-front">
            <span className="ws-opener-folder-icon" aria-hidden="true">
              <Icon name="folderOpen" size={24} />
            </span>
            <div className="ws-opener-folder-copy">
              <h2 id="ws-opener-folder-title">{t('opener.workspaceTitle')}</h2>
              <p>{t('opener.workspaceDesc')}</p>
            </div>
            <button
              type="button"
              className="ws-opener-primary"
              onClick={onOpenWorkspace}
            >
              {t('opener.openWorkspace')}
            </button>
          </div>
        </section>

        <div className="ws-opener-below-actions">
          <button
            type="button"
            className="ws-opener-secondary"
            onClick={onOpenFile}
          >
            {t('opener.openFile')}
          </button>
        </div>

        <span className="ws-opener-hint">
          <Icon name="lock" size={16} aria-hidden="true" />
          {t('opener.hint')}
        </span>
      </main>
    </div>
  )
}
