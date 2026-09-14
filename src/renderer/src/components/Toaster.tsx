import { useEffect, useState } from 'react'
import './Toaster.scss'

/* ============================================================
   Minimal transient toast. `toast(msg)` from anywhere; a single
   <Toaster/> mounted in App renders the messages.
   ============================================================ */

interface ToastEntry {
  id: number
  message: string
}

let nextId = 1
const listeners = new Set<(t: ToastEntry) => void>()

export function toast(message: string) {
  const entry = { id: nextId++, message }
  listeners.forEach((fn) => fn(entry))
}

export const Toaster = () => {
  const [items, setItems] = useState<ToastEntry[]>([])

  useEffect(() => {
    const add = (t: ToastEntry) => {
      setItems((prev) => [...prev, t])
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 2400)
    }
    listeners.add(add)
    return () => {
      listeners.delete(add)
    }
  }, [])

  return (
    <div className="toaster">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  )
}
