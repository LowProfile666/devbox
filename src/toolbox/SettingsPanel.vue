<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { invoke } from '@tauri-apps/api/core'
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart'
import {
  acceleratorFromEvent,
  applyShortcuts,
  loadShortcuts,
  prettyAccelerator,
  saveShortcuts,
  type ShortcutConfig,
} from '../host/shortcuts'
import { setThemeMode, themeMode, type ThemeMode } from '../host/theme'
import { categories } from './tools'
import { supportsQuickCopy } from './quickActions'
import { copyToClipboard, storage as kvStore } from '../host'

const draft = reactive<ShortcutConfig>({ toggle: '', tools: {}, copies: {}, pastes: {}, actions: {} })

// ---------- 可绑定功能的静态清单 ----------
// 每个工具一行：「打开」快捷键直接放行上，复制/粘贴等子功能折叠在工具行下。
// 全部平铺 + 可折叠，既能一眼看全，又不会列表过长。

interface FuncRow {
  /** `tool:<code>` | `copy:<code>` | `paste:<code>` | `qrcapture:<code>` 等，同时是配置键 */
  id: string
  /** 行内显示的功能名（子行不带工具前缀，折叠层级已表达归属） */
  name: string
}

interface ToolNode {
  /** 折叠状态用；全局行没有工具概念时用 id 代号 */
  key: string
  name: string
  /** 行上直接设置的快捷键 = 打开工具/主功能 */
  openId: string
  /** 折叠的子功能行 */
  subs: FuncRow[]
}

const funcNodes = computed<ToolNode[]>(() => {
  const nodes: ToolNode[] = [
    { key: 'toggle', name: '唤起 / 隐藏主窗口', openId: 'toggle', subs: [] },
  ]
  for (const cat of categories) {
    for (const tool of cat.tools) {
      const subs: FuncRow[] = []
      if (supportsQuickCopy(tool.code)) {
        subs.push({ id: `copy:${tool.code}`, name: '复制结果' })
        subs.push({ id: `paste:${tool.code}`, name: '复制并粘贴' })
      }
      if (tool.code === 'qrcode') {
        subs.push({ id: 'qrcapture:qrcode', name: '截图识别' })
        subs.push({ id: 'qrread:qrcode', name: '从剪贴板识别' })
      }
      nodes.push({ key: tool.code, name: tool.explain, openId: `tool:${tool.code}`, subs })
    }
  }
  return nodes
})

/** 按分类聚合，模板按组渲染 */
const groupedNodes = computed(() => {
  const groups: { name: string; nodes: ToolNode[] }[] = [
    { name: '全局', nodes: [funcNodes.value[0]] },
  ]
  const rest = funcNodes.value.slice(1)
  for (const cat of categories) {
    groups.push({
      name: cat.name,
      nodes: rest.filter((node) => {
        const code = node.key
        const tool = cat.tools.find((t) => t.code === code)
        return !!tool
      }),
    })
  }
  return groups
})

/** 已设置的快捷键数量角标 */
const boundCount = computed(() => {
  let n = draft.toggle ? 1 : 0
  for (const record of [draft.tools, draft.copies, draft.pastes, draft.actions]) {
    n += Object.values(record).filter(Boolean).length
  }
  return n
})

// ---------- 折叠（el-collapse：每个分组一个实例，所有一级条目统一用 collapse-item） ----------

/** 分组名 -> 展开的工具 key 列表 */
const expandedKeys = ref<Record<string, string[]>>(
  Object.fromEntries(groupedNodes.value.map((group) => [group.name, []]))
)

// ---------- 录制 ----------

const recording = ref<string | null>(null)

function recordOf(id: string): string {
  if (id === 'toggle') return draft.toggle
  const [kind, code] = id.split(':')
  if (!code) return ''
  if (kind === 'tool') return draft.tools[code] ?? ''
  if (kind === 'copy') return draft.copies[code] ?? ''
  if (kind === 'paste') return draft.pastes[code] ?? ''
  return draft.actions[id] ?? ''
}

