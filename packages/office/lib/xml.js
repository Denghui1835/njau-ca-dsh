/**
 * xml.js —— 只够解析 OOXML 的极简 XML 树。
 *
 * 不追求通用：不要 DTD、不解析命名空间 URI、不校验 schema。
 * 需要的是「拿得到 w:p / w:r / w:t / w:tbl」，以及把文本原样写回去。
 *
 * 节点形状：
 *   { name: 'w:p', local: 'p', attrs: { 'w:val': 'Heading1' }, children: [node | string] }
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function escapeAttr(text) {
  return escapeXml(text).replace(/'/g, '&apos;')
}

function parseAttrs(src) {
  const attrs = {}
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(src)) !== null) {
    attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '')
  }
  return attrs
}

/** 叶子节点名（去掉前缀）：'w:p' → 'p'。 */
export function localName(name) {
  const i = name.indexOf(':')
  return i < 0 ? name : name.slice(i + 1)
}

/**
 * 解析一段 XML，返回根节点数组（通常只有一个根）。
 * @param {string} src
 */
export function parseXml(src) {
  const roots = []
  const stack = [{ name: '#root', local: '#root', attrs: {}, children: roots }]
  let i = 0

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      pushText(stack[stack.length - 1], src.slice(i))
      break
    }
    if (lt > i) pushText(stack[stack.length - 1], src.slice(i, lt))

    // 注释 / CDATA / 处理指令 / DOCTYPE：整段跳掉
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      i = end < 0 ? src.length : end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      const text = src.slice(lt + 9, end < 0 ? src.length : end)
      stack[stack.length - 1].children.push(text)
      i = end < 0 ? src.length : end + 3
      continue
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2)
      i = end < 0 ? src.length : end + 1
      continue
    }

    const gt = findTagEnd(src, lt)
    if (gt < 0) break
    const inner = src.slice(lt + 1, gt)
    if (inner.startsWith('/')) {
      // 闭合标签：容忍不配对的（坏文档很常见）
      const name = inner.slice(1).trim()
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k].name === name) {
          stack.length = k
          break
        }
      }
      i = gt + 1
      continue
    }

    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1) : inner
    const space = body.search(/\s/)
    const name = space < 0 ? body : body.slice(0, space)
    const attrs = space < 0 ? {} : parseAttrs(body.slice(space))
    const node = { name, local: localName(name), attrs, children: [] }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
    i = gt + 1
  }

  return roots
}

/** 找到属性区之外真正的 '>'（属性值里可能有 '>'）。 */
function findTagEnd(src, from) {
  let quote = ''
  for (let i = from + 1; i < src.length; i += 1) {
    const ch = src[i]
    if (quote !== '') {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return i
  }
  return -1
}

function pushText(parent, text) {
  if (text === '') return
  parent.children.push(decodeEntities(text))
}

// ---------------------------------------------------------------- 写回

/**
 * 把一个节点序列化回 XML 文本（自闭合优先，输出最小化）。
 * 用途：把没建模的子树（w:pPr / w:rPr / w:sectPr）原样带回去，保住排版。
 */
export function serializeNode(node) {
  if (typeof node === 'string') return escapeXml(node)
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join('')
  if (node.children.length === 0) return `<${node.name}${attrs}/>`
  const inner = node.children.map(serializeNode).join('')
  return `<${node.name}${attrs}>${inner}</${node.name}>`
}

// ---------------------------------------------------------------- 查询

/** 直接子元素（按本地名过滤，name 省略表示所有元素）。 */
export function childrenOf(node, local) {
  const out = []
  for (const child of node.children) {
    if (typeof child === 'string') continue
    if (local === undefined || child.local === local) out.push(child)
  }
  return out
}

export function firstChild(node, local) {
  for (const child of node.children) {
    if (typeof child === 'string') continue
    if (child.local === local) return child
  }
  return undefined
}

/** 递归收集所有文本（w:t 拼接）。 */
export function textOf(node) {
  let out = ''
  for (const child of node.children) {
    if (typeof child === 'string') out += child
    else out += textOf(child)
  }
  return out
}

/** 取属性：先试原样，再试带命名空间前缀的写法。 */
export function attr(node, name) {
  if (name in node.attrs) return node.attrs[name]
  const suffix = ':' + name
  for (const [key, value] of Object.entries(node.attrs)) {
    if (key === name || key.endsWith(suffix)) return value
  }
  return undefined
}
