import { useState, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { parseOasSpec, deriveColumns, resolvePaginationQueryKeys } from '../../utils/oasParser'
import { useApiClient } from '../../services/apiClient'
import { useResourceList } from '../../hooks/useResourceList'
import DataGrid from '../ui/DataGrid'

/** Replace the first path parameter with the provided id */
function buildPath(template, id) {
  return template.replace(/\{[^}]+\}/, encodeURIComponent(id))
}

export default function TraversalPage() {
  const { tagSlug, subResource } = useParams()
  const navigate = useNavigate()
  const { oasSpec } = useApp()
  const { get } = useApiClient()
  const [parentId, setParentId] = useState('')
  const [submittedId, setSubmittedId] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  const { navItems } = parseOasSpec(oasSpec)
  const navItem = navItems.find((n) => n.id === tagSlug)
  // subResource in the URL may be encoded
  const child = navItem?.children.find(
    (c) => c.subResource === decodeURIComponent(subResource ?? '')
  )

  const resolvedPath = submittedId && child?.pathTemplate
    ? buildPath(child.pathTemplate, submittedId)
    : null

  const paginationKeys = useMemo(
    () => resolvePaginationQueryKeys(oasSpec, child?.pathTemplate, 'get'),
    [oasSpec, child?.pathTemplate]
  )

  const fetcher = useCallback(() => {
    if (!resolvedPath) return Promise.resolve([])
    const qs = new URLSearchParams()
    qs.set(paginationKeys.limitKey, String(pageSize))
    qs.set(paginationKeys.skipKey, String(page * pageSize))
    return get(`${resolvedPath}?${qs.toString()}`)
  }, [get, page, pageSize, paginationKeys.limitKey, paginationKeys.skipKey, resolvedPath])

  const { data, loading, error, refresh } = useResourceList(fetcher)
  const columns = deriveColumns(data)
  const hasNextPage = data.length === pageSize

  const handleRowClick = useCallback(
    (row) => {
      if (!navItem?.itemPathTemplate) return
      const id = row?._id ?? row?.id
      if (!id) return
      navigate(`/r/${tagSlug}/item/${encodeURIComponent(id)}`)
    },
    [navigate, navItem?.itemPathTemplate, tagSlug]
  )

  if (!child) {
    return (
      <div className="text-gray-500 dark:text-slate-400 text-sm p-4">
        Traversal endpoint not found:{' '}
        <code className="font-mono bg-gray-100 dark:bg-slate-800 px-1 rounded">
          {tagSlug}/{subResource}
        </code>
      </div>
    )
  }

  function handleSearch(e) {
    e.preventDefault()
    setSubmittedId(parentId.trim())
    setPage(0)
  }

  const singularLabel = navItem.label.replace(/s$/, '')

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2 items-center">
        <input
          type="text"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          placeholder={`Enter ${singularLabel} ID…`}
          className="flex-1 max-w-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-gray-800 dark:text-slate-100 text-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
        />
        <button
          type="submit"
          disabled={!parentId.trim()}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          Load
        </button>
        {submittedId && (
          <button
            type="button"
            onClick={refresh}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            title="Refresh"
            aria-label="Refresh"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </form>

      {submittedId && (
        <>
          <p className="text-xs text-gray-400 dark:text-slate-500 font-mono">
            {resolvedPath}
            {!loading && !error && ` · ${data.length} record(s)`}
            {` · ${paginationKeys.limitKey}=${pageSize}`}
            {` · ${paginationKeys.skipKey}=${page * pageSize}`}
          </p>
          <DataGrid
            columns={columns}
            data={data}
            loading={loading}
            error={error}
            onRefresh={refresh}
            onRowClick={navItem?.itemPathTemplate ? handleRowClick : undefined}
          />

          <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNextPage || loading}
            className="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
          <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
            Page size
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(0)
              }}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-md px-2 py-1 text-gray-700 dark:text-slate-300"
            >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-gray-400 dark:text-slate-500 font-mono">
              page={page + 1} offset={page * pageSize}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
