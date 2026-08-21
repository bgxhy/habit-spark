/* ==========================================================================
   Habit Spark - config.js
   全局配置中心。所有业务文件（tasks.js / rewards.js / streak.js / shop.js /
   notification.js / ui.js ...）读取本文件获取文字、图标与数值，
   禁止在业务逻辑中硬编码文字/图标/价格。
   本文件不依赖任何其他脚本，须最先加载。
   ========================================================================== */

(function (global) {
  'use strict';

  /**
   * 判断图标字符串是图片路径还是 emoji 文本。
   * UI 层据此决定渲染 <img> 还是纯文本。
   * @param {string} iconStr
   * @returns {boolean}
   */
  function isImageIcon(iconStr) {
    return typeof iconStr === 'string' &&
      /^(https?:\/\/|\.{0,2}\/|assets\/|data:image)/i.test(iconStr.trim());
  }

  var CONFIG = {

    app: {
      name: 'Habit Spark 习惯激励',
      shortName: 'Habit Spark',
      dataVersion: 1
    },

    /* ---- 资源系统（完全配置化，见需求文档第三节） ---- */
    resources: {
      primaryResource: { key: 'primaryResource', name: '火力', icon: '🔥' },
      currency:        { key: 'currency',        name: '钻石', icon: '💎' },
      streakFreeze:    { key: 'streakFreeze',     name: '连胜保护卡', icon: '🛡️' }
    },

    /* 图标模式判断工具，供 ui.js 调用 */
    isImageIcon: isImageIcon,

    /* ---- 任务系统默认值（见需求文档第四节） ---- */
    taskTypes: ['once', 'daily', 'weekly', 'monthly'],

    taskTypeLabels: {
      once: '一次性',
      daily: '每日',
      weekly: '每周',
      monthly: '每月'
    },

    taskDefaults: {
      once:    { baseResourceReward: 20,  currencyReward: 0, targetCount: 1 },
      daily:   { baseResourceReward: 10,  currencyReward: 0, targetCount: 1 },
      weekly:  { baseResourceReward: 30,  currencyReward: 1, targetCount: 1 },
      monthly: { baseResourceReward: 100, currencyReward: 5, targetCount: 1 }
    },

    /* ---- 每日免费礼包（见需求文档第八节） ---- */
    dailyGift: {
      primaryResourceReward: 10,
      currencyReward: 0
    },

    /* ---- 奖励引擎参数（见需求文档第五节） ---- */
    rewards: {
      randomDoubleChance: 0.2,      // 随机双倍概率，仅对任务主资源生效
      streakBonusEnabled: false,    // 预留：连胜加成算子，暂不实现
      achievementBonusEnabled: false // 预留：成就加成算子，暂不实现
    },

    /* ---- 连胜与保护卡（见需求文档第六节） ---- */
    streak: {
      freezeEarnThreshold: 5,   // 连续达标满 N 天自动获得 1 张保护卡
      freezeStockCap: 2,        // 保护卡库存上限
      autoBuyPriceMultiplier: 1.2 // 无保护卡时"紧急买卡"按商店价 × 倍率扣主资源
    },

    /* ---- 任务补救（见需求文档第十节） ---- */
    rescue: {
      maxLookbackDays: 3 // 任务管理界面可补救过去 N 天未完成任务
    },

    /* ---- 商店（见需求文档第七节） ---- */
    shop: {
      items: [
        {
          id: 'buy_streak_freeze',
          name: '连胜保护卡',
          icon: '🛡️',
          description: '守护一天连胜不中断',
          priceType: 'primaryResource', // 'primaryResource' | 'currency'
          price: 50,
          grants: { streakFreeze: 1 },
          stockCapField: 'streakFreeze' // 受 streak.freezeStockCap 上限约束
        }
      ]
    },

    /* ---- 单向兑换（见需求文档第七节） ---- */
    exchange: {
      fromResource: 'primaryResource',
      toResource: 'currency',
      fromAmount: 100, // 100 火力 → 1 钻石
      toAmount: 1
    },

    /* ---- 本地存储 ---- */
    storage: {
      key: 'habit_spark_data'
    },

    /* ---- 每日提醒 / 企业微信 Webhook（见需求文档第十二节） ---- */
    reminder: {
      enabledDefault: false,
      defaultTime: '22:30',
      defaultWebhookUrl: '',
      pollingIntervalMs: 30000, // 轮询检查频率：30 秒
      /**
       * 生成企业微信 Webhook 请求体（markdown 消息）。
       * @param {number} streakDays 当前连胜天数
       * @param {string} time 提醒设定时间，如 "22:30"
       * @returns {object} 可直接 JSON.stringify 后 POST 的请求体
       */
      messageTemplate: function (streakDays, time) {
        var t = time || CONFIG.reminder.defaultTime;
        var content =
          '### ⚠️ **Habit Spark - 连胜断裂预警！**\n' +
          '> 亲爱的玩家，今晚 **' + t + '** 检查到您今日尚未完成任何打卡任务！\n' +
          '> \n' +
          '> 当前连胜：<font color="warning">**' + streakDays + ' 天**</font>\n' +
          '> 请尽快打开应用完成打卡，守护你的连胜记录！🔥';
        return {
          msgtype: 'markdown',
          markdown: { content: content }
        };
      },
      /**
       * 测试消息请求体（点击"发送测试消息"按钮时使用）。
       * @returns {object}
       */
      testMessageTemplate: function () {
        var content =
          '### ✅ **Habit Spark - 测试消息**\n' +
          '> 这是一条测试消息，说明你的 Webhook 配置已生效！';
        return {
          msgtype: 'markdown',
          markdown: { content: content }
        };
      }
    },

    /* ---- 数据版本与扩展接口（见需求文档第十五节） ---- */
    dataVersion: 1,

    /* ---- 主题/多分身扩展预留：替换本对象即可切换全局文案与图标 ---- */
    theme: {
      id: 'default',
      primaryColorVar: '--primary-color'
    }
  };

  // 挂载到全局，供其余脚本（无模块打包器，按顺序以 <script> 标签加载）使用
  global.CONFIG = CONFIG;

}(typeof window !== 'undefined' ? window : this));
