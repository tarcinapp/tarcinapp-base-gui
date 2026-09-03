import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Outlet } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { parseOasSpec, deriveColumns, resolvePaginationQueryKeys, getPostBodySchema, isResolvableValue } from '../../utils/oasParser'
import { useApiClient } from '../../services/apiClient'
import { useResourceList } from '../../hooks/useResourceList'
import DataGrid from '../ui/DataGrid'
import Toast from '../ui/Toast'
import VisualFilterBuilder from '../ui/VisualFilterBuilder'
import VisualWhereFilterBuilder from '../ui/VisualWhereFilterBuilder'
import ConfirmDialog from '../ui/ConfirmDialog'
import { buildFilterExprQuery, buildBlockFromKeys, appendBlock, makeOr, makeSet } from '../../utils/filterExpr'
import { buildWhereFilterQuery, buildWhereBlockFromClauses, appendWhereBlock, WHERE_OPERATOR_OPTIONS } from '../../utils/whereFilterExpr'

function buildItemPath(template, id) {
  return template.replace(/\{[^}]+\}/, encodeURIComponent(id))
}

function formatQueryPreview(queryString) {
  const entries = []
  queryString.forEach((value, key) => {
    entries.push(value === '' ? key : `${key}=${value}`)
  })
  return entries.length ? `?${entries.join('&')}` : ''
}

function shortId(id) {
  if (!id) return '—'
  if (id.length <= 14) return id
  return `${id.slice(0, 6)}...${id.slice(-4)}`
}

/**
 * Toggles a field in the field selector state machine.
 * Modes:
 *   'all'     – all fields selected, no filter[fields] params
 *   'exclude' – some fields unchecked, send filter[fields][x]=false for excluded
 *   'none'    – all unchecked, no params
 *   'include' – some re-checked after none, send filter[fields][x]=true for included
 */
function toggleFieldSelection(fieldName, allFields, current) {
  const { mode, selected } = current

  if (mode === 'all') {
    return { mode: 'exclude', selected: new Set([fieldName]) }
  }

  if (mode === 'exclude') {
    const isChecked = !selected.has(fieldName)
    if (isChecked) {
      // unchecking → add to excludes
      const next = new Set(selected)
      next.add(fieldName)
      return next.size === allFields.length
        ? { mode: 'none', selected: new Set() }
        : { mode: 'exclude', selected: next }
    } else {
      // re-checking → remove from excludes
      const next = new Set(selected)
      next.delete(fieldName)
      return next.size === 0
        ? { mode: 'all', selected: new Set() }
        : { mode: 'exclude', selected: next }
    }
  }

  if (mode === 'none') {
    return { mode: 'include', selected: new Set([fieldName]) }
  }

  // mode === 'include'
  const isChecked = selected.has(fieldName)
  if (isChecked) {
    const next = new Set(selected)
    next.delete(fieldName)
    return next.size === 0
      ? { mode: 'none', selected: new Set() }
      : { mode: 'include', selected: next }
  } else {
    const next = new Set(selected)
    next.add(fieldName)
    return { mode: 'include', selected: next }
  }
}

function isFieldChecked(fieldName, fieldSelectorState) {
  const { mode, selected } = fieldSelectorState
  if (mode === 'all') return true
  if (mode === 'exclude') return !selected.has(fieldName)
  if (mode === 'none') return false
  return selected.has(fieldName) // 'include'
}

function buildFilterFieldsParams(qs, fieldSelectorState) {
  const { mode, selected } = fieldSelectorState
  if (mode === 'exclude') {
    for (const f of selected) qs.set(`filter[fields][${f}]`, 'false')
  } else if (mode === 'include') {
    for (const f of selected) qs.set(`filter[fields][${f}]`, 'true')
  }
}

function buildFilterOrderParams(qs, sortOrder) {
  if (!sortOrder.length) return
  if (sortOrder.length === 1) {
    qs.set('filter[order]', `${sortOrder[0].field} ${sortOrder[0].dir}`)
  } else {
    sortOrder.forEach(({ field, dir }, i) => {
      qs.set(`filter[order][${i}]`, `${field} ${dir}`)
    })
  }
}

const FILTER_CONTROL_CLASS = 'h-[30px] rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-white focus:border-slate-500 focus:outline-none focus:ring-0'

function makeEmptyWhereClause(field = '') {
  return {
    id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    field,
    op: 'eq',
    value: '',
    value2: '',
  }
}

const WHERE_OP_SECOND_VALUE = new Set(
  WHERE_OPERATOR_OPTIONS.filter((o) => o.needsSecondValue).map((o) => o.value)
)

const RESOURCE_FIELD_PREFS_SESSION_KEY = 'resourceFieldPrefs.v1'

function loadResourceFieldPrefs(resourceKey) {
  if (!resourceKey) return null
  try {
    const raw = window.sessionStorage.getItem(RESOURCE_FIELD_PREFS_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const entry = parsed?.[resourceKey]
    if (!entry) return null

    const mode = ['all', 'exclude', 'none', 'include'].includes(entry.mode) ? entry.mode : 'all'
    const selected = Array.isArray(entry.selected) ? new Set(entry.selected) : new Set()
    const hidden = Array.isArray(entry.hidden) ? new Set(entry.hidden) : new Set()
    const hiddenRecordIds = Array.isArray(entry.hiddenRecordIds) ? new Set(entry.hiddenRecordIds) : new Set()
    const hiddenRecordMeta = entry.hiddenRecordMeta && typeof entry.hiddenRecordMeta === 'object' ? entry.hiddenRecordMeta : {}
    const hideMarkedRows = entry.hideMarkedRows !== false
    return {
      fieldSelectorState: { mode, selected },
      hiddenFields: hidden,
      hiddenRecordIds,
      hiddenRecordMeta,
      hideMarkedRows,
    }
  } catch {
    return null
  }
}

function saveResourceFieldPrefs(resourceKey, fieldSelectorState, hiddenFields, hiddenRecordIds, hiddenRecordMeta, hideMarkedRows) {
  if (!resourceKey) return
  try {
    const raw = window.sessionStorage.getItem(RESOURCE_FIELD_PREFS_SESSION_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    parsed[resourceKey] = {
      mode: fieldSelectorState.mode,
      selected: [...fieldSelectorState.selected],
      hidden: [...hiddenFields],
      hiddenRecordIds: [...hiddenRecordIds],
      hiddenRecordMeta,
      hideMarkedRows,
    }
    window.sessionStorage.setItem(RESOURCE_FIELD_PREFS_SESSION_KEY, JSON.stringify(parsed))
  } catch {
    // Ignore storage errors and continue with in-memory state.
  }
}

function parseJwt(token) {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function formatClaimValue(value) {
  if (value === null || value === undefined) return <span className="text-slate-500 italic">null</span>
  if (typeof value === 'boolean') return <span className="text-amber-400 font-mono">{String(value)}</span>
  if (typeof value === 'number') return <span className="text-sky-400 font-mono">{value}</span>
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1 mt-0.5">
        {value.map((v, i) => (
          <span key={i} className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono">{String(v)}</span>
        ))}
      </div>
    )
  }
  if (typeof value === 'object') {
    return <span className="text-slate-400 font-mono text-[10px] break-all">{JSON.stringify(value)}</span>
  }
  return <span className="text-slate-300 font-mono break-all">{String(value)}</span>
}

function removeSetKeysFromExpr(node, keysToRemove) {
  if (!node) return null

  if (node.type === 'set') {
    return keysToRemove.includes(node.key) ? null : node
  }

  if (node.type === 'group') {
    const inner = removeSetKeysFromExpr(node.child, keysToRemove)
    return inner ? { ...node, child: inner } : null
  }

  if (node.type === 'or' || node.type === 'and') {
    const children = node.children
      .map((child) => removeSetKeysFromExpr(child, keysToRemove))
      .filter(Boolean)

    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    return { ...node, children }
  }

  return node
}

function collectSetKeysFromExpr(node, allowedKeys) {
  if (!node || !Array.isArray(allowedKeys) || allowedKeys.length === 0) return []
  const allowed = new Set(allowedKeys)
  const found = new Set()

  const walk = (n) => {
    if (!n) return
    if (n.type === 'set') {
      if (allowed.has(n.key)) found.add(n.key)
      return
    }
    if (n.type === 'group') {
      walk(n.child)
      return
    }
    if (n.type === 'or' || n.type === 'and') {
      n.children.forEach(walk)
    }
  }

  walk(node)
  return allowedKeys.filter((k) => found.has(k))
}

function buildStatusVisibilityExpr(existingExpr, config) {
  const {
    statusKeys,
    selectedStatusKeys,
    visibilityKeys,
    selectedVisibilityKeys,
    setSchemaProps,
  } = config

  const stripKeys = [...statusKeys, ...visibilityKeys]
  const baseExpr = removeSetKeysFromExpr(existingExpr, stripKeys)

  const makeOrBlock = (keys) => {
    if (!keys.length) return null
    const mergedProps = Object.fromEntries(
      keys.map((k) => [k, setSchemaProps?.[k] ?? { isObject: false }])
    )
    return buildBlockFromKeys(keys, mergedProps, 'or')
  }

  const statusBlock = makeOrBlock(selectedStatusKeys)
  const visibilityBlock = makeOrBlock(selectedVisibilityKeys)
  const blocks = [baseExpr, statusBlock, visibilityBlock].filter(Boolean)

  if (blocks.length === 0) return null

  let next = blocks[0]
  for (let i = 1; i < blocks.length; i += 1) {
    next = appendBlock(next, blocks[i], 'and')
  }
  return next
}

function formatSetChoiceLabel(key) {
  const singular = key.replace(/s$/, '')
  return singular.charAt(0).toUpperCase() + singular.slice(1)
}

function IdentityTab({ token }) {
  const claims = parseJwt(token)

  if (!token) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-600 text-xs">
        No token configured.
      </div>
    )
  }

  if (!claims) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-600 text-xs">
        Token is not a valid JWT.
      </div>
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = typeof claims.exp === 'number' ? claims.exp : null
  const iat = typeof claims.iat === 'number' ? claims.iat : null
  const isExpired = exp !== null && now > exp

  const roles = claims.roles ?? claims.role ?? claims.realm_access?.roles ?? null
  const rolesArray = Array.isArray(roles) ? roles : (roles != null ? [roles] : null)

  const SPECIAL_KEYS = new Set(['roles', 'role', 'realm_access', 'exp', 'iat', 'nbf', 'sub', 'iss', 'aud', 'jti'])
  const genericClaims = Object.entries(claims).filter(([k]) => !SPECIAL_KEYS.has(k))

  function fmtTime(ts) {
    return new Date(ts * 1000).toLocaleString()
  }

  return (
    <div className="space-y-5">
      {/* Token status */}
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 text-xs font-mono font-bold rounded ${isExpired ? 'bg-rose-800 text-rose-100' : 'bg-emerald-800 text-emerald-100'}`}>
          {isExpired ? 'Expired' : 'Valid'}
        </span>
        {exp !== null && (
          <span className="text-[10px] text-slate-500 font-mono">{isExpired ? 'Expired' : 'Expires'} {fmtTime(exp)}</span>
        )}
      </div>

      {/* Roles */}
      {rolesArray !== null && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Roles</p>
          <div className="flex flex-wrap gap-1.5">
            {rolesArray.length === 0
              ? <span className="text-xs text-slate-600 italic">No roles</span>
              : rolesArray.map((r) => (
                  <span key={r} className="px-2 py-0.5 text-xs rounded-md bg-violet-600/20 text-violet-300 border border-violet-700 font-mono">{r}</span>
                ))
            }
          </div>
        </div>
      )}

      {/* Subject / Issuer / Audience / JTI */}
      {(claims.sub || claims.iss || claims.aud || claims.jti) && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Identity</p>
          <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 overflow-hidden">
            {[['sub', claims.sub], ['iss', claims.iss], ['aud', claims.aud], ['jti', claims.jti]]
              .filter(([, v]) => v != null)
              .map(([key, value]) => (
                <div key={key} className="px-3 py-1.5 bg-slate-950">
                  <p className="text-[10px] text-slate-500 font-mono">{key}</p>
                  <div className="text-xs mt-0.5">{formatClaimValue(value)}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Timestamps */}
      {(iat !== null || exp !== null || claims.nbf != null) && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Timestamps</p>
          <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 overflow-hidden">
            {[['iat', iat], ['exp', exp], ['nbf', claims.nbf]]
              .filter(([, v]) => v != null)
              .map(([key, ts]) => (
                <div key={key} className="px-3 py-1.5 bg-slate-950">
                  <p className="text-[10px] text-slate-500 font-mono">{key}</p>
                  <p className="text-xs text-slate-300 font-mono">{fmtTime(ts)}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* All other claims */}
      {genericClaims.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Claims</p>
          <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 overflow-hidden">
            {genericClaims.map(([key, value]) => (
              <div key={key} className="px-3 py-1.5 bg-slate-950">
                <p className="text-[10px] text-slate-500 font-mono">{key}</p>
                <div className="text-xs mt-0.5">{formatClaimValue(value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TagInput({ value, onChange }) {
  const [inputVal, setInputVal] = useState('')
  const items = Array.isArray(value) ? value : []

  const commit = () => {
    const trimmed = inputVal.trim()
    if (trimmed) onChange([...items, trimmed])
    setInputVal('')
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 p-2 bg-slate-950 border border-slate-700 rounded-lg min-h-[38px] focus-within:ring-1 focus-within:border-blue-500 focus-within:ring-blue-500 cursor-text"
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.querySelector('input')?.focus() }}
    >
      {items.map((item, idx) => (
        <span key={idx} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-slate-700 rounded text-xs text-slate-200 font-mono">
          {item}
          <button
            type="button"
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
            className="text-slate-500 hover:text-white ml-0.5 leading-none"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        type="text"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
          if (e.key === 'Backspace' && !inputVal && items.length > 0) onChange(items.slice(0, -1))
        }}
        placeholder={items.length === 0 ? 'Type and press Enter…' : ''}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-slate-200 focus:outline-none placeholder-slate-600"
      />
    </div>
  )
}

function buildPayloadFromForm(values, fields) {
  const payload = {}
  for (const field of fields) {
    const val = values[field.name]
    if (field.type === 'boolean') {
      if (val !== undefined) payload[field.name] = val === true || val === 'true'
      continue
    }
    if (val === undefined || val === null || val === '') continue
    if (field.type === 'integer') {
      const n = parseInt(val, 10)
      if (!isNaN(n)) payload[field.name] = n
    } else if (field.type === 'number') {
      const n = parseFloat(val)
      if (!isNaN(n)) payload[field.name] = n
    } else if (field.type === 'array') {
      if (Array.isArray(val)) {
        if (val.length > 0) payload[field.name] = val
      } else {
        try { payload[field.name] = JSON.parse(val) } catch { /* skip invalid JSON */ }
      }
    } else if (field.type === 'object') {
      try { payload[field.name] = JSON.parse(val) } catch { /* skip invalid JSON */ }
    } else {
      payload[field.name] = val
    }
  }
  return payload
}

function renderCreateField(field, value, onChange) {
  const cls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500'

  if (field.type === 'boolean') {
    const checked = value === true || value === 'true'
    return (
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
          checked ? 'bg-blue-700 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'
        }`}
      >
        <span className="font-mono">{checked ? 'true' : 'false'}</span>
      </button>
    )
  }

  if (field.enum) {
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">— select —</option>
        {field.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  }

  if (field.type === 'integer' || field.type === 'number') {
    return (
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        step={field.type === 'integer' ? '1' : 'any'}
        className={cls}
      />
    )
  }

  if (field.type === 'array') {
    return <TagInput value={value} onChange={onChange} />
  }

  if (field.type === 'object') {
    return (
      <textarea
        rows={3}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="{}"
        className={`${cls} font-mono text-xs`}
      />
    )
  }

  if (field.format === 'date-time') {
    return (
      <input
        type="datetime-local"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
      />
    )
  }

  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
  )
}

