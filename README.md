# MMHvH 桌面客户端（Windows）

**下载 / Download：** [MMHvH-Setup.exe](https://github.com/mmhvh/desktop-releases/releases/latest/download/MMHvH-Setup.exe)
（Windows 10 / 11 x64，安装后自动更新 · installs per-user and updates itself）

---

Electron 外壳：窗口里直接加载线上的 **mmhvh.com / mmhvh.cn**，不打包任何前端代码（网站源码在私有仓库 `mmhvh/frontend`）。

## 两层更新

| 层 | 怎么更新 | 什么时候生效 |
|----|----------|--------------|
| 网页内容（`mmhvh/frontend`） | 照常发网站（`master` → OSS / Cloudflare） | 立即。客户端每次启动 / 刷新都从线上加载，页面里的新版本提示（`useVersionCheck`）照常弹 |
| 客户端外壳（本仓库） | 改 `package.json` 版本号推到 `main` → CI 发布到本仓库 Releases | 已安装的客户端后台静默下载差分包（通常 1MB 左右），下完提示「立即重启」；选稍后则下次退出时自动安装 |

绝大多数改动只动网站，不需要发客户端。只有改了本仓库（窗口行为、权限、菜单、Electron 版本…）才需要发版。

## 目录

```
src/main.js        入口：单实例、窗口、菜单、断网页 / 崩溃恢复、标题
src/sites.js       站点与「自家页面」判定（mmhvh.com / mmhvh.cn / dev，MMHVH_URL 覆盖）
src/policy.js      权限（通知 / 麦克风 / 防休眠…）、新窗口、外部协议（只放行 steam: / mailto:）、右键菜单
src/updater.js     electron-updater：启动 10 秒后检查，之后每 4 小时一次
src/preload.js     让网页的 window.focus() 真能把窗口叫到前台（点「匹配成功」通知回到客户端）
src/offline.html   主框架加载失败时的断网页（自动重试，可切换到另一个站点）
src/settings.js    壳的偏好：上次站点、窗口位置（%APPDATA%\MMHvH\settings.json）
src/log.js         主进程日志：%APPDATA%\MMHvH\logs\main.log（菜单「打开日志文件夹」）
electron-builder.yml  NSIS 安装包 + 发布配置
```

## 开发

```bash
npm ci
npm start                                  # 加载线上站点
MMHVH_URL=http://localhost:8080 npm start  # 加载本地 vite（先在 frontend 仓库 npm run dev）
npm run dist                               # 本地出安装包 → release/MMHvH-Setup.exe（不发布）
```

开发模式下不检查更新（没有 `app-update.yml`）。

## 发版

改 `package.json` 的 `version`（如 `1.0.1`），提交并推到 `main`，就完了。

`.github/workflows/release.yml` 发现还没有 `v1.0.1` Release，就在 `windows-latest` 上出包、在当前提交上建 `v1.0.1`
标签和 Release，上传 `MMHvH-Setup.exe`、`MMHvH-Setup.exe.blockmap`、`latest.yml`。已安装的客户端几小时内会自己更新。
版本号没变的推送（改文档等）CI 会直接跳过。用的是 Actions 自带的 `GITHUB_TOKEN`，不需要配置任何 secret。

也可以手动运行（Actions → Release → Run workflow）：逻辑相同，另外安装包会传到运行结果的 Artifacts 里。

固定下载链接（网站「下载客户端」按钮可以直接用，永远指向最新版）：
`https://github.com/mmhvh/desktop-releases/releases/latest/download/MMHvH-Setup.exe`

## 已知限制 / 后续

- **未做代码签名**：首次安装时 Windows SmartScreen 会提示「已保护你的电脑」，需点「更多信息 → 仍要运行」。
  买到证书后把 `CSC_LINK`（base64 的 .pfx）和 `CSC_KEY_PASSWORD` 存成仓库 secret、在 workflow 的 Build 步骤里作为环境变量传入即可，
  electron-builder 会自动签名。
- **国内下载**：更新包走 GitHub Releases，国内网络下可能较慢；后台下载失败只记日志，下个周期重试，不影响使用。
- 只出 Windows x64（ARM 设备走系统自带的 x64 模拟）。
- 安装目录是 `%LOCALAPPDATA%\Programs\mmhvh-desktop`（取自 package.json 的 `name`），卸载在「设置 → 应用」里。

## 行为说明

- **自家页面**（mmhvh.com / mmhvh.cn / dev.mmhvh.com）直接拿到通知、麦克风、防休眠、剪贴板权限，`Notification.permission` 为 `granted`；
  其余网站一律不给权限。
- **target=_blank / window.open**：自家页面 → 客户端里开新窗口（共享登录态）；外站 → 系统浏览器。
- **聊天窗口**：网站在客户端里把聊天弹成独立窗口（`window.open('/popout.html', 'mmhvh-chat')`，内容由主窗口渲染，
  共用主窗口那条 WS）。外壳按窗口名给它 420×720、贴主窗口所在屏幕右侧，之后记住位置大小（`settings.json` 的 `chatBounds`）。
  **主窗口一关整个客户端就退出**，免得聊天窗口变成没人画的空壳。
- **同窗跳转**全部放行：Discord / Steam 登录、充值收银台、实名认证都是「跳出去再回跳」。停在外站页面时菜单栏会显示出来，
  可用「导航 → 后退 / 首页」或鼠标侧键、Alt+← 回来。
- **外部协议**只放行 `steam:`（连接服务器按钮）和 `mailto:`。
- 首次启动按系统时区 / 语言选站点（中国大陆 → mmhvh.cn），之后记住上次停留的站点；菜单「MMHvH → 站点」可手动切换
  （两个站点登录态独立，切换后需要重新登录，与网页版一致）。
- UA 去掉了 `Electron/x` 标记、末尾追加 `MMHvHDesktop/<版本>`，后端 / PostHog 可据此识别桌面端。
- 快捷键：F5 / Ctrl+R 刷新，Ctrl+F5 / Ctrl+Shift+R 强制刷新，Alt+←/→ 后退前进，Alt+Home 首页，F11 全屏，
  Ctrl+Shift+I 开发者工具，按 Alt 显示菜单。
