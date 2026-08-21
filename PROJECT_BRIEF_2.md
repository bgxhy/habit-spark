# Habit Spark 习惯激励 App —— 项目说明文档

> 本文档用于快速向 AI（或新接手的开发者）说明项目背景、架构、数据结构与已知问题， 便于在新的对话中无需重新贴全部代码即可继续协作调试/开发。

***

## 1. 项目概况

* **产品**：一个纯前端（无后端、无构建工具）的习惯打卡激励 Web App，深色黑金/火焰视觉风格。

* **技术栈**：原生 HTML + CSS + JavaScript（ES5 风格函数，无框架、无 npm 依赖），数据持久化用浏览器 `localStorage`。

* **目标形态**：网页直接使用；也可作为 PWA "添加到主屏幕"；也可用 PWABuilder 等工具打包成安卓 APK。

* **核心玩法**：用户创建任务（一次性/每日/每周/每月），长按环形按钮打卡获得"火力"资源，累计连续打卡形成"连胜天数"，连胜可被"保护卡"保护，支持任务补救、资源兑换、企业微信 Webhook 每日提醒等。

***

## 2. 文件结构与加载顺序

```
├── index.html         # 页面结构、PWA meta、Tab 面板骨架
├── manifest.json       # PWA / 安卓打包配置
├── style.css            # 全局样式，CSS 变量驱动主题
└── js/
    ├── config.js         # 【必须最先加载】全局配置中心
    ├── data.js            # 【第2】LocalStorage 持久化 + 数据结构 + 版本迁移
    ├── tasks.js            # 【第3】任务 CRUD、周期判定、任务补救
    ├── rewards.js           # 【第4】奖励计算引擎、每日礼包
    ├── streak.js             # 【第5】连胜链计算、保护卡、漏打检测
    ├── shop.js                # 【第6】兑换、商店购买
    ├── collection.js           # 【第7】收藏/拼图系统占位（未实现）
    ├── backup.js                # 【第8】数据导出/导入
    ├── notification.js           # 【第9】企业微信 Webhook 每日提醒
    ├── ui.js                      # 【第10】渲染与交互（DOM操作、动画、音效）
    └── app.js                      # 【最后】启动编排，调用上面所有模块的 init
```

`index.html` 末尾按上述顺序用 `<script src="js/xxx.js"></script>` 依次引入。**加载顺序不能乱**，后面的文件会在自己的 IIFE 里读 `window.CONFIG`、`window.DataStore` 等前面文件挂到 `window` 上的对象。

***

## 3. 架构约定（写代码前必须知道的规则）

1. **每个 JS 文件都是一个立即执行函数（IIFE）**，通过 `global.XxxManager = {...}` 的形式把自己的公共方法挂到 `window` 上，模块之间只通过这些暴露出来的方法通信，**不允许直接访问其他模块的内部私有函数**。

2. **唯一数据源**：所有状态都在 `DataStore`（`data.js`）管理，存在 `localStorage` 的 `habit_spark_data` 这个 key 下（整个 App 只有这一个 key）。任何模块要改数据，必须用 `DataStore.mutate(function(s){ ... })`，不能自己拼 `localStorage.setItem`。

3. **事件驱动重渲染**：业务模块（`tasks.js`/`rewards.js`/`shop.js`/`backup.js`）在数据变化后会 `document.dispatchEvent(new CustomEvent('habitspark:xxx', ...))`，`ui.js` 监听这些事件后统一调用重渲染方法，UI 不会被业务模块直接调用来渲染。

4. **配置与文案禁止硬编码**：资源名称（火力/钻石/保护卡）、图标、任务默认奖励值、商店价格、提醒消息模板等，全部从 `config.js` 的 `CONFIG` 对象读取，方便未来换主题/换文案。

5. **周期任务不做"清零重置"**：任务打卡记录 `completions: {'YYYY-MM-DD': count}` 永久保留原始记录，"当前周期进度"是每次现算（对当日/自然周/自然月区间求和），不是物理清零。

