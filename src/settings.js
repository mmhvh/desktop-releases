'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 壳自己的少量偏好（上次的站点、窗口位置），存 %APPDATA%\MMHvH\settings.json。
// 网站自己的数据（登录态、主题、语言…）在 Chromium 的 localStorage 里，不经过这里。
const file = path.join(app.getPath('userData'), 'settings.json');

let data = {};
try {
    data = JSON.parse(fs.readFileSync(file, 'utf8')) ?? {};
} catch {
    data = {};
}

let timer = null;

function flush() {
    clearTimeout(timer);
    timer = null;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch {
        // 写不进去（磁盘满 / 权限）只是丢偏好，不影响使用
    }
}

function get(key) {
    return data[key];
}

function set(key, value) {
    data[key] = value;
    // 拖窗口时 resize / move 连发，攒 500ms 写一次；退出前 flush() 兜底
    clearTimeout(timer);
    timer = setTimeout(flush, 500);
}

module.exports = { get, set, flush };
