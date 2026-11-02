import { create } from 'zustand'

/** Which placed sound the read-only "Made from" sheet is open for (MadeFromPanel). */
export const useMadeFromTarget = create<{ id: string | null }>(() => ({ id: null }))
export const openMadeFrom = (id: string) => useMadeFromTarget.setState({ id })
export const closeMadeFrom = () => useMadeFromTarget.setState({ id: null })

