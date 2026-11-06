import { useEffect, type RefObject } from 'react'

/**
 * A row that scrolls sideways (tab bars on a phone) gets `has-more-right` / `has-more-left`
 * while there's more to see that way, so CSS can fade that edge: "swipe for more".
 */
export function useScrollHint(ref: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      el.classList.toggle('has-more-right', max > 1 && el.scrollLeft < max - 1)
      el.classList.toggle('has-more-left', max > 1 && el.scrollLeft > 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure when the caller's content changes
  }, deps)
}
