'use strict';

const { Menu, clipboard, shell } = require('electron');
const sites = require('./sites');
const { t } = require('./i18n');
const log = require('./log');

// 自家页面能拿到的权限（Electron 没有浏览器那种权限弹窗，这里直接批）：
//   notifications —— 匹配成功的系统通知（GlobalMatchFoundNotification）
//   media —— 直播间语音上麦（@volcengine/rtc 的 getUserMedia）
//   screen-wake-lock —— 排队 / 接受阶段防休眠（QueueWakeLock）
//   clipboard-* —— 复制房间链接、喊话文本等
// 其余（定位、MIDI、USB、屏幕共享…）网站用不到，一律拒绝。
const TRUSTED_PERMISSIONS = new Set([
    'notifications',
    'media',
    'screen-wake-lock',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'pointerLock',
    'keyboardLock',
    'speaker-selection',
]);

// 第三方页面（Discord / Steam 登录、收银台、人脸核身…）只给无害的几项
const THIRD_PARTY_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

// 页面跳外部协议时（Chromium 走 openExternal 权限）只放行这些：
// steam:// 是服务器列表 / 对局页的「连接服务器」按钮（SteamConnectButtons、CsgoServersPage）。
// ms-msdt: / search-ms: 这类系统协议历来是 Electron 应用的 RCE 入口，绝不能整体放开。
const EXTERNAL_PROTOCOLS = new Set(['steam:', 'mailto:']);

function allowExternal(requestingUrl, externalUrl) {
    if (!sites.isTrusted(requestingUrl)) return false;
    try {
        return EXTERNAL_PROTOCOLS.has(new URL(externalUrl).protocol);
    } catch {
        return false;
    }
}

function installSessionPolicy(ses) {
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
        const requestingUrl = details.requestingUrl ?? contents?.getURL() ?? '';
        let granted;
        if (permission === 'openExternal') {
            granted = allowExternal(requestingUrl, details.externalURL);
        } else if (sites.isTrusted(requestingUrl)) {
            granted = TRUSTED_PERMISSIONS.has(permission);
        } else {
            granted = THIRD_PARTY_PERMISSIONS.has(permission);
        }
        if (!granted) log.info(`[permission] denied ${permission} for ${requestingUrl}`);
        callback(granted);
    });

    // 同步查询（Notification.permission、navigator.permissions.query）。自家页面直接报 granted，
    // 这样网站不会再弹「请允许通知」的引导 —— 桌面端通知由 Windows 系统设置统一管。
    ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
        if (sites.isTrusted(requestingOrigin)) return TRUSTED_PERMISSIONS.has(permission);
        return THIRD_PARTY_PERMISSIONS.has(permission);
    });
}

/**
 * 每个 webContents（主窗口、自家页面开的新窗口）都挂一遍：
 * - target=_blank / window.open：自家页面 → 客户端里开新窗口（同一会话，登录态共享）；
 *   外站 → 交给系统浏览器（工单附件下载、Steam 个人资料、备案号链接…）。
 * - 同窗跳转一律放行：Discord / Steam 登录、充值收银台、实名认证都是「同窗跳出去 → 回跳 origin」，
 *   拦了这些流程就断了。外站页面上菜单栏会显示出来，可以 Alt+← / 「导航 → 首页」回来。
 */
function installContentsPolicy(contents, { newWindowOptions, reload }) {
    contents.setWindowOpenHandler(({ url }) => {
        if (sites.isTrusted(url)) {
            return { action: 'allow', overrideBrowserWindowOptions: newWindowOptions() };
        }
        const external = sites.parseHttpUrl(url);
        if (external) {
            void shell.openExternal(external.href);
        } else {
            log.info(`[window-open] blocked ${url}`);
        }
        return { action: 'deny' };
    });

    contents.on('will-attach-webview', (event) => event.preventDefault());

    contents.on('context-menu', (_event, params) => {
        Menu.buildFromTemplate(contextMenuTemplate(contents, params, reload)).popup();
    });
}

// Electron 默认没有右键菜单：聊天框里粘贴、复制分享链接都离不开它
function contextMenuTemplate(contents, params, reload) {
    const groups = [];

    const link = sites.parseHttpUrl(params.linkURL);
    if (link) {
        groups.push([
            { label: t('openLinkInBrowser'), click: () => void shell.openExternal(link.href) },
            { label: t('copyLink'), click: () => clipboard.writeText(link.href) },
        ]);
    }

    if (params.mediaType === 'image' && params.srcURL) {
        const group = [{ label: t('copyImage'), click: () => contents.copyImageAt(params.x, params.y) }];
        if (sites.parseHttpUrl(params.srcURL)) {
            group.push({ label: t('copyImageUrl'), click: () => clipboard.writeText(params.srcURL) });
        }
        groups.push(group);
    }

    if (params.isEditable) {
        const f = params.editFlags;
        groups.push(
            [
                { label: t('undo'), enabled: f.canUndo, click: () => contents.undo() },
                { label: t('redo'), enabled: f.canRedo, click: () => contents.redo() },
            ],
            [
                { label: t('cut'), enabled: f.canCut, click: () => contents.cut() },
                { label: t('copy'), enabled: f.canCopy, click: () => contents.copy() },
                { label: t('paste'), enabled: f.canPaste, click: () => contents.paste() },
            ],
            [{ label: t('selectAll'), enabled: f.canSelectAll, click: () => contents.selectAll() }],
        );
    } else if (params.selectionText.trim()) {
        groups.push([{ label: t('copy'), click: () => contents.copy() }]);
    }

    if (groups.length === 0) {
        const history = contents.navigationHistory;
        groups.push([
            { label: t('back'), enabled: history.canGoBack(), click: () => history.goBack() },
            { label: t('forward'), enabled: history.canGoForward(), click: () => history.goForward() },
            { label: t('reload'), click: () => reload(contents) },
        ]);
    }

    return groups.flatMap((group, i) => (i === 0 ? group : [{ type: 'separator' }, ...group]));
}

module.exports = { installSessionPolicy, installContentsPolicy };
