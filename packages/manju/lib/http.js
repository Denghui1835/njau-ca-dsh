/**
 * http.js —— 漫剧柱的面板接口。
 *
 * 前缀 /njau/api/manju。响应永远是 { ok, value } 或 { ok:false, error }。
 * 素材（出图产物）走 /asset 直出字节 —— 面板要能看见图，不是看见路径。
 */

const MAX_BODY_BYTES = 16 * 1024 * 1024

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

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
  if (code === 'board/conflict' || code === 'script/conflict' || code === 'project/exists') return 409
  if (code === 'project/missing' || code === 'asset/missing') return 404
  if (code === 'name/invalid' || code === 'path/invalid' || code === 'ops/invalid' || code === 'script/invalid') return 400
  if (code === 'asset/unsupported') return 415
  return 500
}

export function registerHttp(ctx, service, options = {}) {
  const prefix = options.prefix ?? '/njau/api/manju'
  const disposers = []

  const handle = async (req, res) => {
    const url = new URL(req.url ?? prefix, 'http://localhost')
    const route = url.pathname.slice(prefix.length) || '/'
    try {
      if (req.method === 'GET' && route === '/health') {
        return send(res, 200, {
          ok: true,
          value: { service: 'njau-manju', base: service.base, root: service.root, version: '0.1.0' },
        })
      }
      if (req.method === 'GET' && route === '/projects') {
        const result = service.list()
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'POST' && route === '/new') {
        const body = await readBody(req)
        const result = service.create(body.name)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'GET' && route === '/project') {
        const name = url.searchParams.get('name')
        if (name === null) return send(res, 400, { ok: false, error: { code: 'name/invalid', message: '缺少 name' } })
        const result = service.read(name)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'POST' && route === '/board') {
        const body = await readBody(req)
        const result = service.saveBoard(body.name, body.board, body.baseHash)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'POST' && route === '/script') {
        const body = await readBody(req)
        const result = service.saveScript(body.name, body.text, body.baseHash)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'GET' && route === '/asset') {
        const name = url.searchParams.get('name')
        const path = url.searchParams.get('path')
        if (name === null || path === null) {
          return send(res, 400, { ok: false, error: { code: 'path/invalid', message: '需要 name 和 path' } })
        }
        const resolved = service.assetPath(name, path)
        if (!resolved.ok) return send(res, statusOf(resolved.error.code), resolved)
        const { readFileSync } = await import('node:fs')
        const buffer = readFileSync(resolved.value.abs)
        res.writeHead(200, {
          'content-type': MIME[resolved.value.ext] ?? 'application/octet-stream',
          'content-length': buffer.length,
          'cache-control': 'no-store',
        })
        res.end(buffer)
        return undefined
      }
      return send(res, 404, { ok: false, error: { code: 'route/unknown', message: `未知接口 ${req.method} ${route}` } })
    } catch (error) {
      return send(res, 500, { ok: false, error: { code: 'server/error', message: String(error.message ?? error) } })
    }
  }

  disposers.push(ctx.webServer.register({ kind: 'prefix', path: prefix, handler: handle }))
  return disposers
}
