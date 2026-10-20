/**
 * http.js —— 面板用的 HTTP 接口。
 *
 * 面板跑在浏览器里，碰不到文件系统；host 插件在 Node 里。
 * 两者之间最省事的通道就是这条：host 用 webserver 注册一个前缀路由，
 * 面板同源 fetch。不走 /api（那是 dsh 自己的协议面，混进去只会互相牵制）。
 *
 * 约定：
 *   - 请求体 JSON，响应体 JSON，永远是 { ok, value } 或 { ok:false, error }；
 *   - 前缀 /njau/api/office，只监听本机（webserver 默认 127.0.0.1）。
 */

const MAX_BODY_BYTES = 64 * 1024 * 1024

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
        reject(new Error('请求体过大（上限 64MB）'))
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

/** 把 service 的返回值直接映射成 HTTP 状态码。 */
function statusOf(code) {
  if (code === 'doc/conflict') return 409
  if (code === 'file/missing' || code === 'dir/missing') return 404
  if (code === 'file/exists') return 409
  if (code === 'path/invalid' || code === 'model/invalid' || code === 'ops/invalid') return 400
  return 500
}

/**
 * 注册路由。
 * @param {object} ctx cordis 上下文（需已注入 webServer）
 * @param {object} service 文档服务
 * @returns {Array<() => void>} disposers
 */
export function registerHttp(ctx, service, options = {}) {
  const prefix = options.prefix ?? '/njau/api/office'
  const serviceName = options.serviceName ?? 'njau-office'
  const disposers = []

  const handle = async (req, res) => {
    const url = new URL(req.url ?? prefix, 'http://localhost')
    const route = url.pathname.slice(prefix.length) || '/'
    try {
      if (req.method === 'GET' && route === '/health') {
        return send(res, 200, { ok: true, value: { service: serviceName, root: service.root, version: '0.1.0' } })
      }
      if (req.method === 'GET' && route === '/scan') {
        const result = service.scan()
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'GET' && route === '/files') {
        const result = service.list(url.searchParams.get('dir') ?? undefined)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'GET' && route === '/stat') {
        const path = url.searchParams.get('path')
        if (path === null) return send(res, 400, { ok: false, error: { code: 'path/invalid', message: '缺少 path' } })
        const result = service.stat(path)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'GET' && route === '/doc') {
        const path = url.searchParams.get('path')
        if (path === null) return send(res, 400, { ok: false, error: { code: 'path/invalid', message: '缺少 path' } })
        const result = service.read(path)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'POST' && route === '/doc') {
        const body = await readBody(req)
        const result = service.save(body.path, body.model, body.baseHash)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'POST' && route === '/new') {
        const body = await readBody(req)
        const result = service.create(body.path, body.title)
        return send(res, result.ok ? 200 : statusOf(result.error.code), result)
      }
      if (req.method === 'GET' && route === '/raw') {
        const path = url.searchParams.get('path')
        if (path === null) return send(res, 400, { ok: false, error: { code: 'path/invalid', message: '缺少 path' } })
        const { readFileSync, existsSync } = await import('node:fs')
        const abs = service.resolve(path)
        if (!existsSync(abs)) {
          return send(res, 404, { ok: false, error: { code: 'file/missing', message: `文件不存在：${abs}` } })
        }
        // 原始字节：给「另存一份 / 导出」用
        const buffer = readFileSync(abs)
        res.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-length': buffer.length,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(abs.split(/[\\\\/]/).pop())}`,
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
