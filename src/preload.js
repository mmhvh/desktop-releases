'use strict';

// 预加载脚本（沙箱）。只做一件事：让网页里的 window.focus() 真的能把客户端窗口叫到前台。
//
// 点「匹配成功」系统通知时网站执行 onClick: () => window.focus()（GlobalMatchFoundNotification）。
// Chrome 会把对应窗口切到前台，Electron 不做这一步（实测窗口原地不动、也不发任何事件），
// 玩家在游戏里点了通知却回不到客户端。这里在页面世界给 window.focus 套一层：原函数照常调用，
// 同时让主进程把窗口拉到前台（主进程只认自家页面发来的请求）。网站代码不用改。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.executeInMainWorld({
    func: (requestFocus) => {
        const nativeFocus = window.focus;
        window.focus = function focus() {
            requestFocus();
            return nativeFocus.call(this);
        };
    },
    args: [() => ipcRenderer.send('mmhvh:focus-window')],
});
