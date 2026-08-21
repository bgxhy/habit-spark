/* ==========================================================================
   Habit Spark - rewards.js
   奖励计算引擎：组合算子函数 + 每日免费礼包发放。
   依赖 config.js / data.js / tasks.js（须先加载）。

   规则回顾（见需求文档第五节 / 第八节）：
   - 随机双倍概率 CONFIG.rewards.randomDoubleChance（默认 20%），
     仅对任务的主资源奖励生效，货币奖励不受影响。
   - 每日礼包、商店购买、兑换均不触发随机双倍。
   - 连胜加成、成就加成算子接口预留，暂不实现，返回中性值（无加成）。
   ========================================================================== */

(function (global) {
  'use strict';

  var CONFIG = global.CONFIG || {};
  var DataStore = global.DataStore;
  var TaskManager = global.TaskManager;

  if (!DataStore) {
    console.error('[Rewards] 未检测到 DataStore，请确认 data.js 已先于 rewards.js 加载');
  }
  if (!TaskManager) {
    console.error('[Rewards] 未检测到 TaskManager，请确认 tasks.js 已先于 rewards.js 加载');
  }

  /* ------------------------------------------------------------------ *
   * 组合算子函数
   * ------------------------------------------------------------------ */

  /**
   * 计算任务的基础奖励（未叠加任何加成）。
   * @param {{baseResourceReward?:number, currencyReward?:number}} task
   * @returns {{primaryResource:number, currency:number}}
   */
  function calculateBaseReward(task) {
    return {
      primaryResource: (task && task.baseResourceReward) || 0,
      currency: (task && task.currencyReward) || 0
    };
  }

  /**
   * 随机双倍判定，仅对任务主资源生效。概率取自 CONFIG.rewards.randomDoubleChance。
   * @returns {{triggered:boolean, multiplier:number}}
   */
  function calculateMultiplierBonus() {
    var chance = (CONFIG.rewards && typeof CONFIG.rewards.randomDoubleChance === 'number')
      ? CONFIG.rewards.randomDoubleChance
      : 0.2;
    var triggered = Math.random() < chance;
    return { triggered: triggered, multiplier: triggered ? 2 : 1 };
  }

  /**
   * 计算货币奖励。货币奖励不参与随机双倍判定（规则：双倍仅对主资源生效）。
   * @param {{currencyReward?:number}} task
   * @returns {number}
   */
  function calculateCurrencyReward(task) {
    return (task && task.currencyReward) || 0;
  }

  /**
   * 预留：连胜加成算子接口。暂不实现，返回中性值（无加成）。
   * 未来可根据当前连胜天数返回额外的主资源/货币加成。
   * @param {number} [streakDays]
   * @returns {{primaryResource:number, currency:number}}
   */
  function calculateStreakBonus(streakDays) {
    return { primaryResource: 0, currency: 0 };
  }

  /**
   * 预留：成就加成算子接口。暂不实现，返回中性值（无加成）。
   * 未来可根据已解锁成就返回额外的主资源/货币加成。
   * @param {object} [context]
   * @returns {{primaryResource:number, currency:number}}
   */
  function calculateAchievementBonus(context) {
    return { primaryResource: 0, currency: 0 };
  }

  /**
   * 汇总计算一次任务完成应发放的总奖励。
   * @param {object} task
   * @param {{allowDouble?: boolean}} [options] allowDouble 默认 true；
   *        每日礼包 / 商店购买 / 兑换等场景调用方须显式传 false。
   * @returns {{primaryResource:number, currency:number, doubled:boolean}}
   */
    function calculateTotalReward(task, options) {
    options = options || {};
    var allowDouble = options.allowDouble !== false;

    var base = calculateBaseReward(task);
    var bonus = allowDouble ? calculateMultiplierBonus() : { triggered: false, multiplier: 1 };
    var streakBonus = calculateStreakBonus();
    var achievementBonus = calculateAchievementBonus();

    // 周期达标连续加成：task.bonusActive 由 tasks.js 的 syncPeriodBonus 维护，
    // 与随机双倍是相乘关系（都触发时 1.5 × 2 = 3 倍），只影响主资源，不影响货币
    var periodBonusActive = !!(task && task.bonusActive);
    var periodBonusMultiplier = periodBonusActive
      ? ((CONFIG.rewards && CONFIG.rewards.periodBonusMultiplier) || 1)
      : 1;

    var primaryResource = base.primaryResource * bonus.multiplier * periodBonusMultiplier
      + streakBonus.primaryResource
      + achievementBonus.primaryResource;

    var currency = calculateCurrencyReward(task)
      + streakBonus.currency
      + achievementBonus.currency;

    return {
      primaryResource: primaryResource,
      currency: currency,
      doubled: bonus.triggered,
      bonusApplied: periodBonusActive // 供 ui.js 显示"✨加成中"
    };
  }

  /* ------------------------------------------------------------------ *
   * 任务完成 + 奖励发放编排
   * ------------------------------------------------------------------ */

  /**
   * 完成一次任务打卡并发放奖励（长按打卡的完整业务入口）。
   * 内部调用 TaskManager.completeTask 记录打卡，再据此计算并发放奖励，
   * 同时标记当日连胜达标（"当日完成任意 1 个任务即算当日达标"）。
   * @param {string} taskId
   * @param {string} [dateStr] 默认今天
   * @returns {{success:boolean, task?:object, reward?:object, periodComplete?:boolean, reason?:string}}
   */
  function completeTaskWithReward(taskId, dateStr) {
    if (!TaskManager) return { success: false, reason: 'task_manager_unavailable' };

    var completion = TaskManager.completeTask(taskId, dateStr);
    if (!completion.success) return completion;

    var reward = calculateTotalReward(completion.task, { allowDouble: true });
    var key = dateStr || DataStore.todayKey();

    DataStore.mutate(function (s) {
      s.resources.primaryResource += reward.primaryResource;
      s.resources.currency += reward.currency;
      s.stats.totalPrimaryEarned += reward.primaryResource;
      s.stats.totalCurrencyEarned += reward.currency;
      s.stats.totalTasksCompleted += 1;
      // 达标标记交由本文件统一处理：streak.js 后续基于此计算连胜链/保护卡
      s.streak.activeDates[key] = true;
    });

    try {
      document.dispatchEvent(new CustomEvent('habitspark:taskCompleted', {
        detail: {
          taskId: taskId,
          dateStr: key,
          reward: reward,
          periodComplete: completion.periodComplete
        }
      }));
    } catch (e) {
      console.error('[Rewards] 派发任务完成事件失败', e);
    }

    return {
      success: true,
      task: completion.task,
      reward: reward,
      periodComplete: completion.periodComplete
    };
  }

  /* ------------------------------------------------------------------ *
   * 每日免费礼包（见需求文档第八节）
   * 不增加连胜、不触发随机双倍加成，领取后当日不可再次领取。
   * ------------------------------------------------------------------ */

  /**
   * 判断今日是否已领取过每日礼包。
   * @returns {boolean}
   */
  function isDailyGiftClaimedToday() {
    var state = DataStore.getState();
    return state.dailyGift.lastClaimedDate === DataStore.todayKey();
  }

  /**
   * 领取每日免费礼包。
   * @returns {{success:boolean, reward?:{primaryResource:number, currency:number}, reason?:string}}
   */
  function claimDailyGift() {
    var todayKey = DataStore.todayKey();

    if (isDailyGiftClaimedToday()) {
      return { success: false, reason: 'already_claimed' };
    }

    var giftConfig = CONFIG.dailyGift || {};
    var min = typeof giftConfig.primaryResourceMin === 'number' ? giftConfig.primaryResourceMin : 1;
    var max = typeof giftConfig.primaryResourceMax === 'number' ? giftConfig.primaryResourceMax : min;
    var primaryResource = min + Math.floor(Math.random() * (max - min + 1));
    var currency = giftConfig.currencyReward || 0;

    DataStore.mutate(function (s) {
      s.resources.primaryResource += primaryResource;
      s.resources.currency += currency;
      s.stats.totalPrimaryEarned += primaryResource;
      s.stats.totalCurrencyEarned += currency;
      s.dailyGift.lastClaimedDate = todayKey;
      // 刻意不写入 s.streak.activeDates：礼包不计入"当日达标"
    });

    var reward = { primaryResource: primaryResource, currency: currency };

    try {
      document.dispatchEvent(new CustomEvent('habitspark:dailyGiftClaimed', {
        detail: { reward: reward }
      }));
    } catch (e) {
      console.error('[Rewards] 派发每日礼包事件失败', e);
    }

    return { success: true, reward: reward };
  }

  /* ------------------------------------------------------------------ *
   * 导出模块
   * ------------------------------------------------------------------ */

  global.RewardEngine = {
    // 组合算子
    calculateBaseReward: calculateBaseReward,
    calculateMultiplierBonus: calculateMultiplierBonus,
    calculateCurrencyReward: calculateCurrencyReward,
    calculateStreakBonus: calculateStreakBonus,
    calculateAchievementBonus: calculateAchievementBonus,
    calculateTotalReward: calculateTotalReward,

    // 业务入口
    completeTaskWithReward: completeTaskWithReward,
    claimDailyGift: claimDailyGift,
    isDailyGiftClaimedToday: isDailyGiftClaimedToday
  };

}(typeof window !== 'undefined' ? window : this));
