'use strict';

const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('./log');
const { t } = require('./i18n');

// 两层更新：
//   1. 网页内容 —— 每次启动 / 刷新都从线上加载，网站发版即生效；页面上的新版本提示（useVersionCheck）照常工作。
//   2. 客户端外壳（本仓库）—— electron-updater 从 GitHub Releases（electron-builder.yml 的 publish）
//      后台静默下载差分包，下好后提示重启；不重启的话下次退出时自动安装。
const FIRST_CHECK_DELAY = 10 * 1000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

let getWindow = () => null;
let downloadedVersion = null;
let promptedVersion = null;

function init(windowGetter) {
    getWindow = windowGetter;
    if (!app.isPackaged) return; // 未打包时没有 app-update.yml，检查必然失败

    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableWebInstaller = true; // 只出完整 NSIS 包（配 blockmap 差分），不用 web installer

    autoUpdater.on('update-downloaded', (info) => {
        downloadedVersion = info.version;
        if (promptedVersion === info.version) return; // 同一版本只主动提示一次
        promptedVersion = info.version;
        void promptRestart(info.version);
    });
    autoUpdater.on('error', (err) => log.error('[updater]', err?.stack ?? err));

    setTimeout(checkQuietly, FIRST_CHECK_DELAY);
    setInterval(checkQuietly, CHECK_INTERVAL);
}

function checkQuietly() {
    // 后台检查失败（断网、GitHub 访问不畅）不打扰用户，只记日志，下个周期再试
    autoUpdater.checkForUpdates().catch((err) => log.warn('[updater] check failed:', err?.message ?? err));
}

function showMessage(options) {
    const win = getWindow();
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

async function promptRestart(version) {
    const { response } = await showMessage({
        type: 'info',
        title: t('updateReadyTitle'),
        message: t('updateReadyMessage', { version }),
        detail: t('updateReadyDetail'),
        buttons: [t('restartNow'), t('later')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
    });
    // isSilent=true：NSIS 静默安装不弹向导；isForceRunAfter=true：装完自动重新打开
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

/** 菜单「检查更新…」：和后台检查同一条路，但结果都要给个交代。 */
async function checkManually() {
    if (!app.isPackaged) {
        await showMessage({ type: 'info', message: t('updateDevMode'), buttons: [t('ok')], noLink: true });
        return;
    }
    if (downloadedVersion) {
        await promptRestart(downloadedVersion);
        return;
    }
    try {
        const result = await autoUpdater.checkForUpdates();
        if (result?.isUpdateAvailable) {
            await showMessage({
                type: 'info',
                message: t('updateFound', { version: result.updateInfo.version }),
                detail: t('updateFoundDetail'),
                buttons: [t('ok')],
                noLink: true,
            });
        } else {
            await showMessage({
                type: 'info',
                message: t('upToDate'),
                detail: t('upToDateDetail', { version: app.getVersion() }),
                buttons: [t('ok')],
                noLink: true,
            });
        }
    } catch (err) {
        log.warn('[updater] manual check failed:', err?.message ?? err);
        await showMessage({
            type: 'warning',
            message: t('updateError'),
            detail: String(err?.message ?? err).split('\n')[0],
            buttons: [t('ok')],
            noLink: true,
        });
    }
}

module.exports = { init, checkManually };
