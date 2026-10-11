'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, screen, session, shell } = require('electron');
const path = require('node:path');

const APP_NAME = 'MMHvH';
// 网站的独立聊天窗口（前端 hooks/usePopoutWindow，Social.tsx 里 window.open 的窗口名）
const CHAT_WINDOW = 'mmhvh-chat';
// 与 electron-builder.yml 的 appId 一致：NSIS 建的开始菜单快捷方式带的就是这个 AppUserModelID，
// 对不上的话 Windows 不显示网页发出的系统通知。
const APP_ID = 'com.mmhvh.desktop';

// 同一时间只跑一个客户端：再双击图标就把已有窗口叫到前台（两个实例会抢同一个账号的 WS 连接）
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    start();
}

function start() {
    const settings = require('./settings');
    const sites = require('./sites');
    const policy = require('./policy');
    const updater = require('./updater');
    const log = require('./log');
    const { t } = require('./i18n');

    const OFFLINE_PAGE = path.join(__dirname, 'offline.html');
    const ICON = path.join(__dirname, '..', 'build', 'icon.png');
    const BACKGROUND = () => (nativeTheme.shouldUseDarkColors ? '#0e0e0e' : '#ffffff'); // 与网站 body 底色一致，避免白闪

    /** @type {BrowserWindow | null} */
    let mainWindow = null;
    // 断网页显示期间记住原本要去的地址：刷新 / 首页 / 在浏览器中打开都以它为准
    const failedUrls = new WeakMap();

    // 主进程未捕获的异常记进日志（打包后没有控制台，不记就无从排查）
    process.on('uncaughtException', (err) => log.error('[main] uncaught', err?.stack ?? err));
    process.on('unhandledRejection', (err) => log.error('[main] unhandled rejection', err?.stack ?? err));

    app.setAppUserModelId(APP_ID);

    // 去掉默认 UA 里的 "Electron/x" 和 "<应用名>/<版本>"：有的第三方登录 / 支付页会拦「嵌入式浏览器」。
    // 末尾加上 MMHvHDesktop/<版本>，网站和后端（PostHog、日志）可以据此区分桌面端。
    app.userAgentFallback = `${app.userAgentFallback
        .replace(/ Electron\/\S+/, '')
        .replace(/ [^\s/]+\/\S+(?= Chrome\/)/, '')} MMHvHDesktop/${app.getVersion()}`;

    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });

    app.on('window-all-closed', () => app.quit());
    app.on('before-quit', () => settings.flush());

    // preload.js 里包过的 window.focus()：点系统通知回到客户端
    ipcMain.on('mmhvh:focus-window', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || !sites.isTrusted(event.senderFrame?.url)) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    });

    app.whenReady().then(() => {
        log.info(`[app] ${APP_NAME} ${app.getVersion()} started, args=${JSON.stringify(process.argv.slice(1))}, ua=${app.userAgentFallback}`);
        policy.installSessionPolicy(session.defaultSession);
        mainWindow = createMainWindow();
        rebuildMenu();
        updater.init(() => mainWindow);
    });

    // ---------------------------------------------------------------- 窗口

    function baseWindowOptions() {
        return {
            minWidth: 1024,
            minHeight: 640,
            backgroundColor: BACKGROUND(),
            autoHideMenuBar: true, // 按 Alt 显示菜单
            icon: ICON,
            title: APP_NAME,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
                spellcheck: false,
            },
        };
    }

    function createMainWindow() {
        const bounds = restoreBounds();
        const win = new BrowserWindow({ ...baseWindowOptions(), ...bounds, show: false });
        if (settings.get('maximized')) win.maximize();

        // 首帧画好再显示；国内网络慢时 ready-to-show 可能要好几秒，1.5s 兜底先把窗口亮出来，免得以为没启动
        const reveal = () => {
            if (!win.isDestroyed() && !win.isVisible()) win.show();
        };
        win.once('ready-to-show', reveal);
        setTimeout(reveal, 1500);

        const saveBounds = () => {
            if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
            settings.set('maximized', win.isMaximized());
            settings.set('bounds', win.getNormalBounds()); // 最大化时取的是还原后的尺寸
        };
        win.on('resize', saveBounds);
        win.on('move', saveBounds);
        win.on('close', saveBounds);
        // 主窗口关了就整个退出：网站的聊天窗口内容是主窗口画的（共用主窗口的 React 树和 WS），留着只剩空壳
        win.on('closed', () => {
            mainWindow = null;
            app.quit();
        });

        setupWindow(win);
        win.webContents.on('did-navigate', (_event, url) => {
            const site = sites.siteByUrl(url);
            if (site && site.id !== settings.get('lastSite')) {
                settings.set('lastSite', site.id);
                rebuildMenu();
            }
        });

        open(win.webContents, sites.startUrl(settings.get('lastSite'), app.getSystemLocale()));
        return win;
    }

    // 保存的窗口位置还在某块屏幕上（显示器拔了 / 分辨率变了的话就不用它）
    function onSomeDisplay(b) {
        return !!b && screen.getAllDisplays().some(({ workArea: a }) =>
            b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 &&
            b.y < a.y + a.height - 50 && b.y + b.height > a.y + 50);
    }

    function restoreBounds() {
        const saved = settings.get('bounds');
        if (onSomeDisplay(saved)) return saved;
        // 首次启动或显示器变了：按主屏工作区居中
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        return { width: Math.min(1400, width), height: Math.min(900, height) };
    }

    // 聊天窗口：记住上次的位置大小；第一次开就贴在主窗口所在屏幕的右侧
    function chatWindowBounds() {
        const saved = settings.get('chatBounds');
        if (onSomeDisplay(saved)) return saved;
        const near = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
        const a = near.workArea;
        const width = Math.min(420, a.width);
        const height = Math.min(720, a.height);
        return { width, height, x: a.x + a.width - width - 24, y: a.y + Math.round((a.height - height) / 2) };
    }

    /** 主窗口和自家页面开出来的新窗口共用的行为。 */
    function setupWindow(win) {
        const contents = win.webContents;

        policy.installContentsPolicy(contents, { newWindowOptions: childWindowOptions, reload: reloadContents });
        contents.on('did-create-window', (child, { frameName }) => {
            setupWindow(child);
            if (frameName === CHAT_WINDOW) rememberChatBounds(child);
        });

        // 标题：网站的 " - HvH.gg Prime" 后缀换成客户端名；外站页面带上域名，让人知道自己在哪
        win.on('page-title-updated', (event, title) => {
            event.preventDefault();
            win.setTitle(windowTitle(contents.getURL(), title));
        });

        contents.on('did-navigate', (_event, url) => {
            const http = sites.parseHttpUrl(url) !== null;
            if (http) failedUrls.delete(contents);
            // 外站页面（登录 / 支付）上没有网站自己的导航，把菜单栏亮出来，「导航」里能后退 / 回首页
            const external = http && !sites.isTrusted(url);
            win.setAutoHideMenuBar(!external);
            win.setMenuBarVisibility(external);
        });

        // 断网 / DNS 失败 / 超时：换成本地的断网页，带上原地址以便重试（-3 = ERR_ABORTED，是被替换掉的导航，不算失败）。
        // 失败的是某个站点时，断网页再给一个「改用另一个站点」：国内连不上 .com 时可以一键切 .cn，反之亦然。
        contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
            if (!isMainFrame || code === -3 || !sites.parseHttpUrl(url)) return;
            log.warn(`[load] ${code} ${description} ${url}`);
            failedUrls.set(contents, url);
            const failedSite = sites.siteByUrl(url);
            const otherSite = failedSite && sites.SITES.find((s) => s.id !== failedSite.id);
            void contents.loadFile(OFFLINE_PAGE, {
                query: { url, code: String(code), desc: description, alt: otherSite ? sites.switchSiteUrl(url, otherSite) : '' },
            });
        });

        // 渲染进程崩了自动重载；一分钟内再崩就停手，免得死循环
        let lastCrash = 0;
        contents.on('render-process-gone', (_event, details) => {
            log.error(`[renderer] gone: ${details.reason} (${details.exitCode})`);
            if (details.reason === 'clean-exit' || Date.now() - lastCrash < 60_000) return;
            lastCrash = Date.now();
            reloadContents(contents);
        });

        // 鼠标侧键前进 / 后退
        win.on('app-command', (_event, command) => {
            const history = contents.navigationHistory;
            if (command === 'browser-backward' && history.canGoBack()) history.goBack();
            if (command === 'browser-forward' && history.canGoForward()) history.goForward();
        });

        // F5 / Ctrl+F5（菜单里挂的是 Ctrl+R / Ctrl+Shift+R，一个菜单项只能有一个快捷键）
        contents.on('before-input-event', (event, input) => {
            if (input.type !== 'keyDown' || input.key !== 'F5' || input.alt || input.meta) return;
            event.preventDefault();
            reloadContents(contents, input.control || input.shift);
        });
    }

    function childWindowOptions(frameName) {
        if (frameName === CHAT_WINDOW) {
            return { ...baseWindowOptions(), minWidth: 340, minHeight: 480, ...chatWindowBounds() };
        }
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        return { ...baseWindowOptions(), width: Math.min(1280, width), height: Math.min(860, height) };
    }

    function rememberChatBounds(win) {
        const save = () => {
            if (win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
            settings.set('chatBounds', win.getBounds());
        };
        win.on('resize', save);
        win.on('move', save);
        win.on('close', save);
    }

    function windowTitle(url, title) {
        const page = sites.parseHttpUrl(url);
        if (!page || sites.isTrusted(url)) return (title || APP_NAME).replaceAll('HvH.gg Prime', APP_NAME);
        return `${title && title !== page.href ? `${title} · ` : ''}${page.host} - ${APP_NAME}`;
    }

    // ---------------------------------------------------------------- 导航动作

    // loadURL 失败会 reject；失败统一由 did-fail-load 换成断网页处理，这里只把 rejection 吞掉
    function open(contents, url) {
        contents.loadURL(url).catch(() => {});
    }

    function focusedContents() {
        return (BrowserWindow.getFocusedWindow() ?? mainWindow)?.webContents ?? null;
    }

    /** 当前「真实」地址：断网页上指的是原本要去的那个地址。 */
    function currentUrl(contents) {
        return failedUrls.get(contents) ?? contents.getURL();
    }

    function reloadContents(contents, ignoreCache = false) {
        const failed = failedUrls.get(contents);
        if (failed) open(contents, failed);
        else if (ignoreCache) contents.reloadIgnoringCache();
        else contents.reload();
    }

    function goHome() {
        const contents = focusedContents();
        if (!contents) return;
        const site = sites.siteByUrl(currentUrl(contents)) ?? sites.siteById(settings.get('lastSite'));
        open(contents, site ? `${site.origin}/` : sites.startUrl(null, app.getSystemLocale()));
    }

    function switchSite(site) {
        settings.set('lastSite', site.id);
        rebuildMenu();
        const contents = mainWindow?.webContents;
        if (contents) open(contents, sites.switchSiteUrl(currentUrl(contents), site));
    }

    function openInBrowser() {
        const contents = focusedContents();
        const url = contents && sites.parseHttpUrl(currentUrl(contents));
        if (url) void shell.openExternal(url.href);
    }

    function showAbout() {
        const site = sites.siteById(settings.get('lastSite'));
        const options = {
            type: 'info',
            title: t('about'),
            message: `${APP_NAME} ${app.getVersion()}`,
            detail: t('aboutDetail', {
                version: app.getVersion(),
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                site: site ? new URL(site.origin).host : 'mmhvh.com',
            }),
            buttons: [t('ok')],
            noLink: true,
        };
        void (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
    }

    // ---------------------------------------------------------------- 菜单

    function rebuildMenu() {
        const lastSite = settings.get('lastSite');
        const withContents = (fn) => () => {
            const contents = focusedContents();
            if (contents) fn(contents);
        };

        Menu.setApplicationMenu(Menu.buildFromTemplate([
            {
                label: t('menuApp'),
                submenu: [
                    {
                        label: t('site'),
                        submenu: sites.SITES.map((site) => ({
                            label: t(site.id === 'cn' ? 'siteCn' : 'siteGlobal'),
                            type: 'radio',
                            checked: site.id === lastSite,
                            click: () => switchSite(site),
                        })),
                    },
                    { type: 'separator' },
                    { label: t('checkUpdates'), click: () => void updater.checkManually() },
                    { label: t('openInBrowser'), click: openInBrowser },
                    { label: t('openLogs'), click: () => void shell.openPath(path.dirname(log.file)) },
                    { type: 'separator' },
                    { label: t('about'), click: showAbout },
                    { type: 'separator' },
                    // 不挂 Ctrl+Q：排队中手滑一下就掉队了，退出走 Alt+F4 / 关窗口
                    { label: t('quit'), click: () => app.quit() },
                ],
            },
            {
                label: t('menuNavigate'),
                submenu: [
                    { label: t('back'), accelerator: 'Alt+Left', click: withContents((c) => c.navigationHistory.canGoBack() && c.navigationHistory.goBack()) },
                    { label: t('forward'), accelerator: 'Alt+Right', click: withContents((c) => c.navigationHistory.canGoForward() && c.navigationHistory.goForward()) },
                    { label: t('home'), accelerator: 'Alt+Home', click: goHome },
                    { type: 'separator' },
                    { label: t('reload'), accelerator: 'CmdOrCtrl+R', click: withContents((c) => reloadContents(c)) },
                    { label: t('forceReload'), accelerator: 'CmdOrCtrl+Shift+R', click: withContents((c) => reloadContents(c, true)) },
                ],
            },
            {
                label: t('menuEdit'),
                submenu: [
                    { label: t('undo'), role: 'undo' },
                    { label: t('redo'), role: 'redo' },
                    { type: 'separator' },
                    { label: t('cut'), role: 'cut' },
                    { label: t('copy'), role: 'copy' },
                    { label: t('paste'), role: 'paste' },
                    { label: t('selectAll'), role: 'selectAll' },
                ],
            },
            {
                label: t('menuView'),
                submenu: [
                    { label: t('zoomIn'), role: 'zoomIn' },
                    { label: t('zoomOut'), role: 'zoomOut' },
                    { label: t('resetZoom'), role: 'resetZoom' },
                    { type: 'separator' },
                    { label: t('fullscreen'), role: 'togglefullscreen' },
                    { label: t('devTools'), role: 'toggleDevTools' },
                ],
            },
        ]));
    }
}
