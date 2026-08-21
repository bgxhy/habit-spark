/* ==========================================================================
   Habit Spark - app.js
   全局入口：按正确顺序完成一次性初始化，并绑定极少量跨模块的全局事件
   （错误兜底、页面重新可见时的追赶检查）。本文件是所有模块加载完成后
   最后执行的"总装配"环节，不包含任何业务逻辑本身。

   初始化顺序（严格如下，前者是后者的前提）：
   1. DataStore.load()           读取/迁移本地数据到内存
   2. StreakManager.init()       漏打自动检测 + 连胜重新计算
   3. UI.init()                  缓存 DOM、绑定交互、首次渲染
   4. NotificationManager.start()启动每日提醒轮询
   ========================================================================== */

(function (global) {
  'use strict';

  /**
   * 依次校验全部依赖模块是否已挂载到 window，缺失时在控制台给出明确提示，
   * 方便排查 <script> 引入顺序问题，而不是让后续调用抛出隐晦的报错。
   * @returns {boolean}
   */
  function checkDependencies() {
    var required = [
      'CONFIG', 'DataStore', 'TaskManager', 'RewardEngine',
      'StreakManager', 'ShopManager', 'BackupManager', 'NotificationManager', 'UI'
    ];
    var missing = required.filter(function (name) { return !global[name]; });

    if (missing.length > 0) {
      console.error('[App] 缺少以下模块，请检查 index.html 中 <script> 的引入顺序：' + missing.join(', '));
      return false;
    }
    return true;
  }

  /**
   * 应用启动主流程。
   */
  function bootstrap() {
    if (!checkDependencies()) return;

    try {
      // 1. 加载并迁移本地数据
      global.DataStore.load();

      // 2. 漏打自动检测（保护卡抵扣 / 紧急买卡）+ 连胜重新计算
      global.StreakManager.init();

      // 3. 渲染主界面、绑定交互（长按打卡、Tab 切换、设置表单等）
      global.UI.init();

      // 4. 启动每日提醒轮询（企业微信 Webhook）
      global.NotificationManager.start();
    } catch (e) {
      console.error('[App] 初始化过程中发生错误', e);
    }
  }

  /**
   * 页面从后台切回前台时，补跑一次漏打检测 + 重新渲染。
   * 覆盖"应用常驻后台跨天，用户切回前台"但轮询定时器可能被系统挂起的场景。
   */
  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (!checkDependencies()) return;

    try {
      global.StreakManager.init();
      global.NotificationManager.checkAndTrigger();
      global.UI.renderAll();
    } catch (e) {
      console.error('[App] 前台恢复检查失败', e);
    }
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
      // DOM 已就绪（脚本置于 </body> 前时的常见情况），直接启动
      bootstrap();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  init();

}(typeof window !== 'undefined' ? window : this));