function setAcc(id: string, accelerator: string) {
  if (id === 'toggle') {
    draft.toggle = accelerator
    return
  }
  const [kind, code] = id.split(':')
  if (!code) return
  if (kind === 'tool' || kind === 'copy' || kind === 'paste') {
    const record = kind === 'tool' ? draft.tools : kind === 'copy' ? draft.copies : draft.pastes
    if (accelerator) record[code] = accelerator
    else delete record[code]
  } else {
    // 其它功能动作：整个 id 作为键
    if (accelerator) draft.actions[id] = accelerator
    else delete draft.actions[id]
  }
}

function displayAcc(id: string): string {
  if (recording.value === id) return '按下组合键…'
  const acc = recordOf(id)
  return acc ? prettyAccelerator(acc) : '未设置'
}

function onKeydown(event: KeyboardEvent, id: string) {
  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    recording.value = null
    return
  }
  // 只按退格 = 清空该快捷键
  if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    setAcc(id, '')
    recording.value = null
    void applyNow()
    return
  }

  const accelerator = acceleratorFromEvent(event)
  if (!accelerator) return // 只有修饰键，继续等待
  setAcc(id, accelerator)
  recording.value = null
  void applyNow()
}

// ---------- 存储位置 ----------

interface StorageInfo {
  data_dir: string
  is_custom: boolean
  marker_path: string
  /** 可安全清理的缓存（Chromium 网络缓存、着色器缓存等）字节数 */
  cache_bytes: number
}

const storage = ref<StorageInfo>({ data_dir: '', is_custom: false, marker_path: '', cache_bytes: 0 })
const storageChanging = ref(false)

