export interface UpdateCheckResult {
  current: string
  latest: string
  url: string
  updateAvailable: boolean
}

const REPO = 'ajaxsync/ssh-client'
const RELEASES_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases`
const TIMEOUT_MS = 8000

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

/** 比较 x.y.z；latest > current 返回正数 */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  const pb = normalizeVersion(b)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

export async function checkGitHubUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  const current = normalizeVersion(currentVersion)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(RELEASES_LATEST, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ssh-client-plus',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        throw new Error('GitHub API 限流，请稍后再试')
      }
      throw new Error(`检查更新失败（HTTP ${res.status}）`)
    }

    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = normalizeVersion(data.tag_name || '')
    if (!latest) throw new Error('未获取到最新版本号')

    const url =
      typeof data.html_url === 'string' && data.html_url.startsWith('https://github.com/')
        ? data.html_url
        : RELEASES_PAGE

    return {
      current,
      latest,
      url,
      updateAvailable: compareSemver(latest, current) > 0
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('检查更新超时，请检查网络后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
