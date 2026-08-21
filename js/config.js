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

    /* ---- 每日免费礼包（见需求文档第八节）
       【改动】固定值改为随机区间：每天领取时在 [primaryResourceMin, primaryResourceMax]
       闭区间内取一个随机整数，由 rewards.js 的 claimDailyGift() 用
       Math.floor(Math.random() * (max - min + 1)) + min 计算。 ---- */
    dailyGift: {
      primaryResourceMin: 1,
      primaryResourceMax: 3,
      currencyReward: 0
    },

    /* ---- 奖励引擎参数（见需求文档第五节） ---- */
    rewards: {
      randomDoubleChance: 0.2,      // 随机双倍概率，仅对任务主资源生效
      streakBonusEnabled: false,    // 预留：连胜加成算子，暂不实现
      achievementBonusEnabled: false, // 预留：成就加成算子，暂不实现

      /* 【新增】周期任务达标连续加成（见 2026-08-21 需求变更）：
         weekly/monthly 任务在某个周期内达到 targetCount 后，进入"加成状态"
         （task.bonusActive = true），该状态会一直持续到某个周期结算时
         发现未达标为止（由 tasks.js 在每次跨周期时逐任务检查上一周期是否
         达标来维护这个开关，本文件只提供倍率数值）。
         叠加规则：periodBonus 与 randomDoubleChance 的双倍是【相乘】关系
         （例如加成期间又触发双倍：1.5 × 2 = 3 倍），只作用于任务主资源，
         不影响货币奖励——与随机双倍的既有规则保持一致。 */
      periodBonusMultiplier: 1.5
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

    /* ==========================================================================
       【新增】皮肤/主题系统（见 2026-08-21 需求变更）

       每套皮肤 = 一组 CSS 变量（覆盖 style.css 里 :root 定义的颜色变量，
       切换时由 ui.js 用 document.documentElement.style.setProperty() 逐个
       写入）+ 一组可选的火苗视频素材（不配置则自动回退到原来的 SVG 火苗
       动画，不会报错也不会白屏）。

       ------------------------------------------------------------------
       火苗视频素材命名与路径约定（放在仓库根目录的 assets/skins/<皮肤id>/ 下）：

         assets/skins/<皮肤id>/flame-idle.mp4        今日尚未打卡时的循环视频
         assets/skins/<皮肤id>/flame-transition.mp4  未达标→达标那一刻播放一次的过渡动画
         assets/skins/<皮肤id>/flame-achieved.mp4     今日已达标后的循环视频
         assets/skins/<皮肤id>/flame-bonus.mp4        已达标状态下又完成任务时播放一次的追加动作

       其中 flame-idle / flame-achieved 会循环播放（loop=true）；
       flame-transition / flame-bonus 只播一次，播完后 ui.js 会自动切回
       flame-achieved 循环，不需要额外配置。

       四个文件不要求全部提供：某皮肤的 flame 字段整体留空（或设为 null）
       时，该皮肤就是纯 CSS 换色，中间还是原来的 SVG 火苗动画。若只想做
       "追加动作"这一项，也可以只在 flame 里写 bonus 一个字段，其余留空，
       ui.js 对每个 kind 都是按需查找，缺失的 kind 不会报错、只是不生效。

       格式建议：优先用 MP4（H.264），兼容性最好；由于 <video> 标签不支持
       透明通道，如果素材本身背景不透明，建议把背景做成与 App 背景色一致
       的纯色 #0f0f12（或该皮肤自己的 --bg-base 颜色），这样视觉上才能像
       是"浮在深色背景上"而不是一块方形贴图。分辨率建议正方形、边长
       ≥300px 即可（显示区域本身只有约 150×180px）。
       ========================================================================== */
    /* ---- 皮肤/主题系统 ---- */
    /* ---- 皮肤/主题系统 ---- */
  themes: {
    list: [
      {
        id: 'default',
        name: '默认黑金',
        vars: { /* ...原有 CSS 变量... */ },
        resources: null, // 为 null 时自动使用全局默认图标（🔥 💎 🛡️）
        flame: null
      },
      {
        id: 'qiaohu-light',
        name: '巧虎（暖白明亮）',
        vars: {
          '--primary-color': '#ff9800',
          '--flame-orange': '#ffa726',
          '--flame-red': '#ff5722',
          '--currency-color': '#29b6f6',
          '--shield-color': '#26a69a',
          '--bg-base': '#f5f7fa',
          '--bg-elevated': '#ffffff',
          '--bg-elevated-2': '#edf2f7',
          '--bg-elevated-3': '#e2e8f0',
          '--text-primary': '#1a202c',
          '--text-muted': '#718096'
        },
        /* 巧虎专属资源定制：把火力换成星星⭐，也可传入图片路径如 'assets/skins/qiaohu/star.png' */
        resources: {
          primaryResource: { name: '星星', icon: '⭐' },
          currency:        { name: '爱心', icon: '❤️' },
          streakFreeze:    { name: '巧虎饼干', icon: '🍪' }
        },
        flame: {
          idle: 'assets/skins/video-flame/flame-idle.mp4',
          transition: 'assets/skins/video-flame/flame-transition.mp4',
          achieved: 'assets/skins/video-flame/flame-achieved.mp4',
          bonus: 'assets/skins/video-flame/flame-bonus.mp4'
        }
      }
    ]
  }
  };

  // 挂载到全局，供其余脚本（无模块打包器，按顺序以 <script> 标签加载）使用
  global.CONFIG = CONFIG;

}(typeof window !== 'undefined' ? window : this));