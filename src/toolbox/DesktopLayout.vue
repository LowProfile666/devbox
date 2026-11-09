<script lang="ts" setup>
import { computed, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDark, toggleTheme } from '../host/theme'
import { categories, type Tool } from './tools'
import { useFavorites } from './favorites'

const props = defineProps<{
  /** 已打开的工具标签（按打开顺序） */
  tabs: Tool[]
  /** 当前激活的工具 code，空串表示显示首页 */
  activeCode: string
}>()

const emit = defineEmits<{
  select: [code: string]
  close: [code: string]
  'close-all': []
  'close-others': [code: string]
  'close-left': [code: string]
  'close-right': [code: string]
  'open-settings': []
}>()

/**
 * 当前窗口句柄。桌面版没有宿主代劳，最小化/最大化/关闭都要前端主动调。
 * 这些方法最终通过 IPC 让 Rust 侧操作原生窗口，需要 capabilities 里声明对应权限。
 */
const win = getCurrentWindow()

const keyword = ref('')
const searchRef = ref<HTMLInputElement | null>(null)

const allTools = computed(() => categories.flatMap((cat) => cat.tools))

/** 有关键字时切换成扁平搜索结果，为空时走分类列表 */
const searchResults = computed<Tool[] | null>(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return null
  return allTools.value.filter(
    (tool) => tool.explain.toLowerCase().includes(kw) || tool.code.toLowerCase().includes(kw)
  )
})

function isActive(tool: Tool): boolean {
  return tool.code === props.activeCode
}

/** Enter 直接打开第一个匹配项——只在输入框里敲关键字，比鼠标点更快 */
function openFirstMatch() {
  const first = searchResults.value?.[0]
  if (first) {
    emit('select', first.code)
    keyword.value = ''
  }
}

function minimize() {
  void win.minimize()
}

function toggleMaximize() {
  void win.toggleMaximize()
}

/** 关闭按钮：Rust 侧拦截了 CloseRequested，实际效果是隐藏到托盘 */
function closeWindow() {
  void win.close()
}

function focusSearch() {
  searchRef.value?.focus()
  searchRef.value?.select()
}

defineExpose({ focusSearch })

// ---------- 标签右键菜单 ----------
/** 当前弹出的菜单：坐标 + 目标标签 code，null 表示未弹出 */
const ctxMenu = ref<{ x: number; y: number; code: string } | null>(null)

function openTabMenu(event: MouseEvent, code: string) {
  ctxMenu.value = { x: event.clientX, y: event.clientY, code }
}

/** 菜单项点击；点空白处由遮罩层直接关掉菜单 */
function runCtx(action: 'close' | 'close-others' | 'close-left' | 'close-right' | 'close-all') {
  const menu = ctxMenu.value
  ctxMenu.value = null
  if (!menu) return
  if (action === 'close') emit('close', menu.code)
  else if (action === 'close-others') emit('close-others', menu.code)
  else if (action === 'close-left') emit('close-left', menu.code)
  else if (action === 'close-right') emit('close-right', menu.code)
  else emit('close-all')
}

/** 该标签左边/右边还有别的标签时，「关闭左侧/右侧」才有意义 */
function hasTabsLeftOf(code: string): boolean {
  const idx = props.tabs.findIndex((tab) => tab.code === code)
  return idx > 0
}

function hasTabsRightOf(code: string): boolean {
  const idx = props.tabs.findIndex((tab) => tab.code === code)
  return idx !== -1 && idx < props.tabs.length - 1
}

// ---------- 侧边栏收藏 ----------
// 星标按钮点一下即收藏（收藏 = 提到侧边栏最上方的「收藏」分组，原分类里隐藏）。
// 状态在 favorites.ts 里维护：主页的收藏栏要和这里共用同一份。

const { favoriteTools, isFavorite, toggleFavorite } = useFavorites()
</script>

