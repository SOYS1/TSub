<script setup>
import { computed } from 'vue';
import { useI18n } from '../../../../i18n/index.js';
import Input from '../../../ui/Input.vue';
import Switch from '../../../ui/Switch.vue';

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();

const DEFAULTS = {
  testMode: 'real',
  pingUrl: 'http://cp.cloudflare.com/generate_204',
  enableSpeedTest: false,
  speedTestUrl: 'https://speed.cloudflare.com/__down?bytes=10000000',
  timeout: 8000,
  concurrency: 8
};

const radioGroup = `speedtest-mode-${Math.random().toString(36).slice(2)}`;

const params = computed({
  get: () => ({ ...DEFAULTS, ...props.modelValue }),
  set: (value) => emit('update:modelValue', value)
});

const updateValue = (patch) => {
  params.value = { ...params.value, ...patch };
};

const updateNumber = (key, value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  updateValue({ [key]: Number.isFinite(parsed) ? parsed : fallback });
};

const modeOptions = computed(() => [
  {
    value: 'tcp',
    label: t('operators.speedTestModeTcp'),
    hint: t('operators.speedTestModeTcpHint')
  },
  {
    value: 'real',
    label: t('operators.speedTestModeReal'),
    hint: t('operators.speedTestModeRealHint')
  }
]);
</script>

<template>
  <div class="space-y-5">
    <div class="space-y-2">
      <label class="text-[11px] font-bold uppercase tracking-tight text-gray-400">{{ t('operators.speedTestMode') }}</label>
      <div class="grid gap-2 sm:grid-cols-2">
        <label
          v-for="mode in modeOptions"
          :key="mode.value"
          :class="[
            'cursor-pointer rounded-xl border p-3 transition-all',
            params.testMode === mode.value
              ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/10 dark:border-indigo-400 dark:bg-indigo-500/10'
              : 'border-gray-100 bg-gray-50/60 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/40'
          ]"
        >
          <input
            type="radio"
            :name="radioGroup"
            class="sr-only"
            :checked="params.testMode === mode.value"
            @change="updateValue({ testMode: mode.value })"
          />
          <span class="block text-sm font-semibold text-gray-900 dark:text-gray-100">{{ mode.label }}</span>
          <span class="mt-1 block text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">{{ mode.hint }}</span>
        </label>
      </div>
    </div>

    <Input
      v-if="params.testMode === 'real'"
      :modelValue="params.pingUrl"
      @update:modelValue="(value) => updateValue({ pingUrl: value })"
      :label="t('operators.speedTestPingUrl')"
      :placeholder="DEFAULTS.pingUrl"
      size="sm"
    />

    <p v-if="params.testMode === 'real'" class="px-1 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
      {{ t('operators.speedTestRealHint') }}
    </p>
    <p v-else class="px-1 text-[10px] leading-relaxed text-gray-400">
      {{ t('operators.speedTestTcpHint') }}
    </p>

    <div class="rounded-xl border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-900/40">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-gray-200">{{ t('operators.speedTestDownload') }}</p>
          <p class="text-[10px] text-gray-500 dark:text-gray-400">{{ t('operators.speedTestDownloadHint') }}</p>
        </div>
        <Switch
          :modelValue="params.enableSpeedTest"
          @update:modelValue="(value) => updateValue({ enableSpeedTest: value })"
        />
      </div>

      <div v-if="params.enableSpeedTest" class="mt-3 space-y-2">
        <Input
          :modelValue="params.speedTestUrl"
          @update:modelValue="(value) => updateValue({ speedTestUrl: value })"
          :label="t('operators.speedTestDownloadUrl')"
          :placeholder="DEFAULTS.speedTestUrl"
          size="sm"
        />
        <p v-if="params.testMode !== 'real'" class="px-1 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
          {{ t('operators.speedTestRequiresReal') }}
        </p>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <Input
        :modelValue="params.timeout"
        @update:modelValue="(value) => updateNumber('timeout', value, DEFAULTS.timeout)"
        :label="t('operators.speedTestTimeout')"
        type="number"
        size="sm"
      />
      <Input
        :modelValue="params.concurrency"
        @update:modelValue="(value) => updateNumber('concurrency', value, DEFAULTS.concurrency)"
        :label="t('operators.speedTestConcurrency')"
        type="number"
        size="sm"
      />
    </div>

    <p class="px-1 text-[10px] leading-relaxed text-gray-400">
      {{ t('operators.speedTestRuntimeHint') }}
    </p>
  </div>
</template>