export default function ResourcePage() {
  const { tagSlug } = useParams()
  const navigate = useNavigate()
  const { oasSpec, endpoint, token } = useApp()
  const { get, getWithMeta, post, patch, del } = useApiClient()
  // Decoded JWT claims — used to pre-fill userIds / groupIds in object-set inputs
  const jwtClaims = useMemo(() => parseJwt(token), [token])
  const jwtSub = jwtClaims?.sub ?? null
  const jwtGroups = useMemo(() => {
    const raw = jwtClaims?.groups ?? jwtClaims?.group ?? null
    if (!raw) return null
    const arr = Array.isArray(raw) ? raw : [raw]
    return arr.length > 0 ? arr : null
  }, [jwtClaims])
  // filterBuilderExpr: FilterExpr AST (null = no set filter)
  const [filterBuilderExpr, setFilterBuilderExpr] = useState(null)
  // whereBuilderExpr: where-filter AST (null = no where filter)
  const [whereBuilderExpr, setWhereBuilderExpr] = useState(null)
  // staged where clauses before pushing into whereBuilderExpr
  const [stagedWhereClauses, setStagedWhereClauses] = useState([])
  const [whereInternalOp, setWhereInternalOp] = useState('and')
  // staged selections in the Sets dropdown (array of keys)
  const [stagedSetKeys, setStagedSetKeys] = useState([])
  // userIds / groupIds for staged object-type sets: { [key]: { userIds: string, groupIds: string } }
  const [stagedSetMeta, setStagedSetMeta] = useState({})
  // AND/OR logic used internally within the staged block
  const [setsInternalOp, setSetsInternalOp] = useState('or')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [queryInfoOpen, setQueryInfoOpen] = useState(false)
  const [queryDuration, setQueryDuration] = useState(null)
  const [responseHeaders, setResponseHeaders] = useState(null)
  const [responseStatus, setResponseStatus] = useState(null)
  const [curlMode, setCurlMode] = useState(false)
  const [copied, setCopied] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchDebounceRef = useRef(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createPayload, setCreatePayload] = useState('{}')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [createTab, setCreateTab] = useState('form')
  const [createFormValues, setCreateFormValues] = useState({})
  const [toastError, setToastError] = useState(null)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  // fieldSelectorState: { mode: 'all'|'exclude'|'none'|'include', selected: Set<string> }
  const [fieldSelectorState, setFieldSelectorState] = useState({ mode: 'all', selected: new Set() })
  // sortOrder: [{ field: string, dir: 'ASC'|'DESC' }]
  const [sortOrder, setSortOrder] = useState([])
  const [selectedQ, setSelectedQ] = useState(null)
  const [selectedFieldset, setSelectedFieldset] = useState(null)
  const [queryInfoTab, setQueryInfoTab] = useState('request')
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [requestHeaders, setRequestHeaders] = useState(null)
  const [qDropdownOpen, setQDropdownOpen] = useState(false)
  const [fieldsetDropdownOpen, setFieldsetDropdownOpen] = useState(false)
  const [setsDropdownOpen, setSetsDropdownOpen] = useState(false)
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const [visibilityDropdownOpen, setVisibilityDropdownOpen] = useState(false)
  const [fieldDropdownOpen, setFieldDropdownOpen] = useState(false)
  const [hiddenFieldDropdownOpen, setHiddenFieldDropdownOpen] = useState(false)
  const qDropdownRef = useRef(null)
  const fieldsetDropdownRef = useRef(null)
  const setsDropdownRef = useRef(null)
  const statusDropdownRef = useRef(null)
  const visibilityDropdownRef = useRef(null)
  const fieldDropdownRef = useRef(null)
  const hiddenFieldDropdownRef = useRef(null)
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)
  // Traversal create modal state
  const [traversalCreateState, setTraversalCreateState] = useState(null) // null | { row, traversal }
  const [traversalCreateTab, setTraversalCreateTab] = useState('form')
  const [traversalCreateFormValues, setTraversalCreateFormValues] = useState({})
  const [traversalCreatePayload, setTraversalCreatePayload] = useState('{}')
  const [traversalCreateError, setTraversalCreateError] = useState(null)
  const [traversalCreating, setTraversalCreating] = useState(false)
  // List relate modal state
  const [listRelateState, setListRelateState] = useState(null) // null | { row, traversal }
  const [listRelateRelation, setListRelateRelation] = useState(null) // selected relation nav item
  const [listRelateSelectedList, setListRelateSelectedList] = useState(null)
  const [listRelateSearch, setListRelateSearch] = useState('')
  const [listRelateResults, setListRelateResults] = useState([])
  const [listRelateSearchLoading, setListRelateSearchLoading] = useState(false)
  const [listRelatePage, setListRelatePage] = useState(0)
  const [listRelateHasMore, setListRelateHasMore] = useState(false)
  const [listRelateFormValues, setListRelateFormValues] = useState({})
  const [listRelating, setListRelating] = useState(false)
  const [listRelateError, setListRelateError] = useState(null)
  const listRelateSearchDebounceRef = useRef(null)
  const [traversalRefreshSignal, setTraversalRefreshSignal] = useState(0)

  const { navItems } = useMemo(() => parseOasSpec(oasSpec), [oasSpec])
  const navItem = useMemo(() => navItems.find((n) => n.id === tagSlug), [navItems, tagSlug])
  const resourcePrefsKey = navItem?.collectionPath ?? null

  const postSchema = useMemo(
    () => getPostBodySchema(oasSpec, navItem?.collectionPath),
    [oasSpec, navItem?.collectionPath]
  )
  const writableFields = useMemo(() => {
    if (!postSchema?.properties) return []
    return Object.entries(postSchema.properties)
      .filter(([, prop]) => !prop.readOnly)
      .map(([name, prop]) => ({
        name,
        type: prop.type ?? 'string',
        format: prop.format ?? null,
        enum: Array.isArray(prop.enum) ? prop.enum : null,
        required: Array.isArray(postSchema.required) && postSchema.required.includes(name),
        description: prop.description ?? null,
      }))
  }, [postSchema])

  // Section 1: _name (if present) + all non-managed (no leading _) fields
  const primaryCreateFields = useMemo(() => {
    const nameField = writableFields.find((f) => f.name === '_name')
    const unmanaged = writableFields.filter((f) => !f.name.startsWith('_'))
    return nameField ? [nameField, ...unmanaged] : unmanaged
  }, [writableFields])

  // Section 2: managed (_) fields excluding _name
  const managedCreateFields = useMemo(
    () => writableFields.filter((f) => f.name.startsWith('_') && f.name !== '_name'),
    [writableFields]
  )

  // Traversal create: writable fields derived from the traversal's POST schema
  const traversalCreateWritableFields = useMemo(() => {
    if (!traversalCreateState?.traversal?.pathTemplate) return []
    const schema = getPostBodySchema(oasSpec, traversalCreateState.traversal.pathTemplate)
    if (!schema?.properties) return []
    return Object.entries(schema.properties)
      .filter(([, prop]) => !prop.readOnly)
      .map(([name, prop]) => ({
        name,
        type: prop.type ?? 'string',
        format: prop.format ?? null,
        enum: Array.isArray(prop.enum) ? prop.enum : null,
        required: Array.isArray(schema.required) && schema.required.includes(name),
        description: prop.description ?? null,
      }))
  }, [oasSpec, traversalCreateState])

  // Relation nav items that link entities to lists (have both _entityId and _listId in POST schema)
  const listRelationNavItems = useMemo(() => {
    return navItems.filter((ni) => {
      if (!ni.collectionMethods?.includes('post')) return false
      const schema = getPostBodySchema(oasSpec, ni.collectionPath)
      if (!schema?.properties) return false
      const props = schema.properties
      return '_entityId' in props && !props._entityId?.readOnly
        && '_listId' in props && !props._listId?.readOnly
    })
  }, [navItems, oasSpec])

  // List nav items for the picker (baseType === 'list' or path includes /lists/)
  const listNavItemsForPicker = useMemo(() => {
    return navItems.filter((n) => n.baseType === 'list' || n.collectionPath?.includes('/lists/'))
  }, [navItems])

  // Entity nav items for the picker (baseType === 'entity' or not a list/relation)
  const entityNavItemsForPicker = useMemo(() => {
    return navItems.filter((n) => n.baseType === 'entity' || (!n.baseType && n.collectionPath && !n.collectionPath.includes('/lists/')))
  }, [navItems])

  // Set of traversal pathTemplates on the current resource that should show the relate modal.
  // Three cases:
  //  1. subResource last-seg matches a known relation type (e.g. 'contains')
  //  2. path includes '/lists/'  → entity page, pick a list
  //  3. path includes '/entities/' → list page, pick an entity
  const relateTraversalIds = useMemo(() => {
    if (!navItem?.children) return new Set()
    const relationLastSegs = new Set(listRelationNavItems.map((ni) => {
      const parts = (ni.collectionPath ?? '').split('/').filter(Boolean)
      return parts[parts.length - 1]
    }).filter(Boolean))
    return new Set((navItem.children ?? []).filter((t) => {
      const lastSeg = (t.subResource ?? '').split('/').pop()
      if (listRelationNavItems.length > 0 && relationLastSegs.has(lastSeg)) return true
      // Use subResource prefix — 'lists/bookshelves' starts with 'lists/', 'reactions/likes' does not
      if (listNavItemsForPicker.length > 0 && t.subResource?.startsWith('lists/')) return true
      if (entityNavItemsForPicker.length > 0 && t.subResource?.startsWith('entities/')) return true
      return false
    }).map((t) => t.pathTemplate))
  }, [navItem, listRelationNavItems, listNavItemsForPicker, entityNavItemsForPicker])

  // Writable fields for the selected relation type (excluding _entityId and _listId)
  const listRelateWritableFields = useMemo(() => {
    if (!listRelateRelation?.collectionPath) return []
    const schema = getPostBodySchema(oasSpec, listRelateRelation.collectionPath)
    if (!schema?.properties) return []
    return Object.entries(schema.properties)
      .filter(([name, prop]) => !prop.readOnly && name !== '_entityId' && name !== '_listId')
      .map(([name, prop]) => ({
        name,
        type: prop.type ?? 'string',
        format: prop.format ?? null,
        enum: Array.isArray(prop.enum) ? prop.enum : null,
        required: Array.isArray(schema.required) && schema.required.includes(name),
        description: prop.description ?? null,
      }))
  }, [oasSpec, listRelateRelation])

  const canCreate = navItem?.collectionMethods?.includes('post')
  const canDeleteItem = navItem?.itemPathTemplate && navItem?.itemMethods?.includes('delete')
  const canActivate = !!navItem?.itemSchemaProps?.['_validFromDateTime'] && !!navItem?.itemPathTemplate && navItem?.itemMethods?.includes('patch')
  const canDeactivate = !!navItem?.itemSchemaProps?.['_validUntilDateTime'] && !!navItem?.itemPathTemplate && navItem?.itemMethods?.includes('patch')
  const showFieldSelector = !!(navItem?.hasFilterFields || navItem?.hasFieldset || navItem?.hasFields)
  const qEnumValues = navItem?.qEnumValues ?? null
  const fieldsetEnumValues = navItem?.fieldsetEnumValues ?? null
  const [fieldSearch, setFieldSearch] = useState('')
  const [hiddenFieldSearch, setHiddenFieldSearch] = useState('')
  const [hiddenFields, setHiddenFields] = useState(new Set())
  const [selectedRowIds, setSelectedRowIds] = useState(new Set())
  const [hiddenRecordIds, setHiddenRecordIds] = useState(new Set())
  const [hiddenRecordMeta, setHiddenRecordMeta] = useState({})
  const [hideMarkedRows, setHideMarkedRows] = useState(true)
  const [pendingBulkAction, setPendingBulkAction] = useState(null)
  const [bulkProgress, setBulkProgress] = useState({
    running: false,
    action: null,
    total: 0,
    processed: 0,
    failed: 0,
    currentLabel: '',
  })

  const paginationKeys = useMemo(
    () => resolvePaginationQueryKeys(oasSpec, navItem?.collectionPath, 'get'),
    [oasSpec, navItem?.collectionPath]
  )

  const hasAnySetSelection = filterBuilderExpr !== null

  const querySummary = useMemo(() => {
    const qs = new URLSearchParams()
    qs.set(paginationKeys.limitKey, String(pageSize))
    qs.set(paginationKeys.skipKey, String(page * pageSize))
    buildFilterExprQuery(qs, filterBuilderExpr)
    buildWhereFilterQuery(qs, whereBuilderExpr)
    if (debouncedSearch) {
      if (navItem?.hasSimplifiedSearch) qs.set('s', debouncedSearch)
      else qs.set('filter[where][_name][regexp]', `.*${debouncedSearch}.*`)
    }
    if (selectedQ) qs.set('q', selectedQ)
    if (selectedFieldset) qs.set('fieldset', selectedFieldset)
    buildFilterFieldsParams(qs, fieldSelectorState)
    buildFilterOrderParams(qs, sortOrder)
    return formatQueryPreview(qs)
  }, [page, pageSize, paginationKeys.limitKey, paginationKeys.skipKey, filterBuilderExpr, whereBuilderExpr, debouncedSearch, selectedQ, selectedFieldset, fieldSelectorState, sortOrder])

  useEffect(() => {
    setPage(0)
    setSearchInput('')
    setDebouncedSearch('')
    const savedPrefs = loadResourceFieldPrefs(resourcePrefsKey)
    if (savedPrefs) {
      setFieldSelectorState(savedPrefs.fieldSelectorState)
      setHiddenFields(savedPrefs.hiddenFields)
      setHiddenRecordIds(savedPrefs.hiddenRecordIds ?? new Set())
      setHiddenRecordMeta(savedPrefs.hiddenRecordMeta ?? {})
      setHideMarkedRows(savedPrefs.hideMarkedRows ?? true)
    } else {
      setFieldSelectorState({ mode: 'all', selected: new Set() })
      setHiddenFields(new Set())
      setHiddenRecordIds(new Set())
      setHiddenRecordMeta({})
      setHideMarkedRows(true)
    }
    setSelectedRowIds(new Set())
    setSelectedQ(null)
    setSelectedFieldset(null)
    setSortOrder([])
    setFilterBuilderExpr(null)
    setWhereBuilderExpr(null)
    setStagedWhereClauses([])
    setWhereInternalOp('and')
    setStagedSetKeys([])
    setStagedSetMeta({})
  }, [resourcePrefsKey])

  useEffect(() => {
    if (!resourcePrefsKey) return
    saveResourceFieldPrefs(resourcePrefsKey, fieldSelectorState, hiddenFields, hiddenRecordIds, hiddenRecordMeta, hideMarkedRows)
  }, [resourcePrefsKey, fieldSelectorState, hiddenFields, hiddenRecordIds, hiddenRecordMeta, hideMarkedRows])

  useEffect(() => {
    if (!qDropdownOpen) return undefined
    const handler = (e) => { if (qDropdownRef.current && !qDropdownRef.current.contains(e.target)) setQDropdownOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [qDropdownOpen])

  useEffect(() => {
    if (!fieldsetDropdownOpen) return undefined
    const handler = (e) => { if (fieldsetDropdownRef.current && !fieldsetDropdownRef.current.contains(e.target)) setFieldsetDropdownOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fieldsetDropdownOpen])

  useEffect(() => {
    if (!setsDropdownOpen) return undefined
    const handler = (e) => { if (setsDropdownRef.current && !setsDropdownRef.current.contains(e.target)) setSetsDropdownOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setsDropdownOpen])

  useEffect(() => {
    if (!statusDropdownOpen) return undefined
    const handler = (e) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target)) {
        setStatusDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [statusDropdownOpen])

  useEffect(() => {
    if (!visibilityDropdownOpen) return undefined
    const handler = (e) => {
      if (visibilityDropdownRef.current && !visibilityDropdownRef.current.contains(e.target)) {
        setVisibilityDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [visibilityDropdownOpen])

  useEffect(() => {
    if (!fieldDropdownOpen) return undefined
    const handler = (e) => { if (fieldDropdownRef.current && !fieldDropdownRef.current.contains(e.target)) setFieldDropdownOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fieldDropdownOpen])

  useEffect(() => {
    if (!hiddenFieldDropdownOpen) return undefined
    const handler = (e) => {
      if (hiddenFieldDropdownRef.current && !hiddenFieldDropdownRef.current.contains(e.target)) {
        setHiddenFieldDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [hiddenFieldDropdownOpen])

  useEffect(() => {
    if (!toastError) return undefined

    const timeoutId = window.setTimeout(() => {
      setToastError(null)
    }, 3500)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [toastError])

  useEffect(() => {
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim())
      setPage(0)
    }, 350)
    return () => window.clearTimeout(searchDebounceRef.current)
  }, [searchInput])

  // Fetch list/entity results when the relate modal is open or search changes
  useEffect(() => {
    if (!listRelateState) return undefined
    if (listRelateSearchDebounceRef.current) window.clearTimeout(listRelateSearchDebounceRef.current)
    listRelateSearchDebounceRef.current = window.setTimeout(async () => {
      const mode = listRelateState.mode ?? 'list-pick'
      const pickerItems = mode === 'entity-pick' ? entityNavItemsForPicker : listNavItemsForPicker
      if (pickerItems.length === 0) return
      setListRelateSearchLoading(true)
      try {
        let sources
        if (mode === 'entity-pick') {
          // Narrow entity type by traversal subResource last segment (e.g. 'books' from 'entities/books')
          const sub = listRelateState.traversal?.subResource ?? ''
          const lastSeg = sub.split('/').pop()
          const targets = pickerItems.filter((ln) =>
            !lastSeg || ln.collectionPath?.endsWith(`/${lastSeg}`) || ln.collectionPath?.includes(`/${lastSeg}`)
          )
          sources = targets.length > 0 ? targets : pickerItems
        } else {
          // Narrow list type by traversal subResource last segment (e.g. 'bookshelves' from 'lists/bookshelves')
          const sub = listRelateState.traversal?.subResource ?? ''
          const lastSeg = sub.split('/').pop()
          const targets = pickerItems.filter((ln) =>
            !lastSeg || ln.collectionPath?.endsWith(`/${lastSeg}`) || ln.collectionPath?.includes(`/${lastSeg}`)
          )
          sources = targets.length > 0 ? targets : pickerItems
        }
        const PICKER_PAGE_SIZE = 5
        const allResults = []
        for (const ln of sources) {
          const keys = resolvePaginationQueryKeys(oasSpec, ln.collectionPath, 'get')
          const qs = new URLSearchParams({ [keys.limitKey]: String(PICKER_PAGE_SIZE + 1) })
          qs.set(keys.skipKey, String(listRelatePage * PICKER_PAGE_SIZE))
          if (listRelateSearch.trim()) qs.set('s', listRelateSearch.trim())
          try {
            const data = await get(`${ln.collectionPath}?${qs}`)
            if (Array.isArray(data)) allResults.push(...data.map((r) => ({ ...r, _sourceNavItem: ln })))
          } catch { /* skip */ }
        }
        const hasMore = allResults.length > PICKER_PAGE_SIZE
        setListRelateHasMore(hasMore)
        setListRelateResults(hasMore ? allResults.slice(0, PICKER_PAGE_SIZE) : allResults)
      } finally {
        setListRelateSearchLoading(false)
      }
    }, 300)
    return () => window.clearTimeout(listRelateSearchDebounceRef.current)
  }, [listRelateState, listRelateSearch, listRelatePage, listNavItemsForPicker, entityNavItemsForPicker, oasSpec, get])

  const fetcher = useCallback(async () => {
    if (!navItem?.collectionPath) return []

    const qs = new URLSearchParams()
    qs.set(paginationKeys.limitKey, String(pageSize))
    qs.set(paginationKeys.skipKey, String(page * pageSize))
    buildFilterExprQuery(qs, filterBuilderExpr)
    buildWhereFilterQuery(qs, whereBuilderExpr)
    if (debouncedSearch) {
      if (navItem?.hasSimplifiedSearch) qs.set('s', debouncedSearch)
      else qs.set('filter[where][_name][regexp]', `.*${debouncedSearch}.*`)
    }
    if (selectedQ) qs.set('q', selectedQ)
    if (selectedFieldset) qs.set('fieldset', selectedFieldset)
    buildFilterFieldsParams(qs, fieldSelectorState)
    buildFilterOrderParams(qs, sortOrder)

    const start = performance.now()
    const { data, headers, status, requestHeaders: reqHeaders } = await getWithMeta(`${navItem.collectionPath}?${qs.toString()}`)
    setQueryDuration(Math.round(performance.now() - start))
    setResponseHeaders(headers)
    setResponseStatus(status)
    setRequestHeaders(reqHeaders ?? null)
    return data ?? []
  }, [getWithMeta, navItem?.collectionPath, page, pageSize, paginationKeys.limitKey, paginationKeys.skipKey, filterBuilderExpr, whereBuilderExpr, debouncedSearch, selectedQ, selectedFieldset, fieldSelectorState, sortOrder])

  const { data, loading, error, refresh } = useResourceList(fetcher)

  // Merge schema fields with fields discovered from actual response data
  const availableFields = useMemo(() => {
    const fromSchema = navItem?.availableFields ?? []
    const fromData = new Set()
    for (const row of data) {
      for (const k of Object.keys(row)) fromData.add(k)
    }
    const merged = new Set([...fromSchema, ...fromData])
    return [...merged].sort()
  }, [navItem?.availableFields, data])

  useEffect(() => {
    setHiddenFields((prev) => {
      const next = new Set([...prev].filter((field) => availableFields.includes(field) && isFieldChecked(field, fieldSelectorState)))
      return next.size === prev.size ? prev : next
    })
  }, [availableFields, fieldSelectorState])

  const handleDeleteRow = useCallback(
    async (row) => {
      try {
        setToastError(null)
        const id = row?._id ?? row?.id
        if (!id || !navItem?.itemPathTemplate) return
        await del(buildItemPath(navItem.itemPathTemplate, id))
        await refresh()
      } catch (err) {
        setToastError(err?.message ?? 'Delete failed')
      }
    },
    [del, navItem?.itemPathTemplate, refresh]
  )

  const handleActivateRow = useCallback(
    async (row) => {
      try {
        setToastError(null)
        const id = row?._id ?? row?.id
        if (!id || !navItem?.itemPathTemplate) return
        const bothEmpty = !row._validFromDateTime && !row._validUntilDateTime
        const payload = bothEmpty
          ? { _validFromDateTime: new Date().toISOString() }
          : { _validUntilDateTime: null }
        await patch(buildItemPath(navItem.itemPathTemplate, id), payload)
        await refresh()
      } catch (err) {
        setToastError(err?.message ?? 'Activate failed')
      }
    },
    [patch, navItem?.itemPathTemplate, refresh]
  )

  const handleDeactivateRow = useCallback(
    async (row) => {
      try {
        setToastError(null)
        const id = row?._id ?? row?.id
        if (!id || !navItem?.itemPathTemplate) return
        await patch(buildItemPath(navItem.itemPathTemplate, id), { _validUntilDateTime: new Date().toISOString() })
        await refresh()
      } catch (err) {
        setToastError(err?.message ?? 'Deactivate failed')
      }
    },
    [patch, navItem?.itemPathTemplate, refresh]
  )

  const handleFetchItem = useCallback(async (row) => {
    const id = row?._id ?? row?.id
    if (!id || !navItem?.itemPathTemplate) return row
    return await get(buildItemPath(navItem.itemPathTemplate, id))
  }, [get, navItem?.itemPathTemplate])

  const handleFetchTraversal = useCallback(async (row, pathTemplate, page, pageSize, filters = {}) => {
    const id = row?._id ?? row?.id
    if (!id) return []
    const resolvedPath = pathTemplate.replace(/\{[^}]+\}/, encodeURIComponent(id))
    const pKeys = resolvePaginationQueryKeys(oasSpec, pathTemplate, 'get')
    const qs = new URLSearchParams()
    qs.set(pKeys.limitKey, String(pageSize))
    qs.set(pKeys.skipKey, String(page * pageSize))
    // Build a simple OR-grouped set expr from the per-traversal status/visibility single-values
    const traversalSetKeys = [
      ...(filters.statusFilter ? [filters.statusFilter] : []),
      ...(filters.visibilityFilter ? [filters.visibilityFilter] : []),
    ]
    if (traversalSetKeys.length > 0) {
      const nodes = traversalSetKeys.map((k) => makeSet(k))
      buildFilterExprQuery(qs, nodes.length === 1 ? nodes[0] : makeOr(nodes))
    }
    if (filters.sortField) qs.set('filter[order]', `${filters.sortField} ${filters.sortDir ?? 'ASC'}`)
    const result = await get(`${resolvedPath}?${qs.toString()}`)
    return Array.isArray(result) ? result : []
  }, [get, oasSpec])

  const handleTraversalPost = useCallback(async (row, pathTemplate, body) => {
    const id = row?._id ?? row?.id
    if (!id) return
    const resolvedPath = pathTemplate.replace(/\{[^}]+\}/, encodeURIComponent(id))
    let parsed
    try { parsed = JSON.parse(body) } catch { throw new Error('Invalid JSON') }
    await post(resolvedPath, parsed)
    await refresh()
  }, [post, refresh])

  const handleTraversalOpenCreate = useCallback((row, traversal) => {
    setTraversalCreateState({ row, traversal })
    setTraversalCreateTab('form')
    const schema = getPostBodySchema(oasSpec, traversal.pathTemplate)
    const rowId = row?._id ?? row?.id
    const initialValues = {}
    if (schema?.properties && rowId) {
      if ('_entityId' in schema.properties && !schema.properties._entityId.readOnly) initialValues._entityId = rowId
      if ('_listId' in schema.properties && !schema.properties._listId.readOnly) initialValues._listId = rowId
    }
    setTraversalCreateFormValues(initialValues)
    setTraversalCreatePayload(Object.keys(initialValues).length ? JSON.stringify(initialValues, null, 2) : '{}')
    setTraversalCreateError(null)
  }, [oasSpec])

  const handleTraversalCreate = useCallback(async () => {
    if (!traversalCreateState) return
    const { row, traversal } = traversalCreateState
    const id = row?._id ?? row?.id
    if (!id) return
    const resolvedPath = traversal.pathTemplate.replace(/\{[^}]+\}/, encodeURIComponent(id))
    setTraversalCreateError(null)
    setTraversalCreating(true)
    try {
      const payload = (traversalCreateTab === 'form' && traversalCreateWritableFields.length > 0)
        ? buildPayloadFromForm(traversalCreateFormValues, traversalCreateWritableFields)
        : JSON.parse(traversalCreatePayload || '{}')
      await post(resolvedPath, payload)
      setTraversalCreateState(null)
      await refresh()
    } catch (err) {
      setTraversalCreateError({ message: err?.message ?? 'Create failed', details: err?.body?.error?.details ?? [] })
    } finally {
      setTraversalCreating(false)
    }
  }, [post, refresh, traversalCreateState, traversalCreateTab, traversalCreateFormValues, traversalCreatePayload, traversalCreateWritableFields])

  const handleTraversalCreateTabSwitch = useCallback((tab) => {
    if (tab === 'json' && traversalCreateTab !== 'json') {
      setTraversalCreatePayload(JSON.stringify(buildPayloadFromForm(traversalCreateFormValues, traversalCreateWritableFields), null, 2))
    } else if (tab === 'form' && traversalCreateTab !== 'form') {
      try {
        const parsed = JSON.parse(traversalCreatePayload || '{}')
        const newValues = {}
        for (const field of traversalCreateWritableFields) {
          if (parsed[field.name] !== undefined) {
            if (field.type === 'array') newValues[field.name] = Array.isArray(parsed[field.name]) ? parsed[field.name] : []
            else if (field.type === 'object') newValues[field.name] = JSON.stringify(parsed[field.name], null, 2)
            else newValues[field.name] = String(parsed[field.name])
          }
        }
        setTraversalCreateFormValues(newValues)
      } catch { /* skip */ }
    }
    setTraversalCreateTab(tab)
  }, [traversalCreateTab, traversalCreateFormValues, traversalCreatePayload, traversalCreateWritableFields])

  const handleTraversalDeleteAll = useCallback(async (row, pathTemplate) => {
    const id = row?._id ?? row?.id
    if (!id) return
    const resolvedPath = pathTemplate.replace(/\{[^}]+\}/, encodeURIComponent(id))
    await del(resolvedPath)
  }, [del])

  const handleTraversalPatchAll = useCallback(async (row, pathTemplate, body) => {
    const id = row?._id ?? row?.id
    if (!id) return
    const resolvedPath = pathTemplate.replace(/\{[^}]+\}/, encodeURIComponent(id))
    let parsed
    try { parsed = JSON.parse(body) } catch { throw new Error('Invalid JSON') }
    await patch(resolvedPath, parsed)
  }, [patch])

  const handleTraversalRelateToList = useCallback((row, traversal) => {
    // Narrow relation types to those whose collection path matches the traversal sub-resource
    const lastSeg = (traversal.subResource ?? '').split('/').pop()
    const matchingRelations = listRelationNavItems.filter((ni) => {
      const niSeg = (ni.collectionPath ?? '').split('/').filter(Boolean).pop() ?? ''
      return !lastSeg || niSeg === lastSeg
    })
    const relevantRelations = matchingRelations.length > 0 ? matchingRelations : listRelationNavItems
    const autoRelation = relevantRelations.length === 1 ? relevantRelations[0] : null
    // Detect mode: if the current resource is a list, we need to pick an entity; otherwise pick a list
    const mode = navItem?.baseType === 'list' ? 'entity-pick' : 'list-pick'
    setListRelateState({ row, traversal, mode, relevantRelations })
    setListRelateRelation(autoRelation)
    setListRelateSelectedList(null)
    setListRelateSearch('')
    setListRelateResults([])
    setListRelateFormValues({})
    setListRelateError(null)
    setListRelatePage(0)
    setListRelateHasMore(false)
  }, [listRelationNavItems, navItem])

  const handleListRelateSubmit = useCallback(async () => {
    if (!listRelateState || !listRelateRelation || !listRelateSelectedList) return
    const rowId = listRelateState.row?._id ?? listRelateState.row?.id
    const pickedId = listRelateSelectedList._id ?? listRelateSelectedList.id
    const mode = listRelateState.mode ?? 'list-pick'
    const payload = {
      ...buildPayloadFromForm(listRelateFormValues, listRelateWritableFields),
      _entityId: mode === 'list-pick' ? rowId : pickedId,
      _listId: mode === 'list-pick' ? pickedId : rowId,
    }
    setListRelating(true)
    setListRelateError(null)
    try {
      await post(listRelateRelation.collectionPath, payload)
      setListRelateState(null)
      setTraversalRefreshSignal((k) => k + 1)
    } catch (err) {
      setListRelateError({ message: err?.message ?? 'Failed to create relation', details: err?.body?.error?.details ?? [] })
    } finally {
      setListRelating(false)
    }
  }, [post, listRelateState, listRelateRelation, listRelateSelectedList, listRelateFormValues, listRelateWritableFields])

  const handleFetchRelatedRecord = useCallback(async (id, traversalSubResource) => {
    // Prioritize navItems whose collection path matches the traversal's subResource
    const preferred = traversalSubResource
      ? navItems.filter((n) => {
          const path = n.collectionPath ?? ''
          return path.endsWith(traversalSubResource) || path.endsWith('/' + traversalSubResource.split('/').pop())
        })
      : []
    const rest = navItems.filter((n) => !preferred.includes(n))
    for (const item of [...preferred, ...rest]) {
      if (!item.itemPathTemplate) continue
      try {
        const path = item.itemPathTemplate.replace(/\{[^}]+\}/, encodeURIComponent(id))
        const result = await get(path)
        if (result && (result._id === id || result.id === id)) return { record: result, navItem: item }
      } catch { /* try next navItem */ }
    }
    return null
  }, [get, navItems])

  // Shared core: resolve a reference field for a set of rows using a known itemPathTemplate.
  const resolveFieldWithTemplate = useCallback(async (fieldKey, rows, itemPathTemplate) => {
    const results = new Map()
    await Promise.all(
      rows.map(async (row) => {
        const rowId = row._id ?? row.id
        if (!rowId) return
        if (!isResolvableValue(row[fieldKey])) return
        try {
          const path = buildItemPath(itemPathTemplate, rowId)
          const resolved = await get(`${path}?filter[lookup][0][prop]=${encodeURIComponent(fieldKey)}`)
          if (resolved && resolved[fieldKey] !== undefined) {
            const fieldVal = resolved[fieldKey]
            const objects = Array.isArray(fieldVal) ? fieldVal : [fieldVal]
            const populated = objects.filter((o) => o && typeof o === 'object')
            results.set(rowId, populated)
          }
        } catch { /* skip rows that fail */ }
      })
    )
    return results
  }, [get])

  // Resolve a reference field for rows of the top-level resource.
  const handleResolveField = useCallback(async (fieldKey, rows) => {
    if (!navItem?.itemPathTemplate || !navItem?.itemMethods?.includes('get')) return new Map()
    return resolveFieldWithTemplate(fieldKey, rows, navItem.itemPathTemplate)
  }, [resolveFieldWithTemplate, navItem?.itemPathTemplate, navItem?.itemMethods])

  // Resolve a reference field using an explicit item path template.
  // Used by synthetic traversal tabs (Related Entity/List) where no traversal path exists.
  const handleResolveFieldWithTemplate = useCallback(async (fieldKey, rows, itemPathTemplate) => {
    if (!itemPathTemplate) return new Map()
    return resolveFieldWithTemplate(fieldKey, rows, itemPathTemplate)
  }, [resolveFieldWithTemplate])

  // Resolve a reference field for traversal items.
  // Finds the navItem whose collectionPath matches the traversal subResource, then uses its itemPathTemplate.
  const handleResolveTraversalField = useCallback(async (fieldKey, rows, traversalPathTemplate) => {
    if (!traversalPathTemplate) return new Map()
    // Extract the subResource path from the traversal path template, e.g.
    // "/api/v1/entities/books/{id}/lists/bookshelves" → "lists/bookshelves"
    const subResourceMatch = traversalPathTemplate.match(/\{[^}]+\}\/(.+)$/)
    const subResource = subResourceMatch?.[1] ?? ''
    // Find the navItem whose collectionPath ends with the subResource
    const lastSeg = subResource.split('/').pop()
    const traversalNavItem = navItems.find((n) => {
      if (!n.itemPathTemplate || !n.itemMethods?.includes('get')) return false
      const path = n.collectionPath ?? ''
      return path.endsWith(`/${subResource}`) || path.endsWith(`/${lastSeg}`)
    })
    if (!traversalNavItem) return new Map()
    return resolveFieldWithTemplate(fieldKey, rows, traversalNavItem.itemPathTemplate)
  }, [resolveFieldWithTemplate, navItems])

  const handleSetSortColumn = useCallback((field, dir) => {
    if (dir !== 'ASC' && dir !== 'DESC') {
      setSortOrder([])
      setPage(0)
      return
    }
    setSortOrder([{ field, dir }])
    setPage(0)
  }, [])

  const handleDeselectFieldFromColumn = useCallback((fieldKey) => {
    setFieldSelectorState((prev) => {
      if (!availableFields.includes(fieldKey)) return prev
      if (!isFieldChecked(fieldKey, prev)) return prev
      const next = toggleFieldSelection(fieldKey, availableFields, prev)
      setHiddenFields((hiddenPrev) => {
        if (!hiddenPrev.has(fieldKey)) return hiddenPrev
        const hiddenNext = new Set(hiddenPrev)
        hiddenNext.delete(fieldKey)
        return hiddenNext
      })
      return next
    })
    setPage(0)
  }, [availableFields])

  const handleHideFieldFromColumn = useCallback((fieldKey) => {
    if (!isFieldChecked(fieldKey, fieldSelectorState)) return
    setHiddenFields((prev) => {
      if (prev.has(fieldKey)) return prev
      const next = new Set(prev)
      next.add(fieldKey)
      return next
    })
  }, [fieldSelectorState])

  const handleApplyFilterFromColumn = useCallback((fieldKey) => {
    if (!fieldKey) return
    setFilterPanelOpen(true)
    setStagedWhereClauses((prev) => [...prev, makeEmptyWhereClause(fieldKey)])
  }, [])

  const columns = useMemo(() => {
    const all = deriveColumns(data)
    return all.filter((col) => isFieldChecked(col.key, fieldSelectorState) && !hiddenFields.has(col.key))
  }, [data, fieldSelectorState, hiddenFields])

  const visibleData = useMemo(() => {
    if (!hideMarkedRows || hiddenRecordIds.size === 0) return data
    return data.filter((row) => {
      const id = row?._id ?? row?.id
      return !id || !hiddenRecordIds.has(id)
    })
  }, [data, hiddenRecordIds, hideMarkedRows])

  useEffect(() => {
    setSelectedRowIds((prev) => {
      if (prev.size === 0) return prev
      const visibleIds = new Set(
        data
          .map((row) => row?._id ?? row?.id)
          .filter((id) => id !== null && id !== undefined && !hiddenRecordIds.has(id))
      )
      const next = new Set([...prev].filter((id) => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [data, hiddenRecordIds])

  const selectedRows = useMemo(() => {
    if (selectedRowIds.size === 0) return []
    return data.filter((row) => selectedRowIds.has(row?._id ?? row?.id))
  }, [data, selectedRowIds])

  useEffect(() => {
    if (hiddenRecordIds.size === 0 || data.length === 0) return
    setHiddenRecordMeta((prev) => {
      let changed = false
      const next = { ...prev }
      for (const row of data) {
        const id = row?._id ?? row?.id
        if (!id || !hiddenRecordIds.has(id)) continue
        if (next[id]?.name) continue
        if (row?._name) {
          next[id] = { name: String(row._name) }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [data, hiddenRecordIds])

  const runBulkMutation = useCallback(async ({ action, rows, mutateRow, fallbackErrorMessage }) => {
    if (!rows || rows.length === 0) return
    let failed = 0
    setToastError(null)
    setBulkProgress({ running: true, action, total: rows.length, processed: 0, failed: 0, currentLabel: '' })
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx]
      const id = row?._id ?? row?.id
      const label = row?._name ? String(row._name) : shortId(id)
      setBulkProgress((prev) => ({ ...prev, processed: idx + 1, currentLabel: label }))
      try {
        await mutateRow(row)
      } catch {
        failed += 1
        setBulkProgress((prev) => ({ ...prev, failed }))
      }
    }
    await refresh()
    setSelectedRowIds(new Set())
    setBulkProgress((prev) => ({ ...prev, running: false, currentLabel: '' }))
    if (failed > 0) {
      setToastError(`${failed} of ${rows.length} operation(s) failed${fallbackErrorMessage ? `: ${fallbackErrorMessage}` : ''}`)
    }
  }, [refresh])

  const handleBulkActivate = useCallback(async () => {
    if (!canActivate || !navItem?.itemPathTemplate) return
    await runBulkMutation({
      action: 'activate',
      rows: selectedRows,
      mutateRow: async (row) => {
      const id = row?._id ?? row?.id
      if (!id) return
      const bothEmpty = !row._validFromDateTime && !row._validUntilDateTime
      const payload = bothEmpty
        ? { _validFromDateTime: new Date().toISOString() }
        : { _validUntilDateTime: null }
      await patch(buildItemPath(navItem.itemPathTemplate, id), payload)
      },
      fallbackErrorMessage: 'activate failed',
    })
  }, [canActivate, navItem?.itemPathTemplate, runBulkMutation, patch, selectedRows])

  const handleBulkDeactivate = useCallback(async () => {
    if (!canDeactivate || !navItem?.itemPathTemplate) return
    await runBulkMutation({
      action: 'deactivate',
      rows: selectedRows,
      mutateRow: async (row) => {
      const id = row?._id ?? row?.id
      if (!id) return
      await patch(buildItemPath(navItem.itemPathTemplate, id), { _validUntilDateTime: new Date().toISOString() })
      },
      fallbackErrorMessage: 'deactivate failed',
    })
  }, [canDeactivate, navItem?.itemPathTemplate, runBulkMutation, patch, selectedRows])

  const handleBulkDelete = useCallback(async () => {
    if (!canDeleteItem || !navItem?.itemPathTemplate) return
    await runBulkMutation({
      action: 'delete',
      rows: selectedRows,
      mutateRow: async (row) => {
      const id = row?._id ?? row?.id
      if (!id) return
      await del(buildItemPath(navItem.itemPathTemplate, id))
      },
      fallbackErrorMessage: 'delete failed',
    })
  }, [canDeleteItem, navItem?.itemPathTemplate, runBulkMutation, del, selectedRows])

  const handleBulkHide = useCallback(async () => {
    if (selectedRows.length === 0) return
    const idsToHide = new Set()
    const metaToHide = {}
    await runBulkMutation({
      action: 'hide',
      rows: selectedRows,
      mutateRow: async (row) => {
        const id = row?._id ?? row?.id
        if (!id) return
        idsToHide.add(id)
        metaToHide[id] = { name: row?._name ? String(row._name) : '' }
      },
      fallbackErrorMessage: '',
    })
    setHiddenRecordIds((prev) => new Set([...prev, ...idsToHide]))
    setHiddenRecordMeta((prev) => ({ ...prev, ...metaToHide }))
  }, [selectedRows, runBulkMutation])

  const selectedCount = selectedRowIds.size
  const bulkProgressPct = bulkProgress.total > 0 ? Math.round((bulkProgress.processed / bulkProgress.total) * 100) : 0

  const hasNextPage = data.length === pageSize

  const fullRequestUrl = `${endpoint ?? ''}${navItem?.collectionPath ?? ''}${querySummary}`

  const handleRowClick = useCallback(
    (row) => {
      if (!navItem?.itemPathTemplate) return
      const id = row?._id ?? row?.id
      if (!id) return
      navigate(`/r/${tagSlug}/item/${encodeURIComponent(id)}`)
    },
    [navigate, navItem?.itemPathTemplate, tagSlug]
  )

  const handleCreate = useCallback(async () => {
    if (!navItem?.collectionPath) return
    setCreateError(null)
    setCreating(true)
    try {
      const payload = createTab === 'form'
        ? buildPayloadFromForm(createFormValues, writableFields)
        : JSON.parse(createPayload || '{}')
      await post(navItem.collectionPath, payload)
      setCreateOpen(false)
      setCreatePayload('{}')
      setCreateFormValues({})
      await refresh()
    } catch (err) {
      setCreateError({
        message: err?.message ?? 'Create failed',
        details: err?.body?.error?.details ?? [],
      })
    } finally {
      setCreating(false)
    }
  }, [post, navItem?.collectionPath, createTab, createPayload, createFormValues, writableFields, refresh])

  const handleCreateTabSwitch = useCallback((tab) => {
    if (tab === 'json' && createTab !== 'json') {
      const payload = buildPayloadFromForm(createFormValues, writableFields)
      setCreatePayload(JSON.stringify(payload, null, 2))
    } else if (tab === 'form' && createTab !== 'form') {
      try {
        const parsed = JSON.parse(createPayload || '{}')
        const newValues = {}
        for (const field of writableFields) {
          if (parsed[field.name] !== undefined) {
            if (field.type === 'array') {
              newValues[field.name] = Array.isArray(parsed[field.name]) ? parsed[field.name] : []
            } else if (field.type === 'object') {
              newValues[field.name] = JSON.stringify(parsed[field.name], null, 2)
            } else {
              newValues[field.name] = String(parsed[field.name])
            }
          }
        }
        setCreateFormValues(newValues)
      } catch { /* invalid JSON, skip sync */ }
    }
    setCreateTab(tab)
  }, [createTab, createFormValues, createPayload, writableFields])

  const curlCommand = useMemo(() => {
    const lines = [`curl '${fullRequestUrl}'`]
    const hdrs = requestHeaders ?? (token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' })
    for (const [key, value] of Object.entries(hdrs)) {
      lines.push(`  -H '${key}: ${value}'`)
    }
    return lines.join(' \\\n')
  }, [fullRequestUrl, requestHeaders, token])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(curlMode ? curlCommand : fullRequestUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard permission denied
    }
  }, [curlMode, curlCommand, fullRequestUrl])

  const handleResizeMouseDown = useCallback((e) => {
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartWidth.current = sidebarWidth

    const onMouseMove = (ev) => {
      if (!isResizing.current) return
      const delta = resizeStartX.current - ev.clientX
      const next = Math.min(800, Math.max(240, resizeStartWidth.current + delta))
      setSidebarWidth(next)
    }

    const onMouseUp = () => {
      isResizing.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  if (!navItem) {
    return (
      <div className="text-slate-400 text-sm p-4">
        Resource not found: <code className="font-mono bg-slate-800 px-1 rounded">{tagSlug}</code>
      </div>
    )
  }

  return (
    <>
    <div className="flex -m-6 min-h-[calc(100vh-3.5rem)]">
      <div className="flex-1 p-6 min-w-0 space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3">
        {/* Left: search */}
        {navItem.hasSearch && (
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name…"
              className="w-full pl-8 pr-7 py-2 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            {searchInput && (
              <button onClick={() => setSearchInput('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label="Clear search">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {selectedCount > 0 && (
          <div className="inline-flex items-center rounded-lg border border-slate-700 divide-x divide-slate-700 overflow-hidden bg-slate-800">
            <span className="px-2.5 py-2 text-[11px] text-slate-300 font-medium">
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={() => setPendingBulkAction('activate')}
              disabled={!canActivate || bulkProgress.running}
              className="px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={canActivate ? 'Activate selected records' : 'Activate is not supported on this resource'}
            >
              Activate
            </button>
            <button
              type="button"
              onClick={() => setPendingBulkAction('deactivate')}
              disabled={!canDeactivate || bulkProgress.running}
              className="px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={canDeactivate ? 'Deactivate selected records' : 'Deactivate is not supported on this resource'}
            >
              Deactivate
            </button>
            <button
              type="button"
              onClick={() => setPendingBulkAction('hide')}
              disabled={bulkProgress.running}
              className="px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Hide selected records in this UI"
            >
              Hide
            </button>
            <button
              type="button"
              onClick={() => setPendingBulkAction('delete')}
              disabled={!canDeleteItem || bulkProgress.running}
              className="px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={canDeleteItem ? 'Delete selected records' : 'Delete is not supported on this resource'}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setSelectedRowIds(new Set())}
              disabled={bulkProgress.running}
              className="px-2 py-2 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Clear selection"
              aria-label="Clear selection"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Right: action buttons */}
        <div className="ml-auto inline-flex rounded-lg border border-slate-700 divide-x divide-slate-700 overflow-hidden">
          {/* Filter */}
          {(() => {
            const activeFilterCount = [
              selectedQ !== null,
              selectedFieldset !== null,
              filterBuilderExpr !== null,
              whereBuilderExpr !== null,
              fieldSelectorState.mode !== 'all',
              hiddenFields.size > 0,
              hiddenRecordIds.size > 0,
              sortOrder.length > 0,
            ].filter(Boolean).length
            return (
              <button
                onClick={() => setFilterPanelOpen((v) => !v)}
                className={`relative flex items-center justify-center w-9 h-9 transition-colors ${
                  filterPanelOpen || activeFilterCount > 0
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
                }`}
                title="Filters"
                aria-label="Filters"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M7 12h10M11 18h2" />
                </svg>
                {activeFilterCount > 0 && !filterPanelOpen && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-300" />
                )}
              </button>
            )
          })()}

          {/* Add New */}
          {canCreate && (
            <button
              onClick={() => { if (!createOpen) { setCreateFormValues({}); setCreatePayload('{}'); setCreateTab('form'); setCreateError(null) } setCreateOpen((v) => !v) }}
              className="flex items-center justify-center w-9 h-9 bg-slate-800 hover:bg-blue-700 text-slate-300 hover:text-white transition-colors"
              title="Add New"
              aria-label="Add New"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}

          {/* Refresh */}
          <button
            onClick={refresh}
            className="flex items-center justify-center w-9 h-9 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Refresh"
            aria-label="Refresh"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Query info */}
          <button
            onClick={() => setQueryInfoOpen((v) => !v)}
            className={`flex items-center justify-center w-9 h-9 transition-colors ${
              queryInfoOpen ? 'bg-blue-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Query info"
            aria-label="Query info"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </div>

      {bulkProgress.running && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-300">
              {bulkProgress.action === 'activate' && 'Activating selected records...'}
              {bulkProgress.action === 'deactivate' && 'Deactivating selected records...'}
              {bulkProgress.action === 'hide' && 'Hiding selected records...'}
              {bulkProgress.action === 'delete' && 'Deleting selected records...'}
            </span>
            <span className="text-slate-500 font-mono">
              {bulkProgress.processed}/{bulkProgress.total}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded bg-slate-800 overflow-hidden">
            <div className="h-full bg-slate-500 transition-all duration-200" style={{ width: `${bulkProgressPct}%` }} />
          </div>
          {bulkProgress.currentLabel && (
            <p className="mt-1 text-[11px] text-slate-500 truncate" title={bulkProgress.currentLabel}>
              Current: {bulkProgress.currentLabel}
            </p>
          )}
        </div>
      )}

      {/* ── Filter panel ── */}
      {filterPanelOpen && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4">

          {/* Panel header */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-200">Filters</p>
            <div className="flex items-center gap-3">
              {[selectedQ !== null, selectedFieldset !== null, filterBuilderExpr !== null, whereBuilderExpr !== null, fieldSelectorState.mode !== 'all', hiddenFields.size > 0, hiddenRecordIds.size > 0, sortOrder.length > 0].some(Boolean) && (
                <button
                  onClick={() => { setSelectedQ(null); setSelectedFieldset(null); setFilterBuilderExpr(null); setWhereBuilderExpr(null); setStagedSetKeys([]); setStagedSetMeta({}); setStagedWhereClauses([]); setWhereInternalOp('and'); setFieldSelectorState({ mode: 'all', selected: new Set() }); setHiddenFields(new Set()); setHiddenRecordIds(new Set()); setHiddenRecordMeta({}); setSortOrder([]); setPage(0) }}
                  className="text-xs text-slate-400 hover:text-blue-400 transition-colors"
                >
                  Clear all
                </button>
              )}
              <button
                onClick={() => setFilterPanelOpen(false)}
                className="flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-white transition-colors"
                aria-label="Close filters"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Quick-filter row: Sets staging, Query, Fieldset, Status, Visibility */}
          <div className="flex flex-wrap gap-6">

            {/* ── Sets staging dropdown ── */}
            {navItem.hasSet && navItem.setSchemaProps && (
              <div className="space-y-1.5" ref={setsDropdownRef}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Sets</p>
                <div className="relative">
                  {/* Trigger row: fused control group */}
                  <div className="flex items-center">
                    <div className="inline-flex h-[30px] overflow-hidden rounded-lg border border-slate-700 bg-slate-800 transition-colors hover:border-slate-500 focus-within:border-slate-500">

                      {/* Dropdown trigger */}
                      <button
                        onClick={() => setSetsDropdownOpen((v) => !v)}
                        className={`flex h-full w-[180px] items-center justify-between bg-slate-800 px-2.5 text-xs transition-colors outline-none hover:text-white focus:outline-none focus:ring-0 ${setsDropdownOpen || stagedSetKeys.length > 0 ? 'text-slate-300' : 'text-slate-300'}`}
                      >
                        <span className="flex-1 min-w-0 truncate text-left mr-1.5">
                          {stagedSetKeys.length > 0
                            ? stagedSetKeys.join(', ')
                            : <span className="text-slate-500">— select sets —</span>}
                        </span>
                        <svg className="w-3 h-3 flex-shrink-0 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>

                      {/* Inject button(s): single "Add" when no existing filter, +and/+or when one exists */}
                      {filterBuilderExpr === null ? (
                        <button
                          disabled={stagedSetKeys.length === 0}
                          onClick={() => {
                            const mergedProps = Object.fromEntries(
                              stagedSetKeys.map((k) => [k, { ...(navItem.setSchemaProps[k] ?? {}), ...(stagedSetMeta[k] ?? {}) }])
                            )
                            const block = buildBlockFromKeys(stagedSetKeys, mergedProps, setsInternalOp)
                            if (!block) return
                            setFilterBuilderExpr(block)
                            setStagedSetKeys([])
                            setStagedSetMeta({})
                            setPage(0)
                          }}
                          title="Add staged sets to the filter"
                          className="flex h-full items-center px-2.5 text-[10px] font-bold font-mono uppercase bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Add
                        </button>
                      ) : (
                        <>
                          <button
                            disabled={stagedSetKeys.length === 0}
                            onClick={() => {
                              const mergedProps = Object.fromEntries(
                                stagedSetKeys.map((k) => [k, { ...(navItem.setSchemaProps[k] ?? {}), ...(stagedSetMeta[k] ?? {}) }])
                              )
                              const block = buildBlockFromKeys(stagedSetKeys, mergedProps, setsInternalOp)
                              if (!block) return
                              setFilterBuilderExpr((prev) => appendBlock(prev, block, 'and'))
                              setStagedSetKeys([])
                              setStagedSetMeta({})
                              setPage(0)
                            }}
                            title="Append staged sets to the filter builder, joined to the existing expression with AND"
                            className="flex h-full items-center px-2.5 text-[10px] font-bold font-mono uppercase bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            +and
                          </button>
                          <button
                            disabled={stagedSetKeys.length === 0}
                            onClick={() => {
                              const mergedProps = Object.fromEntries(
                                stagedSetKeys.map((k) => [k, { ...(navItem.setSchemaProps[k] ?? {}), ...(stagedSetMeta[k] ?? {}) }])
                              )
                              const block = buildBlockFromKeys(stagedSetKeys, mergedProps, setsInternalOp)
                              if (!block) return
                              setFilterBuilderExpr((prev) => appendBlock(prev, block, 'or'))
                              setStagedSetKeys([])
                              setStagedSetMeta({})
                              setPage(0)
                            }}
                            title="Append staged sets to the filter builder, joined to the existing expression with OR"
                            className="flex h-full items-center px-2.5 text-[10px] font-bold font-mono uppercase bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            +or
                          </button>
                        </>
                      )}

                      {/* Clear staged */}
                      {stagedSetKeys.length > 0 && (
                        <button
                          onClick={() => { setStagedSetKeys([]); setStagedSetMeta({}) }}
                          className="flex h-full items-center justify-center px-2 bg-slate-800 text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
                          title="Clear staged selection"
                          aria-label="Clear staged selection"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Dropdown panel */}
                  {setsDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 z-20 min-w-[280px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 space-y-3">

                      {/* AND / OR internal toggle */}
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium shrink-0">Join with</p>
                        <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                          {['or', 'and'].map((op) => (
                            <button
                              key={op}
                              type="button"
                              onClick={() => setSetsInternalOp(op)}
                              className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase border-r border-slate-700 last:border-r-0 transition-colors ${
                                setsInternalOp === op
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                              }`}
                            >
                              {op}
                            </button>
                          ))}
                        </div>
                      </div>

                      <hr className="border-slate-700/60" />

                      {/* Hint */}
                      <p className="text-[10px] text-slate-600 italic">Select sets below, then click <span className="font-bold not-italic text-slate-500">+ and</span> or <span className="font-bold not-italic text-slate-500">+ or</span> to append to the filter.</p>

                      {/* Set checkboxes with optional userIds / groupIds inputs */}
                      {Object.entries(navItem.setSchemaProps).map(([key, meta]) => {
                        const isStaged = stagedSetKeys.includes(key)
                        return (
                          <div key={key}>
                            <label className="flex items-center gap-2 cursor-pointer group/setopt">
                              <input
                                type="checkbox"
                                checked={isStaged}
                                onChange={() => {
                                  setStagedSetKeys((prev) =>
                                    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                                  )
                                  if (isStaged) {
                                    // unchecking — remove its meta entry
                                    setStagedSetMeta((prev) => {
                                      const next = { ...prev }
                                      delete next[key]
                                      return next
                                    })
                                  } else if (meta.isObject) {
                                    // checking an object-type set — seed empty meta entry
                                    setStagedSetMeta((prev) => ({ ...prev, [key]: { userIds: '', groupIds: '' } }))
                                  }
                                }}
                                className="w-3.5 h-3.5 accent-blue-500 cursor-pointer flex-shrink-0"
                              />
                              <span className={`text-xs font-mono ${isStaged ? 'text-blue-300' : 'text-slate-300 group-hover/setopt:text-white'}`}>{key}</span>
                            </label>
                            {isStaged && meta.isObject && (
                              <div className="ml-5 mt-2 space-y-2">
                                <div>
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <p className="text-[10px] text-slate-500">userIds</p>
                                    {jwtSub && (
                                      <button
                                        type="button"
                                        onClick={() => setStagedSetMeta((prev) => {
                                          const cur = prev[key]?.userIds ?? ''
                                          const existing = cur.split(',').map((s) => s.trim()).filter(Boolean)
                                          if (existing.includes(jwtSub)) return prev
                                          const next = [...existing, jwtSub].join(', ')
                                          return { ...prev, [key]: { ...prev[key], userIds: next } }
                                        })}
                                        className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                                      >
                                        add me
                                      </button>
                                    )}
                                  </div>
                                  <input
                                    type="text"
                                    value={stagedSetMeta[key]?.userIds ?? ''}
                                    onChange={(e) => setStagedSetMeta((prev) => ({ ...prev, [key]: { ...prev[key], userIds: e.target.value } }))}
                                    placeholder="user-id-1"
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <p className="text-[10px] text-slate-500">groupIds</p>
                                    {jwtGroups && (
                                      <button
                                        type="button"
                                        onClick={() => setStagedSetMeta((prev) => {
                                          const cur = prev[key]?.groupIds ?? ''
                                          const existing = cur.split(',').map((s) => s.trim()).filter(Boolean)
                                          const toAdd = jwtGroups.filter((g) => !existing.includes(g))
                                          if (!toAdd.length) return prev
                                          const next = [...existing, ...toAdd].join(', ')
                                          return { ...prev, [key]: { ...prev[key], groupIds: next } }
                                        })}
                                        className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                                      >
                                        add my groups
                                      </button>
                                    )}
                                  </div>
                                  <input
                                    type="text"
                                    value={stagedSetMeta[key]?.groupIds ?? ''}
                                    onChange={(e) => setStagedSetMeta((prev) => ({ ...prev, [key]: { ...prev[key], groupIds: e.target.value } }))}
                                    placeholder="group-id-1"
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* ── Query dropdown ── */}
            {qEnumValues && (
              <div className="space-y-1.5" ref={qDropdownRef}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Query</p>
                <div className="relative">
                  <button
                    onClick={() => setQDropdownOpen((v) => !v)}
                    className={`${FILTER_CONTROL_CLASS} flex w-full items-center justify-between`}
                  >
                    <span className="truncate">
                      {selectedQ
                        ? <span className="text-blue-300">{selectedQ}</span>
                        : <span className="text-slate-500">— none —</span>}
                    </span>
                    <svg className="w-3 h-3 ml-1.5 flex-shrink-0 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {qDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                      <div className="max-h-48 overflow-y-auto">
                        <button
                          onClick={() => { setSelectedQ(null); setPage(0); setQDropdownOpen(false) }}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${selectedQ === null ? 'bg-blue-700/40 text-blue-300' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                        >
                          — none —
                        </button>
                        {qEnumValues.map((val) => {
                          const active = selectedQ === val
                          return (
                            <button
                              key={val}
                              onClick={() => { setSelectedQ(active ? null : val); setPage(0); setQDropdownOpen(false) }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${active ? 'bg-blue-700/40 text-blue-300' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                            >
                              {val}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Fieldset dropdown ── */}
            {fieldsetEnumValues && (
              <div className="space-y-1.5" ref={fieldsetDropdownRef}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Fieldset</p>
                <div className="relative">
                  <button
                    onClick={() => setFieldsetDropdownOpen((v) => !v)}
                    className={`${FILTER_CONTROL_CLASS} flex w-full items-center justify-between`}
                  >
                    <span className="truncate">
                      {selectedFieldset
                        ? <span className="text-blue-300">{selectedFieldset}</span>
                        : <span className="text-slate-500">— none —</span>}
                    </span>
                    <svg className="w-3 h-3 ml-1.5 flex-shrink-0 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {fieldsetDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                      <div className="max-h-48 overflow-y-auto">
                        <button
                          onClick={() => { setSelectedFieldset(null); setPage(0); setFieldsetDropdownOpen(false) }}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${selectedFieldset === null ? 'bg-blue-700/40 text-blue-300' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                        >
                          — none —
                        </button>
                        {fieldsetEnumValues.map((val) => {
                          const active = selectedFieldset === val
                          return (
                            <button
                              key={val}
                              onClick={() => { setSelectedFieldset(active ? null : val); setPage(0); setFieldsetDropdownOpen(false) }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${active ? 'bg-blue-700/40 text-blue-300' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                            >
                              {val}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Status dropdown ── */}
            {navItem.hasSet && navItem.hasValidityDates && navItem.setSchemaProps && ['actives', 'pendings', 'expireds'].some((k) => k in navItem.setSchemaProps) && (
              <div className="space-y-1.5" ref={statusDropdownRef}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Status</p>
                {(() => {
                  const statusKeys = ['actives', 'pendings', 'expireds'].filter((k) => k in navItem.setSchemaProps)
                  const visKeys = ['publics', 'protecteds', 'privates'].filter((k) => k in navItem.setSchemaProps)
                  const activeStatusKeys = collectSetKeysFromExpr(filterBuilderExpr, statusKeys)
                  const statusLabel = activeStatusKeys.length === 0
                    ? '— none —'
                    : `${activeStatusKeys.length} selected`

                  return (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setStatusDropdownOpen((v) => !v)}
                        className={`${FILTER_CONTROL_CLASS} min-w-[130px] flex items-center justify-between gap-2`}
                      >
                        <span className={activeStatusKeys.length > 0 ? 'text-blue-300' : 'text-slate-500'}>{statusLabel}</span>
                        <svg className={`w-3 h-3 text-slate-500 transition-transform shrink-0 ${statusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                      {statusDropdownOpen && (
                        <div className="absolute z-30 mt-1 min-w-[190px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-700/60">
                            <button
                              type="button"
                              onClick={() => {
                                setPage(0)
                                setFilterBuilderExpr((prev) => {
                                  const selectedVisibilityKeys = collectSetKeysFromExpr(prev, visKeys)
                                  return buildStatusVisibilityExpr(prev, {
                                    statusKeys,
                                    selectedStatusKeys: statusKeys,
                                    visibilityKeys: visKeys,
                                    selectedVisibilityKeys,
                                    setSchemaProps: navItem.setSchemaProps,
                                  })
                                })
                              }}
                              className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                            >
                              All
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPage(0)
                                setFilterBuilderExpr((prev) => {
                                  const selectedVisibilityKeys = collectSetKeysFromExpr(prev, visKeys)
                                  return buildStatusVisibilityExpr(prev, {
                                    statusKeys,
                                    selectedStatusKeys: [],
                                    visibilityKeys: visKeys,
                                    selectedVisibilityKeys,
                                    setSchemaProps: navItem.setSchemaProps,
                                  })
                                })
                              }}
                              className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                            >
                              None
                            </button>
                          </div>
                          <div className="max-h-44 overflow-y-auto py-1">
                            {statusKeys.map((key) => {
                              const checked = activeStatusKeys.includes(key)
                              return (
                                <label key={key} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-slate-800 group">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setPage(0)
                                      setFilterBuilderExpr((prev) => {
                                        const prevStatusKeys = collectSetKeysFromExpr(prev, statusKeys)
                                        const selectedVisibilityKeys = collectSetKeysFromExpr(prev, visKeys)
                                        const nextStatusKeys = prevStatusKeys.includes(key)
                                          ? prevStatusKeys.filter((k) => k !== key)
                                          : [...prevStatusKeys, key]

                                        return buildStatusVisibilityExpr(prev, {
                                          statusKeys,
                                          selectedStatusKeys: nextStatusKeys,
                                          visibilityKeys: visKeys,
                                          selectedVisibilityKeys,
                                          setSchemaProps: navItem.setSchemaProps,
                                        })
                                      })
                                    }}
                                    className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer shrink-0"
                                  />
                                  <span className="text-xs font-mono text-slate-300 group-hover:text-white truncate">{formatSetChoiceLabel(key)}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ── Visibility dropdown ── */}
            {navItem.hasSet && navItem.setSchemaProps && ['publics', 'protecteds', 'privates'].some((k) => k in navItem.setSchemaProps) && (
              <div className="space-y-1.5" ref={visibilityDropdownRef}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Visibility</p>
                {(() => {
                  const statusKeys = ['actives', 'pendings', 'expireds'].filter((k) => k in navItem.setSchemaProps)
                  const visKeys = ['publics', 'protecteds', 'privates'].filter((k) => k in navItem.setSchemaProps)
                  const activeVisKeys = collectSetKeysFromExpr(filterBuilderExpr, visKeys)
                  const visibilityLabel = activeVisKeys.length === 0
                    ? '— none —'
                    : `${activeVisKeys.length} selected`

                  return (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setVisibilityDropdownOpen((v) => !v)}
                        className={`${FILTER_CONTROL_CLASS} min-w-[140px] flex items-center justify-between gap-2`}
                      >
                        <span className={activeVisKeys.length > 0 ? 'text-blue-300' : 'text-slate-500'}>{visibilityLabel}</span>
                        <svg className={`w-3 h-3 text-slate-500 transition-transform shrink-0 ${visibilityDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                      {visibilityDropdownOpen && (
                        <div className="absolute z-30 mt-1 min-w-[190px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-700/60">
                            <button
                              type="button"
                              onClick={() => {
                                setPage(0)
                                setFilterBuilderExpr((prev) => {
                                  const selectedStatusKeys = collectSetKeysFromExpr(prev, statusKeys)
                                  return buildStatusVisibilityExpr(prev, {
                                    statusKeys,
                                    selectedStatusKeys,
                                    visibilityKeys: visKeys,
                                    selectedVisibilityKeys: visKeys,
                                    setSchemaProps: navItem.setSchemaProps,
                                  })
                                })
                              }}
                              className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                            >
                              All
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPage(0)
                                setFilterBuilderExpr((prev) => {
                                  const selectedStatusKeys = collectSetKeysFromExpr(prev, statusKeys)
                                  return buildStatusVisibilityExpr(prev, {
                                    statusKeys,
                                    selectedStatusKeys,
                                    visibilityKeys: visKeys,
                                    selectedVisibilityKeys: [],
                                    setSchemaProps: navItem.setSchemaProps,
                                  })
                                })
                              }}
                              className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                            >
                              None
                            </button>
                          </div>
                          <div className="max-h-44 overflow-y-auto py-1">
                            {visKeys.map((key) => {
                              const checked = activeVisKeys.includes(key)
                              return (
                                <label key={key} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-slate-800 group">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setPage(0)
                                      setFilterBuilderExpr((prev) => {
                                        const prevVisKeys = collectSetKeysFromExpr(prev, visKeys)
                                        const selectedStatusKeys = collectSetKeysFromExpr(prev, statusKeys)
                                        const nextVisKeys = prevVisKeys.includes(key)
                                          ? prevVisKeys.filter((k) => k !== key)
                                          : [...prevVisKeys, key]

                                        return buildStatusVisibilityExpr(prev, {
                                          statusKeys,
                                          selectedStatusKeys,
                                          visibilityKeys: visKeys,
                                          selectedVisibilityKeys: nextVisKeys,
                                          setSchemaProps: navItem.setSchemaProps,
                                        })
                                      })
                                    }}
                                    className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer shrink-0"
                                  />
                                  <span className="text-xs font-mono text-slate-300 group-hover:text-white truncate">{formatSetChoiceLabel(key)}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ── Field visibility ── */}
            {showFieldSelector && (() => {
              const checkedCount = fieldSelectorState.mode === 'all'
                ? availableFields.length
                : fieldSelectorState.mode === 'none'
                  ? 0
                  : fieldSelectorState.mode === 'include'
                    ? fieldSelectorState.selected.size
                    : availableFields.length - fieldSelectorState.selected.size
              const triggerLabel = fieldSelectorState.mode === 'all'
                ? 'All fields'
                : checkedCount === 0
                  ? 'No fields'
                  : `${checkedCount} field${checkedCount !== 1 ? 's' : ''}`
              const filteredFields = fieldSearch
                ? availableFields.filter((f) => f.toLowerCase().includes(fieldSearch.toLowerCase()))
                : availableFields
              return (
                <div className="flex items-start gap-6">
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Retrieved Fields</p>
                    <div className="relative" ref={fieldDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setFieldDropdownOpen((v) => !v)}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg min-w-[150px] bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                      >
                        <span className={fieldSelectorState.mode === 'all' ? 'text-slate-400' : 'text-blue-300'}>{triggerLabel}</span>
                        <svg className={`w-3 h-3 text-slate-500 transition-transform shrink-0 ${fieldDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                      {fieldDropdownOpen && (
                        <div className="absolute z-30 mt-1 w-full min-w-[200px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                          <div className="relative border-b border-slate-700">
                            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
                            </svg>
                            <input
                              type="text"
                              value={fieldSearch}
                              onChange={(e) => setFieldSearch(e.target.value)}
                              placeholder="Filter fields…"
                              className="w-full pl-7 pr-7 py-1.5 text-xs bg-transparent text-slate-200 placeholder-slate-500 focus:outline-none"
                            />
                            {fieldSearch && (
                              <button onClick={() => setFieldSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label="Clear search">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-700/60">
                            <button onClick={() => setFieldSelectorState({ mode: 'all', selected: new Set() })} className="text-[10px] text-slate-400 hover:text-slate-200 underline">All</button>
                            <button onClick={() => { setFieldSelectorState({ mode: 'none', selected: new Set() }); setHiddenFields(new Set()) }} className="text-[10px] text-slate-400 hover:text-slate-200 underline">None</button>
                          </div>
                          <div className="max-h-52 overflow-y-auto py-1">
                            {availableFields.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-slate-500">No fields found.</p>
                            ) : filteredFields.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-slate-500">No match for &ldquo;{fieldSearch}&rdquo;.</p>
                            ) : filteredFields.map((field) => {
                              const checked = isFieldChecked(field, fieldSelectorState)
                              return (
                                <label key={field} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-slate-800 group">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setFieldSelectorState((prev) => {
                                        const wasChecked = isFieldChecked(field, prev)
                                        const next = toggleFieldSelection(field, availableFields, prev)
                                        const isCheckedNext = isFieldChecked(field, next)
                                        if (wasChecked && !isCheckedNext) {
                                          setHiddenFields((hiddenPrev) => {
                                            if (!hiddenPrev.has(field)) return hiddenPrev
                                            const hiddenNext = new Set(hiddenPrev)
                                            hiddenNext.delete(field)
                                            return hiddenNext
                                          })
                                        }
                                        return next
                                      })
                                    }}
                                    className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer shrink-0"
                                  />
                                  <span className="text-xs font-mono text-slate-300 group-hover:text-white truncate">{field}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Hidden Fields</p>
                    <div className="relative" ref={hiddenFieldDropdownRef}>
                      {(() => {
                        const retrievedFields = availableFields.filter((field) => isFieldChecked(field, fieldSelectorState))
                        const hiddenRetrievedCount = retrievedFields.filter((field) => hiddenFields.has(field)).length
                        const hiddenTriggerLabel = hiddenRetrievedCount === 0 ? 'No hidden fields' : `${hiddenRetrievedCount} hidden`
                        const hiddenSearch = hiddenFieldSearch.trim().toLowerCase()
                        const filteredRetrievedFields = hiddenSearch
                          ? retrievedFields.filter((field) => field.toLowerCase().includes(hiddenSearch))
                          : retrievedFields
                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => setHiddenFieldDropdownOpen((v) => !v)}
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                            >
                              <span className={hiddenRetrievedCount > 0 ? 'text-amber-300' : 'text-slate-400'}>{hiddenTriggerLabel}</span>
                              <svg className={`w-3 h-3 text-slate-500 transition-transform shrink-0 ${hiddenFieldDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                              </svg>
                            </button>
                            {hiddenFieldDropdownOpen && (
                              <div className="absolute z-30 mt-1 w-full min-w-[220px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                                <div className="relative border-b border-slate-700">
                                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
                                  </svg>
                                  <input
                                    type="text"
                                    value={hiddenFieldSearch}
                                    onChange={(e) => setHiddenFieldSearch(e.target.value)}
                                    placeholder="Filter retrieved fields…"
                                    className="w-full pl-7 pr-7 py-1.5 text-xs bg-transparent text-slate-200 placeholder-slate-500 focus:outline-none"
                                  />
                                  {hiddenFieldSearch && (
                                    <button onClick={() => setHiddenFieldSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label="Clear hidden field search">
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-700/60">
                                  <button
                                    onClick={() => setHiddenFields(new Set(retrievedFields))}
                                    className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                                  >
                                    All
                                  </button>
                                  <button
                                    onClick={() => setHiddenFields(new Set())}
                                    className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                                  >
                                    None
                                  </button>
                                </div>
                                <div className="max-h-52 overflow-y-auto py-1">
                                  {retrievedFields.length === 0 ? (
                                    <p className="px-3 py-2 text-xs text-slate-500">No retrieved fields selected.</p>
                                  ) : filteredRetrievedFields.length === 0 ? (
                                    <p className="px-3 py-2 text-xs text-slate-500">No match for &ldquo;{hiddenFieldSearch}&rdquo;.</p>
                                  ) : filteredRetrievedFields.map((field) => {
                                    const checked = hiddenFields.has(field)
                                    return (
                                      <label key={field} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-slate-800 group">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            setHiddenFields((prev) => {
                                              const next = new Set(prev)
                                              if (next.has(field)) next.delete(field)
                                              else next.add(field)
                                              return next
                                            })
                                          }}
                                          className="w-3.5 h-3.5 rounded accent-amber-500 cursor-pointer shrink-0"
                                        />
                                        <span className="text-xs font-mono text-slate-300 group-hover:text-white truncate">{field}</span>
                                      </label>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )
            })()}

          </div>

          {filterBuilderExpr && (
            <VisualFilterBuilder
              expr={filterBuilderExpr}
              onChange={(next) => { setFilterBuilderExpr(next); setPage(0) }}
            />
          )}

          {/* ── Field where-filter builder (separate section) ── */}
          {navItem.hasFilterWhere && (
            <>
              <hr className="border-slate-700" />
              <div className="space-y-1.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Field Filters</p>
                <div className="space-y-2.5">
                  {stagedWhereClauses.length > 0 && (
                    <div className="space-y-2">
                      {stagedWhereClauses.map((clause) => {
                        const needsSecondValue = WHERE_OP_SECOND_VALUE.has(clause.op)
                        const isListOp = clause.op === 'inq' || clause.op === 'nin'
                        return (
                          <div key={clause.id} className="grid grid-cols-[minmax(120px,1fr)_minmax(100px,130px)_minmax(140px,1fr)_auto] gap-2 items-start">
                            <select
                              value={clause.field}
                              onChange={(e) => setStagedWhereClauses((prev) => prev.map((c) => c.id === clause.id ? { ...c, field: e.target.value } : c))}
                              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">field…</option>
                              {availableFields.map((f) => <option key={f} value={f}>{f}</option>)}
                            </select>
                            <select
                              value={clause.op}
                              onChange={(e) => setStagedWhereClauses((prev) => prev.map((c) => c.id === clause.id ? { ...c, op: e.target.value } : c))}
                              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              {WHERE_OPERATOR_OPTIONS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                            </select>
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={clause.value}
                                onChange={(e) => setStagedWhereClauses((prev) => prev.map((c) => c.id === clause.id ? { ...c, value: e.target.value } : c))}
                                placeholder={isListOp ? 'v1, v2, v3' : 'value'}
                                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              {needsSecondValue && (
                                <input
                                  type="text"
                                  value={clause.value2}
                                  onChange={(e) => setStagedWhereClauses((prev) => prev.map((c) => c.id === clause.id ? { ...c, value2: e.target.value } : c))}
                                  placeholder="second value"
                                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setStagedWhereClauses((prev) => prev.filter((c) => c.id !== clause.id))}
                              className="mt-1 text-slate-500 hover:text-rose-400 transition-colors"
                              aria-label="Remove clause"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {stagedWhereClauses.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">Join staged with</span>
                      <div className="inline-flex rounded border border-slate-700 overflow-hidden">
                        {['and', 'or'].map((op) => (
                          <button
                            key={op}
                            type="button"
                            onClick={() => setWhereInternalOp(op)}
                            className={`px-2 py-0.5 text-[10px] font-mono uppercase border-r border-slate-700 last:border-r-0 transition-colors ${
                              whereInternalOp === op
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                            }`}
                          >
                            {op}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStagedWhereClauses((prev) => [...prev, makeEmptyWhereClause()])}
                      className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      Add Clause
                    </button>

                    {whereBuilderExpr === null ? (
                      stagedWhereClauses.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const block = buildWhereBlockFromClauses(stagedWhereClauses, whereInternalOp)
                            if (!block) return
                            setWhereBuilderExpr(block)
                            setStagedWhereClauses([])
                            setWhereInternalOp('and')
                            setPage(0)
                          }}
                          className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                        >
                          Apply
                        </button>
                      )
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const block = buildWhereBlockFromClauses(stagedWhereClauses, whereInternalOp)
                            if (!block) return
                            setWhereBuilderExpr((prev) => appendWhereBlock(prev, block, 'and'))
                            setStagedWhereClauses([])
                            setWhereInternalOp('and')
                            setPage(0)
                          }}
                          disabled={stagedWhereClauses.length === 0}
                          className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          +and
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const block = buildWhereBlockFromClauses(stagedWhereClauses, whereInternalOp)
                            if (!block) return
                            setWhereBuilderExpr((prev) => appendWhereBlock(prev, block, 'or'))
                            setStagedWhereClauses([])
                            setWhereInternalOp('and')
                            setPage(0)
                          }}
                          disabled={stagedWhereClauses.length === 0}
                          className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          +or
                        </button>
                      </>
                    )}

                    {stagedWhereClauses.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setStagedWhereClauses([]); setWhereInternalOp('and') }}
                        className="px-2 py-1 text-xs text-slate-500 hover:text-slate-200"
                      >
                        Clear staged
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {navItem.hasFilterWhere && whereBuilderExpr && (
            <VisualWhereFilterBuilder
              expr={whereBuilderExpr}
              onChange={(next) => { setWhereBuilderExpr(next); setPage(0) }}
            />
          )}

          {/* Sort */}
          {navItem.hasFilterOrder && (
            <>
              <hr className="border-slate-700" />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Sort</p>
                  {sortOrder.length > 0 && (
                    <button
                      onClick={() => { setSortOrder([]); setPage(0) }}
                      className="text-xs text-slate-400 hover:text-slate-200 underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {sortOrder.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-500 w-4 flex-shrink-0">{i + 1}.</span>
                    <select
                      value={entry.field}
                      onChange={(e) => setSortOrder((prev) => prev.map((s, idx) => idx === i ? { ...s, field: e.target.value } : s))}
                      className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {availableFields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <button
                      onClick={() => setSortOrder((prev) => prev.map((s, idx) => idx === i ? { ...s, dir: s.dir === 'ASC' ? 'DESC' : 'ASC' } : s))}
                      className="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-mono flex-shrink-0"
                    >
                      {entry.dir === 'ASC' ? (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      )}
                      {entry.dir}
                    </button>
                    <button
                      onClick={() => { setSortOrder((prev) => prev.filter((_, idx) => idx !== i)); setPage(0) }}
                      className="flex-shrink-0 text-slate-500 hover:text-rose-400 transition-colors"
                      aria-label="Remove sort"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}

                <button
                  onClick={() => setSortOrder((prev) => [...prev, { field: availableFields[0] ?? '_id', dir: 'ASC' }])}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add sort field
                </button>

                {sortOrder.length > 0 && (
                  <p className="text-[10px] text-slate-500 font-mono">
                    {sortOrder.map((s) => `${s.field} ${s.dir}`).join(', ')}
                  </p>
                )}
              </div>
            </>
          )}

          <hr className="border-slate-700" />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Row Visibility</p>
              <span className="text-[10px] text-slate-500 font-mono">
                hidden ids: {hiddenRecordIds.size}
              </span>
            </div>

            <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setHideMarkedRows(true)}
                className={`px-3 py-1.5 text-xs transition-colors ${hideMarkedRows ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
              >
                Hide marked rows
              </button>
              <span className="w-px bg-slate-700" />
              <button
                type="button"
                onClick={() => setHideMarkedRows(false)}
                className={`px-3 py-1.5 text-xs transition-colors ${!hideMarkedRows ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
              >
                Show all rows
              </button>
            </div>

            {hiddenRecordIds.size === 0 ? (
              <p className="text-xs text-slate-500">No hidden records.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {[...hiddenRecordIds].map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] text-slate-300" title={id}>
                      <span className="max-w-[220px] truncate">{hiddenRecordMeta[id]?.name || 'no _name'}</span>
                      <span className="text-slate-500 font-mono">{shortId(id)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setHiddenRecordIds((prev) => {
                            const next = new Set(prev)
                            next.delete(id)
                            return next
                          })
                          setHiddenRecordMeta((prev) => {
                            if (!(id in prev)) return prev
                            const next = { ...prev }
                            delete next[id]
                            return next
                          })
                        }}
                        className="text-slate-500 hover:text-slate-200"
                        title="Unhide record"
                        aria-label="Unhide record"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHiddenRecordIds(new Set())
                    setHiddenRecordMeta({})
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200 underline"
                >
                  Unhide all records
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setCreateOpen(false)}
          />
          {/* Modal panel */}
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
            <p className="text-sm font-semibold text-slate-200">Create new item</p>
            <button
              onClick={() => setCreateOpen(false)}
              className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tab bar */}
          {writableFields.length > 0 && (
            <div className="flex border-b border-slate-700 px-4 shrink-0">
              <button
                onClick={() => handleCreateTabSwitch('form')}
                className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  createTab === 'form'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Form
              </button>
              <button
                onClick={() => handleCreateTabSwitch('json')}
                className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  createTab === 'json'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                JSON
              </button>
            </div>
          )}

          {/* Content */}
          <div className="p-4 space-y-4 overflow-y-auto">

          {/* Form tab */}
          {createTab === 'form' && writableFields.length > 0 && (
            <div className="space-y-3">
              {primaryCreateFields.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  {primaryCreateFields.map((field) => (
                    <div key={field.name} className="flex flex-col gap-1">
                      <label className="text-xs text-slate-400 font-mono flex items-center gap-0.5">
                        {field.name}
                        {field.required && <span className="text-red-400">*</span>}
                      </label>
                      {renderCreateField(
                        field,
                        createFormValues[field.name],
                        (v) => setCreateFormValues((prev) => ({ ...prev, [field.name]: v }))
                      )}
                      {field.description && (
                        <p className="text-[10px] text-slate-500">{field.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {primaryCreateFields.length > 0 && managedCreateFields.length > 0 && (
                <hr className="border-slate-700" />
              )}
              {managedCreateFields.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  {managedCreateFields.map((field) => (
                    <div key={field.name} className="flex flex-col gap-1">
                      <label className="text-xs text-slate-400 font-mono flex items-center gap-0.5">
                        {field.name}
                        {field.required && <span className="text-red-400">*</span>}
                      </label>
                      {renderCreateField(
                        field,
                        createFormValues[field.name],
                        (v) => setCreateFormValues((prev) => ({ ...prev, [field.name]: v }))
                      )}
                      {field.description && (
                        <p className="text-[10px] text-slate-500">{field.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* JSON tab (or fallback when no schema) */}
          {(createTab === 'json' || writableFields.length === 0) && (
            <textarea
              rows={12}
              value={createPayload}
              onChange={(e) => setCreatePayload(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setCreateOpen(false)}
              className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
            >
              Cancel
            </button>
          </div>

          {/* Validation errors */}
          {createError && (
            <div className="text-red-400 text-sm space-y-1">
              <p>{createError.message}</p>
              {createError.details?.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5 text-red-300">
                  {createError.details.map((d, i) => (
                    <li key={i}>{d.field ? `${d.field}: ${d.message}` : d.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        </div>
        </div>
      )}

      {/* Traversal create modal */}
      {traversalCreateState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTraversalCreateState(null)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
              <p className="text-sm font-semibold text-slate-200">
                Add to <span className="text-blue-400">{traversalCreateState.traversal.label}</span>
              </p>
              <button
                onClick={() => setTraversalCreateState(null)}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tab bar */}
            {traversalCreateWritableFields.length > 0 && (
              <div className="flex border-b border-slate-700 px-4 shrink-0">
                <button
                  onClick={() => handleTraversalCreateTabSwitch('form')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    traversalCreateTab === 'form'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Form
                </button>
                <button
                  onClick={() => handleTraversalCreateTabSwitch('json')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    traversalCreateTab === 'json'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  JSON
                </button>
              </div>
            )}

            {/* Content */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1">

              {/* Form tab */}
              {traversalCreateTab === 'form' && traversalCreateWritableFields.length > 0 && (() => {
                const primaryFields = traversalCreateWritableFields.filter((f) => !f.name.startsWith('_') || f.name === '_name')
                const managedFields = traversalCreateWritableFields.filter((f) => f.name.startsWith('_') && f.name !== '_name')
                const nameField = primaryFields.find((f) => f.name === '_name')
                const otherPrimary = primaryFields.filter((f) => f.name !== '_name')
                const orderedPrimary = nameField ? [nameField, ...otherPrimary] : otherPrimary
                return (
                  <div className="space-y-3">
                    {orderedPrimary.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        {orderedPrimary.map((field) => (
                          <div key={field.name} className="flex flex-col gap-1">
                            <label className="text-xs text-slate-400 font-mono flex items-center gap-0.5">
                              {field.name}
                              {field.required && <span className="text-red-400">*</span>}
                            </label>
                            {renderCreateField(
                              field,
                              traversalCreateFormValues[field.name],
                              (v) => setTraversalCreateFormValues((prev) => ({ ...prev, [field.name]: v }))
                            )}
                            {field.description && <p className="text-[10px] text-slate-500">{field.description}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {orderedPrimary.length > 0 && managedFields.length > 0 && <hr className="border-slate-700" />}
                    {managedFields.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        {managedFields.map((field) => (
                          <div key={field.name} className="flex flex-col gap-1">
                            <label className="text-xs text-slate-400 font-mono flex items-center gap-0.5">
                              {field.name}
                              {field.required && <span className="text-red-400">*</span>}
                            </label>
                            {renderCreateField(
                              field,
                              traversalCreateFormValues[field.name],
                              (v) => setTraversalCreateFormValues((prev) => ({ ...prev, [field.name]: v }))
                            )}
                            {field.description && <p className="text-[10px] text-slate-500">{field.description}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* JSON tab (or fallback when no schema) */}
              {(traversalCreateTab === 'json' || traversalCreateWritableFields.length === 0) && (
                <textarea
                  rows={12}
                  value={traversalCreatePayload}
                  onChange={(e) => setTraversalCreatePayload(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  spellCheck={false}
                  autoFocus={traversalCreateWritableFields.length === 0}
                />
              )}

            </div>

            {/* Sticky footer: error + actions */}
            <div className="px-4 pb-4 pt-3 space-y-3 shrink-0 border-t border-slate-700/50">
              {/* Validation errors */}
              {traversalCreateError && (
                <div className="text-red-400 text-sm space-y-1">
                  <p>{traversalCreateError.message}</p>
                  {traversalCreateError.details?.length > 0 && (
                    <ul className="list-disc list-inside space-y-0.5 text-red-300">
                      {traversalCreateError.details.map((d, i) => (
                        <li key={i}>{d.path ? `${d.path}: ${d.message}` : d.field ? `${d.field}: ${d.message}` : d.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTraversalCreate}
                  disabled={traversalCreating}
                  className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
                >
                  {traversalCreating ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => setTraversalCreateState(null)}
                  className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Relate modal (bidirectional: entity→pick list, or list→pick entity) */}
      {listRelateState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setListRelateState(null)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
              <div>
                <p className="text-sm font-semibold text-slate-200">
                  {listRelateState.mode === 'entity-pick' ? 'Add entity to list' : 'Relate to existing list'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">via <span className="text-slate-400">{listRelateState.traversal.label}</span></p>
              </div>
              <button
                onClick={() => setListRelateState(null)}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable content */}
            <div className="px-4 pt-2 pb-2 space-y-4 overflow-y-auto flex-1">

              {/* Relationship type selector (shown only when multiple options exist) */}
              {(listRelateState.relevantRelations ?? listRelationNavItems).length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Relationship type</p>
                  <div className="flex flex-wrap gap-2">
                    {(listRelateState.relevantRelations ?? listRelationNavItems).map((ri) => (
                      <button
                        key={ri.id}
                        onClick={() => { setListRelateRelation(ri); setListRelateFormValues({}) }}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          listRelateRelation?.id === ri.id
                            ? 'bg-blue-700 border-blue-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {ri.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Item picker (entity or list depending on mode) */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                  {listRelateState.mode === 'entity-pick' ? 'Select entity' : 'Select list'}
                  {listRelateSelectedList && (
                    <span className="ml-2 normal-case font-normal text-emerald-400">
                      ✓ {listRelateSelectedList._name ?? listRelateSelectedList._id}
                    </span>
                  )}
                </p>
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
                  </svg>
                  <input
                    type="text"
                    value={listRelateSearch}
                    onChange={(e) => { setListRelateSearch(e.target.value); setListRelatePage(0) }}
                    placeholder="Search by name…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="rounded-lg border border-slate-700 overflow-hidden">
                  {listRelateSearchLoading && (
                    <div className="flex items-center justify-center py-6 text-slate-500 text-xs">Loading…</div>
                  )}
                  {!listRelateSearchLoading && listRelateResults.length === 0 && (
                    <div className="flex items-center justify-center py-6 text-slate-500 text-xs">No results</div>
                  )}
                  {!listRelateSearchLoading && listRelateResults.map((r) => {
                    const id = r._id ?? r.id
                    const isSelected = (listRelateSelectedList?._id ?? listRelateSelectedList?.id) === id
                    return (
                      <button
                        key={id}
                        onClick={() => setListRelateSelectedList(r)}
                        className={`w-full text-left flex items-center justify-between px-3 py-2 text-xs border-b border-slate-800 last:border-0 transition-colors ${
                          isSelected ? 'bg-blue-900/40 text-blue-300' : 'hover:bg-slate-800 text-slate-300'
                        }`}
                      >
                        <span className="font-mono truncate">{r._name ?? id}</span>
                        <span className="shrink-0 ml-2 text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{r._sourceNavItem?.label ?? ''}</span>
                      </button>
                    )
                  })}
                </div>
                {/* Picker pagination */}
                {(listRelatePage > 0 || listRelateHasMore) && (
                  <div className="flex items-center justify-between pt-1.5">
                    <button
                      onClick={() => setListRelatePage((p) => Math.max(0, p - 1))}
                      disabled={listRelatePage === 0}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    >← Prev</button>
                    <span className="text-[10px] text-slate-500">Page {listRelatePage + 1}</span>
                    <button
                      onClick={() => setListRelatePage((p) => p + 1)}
                      disabled={!listRelateHasMore}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    >Next →</button>
                  </div>
                )}
              </div>

              {/* Auto-filled IDs preview */}
              {(listRelateState.row || listRelateSelectedList) && (
                <div className="flex gap-3 text-[10px] font-mono text-slate-500">
                  {listRelateState.mode === 'entity-pick' ? (
                    <>
                      <span>_listId: <span className="text-slate-300">{listRelateState.row?._id ?? listRelateState.row?.id ?? '—'}</span></span>
                      <span>_entityId: <span className={listRelateSelectedList ? 'text-emerald-400' : 'text-slate-600'}>{listRelateSelectedList?._id ?? listRelateSelectedList?.id ?? '—'}</span></span>
                    </>
                  ) : (
                    <>
                      <span>_entityId: <span className="text-slate-300">{listRelateState.row?._id ?? listRelateState.row?.id ?? '—'}</span></span>
                      <span>_listId: <span className={listRelateSelectedList ? 'text-emerald-400' : 'text-slate-600'}>{listRelateSelectedList?._id ?? listRelateSelectedList?.id ?? '—'}</span></span>
                    </>
                  )}
                </div>
              )}

              {/* Extra relation fields */}
              {listRelateRelation && listRelateWritableFields.length > 0 && (
                <>
                  <hr className="border-slate-700" />
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Relationship details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                      {listRelateWritableFields.map((field) => (
                        <div key={field.name} className="flex flex-col gap-1">
                          <label className="text-xs text-slate-400 font-mono flex items-center gap-0.5">
                            {field.name}
                            {field.required && <span className="text-red-400">*</span>}
                          </label>
                          {renderCreateField(
                            field,
                            listRelateFormValues[field.name],
                            (v) => setListRelateFormValues((prev) => ({ ...prev, [field.name]: v }))
                          )}
                          {field.description && <p className="text-[10px] text-slate-500">{field.description}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Sticky footer: error + actions */}
            <div className="px-4 pb-4 pt-3 space-y-3 shrink-0 border-t border-slate-700/50">
              {/* Error */}
              {listRelateError && (
                <div className="text-red-400 text-sm space-y-1">
                  <p>{listRelateError.message}</p>
                  {listRelateError.details?.length > 0 && (
                    <ul className="list-disc list-inside space-y-0.5 text-red-300">
                      {listRelateError.details.map((d, i) => (
                        <li key={i}>{d.path ? `${d.path}: ${d.message}` : d.field ? `${d.field}: ${d.message}` : d.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleListRelateSubmit}
                  disabled={listRelating || !listRelateRelation || !listRelateSelectedList}
                  className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                >
                  {listRelating ? 'Saving…' : 'Save relation'}
                </button>
                <button
                  onClick={() => setListRelateState(null)}
                  className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <DataGrid
          columns={columns}
          data={visibleData}
          loading={loading}
          error={error}
          onRefresh={refresh}
          onRowClick={navItem?.itemPathTemplate ? handleRowClick : undefined}
          hasValidityDates={navItem?.hasValidityDates && isFieldChecked('_validFromDateTime', fieldSelectorState) && isFieldChecked('_validUntilDateTime', fieldSelectorState)}
          onRowDelete={canDeleteItem ? handleDeleteRow : undefined}
          onRowActivate={canActivate ? handleActivateRow : undefined}
          onRowDeactivate={canDeactivate ? handleDeactivateRow : undefined}
          sortOrder={sortOrder}
          onSetSortColumn={navItem?.hasFilterOrder ? handleSetSortColumn : undefined}
          traversals={navItem?.children ?? []}
          onFetchItem={navItem?.itemPathTemplate ? handleFetchItem : undefined}
          onFetchTraversal={handleFetchTraversal}
          onTraversalPost={handleTraversalPost}
          onTraversalOpenCreate={handleTraversalOpenCreate}
          onTraversalDeleteAll={handleTraversalDeleteAll}
          onTraversalPatchAll={handleTraversalPatchAll}
          onFetchRelatedRecord={handleFetchRelatedRecord}
          onResolveField={navItem?.itemPathTemplate && navItem?.itemMethods?.includes('get') ? handleResolveField : undefined}
          onResolveTraversalField={handleResolveTraversalField}
          onResolveFieldWithTemplate={handleResolveFieldWithTemplate}
          onTraversalRelateToList={handleTraversalRelateToList}
          onColumnApplyFilter={navItem?.hasFilterWhere ? handleApplyFilterFromColumn : undefined}
          onColumnDeselectField={handleDeselectFieldFromColumn}
          onColumnHideField={handleHideFieldFromColumn}
          selectedRowIds={selectedRowIds}
          onToggleRowSelect={(id) => {
            setSelectedRowIds((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }}
          onToggleAllRowsSelect={(selectAll) => {
            setSelectedRowIds((prev) => {
              const next = new Set(prev)
              for (const row of visibleData) {
                const id = row?._id ?? row?.id
                if (id === null || id === undefined) continue
                if (selectAll) next.add(id)
                else next.delete(id)
              }
              return next
            })
          }}
          relateTraversalIds={relateTraversalIds}
          externalRefreshKey={traversalRefreshSignal}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {!loading && !error && (
            <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
              <span>
                {`${data.length} record(s) returned`}
              </span>
            </div>
          )}
        </div>

        {navItem?.hasPagination && (
        <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNextPage || loading}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
          <label className="text-xs text-slate-400 flex items-center gap-1.5">
            Page size
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(0)
              }}
              className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-slate-300"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-slate-500 font-mono">
            page={page + 1} offset={page * pageSize}
          </span>
        </div>
        )}
      </div>

      <Toast message={toastError} onClose={() => setToastError(null)} type="error" />

      <ConfirmDialog
        open={pendingBulkAction === 'activate'}
        title="Activate selected records?"
        message={`This will process ${selectedCount} selected record(s) one-by-one.`}
        confirmLabel="Yes, activate"
        confirmVariant="success"
        onConfirm={async () => {
          setPendingBulkAction(null)
          await handleBulkActivate()
        }}
        onCancel={() => setPendingBulkAction(null)}
      />
      <ConfirmDialog
        open={pendingBulkAction === 'deactivate'}
        title="Deactivate selected records?"
        message={`This will process ${selectedCount} selected record(s) one-by-one.`}
        confirmLabel="Yes, deactivate"
        confirmVariant="warning"
        onConfirm={async () => {
          setPendingBulkAction(null)
          await handleBulkDeactivate()
        }}
        onCancel={() => setPendingBulkAction(null)}
      />
      <ConfirmDialog
        open={pendingBulkAction === 'hide'}
        title="Hide selected records?"
        message={`This will hide ${selectedCount} selected record(s) from this UI only.`}
        confirmLabel="Yes, hide"
        confirmVariant="warning"
        onConfirm={async () => {
          setPendingBulkAction(null)
          await handleBulkHide()
        }}
        onCancel={() => setPendingBulkAction(null)}
      />
      <ConfirmDialog
        open={pendingBulkAction === 'delete'}
        title="Delete selected records?"
        message={`This will delete ${selectedCount} selected record(s) one-by-one. This cannot be undone.`}
        confirmLabel="Yes, delete"
        confirmVariant="danger"
        onConfirm={async () => {
          setPendingBulkAction(null)
          await handleBulkDelete()
        }}
        onCancel={() => setPendingBulkAction(null)}
      />
      </div>

      {queryInfoOpen && (
        <div
          className="flex-shrink-0 border-l border-slate-700 bg-slate-900 flex flex-col overflow-hidden relative"
          style={{ width: sidebarWidth }}
        >
          {/* Resize handle */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/40 transition-colors z-10"
            title="Drag to resize"
          />

          {/* Tabs + close button */}
          <div className="flex items-center border-b border-slate-800 flex-shrink-0">
            {['request', 'identity'].map((tab) => (
              <button
                key={tab}
                onClick={() => setQueryInfoTab(tab)}
                className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
                  queryInfoTab === tab
                    ? 'text-blue-400 border-b-2 border-blue-500 -mb-px bg-slate-900'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
            <button
              onClick={() => setQueryInfoOpen(false)}
              className="px-3 py-2 text-slate-500 hover:text-slate-300"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">

            {queryInfoTab === 'identity' && (
              <IdentityTab token={token} />
            )}

            {queryInfoTab === 'request' && (
            <>
            {/* ── REQUEST ── */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Request</p>

              {/* Method badge + URL/cURL toggle */}
              <div className="flex items-center justify-between gap-2">
                <span className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-blue-700 text-white tracking-wide">GET</span>
                <div className="flex items-center bg-slate-800 rounded-md p-0.5 text-xs gap-0.5">
                  <button
                    onClick={() => setCurlMode(false)}
                    className={`px-2.5 py-0.5 rounded transition-colors ${!curlMode ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    URL
                  </button>
                  <button
                    onClick={() => setCurlMode(true)}
                    className={`px-2.5 py-0.5 rounded transition-colors ${curlMode ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    cURL
                  </button>
                </div>
              </div>

              {/* Copyable URL / cURL box */}
              <button
                onClick={handleCopy}
                className={`w-full text-left text-xs font-mono rounded-lg px-3 py-2 border flex items-start gap-2 group transition-colors ${
                  copied
                    ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <span className="flex-1 break-all whitespace-pre-wrap">{curlMode ? curlCommand : fullRequestUrl}</span>
                <span className="flex-shrink-0 mt-0.5">
                  {copied ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </span>
              </button>

              {/* Applied set filters (derived from filterBuilderExpr) */}
              {filterBuilderExpr && (() => {
                const collectKeys = (node) => {
                  if (!node) return []
                  if (node.type === 'set') return [node.key]
                  if (node.type === 'group') return collectKeys(node.child)
                  if (node.type === 'or' || node.type === 'and') return node.children.flatMap(collectKeys)
                  return []
                }
                const keys = collectKeys(filterBuilderExpr)
                if (!keys.length) return null
                return (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Set filter</p>
                    <div className="flex flex-wrap gap-1.5">
                      {keys.map((k) => (
                        <span key={k} className="px-2 py-0.5 text-xs rounded-md bg-violet-600/20 text-violet-300 border border-violet-700 font-mono">{k}</span>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {whereBuilderExpr && (() => {
                const collectConditions = (node) => {
                  if (!node) return []
                  if (node.type === 'condition') return [node]
                  if (node.type === 'group') return collectConditions(node.child)
                  if (node.type === 'or' || node.type === 'and') return node.children.flatMap(collectConditions)
                  return []
                }
                const conditions = collectConditions(whereBuilderExpr)
                if (!conditions.length) return null
                return (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Field filter</p>
                    <div className="flex flex-wrap gap-1.5">
                      {conditions.map((c, idx) => (
                        <span key={`${c.field}-${c.op}-${idx}`} className="px-2 py-0.5 text-xs rounded-md bg-blue-600/20 text-blue-300 border border-blue-700 font-mono">
                          {c.op === 'between'
                            ? `${c.field} between ${c.value} and ${c.value2}`
                            : c.op === 'inq' || c.op === 'nin'
                              ? `${c.field} ${c.op} [${c.value}]`
                              : `${c.field} ${c.op} ${c.value}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })()}

            </div>

            {/* ── RESPONSE ── */}
            {responseStatus !== null && (
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Response</p>

                {/* Status + Duration */}
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 text-xs font-mono font-bold rounded ${responseStatus >= 200 && responseStatus < 300 ? 'bg-emerald-800 text-emerald-100' : 'bg-rose-800 text-rose-100'}`}>
                    {responseStatus}
                  </span>
                  {queryDuration !== null && (
                    <span className="text-xs text-slate-400 font-mono">{queryDuration} ms</span>
                  )}
                </div>

                {/* Response headers */}
                {responseHeaders && Object.keys(responseHeaders).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Headers</p>
                    <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 overflow-hidden">
                      {Object.entries(responseHeaders).map(([key, value]) => (
                        <div key={key} className="px-3 py-1.5 bg-slate-950">
                          <p className="text-[10px] text-slate-500 font-mono">{key}</p>
                          <p className="text-xs text-slate-300 font-mono break-all">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            </>
            )}

          </div>
        </div>
      )}
    </div>
    <Outlet />
    </>
  )
}