<template>
  <div class="app-root">
    <!-- data-tauri-drag-region 标记可拖拽区域：按住这里能移动无边框窗口，双击最大化 -->
    <header class="titlebar" data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <span class="brand-mark"></span>
        <span class="brand-name" data-tauri-drag-region>开发百宝箱</span>
      </div>

      <!-- 搜索框两侧的空白行也标记为可拖拽；输入框本身不带标记，不影响聚焦输入 -->
      <div class="search-wrap" data-tauri-drag-region>
        <input
          ref="searchRef"
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="搜索工具，Enter 打开"
          spellcheck="false"
          @keydown.enter.prevent="openFirstMatch"
          @keydown.esc="keyword = ''"
        />
      </div>

      <div class="win-controls">
        <button class="win-btn" :title="isDark ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
          <svg v-if="isDark" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <circle cx="6" cy="6" r="2.6" fill="currentColor" />
            <path
              d="M6 .8v1.4M6 9.8v1.4M.8 6h1.4M9.8 6h1.4M2.3 2.3l1 1M8.7 8.7l1 1M9.7 2.3l-1 1M3.3 8.7l-1 1"
              stroke="currentColor"
              stroke-width="1.1"
              stroke-linecap="round"
            />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M9.8 7.4A4.2 4.2 0 0 1 4.6 2.2a4.4 4.4 0 1 0 5.2 5.2z"
              fill="currentColor"
            />
          </svg>
        </button>
        <button class="win-btn" title="设置（Ctrl+,）" @click="emit('open-settings')">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M1 3.5h10M1 8.5h10"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
            <circle cx="4" cy="3.5" r="1.5" fill="currentColor" />
            <circle cx="8" cy="8.5" r="1.5" fill="currentColor" />
          </svg>
        </button>
        <button class="win-btn" title="最小化" @click="minimize">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 5h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
        <button class="win-btn" title="最大化 / 还原" @click="toggleMaximize">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="2.2"
              y="2.2"
              width="5.6"
              height="5.6"
              rx="1"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            />
          </svg>
        </button>
        <button class="win-btn win-btn-close" title="隐藏到托盘" @click="closeWindow">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2.5 2.5l5 5M7.5 2.5l-5 5"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </header>

    <div class="body">
      <aside class="sidebar">
        <template v-if="searchResults">
          <div class="cat-title">搜索结果 {{ searchResults.length }}</div>
          <div
            v-for="tool in searchResults"
            :key="tool.code"
            class="tool-item"
            :class="{ active: isActive(tool) }"
            @click="emit('select', tool.code)"
          >
            <span class="tool-name">{{ tool.explain }}</span>
            <span
              class="star-btn"
              :class="{ on: isFavorite(tool.code) }"
              :title="isFavorite(tool.code) ? '取消收藏' : '收藏'"
              @click.stop="toggleFavorite(tool.code)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
                />
              </svg>
            </span>
          </div>
          <div v-if="!searchResults.length" class="sidebar-empty">没有匹配的工具</div>
        </template>

        <template v-else>
          <!-- 收藏区：点星标收藏，收藏的工具从原分类隐藏 -->
          <template v-if="favoriteTools.length">
            <div class="cat-title">收藏</div>
            <div
              v-for="tool in favoriteTools"
              :key="tool.code"
              class="tool-item"
              :class="{ active: isActive(tool) }"
              @click="emit('select', tool.code)"
            >
              <span class="tool-name">{{ tool.explain }}</span>
              <span class="star-btn on" title="取消收藏" @click.stop="toggleFavorite(tool.code)">
                <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
                  />
                </svg>
              </span>
            </div>
          </template>

          <div v-for="cat in categories" :key="cat.code" class="cat-block">
            <div class="cat-title">{{ cat.name }}</div>
            <div
              v-for="tool in cat.tools"
              :key="tool.code"
              class="tool-item"
              :class="{ active: isActive(tool) }"
              @click="emit('select', tool.code)"
            >
              <span class="tool-name">{{ tool.explain }}</span>
              <span
                class="star-btn"
                :class="{ on: isFavorite(tool.code) }"
                :title="isFavorite(tool.code) ? '取消收藏' : '收藏'"
                @click.stop="toggleFavorite(tool.code)"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
                  />
                </svg>
              </span>
            </div>
          </div>
        </template>
      </aside>

      <main class="content">
        <!-- 主页 tab 常驻，不允许关闭；activeCode 为空串时激活 -->
        <div class="tabbar">
          <div class="tab home-tab" :class="{ active: activeCode === '' }" @click="emit('select', '')">
            <span class="tab-name">主页</span>
          </div>
          <div
            v-for="tab in tabs"
            :key="tab.code"
            class="tab"
            :class="{ active: tab.code === activeCode }"
            @click="emit('select', tab.code)"
            @contextmenu.prevent="openTabMenu($event, tab.code)"
          >
            <span class="tab-name">{{ tab.explain }}</span>
            <span class="tab-close" title="关闭" @click.stop="emit('close', tab.code)">×</span>
          </div>
        </div>

        <div class="pane">
          <slot />
        </div>
      </main>
    </div>

    <footer class="statusbar">
      <span class="hint">Alt + Space 唤起 / 隐藏</span>
      <span class="spacer"></span>
      <span class="hint">关闭窗口后驻留托盘</span>
    </footer>

    <!-- 标签右键菜单：透明遮罩负责点空白关闭，菜单本体浮在遮罩之上 -->
    <div v-if="ctxMenu" class="ctx-overlay" @mousedown="ctxMenu = null">
      <div
        class="ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @mousedown.stop
      >
        <div class="ctx-item" @click="runCtx('close')">关闭标签</div>
        <div class="ctx-item" @click="runCtx('close-others')">关闭其他</div>
        <div class="ctx-item" :class="{ disabled: !hasTabsLeftOf(ctxMenu.code) }" @click="runCtx('close-left')">
          关闭左侧
        </div>
        <div class="ctx-item" :class="{ disabled: !hasTabsRightOf(ctxMenu.code) }" @click="runCtx('close-right')">
          关闭右侧
        </div>
        <div class="ctx-sep"></div>
        <div class="ctx-item" @click="runCtx('close-all')">关闭全部</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--app-bg);
  color: var(--app-text);
}

