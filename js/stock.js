/* ============================================================
 * stock.js  —  实时行情 / 个股数据接入
 * 纯前端方案：使用 <script> JSONP 加载腾讯行情接口绕过跨域(CORS)
 *   - 搜索：https://smartbox.gtimg.cn/s3/?q=关键词  -> 全局变量 v_hint
 *   - 行情：https://qt.gtimg.cn/q=sh600519        -> 全局变量 v_sh600519
 * ============================================================ */
(function (global) {
  'use strict';

  var STOP_WORDS = ['公司', '股票', '怎么样', '值得', '持有', '长期', '分析', '如何', '现在',
    '可以', '应该', '为什么', '什么', '判断', '一家', '这家', '适合', '买入', '卖出',
    '投资', '估值', '未来', '前景', '基本面', '护城河', '同行业', '对比'];

  /** JSONP 加载器：注入 script，读取指定全局变量 */
  function jsonp(url, varName, timeout) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      try { script.charset = 'GBK'; } catch (e) {}
      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + '_t=' + Date.now();
      var done = false;
      var timer = setTimeout(function () { finish(null, new Error('请求超时')); }, timeout || 8000);

      function finish(val, err) {
        if (done) return; done = true;
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        if (err) reject(err); else resolve(val);
      }
      script.onload = function () { finish(global[varName]); };
      script.onerror = function () { finish(null, new Error('网络请求失败（可能被跨域或网络策略拦截）')); };
      document.body.appendChild(script);
    });
  }

  /** 根据 6 位代码推断市场前缀 */
  function marketOf(code) {
    if (/^(60|68|90|11|50|51|56|58)/.test(code)) return 'sh';
    if (/^(00|30|20|15|16|18|12|13)/.test(code)) return 'sz';
    if (/^(43|83|87|88|92)/.test(code)) return 'bj';
    if (/^6/.test(code)) return 'sh';
    if (/^[03]/.test(code)) return 'sz';
    return 'sz';
  }

  /** 解析腾讯行情字符串（GBK, ~ 分隔） */
  function parseQuote(raw) {
    if (!raw || typeof raw !== 'string') return null;
    var f = raw.split('~');
    if (f.length < 40 || !f[1]) return null;
    var num = function (i) { var v = parseFloat(f[i]); return isNaN(v) ? null : v; };
    return {
      name: f[1],
      code: f[2],
      price: num(3),
      prevClose: num(4),
      open: num(5),
      volume: num(6),          // 成交量(手)
      high: num(33),
      low: num(34),
      amount: num(37),         // 成交额(万元)
      turnover: num(38),       // 换手率%
      pe: num(39),             // 市盈率(TTM)
      change: num(31),         // 涨跌额
      changePct: num(32),      // 涨跌幅%
      circMktCap: num(44),     // 流通市值(亿)
      totalMktCap: num(45),    // 总市值(亿)
      pb: num(46)              // 市净率
    };
  }

  /** 按代码获取行情 */
  function fetchByCode(code) {
    var symbol = marketOf(code) + code;
    var varName = 'v_' + symbol;
    return jsonp('https://qt.gtimg.cn/q=' + symbol, varName, 8000).then(function (raw) {
      var data = parseQuote(raw);
      if (!data || !data.price) return null;
      return data;
    });
  }

  /** 按名称搜索 A 股，返回代码 */
  function searchByName(name) {
    return jsonp('https://smartbox.gtimg.cn/s3/?t=gp&q=' + encodeURIComponent(name), 'v_hint', 8000)
      .then(function (hint) {
        if (!hint || typeof hint !== 'string') return null;
        var records = hint.split('^');
        for (var i = 0; i < records.length; i++) {
          var parts = records[i].split('~');
          var market = parts[0], code = parts[1];
          if ((market === 'sh' || market === 'sz' || market === 'bj') && /^\d{6}$/.test(code || '')) {
            return code;
          }
        }
        return null;
      });
  }

  /** 从用户输入中提取中文候选词（可能的股票名） */
  function extractNameCandidates(text) {
    var matches = text.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
    var cands = [];
    matches.forEach(function (w) {
      if (STOP_WORDS.indexOf(w) === -1) cands.push(w);
    });
    // 长的优先（更可能是完整公司名）
    cands.sort(function (a, b) { return b.length - a.length; });
    return cands.slice(0, 3);
  }

  var Stock = {
    marketOf: marketOf,

    /**
     * 探测并获取用户输入中的个股数据
     * @returns {Promise<Object>} { status: 'ok'|'notfound'|'none', data, query }
     *   ok:       命中并取到数据
     *   notfound: 明确的股票查询（含6位代码或强候选）但未找到 —— 需提示
     *   none:     未检测到股票意图 —— 当作普通问答，不提示
     */
    detect: function (text) {
      var codeMatch = text.match(/(?:^|[^\d])(\d{6})(?![\d])/);
      if (codeMatch) {
        var code = codeMatch[1];
        return fetchByCode(code).then(function (data) {
          if (data) return { status: 'ok', data: data };
          return { status: 'notfound', query: code };
        }).catch(function () {
          return { status: 'notfound', query: code };
        });
      }

      var cands = extractNameCandidates(text);
      if (!cands.length) return Promise.resolve({ status: 'none' });

      // 依次尝试候选名（命中即止）；全都搜不到则视为普通问答，不报错
      var idx = 0;
      function tryNext() {
        if (idx >= cands.length) return Promise.resolve({ status: 'none' });
        var name = cands[idx++];
        return searchByName(name).then(function (code) {
          if (!code) return tryNext();
          return fetchByCode(code).then(function (data) {
            if (data) return { status: 'ok', data: data };
            return tryNext();
          }).catch(function () { return tryNext(); });
        }).catch(function () { return tryNext(); });
      }
      return tryNext();
    },

    /** 生成注入给大模型的数据上下文文本 */
    toContext: function (d) {
      var lines = ['【实时行情数据 · 仅供参考，可能有延迟】'];
      lines.push('股票：' + d.name + '（' + d.code + '）');
      if (d.price != null) lines.push('现价：' + d.price + '，涨跌幅：' + (d.changePct != null ? d.changePct + '%' : '—'));
      if (d.pe != null) lines.push('市盈率(TTM)：' + d.pe);
      if (d.pb != null) lines.push('市净率：' + d.pb);
      if (d.totalMktCap != null) lines.push('总市值：' + d.totalMktCap + '亿');
      if (d.circMktCap != null) lines.push('流通市值：' + d.circMktCap + '亿');
      if (d.turnover != null) lines.push('换手率：' + d.turnover + '%');
      if (d.high != null && d.low != null) lines.push('今日最高/最低：' + d.high + ' / ' + d.low);
      return lines.join('\n');
    }
  };

  global.Stock = Stock;
})(window);
