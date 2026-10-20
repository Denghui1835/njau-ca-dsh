/**
 * http.js —— 开发柱的面板接口。
 *
 * 前缀 /njau/api/code。响应永远是 { ok, value } 或 { ok:false, error }。
 */

const MAX_BODY_BYTES = 32 * 1024 * 1024

function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error(`JSON 解析失败：${error.message}`))
      }
    })
    req.on('error', reject)
  })
}

function statusOf(code) {
  if (code === 'file/conflict') return 409
  if (code === 'file/missing' || code === 'project/missing') return 404
  if (code === 'file/too-large') return 413
  if (code === 'file/binary' || code === 'file/is-dir') return 415
  if (code?.startsWith('path/') || code?.startsWith('project/') || code?.startsWith('run/') || code?.startsWith('file/')) return 400
  return 500
}

export function registerHttp(ctx, service, options = {}) {
  const prefix = options.prefix ?? '/njau/api/code'
  const disposers = []

  const handle = async (req, res) => {
    const url = new URL(req.url ?? prefix, 'http://localhost')
    const route = url.pathname.slice(prefix.length) || '/'
    try {
      if (req.method === 'GET' && route === '/health') {
        return send(res, 200, {
          ok: true,
          value: { service: 'njau-code', root: service.root, roots: service.roots, version: '0.1.0' },
        })
      }
      if (req.method === 'GET' && route === '/projects') {
        const result = service.list()
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'GET' && route === '/tree') {
        const project = url.searchParams.get('project')
        if (project === null) return send(res, 400, { ok: false, error: { code: 'project/invalid', message: '缺少 project' } })
        const result = service.tree(project)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'GET' && route === '/file') {
        const project = url.searchParams.get('project')
        const path = url.searchParams.get('path')
        if (project === null || path === null) {
          return send(res, 400, { ok: false, error: { code: 'path/invalid', message: '需要 project 与 path' } })
        }
        const result = service.readFile(project, path)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'POST' && route === '/file') {
        const body = await readBody(req)
        const result = service.writeFile(body.project, body.path, body.text, body.baseHash)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'POST' && route === '/run') {
        const body = await readBody(req)
        const result = await service.run(body.project, body.action)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      return send(res, 404, { ok: false, error: { code: 'route/unknown', message: `未知接口 ${req.method} ${route}` } })
    } catch (error) {
      return send(res, 500, { ok: false, error: { code: 'server/error', message: String(error.message ?? error) } })
    }
  }

  disposers.push(ctx.webServer.register({ kind: 'prefix', path: prefix, handler: handle }))
  return disposers
}
