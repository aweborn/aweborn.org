import { create } from 'zustand'

/**
 * One screen steers (M9): the server says whether this screen flies the
 * player others see (0x11 steer). `follower` = another screen of the same
 * player took over; flying here takes it back.
 */
interface SteerState {
  follower: boolean
  setFollower: (follower: boolean) => void
}

export const useSteerStore = create<SteerState>((set) => ({
  follower: false,
  setFollower: (follower) => set({ follower }),
}))
