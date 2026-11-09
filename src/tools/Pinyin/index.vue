<script lang="ts" setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, CopyDocument } from '@element-plus/icons-vue'
import { pinyin } from 'pinyin-pro'
import { copyToClipboard } from '../../host'

interface FormatItem {
  label: string
  value: string
}

const input = ref('')
const formats = ref<FormatItem[]>([])
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function convert() {
  const text = input.value.trim()
  if (!text) {
    formats.value = []
    return
  }

  const arr: string[] = pinyin(text, { type: 'array', toneType: 'none' })

  formats.value = [
    { label: '全拼', value: arr.join('') },
    {
      label: '小驼峰',
      value: arr.map((s, i) => i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)).join('')
    },
    {
      label: '大驼峰',
      value: arr.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
    },
    { label: '下划线', value: arr.join('_') },
    { label: '常量命名', value: arr.join('_').toUpperCase() },
    { label: '短横线', value: arr.join('-') },
    { label: '仅首字母', value: arr.map(s => s.charAt(0)).join('') },
  ]
}

function copyText(text: string) {
  copyToClipboard(text)
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function clear() {
  input.value = ''
  formats.value = []
}

watch(input, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(convert, 200)
})
</script>

<template>
  <div class="pinyin-tool">
    <h2>中文转拼音</h2>
    <p class="desc">将中文转换为拼音命名格式，支持全拼、驼峰、下划线、常量、首字母等多种格式</p>

    <div class="input-area">
      <el-input
        v-model="input"
        type="textarea"
        :rows="3"
        placeholder="输入中文，例如：特殊成绩标识"
        size="small"
      />
      <div class="input-actions" v-if="input">
        <el-button size="small" @click="clear">
          <el-icon><Delete /></el-icon>
          清空
        </el-button>
      </div>
    </div>

    <div class="format-list" v-if="formats.length">
      <div
        v-for="item in formats"
        :key="item.label"
        class="format-item"
        @click="copyText(item.value)"
      >
        <span class="format-label">{{ item.label }}</span>
        <span class="format-value">{{ item.value }}</span>
        <el-icon class="format-copy"><CopyDocument /></el-icon>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pinyin-tool {
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

.input-area {
  margin-bottom: 16px;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.format-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.format-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-color));
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  gap: 12px;
}

.format-item:hover {
  background: var(--bg-hover);
}

.format-label {
  flex-shrink: 0;
  width: 64px;
  color: var(--text-secondary);
  font-size: 12px;
}

.format-value {
  flex: 1;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 14px;
  color: var(--text-primary);
  user-select: none;
  word-break: break-all;
}

.format-copy {
  flex-shrink: 0;
  color: var(--app-accent);
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.15s;
}

.format-item:hover .format-copy {
  opacity: 1;
}

  html.dark .format-item {
    background: var(--bg-card);
    border-color: var(--border-color);
  }
  html.dark .format-item:hover {
    background: var(--bg-hover);
  }
  html.dark .format-value {
    color: var(--text-primary);
  }
  html.dark .format-label {
    color: var(--text-secondary);
  }
  html.dark .format-copy {
    color: var(--app-accent);
  }
  html.dark h2 {
    color: var(--text-primary);
  }
  html.dark .desc {
    color: var(--text-secondary);
  }
</style>