6. **连胜是"全量重算"而非"累加"**：`streak.current` / `streak.longest` 不会在某次操作里 `+1`，而是每次调用 `StreakManager` 的重算方法时，从 `streak.activeDates`（一个 `{日期: true}` 的达标日期集合）整体重新扫描计算出来。这样无论是正常打卡、漏打自动检测消耗保护卡、还是过去补救，只要把对应日期标记为 `true`，连胜数字都会自动追溯修正。

***

## 4. 各模块职责一览

| 文件                | 暴露的全局对象               | 核心职责                                                                                                                 |
| ----------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `config.js`       | `CONFIG`              | 资源名称/图标、任务默认奖励、随机双倍概率、连胜/保护卡参数、商店价格、兑换比例、提醒消息模板                                                                      |
| `data.js`         | `DataStore`           | 默认数据结构、`localStorage` 读写、`DATA_VERSION` 版本迁移、`mutate/getState` 等统一读写 API                                             |
| `tasks.js`        | `TaskManager`         | 任务增删改查、周期进度计算、打卡记录、过去3天任务补救                                                                                          |
| `rewards.js`      | `RewardEngine`        | 基础奖励/20%随机双倍/货币奖励算子、"打卡+发奖励"编排入口、每日礼包                                                                                |
| `streak.js`       | `StreakManager`       | 连胜链重新计算、连续5天发保护卡、漏打自动检测（消耗保护卡/紧急买卡/断裂）                                                                               |
| `shop.js`         | `ShopManager`         | 火力→钻石单向兑换、商店商品购买（含保护卡库存上限校验）                                                                                         |
| `collection.js`   | `CollectionManager`   | 收藏/拼图系统占位接口（V1/V2 明确不实现，调用即返回 `not_implemented`）                                                                     |
| `backup.js`       | `BackupManager`       | 导出当前数据为 JSON 文件、导入 JSON 备份（校验结构+触发覆盖确认）                                                                              |
| `notification.js` | `NotificationManager` | 轮询检查提醒时间、当日是否达标、企业微信 Webhook 推送、防重复发送                                                                                |
| `ui.js`           | `UI`                  | 所有 DOM 渲染、长按打卡动画、Web Audio 音效、震动、Tab 面板切换、表单弹窗                                                                       |
| `app.js`          | （无对外暴露，自执行）           | 启动编排：`DataStore.load()` → `StreakManager.init()` → `UI.init()`（或 `.render()`，见下方已知问题）→ `NotificationManager.start()` |

***

## 5. 数据结构（DataStore 里存的完整 JSON 形状）

```js
{
  meta: { dataVersion: 1, createdAt, lastOpenedDate, lastSavedAt },
  resources: { primaryResource: 0, currency: 0, streakFreeze: 0 },
  tasks: [
    {
      id, name, type,              // type: 'once'|'daily'|'weekly'|'monthly'
      baseResourceReward, currencyReward, targetCount,
      enabled, startDate, endDate, createdAt,
      completions: { 'YYYY-MM-DD': count }   // 原始打卡记录，永不清零
    }
  ],
  streak: {
    current, longest,
    lastCheckedDate,               // 漏打检测游标
    activeDates: { 'YYYY-MM-DD': true }  // 达标日期集合，唯一真相来源
  },
  freezeLog: [ { date, type: 'auto'|'manual', note } ],  // 保护卡使用记录
  exchangeLog: [ { date, fromAmount, toAmount } ],
  stats: { totalTasksCompleted, totalPrimaryEarned, totalCurrencyEarned },
  dailyGift: { lastClaimedDate },
  settings: {
    reminder: { enabled, webhookUrl, time, lastNotificationSentDate },
    theme: 'default'
  }
}
```

存储 key：`localStorage` 的 `habit_spark_data`（可在浏览器控制台用 `localStorage.getItem('habit_spark_data')` 查看）。

***

## 6. 自定义事件列表（模块间解耦通信）

