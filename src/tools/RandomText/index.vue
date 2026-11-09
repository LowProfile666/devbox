<script lang="ts" setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { copyToClipboard } from '../../host'
import { onToolEnter } from '../../toolbox/enterBus'
import { OFFLINE_POOL } from '../../toolbox/quickActions'
import { useToolSettings } from '../../toolbox/toolSettings'

// 配置走 schema 架构（内容源/一言分类），与快捷键「复制并粘贴」共用同一份。
// 存储 key 与旧版一致（devbox.randomtext.settings），旧数据自动继承。
const settings = useToolSettings('randomtext')

interface Quote {
  content: string
  author: string
  origin: string
  /** 来源标签：今日诗词 / 一言 / 离线兜底 */
  source: string
}

// 一言接口的句子分类（c 参数）
const CAT_OPTIONS = [
  { value: 'a', label: '动画' },
  { value: 'd', label: '文学' },
  { value: 'e', label: '原创' },
  { value: 'f', label: '网络' },
  { value: 'g', label: '其他' },
  { value: 'h', label: '影视' },
  { value: 'i', label: '诗词' },
  { value: 'k', label: '哲学' },
]

const quote = ref<Quote | null>(null)
const loading = ref(false)

const fullText = computed(() =>
  quote.value ? `${quote.value.content} —— ${quote.value.author}《${quote.value.origin}》` : ''
)

async function fetchWithTimeout(url: string, ms = 6000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchPoem(): Promise<Quote> {
  const res = await fetchWithTimeout('https://v1.jinrishici.com/all.json')
  if (!res.ok) throw new Error(String(res.status))
  const data = await res.json()
  return {
    content: data.content,
    author: data.author || '佚名',
    origin: data.origin || '未知',
    source: '今日诗词',
  }
}

async function fetchHitokoto(): Promise<Quote> {
  const cats = settings.hitokotoCats.length ? settings.hitokotoCats : ['d']
  const res = await fetchWithTimeout(`https://v1.hitokoto.cn/?${cats.map((c) => `c=${c}`).join('&')}`)
  if (!res.ok) throw new Error(String(res.status))
  const data = await res.json()
  return {
    content: data.hitokoto,
    author: data.from_who || '佚名',
    origin: data.from || '一言',
    source: '一言',
  }
}

/** 拉取一条内容写入 quote，两个接口都不可达时退回本地句池 */
async function obtainQuote() {
  if (loading.value) return
  loading.value = true
  try {
    quote.value =
      settings.source === 'poem'
        ? await fetchPoem()
        : await fetchHitokoto()
  } catch {
    const pick = OFFLINE_POOL[Math.floor(Math.random() * OFFLINE_POOL.length)]
    quote.value = { ...pick, source: '离线兜底' }
  } finally {
    loading.value = false
  }
}

async function refreshDisplayOnly() {
  await obtainQuote()
}

function copyText(text: string, auto = false) {
  copyToClipboard(text)
    .then(() =>
      ElMessage.success({ message: auto ? '已自动复制到剪贴板' : '已复制到剪贴板', duration: 800 })
    )
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

/**
 * 打开该工具时换一条内容。
 *
 * 桌面版没有「快捷键进入即复制」的语义：用户是来点标签页的，静默改写剪贴板反而
 * 是坏体验。所以这里只刷新展示，复制动作一律由用户显式点击。
 */
async function handleEnter(action?: { code?: string }) {
  if (action?.code !== 'randomtext') return
  await refreshDisplayOnly()
}

let unsubscribe: (() => void) | undefined
let fallbackTimer: number | undefined

onMounted(() => {
  unsubscribe = onToolEnter(handleEnter)
  // 兜底：进入事件丢失时也保证页面有内容可看（仅展示，不碰剪贴板）
  fallbackTimer = window.setTimeout(() => {
    if (!quote.value) obtainQuote()
  }, 600)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  if (fallbackTimer) clearTimeout(fallbackTimer)
})
</script>

<template>
  <div class="random-text">
    <h2>随机文案</h2>
    <p class="desc">随机获取古诗词或名言警句，适合填写测试表单时的占位文案</p>

    <div class="config">
      <div class="config-row">
        <span>内容源</span>
        <el-radio-group v-model="settings.source" size="small">
          <el-radio-button value="poem">古诗词</el-radio-button>
          <el-radio-button value="hitokoto">名言 · 一言</el-radio-button>
        </el-radio-group>
      </div>
      <div v-if="settings.source === 'hitokoto'" class="config-row">
        <span>句子分类</span>
        <el-checkbox-group v-model="settings.hitokotoCats" size="small">
          <el-checkbox v-for="c in CAT_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</el-checkbox>
        </el-checkbox-group>
      </div>
      <p class="hint">打开该工具会自动换一条内容；点卡片或按钮复制后，到任意位置 Ctrl+V 粘贴即可。</p>
    </div>

    <div class="actions">
      <el-button type="primary" :loading="loading" @click="refreshDisplayOnly">换一条</el-button>
      <el-button :disabled="!quote" @click="quote && copyText(quote.content)">复制文案</el-button>
      <el-button :disabled="!quote" @click="fullText && copyText(fullText)">复制含出处</el-button>
    </div>

    <div v-if="quote" class="quote-card" title="点击复制文案" @click="copyText(quote.content)">
      <p class="content">{{ quote.content }}</p>
      <p class="meta">{{ quote.author }} · {{ quote.origin }}</p>
      <span class="source-tag" :class="{ offline: quote.source === '离线兜底' }">{{ quote.source }}</span>
    </div>
  </div>
</template>

<style scoped>
.random-text {
  padding: 0;
  max-width: 100%;
  margin: 0 auto;
  font-size: 13px;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.desc {
  color: var(--text-secondary);
  margin: 0 0 16px;
  font-size: 13px;
}

.config {
  margin-bottom: 16px;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.config-row > span {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.hint {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.quote-card {
  position: relative;
  padding: 18px 16px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-color));
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.quote-card:hover {
  border-color: var(--app-accent);
}

.quote-card .content {
  margin: 0 0 10px;
  font-size: 16px;
  line-height: 1.7;
  color: var(--text-primary);
  word-break: break-all;
}

.quote-card .meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.source-tag {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 11px;
  color: var(--app-accent);
  background: rgba(102, 126, 234, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
}

.source-tag.offline {
  color: #e6a23c;
  background: rgba(230, 162, 60, 0.12);
}

  html.dark .quote-card {
    background: var(--bg-card);
    border-color: var(--border-color);
  }
  html.dark .quote-card:hover {
    border-color: var(--app-accent);
  }
  html.dark .quote-card .content {
    color: var(--text-primary);
  }
  html.dark .quote-card .meta {
    color: var(--text-secondary);
  }
  html.dark h2 {
    color: var(--text-primary);
  }
  html.dark .desc {
    color: var(--text-secondary);
  }
  html.dark .config-row > span {
    color: var(--text-secondary);
  }
</style>
