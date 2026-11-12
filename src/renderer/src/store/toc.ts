import { atom } from 'jotai'

/** A flattened table-of-contents entry derived from the editor's headings. */
export interface TocItem {
  id: string
  /** Heading depth in the document hierarchy. */
  level: number
  text: string
  active: boolean
}

/** Published by the editor (TableOfContents extension), read by the document outline. */
export const tocAtom = atom<TocItem[]>([])
