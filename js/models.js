/* ============================================================
 * models.js  —  国产大模型预设 + OpenAI 兼容对话（流式 SSE）
 * ============================================================ */
(function (global) {
  'use strict';

  // 国产大模型预设（均走 OpenAI 兼容接口 /chat/completions）
  var PROVIDERS = [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { id: 'glm', name: '智谱GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { id: 'kimi', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { id: 'hunyuan', name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-standard' },
    { id: 'doubao', name: '豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
    { id: 'baichuan', name: '百川', baseUrl: 'https://api.baichuan-ai.com/v1', model: 'Baichuan4' },
    { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat' },
    { id: 'custom', name: 'OpenAI兼容', baseUrl: '', model: '' }
  ];

  function findProvider(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return null;
  }

  function normalizeUrl(baseUrl) {
    var url = (baseUrl || '').trim().replace(/\/+$/, '');
    // 若用户没写 /v1 等版本路径，按常见约定补 /v1（DeepSeek 允许两者，qwen/glm 已含版本路径）
    if (/\/v\d+$/.test(url) || /compatible-mode\/v1$/.test(url) || /paas\/v4$/.test(url) || /\/api\/v3$/.test(url)) {
      return url + '/chat/completions';
    }
    // deepseek.com 这类无版本后缀的，默认补 /v1
    return url + '/v1/chat/completions';
  }

  var LLM = {
    PROVIDERS: PROVIDERS,
    findProvider: findProvider,

    /** 测试连接：发一条极短请求 */
    test: function (cfg) {
      return this.chat({
        config: cfg,
        messages: [{ role: 'user', content: '你好，请回复"连接成功"四个字。' }],
        stream: false
      });
    },

    /**
     * 对话（支持流式）
     * @param {Object} opts { config, messages, stream, onDelta, signal }
     * @returns {Promise<string>} 完整回复文本
     */
    chat: function (opts) {
      var cfg = opts.config || {};
      var endpoint = normalizeUrl(cfg.baseUrl);
      var stream = opts.stream !== false;

      var body = {
        model: cfg.model,
        messages: opts.messages,
        temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
        stream: stream
      };
      if (cfg.maxTokens) body.max_tokens = cfg.maxTokens;

      var headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (cfg.apiKey || '')
      };

      return fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: opts.signal
      }).then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (t) {
            var msg = t;
            try { var j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.type)) || t; } catch (e) {}
            throw new Error('接口返回 ' + resp.status + '：' + (msg || resp.statusText));
          });
        }
        if (!stream) {
          return resp.json().then(function (j) {
            return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
          });
        }
        return LLM._readStream(resp, opts.onDelta);
      });
    },

    _readStream: function (resp, onDelta) {
      var reader = resp.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      var full = '';

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) return full;
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop(); // 保留不完整行

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (data === '[DONE]') return full;
            try {
              var json = JSON.parse(data);
              var delta = json.choices && json.choices[0] && json.choices[0].delta;
              var piece = delta && delta.content;
              if (piece) {
                full += piece;
                if (onDelta) onDelta(piece, full);
              }
            } catch (e) { /* 忽略解析不完整的分片 */ }
          }
          return pump();
        });
      }
      return pump();
    }
  };

  global.LLM = LLM;
})(window);
