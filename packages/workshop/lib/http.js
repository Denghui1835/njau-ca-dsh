/**
 * http.js —— 工作坊外壳的 HTTP 接口（面板用）。
 *
 * 前缀 /njau/api/workshop。响应永远是 { ok, value } 或 { ok:false, error }，
 * 和办公柱保持同一种手感，面板侧写一套解析就够。
 */

const MAX_BODY_BYTES = 4 * 1024 * 1024

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

export function registerHttp(ctx, workshop, options = {}) {
  const prefix = options.prefix ?? '/njau/api/workshop'
  const disposers = []

  const handle = async (req, res) => {
    const url = new URL(req.url ?? prefix, 'http://localhost')
    const route = url.pathname.slice(prefix.length) || '/'
    try {
      if (req.method === 'GET' && route === '/health') {
        return send(res, 200, { ok: true, value: { service: 'njau-workshop', root: workshop.root, version: '0.1.0' } })
      }
      if (req.method === 'GET' && route === '/state') {
        return send(res, 200, { ok: true, value: workshop.state() })
      }
      if (req.method === 'GET' && route === '/manju') {
        return send(res, 200, { ok: true, value: workshop.readManjuProjects() })
      }
      if (req.method === 'POST' && route === '/manju/new') {
        const body = await readBody(req)
        const result = workshop.createManju(body.name)
        return send(res, result.ok ? 200 : 400, result)
      }
      if (req.method === 'GET' && route === '/code') {
        return send(res, 200, { ok: true, value: { projects: workshop.readCodeProjects() } })
      }
      return send(res, 404, { ok: false, error: { code: 'route/unknown', message: `未知接口 ${req.method} ${route}` } })
    } catch (error) {
      return send(res, 500, { ok: false, error: { code: 'server/error', message: String(error.message ?? error) } })
    }
  }

  disposers.push(ctx.webServer.register({ kind: 'prefix', path: prefix, handler: handle }))
  return disposers
}
