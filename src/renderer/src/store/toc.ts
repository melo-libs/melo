import { atom } from 'jotai'

/** A flattened table-of-contents entry derived from the editor's headings. */
export interface TocItem {
  id: string
  /** Heading level, clamped to 1–3 for display. */
  level: number
  text: string
  active: boolean
}

/** Published by the editor (TableOfContents extension), read by the Outline. */
export const tocAtom = atom<TocItem[]>([])
