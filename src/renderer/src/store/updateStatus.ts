import { atom } from 'jotai'
import { INITIAL_UPDATE_STATE } from '@shared/types/ipc'

export const updateStatusAtom = atom(INITIAL_UPDATE_STATE)
