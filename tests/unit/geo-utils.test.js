import { describe, expect, it } from 'vitest';
import {
    REGION_EMOJI,
    REGION_KEYWORDS,
    containsRegion,
    extractNodeRegion,
    getRegionEmoji,
    getRegionKeywords,
    getSupportedRegions,
    parseNodeInfo
} from '../../functions/modules/utils/geo-utils.js';

describe('geo-utils region recognition', () => {
    it('recognizes the classic noisy node names', () => {
        expect(extractNodeRegion('新西兰+V2CROSS.COM')).toBe('新西兰');
        expect(getRegionEmoji('新西兰')).toBe('🇳🇿');

        expect(extractNodeRegion('🇨🇳|CN|@wxgqlfx|1')).toBe('中国');
        expect(getRegionEmoji('中国')).toBe('🇨🇳');

        expect(extractNodeRegion('英国+V2CROSS.COM')).toBe('英国');
        expect(getRegionEmoji('英国')).toBe('🇬🇧');

        expect(extractNodeRegion('美国+Amazon+EC2服务器')).toBe('美国');
        expect(getRegionEmoji('美国')).toBe('🇺🇸');
    });

    it('extracts regions from flags, delimiters and aliases', () => {
        expect(extractNodeRegion('🇳🇿_NZ_新西兰')).toBe('新西兰');
        expect(extractNodeRegion('[US] 美国节点')).toBe('美国');
        expect(extractNodeRegion('HK-01')).toBe('香港');
        expect(extractNodeRegion('Gcp SG')).toBe('新加坡');
        expect(extractNodeRegion('New Zealand')).toBe('新西兰');
        expect(extractNodeRegion('Chile')).toBe('智利');
        expect(extractNodeRegion('塞班')).toBe('北马里亚纳群岛');
    });

    it('prefers longer keywords over substring conflicts', () => {
        expect(extractNodeRegion('Romania Node')).toBe('罗马尼亚');
        expect(extractNodeRegion('Nigeria Node')).toBe('尼日利亚');
        expect(extractNodeRegion('South Sudan Node')).toBe('南苏丹');
        expect(extractNodeRegion('Papua New Guinea Node')).toBe('巴布亚新几内亚');
        expect(extractNodeRegion('多米尼加共和国')).toBe('多米尼加');
        expect(extractNodeRegion('多米尼克')).toBe('多米尼克');
        expect(extractNodeRegion('刚果（金）')).toBe('刚果（金）');
        expect(extractNodeRegion('刚果（布）')).toBe('刚果（布）');
    });

    it('does not mistake English words for country codes', () => {
        expect(extractNodeRegion('NO.1 Node')).toBe('其他');
        expect(extractNodeRegion('Fast and Stable')).toBe('其他');
        expect(extractNodeRegion('SS Node')).toBe('其他');
        expect(extractNodeRegion('VLESS-TLS')).toBe('其他');
        expect(extractNodeRegion('WS Node')).toBe('其他');
        expect(extractNodeRegion('V2CROSS.COM')).toBe('其他');
        expect(extractNodeRegion('example.io')).toBe('其他');
        expect(extractNodeRegion('')).toBe('其他');
        expect(extractNodeRegion(null)).toBe('其他');
        expect(getRegionEmoji('其他')).toBe('🌍');
    });

    it('covers every ISO 3166-1 alpha-2 code', () => {
        const isoCodes = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' ');

        const knownCodes = new Set();
        for (const keywords of Object.values(REGION_KEYWORDS)) {
            for (const keyword of keywords) {
                if (/^[A-Za-z]{2}$/.test(keyword)) knownCodes.add(keyword.toUpperCase());
            }
        }

        expect(isoCodes.filter(code => !knownCodes.has(code))).toEqual([]);

        for (const region of getSupportedRegions()) {
            expect(REGION_EMOJI[region], `${region} should have a flag`).toBeTruthy();
        }
    });

    it('keeps the public keyword helpers working', () => {
        expect(getRegionKeywords('新西兰')).toContain('NZ');
        expect(getRegionKeywords('新西兰')).toContain('New Zealand');
        expect(getRegionKeywords('不存在的地区')).toEqual([]);
        expect(containsRegion('🇳🇿_NZ_新西兰', '新西兰')).toBe(true);
        expect(containsRegion('🇳🇿_NZ_新西兰', '美国')).toBe(false);
    });

    it('keeps parseNodeInfo compatible and preserves the Taiwan display policy', () => {
        const info = parseNodeInfo('trojan://pass@example.com:443#%F0%9F%87%B9%F0%9F%87%BC%20%E5%8F%B0%E5%8C%97');

        expect(info.protocol).toBe('trojan');
        expect(info.server).toBe('example.com');
        expect(info.port).toBe('443');
        expect(info.region).toBe('台湾');
        expect(info.name).toContain('🇨🇳');
        expect(info.name).not.toContain('🇹🇼');
    });
});
