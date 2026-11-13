/**
 * 地理识别工具模块
 * 提供节点地区识别和相关功能
 */

/**
 * 地区关键词映射表
 * 支持多语言地区识别
 */
export const REGION_KEYWORDS = {
    '香港': ['HK', 'HKG', '香港', 'Hong Kong', 'HongKong'],
    '台湾': ['TW', 'TPE', '台湾', '台北', 'Taiwan', 'Taipei'],
    '新加坡': ['SG', 'SIN', '新加坡', 'Singapore'],
    '日本': ['JP', 'JPN', 'NRT', 'HND', 'KIX', 'FUK', '东京', '大阪', '日本', 'Japan', 'Tokyo', 'Osaka', 'Fukuoka', 'Yokohama'],
    '美国': ['US', 'USA', 'LAX', 'SFO', 'SEA', 'JFK', 'NYC', 'ORD', 'DFW', 'IAD', '美国', 'United States', 'America', 'Los Angeles', 'New York', 'San Francisco', 'Seattle', 'Chicago', '洛杉矶', '纽约', '旧金山', '西雅图', '芝加哥'],
    '韩国': ['KR', 'KOR', 'ICN', '韩国', '首尔', 'Korea', 'Seoul'],
    '英国': ['UK', 'GB', 'LHR', 'LGW', 'LON', '英国', 'Britain', 'London', 'Manchester', '伦敦', '曼彻斯特'],
    '德国': ['DE', 'DEU', 'FRA', 'MUC', '德国', 'Germany', 'Frankfurt', 'Berlin', 'Munich', '法兰克福', '柏林', '慕尼黑'],
    '法国': ['FR', 'CDG', 'ORY', '法国', 'France', 'Paris', 'Lyon', 'Marseille', '巴黎', '里昂', '马赛'],
    '加拿大': ['CA', 'CAN', 'YVR', 'YYZ', '加拿大', 'Canada', 'Toronto', 'Vancouver', 'Montreal', '多伦多', '温哥华', '蒙特利尔'],
    '澳大利亚': ['AU', 'AUS', 'SYD', 'MEL', 'BNE', 'PER', '澳大利亚', 'Australia', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', '悉尼', '墨尔本', '布里斯班', '珀斯'],
    '荷兰': ['NL', 'NLD', 'AMS', '荷兰', 'Netherlands', 'Amsterdam', 'Rotterdam', '阿姆斯特丹', '鹿特丹'],
    '俄罗斯': ['RU', 'RUS', 'SVO', 'DME', '俄罗斯', 'Russia', 'Moscow', 'Saint Petersburg', '莫斯科', '圣彼得堡'],
    '印度': ['IN', 'IND', 'BOM', 'DEL', 'BLR', '印度', 'India', 'Mumbai', 'Delhi', 'Bangalore', '孟买', '德里', '班加罗尔'],
    '土耳其': ['TR', 'TUR', 'IST', '土耳其', 'Turkey', 'Istanbul', 'Ankara', '伊斯坦布尔', '安卡拉'],
    '孟加拉': ['BD', 'BGD', 'DAC', '孟加拉', '孟加拉国', 'Bangladesh', 'Dhaka', '达卡'],
    '巴基斯坦': ['PK', 'PAK', 'ISB', 'LHE', '巴基斯坦', 'Pakistan', 'Islamabad', 'Lahore', '伊斯兰堡', '拉合尔'],
    '马来西亚': ['MY', 'MYS', 'KUL', '马来西亚', 'Malaysia', 'Kuala Lumpur', '吉隆坡'],
    '泰国': ['TH', 'THA', 'BKK', 'HKT', '泰国', 'Thailand', 'Bangkok', 'Phuket', 'Pattaya', '曼谷', '普吉', '芭提雅'],
    '越南': ['VN', 'VNM', 'SGN', 'HAN', '越南', 'Vietnam', 'Ho Chi Minh City', 'Hanoi', '胡志明市', '河内'],
    '菲律宾': ['PH', 'PHL', 'MNL', 'CEB', '菲律宾', 'Philippines', 'Manila', 'Cebu', '马尼拉', '宿务'],
    '印尼': ['ID', 'IDN', 'CGK', '印尼', '印度尼西亚', 'Indonesia', 'Jakarta', 'Surabaya', 'Bandung', '雅加达', '泗水', '万隆'],
    '文莱': ['BN', 'BRN', 'BWN', '文莱', 'Brunei', 'Bandar Seri Begawan', '斯里巴加湾市'],
    '柬埔寨': ['KH', 'KHM', 'PNH', '柬埔寨', 'Cambodia', 'Phnom Penh', '金边'],
    '老挝': ['LA', 'LAO', 'VTE', '老挝', 'Laos', 'Vientiane', '万象'],
    '缅甸': ['MM', 'MMR', 'RGN', '缅甸', 'Myanmar', 'Burma', 'Yangon', 'Rangoon', '仰光'],
    '瑞士': ['CH', 'CHE', 'ZRH', 'GVA', '瑞士', 'Switzerland', 'Zurich', 'Geneva', '苏黎世', '日内瓦'],
    '意大利': ['IT', 'ITA', 'FCO', 'MXP', '意大利', 'Italy', 'Rome', 'Milan', 'Naples', '罗马', '米兰', '那不勒斯'],
    '西班牙': ['ES', 'ESP', 'MAD', 'BCN', '西班牙', 'Spain', 'Madrid', 'Barcelona', '马德里', '巴塞罗那'],
    '巴西': ['BR', 'BRA', 'GRU', 'GIG', '巴西', 'Brazil', 'São Paulo', 'Rio de Janeiro', '圣保罗', '里约'],
    '阿根廷': ['AR', 'ARG', 'EZE', '阿根廷', 'Argentina', 'Buenos Aires', '布宜诺斯艾利斯'],
    '墨西哥': ['MX', 'MEX', '墨西哥', 'Mexico', 'Mexico City', '墨西哥城'],
    '哥伦比亚': ['CO', 'COL', 'BOG', '哥伦比亚', 'Colombia', 'Bogota', 'Bogotá', '波哥大'],
    '秘鲁': ['PE', 'PER', 'LIM', '秘鲁', 'Peru', 'Lima', '利马'],
    '南非': ['ZA', 'ZAF', 'JNB', 'CPT', '南非', 'South Africa', 'Johannesburg', 'Cape Town', '约翰内斯堡', '开普敦'],
    '埃及': ['EG', 'EGY', 'CAI', '埃及', 'Egypt', 'Cairo', '开罗'],
    '以色列': ['IL', 'ISR', 'TLV', '以色列', 'Israel', 'Tel Aviv', 'Jerusalem', '特拉维夫', '耶路撒冷'],
    '阿联酋': ['AE', 'ARE', 'DXB', 'AUH', '阿联酋', 'UAE', 'Dubai', 'Abu Dhabi', 'Sharjah', '迪拜', '阿布扎比', '沙迦'],
    '阿曼': ['OM', 'OMN', 'MCT', '阿曼', 'Oman', 'Muscat', '马斯喀特'],
    '沙特': ['SA', 'SAU', 'RUH', 'JED', '沙特', 'Saudi Arabia', 'Riyadh', 'Jeddah', '利雅得', '吉达'],
    '波兰': ['PL', 'POL', 'WAW', '波兰', 'Poland', 'Warsaw', 'Krakow', '华沙', '克拉科夫'],
    '捷克': ['CZ', 'CZE', 'PRG', '捷克', 'Czech Republic', 'Prague', '布拉格'],
    '匈牙利': ['HU', 'HUN', 'BUD', '匈牙利', 'Hungary', 'Budapest', '布达佩斯'],
    '罗马尼亚': ['RO', 'ROU', 'OTP', '罗马尼亚', 'Romania', 'Bucharest', '布加勒斯特'],
    '保加利亚': ['BG', 'BGR', 'SOF', '保加利亚', 'Bulgaria', 'Sofia', '索非亚'],
    '希腊': ['GR', 'GRC', 'ATH', '希腊', 'Greece', 'Athens', 'Thessaloniki', '雅典', '塞萨洛尼基'],
    '葡萄牙': ['PT', 'PRT', 'LIS', '葡萄牙', 'Portugal', 'Lisbon', 'Porto', '里斯本', '波尔图'],
    '瑞典': ['SE', 'SWE', 'ARN', '瑞典', 'Sweden', 'Stockholm', 'Gothenburg', '斯德哥尔摩', '哥德堡'],
    '挪威': ['NO', 'NOR', 'OSL', '挪威', 'Norway', 'Oslo', 'Bergen', '奥斯陆', '卑尔根'],
    '丹麦': ['DK', 'DNK', 'CPH', '丹麦', 'Denmark', 'Copenhagen', 'Aarhus', '哥本哈根', '奥胡斯'],
    '芬兰': ['FI', 'FIN', 'HEL', '芬兰', 'Finland', 'Helsinki', '赫尔辛基'],
    '奥地利': ['AT', 'AUT', 'VIE', '奥地利', 'Austria', 'Vienna', 'Salzburg', '维也纳', '萨尔茨堡'],
    '爱尔兰': ['IE', 'IRL', 'DUB', '爱尔兰', 'Ireland', 'Dublin', '都柏林'],
    '冰岛': ['IS', 'ISL', 'KEF', '冰岛', 'Iceland', 'Reykjavik', '雷克雅未克'],
    '卢森堡': ['LU', 'LUX', '卢森堡', 'Luxembourg', 'Luxembourg City', '卢森堡市'],
    '马耳他': ['MT', 'MLT', 'MLA', '马耳他', 'Malta', 'Valletta', '瓦莱塔'],
    '斯洛伐克': ['SK', 'SVK', 'BTS', '斯洛伐克', 'Slovakia', 'Bratislava', '布拉迪斯拉发'],
    '斯洛文尼亚': ['SI', 'SVN', 'LJU', '斯洛文尼亚', 'Slovenia', 'Ljubljana', '卢布尔雅那'],
    '克罗地亚': ['HR', 'HRV', 'ZAG', '克罗地亚', 'Croatia', 'Zagreb', '萨格勒布'],
    '拉脱维亚': ['LV', 'LVA', 'RIX', '拉脱维亚', 'Latvia', 'Riga', '里加'],
    '立陶宛': ['LT', 'LTU', 'VNO', '立陶宛', 'Lithuania', 'Vilnius', '维尔纽斯'],
    '爱沙尼亚': ['EE', 'EST', 'TLL', '爱沙尼亚', 'Estonia', 'Tallinn', '塔林'],
    '塞浦路斯': ['CY', 'CYP', 'LCA', '塞浦路斯', 'Cyprus', 'Nicosia', '尼科西亚'],
    '列支敦士登': ['LI', 'LIE', '列支敦士登', 'Liechtenstein', 'Vaduz', '瓦杜兹'],
    '阿尔巴尼亚': ['AL', 'ALB', 'TIA', '阿尔巴尼亚', 'Albania', 'Tirana', '地拉那'],
    '安道尔': ['AD', 'AND', '安道尔', 'Andorra', 'Andorra la Vella', '安道尔城'],
    '白俄罗斯': ['BY', 'BLR', 'MSQ', '白俄罗斯', 'Belarus', 'Minsk', '明斯克'],
    '波黑': ['BA', 'BIH', 'SJJ', '波黑', '波斯尼亚', 'Bosnia', 'Bosnia and Herzegovina', 'Sarajevo', '萨拉热窝'],
    '摩尔多瓦': ['MD', 'MDA', 'KIV', '摩尔多瓦', 'Moldova', 'Chisinau', 'Chișinău', '基希讷乌'],
    '摩纳哥': ['MC', 'MCO', '摩纳哥', 'Monaco', 'Monte Carlo', '蒙特卡洛'],
    '黑山': ['ME', 'MNE', 'TGD', '黑山', 'Montenegro', 'Podgorica', '波德戈里察'],
    '北马其顿': ['MK', 'MKD', 'SKP', '北马其顿', 'North Macedonia', 'Macedonia', 'Skopje', '斯科普里'],
    '塞尔维亚': ['RS', 'SRB', 'BEG', '塞尔维亚', 'Serbia', 'Belgrade', '贝尔格莱德'],
    '乌克兰': ['UA', 'UKR', 'KBP', '乌克兰', 'Ukraine', 'Kyiv', 'Kiev', '基辅'],
    '科索沃': ['XK', 'XKS', 'PRN', '科索沃', 'Kosovo', 'Pristina', '普里什蒂纳'],
    '圣马力诺': ['SM', 'SMR', '圣马力诺', 'San Marino'],
    '梵蒂冈': ['VA', 'VAT', '梵蒂冈', 'Vatican', 'Vatican City', '梵蒂冈城'],
    '格鲁吉亚': ['GE', 'GEO', 'TBS', '格鲁吉亚', 'Georgia', 'Tbilisi', '第比利斯'],
    '亚美尼亚': ['AM', 'ARM', 'EVN', '亚美尼亚', 'Armenia', 'Yerevan', '埃里温'],
    '阿塞拜疆': ['AZ', 'AZE', 'GYD', '阿塞拜疆', 'Azerbaijan', 'Baku', '巴库'],
    '比利时': ['BE', 'BEL', 'BRU', '比利时', 'Belgium', 'Brussels', '安特卫普', '布鲁塞尔', 'Antwerp']
};

/**
 * [新增] 地区 Emoji 映射表
 */
export const REGION_EMOJI = {
    '香港': '🇭🇰',
    '台湾': '🇨🇳',
    '新加坡': '🇸🇬',
    '日本': '🇯🇵',
    '美国': '🇺🇸',
    '韩国': '🇰🇷',
    '英国': '🇬🇧',
    '德国': '🇩🇪',
    '法国': '🇫🇷',
    '加拿大': '🇨🇦',
    '澳大利亚': '🇦🇺',
    '荷兰': '🇳🇱',
    '俄罗斯': '🇷🇺',
    '印度': '🇮🇳',
    '土耳其': '🇹🇷',
    '孟加拉': '🇧🇩',
    '巴基斯坦': '🇵🇰',
    '马来西亚': '🇲🇾',
    '泰国': '🇹🇭',
    '越南': '🇻🇳',
    '菲律宾': '🇵🇭',
    '印尼': '🇮🇩',
    '文莱': '🇧🇳',
    '柬埔寨': '🇰🇭',
    '老挝': '🇱🇦',
    '缅甸': '🇲🇲',
    '瑞士': '🇨🇭',
    '意大利': '🇮🇹',
    '西班牙': '🇪🇸',
    '巴西': '🇧🇷',
    '阿根廷': '🇦🇷',
    '墨西哥': '🇲🇽',
    '哥伦比亚': '🇨🇴',
    '秘鲁': '🇵🇪',
    '南非': '🇿🇦',
    '埃及': '🇪🇬',
    '以色列': '🇮🇱',
    '阿联酋': '🇦🇪',
    '阿曼': '🇴🇲',
    '沙特': '🇸🇦',
    '波兰': '🇵🇱',
    '捷克': '🇨🇿',
    '匈牙利': '🇭🇺',
    '罗马尼亚': '🇷🇴',
    '希腊': '🇬🇷',
    '葡萄牙': '🇵🇹',
    '瑞典': '🇸🇪',
    '挪威': '🇳🇴',
    '丹麦': '🇩🇰',
    '芬兰': '🇫🇮',
    '奥地利': '🇦🇹',
    '爱尔兰': '🇮🇪',
    '冰岛': '🇮🇸',
    '卢森堡': '🇱🇺',
    '马耳他': '🇲🇹',
    '斯洛伐克': '🇸🇰',
    '斯洛文尼亚': '🇸🇮',
    '克罗地亚': '🇭🇷',
    '拉脱维亚': '🇱🇻',
    '立陶宛': '🇱🇹',
    '爱沙尼亚': '🇪🇪',
    '塞浦路斯': '🇨🇾',
    '列支敦士登': '🇱🇮',
    '阿尔巴尼亚': '🇦🇱',
    '安道尔': '🇦🇩',
    '白俄罗斯': '🇧🇾',
    '波黑': '🇧🇦',
    '摩尔多瓦': '🇲🇩',
    '摩纳哥': '🇲🇨',
    '黑山': '🇲🇪',
    '北马其顿': '🇲🇰',
    '塞尔维亚': '🇷🇸',
    '乌克兰': '🇺🇦',
    '科索沃': '🇽🇰',
    '圣马力诺': '🇸🇲',
    '梵蒂冈': '🇻🇦',
    '格鲁吉亚': '🇬🇪',
    '亚美尼亚': '🇦🇲',
    '阿塞拜疆': '🇦🇿',
    '比利时': '🇧🇪',
    '其他': '🌍'
};

/**
 * 根据 ISO 3166-1 alpha-2 代码生成国旗 Emoji
 * @param {string} code
 * @returns {string}
 */
function codeToFlag(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) return '🌍';
    return String.fromCodePoint(...[...normalized].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

/**
 * 补全地区定义
 * 元组格式: [ISO 双字母代码, 中文名, 英文名, 其他别名(使用 | 分隔)]
 * 已存在于 REGION_KEYWORDS 中的地区会合并别名，并补齐缺失的 Emoji。
 */
const ADDITIONAL_REGION_DEFINITIONS = [
    // ---------- 东亚 ----------
    ['CN', '中国', 'China', '中國|中国大陆|中國大陸|中国大陆地区|中国内地|PRC|Mainland China|北京|上海|广州|深圳|成都|杭州|武汉|西安|重庆|天津|南京|长沙|厦门|青岛|昆明|大连|哈尔滨|沈阳|三亚|海口|乌鲁木齐|PEK|PKX|PVG|SHA|SZX|CTU|TFU|HGH|WUH|XIY|CKG|TSN|NKG|CSX|XMN|TAO|KMG|DLC|HRB|SHE|TNA|NNG|LHW|TYN|HET|LXA|ZUH|SWA|WUX|NGB|WNZ|YNT|KWL|SYX|HAK|URC'],
    ['HK', '香港', 'Hong Kong', 'HKG|中国香港|中國香港|九龙|九龍|新界|Kowloon|HongKong'],
    ['TW', '台湾', 'Taiwan', 'TWN|TPE|TSA|KHH|RMQ|台灣|臺灣|中国台湾|中國台灣|台北|臺北|桃园|桃園|台中|台南|高雄|Taipei|Taoyuan|Kaohsiung|Taichung|Tainan'],
    ['MO', '澳门', 'Macao', 'MFM|澳门|中國澳門|中国澳门|Macau|氹仔|路氹'],
    ['KP', '朝鲜', 'North Korea', 'PRK|朝鲜|北韩|北韓|平壤|DPRK|Pyongyang|Choson'],
    ['MN', '蒙古', 'Mongolia', 'MNG|ULN|UBN|蒙古国|蒙古國|乌兰巴托|烏蘭巴托|Ulaanbaatar'],

    // ---------- 东南亚 ----------
    ['TL', '东帝汶', 'Timor-Leste', 'TLS|DIL|东帝汶|東帝汶|帝力|Dili|East Timor'],

    // ---------- 南亚 ----------
    ['LK', '斯里兰卡', 'Sri Lanka', 'LKA|CMB|斯里兰卡|斯里蘭卡|科伦坡|可倫坡|Colombo'],
    ['NP', '尼泊尔', 'Nepal', 'NPL|KTM|尼泊尔|尼泊爾|加德满都|加德滿都|Kathmandu'],
    ['BT', '不丹', 'Bhutan', 'BTN|PBH|不丹|廷布|Thimphu|Paro'],
    ['MV', '马尔代夫', 'Maldives', 'MDV|MLE|马尔代夫|馬爾地夫|马累|馬列|Male'],
    ['AF', '阿富汗', 'Afghanistan', 'AFG|KBL|阿富汗|喀布尔|喀布爾|Kabul'],

    // ---------- 中亚 ----------
    ['KZ', '哈萨克斯坦', 'Kazakhstan', 'KAZ|ALA|NQZ|TSE|哈萨克|哈薩克|阿拉木图|阿拉木圖|阿斯塔纳|阿斯塔納|Almaty|Astana'],
    ['UZ', '乌兹别克斯坦', 'Uzbekistan', 'UZB|TAS|乌兹别克|烏茲別克|塔什干|Tashkent|Samarkand'],
    ['TM', '土库曼斯坦', 'Turkmenistan', 'TKM|ASB|土库曼|土庫曼|阿什哈巴德|Ashgabat'],
    ['TJ', '塔吉克斯坦', 'Tajikistan', 'TJK|DYU|塔吉克|杜尚别|杜尚別|Dushanbe'],
    ['KG', '吉尔吉斯斯坦', 'Kyrgyzstan', 'KGZ|FRU|吉尔吉斯|吉爾吉斯|比什凯克|比什凱克|Bishkek'],

    // ---------- 中东 ----------
    ['QA', '卡塔尔', 'Qatar', 'QAT|DOH|卡塔尔|卡達|多哈|Doha'],
    ['KW', '科威特', 'Kuwait', 'KWT|KWI|科威特|科威特城|Kuwait City'],
    ['BH', '巴林', 'Bahrain', 'BHR|BAH|巴林|麦纳麦|麥納麥|Manama'],
    ['YE', '也门', 'Yemen', 'YEM|ADE|SAH|也门|葉門|萨那|薩那|亚丁|亞丁|Sanaa|Aden'],
    ['IQ', '伊拉克', 'Iraq', 'IRQ|BGW|ERB|伊拉克|巴格达|巴格達|Baghdad|Erbil'],
    ['IR', '伊朗', 'Iran', 'IRN|IKA|THR|伊朗|德黑兰|德黑蘭|Tehran|Isfahan'],
    ['JO', '约旦', 'Jordan', 'JOR|AMM|约旦|約旦|安曼|Amman'],
    ['LB', '黎巴嫩', 'Lebanon', 'LBN|BEY|黎巴嫩|贝鲁特|貝魯特|Beirut'],
    ['SY', '叙利亚', 'Syria', 'SYR|DAM|叙利亚|敘利亞|大马士革|大馬士革|Damascus'],

    // ---------- 欧洲（补全别名 / 修正缺失 Emoji） ----------
    ['BG', '保加利亚', 'Bulgaria', 'BGR|SOF|VAR|保加利亞|索非亚|索菲亞|Sofia|Varna'],
    ['DE', '德国', 'Germany', 'DEU|FRA|MUC|BER|DUS|HAM|德國|德意志|法兰克福|法蘭克福|慕尼黑|柏林|Frankfurt|Munich|Berlin'],
    ['FR', '法国', 'France', 'CDG|ORY|LYS|MRS|NCE|法國|法兰西|法蘭西|巴黎|里昂|马赛|馬賽|Paris|Lyon|Marseille'],
    ['GB', '英国', 'United Kingdom', 'GBR|UK|LHR|LGW|MAN|EDI|英國|大英|不列颠|不列顛|英格兰|英格蘭|苏格兰|蘇格蘭|威尔士|威爾斯|伦敦|倫敦|曼彻斯特|曼徹斯特|Britain|England|Scotland|Wales|London|Manchester'],
    ['US', '美国', 'United States', 'USA|America|U.S.|LA|美利堅|美國|洛杉矶|洛杉磯|纽约|紐約|旧金山|舊金山|西雅图|西雅圖|芝加哥|华盛顿|華盛頓|迈阿密|邁阿密|Las Vegas|Silicon Valley'],
    ['RU', '俄罗斯', 'Russia', 'RUS|SVO|DME|LED|俄羅斯|俄国|俄國|莫斯科|圣彼得堡|聖彼得堡|Moscow|Saint Petersburg'],
    ['IT', '意大利', 'Italy', 'ITA|FCO|MXP|VCE|義大利|罗马|羅馬|米兰|米蘭|Rome|Milan|Venice'],
    ['ES', '西班牙', 'Spain', 'ESP|MAD|BCN|马德里|馬德里|巴塞罗那|巴塞隆納|Madrid|Barcelona'],
    ['NL', '荷兰', 'Netherlands', 'NLD|AMS|RTM|荷蘭|阿姆斯特丹|鹿特丹|Amsterdam|Rotterdam|Holland'],
    ['CH', '瑞士', 'Switzerland', 'CHE|ZRH|GVA|苏黎世|蘇黎世|日内瓦|日內瓦|Zurich|Geneva'],
    ['SE', '瑞典', 'Sweden', 'SWE|ARN|斯德哥尔摩|斯德哥爾摩|Stockholm'],
    ['NO', '挪威', 'Norway', 'NOR|OSL|奥斯陆|奧斯陸|Oslo'],
    ['DK', '丹麦', 'Denmark', 'DNK|CPH|哥本哈根|Copenhagen'],
    ['FI', '芬兰', 'Finland', 'FIN|HEL|赫尔辛基|赫爾辛基|Helsinki'],
    ['PL', '波兰', 'Poland', 'POL|WAW|KRK|波蘭|华沙|華沙|Warsaw|Krakow'],
    ['CZ', '捷克', 'Czechia', 'CZE|PRG|布拉格|Prague|Czech Republic'],
    ['AT', '奥地利', 'Austria', 'AUT|VIE|奧地利|维也纳|維也納|Vienna'],
    ['GR', '希腊', 'Greece', 'GRC|ATH|希臘|雅典|Athens'],
    ['PT', '葡萄牙', 'Portugal', 'PRT|LIS|里斯本|Lisbon'],
    ['TR', '土耳其', 'Turkey', 'TUR|IST|伊斯坦布尔|伊斯坦堡|Istanbul|Türkiye'],
    ['AE', '阿联酋', 'United Arab Emirates', 'ARE|UAE|DXB|AUH|阿聯酋|迪拜|杜拜|阿布扎比|阿布達比|Dubai|Abu Dhabi'],
    ['SA', '沙特', 'Saudi Arabia', 'SAU|RUH|JED|沙烏地|利雅得|吉达|吉達|Riyadh|Jeddah'],
    ['IL', '以色列', 'Israel', 'ISR|TLV|特拉维夫|特拉維夫|Tel Aviv'],
    ['IN', '印度', 'India', 'IND|BOM|DEL|BLR|孟买|孟買|德里|班加罗尔|班加羅爾|Mumbai|Delhi|Bangalore'],
    ['JP', '日本', 'Japan', 'JPN|NRT|HND|KIX|东京|東京|大阪|Tokyo|Osaka'],
    ['KR', '韩国', 'South Korea', 'KOR|ICN|韓國|南韩|南韓|首尔|首爾|Seoul|Korea'],
    ['SG', '新加坡', 'Singapore', 'SGP|SIN|狮城|獅城|星加坡|樟宜|Changi'],
    ['MY', '马来西亚', 'Malaysia', 'MYS|KUL|馬來西亞|吉隆坡|Kuala Lumpur'],
    ['TH', '泰国', 'Thailand', 'THA|BKK|泰國|曼谷|Bangkok'],
    ['VN', '越南', 'Vietnam', 'VNM|SGN|HAN|胡志明|河内|河內|Ho Chi Minh|Hanoi'],
    ['PH', '菲律宾', 'Philippines', 'PHL|MNL|CEB|菲律賓|马尼拉|馬尼拉|Manila|Cebu'],
    ['ID', '印尼', 'Indonesia', 'IDN|CGK|DPS|印度尼西亚|印度尼西亞|雅加达|雅加達|巴厘岛|峇里島|Jakarta|Bali'],
    ['BR', '巴西', 'Brazil', 'BRA|GRU|GIG|圣保罗|聖保羅|里约|里約|Sao Paulo|Rio de Janeiro'],
    ['MX', '墨西哥', 'Mexico', 'MEX|CUN|墨西哥城|坎昆|Mexico City|Cancun'],
    ['CA', '加拿大', 'Canada', 'CAN|YVR|YYZ|YUL|多伦多|多倫多|温哥华|溫哥華|Toronto|Vancouver'],
    ['AU', '澳大利亚', 'Australia', 'AUS|SYD|MEL|BNE|PER|澳洲|悉尼|雪梨|墨尔本|墨爾本|Sydney|Melbourne'],
    ['ZA', '南非', 'South Africa', 'ZAF|JNB|CPT|约翰内斯堡|約翰尼斯堡|开普敦|開普敦|Johannesburg|Cape Town'],
    ['EG', '埃及', 'Egypt', 'EGY|CAI|开罗|開羅|Cairo'],

    // ---------- 美洲 ----------
    ['GT', '危地马拉', 'Guatemala', 'GTM|GUA|瓜地馬拉|危地馬拉|Guatemala City'],
    ['BZ', '伯利兹', 'Belize', 'BLZ|BZE|貝里斯|伯利茲|Belize City'],
    ['SV', '萨尔瓦多', 'El Salvador', 'SLV|SAL|薩爾瓦多|圣萨尔瓦多|聖薩爾瓦多|San Salvador'],
    ['HN', '洪都拉斯', 'Honduras', 'TGU|SAP|德古西加巴|特古西加尔巴|Tegucigalpa'],
    ['NI', '尼加拉瓜', 'Nicaragua', 'NIC|MGA|馬拿瓜|马那瓜|Managua'],
    ['CR', '哥斯达黎加', 'Costa Rica', 'CRI|SJO|哥斯大黎加|圣何塞|聖荷西|San Jose'],
    ['PA', '巴拿马', 'Panama', 'PAN|PTY|巴拿馬|巴拿马城|巴拿馬城|Panama City'],
    ['CU', '古巴', 'Cuba', 'CUB|HAV|哈瓦那|Havana'],
    ['JM', '牙买加', 'Jamaica', 'JAM|KIN|牙買加|金斯敦|京斯敦|Kingston'],
    ['HT', '海地', 'Haiti', 'HTI|PAP|太子港|Port-au-Prince'],
    ['DO', '多米尼加', 'Dominican Republic', 'DOM|SDQ|PUJ|多米尼加共和国|多明尼加|圣多明各|聖多明哥|Santo Domingo|Punta Cana'],
    ['DM', '多米尼克', 'Dominica', 'DMA|多米尼克|罗索|羅索|Roseau'],
    ['BS', '巴哈马', 'Bahamas', 'BHS|NAS|巴哈馬|拿骚|拿索|Nassau'],
    ['BB', '巴巴多斯', 'Barbados', 'BRB|BGI|巴貝多|布里奇顿|橋鎮|Bridgetown'],
    ['TT', '特立尼达和多巴哥', 'Trinidad and Tobago', 'TTO|POS|特立尼达|千里達|多巴哥|西班牙港|Port of Spain'],
    ['GD', '格林纳达', 'Grenada', 'GRD|GND|格瑞那達|圣乔治|聖喬治|St George'],
    ['LC', '圣卢西亚', 'Saint Lucia', 'LCA|UVF|聖露西亞|卡斯特里|Castries'],
    ['VC', '圣文森特和格林纳丁斯', 'Saint Vincent and the Grenadines', 'VCT|SVD|圣文森特|聖文森|Kingstown'],
    ['KN', '圣基茨和尼维斯', 'Saint Kitts and Nevis', 'KNA|SKB|圣基茨|聖基茨|尼维斯|尼維斯|Basseterre'],
    ['AG', '安提瓜和巴布达', 'Antigua and Barbuda', 'ATG|ANU|安提瓜|安地卡|巴布达|巴布達|St John'],
    ['PR', '波多黎各', 'Puerto Rico', 'PRI|SJU|圣胡安|聖胡安|San Juan'],
    ['VI', '美属维尔京群岛', 'U.S. Virgin Islands', 'VIR|STT|美屬維京|维尔京群岛|維京群島|圣托马斯|聖湯瑪斯|St Thomas'],
    ['VG', '英属维尔京群岛', 'British Virgin Islands', 'VGB|EIS|英屬維京|托尔托拉|托爾托拉|Tortola'],
    ['KY', '开曼群岛', 'Cayman Islands', 'CYM|GCM|開曼|開曼群島|乔治敦|喬治城|George Town'],
    ['BM', '百慕大', 'Bermuda', 'BMU|BDA|百慕達|汉密尔顿|漢密爾頓|Hamilton'],
    ['GL', '格陵兰', 'Greenland', 'GRL|GOH|格陵蘭|努克|Nuuk'],
    ['AW', '阿鲁巴', 'Aruba', 'ABW|AUA|阿魯巴|Oranjestad'],
    ['CW', '库拉索', 'Curacao', 'CUW|CUR|庫拉索|威廉斯塔德|Willemstad'],
    ['SX', '荷属圣马丁', 'Sint Maarten', 'SXM|荷屬聖馬丁|菲利普斯堡|Philipsburg'],
    ['MF', '法属圣马丁', 'Saint Martin', 'MAF|法屬聖馬丁|马里戈特|馬里戈特|Marigot'],
    ['BQ', '博奈尔', 'Bonaire', 'BES|BON|博奈爾|博奈尔岛|博奈爾島|Sint Eustatius|Saba'],
    ['GP', '瓜德罗普', 'Guadeloupe', 'GLP|PTP|瓜德羅普|皮特尔角城|皮特爾角城|Pointe-a-Pitre'],
    ['MQ', '马提尼克', 'Martinique', 'MTQ|FDF|馬丁尼克|法兰西堡|法蘭西堡|Fort-de-France'],
    ['BL', '圣巴泰勒米', 'Saint Barthelemy', 'BLM|SBH|聖巴泰勒米|Saint Barts'],
    ['AI', '安圭拉', 'Anguilla', 'AIA|AXA|The Valley'],
    ['MS', '蒙特塞拉特', 'Montserrat', 'MSR|MNI|Montserrat|Brades'],
    ['TC', '特克斯和凯科斯群岛', 'Turks and Caicos Islands', 'TCA|PLS|特克斯與凱科斯|Turks and Caicos|Providenciales'],
    ['BO', '玻利维亚', 'Bolivia', 'BOL|LPB|VVI|玻利維亞|拉巴斯|La Paz'],
    ['CL', '智利', 'Chile', 'CHL|SCL|圣地亚哥|聖地牙哥|Santiago'],
    ['EC', '厄瓜多尔', 'Ecuador', 'ECU|UIO|GYE|厄瓜多|基多|Quito'],
    ['GY', '圭亚那', 'Guyana', 'GUY|OGL|圭亞那|乔治敦|喬治城|Georgetown'],
    ['PY', '巴拉圭', 'Paraguay', 'PRY|ASU|巴拉圭|亚松森|亞松森|Asuncion'],
    ['SR', '苏里南', 'Suriname', 'SUR|PBM|蘇里南|帕拉马里博|帕拉馬里博|Paramaribo'],
    ['UY', '乌拉圭', 'Uruguay', 'URY|MVD|烏拉圭|蒙得维的亚|蒙得維的亞|Montevideo'],
    ['VE', '委内瑞拉', 'Venezuela', 'VEN|CCS|委內瑞拉|加拉加斯|Caracas'],
    ['GF', '法属圭亚那', 'French Guiana', 'GUF|CAY|法屬圭亞那|卡宴|Cayenne'],
    ['AR', '阿根廷', 'Argentina', 'ARG|EZE|AEP|布宜诺斯艾利斯|布宜諾斯艾利斯|Buenos Aires'],
    ['CO', '哥伦比亚', 'Colombia', 'COL|BOG|MDE|哥倫比亞|波哥大|麦德林|麥德林|Bogota'],
    ['PE', '秘鲁', 'Peru', 'LIM|秘魯|利马|利馬|Lima'],

    // ---------- 非洲 ----------
    ['DZ', '阿尔及利亚', 'Algeria', 'DZA|ALG|阿爾及利亞|阿尔及尔|阿爾及爾|Algiers'],
    ['AO', '安哥拉', 'Angola', 'AGO|LAD|罗安达|羅安達|Luanda'],
    ['BJ', '贝宁', 'Benin', 'BEN|COO|貝寧|科托努|Cotonou'],
    ['BW', '博茨瓦纳', 'Botswana', 'BWA|GBE|波札那|哈博罗内|嘉柏隆里|Gaborone'],
    ['BF', '布基纳法索', 'Burkina Faso', 'BFA|OUA|布吉納法索|瓦加杜古|Ouagadougou'],
    ['BI', '布隆迪', 'Burundi', 'BDI|BJM|蒲隆地|布琼布拉|布松布拉|Bujumbura'],
    ['CV', '佛得角', 'Cabo Verde', 'CPV|Cape Verde|RAI|維德角|普拉亚|培亞|Praia'],
    ['CM', '喀麦隆', 'Cameroon', 'CMR|DLA|NSI|喀麥隆|雅温得|雅溫得|Yaounde|Douala'],
    ['CF', '中非', 'Central African Republic', 'CAF|BGF|中非共和国|中非共和國|班吉|Bangui'],
    ['TD', '乍得', 'Chad', 'TCD|NDJ|查德|恩贾梅纳|恩將納|N\'Djamena'],
    ['KM', '科摩罗', 'Comoros', 'HAH|葛摩|科摩羅|莫罗尼|莫洛尼|Moroni'],
    ['CG', '刚果（布）', 'Congo', 'COG|BZV|刚果布|剛果布|布拉柴维尔|布拉薩市|Brazzaville'],
    ['CD', '刚果（金）', 'Democratic Republic of the Congo', 'COD|FIH|DR Congo|刚果金|剛果金|刚果民主共和国|金夏沙|金沙萨|Kinshasa'],
    ['CI', '科特迪瓦', 'Cote d\'Ivoire', 'CIV|Ivory Coast|ABJ|象牙海岸|阿比让|阿比讓|Abidjan'],
    ['DJ', '吉布提', 'Djibouti', 'DJI|JIB|吉布地|Djibouti'],
    ['GQ', '赤道几内亚', 'Equatorial Guinea', 'GNQ|SSG|赤道幾內亞|马拉博|馬拉博|Malabo'],
    ['ER', '厄立特里亚', 'Eritrea', 'ERI|厄利垂亞|阿斯马拉|阿斯瑪拉|Asmara'],
    ['SZ', '斯威士兰', 'Eswatini', 'SWZ|Swaziland|MTS|史瓦帝尼|史瓦濟蘭|姆巴巴内|姆巴巴納|Mbabane'],
    ['ET', '埃塞俄比亚', 'Ethiopia', 'ETH|ADD|衣索比亞|埃塞|亚的斯亚贝巴|阿迪斯阿貝巴|Addis Ababa'],
    ['GA', '加蓬', 'Gabon', 'GAB|LBV|加彭|利伯维尔|自由市|Libreville'],
    ['GM', '冈比亚', 'Gambia', 'GMB|BJL|甘比亞|班珠尔|班竹|Banjul'],
    ['GH', '加纳', 'Ghana', 'GHA|ACC|迦納|阿克拉|Accra'],
    ['GN', '几内亚', 'Guinea', 'GIN|CKY|幾內亞|科纳克里|柯那克里|Conakry'],
    ['GW', '几内亚比绍', 'Guinea-Bissau', 'GNB|OXB|幾內亞比索|比绍|比索|Bissau'],
    ['KE', '肯尼亚', 'Kenya', 'KEN|NBO|MBA|肯亞|内罗毕|奈洛比|蒙巴萨|蒙巴薩|Nairobi|Mombasa'],
    ['LS', '莱索托', 'Lesotho', 'LSO|MSU|賴索托|马塞卢|馬塞魯|Maseru'],
    ['LR', '利比里亚', 'Liberia', 'LBR|ROB|賴比瑞亞|蒙罗维亚|蒙羅維亞|Monrovia'],
    ['LY', '利比亚', 'Libya', 'LBY|TIP|利比亞|的黎波里|Tripoli'],
    ['MG', '马达加斯加', 'Madagascar', 'MDG|TNR|馬達加斯加|塔那那利佛|Antananarivo'],
    ['MW', '马拉维', 'Malawi', 'MWI|LLW|馬拉威|利隆圭|Lilongwe'],
    ['ML', '马里', 'Mali', 'MLI|BKO|馬利|巴马科|巴馬科|Bamako'],
    ['MR', '毛里塔尼亚', 'Mauritania', 'MRT|NKC|茅利塔尼亞|努瓦克肖特|诺克少|Nouakchott'],
    ['MU', '毛里求斯', 'Mauritius', 'MUS|MRU|模里西斯|路易港|Port Louis'],
    ['MA', '摩洛哥', 'Morocco', 'MAR|CMN|RAK|卡萨布兰卡|卡薩布蘭卡|马拉喀什|馬拉喀什|Casablanca|Marrakesh'],
    ['MZ', '莫桑比克', 'Mozambique', 'MOZ|MPM|莫三比克|马普托|馬布多|Maputo'],
    ['NA', '纳米比亚', 'Namibia', 'NAM|WDH|納米比亞|温得和克|溫得和克|Windhoek'],
    ['NE', '尼日尔', 'Niger', 'NER|NIM|尼日|尼亚美|尼亞美|Niamey'],
    ['NG', '尼日利亚', 'Nigeria', 'NGA|LOS|ABV|奈及利亞|拉各斯|阿布贾|阿布加|Lagos|Abuja'],
    ['RW', '卢旺达', 'Rwanda', 'RWA|KGL|盧安達|基加利|Kigali'],
    ['ST', '圣多美和普林西比', 'Sao Tome and Principe', 'STP|TMS|聖多美普林西比|圣多美|Sao Tome'],
    ['SN', '塞内加尔', 'Senegal', 'SEN|DKR|塞內加爾|达喀尔|達卡|Dakar'],
    ['SC', '塞舌尔', 'Seychelles', 'SYC|SEZ|塞席爾|维多利亚|維多利亞|Victoria'],
    ['SL', '塞拉利昂', 'Sierra Leone', 'SLE|FNA|狮子山|獅子山|弗里敦|Freetown'],
    ['SO', '索马里', 'Somalia', 'SOM|MGQ|索馬利亞|摩加迪沙|摩加迪休|Mogadishu'],
    ['SS', '南苏丹', 'South Sudan', 'SSD|JUB|南蘇丹|朱巴|Juba'],
    ['SD', '苏丹', 'Sudan', 'SDN|KRT|蘇丹|喀土穆|Khartoum'],
    ['TZ', '坦桑尼亚', 'Tanzania', 'TZA|DAR|ZNZ|坦尚尼亞|达累斯萨拉姆|三蘭港|桑给巴尔|尚吉巴|Dar es Salaam|Zanzibar'],
    ['TG', '多哥', 'Togo', 'TGO|LFW|洛美|Lome'],
    ['TN', '突尼斯', 'Tunisia', 'TUN|突尼西亞|突尼斯市|Tunis'],
    ['UG', '乌干达', 'Uganda', 'UGA|EBB|烏干達|坎帕拉|Kampala|Entebbe'],
    ['ZM', '赞比亚', 'Zambia', 'ZMB|LUN|尚比亞|卢萨卡|盧沙卡|Lusaka'],
    ['ZW', '津巴布韦', 'Zimbabwe', 'ZWE|HRE|辛巴威|哈拉雷|Harare'],
    ['YT', '马约特', 'Mayotte', 'MYT|馬約特|Mamoudzou'],
    ['RE', '留尼汪', 'Reunion', 'REU|RUN|留尼旺|圣但尼|聖丹尼|Saint-Denis'],
    ['SH', '圣赫勒拿', 'Saint Helena', 'SHN|HLE|聖赫勒拿|Jamestown'],
    ['EH', '西撒哈拉', 'Western Sahara', 'ESH|西撒哈拉|Laayoune'],

    // ---------- 大洋洲 ----------
    ['NZ', '新西兰', 'New Zealand', 'NZL|AKL|CHC|WLG|紐西蘭|新西蘭|纽西兰|奥克兰|奧克蘭|惠灵顿|威靈頓|基督城|皇后镇|皇后鎮|Auckland|Wellington|Christchurch|Queenstown|NewZealand'],
    ['PG', '巴布亚新几内亚', 'Papua New Guinea', 'PNG|POM|巴布亞紐幾內亞|巴布亚|莫尔兹比港|莫士比港|Port Moresby|Papua|New Guinea'],
    ['FJ', '斐济', 'Fiji', 'FJI|NAN|SUV|斐濟|苏瓦|蘇瓦|楠迪|Nadi|Suva'],
    ['SB', '所罗门群岛', 'Solomon Islands', 'SLB|HIR|索羅門|所羅門|索羅門群島|霍尼亚拉|霍尼亞拉|Honiara'],
    ['VU', '瓦努阿图', 'Vanuatu', 'VUT|VLI|萬那杜|维拉港|維拉港|Port Vila'],
    ['WS', '萨摩亚', 'Samoa', 'WSM|APW|薩摩亞|阿皮亚|阿皮亞|Apia'],
    ['TO', '汤加', 'Tonga', 'TON|TBU|東加|努库阿洛法|努瓜婁發|Nuku\'alofa'],
    ['KI', '基里巴斯', 'Kiribati', 'KIR|TRW|吉里巴斯|塔拉瓦|Tarawa'],
    ['MH', '马绍尔群岛', 'Marshall Islands', 'MHL|MAJ|馬紹爾|馬紹爾群島|马朱罗|馬久羅|Majuro'],
    ['FM', '密克罗尼西亚', 'Micronesia', 'FSM|PNI|密克羅尼西亞|波纳佩|波納佩|Pohnpei'],
    ['PW', '帕劳', 'Palau', 'PLW|ROR|帛琉|科罗尔|科羅爾|Koror'],
    ['NR', '瑙鲁', 'Nauru', 'NRU|INU|諾魯|亚伦|雅連|Yaren'],
    ['TV', '图瓦卢', 'Tuvalu', 'TUV|FUN|吐瓦魯|富纳富提|富納富提|Funafuti'],
    ['CK', '库克群岛', 'Cook Islands', 'COK|RAR|庫克群島|拉罗汤加|拉羅湯加|Rarotonga'],
    ['NU', '纽埃', 'Niue', 'NIU|IUE|紐埃|阿洛菲|Alofi'],
    ['PF', '法属波利尼西亚', 'French Polynesia', 'PYF|PPT|法屬玻里尼西亞|塔希提|大溪地|Tahiti|Papeete|Bora Bora'],
    ['NC', '新喀里多尼亚', 'New Caledonia', 'NCL|NOU|新喀里多尼亞|努美阿|Noumea'],
    ['WF', '瓦利斯和富图纳', 'Wallis and Futuna', 'WLF|WLS|瓦利斯|富图纳|富圖納|Wallis|Futuna'],
    ['TK', '托克劳', 'Tokelau', 'TKL|托克勞|Tokelau'],
    ['NF', '诺福克岛', 'Norfolk Island', 'NFK|NLK|諾福克島|Norfolk Island'],
    ['CX', '圣诞岛', 'Christmas Island', 'CXR|XCH|聖誕島|Christmas Island'],
    ['CC', '科科斯群岛', 'Cocos Islands', 'CCK|科科斯|科科斯群島|Cocos|Keeling'],
    ['PN', '皮特凯恩群岛', 'Pitcairn Islands', 'PCN|皮特凯恩|皮特肯|Pitcairn'],
    ['AS', '美属萨摩亚', 'American Samoa', 'ASM|PPG|美屬薩摩亞|帕果帕果|Pago Pago'],
    ['GU', '关岛', 'Guam', 'GUM|關島|阿加尼亚|阿加尼亞|Hagatna|Agana'],
    ['MP', '北马里亚纳群岛', 'Northern Mariana Islands', 'MNP|SPN|北馬里亞納|塞班|塞班岛|塞班島|Saipan|Tinian|Rota'],

    // ---------- 极地 / 其他属地 ----------
    ['AQ', '南极洲', 'Antarctica', 'ATA|南极|南極|Antarctic'],
    ['BV', '布韦岛', 'Bouvet Island', 'BVT|布韋島|Bouvet'],
    ['HM', '赫德岛和麦克唐纳群岛', 'Heard Island and McDonald Islands', 'HMD|赫德岛|赫德島|Heard Island'],
    ['TF', '法属南部领地', 'French Southern Territories', 'ATF|法屬南部領地|French Southern Territories'],
    ['GS', '南乔治亚和南桑威奇群岛', 'South Georgia and the South Sandwich Islands', 'SGS|南喬治亞|South Georgia'],
    ['FK', '福克兰群岛', 'Falkland Islands', 'FLK|MPN|福克蘭群島|马尔维纳斯|馬爾維納斯|Falkland|Malvinas'],
    ['IM', '马恩岛', 'Isle of Man', 'IMN|馬恩島|曼岛|曼島|Isle of Man'],
    ['JE', '泽西岛', 'Jersey', 'JEY|澤西島|Jersey'],
    ['GG', '根西岛', 'Guernsey', 'GGY|根西島|Guernsey'],
    ['GI', '直布罗陀', 'Gibraltar', 'GIB|直布羅陀|Gibraltar'],
    ['FO', '法罗群岛', 'Faroe Islands', 'FRO|法羅群島|法羅|Faroe'],
    ['AX', '奥兰群岛', 'Aland Islands', 'ALA|奧蘭群島|奥兰|Åland'],
    ['SJ', '斯瓦尔巴和扬马延', 'Svalbard and Jan Mayen', 'SJM|斯瓦爾巴|扬马延|揚馬延|Svalbard'],
    ['IO', '英属印度洋领地', 'British Indian Ocean Territory', 'IOT|英屬印度洋領地|迪戈加西亚|迪亞哥加西亞|Diego Garcia'],
    ['PM', '圣皮埃尔和密克隆', 'Saint Pierre and Miquelon', 'SPM|聖皮埃爾和密克隆|圣皮埃尔|聖皮埃爾|Saint Pierre'],
    ['PS', '巴勒斯坦', 'Palestine', 'PSE|巴勒斯坦|加沙|加薩|拉姆安拉|Ramallah|Gaza|West Bank|约旦河西岸|約旦河西岸'],
    ['UM', '美国本土外小岛屿', 'United States Minor Outlying Islands', 'UMI|美國本土外小島嶼|United States Minor Outlying Islands'],
    ['EU', '欧洲', 'Europe', '欧盟|歐盟|European Union|Euro'],

];

for (const [code, zhName, enName, aliasString] of ADDITIONAL_REGION_DEFINITIONS) {
    const keywords = REGION_KEYWORDS[zhName] || [];
    const candidates = [code, zhName, enName, ...String(aliasString || '').split('|')];

    for (const candidate of candidates) {
        const keyword = String(candidate || '').trim();
        if (!keyword) continue;
        if (!keywords.some(existing => String(existing).toLowerCase() === keyword.toLowerCase())) {
            keywords.push(keyword);
        }
    }

    if (!REGION_KEYWORDS[zhName]) {
        REGION_KEYWORDS[zhName] = keywords;
    }
    if (!REGION_EMOJI[zhName]) {
        REGION_EMOJI[zhName] = codeToFlag(code);
    }
}

/* ------------------------------------------------------------------ *
 * 地区匹配索引（模块加载时预编译，避免每次识别都重复遍历大对象）
 * ------------------------------------------------------------------ */

const SHORT_CODE_TO_REGION = Object.create(null);
const KEYWORD_TO_REGION = Object.create(null);
const LATIN_KEYWORDS = [];
const OTHER_KEYWORDS = [];
const SEEN_KEYWORDS = new Set();

for (const [regionName, keywords] of Object.entries(REGION_KEYWORDS)) {
    for (const rawKeyword of keywords) {
        const keyword = String(rawKeyword || '').trim();
        if (!keyword) continue;

        const lower = keyword.toLowerCase();
        if (SEEN_KEYWORDS.has(lower)) continue;
        SEEN_KEYWORDS.add(lower);
        KEYWORD_TO_REGION[lower] = regionName;

        if (/^[a-z]{2,3}$/i.test(keyword)) {
            const code = keyword.toUpperCase();
            if (!SHORT_CODE_TO_REGION[code]) SHORT_CODE_TO_REGION[code] = regionName;
            continue;
        }

        // 纯拉丁关键词使用单词边界匹配；中文/带重音字符的关键词直接包含匹配
        if (/^[a-z][a-z .'\-]*$/i.test(keyword)) {
            if (keyword.length >= 4) LATIN_KEYWORDS.push(lower);
        } else {
            OTHER_KEYWORDS.push(lower);
        }
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileKeywordRegex(keywords, useWordBoundary) {
    if (!keywords.length) return null;
    // 长关键词优先，避免 Romania -> Oman、Nigeria -> Niger 等子串误判
    const alternation = [...new Set(keywords)]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|');
    return useWordBoundary
        ? new RegExp(`(?:^|[^a-z])((?:${alternation}))(?![a-z])`, 'gi')
        : new RegExp(`(?:${alternation})`, 'gi');
}

const LATIN_KEYWORD_RE = compileKeywordRegex(LATIN_KEYWORDS, true);
const OTHER_KEYWORD_RE = compileKeywordRegex(OTHER_KEYWORDS, false);
const FLAG_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;

// 双字母代码本身是常见英文单词时，必须处于明确的分隔/中文/数字环境中
const STRICT_ALWAYS_CODES = new Set([
    'NO', 'IN', 'IT', 'IS', 'AM', 'ME', 'MY', 'TO', 'AT', 'BE', 'DO', 'AS', 'SO', 'BY',
    'IF', 'OR', 'ON', 'UP', 'WE', 'HE', 'AN', 'OF',
    // 常见非地区缩写/协议名（AI、IO、TV、FM、PM、CC、SS、TLS、WS 等）避免误判
    'AI', 'IO', 'TV', 'FM', 'PM', 'CC', 'SS', 'TLS', 'WS', 'NA', 'MS',
    // 全大写时也容易误判的英文功能词/缩写
    'AND', 'ARE', 'CAN', 'VAT', 'COD'
]);

// 三字母代码本身是常见英文单词时，仅在小写形式下要求结构化上下文
const STRICT_LOWERCASE_CODES = new Set([
    'AND', 'ARE', 'CAN', 'FIN', 'EST', 'MAR', 'PER', 'NOR', 'SOM', 'TON', 'TUR', 'VAT',
    'PAN', 'GAB', 'GUY', 'ARM', 'LAO', 'SEN', 'TUN', 'MLI', 'NAM', 'MUS', 'NER', 'NGA',
    'TGO', 'COD', 'GIN', 'SIN', 'SEA', 'SAN'
]);

const CODE_TOKEN_RE = /(?:^|[^A-Za-z])([A-Za-z]{2,3})(?![A-Za-z])/g;
const STRUCTURAL_DELIMITER_RE = /[\[\]|_/(),{}<>:]/;
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

function isStructuralBoundary(value) {
    return !value || STRUCTURAL_DELIMITER_RE.test(value) || CJK_RE.test(value) || /\d/.test(value);
}

function isAcceptableCodeToken(input, token, start, end, upperCode) {
    const before = input[start - 1] || '';

    // 域名后缀不是地区：避免 V2CROSS.COM -> 科摩罗、xxx.IO -> 英属印度洋领地
    if (before === '.') return false;

    const hasLowercase = token !== token.toUpperCase();
    const isStrict = STRICT_ALWAYS_CODES.has(upperCode)
        || (hasLowercase && STRICT_LOWERCASE_CODES.has(upperCode));
    if (!isStrict) return true;

    const after = input[end] || '';
    // 只有明确的分隔符/中文/数字才算强上下文；纯空格或首尾位置不算
    const strongBefore = start > 0 && isStructuralBoundary(before);
    const strongAfter = end < input.length
        && (isStructuralBoundary(after)
            || (after === '-' && /\d/.test(input[end + 1] || '')));

    return strongBefore || strongAfter;
}

function matchFlagEmoji(input) {
    FLAG_EMOJI_RE.lastIndex = 0;
    let match;
    while ((match = FLAG_EMOJI_RE.exec(input))) {
        const codePoints = Array.from(match[0]);
        const code = codePoints
            .map(ch => String.fromCharCode(65 + ch.codePointAt(0) - 0x1F1E6))
            .join('');
        const region = SHORT_CODE_TO_REGION[code];
        if (region) {
            return { region, index: match.index, length: match[0].length };
        }
    }
    return null;
}

function matchShortCode(input) {
    CODE_TOKEN_RE.lastIndex = 0;
    let best = null;
    let match;

    while ((match = CODE_TOKEN_RE.exec(input))) {
        const token = match[1];
        const start = match.index + (match[0].length - token.length);
        const end = start + token.length;
        const upperCode = token.toUpperCase();
        const region = SHORT_CODE_TO_REGION[upperCode];
        if (!region || !isAcceptableCodeToken(input, token, start, end, upperCode)) continue;

        const candidate = { region, index: start, length: token.length };
        if (!best || candidate.index < best.index
            || (candidate.index === best.index && candidate.length > best.length)) {
            best = candidate;
        }
    }

    return best;
}

function matchKeywordRegex(regex, input, hasCaptureGroup) {
    if (!regex) return null;
    regex.lastIndex = 0;
    const match = regex.exec(input);
    if (!match) return null;

    const matchedText = hasCaptureGroup ? match[1] : match[0];
    const index = match.index + (match[0].length - matchedText.length);
    return {
        region: SHORT_CODE_TO_REGION[matchedText.toUpperCase()] || keywordToRegion(matchedText),
        index,
        length: matchedText.length
    };
}

function keywordToRegion(keyword) {
    return KEYWORD_TO_REGION[String(keyword || '').toLowerCase()] || null;
}

function normalizeBase64(input) {
    let s = String(input || '').trim().replace(/\s+/g, '');
    if (!s) return '';
    if (s.includes('%')) {
        try {
            s = decodeURIComponent(s);
        } catch {
            // keep raw when decode fails
        }
    }
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return s;
}

function isLikelyBase64(input) {
    const s = String(input || '').trim();
    if (!s) return false;
    if (!/^[A-Za-z0-9+/=_-]+$/.test(s)) return false;
    return s.length >= 6;
}

function tryDecodeBase64(input) {
    if (!isLikelyBase64(input)) return null;
    try {
        return atob(normalizeBase64(input));
    } catch {
        return null;
    }
}

function parseHostPort(value) {
    let segment = String(value || '');
    if (!segment) return { server: '', port: '' };
    const cut = segment.search(/[/?#]/);
    if (cut !== -1) segment = segment.slice(0, cut);

    if (segment.startsWith('[')) {
        const closeBracket = segment.indexOf(']');
        if (closeBracket !== -1) {
            const server = segment.slice(1, closeBracket);
            const after = segment.slice(closeBracket + 1);
            const port = after.startsWith(':') ? after.slice(1).split('/')[0] : '';
            return { server, port };
        }
    }

    const parts = segment.split(':');
    if (parts.length >= 2) {
        return { server: parts[0], port: parts[1].split('/')[0] };
    }
    return { server: segment, port: '' };
}

/**
 * 从节点名称中识别地区
 * @param {string} nodeName - 节点名称
 * @returns {string} 识别出的地区，如未识别返回"其他"
 */
export function extractNodeRegion(nodeName) {
    if (!nodeName || typeof nodeName !== 'string') {
        return '其他';
    }

    let best = null;
    const consider = candidate => {
        if (!candidate || !candidate.region) return;
        if (!best
            || candidate.index < best.index
            || (candidate.index === best.index && candidate.length > best.length)) {
            best = candidate;
        }
    };

    // 国旗 Emoji 是最强信号，优先解码为 ISO 代码
    consider(matchFlagEmoji(nodeName));
    // 2-3 位 ISO / 机场代码（带边界与结构化上下文校验）
    consider(matchShortCode(nodeName));
    // 英文/拼音长关键词（单词边界，长词优先）
    consider(matchKeywordRegex(LATIN_KEYWORD_RE, nodeName, true));
    // 中文及其他非拉丁关键词
    consider(matchKeywordRegex(OTHER_KEYWORD_RE, nodeName, false));

    return best ? best.region : '其他';
}

/**
 * 获取所有支持的地区列表
 * @returns {string[]} 支持的地区名称数组
 */
export function getSupportedRegions() {
    return Object.keys(REGION_KEYWORDS);
}

/**
 * 获取指定地区的所有关键词
 * @param {string} region - 地区名称
 * @returns {string[]} 该地区的所有关键词，如地区不存在返回空数组
 */
export function getRegionKeywords(region) {
    return REGION_KEYWORDS[region] || [];
}

/**
 * [新增] 获取地区 Emoji
 * @param {string} region - 地区名称
 * @returns {string} 对应的 Emoji，如果未找到则返回空字符串
 */
export function getRegionEmoji(region) {
    return REGION_EMOJI[region] || (region === '其他' || !region ? '🌍' : '');
}

/**
 * 检查节点名称是否包含指定地区
 * @param {string} nodeName - 节点名称
 * @param {string} region - 要检查的地区
 * @returns {boolean} 是否包含该地区
 */
export function containsRegion(nodeName, region) {
    if (!nodeName || !region || !REGION_KEYWORDS[region]) {
        return false;
    }

    const normalizedNodeName = nodeName.toLowerCase();
    const keywords = REGION_KEYWORDS[region];

    for (const keyword of keywords) {
        if (normalizedNodeName.includes(keyword.toLowerCase())) {
            return true;
        }
    }

    return false;
}

/**
 * 获取节点的详细信息（协议、名称、地区等）
 * @param {string} nodeUrl - 节点URL
 * @returns {Object} 节点详细信息
 */
export function parseNodeInfo(nodeUrl) {
    if (!nodeUrl || typeof nodeUrl !== 'string') {
        return {
            protocol: 'unknown',
            name: '未命名节点',
            region: '其他',
            url: nodeUrl
        };
    }

    // 提取协议
    const protocolMatch = nodeUrl.match(/^(.*?):\/\//);
    const protocol = protocolMatch ? protocolMatch[1].toLowerCase() : 'unknown';

    // 提取节点名称
    let nodeName = '';
    const hashIndex = nodeUrl.lastIndexOf('#');
    if (hashIndex !== -1) {
        try {
            nodeName = decodeURIComponent(nodeUrl.substring(hashIndex + 1));
        } catch (e) {
            nodeName = nodeUrl.substring(hashIndex + 1);
        }
    }

    // [增强] 如果 Hash 中没有名称，尝试从 URL 参数中提取 (支持 remarks, des, remark)
    if (!nodeName) {
        const paramsMatch = nodeUrl.match(/[?&](remarks|des|remark)=([^&#]+)/);
        if (paramsMatch && paramsMatch[2]) {
            try {
                nodeName = decodeURIComponent(paramsMatch[2]);
            } catch (e) {
                nodeName = paramsMatch[2];
            }
        }
    }

    // 如果没有名称，从URL生成一个
    if (!nodeName) {
        // 从URL中提取一些信息作为名称
        const urlWithoutProtocol = nodeUrl.replace(/^[^:]*:\/\//, '');
        const urlParts = urlWithoutProtocol.split(/[:@?#]/);
        nodeName = urlParts[0] || '未命名节点';
    }

    // [新增] 提取服务器地址和端口
    let server = '';
    let port = '';

    try {
        if (protocol === 'vmess') {
            const base64Part = nodeUrl.replace('vmess://', '');
            if (base64Part && !base64Part.includes('@')) { // 排除可能是明文的情况(虽然vmess少见)
                try {
                    // 处理 URL-safe Base64 字符
                    let safeBody = base64Part.replace(/-/g, '+').replace(/_/g, '/');
                    // 补全 Padding
                    while (safeBody.length % 4) {
                        safeBody += '=';
                    }
                    const jsonStr = atob(safeBody); // 使用 decodeURIComponent(escape(atob(safeBody))) 处理中文? 
                    // 不, atob 解码后通常是 UTF-8 字节流乱码 if directly used as string for Chinese
                    // 需要用 TextDecoder
                    const binaryString = atob(safeBody);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const decodedStr = new TextDecoder('utf-8').decode(bytes);

                    const config = JSON.parse(decodedStr);
                    server = config.add || config.host || '';
                    port = config.port || '';
                    // [Fix] 提取名称
                    if (config.ps) {
                        nodeName = config.ps;
                    }
                } catch (e) {
                    console.debug('[GeoUtils] VMess base64 decode failed:', e);
                }
            }
        } else if (protocol === 'ss') {
            // ss://base64(user:pass@host:port)#name
            // 或者 ss://base64(user:pass)@host:port#name
            let body = nodeUrl.substring(5); // remove ss://
            const hIndex = body.indexOf('#');
            if (hIndex !== -1) body = body.substring(0, hIndex);
            const qIndex = body.indexOf('?');
            if (qIndex !== -1) body = body.substring(0, qIndex);

            const atLast = body.lastIndexOf('@');
            let serverPart = '';
            if (atLast !== -1) {
                // 明文或 SIP002 (base64 userinfo)
                serverPart = body.substring(atLast + 1);
            } else {
                const decoded = tryDecodeBase64(body);
                if (decoded && decoded.includes('@')) {
                    serverPart = decoded.substring(decoded.lastIndexOf('@') + 1);
                } else {
                    serverPart = body;
                }
            }

            const parsed = parseHostPort(serverPart);
            server = parsed.server;
            port = parsed.port;
        } else if (protocol === 'ssr') {
            // SSR 格式: ssr://base64(server:port:protocol:method:obfs:base64(password)/?params)
            // params 中包含 remarks=base64(name), obfsparam=..., protoparam=...
            try {
                let payload = nodeUrl.substring(6); // 去掉 ssr://
                // 去掉可能存在的 # fragment
                const hIdx = payload.indexOf('#');
                if (hIdx !== -1) payload = payload.substring(0, hIdx);
                // 去掉外层查询参数（不常见但防御性处理）
                const qIdx = payload.indexOf('?');
                if (qIdx !== -1) payload = payload.substring(0, qIdx);

                const decoded = tryDecodeBase64(payload);
                if (decoded) {
                    // 解析 server:port:protocol:method:obfs:password_base64/?params
                    // server 可能是 IPv6 [::1]
                    let ssrServer = '', ssrPort = '';
                    if (decoded.startsWith('[')) {
                        // IPv6 格式: [ipv6]:port:...
                        const closeBracket = decoded.indexOf(']');
                        if (closeBracket !== -1) {
                            ssrServer = decoded.substring(1, closeBracket);
                            const afterBracket = decoded.substring(closeBracket + 1);
                            const portMatch = afterBracket.match(/^:(\d+):/);
                            if (portMatch) ssrPort = portMatch[1];
                        }
                    } else {
                        // IPv4/domain 格式: host:port:...
                        const colonParts = decoded.split(':');
                        if (colonParts.length >= 2) {
                            ssrServer = colonParts[0];
                            ssrPort = colonParts[1];
                        }
                    }
                    server = ssrServer;
                    port = ssrPort;

                    // 提取 remarks 名称（SSR 名称在 Base64 编码的 remarks 参数中）
                    const slashQ = decoded.indexOf('/?');
                    const paramStart = slashQ !== -1 ? slashQ + 2 : (decoded.indexOf('?') !== -1 ? decoded.indexOf('?') + 1 : -1);
                    if (paramStart !== -1) {
                        const paramStr = decoded.substring(paramStart);
                        const remarksMatch = paramStr.match(/(?:^|&)remarks=([^&]*)/);
                        if (remarksMatch && remarksMatch[1]) {
                            const remarksB64 = remarksMatch[1].replace(/\s+/g, '');
                            // remarks 通常包含中文，需要 UTF-8 安全解码
                            try {
                                const normalized = normalizeBase64(remarksB64);
                                const binaryString = atob(normalized);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                const remarksDecoded = new TextDecoder('utf-8').decode(bytes);
                                if (remarksDecoded) {
                                    nodeName = remarksDecoded.trim();
                                }
                            } catch (e) {
                                // Base64 解码失败，尝试使用原始值
                                const fallback = tryDecodeBase64(remarksB64);
                                if (fallback) nodeName = fallback.trim();
                            }
                        }
                    }
                }
} catch (e) {
console.debug('[GeoUtils] SSR decode failed:', e);
}
} else if (protocol === 'wireguard') {
// WireGuard 格式: wireguard://privatekey@server:port?params#name
let body = nodeUrl.substring('wireguard://'.length);

// 提取名称
const hIndex = body.indexOf('#');
if (hIndex !== -1) {
try {
nodeName = decodeURIComponent(body.substring(hIndex + 1));
} catch (e) {
nodeName = body.substring(hIndex + 1);
}
body = body.substring(0, hIndex);
}

// 提取服务器和端口
const atIndex = body.lastIndexOf('@');
if (atIndex !== -1) {
const serverPart = body.substring(atIndex + 1);
const qIndex = serverPart.indexOf('?');
const addrPart = qIndex !== -1 ? serverPart.substring(0, qIndex) : serverPart;

// 处理 IPv6
if (addrPart.startsWith('[')) {
const closeBracket = addrPart.indexOf(']');
if (closeBracket !== -1) {
server = addrPart.substring(1, closeBracket);
const afterBracket = addrPart.substring(closeBracket + 1);
if (afterBracket.startsWith(':')) {
port = afterBracket.substring(1);
}
}
} else {
const parts = addrPart.split(':');
if (parts.length >= 2) {
server = parts[0];
port = parts[1];
}
}
}
} else {
            // 通用格式: protocol://user@host:port... 或 protocol://host:port...
            // vless, trojan, hysteria2, socks5, http 等
            // 去掉 protocol://
            let body = nodeUrl.substring(nodeUrl.indexOf('://') + 3);
            const hIndex = body.indexOf('#');
            if (hIndex !== -1) body = body.substring(0, hIndex);

            const qIndex = body.indexOf('?');
            if (qIndex !== -1) body = body.substring(0, qIndex);

            const atIndex = body.lastIndexOf('@');
            let serverPart = (atIndex !== -1) ? body.substring(atIndex + 1) : body;

            // [新增] 检测 Base64 编码的用户信息（某些非标准 VLESS URL）
            // 格式：vless://Base64(auto:uuid@host:port)?params
            if (atIndex === -1 && protocol === 'vless' && body.length > 20) {
                try {
                    // 尝试 Base64 解码
                    let b64 = body.replace(/-/g, '+').replace(/_/g, '/');
                    while (b64.length % 4) b64 += '=';
                    const binaryString = atob(b64);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const decoded = new TextDecoder('utf-8').decode(bytes);
                    // 检查解码结果是否包含 @ 符号（形如 auto:uuid@host:port）
                    if (decoded.includes('@')) {
                        const decodedAtIndex = decoded.lastIndexOf('@');
                        serverPart = decoded.substring(decodedAtIndex + 1);
                    }
                } catch (e) {
                    // Base64 解码失败，继续使用原逻辑
                    console.debug('[GeoUtils] VLESS base64 decode attempt failed (expected for standard format)');
                }
            }

            // 处理 IPv6 [::1]:port
            if (serverPart.startsWith('[')) {
                const closeBracket = serverPart.indexOf(']');
                if (closeBracket !== -1) {
                    server = serverPart.substring(1, closeBracket);
                    const afterBracket = serverPart.substring(closeBracket + 1);
                    if (afterBracket.startsWith(':')) {
                        port = afterBracket.substring(1).split('/')[0];
                    }
                }
            } else {
                const parts = serverPart.split(':');
                if (parts.length >= 2) {
                    server = parts[0];
                    port = parts[1].split('/')[0];
                }
            }
        }
    } catch (e) {
        console.error('Error extracting server/port:', e);
    }

    // 识别地区（先识别原始名称，保留 🇹🇼 的地区语义）
    const region = extractNodeRegion(nodeName);

    // [修复] 展示名称中将台湾旗帜替换为中国国旗（沿用项目既有策略）
    nodeName = nodeName.replace(/🇹🇼/g, '🇨🇳');

    return {
        protocol,
        name: nodeName,
        region,
        server,
        port,
        url: nodeUrl
    };
}

/**
 * 统计节点地区分布
 * @param {Array} nodes - 节点数组
 * @returns {Object} 地区统计信息
 */
export function calculateRegionStats(nodes) {
    const stats = {};
    const total = nodes.length;

    nodes.forEach(node => {
        const region = extractNodeRegion(node.name || '');
        stats[region] = (stats[region] || 0) + 1;
    });

    // 添加百分比信息
    for (const [region, count] of Object.entries(stats)) {
        stats[region] = {
            count,
            percentage: Math.round((count / total) * 100)
        };
    }

    return stats;
}
