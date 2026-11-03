import { createContext, useContext, useState, useCallback } from 'react'

const AppContext = createContext(null)

const STORAGE_KEY = 'tarcinapp_config'

function loadConfig() {
 try {
 const raw = localStorage.getItem(STORAGE_KEY)
 return raw ? JSON.parse(raw) : {}
 } catch {
 return {}
 }
}

function saveConfig(cfg) {
 try {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
 } catch {
 // storage unavailable — silently ignore
 }
}

function normalizeEndpointFromSpec(spec) {
 const firstServer = spec?.servers?.[0]?.url
 if (!firstServer || typeof firstServer !== 'string') return null
 return firstServer.trim() || null
}

function validateOasSpec(spec) {
 if (!spec || typeof spec !== 'object') {
 throw new Error('Uploaded file is not a valid JSON object')
 }
 if (!spec.openapi || !spec.paths || typeof spec.paths !== 'object') {
 throw new Error('Uploaded file is not a valid OpenAPI spec')
 }
}

export function AppProvider({ children }) {
 // Environment variables take priority over stored config (Vite exposes VITE_* vars)
 const envEndpoint = import.meta.env.TAPP_API_ENDPOINT ?? null
 const envToken = import.meta.env.TAPP_API_TOKEN ?? null

 const stored = loadConfig()

 const [endpoint, setEndpointRaw] = useState(envEndpoint ?? stored.endpoint ?? null)
 const [token, setTokenRaw] = useState(envToken ?? stored.token ?? null)
 const [bypassCache, setBypassCacheRaw] = useState(stored.bypassCache ?? true)
 const [oasSpec, setOasSpec] = useState(null)
 // 'idle' | 'loading' | 'success' | 'error'
 const [oasStatus, setOasStatus] = useState('idle')
 const [oasError, setOasError] = useState(null)

 const setEndpoint = useCallback(
 (url) => {
 const trimmed = url?.trim() || null
 setEndpointRaw(trimmed)
 // Don't persist env-provided values (they're already in the environment)
 if (!envEndpoint) saveConfig({ ...loadConfig(), endpoint: trimmed })
 },
 [envEndpoint]
 )

 const setToken = useCallback(
 (t) => {
 const trimmed = t?.trim() || null
 setTokenRaw(trimmed)
 if (!envToken) saveConfig({ ...loadConfig(), token: trimmed })
 },
 [envToken]
 )

 const setBypassCache = useCallback((val) => {
 setBypassCacheRaw(val)
 saveConfig({ ...loadConfig(), bypassCache: val })
 }, [])

 const fetchOasSpec = useCallback(async (ep, tk) => {
 if (!ep) return
 setOasStatus('loading')
 setOasError(null)
 try {
 const headers = { 'Cache-Control': 'no-cache' }
 if (tk) headers['Authorization'] = `Bearer ${tk}`
 const res = await fetch(`${ep}/openapi.json`, { headers, cache: 'no-store' })
 if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`)
 const spec = await res.json()
 setOasSpec(spec)
 setOasStatus('success')
 } catch (err) {
 setOasError(err.message ?? 'Failed to fetch OpenAPI spec')
 setOasStatus('error')
 }
 }, [])

 const connectWithUploadedSpec = useCallback(
 async ({ spec, endpoint: providedEndpoint, token: providedToken }) => {
 setOasStatus('loading')
 setOasError(null)
 try {
 validateOasSpec(spec)

 const resolvedEndpoint =
 providedEndpoint?.trim() || endpoint || normalizeEndpointFromSpec(spec)
 const resolvedToken = providedToken?.trim() || token || null

 if (resolvedEndpoint) setEndpoint(resolvedEndpoint)
 if (providedToken !== undefined) setToken(resolvedToken)

 setOasSpec(spec)
 setOasStatus('success')
 } catch (err) {
 setOasError(err?.message ?? 'Failed to load OpenAPI spec from file')
 setOasStatus('error')
 }
 },
 [endpoint, token, setEndpoint, setToken]
 )

 /** Called from SetupScreen — stores credentials then fetches spec */
 const connect = useCallback(
 async (ep, tk) => {
 setEndpoint(ep)
 setToken(tk)
 await fetchOasSpec(ep, tk)
 },
 [setEndpoint, setToken, fetchOasSpec]
 )

 /** Reset everything and return to the setup screen */
 const disconnect = useCallback(() => {
 setEndpointRaw(null)
 setTokenRaw(null)
 setOasSpec(null)
 setOasStatus('idle')
 setOasError(null)
 saveConfig({})
 }, [])

 const retry = useCallback(() => fetchOasSpec(endpoint, token), [fetchOasSpec, endpoint, token])

 const isReady = oasStatus === 'success' && oasSpec !== null

 const serverOptions = Array.isArray(oasSpec?.servers)
 ? oasSpec.servers
 .filter((s) => typeof s?.url === 'string' && s.url.trim())
 .map((s) => ({
 url: s.url.trim(),
 description: s.description?.trim() || null,
 }))
 : []

 return (
 <AppContext.Provider
 value={{
 endpoint,
 setEndpoint,
 token,
 bypassCache,
 setBypassCache,
 oasSpec,
 serverOptions,
 oasStatus,
 oasError,
 isReady,
 connect,
 connectWithUploadedSpec,
 disconnect,
 retry,
 }}
 >
 {children}
 </AppContext.Provider>
 )
}

export function useApp() {
 const ctx = useContext(AppContext)
 if (!ctx) throw new Error('useApp must be used within AppProvider')
 return ctx
}
