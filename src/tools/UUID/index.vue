<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { copyToClipboard } from '../../host'

const count = ref(1)
const results = ref<string[]>([])

function generate() {
  const res: string[] = []
  for (let i = 0; i < Math.min(count.value, 20); i++) {
    res.push(crypto.randomUUID())
  }
  results.value = res
}

function copyText(text: string) {
  copyToClipboard(text)
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

onMounted(() => generate())
</script>

<template>
  <div class="uuid-tool">
    <h2>UUID 生成</h2>
    <p class="desc">随机生成符合 v4 规范的 UUID，支持批量生成和一键复制</p>

    <div class="toolbar">
      <div class="toolbar-left">
        <el-input-number v-model="count" :min="1" :max="20" size="small" />
        <el-button type="primary" size="small" @click="generate">生成</el-button>
      </div>
      <div class="toolbar-right" v-if="results.length">
        <el-button size="small" @click="copyText(results.join('\n'))">复制全部</el-button>
      </div>
    </div>

    <div class="result-list">
      <div
        v-for="(uuid, idx) in results"
        :key="idx"
        class="uuid-item"
        @click="copyText(uuid)"
      >
        <span class="uuid-text">{{ uuid }}</span>
        <span class="uuid-copy">复制</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uuid-tool {
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

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 8px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.uuid-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-color));
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.uuid-item:hover {
  background: var(--bg-hover);
}

.uuid-text {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 14px;
  color: var(--text-primary);
  user-select: none;
}

.uuid-copy {
  color: var(--app-accent);
  font-size: 12px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.uuid-item:hover .uuid-copy {
  opacity: 1;
}

  html.dark .uuid-item {
    background: var(--bg-card);
    border-color: var(--border-color);
  }
  html.dark .uuid-item:hover {
    background: var(--bg-hover);
  }
  html.dark .uuid-text {
    color: var(--text-primary);
  }
  html.dark h2 {
    color: var(--text-primary);
  }
  html.dark .desc {
    color: var(--text-secondary);
  }
</style>
