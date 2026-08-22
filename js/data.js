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
      tasks: [],

      // ---- 连胜与保护卡状态 ----
      streak: {
        current: 0,
        longest: 0,
        lastCheckedDate: formatDateKey(now),
        activeDates: {}
      },

      // ---- 保护卡使用记录 ----
      freezeLog: [],

      // ---- 兑换记录 ----
      exchangeLog: [],

      // ---- 累计统计 ----
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

  /**
   * 深层合并对象，用 override 中的字段覆盖/补充 base
   */
  function deepMerge(base, override) {
    if (!isPlainObject(base)) {
      return override !== undefined ? override : base;
    }
    
    var result = {};
    var baseKeys = Object.keys(base);
    var overrideKeys = isPlainObject(override) ? Object.keys(override) : [];
    
    // 搜集并去重所有 key
    var allKeys = baseKeys.slice();
    overrideKeys.forEach(function (k) {
      if (allKeys.indexOf(k) === -1) {
        allKeys.push(k);
      }
    });

    // 递归合并字段
    allKeys.forEach(function (key) {
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

  var migrations = {};

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
   * 结构校验
   * ------------------------------------------------------------------ */

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

  function getState() {
    if (!_state) {
      load();
    }
    return _state;
  }

    function mutate(mutator) {
    var state = getState();
    if (typeof mutator === 'function') {
      mutator(state);
    }
    persist();
    // 每次数据变化后，顺便（防抖）同步一份到云端，供云端定时任务读取。
    // SyncManager 是可选模块（sync.js 未加载/未配置时不影响本地功能）。
    if (global.SyncManager && typeof global.SyncManager.push === 'function') {
      global.SyncManager.push();
    }
    return state;
  }

  function replaceState(newData, options) {
    options = options || {};
    _state = options.skipMigration ? newData : migrateData(newData);
    persist();
    return _state;
  }

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

    createDefaultData: createDefaultData,
    migrateData: migrateData,
    validateStructure: validateStructure,

    load: load,
    save: persist,
    getState: getState,
    mutate: mutate,
    replaceState: replaceState,
    reset: resetToDefault,

    formatDateKey: formatDateKey,
    todayKey: todayKey
  };

}(typeof window !== 'undefined' ? window : this));