/* ==========================================================================
   Habit Spark - notification.js
   每日提醒与企业微信 Webhook：轮询检查系统时间，满足条件时推送提醒，
   并通过 lastNotificationSentDate 防止同一天重复推送。
   依赖 config.js / data.js（须先加载）。若 streak.js 已加载并暴露
   StreakManager.isTodayActive()，优先使用它判断当日是否达标；
   否则直接读取 DataStore 中的 streak.activeDates 兜底判断。
   ========================================================================== */

(function (global) {
  'use strict';

  var CONFIG = global.CONFIG || {};
  var DataStore = global.DataStore;

  if (!DataStore) {
    console.error('[Notification] 未检测到 DataStore，请确认 data.js 已先于 notification.js 加载');
  }

  var reminderConfig = CONFIG.reminder || {};
  var POLL_INTERVAL_MS = reminderConfig.pollingIntervalMs || 30000;

  var _timerId = null;

  /* ------------------------------------------------------------------ *
   * 时间比较工具
   * ------------------------------------------------------------------ */

  function getMinutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  function parseTimeToMinutes(timeStr) {
    var parts = String(timeStr || '').split(':');
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h)) h = 0;
    if (isNaN(m)) m = 0;
    return h * 60 + m;
  }

  /* ------------------------------------------------------------------ *
   * 当日是否已达标
   * ------------------------------------------------------------------ */

  /**
   * 判断当日连胜是否已达标。优先委托 StreakManager（若已加载），
   * 否则直接读取 DataStore 中记录的达标日期集合作为兜底。
   * @returns {boolean}
   */
  function isTodayActive() {
    if (global.StreakManager && typeof global.StreakManager.isTodayActive === 'function') {
      return !!global.StreakManager.isTodayActive();
    }
    var state = DataStore.getState();
    var key = DataStore.todayKey();
    return !!(state.streak && state.streak.activeDates && state.streak.activeDates[key]);
  }

  /* ------------------------------------------------------------------ *
   * Webhook 发送
   * ------------------------------------------------------------------ */

  /**
   * 向企业微信 Webhook 地址推送一条消息。
   * 企业微信跨域响应在部分浏览器环境下可能无法读取响应体（opaque response），
   * 因此只要请求未抛出网络异常即视为已成功发出。
   * @param {string} url
   * @param {object} body
   * @returns {Promise<boolean>} 是否发送成功（未抛出网络异常）
   */
  function postToWebhook(url, body) {
    if (!url) {
      return Promise.resolve(false);
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res && res.ok === false && res.status) {
        console.warn('[Notification] Webhook 响应状态异常：' + res.status);
      }
      return true;
    }).catch(function (e) {
      console.error('[Notification] Webhook 发送失败', e);
      return false;
    });
  }

  /**
   * 发送测试消息（用于设置页"发送测试消息"按钮）。
   * @param {string} url
   * @returns {Promise<{success: boolean, message: string}>}
   */
  function sendTestMessage(url) {
    if (!url) {
      return Promise.resolve({ success: false, message: '请先填写 Webhook 地址' });
    }
    var body = typeof reminderConfig.testMessageTemplate === 'function'
      ? reminderConfig.testMessageTemplate()
      : { msgtype: 'text', text: { content: 'Habit Spark 测试消息' } };

    return postToWebhook(url, body).then(function (success) {
      return success
        ? { success: true, message: '测试消息已发送，请到企业微信查看' }
        : { success: false, message: '发送失败，请检查 Webhook 地址或网络' };
    });
  }

  /**
   * 发送当日连胜断裂提醒，并在成功后记录 lastNotificationSentDate 防止重复推送。
   * @returns {Promise<boolean>}
   */
  function sendReminder() {
    var state = DataStore.getState();
    var reminder = state.settings.reminder;
    var streakDays = (state.streak && state.streak.current) || 0;

    var body = typeof reminderConfig.messageTemplate === 'function'
      ? reminderConfig.messageTemplate(streakDays, reminder.time)
      : { msgtype: 'text', text: { content: '今日尚未打卡，当前连胜 ' + streakDays + ' 天' } };

    return postToWebhook(reminder.webhookUrl, body).then(function (success) {
      if (success) {
        DataStore.mutate(function (s) {
          s.settings.reminder.lastNotificationSentDate = DataStore.todayKey();
        });
      }
      return success;
    });
  }

  /* ------------------------------------------------------------------ *
   * 触发条件检查（轮询回调）
   * ------------------------------------------------------------------ */

  /**
   * 检查提醒触发条件，全部满足时发送提醒：
   * 1. 提醒开关已开启；2. Webhook URL 不为空；
   * 3. 当前时间已到或超过设定时间；4. 当日连胜未达成；
   * 5. 今日尚未成功发送过提醒。
   */
  function checkAndTrigger() {
    if (!DataStore) return;

    var state = DataStore.getState();
    var reminder = state.settings.reminder;

    if (!reminder || !reminder.enabled) return;
    if (!reminder.webhookUrl) return;

    var nowMinutes = getMinutesSinceMidnight(new Date());
    var targetMinutes = parseTimeToMinutes(reminder.time);
    if (nowMinutes < targetMinutes) return;

    if (isTodayActive()) return;

    var todayKey = DataStore.todayKey();
    if (reminder.lastNotificationSentDate === todayKey) return;

    sendReminder();
  }

  /* ------------------------------------------------------------------ *
   * 轮询定时器
   * ------------------------------------------------------------------ */

  /**
   * 启动轮询检查（默认每 30 秒检查一次系统当前时间）。重复调用无副作用。
   */
  function start() {
    if (_timerId) return;
    checkAndTrigger();
    _timerId = global.setInterval(checkAndTrigger, POLL_INTERVAL_MS);
  }

  /**
   * 停止轮询检查。
   */
  function stop() {
    if (_timerId) {
      global.clearInterval(_timerId);
      _timerId = null;
    }
  }

  /* ------------------------------------------------------------------ *
   * 导出模块
   * ------------------------------------------------------------------ */

  global.NotificationManager = {
    start: start,
    stop: stop,
    checkAndTrigger: checkAndTrigger,
    sendReminder: sendReminder,
    sendTestMessage: sendTestMessage,
    isTodayActive: isTodayActive
  };

}(typeof window !== 'undefined' ? window : this));
