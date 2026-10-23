import { useEffect } from 'react'
import { useAtom } from 'jotai'
import { IpcChannels, type UpdateState } from '@shared/types/ipc'
import { updateStatusAtom } from '../store/updateStatus'

export function useUpdateState(): UpdateState {
  const [state, setState] = useAtom(updateStatusAtom)
  useEffect(() => {
    let alive = true
    const receive = (next: UpdateState) => {
      if (alive) setState((previous) => (next.revision >= previous.revision ? next : previous))
    }
    const unsubscribe = window.api.on(IpcChannels.OnUpdateState, receive)
    void window.api
      .invoke(IpcChannels.InvokeGetUpdateState, undefined)
      .then((result) => {
        if (result.success && result.data) receive(result.data)
        else throw new Error(result.error ?? 'Could not read update state')
      })
      .catch((error) => {
        console.error('Could not read update state:', error)
        if (alive)
          setState((previous) =>
            previous.revision === 0 ? { ...previous, check: 'error' } : previous,
          )
      })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [setState])
  return state
}
