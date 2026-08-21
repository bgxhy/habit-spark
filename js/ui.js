/* ==========================================================================
   Habit Spark - ui.js
   表现层：渲染 + 交互绑定。依赖 config.js / data.js / tasks.js /
   rewards.js / streak.js / shop.js / backup.js / notification.js
   （须先加载）。本文件只负责 DOM 渲染与用户交互，所有数据读写都通过
   已导出的 Manager 完成，不直接操作 localStorage。

   对外只暴露 UI.init()（由 app.js 在启动时调用一次）和 UI.render()
   （供需要强制整体刷新的场景使用，如导入数据后）。
   ========================================================================== */

(function (global) {
  'use strict';

  var CONFIG = global.CONFIG || {};
  var DataStore = global.DataStore;
  var TaskManager = global.TaskManager;
  var RewardEngine = global.RewardEngine;
  var StreakManager = global.StreakManager;
  var ShopManager = global.ShopManager;
  var BackupManager = global.BackupManager;
  var NotificationManager = global.NotificationManager;

  ['DataStore', 'TaskManager', 'RewardEngine', 'StreakManager', 'ShopManager', 'BackupManager']
    .forEach(function (name) {
      if (!global[name]) {
        console.error('[UI] 未检测到 ' + name + '，请确认对应脚本已先于 ui.js 加载');
      }
    });

  var CHARGE_DURATION_MS = 1000; // 须与 style.css 中 --duration-charge 保持一致

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function vibrate(pattern) {
    try {
      if (global.navigator && global.navigator.vibrate) {
        global.navigator.vibrate(pattern);
      }
    } catch (e) { /* 部分环境不支持震动 API，静默忽略 */ }
  }

  /**
   * 根据 config.js 中的资源图标（emoji 字符串 / 图片路径）生成可插入
   * innerHTML 的字符串，UI 层不硬编码任何资源图标。
   * @param {string} resourceKey 'primaryResource' | 'currency' | 'streakFreeze'
   * @returns {string}
   */
  function getResourceIconHtml(resourceKey) {
    var res = CONFIG.resources && CONFIG.resources[resourceKey];
    if (!res) return '';
    if (CONFIG.isImageIcon && CONFIG.isImageIcon(res.icon)) {
      return '<img src="' + res.icon + '" alt="' + escapeHtml(res.name || '') +
        '" style="width:15px;height:15px;vertical-align:middle;">';
    }
    return res.icon || '';
  }

  // textContent 场景不能插入 HTML 图标，退化为纯文本 emoji（图片图标场景省略图标）
  function getResourceIconPlain(resourceKey) {
    var res = CONFIG.resources && CONFIG.resources[resourceKey];
    if (!res) return '';
    return (CONFIG.isImageIcon && CONFIG.isImageIcon(res.icon)) ? '' : (res.icon || '');
  }

  function setResourceIcon(elId, resourceKey) {
    var el = $(elId);
    if (el) el.innerHTML = getResourceIconHtml(resourceKey);
  }

  /* ------------------------------------------------------------------ *
   * Web Audio 音效
   * ------------------------------------------------------------------ */

  var _audioCtx = null;

  function getAudioCtx() {
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    if (!_audioCtx) {
      try { _audioCtx = new Ctx(); } catch (e) { return null; }
    }
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(function () {});
    }
    return _audioCtx;
  }

  function playTone(ctx, freq, startOffset, duration, peakGain) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    var t0 = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** 普通完成：高音清脆提示音 */
  function playChime() {
    var ctx = getAudioCtx();
    if (!ctx) return;
    playTone(ctx, 1046.5, 0, 0.18, 0.22);
    playTone(ctx, 1568.0, 0.05, 0.16, 0.16);
  }

  /** 触发双倍：多重升级阶梯音效 */
  function playDoubleChime() {
    var ctx = getAudioCtx();
    if (!ctx) return;
    [880, 1046.5, 1318.5, 1568].forEach(function (freq, i) {
      playTone(ctx, freq, i * 0.09, 0.16, 0.2);
    });
  }

  /** 连胜达成：特制升级音效 */
  function playStreakFanfare() {
    var ctx = getAudioCtx();
    if (!ctx) return;
    [659.3, 783.99, 1046.5, 1318.5].forEach(function (freq, i) {
      playTone(ctx, freq, i * 0.11, 0.22, 0.24);
    });
  }

  /* ------------------------------------------------------------------ *
   * 悬浮文字 / 粒子 / Toast 反馈
   * ------------------------------------------------------------------ */

  /**
   * 在指定容器内生成一段向上飘散渐隐的悬浮文字（如 "+10🔥"）。
   * @param {HTMLElement} anchorEl 相对定位的父容器
   * @param {string} text
   */
  function spawnFloatingText(anchorEl, text) {
    if (!anchorEl || !text) return;
    var el = document.createElement('div');
    el.textContent = text;
    el.style.position = 'absolute';
    el.style.left = '50%';
    el.style.top = '6%';
    el.style.transform = 'translateX(-50%)';
    el.style.color = 'var(--primary-color)';
    el.style.fontWeight = '800';
    el.style.fontSize = '18px';
    el.style.whiteSpace = 'nowrap';
    el.style.pointerEvents = 'none';
    el.style.textShadow = '0 2px 10px rgba(0,0,0,0.55)';
    el.style.zIndex = '5';
    anchorEl.appendChild(el);

    var anim = el.animate(
      [
        { transform: 'translate(-50%, 0)', opacity: 1 },
        { transform: 'translate(-50%, -46px)', opacity: 0 }
      ],
      { duration: 900, easing: 'ease-out' }
    );
    anim.onfinish = function () { el.remove(); };
  }

  function spawnParticles(count) {
    var layer = $('particleLayer');
    if (!layer) return;
    for (var i = 0; i < count; i++) {
      var p = document.createElement('span');
      p.className = 'particle';
      var offsetX = (Math.random() - 0.5) * 90;
      p.style.left = 'calc(50% + ' + offsetX + 'px)';
      p.style.animationDelay = (Math.random() * 0.2).toFixed(2) + 's';
      layer.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 1900); })(p);
    }
  }

  function showToast(message, duration) {
    var container = $('toastContainer');
    if (!container || !message) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity 0.25s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, duration || 2200);
  }

  /* ------------------------------------------------------------------ *
   * 通用弹窗（确认 / 动态表单）
   * ------------------------------------------------------------------ */

  function ensureModalFormArea() {
    var area = $('modalFormArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'modalFormArea';
      area.className = 'modal-form-area';
      area.style.display = 'flex';
      area.style.flexDirection = 'column';
      area.style.gap = '10px';
      area.style.margin = '4px 0 0';
      var msg = $('modalMessage');
      msg.parentNode.insertBefore(area, msg.nextSibling);
    }
    return area;
  }

  function showModalRaw() {
    $('modalOverlay').classList.remove('hidden');
  }

  function hideModal() {
    $('modalOverlay').classList.add('hidden');
    $('modalConfirmBtn').style.display = '';
    $('modalConfirmBtn').onclick = null;
    $('modalCancelBtn').onclick = null;
    var area = $('modalFormArea');
    if (area) area.innerHTML = '';
  }

  /**
   * 通用确认弹窗。
   * @param {{title?:string, message?:string, confirmText?:string, cancelText?:string}} options
   * @returns {Promise<boolean>}
   */
  function showConfirm(options) {
    options = options || {};
    return new Promise(function (resolve) {
      $('modalTitle').textContent = options.title || '提示';
      $('modalMessage').textContent = options.message || '';
      $('modalConfirmBtn').textContent = options.confirmText || '确认';
      $('modalCancelBtn').textContent = options.cancelText || '取消';
      $('modalConfirmBtn').style.display = '';
      var area = $('modalFormArea');
      if (area) area.innerHTML = '';

      $('modalConfirmBtn').onclick = function () { hideModal(); resolve(true); };
      $('modalCancelBtn').onclick = function () { hideModal(); resolve(false); };
      showModalRaw();
    });
  }

  /* ------------------------------------------------------------------ *
   * 长按打卡（SVG 环形充能动画）
   * ------------------------------------------------------------------ */

  function attachLongPress(ringEl, task) {
    var timerId = null;
    var charging = false;

    function start(e) {
      if (e.cancelable) e.preventDefault();
      if (charging) return;
      if (TaskManager.isTaskDoneForPeriod(task, DataStore.todayKey())) return;
      charging = true;
      ringEl.classList.add('charging');
      vibrate(15); // 按下短震
      timerId = setTimeout(finish, CHARGE_DURATION_MS);
    }

    function cancelCharge() {
      if (!charging) return;
      charging = false;
      ringEl.classList.remove('charging');
      clearTimeout(timerId);
    }

    function finish() {
      charging = false;
      ringEl.classList.remove('charging');
      vibrate(60); // 蓄力满长震
      handleTaskComplete(task.id);
    }

    ringEl.addEventListener('pointerdown', start);
    ringEl.addEventListener('pointerup', cancelCharge);
    ringEl.addEventListener('pointerleave', cancelCharge);
    ringEl.addEventListener('pointercancel', cancelCharge);
    ringEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function handleTaskComplete(taskId) {
    var wasActiveBefore = StreakManager.isTodayActive();
    var result = RewardEngine.completeTaskWithReward(taskId);

    if (!result.success) {
      if (result.reason === 'already_done') showToast('今日/本期任务已完成');
      return;
    }

    vibrate(result.reward.doubled ? [30, 40, 30, 40, 60] : 50);
    if (result.reward.doubled) {
      playDoubleChime();
    } else {
      playChime();
    }

    var flameEl = $('flameWrap');
    var rewardText = '+' + result.reward.primaryResource + ' ' + getResourceIconPlain('primaryResource') +
      (result.reward.doubled ? ' 双倍！' : '');
    spawnFloatingText(flameEl, rewardText);
    spawnParticles(10);

    if (result.periodComplete && (result.task.type === 'weekly' || result.task.type === 'monthly')) {
      showToast('「' + result.task.name + '」本周期已完成！');
    }

    renderResourceBar();
    renderTaskSidebar();
    renderFlame();

    var nowActive = StreakManager.isTodayActive();
    if (!wasActiveBefore && nowActive) {
      playStreakFanfare();
    }
  }

  /* ------------------------------------------------------------------ *
   * 每日免费礼包（index.html 未预留专属容器，动态注入到火苗舞台）
   * ------------------------------------------------------------------ */

  function ensureDailyGiftButton() {
    var stage = $('flameStage');
    if (!stage) return null;
    var btn = $('dailyGiftBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'dailyGiftBtn';
      btn.className = 'btn btn--ghost';
      btn.style.position = 'absolute';
      btn.style.left = '50%';
      btn.style.bottom = '14px';
      btn.style.transform = 'translateX(-50%)';
      btn.style.fontSize = '12.5px';
      btn.style.padding = '8px 16px';
      stage.appendChild(btn);
      btn.addEventListener('click', handleClaimDailyGift);
    }
    return btn;
  }

  function renderDailyGiftButton() {
    var btn = ensureDailyGiftButton();
    if (!btn) return;
    var claimed = RewardEngine.isDailyGiftClaimedToday();
    btn.textContent = claimed ? '今日礼包已领取' : ('领取每日礼包 ' + getResourceIconPlain('primaryResource'));
    btn.disabled = claimed;
    btn.style.opacity = claimed ? '0.45' : '1';
    btn.style.pointerEvents = claimed ? 'none' : 'auto';
  }

  function handleClaimDailyGift() {
    var result = RewardEngine.claimDailyGift();
    if (!result.success) {
      showToast('今日礼包已领取');
      return;
    }
    vibrate(20);
    playChime();
    showToast('每日礼包 +' + result.reward.primaryResource + ' ' + getResourceIconPlain('primaryResource'));
    renderResourceBar();
    renderDailyGiftButton();
  }

  /* ------------------------------------------------------------------ *
   * 渲染：顶部资源栏
   * ------------------------------------------------------------------ */

  function renderResourceBar() {
    var state = DataStore.getState();
    setResourceIcon('iconPrimary', 'primaryResource');
    setResourceIcon('iconCurrency', 'currency');
    setResourceIcon('iconShield', 'streakFreeze');
    $('valPrimary').textContent = state.resources.primaryResource;
    $('valCurrency').textContent = state.resources.currency;
    $('valShield').textContent = state.resources.streakFreeze;
  }

  /* ------------------------------------------------------------------ *
   * 渲染：侧边任务列表（长按打卡）
   * ------------------------------------------------------------------ */

  function renderTaskSidebar() {
    var listEl = $('taskList');
    var emptyEl = $('taskListEmpty');
    var tasks = TaskManager.listTasks({ enabledOnly: true });
    var todayKey = DataStore.todayKey();

    Array.prototype.slice.call(listEl.querySelectorAll('.task-item')).forEach(function (n) { n.remove(); });

    if (tasks.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    tasks.forEach(function (task) {
      var done = TaskManager.isTaskDoneForPeriod(task, todayKey);

      var item = document.createElement('div');
      item.className = 'task-item' + (done ? ' task-item--done' : '');
      item.dataset.taskId = task.id;

      var ring = document.createElement('div');
      ring.className = 'task-ring' + (done ? ' task-ring--complete' : '');
      ring.innerHTML =
        '<svg class="task-ring__svg" viewBox="0 0 56 56" aria-hidden="true">' +
        '<circle class="task-ring__track" cx="28" cy="28" r="24"></circle>' +
        '<circle class="task-ring__progress" cx="28" cy="28" r="24"></circle>' +
        '</svg>' +
        '<span class="task-ring__icon">' + getResourceIconHtml('primaryResource') + '</span>';

      var label = document.createElement('div');
      label.className = 'task-item__label';
      label.textContent = task.name;

      item.appendChild(ring);
      item.appendChild(label);
      listEl.appendChild(item);

      if (!done) attachLongPress(ring, task);
    });
  }

  /* ------------------------------------------------------------------ *
   * 渲染：中央火苗
   * ------------------------------------------------------------------ */

  function renderFlame() {
    var state = DataStore.getState();
    var stage = $('flameStage');
    var todayActive = StreakManager.isTodayActive();

    $('streakCount').textContent = state.streak.current || 0;
    stage.classList.toggle('is-achieved', todayActive);
    stage.classList.toggle('is-inactive', !todayActive);
    $('streakBadge').classList.toggle('hidden', todayActive);

    renderDailyGiftButton();
  }

  /* ------------------------------------------------------------------ *
   * 渲染：商店面板
   * ------------------------------------------------------------------ */

  function renderExchangeCard() {
    var cfg = ShopManager.getExchangeConfig();
    $('exchangeRateLabel').innerHTML =
      '<span id="exchangeIconFrom">' + getResourceIconHtml('primaryResource') + '</span> ' +
      cfg.fromAmount + ' → ' + cfg.toAmount + ' ' +
      '<span id="exchangeIconTo">' + getResourceIconHtml('currency') + '</span>';
  }

  function renderShopList() {
    var listEl = $('shopList');
    var emptyEl = $('shopListEmpty');
    var items = ShopManager.listShopItems();

    Array.prototype.slice.call(listEl.querySelectorAll('.shop-item')).forEach(function (n) { n.remove(); });

    if (items.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'settings-card shop-item';
      row.style.flexDirection = 'row';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';

      var info = document.createElement('div');
      var capLine = item.cap !== null
        ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">库存 ' + item.currentStock + '/' + item.cap + '</div>'
        : '';
      info.innerHTML =
        '<div style="font-weight:700;">' + getResourceIconHtml(item.priceType) + ' ' + escapeHtml(item.name) + '</div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">' + escapeHtml(item.description) + '</div>' +
        capLine;

      var buyBtn = document.createElement('button');
      buyBtn.type = 'button';
      buyBtn.className = 'btn btn--primary';
      buyBtn.innerHTML = item.price + ' ' + getResourceIconHtml(item.priceType);
      buyBtn.disabled = !item.purchasable;
      buyBtn.style.opacity = item.purchasable ? '1' : '0.5';
      buyBtn.style.flexShrink = '0';
      buyBtn.style.marginLeft = '12px';

      buyBtn.addEventListener('click', function () {
        var res = ShopManager.buyShopItem(item.id);
        if (!res.success) {
          showToast(res.reason === 'stock_cap_reached' ? '库存已达上限' : '资源不足，无法购买');
          return;
        }
        vibrate(20);
        playChime();
        showToast('购买成功：' + item.name);
        renderResourceBar();
        renderShopList();
      });

      row.appendChild(info);
      row.appendChild(buyBtn);
      listEl.appendChild(row);
    });
  }

  function renderShopPanel() {
    renderExchangeCard();
    renderShopList();
  }

  function bindShopStaticEvents() {
    $('exchangeBtn').addEventListener('click', function () {
      var amount = Number($('exchangeAmountInput').value) || 0;
      var res = ShopManager.exchangePrimaryForCurrency(amount);
      var resultEl = $('exchangeResultLabel');
      if (!res.success) {
        resultEl.textContent = res.reason === 'insufficient_primary' ? '主资源不足' : '请输入有效兑换数量';
        return;
      }
      resultEl.textContent = '兑换成功：-' + res.primaryCost + ' / +' + res.currencyGain;
      $('exchangeAmountInput').value = '';
      playChime();
      renderResourceBar();
    });
  }

  /* ------------------------------------------------------------------ *
   * 渲染：统计面板
   * ------------------------------------------------------------------ */

  function renderStatsPanel() {
    var state = DataStore.getState();
    $('statCurrentStreak').textContent = state.streak.current || 0;
    $('statLongestStreak').textContent = state.streak.longest || 0;
    $('statTotalTasks').textContent = state.stats.totalTasksCompleted || 0;
    $('statTotalPrimary').textContent = state.stats.totalPrimaryEarned || 0;
    $('statTotalCurrency').textContent = state.stats.totalCurrencyEarned || 0;
    $('statTotalPrimaryLabel').innerHTML = getResourceIconHtml('primaryResource') + ' 累计获取';
    $('statTotalCurrencyLabel').innerHTML = getResourceIconHtml('currency') + ' 累计获取';
    renderFreezeLog();
  }

  function renderFreezeLog() {
    var listEl = $('freezeLogList');
    var emptyEl = $('freezeLogEmpty');
    var state = DataStore.getState();
    var entries = (state.freezeLog || []).slice().reverse();

    Array.prototype.slice.call(listEl.querySelectorAll('.freeze-log-item')).forEach(function (n) { n.remove(); });

    if (entries.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    entries.forEach(function (entry) {
      var li = document.createElement('li');
      li.className = 'freeze-log-item';
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.padding = '9px 12px';
      li.style.borderRadius = 'var(--radius-sm)';
      li.style.background = 'var(--bg-elevated-3)';
      li.style.fontSize = '13px';
      var tagColor = entry.type === 'auto' ? 'var(--danger-color)' : 'var(--shield-color)';
      var tagText = entry.type === 'auto' ? '自动补救' : '主动使用';
      li.innerHTML =
        '<span>' + escapeHtml(entry.date) + '</span>' +
        '<span style="color:' + tagColor + ';font-weight:600;">' + tagText + '</span>';
      listEl.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------ *
   * 渲染：任务管理面板（含补救横幅）
   * ------------------------------------------------------------------ */

  function renderRescueBanner() {
    var banner = $('taskRescueBanner');
    var next = TaskManager.getNextRescueDay();

    if (!next) {
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');
    $('rescueBannerTitle').textContent = '补救未完成任务';
    $('rescueBannerDate').textContent = next.date + '（' + next.tasks.length + ' 个可补救任务）';
    $('rescueBannerBtn').onclick = function () { openRescueTaskPicker(next); };
  }

  function openRescueTaskPicker(dayEntry) {
    var area = ensureModalFormArea();
    area.innerHTML = '';

    dayEntry.tasks.forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--block btn--ghost';
      btn.innerHTML = escapeHtml(t.name) + ' &nbsp;+' + t.baseResourceReward + ' ' + getResourceIconHtml('primaryResource');
      btn.addEventListener('click', function () {
        var res = TaskManager.rescueTask(t.id, dayEntry.date);
        hideModal();
        if (res.success) {
          vibrate(40);
          playChime();
          showToast(dayEntry.date + ' 补救成功！');
          renderAll();
        } else {
          showToast('补救失败，请重试');
        }
      });
      area.appendChild(btn);
    });

    $('modalTitle').textContent = '补救 ' + dayEntry.date;
    $('modalMessage').textContent = '选择一个任务进行补救（重发火力奖励）：';
    $('modalConfirmBtn').style.display = 'none';
    $('modalCancelBtn').textContent = '取消';
    $('modalCancelBtn').onclick = function () { hideModal(); };
    showModalRaw();
  }

  function numberOrEmpty(v) { return typeof v === 'number' ? v : ''; }

  function openTaskForm(existingTask) {
    var area = ensureModalFormArea();
    area.innerHTML = '';
    var isEdit = !!existingTask;
    var d = existingTask || {};

    function addRow(labelText, inputEl) {
      var wrap = document.createElement('div');
      wrap.className = 'settings-row settings-row--col';
      var label = document.createElement('label');
      label.className = 'settings-row__label';
      label.textContent = labelText;
      wrap.appendChild(label);
      wrap.appendChild(inputEl);
      area.appendChild(wrap);
    }

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'text-input';
    nameInput.placeholder = '任务名称';
    nameInput.value = d.name || '';
    addRow('任务名称', nameInput);

    var typeSelect = document.createElement('select');
    typeSelect.className = 'text-input';
    (CONFIG.taskTypes || []).forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = (CONFIG.taskTypeLabels && CONFIG.taskTypeLabels[t]) || t;
      if (d.type === t) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    addRow('任务类型', typeSelect);

    var rewardInput = document.createElement('input');
    rewardInput.type = 'number';
    rewardInput.min = '0';
    rewardInput.className = 'text-input';
    rewardInput.value = numberOrEmpty(d.baseResourceReward);
    addRow('主资源奖励', rewardInput);

    var currencyInput = document.createElement('input');
    currencyInput.type = 'number';
    currencyInput.min = '0';
    currencyInput.className = 'text-input';
    currencyInput.value = numberOrEmpty(d.currencyReward);
    addRow('货币奖励', currencyInput);

    var targetInput = document.createElement('input');
    targetInput.type = 'number';
    targetInput.min = '1';
    targetInput.className = 'text-input';
    targetInput.value = d.targetCount || 1;
    addRow('周期目标次数（周/月任务生效）', targetInput);

    var startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.className = 'text-input';
    startInput.value = d.startDate || '';
    addRow('生效开始日期（可选）', startInput);

    var endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.className = 'text-input';
    endInput.value = d.endDate || '';
    addRow('生效结束日期（可选）', endInput);

    var enabledRow = document.createElement('div');
    enabledRow.className = 'settings-row';
    var enabledLabel = document.createElement('label');
    enabledLabel.className = 'settings-row__label';
    enabledLabel.textContent = '启用任务';
    var switchLabel = document.createElement('label');
    switchLabel.className = 'switch';
    var enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.checked = d.enabled !== false;
    var track = document.createElement('span');
    track.className = 'switch__track';
    track.innerHTML = '<span class="switch__thumb"></span>';
    switchLabel.appendChild(enabledCheckbox);
    switchLabel.appendChild(track);
    enabledRow.appendChild(enabledLabel);
    enabledRow.appendChild(switchLabel);
    area.appendChild(enabledRow);

    $('modalTitle').textContent = isEdit ? '编辑任务' : '新增任务';
    $('modalMessage').textContent = '';
    $('modalConfirmBtn').style.display = '';
    $('modalConfirmBtn').textContent = isEdit ? '保存' : '创建';
    $('modalCancelBtn').textContent = '取消';

    $('modalConfirmBtn').onclick = function () {
      var payload = {
        name: nameInput.value,
        type: typeSelect.value,
        baseResourceReward: Number(rewardInput.value) || 0,
        currencyReward: Number(currencyInput.value) || 0,
        targetCount: Math.max(1, Number(targetInput.value) || 1),
        startDate: startInput.value || null,
        endDate: endInput.value || null,
        enabled: enabledCheckbox.checked
      };
      var result = isEdit ? TaskManager.updateTask(existingTask.id, payload) : TaskManager.addTask(payload);
      if (!result.success) {
        showToast(result.reason === 'name_required' ? '请填写任务名称' : '保存失败，请重试');
        return;
      }
      hideModal();
      showToast(isEdit ? '任务已更新' : '任务已创建');
      renderAll();
    };
    $('modalCancelBtn').onclick = function () { hideModal(); };
    showModalRaw();
  }

  function renderTaskManagerList() {
    var listEl = $('taskManagerList');
    var emptyEl = $('taskManagerListEmpty');
    var tasks = TaskManager.listTasks();

    Array.prototype.slice.call(listEl.querySelectorAll('.tm-item')).forEach(function (n) { n.remove(); });

    if (tasks.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    tasks.forEach(function (task) {
      var row = document.createElement('div');
      row.className = 'settings-card tm-item';

      var top = document.createElement('div');
      top.className = 'settings-row';

      var titleWrap = document.createElement('div');
      var typeLabel = (CONFIG.taskTypeLabels && CONFIG.taskTypeLabels[task.type]) || task.type;
      titleWrap.innerHTML =
        '<strong>' + escapeHtml(task.name) + '</strong> ' +
        '<span style="color:var(--text-muted);font-size:11px;">[' + escapeHtml(typeLabel) + ']</span>';

      var switchLabel = document.createElement('label');
      switchLabel.className = 'switch';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.enabled;
      checkbox.addEventListener('change', function () {
        TaskManager.setTaskEnabled(task.id, checkbox.checked);
        renderAll();
      });
      var track = document.createElement('span');
      track.className = 'switch__track';
      track.innerHTML = '<span class="switch__thumb"></span>';
      switchLabel.appendChild(checkbox);
      switchLabel.appendChild(track);

      top.appendChild(titleWrap);
      top.appendChild(switchLabel);

      var actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.marginTop = '10px';

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn--ghost';
      editBtn.style.flex = '1';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', function () { openTaskForm(task); });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn--ghost';
      delBtn.style.flex = '1';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', function () {
        showConfirm({
          title: '删除任务',
          message: '确定删除任务「' + task.name + '」吗？该操作不可撤销。',
          confirmText: '删除'
        }).then(function (confirmed) {
          if (!confirmed) return;
          TaskManager.deleteTask(task.id);
          showToast('任务已删除');
          renderAll();
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      row.appendChild(top);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function renderTaskManagerPanel() {
    renderRescueBanner();
    renderTaskManagerList();
  }

  /* ------------------------------------------------------------------ *
   * 渲染：设置面板
   * ------------------------------------------------------------------ */

  function renderSettingsPanel() {
    var state = DataStore.getState();
    var reminder = state.settings.reminder;
    $('reminderToggle').checked = !!reminder.enabled;
    $('webhookUrlInput').value = reminder.webhookUrl || '';
    $('reminderTimeInput').value = reminder.time || '22:30';
    $('dataVersionLabel').textContent = DataStore.DATA_VERSION;
  }

  function bindSettingsEvents() {
    $('reminderToggle').addEventListener('change', function (e) {
      DataStore.mutate(function (s) { s.settings.reminder.enabled = e.target.checked; });
    });

    $('webhookUrlInput').addEventListener('change', function (e) {
      DataStore.mutate(function (s) { s.settings.reminder.webhookUrl = e.target.value.trim(); });
    });

    $('reminderTimeInput').addEventListener('change', function (e) {
      DataStore.mutate(function (s) { s.settings.reminder.time = e.target.value || '22:30'; });
    });

    $('testWebhookBtn').addEventListener('click', function () {
      var url = $('webhookUrlInput').value.trim();
      if (!NotificationManager) { showToast('通知模块未就绪'); return; }
      showToast('正在发送测试消息…');
      NotificationManager.sendTestMessage(url).then(function (res) {
        showToast(res.message);
      });
    });

    $('exportDataBtn').addEventListener('click', function () {
      var res = BackupManager.exportData();
      showToast(res.success ? '已导出：' + res.filename : (res.message || '导出失败'));
    });

    $('importDataBtn').addEventListener('click', function () {
      $('importFileInput').click();
    });

    $('importFileInput').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;

      BackupManager.importFromFile(file, function () {
        return showConfirm({
          title: '导入数据',
          message: '导入将覆盖当前所有进度，确定要继续吗？',
          confirmText: '覆盖导入'
        });
      }).then(function (res) {
        if (res.cancelled) return;
        if (!res.success) {
          showToast('导入失败：' + ((res.errors && res.errors[0]) || '未知错误'));
          return;
        }
        showToast('导入成功');
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 底部 Tab 面板开关
   * ------------------------------------------------------------------ */

  function closeAllPanels() {
    Array.prototype.slice.call(document.querySelectorAll('.tab-panel.open')).forEach(function (p) {
      p.classList.remove('open');
      p.setAttribute('aria-hidden', 'true');
    });
    Array.prototype.slice.call(document.querySelectorAll('.nav-btn.active')).forEach(function (b) {
      b.classList.remove('active');
    });
    $('sheetOverlay').classList.remove('visible');
  }

  function openPanel(name) {
    var panel = document.querySelector('.tab-panel[data-panel="' + name + '"]');
    var navBtn = document.querySelector('.nav-btn[data-tab="' + name + '"]');
    if (!panel) return;

    closeAllPanels();

    if (name === 'shop') renderShopPanel();
    if (name === 'stats') renderStatsPanel();
    if (name === 'taskManager') renderTaskManagerPanel();
    if (name === 'settings') renderSettingsPanel();

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    $('sheetOverlay').classList.add('visible');
    if (navBtn) navBtn.classList.add('active');
  }

  function bindBottomNav() {
    Array.prototype.slice.call(document.querySelectorAll('.nav-btn')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.dataset.tab;
        var panel = document.querySelector('.tab-panel[data-panel="' + tab + '"]');
        if (panel && panel.classList.contains('open')) {
          closeAllPanels();
        } else {
          openPanel(tab);
        }
      });
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-close-panel]')).forEach(function (btn) {
      btn.addEventListener('click', closeAllPanels);
    });

    $('sheetOverlay').addEventListener('click', closeAllPanels);
  }

  /* ------------------------------------------------------------------ *
   * 跨模块事件联动
   * ------------------------------------------------------------------ */

  function bindDomainEvents() {
    document.addEventListener('habitspark:dataImported', function () {
      closeAllPanels();
      renderAll();
      showToast('数据已恢复，界面已刷新');
    });
    document.addEventListener('habitspark:taskRescued', function () {
      renderAll();
    });
    document.addEventListener('habitspark:shopItemPurchased', function () {
      renderResourceBar();
    });
  }

  /* ------------------------------------------------------------------ *
   * 汇总渲染 / 初始化
   * ------------------------------------------------------------------ */

  function renderAll() {
    renderResourceBar();
    renderTaskSidebar();
    renderFlame();
    renderShopPanel();
    renderStatsPanel();
    renderTaskManagerPanel();
    renderSettingsPanel();
  }

  function init() {
    bindBottomNav();
    bindShopStaticEvents();
    bindSettingsEvents();
    bindDomainEvents();
    $('addTaskBtn').addEventListener('click', function () { openTaskForm(null); });
    renderAll();
  }

  /* ------------------------------------------------------------------ *
   * 导出模块
   * ------------------------------------------------------------------ */

  global.UI = {
    init: init,
    render: renderAll,
    showToast: showToast,
    showConfirm: showConfirm
  };

}(typeof window !== 'undefined' ? window : this));