import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Generic data-fetching hook for resource list pages.
 *
 * Design notes:
 * - `fetcher` is stored in a ref and updated synchronously during render (no
 *   extra useEffect) so that `load` has a stable identity and never changes,
 *   regardless of how many times the caller re-renders with a new fetcher.
 *   This prevents the mount useEffect from re-firing on every filter/page change.
 * - The AbortController cleanup suppresses any in-flight load when React Strict
 *   Mode unmounts+remounts the component in development, so exactly one network
 *   request is issued per mount.
 * - `refresh()` is exposed for explicit manual re-fetches.
 *
 * @param {() => Promise<any[]>} fetcher  – async function that returns the records
 * @returns {{ data, loading, error, refresh }}
 */
export function useResourceList(fetcher) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Sync the ref during render — no extra useEffect hook needed.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(async (signal) => {
    if (signal?.aborted) return
    setLoading(true)
    setError(null)
    try {
      const result = await fetcherRef.current(signal)
      if (signal?.aborted) return
      setData(Array.isArray(result) ? result : [])
    } catch (err) {
      if (signal?.aborted) return
      setError(err?.message ?? 'Failed to load data')
    } finally {
      if (signal?.aborted) return
      setLoading(false)
    }
  }, []) // stable — no deps, reads latest fetcher via ref

  // Fire on mount only. Cleanup aborts any in-flight load on unmount.
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const refresh = useCallback(() => load(null), [load])

  return { data, loading, error, refresh }
}
