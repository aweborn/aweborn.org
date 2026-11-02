/** A placed sound's colour by kind: the orb, its ghost in hand, the Library tile and the Made-from sheet. */
export const SOUND_COLORS = { sound: '#7fe3ff', music: '#c59bff', voice: '#ffc37a' } as const

export type SoundMedia = keyof typeof SOUND_COLORS

export const SOUND_LABELS: Record<SoundMedia, string> = { sound: 'Sound', music: 'Music', voice: 'Voice' }

export const isSoundMedia = (k: unknown): k is SoundMedia => k === 'sound' || k === 'music' || k === 'voice'

/** Voices play once as you walk up; sounds and music loop while you're near (the orb's default too). */
export const defaultLoop = (media: SoundMedia) => media !== 'voice'

