/**
 * 「快捷复制」动作表：全局快捷键触发时不打开窗口，直接生成结果写进剪贴板。
 *
 * 生成逻辑与工具页面**共享同一份配置**（useToolSettings）：页面上把密码长度
 * 改成 32，快捷键生成的就是 32 位。这里只收录适合「一按就复制」的工具，
 * 组件打开后的完整交互仍在各自的 index.vue 里。
 */
import { useToolSettings } from './toolSettings'

/** 与 RandomColor 组件一致的随机色范围：HSL 中随机，再转 HEX */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const rgb = [f(0), f(8), f(4)].map((v) => Math.round(v * 255))
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** 离线兜底句池：网络不可用时也保证快捷复制有内容可给 */
export const OFFLINE_POOL: { content: string; author: string; origin: string }[] = [
  { content: '落霞与孤鹜齐飞，秋水共长天一色', author: '王勃', origin: '滕王阁序' },
  { content: '长风破浪会有时，直挂云帆济沧海', author: '李白', origin: '行路难' },
  { content: '人生得意须尽欢，莫使金樽空对月', author: '李白', origin: '将进酒' },
  { content: '会当凌绝顶，一览众山小', author: '杜甫', origin: '望岳' },
  { content: '但愿人长久，千里共婵娟', author: '苏轼', origin: '水调歌头' },
  { content: '山重水复疑无路，柳暗花明又一村', author: '陆游', origin: '游山西村' },
  { content: '沉舟侧畔千帆过，病树前头万木春', author: '刘禹锡', origin: '酬乐天扬州初逢席上见赠' },
  { content: '纸上得来终觉浅，绝知此事要躬行', author: '陆游', origin: '冬夜读书示子聿' },
  { content: '海内存知己，天涯若比邻', author: '王勃', origin: '送杜少府之任蜀州' },
  { content: '采菊东篱下，悠然见南山', author: '陶渊明', origin: '饮酒' },
  { content: '千里之行，始于足下', author: '老子', origin: '道德经' },
  { content: '不积跬步，无以至千里', author: '荀子', origin: '劝学' },
  { content: '天行健，君子以自强不息', author: '佚名', origin: '周易' },
  { content: '世上无难事，只怕有心人', author: '佚名', origin: '谚语' },
]

function pickOffline(): string {
  return OFFLINE_POOL[Math.floor(Math.random() * OFFLINE_POOL.length)].content
}

function fetchWithTimeout(url: string, ms = 6000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))
}

/** 拉一条古诗词；接口超时或失败时退回本地句池，保证永不落空 */
async function fetchPoem(): Promise<string> {
  try {
    const res = await fetchWithTimeout('https://v1.jinrishici.com/all.json')
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    return String(data.content || '') || pickOffline()
  } catch {
    return pickOffline()
  }
}

/** 拉一条一言 */
async function fetchHitokoto(cats: string[]): Promise<string> {
  try {
    const catQuery = (cats.length ? cats : ['d']).map((c) => `c=${c}`).join('&')
    const res = await fetchWithTimeout(`https://v1.hitokoto.cn/?${catQuery}`)
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    return String(data.hitokoto || '') || pickOffline()
  } catch {
    return pickOffline()
  }
}

/** 工具 code -> 生成动作；返回值就是要写进剪贴板的文本 */
export const quickActions: Record<string, () => string | Promise<string>> = {
  uuid: () => crypto.randomUUID(),

  // 生成逻辑与 RandomPassword 页面共用同一份配置（长度/字符集）
  password: () => {
    const s = useToolSettings('password')
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const lower = 'abcdefghijklmnopqrstuvwxyz'
    const digit = '0123456789'
    const symbol = '!@#$%^&*()-_=+[]{}|;:,.<>?'
    let chars = ''
    if (s.useUpper) chars += upper
    if (s.useLower) chars += lower
    if (s.useDigit) chars += digit
    if (s.useSymbol) chars += symbol
    // 全部关掉的兜底：至少给数字，保证快捷键永远有产出
    if (!chars) chars = digit
    const length = Math.max(4, Math.min(64, s.length))
    const rand = new Uint32Array(length)
    crypto.getRandomValues(rand)
    let out = ''
    for (let i = 0; i < length; i++) {
      out += chars[rand[i] % chars.length]
    }
    return out
  },

  // 与 RandomNumber 页面共用同一份配置（范围/个数/小数位）
  number: () => {
    const s = useToolSettings('number')
    const min = Math.min(s.min, s.max)
    const max = Math.max(s.min, s.max)
    const decimalPlaces = Math.max(0, Math.min(10, s.decimalPlaces))
    const count = Math.max(1, Math.min(100, s.count))
    const rand = new Uint32Array(count)
    crypto.getRandomValues(rand)
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      const raw = rand[i] / 0xFFFFFFFF
      const val =
        decimalPlaces > 0
          ? parseFloat((raw * (max - min) + min).toFixed(decimalPlaces))
          : Math.floor(raw * (max - min + 1)) + min
      out.push(String(val))
    }
    return out.join('\n')
  },

  color: () => {
    const rand = new Uint32Array(3)
    crypto.getRandomValues(rand)
    return hslToHex(rand[0] % 360, (rand[1] % 60) + 40, (rand[2] % 40) + 30)
  },

  // 与 RandomText 页面共用同一份配置（内容源/一言分类）
  randomtext: () => {
    const s = useToolSettings('randomtext')
    return s.source === 'hitokoto' ? fetchHitokoto(s.hitokotoCats) : fetchPoem()
  },
}

/** 某个工具是否支持快捷复制（设置面板里用来决定能不能选「复制结果」） */
export function supportsQuickCopy(code: string): boolean {
  return code in quickActions
}