function formatMB(bytes: number): string {
  if (!bytes) return '0'
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function loadStorage() {
  try {
    storage.value = await invoke<StorageInfo>('storage_info')
  } catch {
    // 拿不到就显示占位，不影响其它设置
  }
}

/** 清理 Chromium 缓存（不动 Local Storage 等真实数据），返回释放的字节数 */
async function cleanCache() {
  storageChanging.value = true
  try {
    const freed = await invoke<number>('clean_webview_cache')
    await loadStorage()
    ElMessage.success(`缓存已清理，释放 ${formatMB(freed)}`)
  } catch (e) {
    ElMessage.error(`清理失败：${e}`)
  } finally {
    storageChanging.value = false
  }
}

async function chooseDataDir() {
  const dir = await invoke<string | null>('pick_folder')
  if (!dir) return
  storageChanging.value = true
  try {
    await invoke('set_data_dir', { path: dir })
    await loadStorage()
    ElMessage.success('已保存，重启应用后生效')
  } catch (e) {
    ElMessage.error(`设置失败：${e}`)
  } finally {
    storageChanging.value = false
  }
}

async function resetDataDir() {
  storageChanging.value = true
  try {
    await invoke('set_data_dir', { path: null })
    await loadStorage()
    ElMessage.success('已恢复默认，重启应用后生效')
  } catch (e) {
    ElMessage.error(`设置失败：${e}`)
  } finally {
    storageChanging.value = false
  }
}

async function openDataDir() {
  try {
    await invoke('open_in_explorer', { path: storage.value.data_dir })
  } catch {
    ElMessage.error('打开目录失败')
  }
}

function copyPath(path: string) {
  copyToClipboard(path).then(() => ElMessage.success('路径已复制'))
}

// ---------- 主题 / 加载 / 保存 ----------

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

function onThemeChange(mode: ThemeMode) {
  setThemeMode(mode)
}

function loadDraft() {
  const saved = loadShortcuts()
  draft.toggle = saved.toggle
  draft.tools = { ...saved.tools }
  draft.copies = { ...saved.copies }
  draft.pastes = { ...saved.pastes }
  draft.actions = { ...saved.actions }
  // 每个分组初始化空展开表；有子功能绑定的工具默认展开
  const expanded: Record<string, string[]> = {}
  for (const group of groupedNodes.value) {
    expanded[group.name] = group.nodes
      .filter((node) => node.subs.length && node.subs.some((sub) => recordOf(sub.id)))
      .map((node) => node.key)
  }
  expandedKeys.value = expanded
  void loadStorage()
}

onMounted(async () => {
  loadDraft()
  // 行为设置：开机自启状态 + 把持久化的关闭动作同步给 Rust（Rust 内存态重启即失）
  try {
    autostartOn.value = await isAutostartEnabled()
  } catch {
    // 查询失败就按未开启展示，不影响其它设置
  }
  void invoke('set_close_action', { action: closeAction.value })
})

function resetDefaults() {
  draft.toggle = 'Alt+Space'
  draft.tools = {}
  draft.copies = {}
  draft.pastes = {}
  draft.actions = {}
  void applyNow()
}

/**
 * 快捷键修改即时生效：每次变更后整份持久化并下发给 Rust 重注册。
 * 成功静默，失败才提示（比如组合键被其它程序占用）。
 */
async function applyNow() {
  const config: ShortcutConfig = {
    toggle: draft.toggle,
    tools: { ...draft.tools },
    copies: { ...draft.copies },
    pastes: { ...draft.pastes },
    actions: { ...draft.actions },
  }
  saveShortcuts(config)
  const failed = await applyShortcuts(config)
  if (failed.length) {
    const nameOf = (id: string) => {
      const [kind, code] = id.split(':')
      const tool = categories
        .flatMap((cat) => cat.tools)
        .find((tool) => tool.code === code)
      const prefix = kind === 'copy' ? '复制·' : kind === 'paste' ? '复制并粘贴·' : ''
      return `${prefix}${tool?.explain ?? id}`
    }
    ElMessage.warning(`未能注册：${failed.map(nameOf).join('、')}（可能被其它程序占用）`)
  }
}

// ---------- 行为：开机自启 / 关闭动作 ----------

const autostartOn = ref(false)

const CLOSE_ACTION_KEY = 'devbox.closeAction'
/** 'tray' = 点 ✕ 收进托盘；'exit' = 直接退出。Rust 侧窗口事件按这个值分流。 */
const closeAction = ref<'tray' | 'exit'>(
  kvStore.get(CLOSE_ACTION_KEY) === 'exit' ? 'exit' : 'tray'
)

async function toggleAutostart(value: boolean | string | number) {
  const on = Boolean(value)
  try {
    if (on) {
      await enableAutostart()
    } else {
      await disableAutostart()
    }
    autostartOn.value = on
  } catch (e) {
    ElMessage.error(`设置开机自启失败：${e}`)
  }
}

function onCloseActionChange(value: 'tray' | 'exit') {
  closeAction.value = value
  kvStore.set(CLOSE_ACTION_KEY, value)
  void invoke('set_close_action', { action: value })
}
</script>

<template>
  <div class="settings-page">
    <h2>设置</h2>
    <p class="desc">外观、全局快捷键与存储位置</p>

    <!-- 外观 -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">外观</span>
        <span class="section-desc">主题立即生效，无需保存</span>
      </div>
      <el-radio-group :model-value="themeMode" size="small" @change="onThemeChange">
        <el-radio-button v-for="opt in themeOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <!-- 行为 -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">行为</span>
        <span class="section-desc">开关即时生效，无需保存</span>
      </div>

      <div class="behavior-row">
        <div class="behavior-info">
          <span class="behavior-label">开机自启</span>
          <span class="behavior-desc">登录 Windows 后自动启动，并驻留托盘</span>
        </div>
        <el-switch :model-value="autostartOn" @change="toggleAutostart" />
      </div>

      <div class="behavior-row">
        <div class="behavior-info">
          <span class="behavior-label">点关闭按钮时</span>
          <span class="behavior-desc">决定窗口 ✕ 和 Alt+F4 的行为</span>
        </div>
        <el-radio-group
          :model-value="closeAction"
          size="small"
          @change="onCloseActionChange($event as 'tray' | 'exit')"
        >
          <el-radio-button value="tray">最小化到托盘</el-radio-button>
          <el-radio-button value="exit">直接退出</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <!-- 全局快捷键：工具一行，子功能折叠 -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">
          全局快捷键
          <span v-if="boundCount" class="badge">{{ boundCount }}</span>
        </span>
        <span class="section-desc">点输入框按下组合键；退格清空；行上的键 = 打开工具</span>
      </div>

      <div class="func-list">
        <template v-for="group in groupedNodes" :key="group.name">
          <div class="group-title">{{ group.name }}</div>
          <el-collapse v-model="expandedKeys[group.name]" class="tool-collapse">
            <!-- 所有一级条目统一走 collapse-item，无子功能的隐藏箭头，样式完全一致 -->
            <el-collapse-item
              v-for="node in group.nodes"
              :key="node.key"
              :name="node.key"
              :class="{ 'no-subs': !node.subs.length }"
            >
              <template #title>
                <div class="tool-head">
                  <span class="func-name">{{ node.name }}</span>
                  <!-- 点击输入框录制快捷键时不触发展开/收起 -->
                  <span class="head-input" @click.stop>
                    <input
                      class="key-input"
                      :class="{
                        recording: recording === node.openId,
                        bound: !!recordOf(node.openId),
                      }"
                      readonly
                      :value="displayAcc(node.openId)"
                      @focus="recording = node.openId"
                      @blur="recording = null"
                      @keydown="onKeydown($event, node.openId)"
                    />
                  </span>
                </div>
              </template>
              <div v-for="sub in node.subs" :key="sub.id" class="func-row sub-row">
                <span class="func-name sub-name">{{ sub.name }}</span>
                <input
                  class="key-input"
                  :class="{ recording: recording === sub.id, bound: !!recordOf(sub.id) }"
                  readonly
                  :value="displayAcc(sub.id)"
                  @focus="recording = sub.id"
                  @blur="recording = null"
                  @keydown="onKeydown($event, sub.id)"
                />
              </div>
            </el-collapse-item>
          </el-collapse>
        </template>
      </div>

      <div class="section-foot">
        <el-button size="small" type="danger" plain @click="resetDefaults">清空全部快捷键</el-button>
        <span class="hint">修改即时生效；「复制 / 复制并粘贴 / 二维码识别」在后台完成，不打断当前操作</span>
      </div>
    </div>

    <!-- 存储位置 -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">存储位置</span>
        <span class="section-desc">主题、快捷键、常用工具统计等都保存在数据目录中</span>
      </div>

      <div class="storage-path">
        <span class="storage-label">
          数据存放目录
          <span class="storage-tag" :class="{ custom: storage.is_custom }">
            {{ storage.is_custom ? '自定义' : '系统默认' }}
          </span>
        </span>
        <span class="path-text" :title="storage.data_dir">{{ storage.data_dir || '…' }}</span>
      </div>

      <div class="storage-actions">
        <el-button size="small" @click="openDataDir">打开目录</el-button>
        <el-button size="small" @click="copyPath(storage.data_dir)">复制路径</el-button>
        <el-button size="small" type="primary" :loading="storageChanging" @click="chooseDataDir">
          更改…
        </el-button>
        <el-button v-if="storage.is_custom" size="small" :disabled="storageChanging" @click="resetDataDir">
          恢复默认
        </el-button>
      </div>

      <div class="storage-path">
        <span class="storage-label">
          缓存占用
          <span class="storage-tag">{{ formatMB(storage.cache_bytes) }}</span>
        </span>
        <span class="path-text">网络缓存、着色器缓存等运行产物，可安全清理；你的配置数据（仅几 KB）不受影响</span>
        <el-button size="small" :disabled="storageChanging || !storage.cache_bytes" @click="cleanCache">
          清理缓存
        </el-button>
      </div>

      <p class="hint">
        更改数据目录后需重启应用生效；已有数据不会自动迁移，需要保留可在更改前手动复制目录内容。
      </p>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 720px;
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

