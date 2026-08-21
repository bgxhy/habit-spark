/* ==========================================================================
   Habit Spark - streak.js
   连胜与保护卡核心逻辑（见需求文档第六节）。
   依赖 config.js / data.js（须先加载）。tasks.js / rewards.js /
   backup.js 通过自定义事件（taskCompleted / taskRescued / dataImported）
   通知本文件重新计算连胜，本文件不反向依赖它们。

   设计要点：
   - streak.activeDates 是唯一真相来源（谁把某天标记为 true 不重要：
     可能来自当天真实打卡、漏打检测时消耗保护卡保护、或补救回填）。
   - current / longest 从不"就地累加"，而是每次都从 activeDates 完整
     重新扫描计算——这样"任务补救后连胜成功状态的追溯与恢复"不需要
     任何特殊分支：补救只是把某天标记为 true，之后调用一次重新计算，
     只要缺口被补上，连胜链会自动重新连通、自动恢复。
   ========================================================================== */

(function (global) {
  'use strict';

  var CONFIG = global.CONFIG || {};
  var DataStore = global.DataStore;

  if (!DataStore) {
    console.error('[Streak] 未检测到 DataStore，请确认 data.js 已先于 streak.js 加载');
  }

  /* ------------------------------------------------------------------ *
   * 日期工具
   * ------------------------------------------------------------------ */

  function parseDateKey(dateStr) {
    var parts = String(dateStr).split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function addDays(dateStr, days) {
    var d = parseDateKey(dateStr);
    d.setDate(d.getDate() + days);
    return DataStore.formatDateKey(d);
  }

  /* ------------------------------------------------------------------ *
   * 当日达标判断
   * ------------------------------------------------------------------ */

  /**
   * 判断今日连胜是否已达标（今日是否已有任意任务完成/被标记）。
   * notification.js 优先调用本方法判断是否需要发送提醒。
   * @returns {boolean}
   */
  function isTodayActive() {
    var state = DataStore.getState();
    var key = DataStore.todayKey();
    return !!(state.streak && state.streak.activeDates && state.streak.activeDates[key]);
  }

  /* ------------------------------------------------------------------ *
   * 连胜链重新计算（current / longest）
   * ------------------------------------------------------------------ */

  function computeLongestRun(activeMap) {
    var dates = Object.keys(activeMap || {})
      .filter(function (k) { return activeMap[k]; })
      .sort();
    if (dates.length === 0) return 0;

    var longest = 1;
    var run = 1;
    for (var i = 1; i < dates.length; i++) {
      if (addDays(dates[i - 1], 1) === dates[i]) {
        run += 1;
      } else {
        run = 1;
      }
      if (run > longest) longest = run;
    }
    return longest;
  }

  /**
   * 从今天（若今天已达标）或昨天（今天尚未达标，展示"未锁定"的既有连胜）
   * 开始，向历史方向扫描 activeDates，统计连续达标天数作为当前连胜。
   * @param {object} activeMap
   * @returns {number}
   */
  function computeCurrentRun(activeMap) {
    var todayKey = DataStore.todayKey();
    var cursor = activeMap[todayKey] ? todayKey : addDays(todayKey, -1);
    var current = 0;
    while (activeMap[cursor]) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
    return current;
  }

  /**
   * 重新计算并持久化 current / longest，同时处理"连续达标满 N 天自动
   * 获得保护卡"（受库存上限约束）。补救 / 漏打保护 / 正常打卡后均应
   * 调用本方法，用于追溯并恢复连胜的锁定状态。
   * @returns {{current:number, longest:number, streakFreeze:number}}
   */
  function recomputeCurrentAndLongest() {
    var state = DataStore.getState();
    var activeMap = state.streak.activeDates || {};
    var previousCurrent = state.streak.current || 0;

    var newCurrent = computeCurrentRun(activeMap);
    var newLongest = Math.max(state.streak.longest || 0, computeLongestRun(activeMap), newCurrent);

    var threshold = (CONFIG.streak && CONFIG.streak.freezeEarnThreshold) || 5;
    var cap = (CONFIG.streak && CONFIG.streak.freezeStockCap) || 2;
    var milestonesBefore = Math.floor(previousCurrent / threshold);
    var milestonesAfter = Math.floor(newCurrent / threshold);
    var newMilestones = Math.max(0, milestonesAfter - milestonesBefore);

    DataStore.mutate(function (s) {
      s.streak.current = newCurrent;
      s.streak.longest = newLongest;
      if (newMilestones > 0) {
        var space = cap - (s.resources.streakFreeze || 0);
        var granted = Math.max(0, Math.min(newMilestones, space));
        s.resources.streakFreeze = (s.resources.streakFreeze || 0) + granted;
      }
    });

    var finalState = DataStore.getState();
    return {
      current: finalState.streak.current,
      longest: finalState.streak.longest,
      streakFreeze: finalState.resources.streakFreeze
    };
  }

  /* ------------------------------------------------------------------ *
   * 漏打自动检测（隔天登录时逐日检查，见需求文档第六节第4点）
   * ------------------------------------------------------------------ */

  function getFreezeShopItem() {
    var items = (CONFIG.shop && CONFIG.shop.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].grants && items[i].grants.streakFreeze) return items[i];
    }
    return null;
  }

  /**
   * 处理单个遗漏日期：优先消耗已持有保护卡；无保护卡则尝试按
   * 商店价 × autoBuyPriceMultiplier 紧急买卡补救；两者皆不满足则
   * 该天保持未达标（连胜将在重新计算时于此处断裂）。
   * @param {string} dateKey
   * @returns {{date:string, outcome:string, cost?:number}}
   */
  function processSingleMissedDay(dateKey) {
    var state = DataStore.getState();

    if (state.streak.activeDates[dateKey]) {
      return { date: dateKey, outcome: 'already_active' };
    }

    if ((state.resources.streakFreeze || 0) > 0) {
      DataStore.mutate(function (s) {
        s.resources.streakFreeze -= 1;
        s.streak.activeDates[dateKey] = true;
        s.freezeLog.push({ date: dateKey, type: 'manual', note: '使用已持有保护卡守护连胜' });
      });
      return { date: dateKey, outcome: 'protected_by_stock' };
    }

    var shopItem = getFreezeShopItem();
    var basePrice = (shopItem && shopItem.price) || 50;
    var multiplier = (CONFIG.streak && CONFIG.streak.autoBuyPriceMultiplier) || 1.2;
    var emergencyPrice = Math.ceil(basePrice * multiplier);

    if ((state.resources.primaryResource || 0) >= emergencyPrice) {
      var icon = (CONFIG.resources && CONFIG.resources.primaryResource && CONFIG.resources.primaryResource.icon) || '';
      DataStore.mutate(function (s) {
        s.resources.primaryResource -= emergencyPrice;
        s.streak.activeDates[dateKey] = true;
        s.freezeLog.push({
          date: dateKey,
          type: 'auto',
          auto: true,
          note: '紧急买卡补救（-' + emergencyPrice + icon + '）'
        });
      });
      return { date: dateKey, outcome: 'protected_by_auto_buy', cost: emergencyPrice };
    }

    // 保护卡与主资源均不足：该天起连胜中断，重新计算时会在此处自然断链
    return { date: dateKey, outcome: 'broken' };
  }

  /**
   * 逐日检查自上次检查游标（streak.lastCheckedDate）到昨天之间的所有
   * 遗漏日期，并按优先级尝试保护。应在每次应用启动/进入前台时调用一次。
   * @returns {{processedDays: Array<object>}}
   */
  function checkMissedDays() {
    var state = DataStore.getState();
    var todayKey = DataStore.todayKey();
    var yesterdayKey = addDays(todayKey, -1);
    var lastChecked = state.streak.lastCheckedDate || todayKey;

    if (lastChecked >= yesterdayKey) {
      if (lastChecked < todayKey) {
        // 极少数场景下游标落后但已无遗漏区间，仅推进游标，避免长期卡住
      }
      recomputeCurrentAndLongest();
      return { processedDays: [] };
    }

    var processed = [];
    var cursorKey = addDays(lastChecked, 1);

    while (cursorKey <= yesterdayKey) {
      processed.push(processSingleMissedDay(cursorKey));
      cursorKey = addDays(cursorKey, 1);
    }

    DataStore.mutate(function (s) {
      s.streak.lastCheckedDate = yesterdayKey;
    });

    recomputeCurrentAndLongest();

    return { processedDays: processed };
  }

  /* ------------------------------------------------------------------ *
   * 查询辅助
   * ------------------------------------------------------------------ */

  /**
   * 获取保护卡使用记录（自动/主动标记），供统计页展示。
   * @returns {Array<object>}
   */
  function getFreezeLog() {
    return DataStore.getState().freezeLog.slice();
  }

  /**
   * 连胜与保护卡概览，供统计页 / 顶部资源栏使用。
   * @returns {{current:number, longest:number, streakFreeze:number, todayActive:boolean}}
   */
  function getStreakSummary() {
    var state = DataStore.getState();
    return {
      current: state.streak.current || 0,
      longest: state.streak.longest || 0,
      streakFreeze: state.resources.streakFreeze || 0,
      todayActive: isTodayActive()
    };
  }

  /* ------------------------------------------------------------------ *
   * 事件监听：任务完成 / 补救 / 数据导入后自动追溯重算连胜
   * ------------------------------------------------------------------ */

  try {
    document.addEventListener('habitspark:taskCompleted', function () {
      recomputeCurrentAndLongest();
    });
    document.addEventListener('habitspark:taskRescued', function () {
      // 补救把某天标记为达标后，重新扫描整条链，自动追溯并恢复被打通的连胜
      recomputeCurrentAndLongest();
    });
    document.addEventListener('habitspark:dataImported', function () {
      recomputeCurrentAndLongest();
    });
  } catch (e) {
    console.error('[Streak] 事件监听注册失败', e);
  }

  /* ------------------------------------------------------------------ *
   * 导出模块
   * ------------------------------------------------------------------ */

  global.StreakManager = {
    isTodayActive: isTodayActive,
    recomputeCurrentAndLongest: recomputeCurrentAndLongest,
    // 语义别名：补救后调用以追溯并恢复连胜锁定状态（实现与重算共用同一逻辑）
    recoverAfterRescue: recomputeCurrentAndLongest,
    checkMissedDays: checkMissedDays,
    // app.js 启动时调用的是 init()：这里给 checkMissedDays 起个别名，
    // 避免方法名不一致导致 StreakManager.init is not a function，
    // 从而中断整个 bootstrap 流程（UI.init 都不会被执行，界面停留在
    // index.html 里写死的初始文本，看起来就像"连胜每次重启都清零"）。
    init: checkMissedDays,
    getFreezeLog: getFreezeLog,
    getStreakSummary: getStreakSummary
  };

}(typeof window !== 'undefined' ? window : this));
