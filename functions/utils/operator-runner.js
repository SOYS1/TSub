/**
 * TSub Operator Runner
 * Implements Sub-Store like operators for node transformation.
 */

import * as NodeUtils from './node-transformer.js';
import { extractNodeRegion, getRegionEmoji } from '../modules/utils/geo-utils.js';
import { matchesDslCondition, renderDslTemplate } from './expression-dsl.js';
import { runSpeedTestOperator } from './speed-test.js';

/**
 * 辅助函数：将规则模式规范化为正则表达式数组
 */
function normalizeRules(rules) {
    if (!rules) return [];
    if (!Array.isArray(rules)) {
        if (typeof rules === 'string') return rules.split(/\r?\n/).filter(line => line.trim() !== '');
        return [];
    }
    
    let normalized = [];
    for (const rule of rules) {
        if (typeof rule === 'string') {
            // 支持在单个算子输入中通过 | 或 换行符 传递多个子规则
            const parts = rule.split(/\r?\n/).filter(p => p.trim() !== '');
            normalized.push(...parts);
        } else if (rule && rule.pattern) {
            normalized.push(rule);
        }
    }
    return normalized;
}

/**
 * 读取 Filter 的性能阈值。支持直接数字，也兼容 { enabled, value } 结构。
 * 返回 null 表示未启用该条件。
 */
