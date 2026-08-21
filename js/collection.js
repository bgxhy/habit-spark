/* ==========================================================================
   Habit Spark - collection.js
   收藏/拼图系统【预留接口占位】——见需求文档第十五节，V1/V2 均不完整实现。
   本文件仅固定对外接口形状，供未来版本填充真实逻辑；当前所有方法均
   明确返回"未启用/未实现"，不产生任何数据副作用，也不会被其他模块
   依赖调用（app.js 不会在初始化流程中调用本文件）。

   预留数据结构（尚未加入 data.js 的默认状态，正式实现时需在 data.js
   的 createDefaultData() 与 migrateData() 中一并补充，以完成版本迁移）：
   collection: {
     items: {},        // 已收集的卡片/拼图碎片：{ itemId: count }
     drawHistory: []    // 抽卡记录：{ date, poolId, resultItemId }
   }
   ========================================================================== */

(function (global) {
  'use strict';

  /**
   * 收藏/拼图系统当前是否启用。V1/V2 固定返回 false。
   * @returns {boolean}
   */
  function isEnabled() {
    return false;
  }

  /**
   * 【预留】抽卡接口。未实现，调用不产生任何数据变更。
   * @param {string} poolId 卡池标识
   * @returns {{success:boolean, reason:string}}
   */
  function draw(poolId) {
    console.warn('[Collection] 收藏/拼图系统尚未实现（V1/V2 预留接口），poolId=' + poolId);
    return { success: false, reason: 'not_implemented' };
  }

  /**
   * 【预留】获取收藏/拼图收集进度。未实现，始终返回空进度。
   * @returns {{success:boolean, reason:string, items:object, totalCollected:number}}
   */
  function getCollectionProgress() {
    console.warn('[Collection] 收藏/拼图系统尚未实现（V1/V2 预留接口）');
    return { success: false, reason: 'not_implemented', items: {}, totalCollected: 0 };
  }

  /**
   * 【预留】判定某个收藏套装是否集齐。未实现，始终返回未集齐。
   * @param {string} setId 套装标识
   * @returns {{success:boolean, reason:string, complete:boolean}}
   */
  function checkSetComplete(setId) {
    console.warn('[Collection] 收藏/拼图系统尚未实现（V1/V2 预留接口），setId=' + setId);
    return { success: false, reason: 'not_implemented', complete: false };
  }

  /* ------------------------------------------------------------------ *
   * 导出模块
   * ------------------------------------------------------------------ */

  global.CollectionManager = {
    isEnabled: isEnabled,
    draw: draw,
    getCollectionProgress: getCollectionProgress,
    checkSetComplete: checkSetComplete
  };

}(typeof window !== 'undefined' ? window : this));
