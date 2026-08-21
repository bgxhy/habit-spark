/* ==========================================================================
   Habit Spark - data.js
   LocalStorage 持久化层：默认数据结构、版本迁移、读写与合并保护。
   依赖 config.js（须先加载）。其余业务文件通过 DataStore 读写数据，
   禁止直接操作 localStorage。
   ========================================================================== */

(function (global) {
  'use strict';

  var CONFIG = global.CONFIG || {};
  var DATA_VERSION = 1;
  var STORAGE_KEY = (CONFIG.storage && CONFIG.storage.key) || 'habit_spark_data';

  /* ------------------------------------------------------------------ *
   * 日期工具（本地时区，格式 YYYY-MM-DD，供 tasks.js / streak.js 复用）
   * ------------------------------------------------------------------ */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function formatDateKey(date) {
    var d = date instanceof Date ? date : new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayKey() {
    return formatDateKey(new Date());
  }

  /* ------------------------------------------------------------------ *
   * 默认数据结构
   * ------------------------------------------------------------------ */

  /**
   * 返回一份全新的默认数据（深拷贝安全，每次调用返回独立对象）。
   * @returns {object}
   */
  function createDefaultData() {
    var now = new Date();
    return {
      // ---- 元信息：版本迁移与访问追踪 ----
      meta: {
        dataVersion: DATA_VERSION,
        createdAt: formatDateKey(now),
        lastOpenedDate: formatDateKey(now),
        lastSavedAt: null
      },

      // ---- 资源余额 ----
      resources: {
        primaryResource: 0,
        currency: 0,
        streakFreeze: 0
      },

      // ---- 任务列表 ----
      // 每个任务：{ id, name, type, baseResourceReward, currencyReward,
      //            targetCount, enabled, startDate, endDate, createdAt,
      //            completions: { 'YYYY-MM-DD': count } }
      // completions 为原始打卡记录：once 任务只会有一条记录即视为永久完成；
      // daily 任务每天最多 1 条；weekly/monthly 由 streak.js/tasks.js
      // 按自然周/月对 completions 求和判断是否达到 targetCount。
      tasks: [],

      // ---- 连胜与保护卡状态（见需求文档第六节） ----
      streak: {
        current: 0,
        longest: 0,
        // 漏打检测游标：上一次逐日检查已处理到的日期，隔天登录时
        // 从该日期之后开始逐日补算，避免重复处理
        lastCheckedDate: formatDateKey(now),
        // 达标日期集合，用于统计、补救横幅与漏打检测：{ 'YYYY-MM-DD': true }
        activeDates: {}
      },

      // ---- 保护卡使用记录（自动/主动），供统计页展示 ----
      // { date: 'YYYY-MM-DD', type: 'auto' | 'manual', note }
      freezeLog: [],

      // ---- 兑换记录（见需求文档第七节） ----
      // { date: 'YYYY-MM-DD', fromAmount, toAmount }
      exchangeLog: [],

      // ---- 累计统计（见需求文档第九节） ----
      stats: {
        totalTasksCompleted: 0,
        totalPrimaryEarned: 0,
        totalCurrencyEarned: 0
      },

      // ---- 每日免费礼包 ----
      dailyGift: {
        lastClaimedDate: null
      },

      // ---- 设置 ----
      settings: {
        reminder: {
          enabled: false,
          webhookUrl: '',
          time: '22:30',
          // 记录当天是否已成功发送过提醒，防止重复推送
          lastNotificationSentDate: null
        },
        theme: 'default'
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * 数据合并（防御性补全缺失字段，数组按整体覆盖而非逐项合并）
   * ------------------------------------------------------------------ */

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function deepMerge(base, override) {
    if (!isPlainObject(base)) {
      return override !== undefined ? override : base;
    }
    var result = {};
    var mergedKeys = Object.keys(base);
Object.keys(override || {}).forEach(function (k) {
  if (mergedKeys.indexOf(k) === -1) mergedKeys.push(k);
});
mergedKeys.forEach(function (key) {
      var baseVal = base[key];
      var hasOverride = override && Object.prototype.hasOwnProperty.call(override, key);
      var overrideVal = hasOverride ? override[key] : undefined;
      if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
        result[key] = deepMerge(baseVal, overrideVal);
      } else if (hasOverride) {
        result[key] = overrideVal;
      } else {
        result[key] = baseVal;
      }
    });
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 版本迁移
   * ------------------------------------------------------------------ */

  // 迁移步骤表：key 为迁移的起始版本号，value 为将该版本数据升级到
  // "起始版本 + 1" 的转换函数。当前 DATA_VERSION = 1，为基线版本，暂无
  // 需要执行的迁移步骤；未来新增字段/结构调整时，在此追加对应版本的
  // 迁移函数即可，例如：
  //   migrations[1] = function (data) { /* 1 -> 2 的调整 */ return data; };
  var migrations = {};

  /**
   * 将任意来源的原始数据（可能来自旧版本、手工编辑或导入文件）迁移/补全为
   * 当前 DATA_VERSION 结构。缺失字段自动补默认值，不会因结构不完整而崩溃。
   * @param {object|null} raw
   * @returns {object}
   */
  function migrateData(raw) {
    var defaults = createDefaultData();
    var data = deepMerge(defaults, isPlainObject(raw) ? raw : {});

    var fromVersion = (raw && raw.meta && typeof raw.meta.dataVersion === 'number')
      ? raw.meta.dataVersion
      : 0;

    var version = fromVersion;
    while (version < DATA_VERSION) {
      var step = migrations[version];
      if (typeof step === 'function') {
        data = step(data);
      }
      version += 1;
    }

    data.meta.dataVersion = DATA_VERSION;
    return data;
  }

  /* ------------------------------------------------------------------ *
   * 结构校验（供导入功能与自检使用）
   * ------------------------------------------------------------------ */

  /**
   * 校验数据是否包含必要的结构字段与 version 版本标识。
   * @param {*} data
   * @returns {{valid: boolean, errors: string[]}}
   */
  function validateStructure(data) {
    var errors = [];

    if (!isPlainObject(data)) {
      errors.push('数据不是有效的 JSON 对象');
      return { valid: false, errors: errors };
    }

    if (!isPlainObject(data.meta) || typeof data.meta.dataVersion !== 'number') {
      errors.push('缺少 meta.dataVersion 版本标识');
    }

    ['resources', 'tasks', 'streak', 'settings'].forEach(function (key) {
      if (!(key in data)) {
        errors.push('缺少必要字段: ' + key);
      }
    });

    if ('tasks' in data && !Array.isArray(data.tasks)) {
      errors.push('tasks 字段格式错误，应为数组');
    }

    if ('resources' in data && !isPlainObject(data.resources)) {
      errors.push('resources 字段格式错误，应为对象');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  /* ------------------------------------------------------------------ *
   * LocalStorage 安全读写
   * ------------------------------------------------------------------ */

  function safeGetItem(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      console.error('[DataStore] localStorage 读取失败', e);
      return null;
    }
  }

  function safeSetItem(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.error('[DataStore] localStorage 写入失败（可能是隐私模式或空间不足）', e);
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * 内存态 + 持久化 API
   * ------------------------------------------------------------------ */

  var _state = null;

  function persist() {
    if (!_state) return false;
    _state.meta.lastSavedAt = new Date().toISOString();
    var json;
    try {
      json = JSON.stringify(_state);
    } catch (e) {
      console.error('[DataStore] 数据序列化失败', e);
      return false;
    }
    return safeSetItem(STORAGE_KEY, json);
  }

  /**
   * 从 localStorage 加载数据到内存，自动迁移/补全结构。
   * 未初始化过（首次使用）时返回全新默认数据并立即落盘。
   * @returns {object}
   */
  function load() {
    var raw = safeGetItem(STORAGE_KEY);
    var parsed = null;

    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.error('[DataStore] 数据解析失败，已回退为默认数据', e);
        parsed = null;
      }
    }

    _state = migrateData(parsed);
    _state.meta.lastOpenedDate = todayKey();
    persist();
    return _state;
  }

  /**
   * 获取当前内存态数据，若尚未加载则先从 localStorage 加载。
   * @returns {object}
   */
  function getState() {
    if (!_state) {
      load();
    }
    return _state;
  }

  /**
   * 以可变方式修改状态并自动持久化。
   * mutator 直接修改传入的 state 对象（就地修改），返回值会被忽略。
   * @param {(state: object) => void} mutator
   * @returns {object} 修改后的最新状态
   */
  function mutate(mutator) {
    var state = getState();
    mutator(state);
    persist();
    return state;
  }

  /**
   * 用一份全新数据整体替换当前状态（用于导入备份 / 恢复出厂）。
   * 默认会先执行结构迁移与字段补全，除非显式跳过。
   * @param {object} newData
   * @param {{skipMigration?: boolean}} [options]
   * @returns {object}
   */
  function replaceState(newData, options) {
    options = options || {};
    _state = options.skipMigration ? newData : migrateData(newData);
    persist();
    return _state;
  }

  /**
   * 恢复出厂设置：清空为全新默认数据。
   * @returns {object}
   */
  function resetToDefault() {
    _state = createDefaultData();
    persist();
    return _state;
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  global.DataStore = {
    DATA_VERSION: DATA_VERSION,
    STORAGE_KEY: STORAGE_KEY,

    // 数据结构 & 迁移
    createDefaultData: createDefaultData,
    migrateData: migrateData,
    validateStructure: validateStructure,

    // 读写 API
    load: load,
    save: persist,
    getState: getState,
    mutate: mutate,
    replaceState: replaceState,
    reset: resetToDefault,

    // 日期工具（统一日期键格式，供其余模块复用）
    formatDateKey: formatDateKey,
    todayKey: todayKey
  };

}(typeof window !== 'undefined' ? window : this));
