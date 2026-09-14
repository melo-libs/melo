import type { IconName } from '../Icon'
import type { BlockType } from './sampleDoc'
import i18n from '../../i18n'

/* ============================================================
   Static data for the editor overlays: slash command list,
   bubble "turn into" options, highlight palettes.
   Toggle / callout intentionally omitted (unsupported).
   ============================================================ */

export interface SlashItem {
  id: string
  name: string
  /** Not displayed since the single-line redesign, but still matched by the
   *  filter alongside name/keywords. */
  desc: string
  /** Row face — same rule as FORMAT_OPTIONS: textual blocks show a text
   *  face (sample), structural blocks an icon. Exactly one is set. */
  icon?: IconName
  sample?: string
  short?: string
  /** Extra search aliases — matched alongside name/desc when filtering. */
  keywords?: string[]
}

export interface SlashSection {
  section: string
  items: SlashItem[]
}

export const SLASH_COMMANDS: SlashSection[] = [
  {
    section: 'Basic',
    items: [
      {
        id: 'text',
        name: 'Text',
        desc: 'Just start writing with plain text',
        sample: 'Aa',
        keywords: ['paragraph', 'plain', 'body'],
      },
      {
        id: 'h1',
        name: 'Heading 1',
        desc: 'Big section heading',
        sample: 'H1',
        short: '#',
        keywords: ['heading', 'title', 'h1'],
      },
      {
        id: 'h2',
        name: 'Heading 2',
        desc: 'Medium section heading',
        sample: 'H2',
        short: '##',
        keywords: ['heading', 'subtitle', 'h2'],
      },
      {
        id: 'h3',
        name: 'Heading 3',
        desc: 'Small section heading',
        sample: 'H3',
        short: '###',
        keywords: ['heading', 'subheading', 'h3'],
      },
      {
        id: 'bullet',
        name: 'Bullet list',
        desc: 'Simple bulleted list',
        icon: 'list',
        short: '-',
        keywords: ['unordered', 'ul', 'list'],
      },
      {
        id: 'num',
        name: 'Numbered list',
        desc: 'Ordered list with numbers',
        icon: 'listOl',
        short: '1.',
        keywords: ['ordered', 'ol', 'list'],
      },
      {
        id: 'task',
        name: 'To-do',
        desc: 'Checkable to-do items',
        icon: 'task',
        short: '[]',
        keywords: ['todo', 'checkbox', 'checklist', 'task'],
      },
      {
        id: 'quote',
        name: 'Quote',
        desc: 'Capture a quote or reference',
        icon: 'quote',
        short: '"',
        keywords: ['blockquote', 'citation'],
      },
      {
        id: 'code',
        name: 'Code block',
        desc: 'Syntax-highlighted code block',
        icon: 'codeBlock',
        short: '```',
        keywords: ['codeblock', 'snippet', 'pre'],
      },
    ],
  },
  {
    section: 'Insert',
    items: [
      {
        id: 'link',
        name: 'Link to note',
        desc: 'Search your workspace and insert a [[wikilink]]',
        icon: 'bracketLink',
        short: '[[',
        keywords: ['wikilink', 'note', 'reference', 'mention'],
      },
      {
        id: 'image',
        name: 'Image',
        desc: 'Upload or embed an image',
        icon: 'image',
        keywords: ['img', 'photo', 'picture', 'upload'],
      },
      {
        id: 'table',
        name: 'Table',
        desc: 'Insert a 3×3 table',
        icon: 'table',
        keywords: ['grid', 'rows', 'columns'],
      },
      {
        id: 'equation',
        name: 'Equation',
        desc: 'Block math — LaTeX, rendered with KaTeX',
        icon: 'sigma',
        short: '$$',
        keywords: ['math', 'latex', 'katex', 'formula'],
      },
      {
        id: 'inline-math',
        name: 'Inline math',
        desc: 'A formula inside a line of text',
        icon: 'sigma',
        short: '$',
        keywords: ['math', 'latex', 'formula'],
      },
      {
        id: 'divider',
        name: 'Divider',
        desc: 'Horizontal line',
        icon: 'divider',
        short: '---',
        keywords: ['hr', 'horizontal rule', 'line', 'separator'],
      },
    ],
  },
]

export interface FormatOption {
  id: BlockType
  name: string
  /** Block icon — the menu chip and the bubble trigger face for structural
   *  blocks. Textual blocks use text faces instead: triggerText in the
   *  bubble trigger, sample in menu chips. */
  icon?: IconName
  triggerText?: string
  sample?: string
}

/** Bubble "turn into" options (callout removed). */
export const FORMAT_OPTIONS: FormatOption[] = [
  { id: 'p', name: 'Text', triggerText: 'T', sample: 'Aa' },
  { id: 'h1', name: 'Heading 1', triggerText: 'H1', sample: 'H1' },
  { id: 'h2', name: 'Heading 2', triggerText: 'H2', sample: 'H2' },
  { id: 'h3', name: 'Heading 3', triggerText: 'H3', sample: 'H3' },
  { id: 'bullet', name: 'Bullet list', icon: 'list' },
  { id: 'num', name: 'Numbered list', icon: 'listOl' },
  { id: 'task', name: 'To-do', icon: 'task' },
  { id: 'quote', name: 'Quote', icon: 'quote' },
  { id: 'code', name: 'Code block', icon: 'codeBlock' },
]

/* Display-side localization. The static data above stays English — ids and
   names are identity values (matched by the slash filter, compared against
   block state); translation happens only at render. */
const NAME_ALIAS: Record<string, string> = { p: 'text' }
export const blockName = (id: string): string => i18n.t(`blocks.names.${NAME_ALIAS[id] ?? id}`)
export const slashSectionLabel = (section: string): string => i18n.t(`blocks.sections.${section}`)
