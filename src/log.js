'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

// 主进程日志：%APPDATA%\MMHvH\logs\main.log，超过 1MB 轮转成 main.old.log。
// 主要给自动更新排障用（electron-updater 的 logger 也接到这里）。
const dir = path.join(app.getPath('userData'), 'logs');
const file = path.join(dir, 'main.log');
const MAX_BYTES = 1024 * 1024;

try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.statSync(file, { throwIfNoEntry: false })?.size > MAX_BYTES) {
        fs.renameSync(file, path.join(dir, 'main.old.log'));
    }
} catch {
    // 日志目录不可写时只打控制台
}

function write(level, args) {
    const line = `[${new Date().toISOString()}] [${level}] ${util.format(...args)}\n`;
    if (!app.isPackaged) process.stdout.write(line);
    try {
        fs.appendFileSync(file, line);
    } catch {
        // ignore
    }
}

module.exports = {
    file,
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
};
