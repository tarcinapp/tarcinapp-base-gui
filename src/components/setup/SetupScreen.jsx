import { useMemo, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'

const LOCAL_ENDPOINT = 'http://127.0.0.1:8081'

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return atob(padded)
}

function safeParseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseJwtToken(rawToken) {
  const parts = rawToken.split('.')
  if (parts.length !== 3) {
    throw new Error('Token must be a JWT with 3 segments')
  }

  const header = safeParseJson(decodeBase64Url(parts[0]))
  const payload = safeParseJson(decodeBase64Url(parts[1]))

  if (!header || typeof header !== 'object') {
    throw new Error('Invalid JWT header')
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid JWT payload')
  }

  if (typeof payload.exp === 'number') {
    const nowInSeconds = Math.floor(Date.now() / 1000)
    if (payload.exp <= nowInSeconds) {
      throw new Error('Token is expired')
    }
  }

  return payload
}

function extractUsername(payload) {
  return (
    payload.preferred_username ||
    payload.username ||
    payload.user_name ||
    payload.upn ||
    payload.email ||
    payload.name ||
    payload.sub ||
    'Unknown'
  )
}

function extractRoles(payload) {
  const roles = []

  const pushRoles = (value) => {
    if (!value) return
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === 'string' && entry.trim()) roles.push(entry.trim())
      })
      return
    }
    if (typeof value === 'string' && value.trim()) {
      roles.push(value.trim())
    }
  }

  pushRoles(payload.roles)
  pushRoles(payload.role)
  pushRoles(payload.authorities)
  pushRoles(payload.realm_access?.roles)

  if (payload.resource_access && typeof payload.resource_access === 'object') {
    Object.values(payload.resource_access).forEach((resource) => {
      pushRoles(resource?.roles)
    })
  }

  return [...new Set(roles)]
}

export default function SetupScreen() {
  const { connect, connectWithUploadedSpec, oasStatus, oasError, token: storedToken } = useApp()
  const [endpointMode, setEndpointMode] = useState('local')
  const [customEndpoint, setCustomEndpoint] = useState(LOCAL_ENDPOINT)
  const [token, setToken] = useState(storedToken ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const endpoint = endpointMode === 'local' ? LOCAL_ENDPOINT : customEndpoint
  const tokenValidation = useMemo(() => {
    const trimmed = token.trim()
    if (!trimmed) {
      return { isValid: true, payload: null, username: null, roles: [], error: null }
    }

    try {
      const payload = parseJwtToken(trimmed)
      return {
        isValid: true,
        payload,
        username: extractUsername(payload),
        roles: extractRoles(payload),
        error: null,
      }
    } catch (err) {
      return {
        isValid: false,
        payload: null,
        username: null,
        roles: [],
        error: err?.message || 'Invalid token',
      }
    }
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!tokenValidation.isValid) return
    setSubmitting(true)
    await connect(endpoint.trim(), token.trim() || null)
    setSubmitting(false)
  }

  async function handleFile(file) {
    if (!file) return
    if (!tokenValidation.isValid) return
    if (!file.name.toLowerCase().endsWith('.json')) {
      await connectWithUploadedSpec({
        spec: null,
        endpoint: endpoint.trim(),
        token: token.trim() || null,
      })
      return
    }

    setSubmitting(true)
    try {
      const text = await file.text()
      const spec = JSON.parse(text)
      await connectWithUploadedSpec({
        spec,
        endpoint: endpoint.trim(),
        token: token.trim() || null,
      })
    } catch {
      await connectWithUploadedSpec({
        spec: null,
        endpoint: endpoint.trim(),
        token: token.trim() || null,
      })
    } finally {
      setSubmitting(false)
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    handleFile(file)
  }

  function handleDragOver(e) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    setIsDragging(false)
  }

  const isLoading = submitting || oasStatus === 'loading'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-gray-900 dark:text-white font-bold text-lg leading-none">Tarcinapp</p>
            <p className="text-gray-500 dark:text-slate-400 text-sm mt-0.5">Entity Platform GUI</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-8">
          <h1 className="text-gray-900 dark:text-white font-semibold text-xl mb-1">Connect to Backend</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm mb-6">
            Select an endpoint source or upload an OpenAPI JSON file. The UI will be generated automatically from the spec.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                API Endpoint <span className="text-red-500 dark:text-red-400">*</span>
              </label>

              <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-1">
                <button
                  type="button"
                  onClick={() => setEndpointMode('local')}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    endpointMode === 'local'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 dark:text-slate-300 hover:bg-gray-200/80 dark:hover:bg-slate-700/80'
                  }`}
                >
                  Local
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointMode('custom')}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    endpointMode === 'custom'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 dark:text-slate-300 hover:bg-gray-200/80 dark:hover:bg-slate-700/80'
                  }`}
                >
                  Custom
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointMode('file')}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    endpointMode === 'file'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 dark:text-slate-300 hover:bg-gray-200/80 dark:hover:bg-slate-700/80'
                  }`}
                >
                  File
                </button>
              </div>

              {endpointMode === 'custom' && (
                <input
                  type="url"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                  required
                  placeholder={LOCAL_ENDPOINT}
                  className="mt-3 w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-slate-100 text-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
              )}

              {endpointMode === 'file' && (
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`mt-3 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                      : 'border-gray-300 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 hover:border-gray-400 dark:hover:border-slate-600'
                  }`}
                >
                  <p className="text-sm text-gray-600 dark:text-slate-300">
                    Drag and drop OpenAPI JSON file here
                  </p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">or</p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 transition-colors"
                  >
                    Choose JSON File
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                </div>
              )}

              <p className="mt-1.5 text-xs text-gray-400 dark:text-slate-500">
                Will fetch{' '}
                <code className="bg-gray-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">
                  {(endpoint || 'http://...').replace(/\/$/, '')}/openapi.json
                </code>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                Bearer Token{' '}
                <span className="text-gray-400 dark:text-slate-500 text-xs font-normal">(optional)</span>
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="eyJhbGciOiJSUzI1NiJ9…"
                className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-slate-100 text-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />

              {token.trim() && tokenValidation.isValid && (
                <div className="mt-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-3">
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    User: <span className="font-medium text-emerald-800 dark:text-emerald-200">{tokenValidation.username}</span>
                  </p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                    Roles:{' '}
                    <span className="font-medium text-emerald-800 dark:text-emerald-200">
                      {tokenValidation.roles.length ? tokenValidation.roles.join(', ') : 'No roles found'}
                    </span>
                  </p>
                </div>
              )}

              {token.trim() && !tokenValidation.isValid && (
                <p className="mt-2 text-xs text-red-500 dark:text-red-400">
                  Invalid token: {tokenValidation.error}
                </p>
              )}
            </div>

            {oasError && (
              <div className="flex items-start gap-2.5 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <svg className="w-4 h-4 text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-red-600 dark:text-red-300 text-sm">{oasError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !tokenValidation.isValid}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium text-sm transition-colors"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Connecting…
                </span>
              ) : (
                'Connect'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-slate-600 mt-6">
          You can also set{' '}
          <code className="font-mono">TAPP_API_ENDPOINT</code> and{' '}
          <code className="font-mono">TAPP_API_TOKEN</code> environment variables to skip this screen.
        </p>
      </div>
    </div>
  )
}
