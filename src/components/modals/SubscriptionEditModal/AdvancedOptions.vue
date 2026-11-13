<script setup>
import { computed, ref } from 'vue';
import Switch from '../../ui/Switch.vue';
import { useI18n } from '../../../i18n/index.js';
import TrafficQuotaField from './TrafficQuotaField.vue';
import OperatorChain from '../../features/Operators/OperatorChain.vue';

const { t } = useI18n();

const props = defineProps({
  editingSubscription: {
    type: Object,
    required: true
  },
  managed: Boolean
});

const isOperatorsExpanded = ref(false);

const sourceOperators = computed({
  get: () => (Array.isArray(props.editingSubscription?.operators) ? props.editingSubscription.operators : []),
  set: (value) => {
    if (!props.editingSubscription) return;
    props.editingSubscription.operators = Array.isArray(value) ? value : [];
  }
});

const sourceOperatorCount = computed(() => sourceOperators.value.length);
</script>

<template>
  <!-- User-Agent -->
  <div v-if="!managed">
    <label for="sub-edit-ua" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ t('subscriptions.uaLabel') }}
      <span class="text-xs text-gray-500 ml-2">{{ t('subscriptions.optionalDefault') }}</span>
    </label>
    <select id="sub-edit-ua" v-model="editingSubscription.customUserAgent"
      class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 tsub-radius-md dark:text-white">
      <option value="">{{ t('subscriptions.defaultUa') }}</option>
      <option value="TSub">TSub</option>
      <option value="clash-verge/v2.4.3">Clash Verge</option>
      <option value="clash.meta">Clash Meta</option>
      <option value="v2rayN/7.23">v2rayN</option>
      <option value="Shadowrocket/1.9.0">Shadowrocket</option>
      <option value="Mozilla/5.0">Mozilla</option>
    </select>
    <p v-if="editingSubscription.customUserAgent" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
      {{ t('subscriptions.currentUa', { ua: editingSubscription.customUserAgent }) }}
    </p>
  </div>

  <TrafficQuotaField :editing-subscription="editingSubscription" />

  <!-- 官网 -->
  <div>
    <label for="sub-edit-website" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ t('subscriptions.websiteLabel') }}
      <span class="text-xs text-gray-500 ml-2">{{ t('subscriptions.websiteOptional') }}</span>
    </label>
    <input
      id="sub-edit-website"
      v-model="editingSubscription.website"
      type="url"
      inputmode="url"
      placeholder="https://example.com"
      class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 tsub-radius-md dark:text-white font-mono text-sm"
    />
    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('subscriptions.websiteHint') }}</p>
  </div>

  <!-- 备注 -->
  <div>
    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('subscriptions.notesLabel') }}</label>
    <textarea v-model="editingSubscription.notes" :placeholder="t('subscriptions.notesPlaceholder')"
      rows="2"
      class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 tsub-radius-md dark:text-white"></textarea>
  </div>

  <!-- 开关选项 -->
  <div class="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
    <div v-if="!managed" class="flex items-center justify-between gap-4">
      <div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('subscriptions.nodeCacheTitle') }}</span>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t('subscriptions.nodeCacheDesc') }}</p>
      </div>
      <Switch v-model="editingSubscription.enableNodeCache" />
    </div>

    <div v-if="!managed" class="flex items-center justify-between gap-4">
      <div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('subscriptions.plusAsSpaceTitle') }}</span>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t('subscriptions.plusAsSpaceDesc') }}</p>
      </div>
      <Switch v-model="editingSubscription.plusAsSpace" />
    </div>

    <div class="flex items-center justify-between gap-4">
      <div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('subscriptions.excludeTrafficTitle') }}</span>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t('subscriptions.excludeTrafficDesc') }}</p>
      </div>
      <Switch v-model="editingSubscription.excludeTraffic" />
    </div>
  </div>

  <!-- 订阅源级节点名称规则 -->
  <div v-if="!managed" class="pt-3 border-t border-gray-100 dark:border-gray-700">
    <button
      type="button"
      class="flex w-full items-start justify-between gap-3 text-left"
      @click="isOperatorsExpanded = !isOperatorsExpanded"
    >
      <div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('subscriptions.sourceOperatorsTitle') }}</span>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t('subscriptions.sourceOperatorsDesc') }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
          {{ t('subscriptions.sourceOperatorsCount', { count: sourceOperatorCount }) }}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 text-gray-400 transition-transform duration-200"
          :class="{ 'rotate-180': isOperatorsExpanded }"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </button>

    <div v-if="isOperatorsExpanded" class="mt-3">
      <p class="mb-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        {{ t('subscriptions.sourceOperatorsHint') }}
      </p>
      <OperatorChain v-model="sourceOperators" :allowed-types="['rename']" />
    </div>
  </div>
</template>