/* ---------- 分区卡片 ---------- */
.section {
  margin-bottom: 14px;
  padding: 14px 16px;
  background: var(--app-bg-soft);
  border: 1px solid var(--app-border);
  border-radius: 10px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-desc {
  font-size: 11px;
  color: var(--app-text-soft);
}

.badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 500;
  color: #fff;
  background: var(--app-accent);
  border-radius: 9px;
}

/* ---------- 快捷键清单 ---------- */
.func-list {
  margin: 0 -4px;
}

.group-title {
  padding: 10px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--app-text-soft);
  letter-spacing: 0.5px;
}

.func-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 6px;
}

.func-row.tool-row:hover {
  background: var(--app-hover);
}

.func-row.sub-row {
  /* 相对一级行缩进，体现从属层级 */
  margin-left: 26px;
  margin-bottom: 2px;
}

/* el-collapse 外观统一到主题：去默认边框，标题行即工具行 */
.tool-collapse {
  --el-collapse-border-color: transparent;
  --el-collapse-header-height: 30px;
}

.tool-collapse :deep(.el-collapse-item__header) {
  background: transparent;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--app-text);
  transition: background 0.12s;
}

.tool-collapse :deep(.el-collapse-item__header:hover) {
  background: var(--app-hover);
}

.tool-collapse :deep(.el-collapse-item__header .tool-head) {
  flex: 1;
  min-width: 0;
}

