<script lang="ts" setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { copyToClipboard } from '../../host'
import { useToolSettings } from '../../toolbox/toolSettings'

// 配置走 schema 架构：与快捷键「复制并粘贴」共用同一份，改动自动持久化
const settings = useToolSettings('password')
const result = ref('')

function generate() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const digit = '0123456789'
  const symbol = '!@#$%^&*()-_=+[]{}|;:,.<>?'
  let chars = ''
  if (settings.useUpper) chars += upper
  if (settings.useLower) chars += lower
  if (settings.useDigit) chars += digit
  if (settings.useSymbol) chars += symbol
  if (!chars) {
    result.value = ''
    return
  }
  let pw = ''
  const array = new Uint32Array(settings.length)
  crypto.getRandomValues(array)
  for (let i = 0; i < settings.length; i++) {
    pw += chars[array[i] % chars.length]
  }
  result.value = pw
}

function copyText(text: string) {
  copyToClipboard(text)
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function getStrength(): { label: string; type: 'danger' | 'warning' | 'success' } {
  const len = settings.length
  let pools = 0
  if (settings.useUpper) pools++
  if (settings.useLower) pools++
  if (settings.useDigit) pools++
  if (settings.useSymbol) pools++
  if (len < 8 || pools < 2) return { label: '弱', type: 'danger' }
  if (len < 12 || pools < 3) return { label: '中', type: 'warning' }
  return { label: '强', type: 'success' }
}
</script>

<template>
  <div class="random-password">
    <h2>随机密码</h2>
    <p class="desc">随机生成安全密码，可配置长度、字符集，实时显示密码强度</p>

    <div class="config">
      <div class="config-row">
        <span>密码长度</span>
        <el-input-number v-model="settings.length" :min="4" :max="64" size="small" />
        <el-slider v-model="settings.length" :min="4" :max="64" style="flex: 1" />
      </div>
      <div class="config-row checkboxes">
        <el-checkbox v-model="settings.useUpper">大写字母 A-Z</el-checkbox>
        <el-checkbox v-model="settings.useLower">小写字母 a-z</el-checkbox>
        <el-checkbox v-model="settings.useDigit">数字 0-9</el-checkbox>
        <el-checkbox v-model="settings.useSymbol">特殊字符 !@#$</el-checkbox>
      </div>
    </div>

    <div class="actions">
      <el-button type="primary" @click="generate">生成密码</el-button>
      <el-tag :type="getStrength().type" size="small">强度：{{ getStrength().label }}</el-tag>
    </div>

    <div v-if="result" class="result">
      <div class="result-value" @click="copyText(result)">{{ result }}</div>
      <el-button size="small" @click="copyText(result)">复制</el-button>
    </div>
  </div>
</template>

<style scoped>
.random-password {
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
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.config-row span {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.result {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-color));
  border-radius: 6px;
}

.result-value {
  flex: 1;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 15px;
  word-break: break-all;
  color: var(--text-primary);
  cursor: pointer;
  letter-spacing: 1px;
}

.result-value:hover {
  color: var(--app-accent);
}

  html.dark .result {
    background: var(--bg-card);
    border-color: var(--border-color);
  }
  html.dark .result-value {
    color: var(--text-primary);
  }
  html.dark .result-value:hover {
    color: var(--app-accent);
  }
  html.dark h2 {
    color: var(--text-primary);
  }
  html.dark .desc {
    color: var(--text-secondary);
  }
</style>