function normalizeMetricLimit(value) {
    if (value && typeof value === 'object') {
        if (value.enabled === false) return null;
        value = value.value;
    }
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/**
 * 从节点 metadata 读取测速指标。未测速（字段缺失/非数字）返回 null，
 * 便于 Filter 将未测速节点视为不满足条件。
 */
function readSpeedMetric(record, key) {
    const value = record?.metadata?.[key];
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
}

/**
 * 按 URL 或 server:port 查找算子链外部注入的附加信息。
 * server:port 兜底是为了兼容上游对节点名称（URL fragment）做过改写的情况。
 */
function lookupExternalMetadata(metadataMap, record) {
    if (!metadataMap || typeof metadataMap.get !== 'function' || metadataMap.size === 0) return null;
    if (record?.url && metadataMap.has(record.url)) return metadataMap.get(record.url);
    const addressKey = record?.server ? `${record.server}:${record.port ?? ''}` : '';
    if (addressKey && metadataMap.has(addressKey)) return metadataMap.get(addressKey);
    return null;
}

/**
 * 将算子链输入统一规范化为 Records。
 *
 * 既支持 URL 字符串数组（历史调用方式），也支持已经带 metadata 的节点对象数组。
 * 传入对象时保留其 name / protocol / metadata 等字段，避免上游测速结果被重新
 * 解析 URL 时覆盖。
 */
function normalizeChainInput(input, metadataByUrl) {
    const items = Array.isArray(input) ? input : [];
    return items.map(item => {
        let record = null;

        if (typeof item === 'string') {
            record = NodeUtils.nodeUrlsToRecords([item], {
                needServerPort: true,
                ensureRegion: false
            })[0] || null;
        } else if (item && typeof item === 'object' && typeof item.url === 'string') {
            const base = NodeUtils.nodeUrlsToRecords([item.url], {
                needServerPort: true,
                ensureRegion: false
            })[0] || {};
            record = {
                ...base,
                ...item,
                originalName: item.originalName || base.originalName,
                server: item.server || base.server,
                port: item.port || base.port,
                // 关键：对象自带的 metadata（例如测速得到的 latency / speed）
                // 必须覆盖 URL 解析出的名称元数据，而不是被其替换。
                metadata: {
                    ...(base.metadata || {}),
                    ...(item.metadata || {})
                }
            };
        }

        if (!record) return null;

        const extra = lookupExternalMetadata(metadataByUrl, record);
        if (extra) {
            record = {
                ...record,
                ...extra,
                metadata: {
                    ...(record.metadata || {}),
                    ...(extra.metadata || {})
                }
            };
        }
        return record;
    }).filter(Boolean);
}

/**
 * Filter Operator
 */
function opFilter(nodes, params) {
    if (!params) return nodes;
    const { include, exclude, protocols, regions } = params;
    let result = [...nodes];

    if (include?.enabled) {
        const rules = normalizeRules(include.rules);
        if (rules.length > 0) {
            result = result.filter(r => {
                const enriched = NodeUtils.ensureRegionInfo(r, true); // 强制获取元数据
                const matchRaw = NodeUtils.matchesRegexRules(r.name, rules);
                const matchClean = r.metadata?.cleanName ? NodeUtils.matchesRegexRules(r.metadata.cleanName, rules) : false;
                const matchRegion = NodeUtils.matchesRegexRules(enriched.regionZh, rules) || 
                                    NodeUtils.matchesRegexRules(enriched.region, rules) ||
                                    NodeUtils.matchesRegexRules(enriched.regionCode, rules); // [新增] ISO 代码匹配
                
                return matchRaw || matchClean || matchRegion;
            });
        }
    }
    if (exclude?.enabled) {
        const rules = normalizeRules(exclude.rules);
        if (rules.length > 0) {
            result = result.filter(r => {
                const enriched = NodeUtils.ensureRegionInfo(r, true); // 强制获取元数据
                const matchRaw = NodeUtils.matchesRegexRules(r.name, rules);
                const matchClean = r.metadata?.cleanName ? NodeUtils.matchesRegexRules(r.metadata.cleanName, rules) : false;
                const matchRegion = NodeUtils.matchesRegexRules(enriched.regionZh, rules) || 
                                    NodeUtils.matchesRegexRules(enriched.region, rules) ||
                                    NodeUtils.matchesRegexRules(enriched.regionCode, rules); // [新增] ISO 代码匹配
                                    
                return !(matchRaw || matchClean || matchRegion);
            });
        }
    }
    if (protocols?.enabled && Array.isArray(protocols.values)) {
        const allowed = new Set(protocols.values.map(p => p.toLowerCase()));
        result = result.filter(r => allowed.has(r.protocol.toLowerCase()));
    }
    if (regions?.enabled && Array.isArray(regions.values)) {
        // Ensure region info is present
        result = result.map(r => NodeUtils.ensureRegionInfo(r, true));
        const allowed = new Set(regions.values);
        result = result.filter(r => allowed.has(r.regionZh) || allowed.has(r.region));
    }

    // Speed-test thresholds. Missing metrics are treated as "not satisfying
    // the condition" so untested nodes cannot slip through a latency/speed
    // filter by accident.
    const maxLatency = normalizeMetricLimit(params.maxLatency);
    const minSpeed = normalizeMetricLimit(params.minSpeed);

    if (maxLatency !== null || minSpeed !== null) {
        // 调试日志：帮助排查 metadata 是否成功从测速算子流入 Filter。
        console.log('[Operator][Filter] input:', result.length,
            'latency(sample):', result.slice(0, 3).map(r => r?.metadata?.latency),
            'maxLatency:', maxLatency, 'minSpeed:', minSpeed);
    }

    if (maxLatency !== null) {
        result = result.filter(r => {
            const latency = readSpeedMetric(r, 'latency');
            return latency !== null && latency >= 0 && latency <= maxLatency;
        });
    }

    if (minSpeed !== null) {
        result = result.filter(r => {
            const speed = readSpeedMetric(r, 'speed');
            return speed !== null && speed >= minSpeed;
        });
    }

    return result;
}

/**
 * Rename Operator
 */
function opRename(nodes, params) {
    if (!params) return nodes;
    const { regex, template } = params;
    let result = [...nodes];

    if (regex?.enabled) {
        const rules = normalizeRules(regex.rules);
        if (rules.length > 0) {
            result = result.map(r => {
                const enriched = NodeUtils.ensureRegionInfo(r, true);
                const vars = {
                    name: r.name,
                    protocol: r.protocol,
                    region: enriched.region,
                    regionZh: enriched.regionZh,
                    emoji: enriched.emoji,
                    server: r.server,
                    port: r.port
                };

                // 核心增强：允许在正则替换中使用 {regionZh} 等变量
                const processedRules = rules.map(rule => {
                    if (typeof rule === 'object' && rule.replacement && rule.replacement.includes('{')) {
                        return { ...rule, replacement: NodeUtils.renderTemplate(rule.replacement, vars, r) };
                    }
                    return rule;
                });

                const newName = NodeUtils.applyRegexRename(r.name, processedRules);
                if (newName !== r.name) {
                    return {
                        ...r,
                        name: newName,
                        url: NodeUtils.setNodeName(r.url, r.protocol, newName)
                    };
                }
                return r;
            });
        }
    }

    if (template?.enabled && template.template) {
        const counters = new Map();
        const scope = template.indexScope || template.scope || 'region'; // 默认按地区分组计数，符合用户直觉

        result = result.map((r, index) => {
            const enriched = NodeUtils.ensureRegionInfo(r, true);
            
            // 确定索引分组键
            let groupKey = 'global';
            if (scope === 'region') groupKey = `r:${enriched.regionZh || 'Other'}`;
            else if (scope === 'protocol') groupKey = `p:${r.protocol}`;
            else if (scope === 'regionProtocol') groupKey = `rp:${enriched.regionZh || 'Other'}|${r.protocol}`;
            
            const groupIndex = (counters.get(groupKey) || 0) + 1;
            counters.set(groupKey, groupIndex);

            const vars = {
                name: r.name,
                protocol: r.protocol,
                region: enriched.region,
                regionZh: enriched.regionZh,
                emoji: enriched.emoji,
                server: r.server,
                port: r.port,
                index: groupIndex + (Number(template.offset || template.indexStart) || 1) - 1,
                globalIndex: index + (Number(template.offset || template.indexStart) || 1)
            };
            const newName = NodeUtils.renderTemplate(template.template, vars, r);
            
            if (newName !== r.name) {
                return {
                    ...r,
                    name: newName,
                    url: NodeUtils.setNodeName(r.url, r.protocol, newName)
                };
            }
            return r;
        });
    }

    return result;
}

/**
 * Script Operator (The heart of Sub-Store)
 */
async function opScript(nodes, params = {}, context) {
    const dsl = Array.isArray(params.dsl)
        ? params.dsl
        : (params.action ? [params] : []);

    if (!dsl.length) {
        if (params.code || params.url) {
            console.warn('[Operator] Legacy script code is disabled; use params.dsl instead.');
        }
        return nodes;
    }

    let result = nodes.map(r => NodeUtils.ensureRegionInfo(r, true));

    for (const step of dsl) {
        const action = String(step?.action || '').toLowerCase();
        if (action === 'filter') {
            result = result.filter((node, index) => matchesDslCondition({ ...node, index: index + 1 }, step));
            continue;
        }
        if (action === 'rename') {
            const template = step.template || step.expression;
            if (!template) continue;
            result = result.map((node, index) => {
                const nextName = renderDslTemplate(template, { ...node, index: index + 1, target: context?.target || '' }) || node.name;
                if (nextName === node.name) return node;
                return {
                    ...node,
                    name: nextName,
                    url: NodeUtils.setNodeName(node.url, node.protocol, nextName),
                    metadata: node.metadata ? { ...node.metadata, cleanName: nextName } : node.metadata
                };
            });
        }
    }

    return result;
}

/**
 * Main Entry Point for Operator Chain
 */
export async function runOperatorChain(nodeUrls, operators, context = {}) {
    const metadataByUrl = context.nodeMetadataByUrl instanceof Map
        ? context.nodeMetadataByUrl
        : new Map(Object.entries(context.nodeMetadataByUrl || {}));

    if (!Array.isArray(operators) || operators.length === 0) {
        return context.returnRecords === true
            ? normalizeChainInput(nodeUrls, metadataByUrl)
            : nodeUrls;
    }

    // 1. Convert input (URLs or Records) to Records without losing metadata
    let records = normalizeChainInput(nodeUrls, metadataByUrl);

    const ua = (context.userAgent || '').toLowerCase();
    const platform = {
        isClash: /clash|mihomo|stash|meta|verge/i.test(ua),
        isSurge: /surge/i.test(ua),
        isQuanX: /quantumult/i.test(ua),
        isLoon: /loon/i.test(ua),
        isShadowrocket: /shadowrocket/i.test(ua),
        isSingBox: /sing-box|singbox/i.test(ua),
        userAgent: context.userAgent,
        target: context.target || 'base64'
    };

    const enrichedContext = { ...context, ...platform };

    // 2. Run Operators sequentially
    for (const op of operators) {
        const { type, params, enabled } = op;
        if (enabled === false) continue;

        switch (type) {
            case 'filter':
                records = opFilter(records, params);
                break;
            case 'rename':
                records = opRename(records, params);
                break;
            case 'script':
                records = await opScript(records, params, enrichedContext);
                break;
            case 'speedtest':
            case 'speed-test':
                records = await runSpeedTestOperator(records, params, enrichedContext);
                break;
            case 'sort':
                if (params && Array.isArray(params.keys)) {
                    const needsRegion = params.keys.some(k => k.key === 'region' || k.key === 'regionZh');
                    if (needsRegion) {
                        records = records.map(r => NodeUtils.ensureRegionInfo(r, true));
                    }
                    records.sort(NodeUtils.makeComparator({ keys: params.keys }));
                }
                break;
            case 'dedup':
                const includeProtocol = params?.includeProtocol !== false;
                const seenNodes = new Map();
                for (const r of records) {
                    const hostPort = `${r.server}:${r.port}`;
                    const key = includeProtocol ? `${r.protocol}|${hostPort}` : hostPort;
                    if (!seenNodes.has(key)) {
                        seenNodes.set(key, r);
                    } else {
                        const existing = seenNodes.get(key);
                        if ((r.name || '').length > (existing.name || '').length) {
                            seenNodes.set(key, r);
                        }
                    }
                }
                records = Array.from(seenNodes.values());
                break;
        }
    }

    // 3. Convert Records back to URLs
    // `returnRecords` lets callers that need the freshly measured metadata
    // (for example a preview table) consume the enriched records directly.
    const syncedRecords = records.map(record => (
        record.name && record.name !== record.originalName
            ? { ...record, url: NodeUtils.setNodeName(record.url, record.protocol, record.name) }
            : record
    ));
    if (typeof context.onRecords === 'function') context.onRecords(syncedRecords);
    if (context.returnRecords === true) return syncedRecords;
    return syncedRecords.map(record => record.url);
}
