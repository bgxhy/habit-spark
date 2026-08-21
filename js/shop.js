/* ==========================================================================
   Habit Spark - shop.js
   商店与兑换（见需求文档第七节）：主资源单向兑换货币、商店商品购买
   （含保护卡库存上限检查）。均为普通点击操作，不涉及长按/随机双倍。
   依赖 config.js / data.js（须先加载）。
   ========================================================================== */

(function (global) {
  'use strict';

  var CONFIG = global.CONFIG || {};
  var DataStore = global.DataStore;

  if (!DataStore) {
    console.error('[Shop] 未检测到 DataStore，请确认 data.js 已先于 shop.js 加载');
  }

  /* ------------------------------------------------------------------ *
   * 单向兑换：主资源 → 高级货币
   * ------------------------------------------------------------------ */

  function getExchangeConfig() {
    var cfg = CONFIG.exchange || {};
    return {
      fromResource: cfg.fromResource || 'primaryResource',
      toResource: cfg.toResource || 'currency',
      fromAmount: cfg.fromAmount || 100,
      toAmount: cfg.toAmount || 1
    };
  }

  /**
   * 按输入的主资源数量计算可兑换到的货币数量（仅整数倍兑换，不足一组的
   * 余量不消耗）。不修改任何数据，纯计算供 UI 实时预览。
   * @param {number} inputAmount 用户输入的主资源数量
   * @returns {{sets:number, primaryCost:number, currencyGain:number}}
   */
  function calcExchange(inputAmount) {
    var cfg = getExchangeConfig();
    var amount = Number(inputAmount) || 0;
    var sets = amount > 0 ? Math.floor(amount / cfg.fromAmount) : 0;
    return {
      sets: sets,
      primaryCost: sets * cfg.fromAmount,
      currencyGain: sets * cfg.toAmount
    };
  }

  /**
   * 执行一次兑换：主资源 → 货币，单向不支持反向兑换。
   * @param {number} inputAmount 用户输入的主资源数量
   * @returns {{success:boolean, primaryCost?:number, currencyGain?:number, reason?:string}}
   */
  function exchangePrimaryForCurrency(inputAmount) {
    var calc = calcExchange(inputAmount);

    if (calc.sets <= 0) {
      return { success: false, reason: 'amount_too_low' };
    }

    var state = DataStore.getState();
    var cfg = getExchangeConfig();

    if ((state.resources[cfg.fromResource] || 0) < calc.primaryCost) {
      return { success: false, reason: 'insufficient_primary' };
    }

    var todayKey = DataStore.todayKey();

    DataStore.mutate(function (s) {
      s.resources[cfg.fromResource] -= calc.primaryCost;
      s.resources[cfg.toResource] = (s.resources[cfg.toResource] || 0) + calc.currencyGain;
      s.exchangeLog.push({
        date: todayKey,
        fromAmount: calc.primaryCost,
        toAmount: calc.currencyGain
      });
    });

    return { success: true, primaryCost: calc.primaryCost, currencyGain: calc.currencyGain };
  }

  function getExchangeLog() {
    return DataStore.getState().exchangeLog.slice();
  }

  /* ------------------------------------------------------------------ *
   * 商店商品
   * ------------------------------------------------------------------ */

  function getShopItemConfig(itemId) {
    var items = (CONFIG.shop && CONFIG.shop.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === itemId) return items[i];
    }
    return null;
  }

  /**
   * 若商品配置了 stockCapField（例如保护卡受 streakFreeze 库存上限约束），
   * 返回对应的库存上限数值；否则返回 null 表示不受库存上限限制。
   * @param {object} item
   * @returns {number|null}
   */
  function getStockCap(item) {
    if (!item || !item.stockCapField) return null;
    if (item.stockCapField === 'streakFreeze') {
      return (CONFIG.streak && CONFIG.streak.freezeStockCap) || 2;
    }
    return null;
  }

  /**
   * 列出商店全部商品及其当前可购买状态，供商店面板渲染。
   * @returns {Array<object>}
   */
  function listShopItems() {
    var state = DataStore.getState();
    var items = (CONFIG.shop && CONFIG.shop.items) || [];

    return items.map(function (item) {
      var cap = getStockCap(item);
      var currentStock = item.stockCapField ? (state.resources[item.stockCapField] || 0) : null;
      var atCap = cap !== null && currentStock !== null && currentStock >= cap;
      var affordable = (state.resources[item.priceType] || 0) >= item.price;

      return {
        id: item.id,
        name: item.name,
        icon: item.icon,
        description: item.description || '',
        priceType: item.priceType,
        price: item.price,
        cap: cap,
        currentStock: currentStock,
        atCap: atCap,
        purchasable: affordable && !atCap
      };
    });
  }

  /**
   * 购买商店商品：校验余额是否充足、是否受库存上限约束，通过后扣款并
   * 发放商品配置的 grants。
   * @param {string} itemId
   * @returns {{success:boolean, item?:object, reason?:string, cap?:number, current?:number}}
   */
  function buyShopItem(itemId) {
    var item = getShopItemConfig(itemId);
    if (!item) return { success: false, reason: 'not_found' };

    var state = DataStore.getState();
    var priceType = item.priceType;
    var price = item.price || 0;

    if ((state.resources[priceType] || 0) < price) {
      return { success: false, reason: 'insufficient_funds' };
    }

    var cap = getStockCap(item);
    if (cap !== null) {
      var grantKey = item.stockCapField;
      var currentStock = state.resources[grantKey] || 0;
      var grantAmount = (item.grants && item.grants[grantKey]) || 0;
      if (currentStock + grantAmount > cap) {
        return { success: false, reason: 'stock_cap_reached', cap: cap, current: currentStock };
      }
    }

    DataStore.mutate(function (s) {
      s.resources[priceType] -= price;
      Object.keys(item.grants || {}).forEach(function (resKey) {
        s.resources[resKey] = (s.resources[resKey] || 0) + item.grants[resKey];
      });
    });

    try {
      document.dispatchEvent(new CustomEvent('habitspark:shopItemPurchased', {
        detail: { itemId: itemId, item: item }
      }));
    } catch (e) {
      console.error('[Shop] 派发购买完成事件失败', e);
    }

    return { success: true, item: item };
  }

  /* ------------------------------------------------------------------ *
   * 导出模块
   * ------------------------------------------------------------------ */

  global.ShopManager = {
    // 兑换
    getExchangeConfig: getExchangeConfig,
    calcExchange: calcExchange,
    exchangePrimaryForCurrency: exchangePrimaryForCurrency,
    getExchangeLog: getExchangeLog,

    // 商店
    listShopItems: listShopItems,
    getShopItemConfig: getShopItemConfig,
    buyShopItem: buyShopItem
  };

}(typeof window !== 'undefined' ? window : this));
