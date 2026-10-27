export function githubPagesTarget(remote) {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(String(remote).trim())
  if (!match) return null
  const [, owner, repository] = match
  const base =
    repository.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : `/${repository}/`
  return { base, url: `https://${owner.toLowerCase()}.github.io${base}` }
}
