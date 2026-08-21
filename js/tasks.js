/* ==========================================================================
   Habit Spark - tasks.js
   任务系统：增删改查、周期重置判定、任务补救。
   依赖 config.js / data.js（须先加载）。

   周期重置说明：任务的原始打卡记录以 completions: {'YYYY-MM-DD': count}
   形式存储，本文件不做"清零重置"式的物理重置，而是按任务类型对应的
   自然周期区间（当日/自然周/自然月）动态求和计算当前进度。这样"修改
   targetCount 不影响本周期已累计次数"天然成立，无需额外补丁逻辑。

   连胜达标（streak.activeDates）的写入职责：
   - 常规打卡由 rewards.js 在发放奖励时一并标记（"完成任务=达标"）；
   - 补救打卡（本文件 rescueTask）直接标记，因为补救本身就是在修复
     某一天的达标状态。
   streak.js（后续批次）负责基于 activeDates 计算连胜链长度、最长连胜
   与保护卡消耗，本文件不做连胜链计算。
   ========================================================================== */

(function (global) {
  'use strict';

  var CONFIG = global.CONFIG || {};
  var DataStore = global.DataStore;

  if (!DataStore) {
    console.error('[Tasks] 未检测到 DataStore，请确认 data.js 已先于 tasks.js 加载');
  }

  /* ------------------------------------------------------------------ *
   * 通用工具
   * ------------------------------------------------------------------ */

  function generateId() {
    return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function numberOr(val) {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === 'number' && !isNaN(v)) return v;
    }
    return 0;
  }

  function parseDateKey(dateStr) {
    var parts = String(dateStr).split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function addDays(dateStr, days) {
    var d = parseDateKey(dateStr);
    d.setDate(d.getDate() + days);
    return DataStore.formatDateKey(d);
  }

  function findTaskById(state, taskId) {
    return (state.tasks || []).find(function (t) { return t.id === taskId; }) || null;
  }

  /* ------------------------------------------------------------------ *
   * 周期区间计算
   * ------------------------------------------------------------------ */

  function getWeekStartKey(dateStr) {
    var d = parseDateKey(dateStr);
    var day = d.getDay(); // 0=周日 ... 6=周六
    var diffToMonday = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diffToMonday);
    return DataStore.formatDateKey(d);
  }

  function getWeekEndKey(dateStr) {
    return addDays(getWeekStartKey(dateStr), 6);
  }

  function getMonthRange(dateStr) {
    var d = parseDateKey(dateStr);
    var first = new Date(d.getFullYear(), d.getMonth(), 1);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: DataStore.formatDateKey(first), end: DataStore.formatDateKey(last) };
  }

  /**
   * 获取指定任务类型在 dateStr 所在自然周期的日期区间（含首尾）。
   * once 类型无周期概念，返回 { start: null, end: null } 表示统计全部历史。
   * @param {'once'|'daily'|'weekly'|'monthly'} type
   * @param {string} dateStr
   * @returns {{start: string|null, end: string|null}}
   */
  function getPeriodRange(type, dateStr) {
    if (type === 'daily') {
      return { start: dateStr, end: dateStr };
    }
    if (type === 'weekly') {
      return { start: getWeekStartKey(dateStr), end: getWeekEndKey(dateStr) };
    }
    if (type === 'monthly') {
      return getMonthRange(dateStr);
    }
    return { start: null, end: null }; // once
  }

  function sumCompletionsInRange(completions, range) {
    var total = 0;
    Object.keys(completions || {}).forEach(function (dateKey) {
      var inRange = range.start === null || (dateKey >= range.start && dateKey <= range.end);
      if (inRange) total += completions[dateKey] || 0;
    });
    return total;
  }

  /**
   * 计算任务在 dateStr 所在周期内的累计完成次数。
   * @param {object} task
   * @param {string} [dateStr] 默认今天
   * @returns {number}
   */
  function getTaskProgress(task, dateStr) {
    dateStr = dateStr || DataStore.todayKey();
    var range = getPeriodRange(task.type, dateStr);
    return sumCompletionsInRange(task.completions, range);
  }

  /**
   * 获取任务的全部历史完成次数（用于 once 类型判断是否已永久完成）。
   * @param {object} task
   * @returns {number}
   */
  function getTotalCompletions(task) {
    var total = 0;
    Object.keys(task.completions || {}).forEach(function (k) {
      total += task.completions[k] || 0;
    });
    return total;
  }

  /**
   * 判断任务在 dateStr 所在周期是否已达标（once 判断全部历史）。
   * @param {object} task
   * @param {string} [dateStr]
   * @returns {boolean}
   */
  function isTaskDoneForPeriod(task, dateStr) {
    if (task.type === 'once') {
      return getTotalCompletions(task) > 0;
    }
    var target = task.targetCount || 1;
    return getTaskProgress(task, dateStr) >= target;
  }

  /**
   * 判断任务在 dateStr 是否可操作（已启用且在生效时间段内）。
   * @param {object} task
   * @param {string} [dateStr]
   * @returns {boolean}
   */
  function isTaskAvailable(task, dateStr) {
    dateStr = dateStr || DataStore.todayKey();
    if (!task.enabled) return false;
    if (task.startDate && dateStr < task.startDate) return false;
    if (task.endDate && dateStr > task.endDate) return false;
    return true;
  }

  function wasAnyTaskCompletedOn(tasks, dateStr) {
    return (tasks || []).some(function (t) {
      return t.completions && t.completions[dateStr] && t.completions[dateStr] > 0;
    });
  }

  /* ------------------------------------------------------------------ *
   * 增删改查
   * ------------------------------------------------------------------ */

  /**
   * 列出任务，可选按启用状态 / 类型过滤。
   * @param {{enabledOnly?: boolean, type?: string}} [options]
   * @returns {object[]}
   */
  function listTasks(options) {
    options = options || {};
    var tasks = DataStore.getState().tasks || [];
    if (options.enabledOnly) {
      tasks = tasks.filter(function (t) { return t.enabled; });
    }
    if (options.type) {
      tasks = tasks.filter(function (t) { return t.type === options.type; });
    }
    return tasks.slice();
  }

  function getTaskById(taskId) {
    return findTaskById(DataStore.getState(), taskId);
  }

  /**
   * 新增任务。未提供的奖励/目标次数字段自动取 config.js 中对应类型的默认值。
   * @param {{name:string, type?:string, baseResourceReward?:number, currencyReward?:number,
   *          targetCount?:number, enabled?:boolean, startDate?:string|null, endDate?:string|null}} input
   * @returns {{success:boolean, task?:object, reason?:string}}
   */
  function addTask(input) {
    input = input || {};

    if (!input.name || !String(input.name).trim()) {
      return { success: false, reason: 'name_required' };
    }

    var type = (CONFIG.taskTypes || []).indexOf(input.type) !== -1 ? input.type : 'daily';
    var defaults = (CONFIG.taskDefaults && CONFIG.taskDefaults[type]) || {};

    var task = {
      id: generateId(),
      name: String(input.name).trim(),
      type: type,
      baseResourceReward: numberOr(input.baseResourceReward, defaults.baseResourceReward, 0),
      currencyReward: numberOr(input.currencyReward, defaults.currencyReward, 0),
      targetCount: Math.max(1, numberOr(input.targetCount, defaults.targetCount, 1)),
      enabled: input.enabled !== undefined ? !!input.enabled : true,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      createdAt: DataStore.todayKey(),
      completions: {}
    };

    DataStore.mutate(function (s) { s.tasks.push(task); });
    return { success: true, task: task };
  }

  /**
   * 更新任务的可编辑字段。刻意不触碰 completions，
   * 因此修改 targetCount 不会重置本周期已有累计次数。
   * @param {string} taskId
   * @param {object} patch
   * @returns {{success:boolean, task?:object, reason?:string}}
   */
  function updateTask(taskId, patch) {
    patch = patch || {};
    var existing = findTaskById(DataStore.getState(), taskId);
    if (!existing) return { success: false, reason: 'not_found' };

    var editableFields = [
      'name', 'type', 'baseResourceReward', 'currencyReward',
      'targetCount', 'enabled', 'startDate', 'endDate'
    ];

    DataStore.mutate(function (s) {
      var t = findTaskById(s, taskId);
      editableFields.forEach(function (field) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
          t[field] = patch[field];
        }
      });
      if (!t.targetCount || t.targetCount < 1) t.targetCount = 1;
    });

    return { success: true, task: findTaskById(DataStore.getState(), taskId) };
  }

  function deleteTask(taskId) {
    var existing = findTaskById(DataStore.getState(), taskId);
    if (!existing) return { success: false, reason: 'not_found' };

    DataStore.mutate(function (s) {
      s.tasks = s.tasks.filter(function (t) { return t.id !== taskId; });
    });
    return { success: true };
  }

  function setTaskEnabled(taskId, enabled) {
    return updateTask(taskId, { enabled: !!enabled });
  }

  /* ------------------------------------------------------------------ *
   * 打卡完成（长按触发）
   * 仅负责记录 completions，不发放奖励——奖励发放由 rewards.js 编排调用。
   * ------------------------------------------------------------------ */

  /**
   * 记录一次任务完成。once/daily 类型的周期目标固定为 1 次，达标后
   * 当期（once 为永久）不可再次完成；weekly/monthly 累计到 targetCount
   * 后同样视为本周期已完成。
   * @param {string} taskId
   * @param {string} [dateStr] 默认今天
   * @returns {{success:boolean, task?:object, periodComplete?:boolean, reason?:string}}
   */
  function completeTask(taskId, dateStr) {
    dateStr = dateStr || DataStore.todayKey();
    var task = findTaskById(DataStore.getState(), taskId);
    if (!task) return { success: false, reason: 'not_found' };
    if (!isTaskAvailable(task, dateStr)) return { success: false, reason: 'not_available' };

    if (isTaskDoneForPeriod(task, dateStr)) {
      return { success: false, reason: 'already_done' };
    }

    DataStore.mutate(function (s) {
      var t = findTaskById(s, taskId);
      t.completions[dateStr] = (t.completions[dateStr] || 0) + 1;
    });

    var updated = findTaskById(DataStore.getState(), taskId);
    return {
      success: true,
      task: updated,
      periodComplete: isTaskDoneForPeriod(updated, dateStr)
    };
  }

  /* ------------------------------------------------------------------ *
   * 任务补救（见需求文档第十节）
   * ------------------------------------------------------------------ */

  /**
   * 计算过去 N 天（config.rescue.maxLookbackDays，默认 3）中，
   * 当天没有任何任务被完成（即连胜未达标）且存在可操作任务的日期列表，
   * 每个日期附带当天可补救的任务清单。按日期升序排列，UI 按"一次只
   * 展示一天"的方式渲染（取第一项，见 getNextRescueDay）。
   * @returns {Array<{date:string, tasks:Array<{id:string,name:string,type:string,baseResourceReward:number}>}>}
   */
  function getRescueCandidates() {
    var state = DataStore.getState();
    var tasks = state.tasks || [];
    var todayKey = DataStore.todayKey();
    var lookback = (CONFIG.rescue && CONFIG.rescue.maxLookbackDays) || 3;
    var results = [];

    for (var i = 1; i <= lookback; i++) {
      var dateStr = addDays(todayKey, -i);

      if (wasAnyTaskCompletedOn(tasks, dateStr)) continue; // 当天已达标，无需补救

      var availableTasks = tasks.filter(function (t) {
        if (!isTaskAvailable(t, dateStr)) return false;
        if (t.type === 'once' && getTotalCompletions(t) > 0) return false;
        return true;
      });

      if (availableTasks.length === 0) continue; // 当天没有可补救的任务

      results.push({
        date: dateStr,
        tasks: availableTasks.map(function (t) {
          return {
            id: t.id,
            name: t.name,
            type: t.type,
            baseResourceReward: t.baseResourceReward
          };
        })
      });
    }

    results.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return results;
  }

  /**
   * 便捷方法：获取 UI 应展示的"下一个"待补救日期（一次只展示一天）。
   * @returns {{date:string, tasks:object[]}|null}
   */
  function getNextRescueDay() {
    var candidates = getRescueCandidates();
    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * 对过去某一天补录一次任务完成，重发该任务的火力/货币奖励（不参与
   * 随机双倍判定），并标记该天连胜达标；若该天此前连胜中断，补救后
   * 视为当天连胜成功（streak.js 后续据此重新计算连胜链）。
   * @param {string} taskId
   * @param {string} dateStr 必须在 (今天 - maxLookbackDays, 今天) 范围内
   * @returns {{success:boolean, dateStr?:string, streakWasBroken?:boolean, task?:object, reason?:string}}
   */
  function rescueTask(taskId, dateStr) {
    if (!dateStr) return { success: false, reason: 'date_required' };

    var state = DataStore.getState();
    var task = findTaskById(state, taskId);
    if (!task) return { success: false, reason: 'not_found' };

    var todayKey = DataStore.todayKey();
    var lookback = (CONFIG.rescue && CONFIG.rescue.maxLookbackDays) || 3;
    var earliestKey = addDays(todayKey, -lookback);

    if (dateStr >= todayKey || dateStr <= earliestKey) {
      return { success: false, reason: 'out_of_range' };
    }
    if (!isTaskAvailable(task, dateStr)) {
      return { success: false, reason: 'not_available' };
    }
    if (task.type === 'once' && getTotalCompletions(task) > 0) {
      return { success: false, reason: 'already_done' };
    }
    if (task.completions && task.completions[dateStr] > 0) {
      return { success: false, reason: 'already_completed_that_day' };
    }

    var streakWasBroken = !wasAnyTaskCompletedOn(state.tasks, dateStr);

    DataStore.mutate(function (s) {
      var t = findTaskById(s, taskId);
      t.completions[dateStr] = 1;

      // 重发火力值 / 货币值：直接按任务配置金额发放，不参与随机双倍
      var primary = t.baseResourceReward || 0;
      var currency = t.currencyReward || 0;
      s.resources.primaryResource += primary;
      s.resources.currency += currency;
      s.stats.totalPrimaryEarned += primary;
      s.stats.totalCurrencyEarned += currency;
      s.stats.totalTasksCompleted += 1;

      // 标记该天达标：若此前连胜在该天中断，补救后当天连胜视为成功
      s.streak.activeDates[dateStr] = true;
    });

    var updatedTask = findTaskById(DataStore.getState(), taskId);

    try {
      document.dispatchEvent(new CustomEvent('habitspark:taskRescued', {
        detail: { taskId: taskId, dateStr: dateStr, streakWasBroken: streakWasBroken }
      }));
    } catch (e) {
      console.error('[Tasks] 派发补救完成事件失败', e);
    }

    return {
      success: true,
      dateStr: dateStr,
      streakWasBroken: streakWasBroken,
      task: updatedTask
    };
  }

  /* ------------------------------------------------------------------ *
   * 导出模块
   * ------------------------------------------------------------------ */

  global.TaskManager = {
    // CRUD
    listTasks: listTasks,
    getTaskById: getTaskById,
    addTask: addTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
    setTaskEnabled: setTaskEnabled,

    // 打卡完成
    completeTask: completeTask,

    // 周期与状态判定
    getPeriodRange: getPeriodRange,
    getTaskProgress: getTaskProgress,
    getTotalCompletions: getTotalCompletions,
    isTaskDoneForPeriod: isTaskDoneForPeriod,
    isTaskAvailable: isTaskAvailable,
    wasAnyTaskCompletedOn: wasAnyTaskCompletedOn,

    // 任务补救
    getRescueCandidates: getRescueCandidates,
    getNextRescueDay: getNextRescueDay,
    rescueTask: rescueTask
  };

}(typeof window !== 'undefined' ? window : this));
