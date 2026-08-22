/* ==========================================================================
   Habit Spark - sync.js
   云端同步（Supabase）：把本地 DataStore 的完整状态同步一份到云端表，
   供云端定时任务（Edge Function）读取判断是否需要发送企业微信提醒。
   本地 localStorage 仍是权威数据源，云端只是"只读副本"，不会反向覆盖
   本地数据（避免网络问题时把本地进度冲掉）。
   依赖 config.js（须先加载）。直接用 fetch 调 Supabase 的 REST API
   （PostgREST），不引入额外的 supabase-js 库，保持无构建工具原则。
   ========================================================================== */

(function (global) {
  'use strict';

  var CONFIG = global.CONFIG || {};
  var syncCfg = CONFIG.sync || {};

  if (!syncCfg.supabaseUrl || !syncCfg.supabaseAnonKey) {
    console.warn('[Sync] 未配置 supabaseUrl / supabaseAnonKey，云端同步功能不会生效');
  }

  var _debounceTimer = null;
  var _pushInFlight = false;
  var _pendingPushAfterInFlight = false;

  function buildHeaders(extra) {
    var headers = {
      'apikey': syncCfg.supabaseAnonKey,
      'Authorization': 'Bearer ' + syncCfg.supabaseAnonKey,
      'Content-Type': 'application/json'
    };
    if (extra) {
      Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });
    }
    return headers;
  }

  /**
   * 实际执行一次上传（upsert）。使用 PostgREST 的
   * Prefer: resolution=merge-duplicates 实现"存在则更新，不存在则插入"。
   * @returns {Promise<boolean>} 是否成功
   */
  function doPush() {
    if (!syncCfg.supabaseUrl || !syncCfg.supabaseAnonKey) return Promise.resolve(false);
    if (!global.DataStore) return Promise.resolve(false);

    var state = global.DataStore.getState();
    var url = syncCfg.supabaseUrl + '/rest/v1/' + syncCfg.tableName + '?on_conflict=id';

    var body = [{
      id: syncCfg.rowId || 'default',
      data: state,
      updated_at: new Date().toISOString()
    }];

    return fetch(url, {
      method: 'POST',
      headers: buildHeaders({
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      }),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          console.error('[Sync] 上传失败，状态码 ' + res.status + '：' + text);
          return false;
        });
      }
      return true;
    }).catch(function (e) {
      console.error('[Sync] 上传请求异常（可能是网络问题）', e);
      return false;
    });
  }

  /**
   * 防抖触发一次上传：短时间内多次调用只会实际发出最后一次请求；
   * 若上一次请求还在进行中，会在其完成后再补发一次，保证最终数据是最新的。
   */
  function push() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(function () {
      if (_pushInFlight) {
        _pendingPushAfterInFlight = true;
        return;
      }
      _pushInFlight = true;
      doPush().finally(function () {
        _pushInFlight = false;
        if (_pendingPushAfterInFlight) {
          _pendingPushAfterInFlight = false;
          push();
        }
      });
    }, syncCfg.pushDebounceMs || 1500);
  }

  /**
   * 立即执行一次上传，不走防抖（用于手动"立即同步"场景，比如设置页按钮）。
   * @returns {Promise<boolean>}
   */
  function pushNow() {
    clearTimeout(_debounceTimer);
    return doPush();
  }

  /**
   * 从云端拉取一份数据（仅用于人工恢复场景，例如换了新手机 /
   * 清空了浏览器数据后，手动从云端找回进度；不会自动调用、
   * 不会自动覆盖本地数据）。
   * @returns {Promise<{success:boolean, data?:object, message?:string}>}
   */
  function pullFromCloud() {
    if (!syncCfg.supabaseUrl || !syncCfg.supabaseAnonKey) {
      return Promise.resolve({ success: false, message: '同步未配置' });
    }
    var url = syncCfg.supabaseUrl + '/rest/v1/' + syncCfg.tableName +
      '?id=eq.' + encodeURIComponent(syncCfg.rowId || 'default') + '&select=data,updated_at';

    return fetch(url, { headers: buildHeaders() }).then(function (res) {
      if (!res.ok) return { success: false, message: '拉取失败，状态码 ' + res.status };
      return res.json().then(function (rows) {
        if (!rows || rows.length === 0) return { success: false, message: '云端暂无数据' };
        return { success: true, data: rows[0].data, updatedAt: rows[0].updated_at };
      });
    }).catch(function (e) {
      console.error('[Sync] 拉取请求异常', e);
      return { success: false, message: '网络请求异常' };
    });
  }

  global.SyncManager = {
    push: push,
    pushNow: pushNow,
    pullFromCloud: pullFromCloud
  };

}(typeof window !== 'undefined' ? window : this));