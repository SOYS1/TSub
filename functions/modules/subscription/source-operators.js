import { runOperatorChain } from '../../utils/operator-runner.js';
import { parseNodeInfo } from '../utils/geo-utils.js';

/**
 * 将任意来源的 operators 数据归一化为数组，保证 runOperatorChain 不会收到
 * undefined / null / 非法对象。
 * @param {*} value
 * @returns {Array}
 */
export function normalizeSourceOperators(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

/**
 * 解析订阅源上实际生效的算子链。
 * 与 subscription-service.js 中 applySubscriptionTransforms 的取值顺序保持一致：
 * sub.operators > sub.nodeTransform.operators（仅当 nodeTransform.enabled）。
 * @param {Object} subscription
 * @returns {Array}
 */
export function resolveSubscriptionOperators(subscription) {
    let operators = normalizeSourceOperators(subscription?.operators);
    if (!operators.length && subscription?.nodeTransform?.enabled) {
        operators = normalizeSourceOperators(subscription.nodeTransform.operators);
    }
    return operators.filter(op => op && typeof op === 'object' && typeof op.type === 'string');
}

/**
 * 订阅源是否配置了启用中的 rename 算子。
 * 用于正式生成时跳过订阅源名称前缀，保证与预览输出一致。
 * @param {Object} subscription
 * @returns {boolean}
 */
export function hasEnabledRenameOperator(subscription) {
    return resolveSubscriptionOperators(subscription).some(op => {
        if (op.type !== 'rename' || op.enabled === false) return false;
        const params = op.params || {};

        const regex = params.regex;
        if (regex?.enabled === true) {
            const rules = Array.isArray(regex.rules) ? regex.rules : [];
            const hasRules = rules.some(rule => (
                typeof rule === 'string' ? rule.trim() !== '' : Boolean(rule?.pattern)
            ));
            if (hasRules) return true;
        }

        return params.template?.enabled === true && Boolean(params.template?.template);
    });
}

/**
 * 在节点数组上执行订阅源级算子链。节点名称编码在 URL 中，因此执行后重新解析
 * 以刷新 name/region 等派生字段。
 * @param {Array<Object>} nodes
 * @param {Object} subscription
 * @param {{ config?: Object, userAgent?: string }} options
 * @returns {Promise<Array<Object>>}
 */
export async function applySubscriptionOperators(nodes, subscription, options = {}) {
    if (!Array.isArray(nodes) || nodes.length === 0) return nodes;

    const operators = resolveSubscriptionOperators(subscription);
    if (operators.length === 0) return nodes;

    const nodeUrls = nodes.map(node => node?.url).filter(Boolean);
    if (nodeUrls.length === 0) return nodes;

    try {
        // 直接传入节点对象而不是 URL 字符串：这样上游算子（例如测速）写入的
        // metadata 会被完整保留，下游 Filter 才能读取 latency / speed。
        const transformedRecords = await runOperatorChain(nodes, operators, {
            subName: subscription?.name,
            userAgent: options.userAgent,
            config: options.config,
            env: options.env,
            speedTestRunner: options.speedTestRunner,
            tcpConnect: options.tcpConnect,
            nodeMetadataByUrl: options.nodeMetadataByUrl,
            storage: options.storage,
            waitUntil: options.waitUntil,
            returnRecords: true
        });

        // 以 server:port 作为回退映射，兼容算子链中的排序 / 去重 / 过滤。
        const fallbackByAddress = new Map();
        for (const node of nodes) {
            if (!node?.url) continue;
            const info = parseNodeInfo(node.url) || {};
            const key = info?.server ? `${info.server}:${info.port ?? ''}` : null;
            if (key && !fallbackByAddress.has(key)) {
                fallbackByAddress.set(key, node);
            }
        }

        return transformedRecords.map((record, index) => {
            const info = parseNodeInfo(record?.url) || {};
            const addressKey = info?.server ? `${info.server}:${info.port ?? ''}` : null;
            const fallback = (addressKey && fallbackByAddress.get(addressKey))
                || nodes[index]
                || nodes[0]
                || {};
            // 合并而不是覆盖：record 携带算子链产生的最新 metadata，
            // fallback 保留订阅来源等外部字段。
            const metadata = {
                ...(fallback.metadata || {}),
                ...(info.metadata || {}),
                ...(record?.metadata || {})
            };
            return {
                ...fallback,
                ...info,
                ...(record || {}),
                url: record?.url || info.url || fallback.url,
                metadata,
                subscriptionName: fallback.subscriptionName || info.subscriptionName || subscription?.name || '未知'
            };
        });
    } catch (error) {
        console.warn('[Subscription] Failed to apply source operators:', error?.message || error);
        return nodes;
    }
}
