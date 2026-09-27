import { atom } from 'jotai'
import type { UpdateCheckOutcome } from '@shared/types/ipc'

export type UpdateUiState =
  | UpdateCheckOutcome
  | { status: 'idle' | 'checking' | 'downloading' | 'downloaded' }
  | { status: 'download-error'; version: string }

export const updateStatusAtom = atom<UpdateUiState>({ status: 'idle' })
