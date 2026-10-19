import { useTranslation } from 'react-i18next'
import { Icon } from '../Icon'
import { SIcon } from '../smart/SmartIcon'

function SearchMatch({ text, query }: { text: string; query: string }) {
  const start = text.toLowerCase().indexOf(query.toLowerCase())
  if (start === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + query.length)}</mark>
      {text.slice(start + query.length)}
    </>
  )
}

export function OrganizeArtwork({ modifier }: { modifier: string }) {
  const { t } = useTranslation()
  const query = t('onboarding.demo.organize.searchQuery')
  const files = [
    {
      folder: t('onboarding.demo.organize.technology'),
      title: t('onboarding.demo.articleTitle'),
      excerpt: t('onboarding.demo.articleExcerpt'),
    },
    {
      folder: t('onboarding.demo.organize.life'),
      title: t('onboarding.demo.organize.campingNote'),
      excerpt: t('onboarding.demo.organize.campingExcerpt'),
    },
  ]
  const views = [
    { id: 'today', icon: 'calendar', count: 3 },
    { id: 'topic', icon: 'tag', count: 2 },
  ] as const

  // Keep the organization context visible behind a completed search. No timed
  // reveal is needed to understand title matches, body matches, or file paths.
  return (
    <div className="ob-art-scene ob-organize-art">
      <div className="ob-organize-workspace">
        <header className="ob-organize-root">
          <Icon name="folderOpen" size={22} />
          <strong>{t('onboarding.demo.organize.workspace')}</strong>
        </header>
        <section className="ob-organize-files" data-capability="folders">
          <h3>{t('onboarding.demo.organize.folders')}</h3>
          <div className="ob-organize-tree">
            {files.map(({ folder, title }) => (
              <div className="ob-organize-directory" key={folder}>
                <div className="ob-organize-folder">
                  <Icon name="chev" size={12} />
                  <Icon name="folderOpen" size={18} />
                  <strong>{folder}</strong>
                </div>
                <div className="ob-organize-children">
                  <div className="ob-organize-file">
                    <Icon name="fileMd" size={16} />
                    <span>{title}.md</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="ob-organize-views" data-capability="smart">
          <h3>{t('sidebar.smartFolders')}</h3>
          <div className="ob-organize-view-list">
            {views.map(({ id, icon, count }) => (
              <div className={`ob-organize-view ob-organize-view-${id}`} data-view={id} key={id}>
                <SIcon n={icon} s={18} />
                <div className="ob-organize-view-text">
                  <strong>{t(`onboarding.demo.organize.${id}`)}</strong>
                  <p className="ob-organize-rule">{t(`onboarding.demo.organize.${id}Rule`)}</p>
                </div>
                <span className="ob-organize-count">{count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="ob-organize-search" data-capability="search">
        <div className="ob-organize-palette">
          <div className="ob-organize-query">
            <Icon name="search" size={20} />
            <span>{query}</span>
            <kbd>{modifier}K</kbd>
          </div>
          <div className="ob-organize-results">
            {files.map(({ folder, title, excerpt }, index) => (
              <div
                className="ob-organize-result"
                data-selected={index === 0}
                data-result-path={`${folder}/${title}.md`}
                key={title}
              >
                <Icon name="fileMd" size={20} />
                <div className="ob-organize-result-text">
                  <strong className="ob-organize-result-title">
                    <SearchMatch text={title} query={query} />
                  </strong>
                  <span className="ob-organize-result-path">
                    {folder}/{title}.md
                  </span>
                  <p className="ob-organize-result-excerpt">
                    <SearchMatch text={excerpt} query={query} />
                  </p>
                </div>
              </div>
            ))}
          </div>
          <footer className="ob-organize-search-summary">
            <span>{t('onboarding.demo.organize.searchHint')}</span>
            <span>{t('search.resultCount', { count: files.length })}</span>
          </footer>
        </div>
      </section>
    </div>
  )
}
