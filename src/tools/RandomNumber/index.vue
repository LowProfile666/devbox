<script lang="ts" setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { copyToClipboard } from '../../host'
import { useToolSettings } from '../../toolbox/toolSettings'

// 配置走 schema 架构：与快捷键「复制并粘贴」共用同一份，改动自动持久化
const settings = useToolSettings('number')
const results = ref<number[]>([])

function generate() {
  const min = Math.min(settings.min, settings.max)
  const max = Math.max(settings.min, settings.max)
  const total = Math.min(settings.count, 100)
  const randArray = new Uint32Array(total)
  crypto.getRandomValues(randArray)
  const res: number[] = []
  for (let i = 0; i < total; i++) {
    const rawRand = randArray[i] / 0xFFFFFFFF
    const val =
      settings.decimalPlaces > 0
        ? parseFloat((rawRand * (max - min) + min).toFixed(settings.decimalPlaces))
        : Math.floor(rawRand * (max - min + 1)) + min
    res.push(val)
  }
  results.value = res
}

function copyText(text: string) {
  copyToClipboard(text)
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}
</script>

<template>
  <div class="random-number">
    <h2>随机数字</h2>
    <p class="desc">在指定范围内随机生成整数或小数，支持批量和自定义小数位数</p>

    <div class="config">
      <div class="config-row">
        <span>最小值</span>
        <el-input-number v-model="settings.min" size="small" />
        <span>最大值</span>
        <el-input-number v-model="settings.max" size="small" />
      </div>
      <div class="config-row">
        <span>生成个数</span>
        <el-input-number v-model="settings.count" :min="1" :max="100" size="small" />
        <span>小数位数</span>
        <el-input-number v-model="settings.decimalPlaces" :min="0" :max="10" size="small" />
      </div>
    </div>

    <div class="actions">
      <el-button type="primary" @click="generate">生成</el-button>
      <el-button v-if="results.length" size="small" @click="copyText(results.join('\n'))">复制全部</el-button>
    </div>

    <div v-if="results.length" class="result-grid">
      <div
        v-for="(num, idx) in results"
        :key="idx"
        class="result-item"
        @click="copyText(String(num))"
      >
        {{ num }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.random-number {
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
}

.config-row span {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px;
}

.result-item {
  padding: 10px;
  text-align: center;
  background: var(--bg-card);
  border: 1px solid var(--border-color));
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Consolas', monospace;
  font-size: 16px;
  color: var(--text-primary);
  transition: background 0.15s;
}

.result-item:hover {
  background: var(--bg-hover);
  border-color: var(--app-accent);
}

  html.dark .result-item {
    background: var(--bg-card);
    border-color: var(--border-color);
    color: var(--text-primary);
  }
  html.dark .result-item:hover {
    background: var(--bg-hover);
    border-color: var(--app-accent);
  }
  html.dark h2 {
    color: var(--text-primary);
  }
  html.dark .desc {
    color: var(--text-secondary);
  }
</style>
