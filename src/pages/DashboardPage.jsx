import { useEffect, useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { parseOasSpec } from '../utils/oasParser'
import { useApiClient } from '../services/apiClient'

const BASE_TYPE_ORDER = ['entity', 'list', 'relation', 'entity-reaction', 'list-reaction']

const BASE_TYPE_LABELS = {
 entity: 'Entities',
 list: 'Lists',
 relation: 'Relations',
 'entity-reaction': 'Entity Reactions',
 'list-reaction': 'List Reactions',
}

const BASE_TYPE_ICONS = {
 entity: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
 list: 'M4 6h16M4 10h16M4 14h16M4 18h16',
 relation: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
 'entity-reaction': 'M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
 'list-reaction': 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
}

/**
 * Simple in-memory cache for dashboard count requests.
 * Module-level so it survives re-renders; clears on full page reload.
 * TTL: 60 seconds.
 */
const CACHE_TTL_MS = 60_000
const countCache = new Map() // key → { value, expiresAt }

function cacheGet(key) {
 const entry = countCache.get(key)
 if (!entry) return undefined
 if (Date.now() > entry.expiresAt) { countCache.delete(key); return undefined }
 return entry.value
}

function cacheSet(key, value) {
 countCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

function cacheClear() {
 countCache.clear()
}

/** Decode the `sub` claim from a JWT without verifying the signature. */
function parseJwtSub(token) {
 if (!token) return null
 try {
 const part = token.split('.')[1]
 if (!part) return null
 const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
 return json.sub ?? null
 } catch {
 return null
 }
}

/** Fetch count with a 60 s in-memory cache, falling back to collection GET. */
async function fetchCount(get, collectionPath, query) {
 const qs = query ? `?${query}` : ''
 const cacheKey = collectionPath + qs

 const cached = cacheGet(cacheKey)
 if (cached !== undefined) return cached

 let result
 try {
 const res = await get(collectionPath + '/count' + qs)
 result = res?.count ?? '?'
 } catch {
 try {
 const res = await get(collectionPath + qs)
 result = Array.isArray(res) ? res.length : '?'
 } catch {
 return null // don't cache errors
 }
 }

 cacheSet(cacheKey, result)
 return result
}

// Per-section color theme
const SECTION_THEME = {
 entity: { rgb: '16,185,129', accent: '#10b981', bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.15)' },
 list: { rgb: '139,92,246', accent: '#8b5cf6', bg: 'rgba(139,92,246,0.06)', border: 'rgba(139,92,246,0.15)' },
 relation: { rgb: '14,165,233', accent: '#0ea5e9', bg: 'rgba(14,165,233,0.06)', border: 'rgba(14,165,233,0.15)' },
 'entity-reaction':{ rgb: '245,158,11', accent: '#f59e0b', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.15)' },
 'list-reaction': { rgb: '244,63,94', accent: '#f43f5e', bg: 'rgba(244,63,94,0.06)', border: 'rgba(244,63,94,0.15)' },
}
const FALLBACK_THEME = SECTION_THEME.entity

// Enhanced resource card showing data by visibility level with lazy loading
function ResourceCard({ label, routePath, collectionPath, hasSet, get, theme, showMine, userId, showDetails, baseType }) {
 const [data, setData] = useState(null)
 const [isVisible, setIsVisible] = useState(false)
 const cardRef = useRef(null)

 // Intersection Observer for lazy loading
 useEffect(() => {
 const observer = new IntersectionObserver(
 ([entry]) => {
 if (entry.isIntersecting) {
 setIsVisible(true)
 observer.disconnect() // Stop observing once visible
 }
 },
 {
 rootMargin: '100px', // Start loading 100px before card is visible
 threshold: 0.01,
 }
 )

 if (cardRef.current) {
 observer.observe(cardRef.current)
 }

 return () => {
 if (cardRef.current) {
 observer.unobserve(cardRef.current)
 }
 }
 }, [])

 // Fetch data only when card is visible
 useEffect(() => {
 if (!isVisible) return

 let cancelled = false
 const ownerFilter = showMine && userId ? `&set[owners][userIds]=${encodeURIComponent(userId)}` : ''
 const isRelation = baseType === 'relation'
 
 // If details are hidden, only fetch total count
 // If details are shown, fetch breakdown based on resource type
 const promises = showDetails && hasSet
 ? isRelation
 ? [
 // Relations: only validity periods (no visibility levels)
 fetchCount(get, collectionPath, `set[actives]=true${ownerFilter}`),
 fetchCount(get, collectionPath, `set[pendings]=true${ownerFilter}`),
 fetchCount(get, collectionPath, `set[expireds]=true${ownerFilter}`),
 ]
 : [
 // Other resources: visibility × validity
 // Public: actives, pendings, expireds
 fetchCount(get, collectionPath, `set[publics]=true&set[actives]=true${ownerFilter}`),
 fetchCount(get, collectionPath, `set[publics]=true&set[pendings]=true${ownerFilter}`),
 fetchCount(get, collectionPath, `set[publics]=true&set[expireds]=true${ownerFilter}`),
 // Protected: actives, pendings, expireds
 fetchCount(get, collectionPath, `set[protecteds]=true&set[actives]=true${ownerFilter}`),
 fetchCount(get, collectionPath, `set[protecteds]=true&set[pendings]=true${ownerFilter}`),
 fetchCount(get, collectionPath, `set[protecteds]=true&set[expireds]=true${ownerFilter}`),
 // Private: actives, pendings, expireds
 fetchCount(get, collectionPath, `set[privates]=true&set[actives]=true${ownerFilter}`),
 fetchCount(get, collectionPath, `set[privates]=true&set[pendings]=true${ownerFilter}`),
 fetchCount(get, collectionPath, `set[privates]=true&set[expireds]=true${ownerFilter}`),
 ]
 : [fetchCount(get, collectionPath, ownerFilter.slice(1) || '')]
 
 Promise.all(promises).then((results) => {
 if (!cancelled) {
 if (showDetails && hasSet) {
 if (isRelation) {
 // Relations: just validity periods
 const [active, pending, expired] = results
 const total = (active || 0) + (pending || 0) + (expired || 0)
 
 setData({
 total,
 validity: { active, pending, expired },
 })
 } else {
 // Other resources: visibility × validity
 const [pubActive, pubPending, pubExpired, protActive, protPending, protExpired, privActive, privPending, privExpired] = results
 const total = (pubActive || 0) + (pubPending || 0) + (pubExpired || 0) +
 (protActive || 0) + (protPending || 0) + (protExpired || 0) +
 (privActive || 0) + (privPending || 0) + (privExpired || 0)
 
 setData({
 total,
 public: { active: pubActive, pending: pubPending, expired: pubExpired },
 protected: { active: protActive, pending: protPending, expired: protExpired },
 private: { active: privActive, pending: privPending, expired: privExpired },
 })
 }
 } else {
 setData({ total: results[0] })
 }
 }
 })
 return () => { cancelled = true }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [isVisible, collectionPath, hasSet, showMine, userId, showDetails, baseType])

 const loading = !isVisible || data === null

 return (
 <Link
 ref={cardRef}
 to={routePath}
 className="group relative block p-4 transition-colors duration-200"
 style={{
 background: theme.bg,
 border: `1px solid ${theme.border}`,
 }}
 >
 {/* Header with title */}
 <div className="flex items-start justify-between mb-3">
 <h3 className="text-sm font-medium text-gray-600 dark:text-slate-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
 {label}
 </h3>
 </div>
 
 {/* Main count - TOTAL of all items */}
 {loading ? (
 <div className="h-9 w-16 bg-gray-200 dark:bg-slate-800/50 animate-pulse mb-4" />
 ) : (
 <div className="text-3xl font-bold tabular-nums mb-4" style={{ color: theme.accent }}>
 {data?.total ?? '—'}
 </div>
 )}
 
 {/* Breakdown - only shown when details are expanded */}
 {hasSet && showDetails && (
 <div className="space-y-2">
 {loading ? (
 <>
 <div className="h-5 w-full bg-gray-200/50 dark:bg-slate-800/30 animate-pulse" />
 <div className="h-5 w-full bg-gray-200/50 dark:bg-slate-800/30 animate-pulse" />
 <div className="h-5 w-full bg-gray-200/50 dark:bg-slate-800/30 animate-pulse" />
 </>
 ) : baseType === 'relation' ? (
 // Relations: only validity periods (no visibility)
 <div className="flex items-center gap-2 text-xs">
 <div className="flex items-center gap-1.5">
 <span className="text-emerald-600 dark:text-emerald-400">{data?.validity?.active ?? 0}</span>
 <span className="text-gray-400 dark:text-slate-600">active</span>
 </div>
 {(data?.validity?.pending ?? 0) > 0 && (
 <>
 <span className="text-gray-300 dark:text-slate-700">·</span>
 <div className="flex items-center gap-1.5">
 <span className="text-amber-500 dark:text-amber-400">{data.validity.pending}</span>
 <span className="text-gray-400 dark:text-slate-600">pending</span>
 </div>
 </>
 )}
 {(data?.validity?.expired ?? 0) > 0 && (
 <>
 <span className="text-gray-300 dark:text-slate-700">·</span>
 <div className="flex items-center gap-1.5">
 <span className="text-gray-400 dark:text-slate-500">{data.validity.expired}</span>
 <span className="text-gray-400 dark:text-slate-600">expired</span>
 </div>
 </>
 )}
 </div>
 ) : (
 // Other resources: visibility × validity
 <>
 {/* Public */}
 <div className="flex items-center gap-2 text-xs">
 <span className="text-gray-400 dark:text-slate-500 w-16">Public:</span>
 <div className="flex items-center gap-1.5">
 <span className="text-emerald-600 dark:text-emerald-400">{data?.public?.active ?? 0}</span>
 <span className="text-gray-400 dark:text-slate-600">active</span>
 </div>
 {(data?.public?.pending ?? 0) > 0 && (
 <>
 <span className="text-gray-300 dark:text-slate-700">·</span>
 <div className="flex items-center gap-1.5">
 <span className="text-amber-500 dark:text-amber-400">{data.public.pending}</span>
 <span className="text-gray-400 dark:text-slate-600">pending</span>
 </div>
 </>
 )}
 {(data?.public?.expired ?? 0) > 0 && (
 <>
 <span className="text-gray-300 dark:text-slate-700">·</span>
 <div className="flex items-center gap-1.5">
 <span className="text-gray-400 dark:text-slate-500">{data.public.expired}</span>
 <span className="text-gray-400 dark:text-slate-600">expired</span>
 </div>
 </>
 )}
 </div>

 {/* Protected */}
 <div className="flex items-center gap-2 text-xs">
 <span className="text-gray-400 dark:text-slate-500 w-16">Protected:</span>
 <div className="flex items-center gap-1.5">
 <span className="text-blue-500 dark:text-blue-400">{data?.protected?.active ?? 0}</span>
 <span className="text-gray-400 dark:text-slate-600">active</span>
 </div>
 {(data?.protected?.pending ?? 0) > 0 && (
 <>
 <span className="text-gray-300 dark:text-slate-700">·</span>
 <div className="flex items-center gap-1.5">
 <span className="text-amber-500 dark:text-amber-400">{data.protected.pending}</span>
 <span className="text-gray-400 dark:text-slate-600">pending</span>
 </div>
 </>
 )}
 {(data?.protected?.expired ?? 0) > 0 && (
 <>
 <span className="text-gray-300 dark:text-slate-700">·</span>
 <div className="flex items-center gap-1.5">
 <span className="text-gray-400 dark:text-slate-500">{data.protected.expired}</span>
 <span className="text-gray-400 dark:text-slate-600">expired</span>
 </div>
 </>
 )}
 </div>

 {/* Private */}
 <div className="flex items-center gap-2 text-xs">
 <span className="text-gray-400 dark:text-slate-500 w-16">Private:</span>
 <div className="flex items-center gap-1.5">
 <span className="text-purple-500 dark:text-purple-400">{data?.private?.active ?? 0}</span>
 <span className="text-gray-400 dark:text-slate-600">active</span>
 </div>
 {(data?.private?.pending ?? 0) > 0 && (
 <>
 <span className="text-gray-300 dark:text-slate-700">·</span>
 <div className="flex items-center gap-1.5">
 <span className="text-amber-500 dark:text-amber-400">{data.private.pending}</span>
 <span className="text-gray-400 dark:text-slate-600">pending</span>
 </div>
 </>
 )}
 {(data?.private?.expired ?? 0) > 0 && (
 <>
 <span className="text-gray-300 dark:text-slate-700">·</span>
 <div className="flex items-center gap-1.5">
 <span className="text-gray-400 dark:text-slate-500">{data.private.expired}</span>
 <span className="text-gray-400 dark:text-slate-600">expired</span>
 </div>
 </>
 )}
 </div>
 </>
 )}
 </div>
 )}
 
 {!hasSet && (
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wider">Total</p>
 )}
 </Link>
 )
}

export default function DashboardPage() {
 const { oasSpec, token } = useApp()
 const { get } = useApiClient()
 const { navItems } = oasSpec ? parseOasSpec(oasSpec) : { navItems: [] }
 const [refreshKey, setRefreshKey] = useState(0)
 const [globalShowDetails, setGlobalShowDetails] = useState(false)
 const [sectionShowDetails, setSectionShowDetails] = useState({})

 const userId = useMemo(() => parseJwtSub(token), [token])

 const handleRefresh = () => {
 cacheClear()
 setRefreshKey(prev => prev + 1)
 }

 const toggleGlobalDetails = () => {
 setGlobalShowDetails(!globalShowDetails)
 }

 const toggleSectionDetails = (sectionType) => {
 setSectionShowDetails(prev => ({
 ...prev,
 [sectionType]: !prev[sectionType]
 }))
 }

 // Determine if details should be shown for a specific section
 const shouldShowDetails = (sectionType) => {
 // If section has explicit setting, use that; otherwise use global
 return sectionShowDetails[sectionType] !== undefined
 ? sectionShowDetails[sectionType]
 : globalShowDetails
 }

 // Group items by base type
 const groups = useMemo(() => {
 const result = BASE_TYPE_ORDER.reduce((acc, type) => {
 const items = navItems.filter(item => item.baseType === type)
 if (items.length) acc.push({ type, label: BASE_TYPE_LABELS[type] ?? type, items })
 return acc
 }, [])
 
 const ungrouped = navItems.filter(item => !BASE_TYPE_ORDER.includes(item.baseType))
 if (ungrouped.length) result.push({ type: 'other', label: 'Other', items: ungrouped })
 
 return result
 }, [navItems])

 if (navItems.length === 0) {
 return (
 <div className="flex items-center justify-center h-64">
 <p className="text-gray-400 dark:text-slate-500 text-sm">No resources found in the OpenAPI spec.</p>
 </div>
 )
 }

 return (
 <div className="space-y-6">
 {/* Global controls: Show Details and Refresh buttons */}
 <div className="flex items-center justify-between">
 <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-200">Record Counts</h1>
 <div className="flex items-center gap-3">
 <button
 onClick={toggleGlobalDetails}
 className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-200"
 title={globalShowDetails ?"Hide all details" :"Show all details"}
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 {globalShowDetails ? (
 <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
 ) : (
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 )}
 </svg>
 <span className="text-sm font-medium">{globalShowDetails ? 'Hide' : 'Show'} Details</span>
 </button>
 <button
 onClick={handleRefresh}
 className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-200"
 title="Refresh data and clear cache"
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
 </svg>
 <span className="text-sm font-medium">Refresh</span>
 </button>
 </div>
 </div>

 {/* Content sections with vertical split */}
 <div className="space-y-8">
 {groups.map(({ type, label, items }) => {
 const theme = SECTION_THEME[type] ?? FALLBACK_THEME
 const icon = BASE_TYPE_ICONS[type]
 const showDetails = shouldShowDetails(type)
 
 return (
 <section key={type}>
 {/* Section header with details toggle */}
 <div className="flex items-center gap-3 mb-4">
 {icon && (
 <div className="w-8 h-8 flex items-center justify-center" style={{ background: theme.bg }}>
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: theme.accent }}>
 <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
 </svg>
 </div>
 )}
 <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-200">{label}</h2>
 <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${theme.border}, transparent)` }} />
 <button
 onClick={() => toggleSectionDetails(type)}
 className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800/50 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors duration-200"
 title={showDetails ?"Hide section details" :"Show section details"}
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 {showDetails ? (
 <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
 ) : (
 <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
 )}
 </svg>
 </button>
 </div>

 {/* Vertical Split: All Items (Left) | My Items (Right) */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Left: All Items */}
 <div>
 <h3 className="text-sm font-medium text-gray-500 dark:text-slate-400 mb-3 flex items-center gap-2">
 <div className="w-1 h-3" style={{ background: theme.accent }} />
 All
 </h3>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 {items.map(item => (
 <ResourceCard
 key={`all-${item.id}-${refreshKey}`}
 {...item}
 get={get}
 theme={theme}
 showMine={false}
 userId={userId}
 showDetails={showDetails}
 baseType={type}
 />
 ))}
 </div>
 </div>

 {/* Right: My Items */}
 {userId ? (
 <div>
 <h3 className="text-sm font-medium text-gray-500 dark:text-slate-400 mb-3 flex items-center gap-2">
 <div className="w-1 h-3 bg-indigo-500" />
 Mine
 </h3>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 {items.map(item => (
 <ResourceCard
 key={`mine-${item.id}-${refreshKey}`}
 {...item}
 get={get}
 theme={{ ...theme, accent: '#818cf8' }}
 showMine={true}
 userId={userId}
 showDetails={showDetails}
 baseType={type}
 />
 ))}
 </div>
 </div>
 ) : (
 <div className="flex items-center justify-center border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/30 p-8">
 <div className="text-center">
 <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
 </svg>
 <p className="text-sm text-gray-400 dark:text-slate-500">Sign in to view your items</p>
 </div>
 </div>
 )}
 </div>
 </section>
 )
 })}
 </div>
 </div>
 )
}

// Made with Bob
