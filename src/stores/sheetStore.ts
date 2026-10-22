/**
 * Which "make" sheet is open: Library, Create, Plan (inside worlds) or
 * Plant a world (space). One at a time: on a phone they share the same
 * sheet slot, and on desktop Library and Plan sat in the same spot anyway.
 *
 * The touch dock (TouchDock) opens them; each panel reads its own flag
 * with `useSheet(name)`, which works like `useState` did before
 * (2026-10-22, dock + Make sheet, docs/mobile-ui/SPEC.md).
 */
import { useCallback } from 'react'
import { create } from 'zustand'

export type SheetName = 'library' | 'create' | 'plan' | 'plant' | 'more' | 'mana'
type Next = boolean | ((open: boolean) => boolean)

interface SheetState {
  sheet: SheetName | null
  setSheet: (name: SheetName, next: Next) => void
  close: () => void
}

export const useSheetStore = create<SheetState>((set, get) => ({
  sheet: null,
  setSheet: (name, next) => {
    const isOpen = get().sheet === name
    const open = typeof next === 'function' ? next(isOpen) : next
    if (open) set({ sheet: name })
    else if (isOpen) set({ sheet: null })
  },
  close: () => set({ sheet: null }),
}))

/** `[open, setOpen]` for one sheet, a drop-in for `useState(false)`. */
export function useSheet(name: SheetName) {
  const open = useSheetStore((s) => s.sheet === name)
  const setOpen = useCallback((next: Next) => useSheetStore.getState().setSheet(name, next), [name])
  return [open, setOpen] as const
}