.tool-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom: none;
}

.tool-collapse :deep(.el-collapse-item__content) {
  /* 右侧留出箭头宽度（1em ≈ 标题字号 12.5px），二级行的快捷键输入框与一级行右缘对齐 */
  padding: 2px 12.5px 4px 0;
}

/* 无子功能的工具：箭头只隐藏不占位消失（visibility 保持布局，让各行输入框对齐），
   空内容区不渲染 */
.tool-collapse :deep(.no-subs .el-collapse-item__arrow) {
  visibility: hidden;
}

.tool-collapse :deep(.no-subs .el-collapse-item__wrap) {
  display: none;
}

.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-input {
  flex-shrink: 0;
}

.func-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.func-name.sub-name {
  color: var(--app-text-soft);
}

.key-input {
  width: 140px;
  height: 26px;
  flex-shrink: 0;
  padding: 0 10px;
  font-size: 12px;
  color: var(--app-text-soft);
  background: var(--app-bg);
  border: 1px solid var(--app-border);
  border-radius: 6px;
  outline: none;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.12s, color 0.12s;
}

.key-input.bound {
  color: var(--app-accent);
  border-color: color-mix(in srgb, var(--app-accent) 45%, transparent);
}

.key-input:focus,
.key-input.recording {
  border-color: var(--app-accent);
  color: var(--app-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-accent) 18%, transparent);
}

.section-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

/* ---------- 行为 ---------- */
.behavior-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
}

.behavior-row + .behavior-row {
  margin-top: 4px;
}

.behavior-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.behavior-label {
  font-size: 12.5px;
  color: var(--app-text);
}

.behavior-desc {
  font-size: 11px;
  color: var(--app-text-soft);
}

/* ---------- 存储位置 ---------- */
.storage-path {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 4px 8px;
}

.storage-label {
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--app-text);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.storage-tag {
  padding: 1px 6px;
  font-size: 10px;
  border-radius: 4px;
  color: var(--app-text-soft);
  background: var(--app-hover);
}

.storage-tag.custom {
  color: var(--app-accent);
  background: color-mix(in srgb, var(--app-accent) 14%, transparent);
}

.path-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-family: Consolas, monospace;
  color: var(--app-text-soft);
  word-break: break-all;
  line-height: 1.4;
}

.storage-actions {
  display: flex;
  gap: 8px;
  padding: 6px 8px 8px;
}

.hint {
  margin: 4px 8px 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--app-text-soft);
}

/* ---------- 页脚 ---------- */
.page-foot {
  display: flex;
  align-items: center;
  padding: 6px 8px 20px;
}

html.dark .desc {
  color: var(--text-secondary);
}

.spacer {
  flex: 1;
}
</style>
