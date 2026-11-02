import { create } from 'zustand'

/** Which creation the Bring-it-to-life sheet is open for (Phase 07 Life & minds). */
export const useLifeTarget = create<{ id: string | null }>(() => ({ id: null }))
export const openLife = (id: string) => useLifeTarget.setState({ id })
export const closeLife = () => useLifeTarget.setState({ id: null })
