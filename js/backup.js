/* ==========================================================================
   Habit Spark - backup.js
   数据备份：一键导出当前系统数据为 JSON 文件；导入 JSON 备份文件时做结构
   校验，校验通过后交由调用方（ui.js）弹出二次确认，确认后整体覆盖重载。
   依赖 config.js / data.js（须先加载）。
   本文件只负责数据层面的读写，不直接操作按钮/弹窗 DOM——
   UI 绑定统一放在 ui.js / app.js 中，保持解耦。
   ========================================================================== */

(function (global) {
  'use strict';

  var DataStore = global.DataStore;

  if (!DataStore) {
    console.error('[Backup] 未检测到 DataStore，请确认 data.js 已先于 backup.js 加载');
  }

  /* ------------------------------------------------------------------ *
   * 文件名生成：habit_spark_backup_YYYYMMDD_HHmmss.json
   * ------------------------------------------------------------------ */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function buildBackupFilename() {
    var d = new Date();
    var y = d.getFullYear();
    var m = pad2(d.getMonth() + 1);
    var day = pad2(d.getDate());
    var hh = pad2(d.getHours());
    var mm = pad2(d.getMinutes());
    var ss = pad2(d.getSeconds());
    return 'habit_spark_backup_' + y + m + day + '_' + hh + mm + ss + '.json';
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  /**
   * 将当前系统数据（任务列表、完成记录、连胜状态、资源余额、设置选项等）
   * 导出为 JSON 文件，触发浏览器下载。
   * @returns {{success: boolean, filename?: string, message?: string}}
   */
  function exportData() {
    if (!DataStore) {
      return { success: false, message: '数据模块未就绪' };
    }

    var state = DataStore.getState();
    var json;
    try {
      json = JSON.stringify(state, null, 2);
    } catch (e) {
      console.error('[Backup] 导出序列化失败', e);
      return { success: false, message: '导出失败：数据序列化出错' };
    }

    var filename = buildBackupFilename();

    try {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // 延迟释放，避免个别浏览器在下载尚未触发时提前回收 URL
      global.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (e) {
      console.error('[Backup] 触发文件下载失败', e);
      return { success: false, message: '导出失败：无法触发文件下载' };
    }

    return { success: true, filename: filename };
  }

  /* ------------------------------------------------------------------ *
   * 导入：解析 + 结构校验（不直接落库，交由 applyImport 二次确认后执行）
   * ------------------------------------------------------------------ */

  /**
   * 读取并解析用户选择的 JSON 备份文件，同时做结构校验。
   * 只解析和校验，不修改任何已保存的数据；结构非法时返回错误信息列表。
   * @param {File} file
   * @returns {Promise<{ok: boolean, data?: object, errors?: string[]}>}
   */
  function parseImportFile(file) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve({ ok: false, errors: ['未选择文件'] });
        return;
      }

      if (!DataStore) {
        resolve({ ok: false, errors: ['数据模块未就绪'] });
        return;
      }

      var reader = new FileReader();

      reader.onload = function () {
        var parsed;
        try {
          parsed = JSON.parse(String(reader.result));
        } catch (e) {
          resolve({ ok: false, errors: ['文件不是有效的 JSON 格式'] });
          return;
        }

        var check = DataStore.validateStructure(parsed);
        if (!check.valid) {
          resolve({ ok: false, errors: check.errors });
          return;
        }

        resolve({ ok: true, data: parsed });
      };

      reader.onerror = function () {
        resolve({ ok: false, errors: ['文件读取失败'] });
      };

      reader.readAsText(file);
    });
  }

  /**
   * 用校验通过的备份数据整体覆盖当前系统数据（自动补全字段/迁移版本），
   * 并派发 'habitspark:dataImported' 事件，供 ui.js / app.js 监听后
   * 重新渲染界面，无需手动刷新页面。
   * 调用前应已由 UI 层完成"导入将覆盖当前所有进度"的二次确认。
   * @param {object} data 已通过 validateStructure 校验的数据
   * @returns {object} 覆盖后的最新状态
   */
  function applyImport(data) {
    var newState = DataStore.replaceState(data);

    try {
      document.dispatchEvent(new CustomEvent('habitspark:dataImported', {
        detail: { state: newState }
      }));
    } catch (e) {
      console.error('[Backup] 派发导入完成事件失败', e);
    }

    return newState;
  }

  /**
   * 一步式导入便捷方法：解析校验 + 通过回调询问用户确认 + 应用。
   * confirmFn 接收 (data) 并需返回 boolean 或 Promise<boolean>，
   * 用于接入 ui.js 中的通用确认弹窗 (#modalOverlay)。
   * @param {File} file
   * @param {(data: object) => (boolean|Promise<boolean>)} confirmFn
   * @returns {Promise<{success: boolean, cancelled?: boolean, errors?: string[]}>}
   */
  function importFromFile(file, confirmFn) {
    return parseImportFile(file).then(function (result) {
      if (!result.ok) {
        return { success: false, errors: result.errors };
      }

      var confirmResult = typeof confirmFn === 'function'
        ? confirmFn(result.data)
        : true;

      return Promise.resolve(confirmResult).then(function (confirmed) {
        if (!confirmed) {
          return { success: false, cancelled: true };
        }
        applyImport(result.data);
        return { success: true };
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 导出模块
   * ------------------------------------------------------------------ */

  global.BackupManager = {
    exportData: exportData,
    parseImportFile: parseImportFile,
    applyImport: applyImport,
    importFromFile: importFromFile,
    buildBackupFilename: buildBackupFilename
  };

}(typeof window !== 'undefined' ? window : this));