| 事件名                            | 派发者          | 用途                                        |
| ------------------------------ | ------------ | ----------------------------------------- |
| `habitspark:taskCompleted`     | `rewards.js` | 打卡+发奖励完成后，通知 `streak.js` 重算连胜、`ui.js` 重渲染 |
| `habitspark:taskRescued`       | `tasks.js`   | 补救完成后，通知 `streak.js` 追溯恢复连胜               |
| `habitspark:dataImported`      | `backup.js`  | 导入备份覆盖数据后，通知全体重新渲染/重算                     |
| `habitspark:shopItemPurchased` | `shop.js`    | 商店购买成功后通知重渲染                              |
| `habitspark:dailyGiftClaimed`  | `rewards.js` | 每日礼包领取后通知重渲染                              |

***

## 7. 已知问题 / 排查记录（重要，新对话请先看这里）

### 问题：连胜天数每次刷新/重启都显示 0

**排查过程**：

1. 最初怀疑是 `app.js` 调用 `StreakManager.init()`，但当时的 `streak.js` 只导出了 `checkMissedDays()`，没有 `init` → 已通过在 `streak.js` 导出对象里加 `init: checkMissedDays,` 别名修复。

2. 用户自行修改代码后，问题依然存在。经控制台报错定位，发现**新的不一致**：

   * 当前 `ui.js` 导出的对象是 `{ init, render, showToast, showConfirm }`（方法叫 `render`）

   * 但 `app.js` 的 `handleVisibilityChange()`（页面从后台切回前台时触发）里调用的是 `global.UI.renderAll()`

   * 名字对不上 → 报错 `TypeError: global.UI.renderAll is not a function`

   * **尚未确认**这是否是"重启清零"的根本原因，还是另一个独立问题（切前台报错 ≠ 首次加载报错，两者触发时机不同）。

**排查方法论（后续遇到类似问题可复用）**：

1. 打开浏览器 F12 控制台，看有没有红色报错，展开"N 个错误"看全部条目（不要只看默认展示的前几条）。

2. 执行 `localStorage.getItem('habit_spark_data')`，检查 `streak.current` 在 `localStorage` 里存的值是否正确：

   * 如果存储里的值就是错的 → 问题在"写入"环节（`rewards.js`/`tasks.js`/`streak.js` 的 `mutate` 逻辑）。

   * 如果存储里是对的、但页面显示不对 → 问题在"读取/渲染"环节（多半是 `ui.js` 和 `app.js` 之间方法名对不上，或 `UI.init()`/`render()` 根本没执行到）。

3. 执行 `console.log(window.UI)` / `console.log(window.StreakManager)` 等，直接看某个模块现在到底导出了哪些方法名，跟调用方是否一致。

**给 AI 的建议排查顺序**：先要这两项信息（控制台完整报错 + `localStorage` 里的原始 JSON），再决定改哪一行，不要凭猜测直接给代码。

***

## 8. 使用方法摘要

* 本地预览：把所有文件放同一目录，建议起个本地 HTTP 服务器访问（而非直接双击 `index.html`），因为 `file://` 协议下部分浏览器会限制 `fetch`（导入导出、Webhook 请求）。

* PWA：部署到 HTTPS 后，浏览器"添加到主屏幕"。

* 打包 APK：部署好 HTTPS 地址后丢进 PWABuilder 之类工具。

* `manifest.json` 引用的 `assets/icon-192.png` 等图标文件**尚未提供**，需要自行准备图片放进 `assets/` 目录，否则只是没有自定义图标，不影响功能。

***

## 9. 尚未实现 / 明确留空的部分

* `collection.js`（收藏/拼图系统）：所有方法调用即返回 `{ success:false, reason:'not_implemented' }`，是需求文档明确要求的占位接口，不是 bug。

* 图标资源（`assets/*.png`）：只有路径引用，没有实际图片文件。

* 连胜加成 / 成就加成算子（`rewards.js` 里的 `calculateStreakBonus` / `calculateAchievementBonus`）：按需求文档要求做成占位算子，固定返回无加成，供未来版本实现。
