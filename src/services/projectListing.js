/**
 * Which folders appear on the CDX Studio home project list.
 * Versions of a show live *inside* that show (productionCuts), never as
 * sibling project folders. Archived mistakes go under `_archive/`.
 */

export function shouldListProjectFolder(name = '', path = '') {
  const rawPath = String(path || name || '')
  const leaf = String(name || rawPath).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
  if (!leaf || leaf.startsWith('.') || leaf.startsWith('_')) return false
  if (/(^|[\\/])_archive([\\/]|$)/i.test(rawPath)) return false
  return true
}

export function versionCountFromProject(project = {}) {
  const index = project.productionCuts
  if (!index || typeof index !== 'object') return 0
  return Object.values(index).reduce((sum, bucket) => {
    const cuts = Array.isArray(bucket?.cuts) ? bucket.cuts.length : 0
    return sum + cuts
  }, 0)
}

export function projectListMeta(project = {}) {
  const production = project.production || {}
  return {
    productionType: production.type || '',
    episodeId: production.current?.episodeId || '',
    versionCount: versionCountFromProject(project),
  }
}