/* ---------- 标题栏 ---------- */
.titlebar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  flex-shrink: 0;
  padding: 0 0 0 14px;
  background: var(--app-titlebar);
  border-bottom: 1px solid var(--app-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.brand-mark {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--app-accent);
}

.brand-name {
  font-size: 13px;
  font-weight: 500;
}

.search-wrap {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}

.search-input {
  width: 100%;
  max-width: 420px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--app-text);
  background: var(--app-bg);
  border: 1px solid var(--app-border);
  border-radius: 6px;
  outline: none;
}

.search-input::placeholder {
  color: var(--app-text-soft);
}

.search-input:focus {
  border-color: var(--app-accent);
}

.win-controls {
  display: flex;
  flex-shrink: 0;
  height: 100%;
}

.win-btn {
  width: 44px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--app-text-soft);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.win-btn:hover {
  background: var(--app-hover);
  color: var(--app-text);
}

.win-btn-close:hover {
  background: #e5484d;
  color: #fff;
}

/* ---------- 主体 ---------- */
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.sidebar {
  width: 208px;
  flex-shrink: 0;
  padding: 8px 0 14px;
  overflow-y: auto;
  background: var(--app-bg-soft);
  border-right: 1px solid var(--app-border);
}

.cat-block {
  margin-bottom: 6px;
}

.cat-title {
  padding: 10px 16px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-soft);
  letter-spacing: 0.5px;
}

/* 菜单项做成圆角悬浮块：比通栏左划线更现代，点击热区也更大 */
.tool-item {
  margin: 0 8px;
  padding: 8px 12px;
  font-size: 13.5px;
  line-height: 1.4;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.12s, color 0.12s;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.tool-item:hover {
  background: var(--app-hover);
}

.tool-item.active {
  background: var(--app-active);
  color: var(--app-accent);
  font-weight: 600;
}

.tool-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 收藏星标：默认隐藏，悬停行浮现；已收藏的常亮强调色 */
.star-btn {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-soft);
  opacity: 0;
  transition: opacity 0.12s, color 0.12s;
  cursor: pointer;
  border-radius: 4px;
}

.tool-item:hover .star-btn {
  opacity: 0.7;
}

.star-btn:hover {
  opacity: 1;
  color: var(--app-accent);
}

.star-btn.on {
  opacity: 1;
  color: var(--app-accent);
}

.star-btn svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linejoin: round;
}

.star-btn.on svg,
.star-btn:hover svg {
  fill: currentColor;
}

.sidebar-empty {
  padding: 12px 14px;
  font-size: 12px;
  color: var(--app-text-soft);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* ---------- 标签条 ---------- */
.tabbar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 32px;
  flex-shrink: 0;
  padding: 0 6px;
  overflow-x: auto;
  background: var(--app-bg-soft);
  border-bottom: 1px solid var(--app-border);
}

.tabbar::-webkit-scrollbar {
  height: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--app-text-soft);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}

.tab:hover {
  color: var(--app-text);
}

.tab.active {
  color: var(--app-accent);
  border-bottom-color: var(--app-accent);
}

/* 常驻主页 tab：无关闭按钮，稍加一点区分度 */
.home-tab {
  font-weight: 500;
}

.tab-close {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
  border-radius: 50%;
  color: inherit;
}

.tab-close:hover {
  background: var(--app-border);
}

/* ---------- 标签右键菜单 ---------- */
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.ctx-menu {
  position: fixed;
  min-width: 128px;
  padding: 4px;
  background: var(--app-bg);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  z-index: 1001;
}

.ctx-item {
  padding: 7px 14px;
  font-size: 12.5px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--app-text);
  transition: background 0.1s;
}

.ctx-item:hover {
  background: var(--app-hover);
}

.ctx-item.disabled {
  color: var(--app-text-soft);
  opacity: 0.5;
  pointer-events: none;
}

.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--app-border);
}

.pane {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 20px;
  box-sizing: border-box;
}

/* ---------- 状态栏 ---------- */
.statusbar {
  display: flex;
  align-items: center;
  height: 22px;
  flex-shrink: 0;
  padding: 0 12px;
  font-size: 11px;
  color: var(--app-text-soft);
  background: var(--app-titlebar);
  border-top: 1px solid var(--app-border);
}

.spacer {
  flex: 1;
}

.hint {
  white-space: nowrap;
}
</style>
