import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { parseOasSpec } from '../../utils/oasParser'

export default function TopBar({ onToggleSidebar }) {
 const location = useLocation()
 const { oasSpec, endpoint, setEndpoint, serverOptions, token } = useApp()
 const { navItems } = oasSpec ? parseOasSpec(oasSpec) : { navItems: [] }

 const [endpointOpen, setEndpointOpen] = useState(false)
 const endpointRef = useRef(null)

 useEffect(() => {
 if (!endpointOpen) return
 function handle(e) {
 if (!endpointRef.current?.contains(e.target)) setEndpointOpen(false)
 }
 document.addEventListener('mousedown', handle)
 return () => document.removeEventListener('mousedown', handle)
 }, [endpointOpen])

 const endpointChoices =
 serverOptions.length > 0
 ? serverOptions
 : endpoint
 ? [{ url: endpoint, description: null }]
 : []

 const normalizedChoices = endpoint && !endpointChoices.some((s) => s.url === endpoint)
 ? [{ url: endpoint, description: 'Current' }, ...endpointChoices]
 : endpointChoices

 // Derive active page title from current route
 function getTitle() {
 if (location.pathname === '/') return 'Dashboard'
 const parts = location.pathname.split('/').filter(Boolean)
 // /r/:tagSlug/:subResource or /r/:tagSlug
 if (parts[0] === 'r') {
 const tagSlug = parts[1]
 const subResource = parts[2]
 const navItem = navItems.find((n) => n.id === tagSlug)
 if (navItem) {
 if (subResource) {
 const child = navItem.children.find(
 (c) => c.subResource === decodeURIComponent(subResource)
 )
 return child ? `${navItem.label} › ${child.label}` : navItem.label
 }
 return navItem.label
 }
 }
 return 'Dashboard'
 }

 return (
 <header className="flex items-center justify-between h-14 px-6 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-slate-800 flex-shrink-0">
 {/* Left: hamburger + page title */}
 <div className="flex items-center gap-3">
 <button
 onClick={onToggleSidebar}
 className="p-1.5 text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
 aria-label="Toggle sidebar"
 >
 <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
 </svg>
 </button>
 <h1 className="text-base font-semibold text-gray-900 dark:text-slate-100">{getTitle()}</h1>
 </div>

 {/* Right: endpoint selector + theme toggle */}
 <div className="flex items-center gap-2">
 <div ref={endpointRef} className="relative hidden sm:block">
 <button
 onClick={() => setEndpointOpen((v) => !v)}
 className="flex items-center gap-1.5 h-8 px-2.5 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
 >
 <span className="w-1.5 h-1.5 bg-emerald-500 flex-shrink-0" />
 <span className="text-xs text-gray-600 dark:text-slate-300 max-w-[160px] truncate">
 {normalizedChoices.find((s) => s.url === endpoint)?.description ?? endpoint ?? 'No endpoint'}
 </span>
 <svg className="w-3 h-3 text-gray-400 dark:text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </button>

 {endpointOpen && (
 <div className="absolute top-full right-0 mt-1 w-72 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 shadow-xl z-50 overflow-hidden">
 {normalizedChoices.map((s) => (
 <button
 key={s.url}
 onClick={() => { setEndpoint(s.url); setEndpointOpen(false) }}
 className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-slate-800 ${
 s.url === endpoint ? 'bg-gray-50 dark:bg-slate-800/70' : ''
 }`}
 >
 <div className="text-xs font-medium text-gray-800 dark:text-slate-200">{s.description ?? s.url}</div>
 {s.description && (
 <div className="text-[10px] text-gray-400 dark:text-slate-500 font-mono mt-0.5 truncate">{s.url}</div>
 )}
 </button>
 ))}
 </div>
 )}
 </div>

 </div>
 </header>
 )
}
