/* ============================================================
 * store.js  —  本地持久化存储层（LocalStorage）
 * 纯本地存储，无账号、无云端同步
 * ============================================================ */
(function (global) {
  'use strict';

  var KEYS = {
    masters: 'wds_masters',
    convs: 'wds_conversations',
    model: 'wds_model_config',
    state: 'wds_app_state'
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('读取存储失败', key, e);
      return fallback;
    }
  }

  function write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.warn('写入存储失败', key, e);
      return false;
    }
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  var Store = {
    KEYS: KEYS,
    uid: uid,

    /* ---------- 大师 ---------- */
    getMasters: function () { return read(KEYS.masters, null); },
    saveMasters: function (list) { return write(KEYS.masters, list); },

    /* ---------- 会话 ---------- */
    getConversations: function () { return read(KEYS.convs, []); },
    saveConversations: function (list) { return write(KEYS.convs, list); },

    /* ---------- 模型配置 ---------- */
    getModelConfig: function () {
      return read(KEYS.model, { provider: '', baseUrl: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 2048 });
    },
    saveModelConfig: function (cfg) { return write(KEYS.model, cfg); },

    /* ---------- 应用状态（当前大师/会话） ---------- */
    getState: function () { return read(KEYS.state, { currentMasterId: '', currentConvId: '' }); },
    saveState: function (s) { return write(KEYS.state, s); },

    /* ---------- 导入导出 ---------- */
    exportAll: function () {
      return {
        masters: this.getMasters(),
        conversations: this.getConversations(),
        modelConfig: this.getModelConfig(),
        exportedAt: Date.now()
      };
    },
    clearConversations: function () { return write(KEYS.convs, []); }
  };

  global.Store = Store;
})(window);
