import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

/**
 * True when the app viewport is phone-sized (<768px). Drives the mobile
 * shell (bottom tab bar, stacked panes, full-screen steppers) per
 * docs/ux-guided-mobile-plan.md §5. Listens for viewport changes so
 * resizing the window flips the shell live.
 */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_QUERY).matches
      : false
  ))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = (event) => setIsMobile(event.matches)
    setIsMobile(mql.matches)
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [])

  return isMobile
}
