'use strict';

// 客户端只是官方站点的壳：页面全部从线上加载，网站一发版客户端里立刻就是新版本，壳本身不带前端代码。
// 两个正式站点对应前端 src/Globals.ts 的国际版 / 中国版，登录态各存在各自域名的 localStorage 里。
const SITES = [
    { id: 'global', origin: 'https://mmhvh.com' },
    { id: 'cn', origin: 'https://mmhvh.cn' },
];

// 开发调试：MMHVH_URL=http://localhost:8080 npm start 让壳加载本地 vite（前端 ALLOWED_HOSTS 放行了 localhost），
// 也可以指向 https://dev.mmhvh.com。设置后它就是起始页，并且同样算「自家页面」。
const OVERRIDE_URL = parseHttpUrl(process.env.MMHVH_URL);

// 「自家页面」= 跑这套前端的 origin：可以拿通知 / 麦克风等权限、target=_blank 在客户端里开新窗口。
// 其余网站（Discord / Steam 登录、收银台、实名认证…）照样能在窗口里打开（这些流程靠同窗跳转再回跳），但不给任何权限。
const TRUSTED_ORIGINS = new Set([
    ...SITES.map((s) => s.origin),
    'https://dev.mmhvh.com',
    ...(OVERRIDE_URL ? [OVERRIDE_URL.origin] : []),
]);

// 中国大陆时区的新用户首次启动直接进 mmhvh.cn（国际站对中国访客本来也会提示跳过去）。
// 境外访问 mmhvh.cn 会被 302 回 mmhvh.com，所以误判的代价只是多一次跳转。
const CN_TIME_ZONES = new Set(['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Urumqi', 'Asia/Kashgar', 'PRC']);

function parseHttpUrl(raw) {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

function originOf(raw) {
    const url = parseHttpUrl(raw);
    return url ? url.origin : null;
}

function isTrusted(raw) {
    const origin = originOf(raw);
    return origin !== null && TRUSTED_ORIGINS.has(origin);
}

function siteById(id) {
    return SITES.find((s) => s.id === id) ?? null;
}

function siteByUrl(raw) {
    const origin = originOf(raw);
    return SITES.find((s) => s.origin === origin) ?? null;
}

function defaultSiteId(systemLocale) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (CN_TIME_ZONES.has(tz) || /^zh-(CN|Hans)/i.test(systemLocale)) return 'cn';
    return 'global';
}

/** 启动时打开的地址：MMHVH_URL > 上次停留的站点 > 按时区猜。 */
function startUrl(lastSiteId, systemLocale) {
    if (OVERRIDE_URL) return OVERRIDE_URL.href;
    const site = siteById(lastSiteId) ?? siteById(defaultSiteId(systemLocale));
    return `${site.origin}/`;
}

/** 当前地址换到另一个站点的同一路径（与前端 useVersionCheck 的 goToCnSite 一致：路径 / query / hash 原样带过去）。 */
function switchSiteUrl(currentUrl, targetSite) {
    const url = parseHttpUrl(currentUrl);
    if (!url || !isTrusted(url.href)) return `${targetSite.origin}/`;
    return new URL(`${url.pathname}${url.search}${url.hash}`, targetSite.origin).href;
}

module.exports = { SITES, isTrusted, parseHttpUrl, siteById, siteByUrl, startUrl, switchSiteUrl };
