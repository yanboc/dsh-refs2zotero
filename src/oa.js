/**
 * Ask OpenAlex for open-access copies of a DOI, best first. This is the fallback
 * for rows whose page did not expose a PDF link and that are not on arXiv: many
 * records have a legal OA copy, and OpenAlex indexes it without needing a key.
 *
 * Best-effort: offline, an unknown DOI, or no OA copy all return [].
 *
 * @param {string} doi
 * @param {{ fetch?: typeof fetch }} [deps]
 * @returns {Promise<string[]>} http(s) URLs to try in order
 */
export async function findOpenAccessPdfs(doi, deps = {}) {
  if (typeof doi !== 'string' || !/^10\.\d{4,9}\//.test(doi)) return ''
  const fetchImpl = deps.fetch ?? globalThis.fetch
  try {
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=best_oa_location,locations`
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    if (!response.ok) return ''
    const body = await response.json()
    const locations = Array.isArray(body?.locations) ? body.locations : []
    const candidates = [
      ...locations.flatMap(location => [location?.pdf_url, location?.landing_page_url]),
      body?.best_oa_location?.pdf_url,
      body?.best_oa_location?.landing_page_url,
    ].filter(candidate => typeof candidate === 'string' && /^https?:\/\//i.test(candidate))

    // Prefer the copy that is actually this DOI (a publisher's own PDF) over
    // whatever the index considers the best open copy: for a published paper
    // that is often an earlier preprint of the same work.
    const needle = doi.toLowerCase()
    const score = url => {
      const lower = url.toLowerCase()
      let points = 0
      if (lower.includes(needle) || lower.includes(encodeURIComponent(needle))) points += 4
      if (/\.pdf(?:$|\?)/i.test(url)) points += 2
      if (body?.best_oa_location?.pdf_url === url) points += 1
      return points
    }
    return [...new Set(candidates)].sort((left, right) => score(right) - score(left))
  } catch {
    return []
  }
}

/**
 * @param {string} doi
 * @param {{ fetch?: typeof fetch }} [deps]
 * @returns {Promise<string>} the best candidate, or ''
 */
export async function findOpenAccessPdf(doi, deps = {}) {
  return (await findOpenAccessPdfs(doi, deps))[0] ?? ''
}
