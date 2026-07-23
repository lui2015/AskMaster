/* ============================================================
 * app.js  —  主控制器：UI 渲染、会话管理、事件绑定、对话编排
 * ============================================================ */
(function () {
  'use strict';

  var global = window;

  // ---------- 全局状态 ----------
  var state = {
    masters: [],
    conversations: [],
    modelConfig: null,
    currentMasterId: '',
    currentConvId: '',
    sending: false,
    editingMasterId: null // 大师编辑弹窗中正在编辑的 id
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {};

  // ---------- 工具 ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderMarkdown(text) {
    if (global.marked && typeof marked.parse === 'function') {
      try { return marked.parse(text); } catch (e) {}
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  function getMaster(id) {
    for (var i = 0; i < state.masters.length; i++) if (state.masters[i].id === id) return state.masters[i];
    return state.masters[0] || null;
  }
  function getConv(id) {
    for (var i = 0; i < state.conversations.length; i++) if (state.conversations[i].id === id) return state.conversations[i];
    return null;
  }
  function currentConv() { return getConv(state.currentConvId); }

  function avatarHtml(avatar) {
    if (avatar && /^(https?:|data:)/.test(avatar)) return '<img src="' + escapeHtml(avatar) + '" alt="">';
    return escapeHtml(avatar || '🎓');
  }

  // ================= 初始化 =================
  function init() {
    el = {
      masterList: $('masterList'), convList: $('convList'),
      chatArea: $('chatArea'), samples: $('samples'),
      cmAvatar: $('cmAvatar'), cmName: $('cmName'), cmDesc: $('cmDesc'),
      inpMessage: $('inpMessage'), btnSend: $('btnSend'),
      inpApiKey: $('inpApiKey'), inpBaseUrl: $('inpBaseUrl'), inpModel: $('inpModel'),
      presetGrid: $('presetGrid'), modelStatus: $('modelStatus'),
      testResult: $('testResult'), toast: $('toast'),
      masterModal: $('masterModal'), masterModalTitle: $('masterModalTitle'), masterModalBody: $('masterModalBody')
    };

    state.masters = Masters.init();
    state.conversations = Store.getConversations();
    state.modelConfig = Store.getModelConfig();
    // 本地默认配置优先（local-config.js，已被 gitignore 忽略，含 API Key）
    var lc = global.LOCAL_CONFIG;
    if (lc && lc.useProxy && lc.proxyUrl) {
      // 经本地代理直连混元，绕开浏览器 CORS
      state.modelConfig.provider = 'hunyuan-mas';
      state.modelConfig.baseUrl = lc.proxyUrl;
      state.modelConfig.model = (LLM.findProvider('hunyuan-mas') || {}).model || 'hy3';
      if (lc.apiKey && !state.modelConfig.apiKey) state.modelConfig.apiKey = lc.apiKey;
    } else if (!state.modelConfig.baseUrl && !state.modelConfig.provider) {
      var def = LLM.findProvider('hunyuan-mas');
      if (def) {
        state.modelConfig.provider = def.id;
        state.modelConfig.baseUrl = def.baseUrl;
        state.modelConfig.model = def.model;
      }
      if (lc && lc.apiKey && !state.modelConfig.apiKey) state.modelConfig.apiKey = lc.apiKey;
    }
    var saved = Store.getState();
    state.currentMasterId = saved.currentMasterId || state.masters[0].id;
    if (!getMaster(state.currentMasterId)) state.currentMasterId = state.masters[0].id;
    state.currentConvId = saved.currentConvId || '';
    if (!getConv(state.currentConvId)) state.currentConvId = '';

    renderPresets();
    fillModelForm();
    renderMasterList();
    renderConvList();
    renderCurrentMaster();
    renderChat();
    bindEvents();
  }

  // ================= 模型配置 =================
  function renderPresets() {
    el.presetGrid.innerHTML = '';
    LLM.PROVIDERS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'preset-btn' + (state.modelConfig.provider === p.id ? ' active' : '');
      b.textContent = p.name;
      b.onclick = function () {
        el.inpBaseUrl.value = p.baseUrl;
        el.inpModel.value = p.model;
        state.modelConfig.provider = p.id;
        document.querySelectorAll('.preset-btn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      };
      el.presetGrid.appendChild(b);
    });
  }

  function fillModelForm() {
    var c = state.modelConfig;
    el.inpApiKey.value = c.apiKey || '';
    el.inpBaseUrl.value = c.baseUrl || '';
    el.inpModel.value = c.model || '';
    updateModelStatus();
  }

  function updateModelStatus() {
    var c = state.modelConfig;
    var ok = c.apiKey && c.baseUrl && c.model;
    el.modelStatus.textContent = ok ? '已配置' : '待配置';
    el.modelStatus.className = 'tag ' + (ok ? 'tag-ok' : 'tag-warn');
  }

  function saveModel() {
    state.modelConfig.apiKey = el.inpApiKey.value.trim();
    state.modelConfig.baseUrl = el.inpBaseUrl.value.trim();
    state.modelConfig.model = el.inpModel.value.trim();
    Store.saveModelConfig(state.modelConfig);
    updateModelStatus();
    toast('模型配置已保存');
  }

  function testModel() {
    saveModel();
    var c = state.modelConfig;
    if (!c.apiKey || !c.baseUrl || !c.model) {
      el.testResult.className = 'test-result err';
      el.testResult.textContent = '请先填写 API Key、Base URL 与模型名';
      return;
    }
    el.testResult.className = 'test-result';
    el.testResult.textContent = '正在测试连接…';
    LLM.test(c).then(function (reply) {
      el.testResult.className = 'test-result ok';
      el.testResult.textContent = '✓ 连接成功：' + String(reply).slice(0, 20);
    }).catch(function (err) {
      el.testResult.className = 'test-result err';
      el.testResult.textContent = '✗ ' + (err.message || '连接失败');
    });
  }

  // ================= 大师列表 =================
  function renderMasterList() {
    el.masterList.innerHTML = '';
    state.masters.forEach(function (m) {
      var d = document.createElement('div');
      d.className = 'master-item' + (m.id === state.currentMasterId ? ' active' : '');
      d.innerHTML =
        '<div class="master-avatar">' + avatarHtml(m.avatar) + '</div>' +
        '<div class="master-meta"><div class="m-name">' + escapeHtml(m.name) + '</div>' +
        '<div class="m-desc">' + escapeHtml(m.desc || '') + '</div></div>';
      d.onclick = function () { switchMaster(m.id); };
      el.masterList.appendChild(d);
    });
    var add = document.createElement('div');
    add.className = 'master-item master-add';
    add.textContent = '＋ 新增大师';
    add.onclick = function () { openMasterEditor(null); };
    el.masterList.appendChild(add);
  }

  function switchMaster(id) {
    if (id === state.currentMasterId) return;
    state.currentMasterId = id;
    // 切换大师默认开启新会话，避免上下文串味
    state.currentConvId = '';
    persistState();
    renderMasterList();
    renderCurrentMaster();
    renderChat();
  }

  function renderCurrentMaster() {
    var m = getMaster(state.currentMasterId);
    if (!m) return;
    el.cmAvatar.innerHTML = avatarHtml(m.avatar);
    el.cmName.textContent = m.name;
    el.cmDesc.textContent = m.desc || '';
    // 推荐提问
    el.samples.innerHTML = '';
    (m.samples || []).slice(0, 4).forEach(function (q) {
      var c = document.createElement('div');
      c.className = 'sample-chip';
      c.textContent = q;
      c.onclick = function () { el.inpMessage.value = q; el.inpMessage.focus(); autoGrow(); };
      el.samples.appendChild(c);
    });
  }

  // ================= 会话管理 =================
  function renderConvList() {
    el.convList.innerHTML = '';
    if (!state.conversations.length) {
      el.convList.innerHTML = '<div class="empty-tip">还没有会话，开始提问吧</div>';
      return;
    }
    // 最新在前
    var sorted = state.conversations.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    sorted.forEach(function (c) {
      var m = getMaster(c.masterId);
      var d = document.createElement('div');
      d.className = 'conv-item' + (c.id === state.currentConvId ? ' active' : '');
      d.innerHTML =
        '<span class="c-title">' + (m ? avatarHtml(m.avatar) + ' ' : '') + escapeHtml(c.title || '新会话') + '</span>' +
        '<span class="c-del" title="删除">🗑</span>';
      d.querySelector('.c-title').onclick = function () { openConv(c.id); };
      d.querySelector('.c-del').onclick = function (e) { e.stopPropagation(); deleteConv(c.id); };
      el.convList.appendChild(d);
    });
  }

  function openConv(id) {
    var c = getConv(id);
    if (!c) return;
    state.currentConvId = id;
    state.currentMasterId = c.masterId;
    persistState();
    renderMasterList();
    renderConvList();
    renderCurrentMaster();
    renderChat();
  }

  function deleteConv(id) {
    state.conversations = state.conversations.filter(function (c) { return c.id !== id; });
    Store.saveConversations(state.conversations);
    if (state.currentConvId === id) state.currentConvId = '';
    persistState();
    renderConvList();
    renderChat();
  }

  function newChat() {
    state.currentConvId = '';
    persistState();
    renderConvList();
    renderChat();
    el.inpMessage.focus();
  }

  function ensureConv() {
    var c = currentConv();
    if (c) return c;
    c = {
      id: Store.uid('conv'),
      masterId: state.currentMasterId,
      title: '',
      messages: [],
      createdAt: Date.now()
    };
    state.conversations.push(c);
    state.currentConvId = c.id;
    persistState();
    return c;
  }

  function persistState() {
    Store.saveState({ currentMasterId: state.currentMasterId, currentConvId: state.currentConvId });
  }

  // ================= 对话渲染 =================
  function renderChat() {
    var c = currentConv();
    var m = getMaster(state.currentMasterId);
    el.chatArea.innerHTML = '';
    if (!c || !c.messages.length) {
      var hero = document.createElement('div');
      hero.className = 'welcome-hero';
      hero.innerHTML =
        '<div class="hero-avatar">' + avatarHtml(m ? m.avatar : '🎓') + '</div>' +
        '<h2>' + escapeHtml(m ? m.name : '问大师') + '</h2>' +
        '<p>' + escapeHtml(m && m.welcome ? m.welcome : '选择一位大师，开始你的投资对话。') + '</p>';
      el.chatArea.appendChild(hero);
      return;
    }
    c.messages.forEach(function (msg) {
      appendMessageEl(msg.role, msg.content, msg.stock, m);
    });
    scrollBottom();
  }

  function stockCardHtml(stock) {
    if (!stock) return '';
    if (stock.error) {
      return '<div class="stock-card error">' +
        '<div class="stock-err-title">⚠️ 数据获取失败</div>' +
        '<div class="stock-err-body">未找到与「' + escapeHtml(stock.query || '') + '」匹配的 A 股公司。' +
        '本系统暂不支持港股、美股、基金。建议：①用证券简称，如 <code>茅台</code> <code>比亚迪</code>；' +
        '②或直接输入 6 位代码，如 <code>600519</code>；③名称不要带「股份/集团」等多余后缀。</div></div>';
    }
    var d = stock;
    var chgCls = (d.changePct != null && d.changePct < 0) ? 'down' : 'up';
    var cell = function (k, v) { return '<div class="cell"><div class="k">' + k + '</div><div class="v">' + (v == null ? '—' : v) + '</div></div>'; };
    return '<div class="stock-card">' +
      '<div class="stock-head">' +
        '<span class="s-name">' + escapeHtml(d.name) + '</span>' +
        '<span class="s-code">' + escapeHtml(d.code) + '</span>' +
        '<span class="s-price ' + chgCls + '">' + (d.price == null ? '—' : d.price) + '</span>' +
        '<span class="s-chg ' + chgCls + '">' + (d.changePct == null ? '' : (d.changePct > 0 ? '+' : '') + d.changePct + '%') + '</span>' +
      '</div>' +
      '<div class="stock-grid">' +
        cell('市盈率TTM', d.pe) + cell('市净率', d.pb) +
        cell('总市值(亿)', d.totalMktCap) + cell('换手率', d.turnover != null ? d.turnover + '%' : null) +
      '</div></div>';
  }

  function appendMessageEl(role, content, stock, master) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    var av = role === 'user' ? '🙋' : (master ? avatarHtml(master.avatar) : '🎓');
    var bubbleInner = '';
    if (role === 'assistant') {
      bubbleInner = (stock ? stockCardHtml(stock) : '') +
        '<div class="md-body">' + renderMarkdown(content) + '</div>' +
        '<div class="disclaimer">⚠️ 以上为 AI 模拟观点，仅供学习参考，不构成投资建议。数据可能存在延迟。</div>';
    } else {
      bubbleInner = escapeHtml(content).replace(/\n/g, '<br>');
    }
    wrap.innerHTML =
      '<div class="msg-avatar">' + av + '</div>' +
      '<div class="msg-bubble">' + bubbleInner + '</div>';
    el.chatArea.appendChild(wrap);
    return wrap;
  }

  function scrollBottom() { el.chatArea.scrollTop = el.chatArea.scrollHeight; }

  // ================= 发送消息（核心编排） =================
  function send() {
    if (state.sending) return;
    var text = el.inpMessage.value.trim();
    if (!text) return;

    var cfg = state.modelConfig;
    if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
      toast('请先在左下角配置模型（API Key / Base URL / 模型名）');
      $('modelPanelHeader').classList.remove('collapsed');
      $('modelPanelBody').classList.remove('hidden');
      return;
    }

    var master = getMaster(state.currentMasterId);
    var conv = ensureConv();
    conv.masterId = state.currentMasterId;
    if (!conv.title) conv.title = text.slice(0, 18);

    // 记录并渲染用户消息
    conv.messages.push({ role: 'user', content: text });
    Store.saveConversations(state.conversations);
    renderConvList();
    if (el.chatArea.querySelector('.welcome-hero')) el.chatArea.innerHTML = '';
    appendMessageEl('user', text, null, master);
    scrollBottom();

    el.inpMessage.value = '';
    autoGrow();
    setSending(true);

    // 助手气泡（占位，流式填充）
    var assistantMsg = { role: 'assistant', content: '', stock: null };
    var bubbleWrap = appendMessageEl('assistant', '', null, master);
    var mdBody = bubbleWrap.querySelector('.md-body');
    mdBody.classList.add('cursor-blink');
    scrollBottom();

    var mode = document.querySelector('input[name="mode"]:checked');
    mode = mode ? mode.value : 'single';

    // 1) 个股数据探测（仅个股分析模式）
    var detectP = mode === 'single' ? Stock.detect(text) : Promise.resolve({ status: 'none' });

    detectP.catch(function () { return { status: 'none' }; }).then(function (res) {
      var stockCtx = '';
      if (res.status === 'ok') {
        assistantMsg.stock = res.data;
        stockCtx = Stock.toContext(res.data);
      } else if (res.status === 'notfound') {
        assistantMsg.stock = { error: true, query: res.query };
        stockCtx = '【提示】用户似乎想咨询个股「' + res.query + '」，但未能获取到其 A 股实时数据。请据此说明无法提供该股数据，并基于通用投资理念给出建议。';
      }
      // 把股票卡片渲染出来（在正文之前）
      if (assistantMsg.stock) {
        var card = stockCardHtml(assistantMsg.stock);
        mdBody.insertAdjacentHTML('beforebegin', card);
        scrollBottom();
      }

      // 2) 组装发送给模型的 messages
      var apiMessages = buildApiMessages(conv, master, stockCtx);

      // 3) 流式请求
      return LLM.chat({
        config: cfg,
        messages: apiMessages,
        stream: true,
        onDelta: function (piece, full) {
          assistantMsg.content = full;
          mdBody.innerHTML = renderMarkdown(full);
          scrollBottom();
        }
      });
    }).then(function (full) {
      assistantMsg.content = full || assistantMsg.content || '(未返回内容)';
      mdBody.classList.remove('cursor-blink');
      mdBody.innerHTML = renderMarkdown(assistantMsg.content);
      conv.messages.push(assistantMsg);
      Store.saveConversations(state.conversations);
      renderConvList();
      setSending(false);
      scrollBottom();
    }).catch(function (err) {
      mdBody.classList.remove('cursor-blink');
      mdBody.innerHTML = '<span style="color:var(--red)">✗ 请求失败：' + escapeHtml(err.message || '未知错误') +
        '</span><br><span style="color:var(--text-dim);font-size:12px">若为跨域(CORS)错误，请通过本地/线上 HTTP 服务访问本页面，并确认该模型接口允许浏览器直接调用。</span>';
      // 失败的助手消息不持久化，回滚 title 若首条
      setSending(false);
    });
  }

  /** 构建 OpenAI messages：system(角色指令) + 历史(user/assistant) + 数据注入到最后一条 user */
  function buildApiMessages(conv, master, stockCtx) {
    var msgs = [];
    msgs.push({ role: 'system', content: master.systemPrompt });

    var history = conv.messages.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; });
    // 控制上下文长度：最多取最近 16 条
    history = history.slice(-16);

    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      var isLastUser = (i === history.length - 1) && m.role === 'user';
      if (isLastUser && stockCtx) {
        msgs.push({ role: 'user', content: stockCtx + '\n\n用户问题：' + m.content });
      } else {
        msgs.push({ role: m.role, content: m.content });
      }
    }
    return msgs;
  }

  function setSending(v) {
    state.sending = v;
    el.btnSend.disabled = v;
    el.btnSend.textContent = v ? '…' : '↑';
  }

  // ================= 大师编辑器 =================
  function openMasterManage() {
    state.editingMasterId = null;
    el.masterModalTitle.textContent = '大师管理';
    var html = '<div class="master-manage-list">';
    state.masters.forEach(function (m) {
      html +=
        '<div class="mm-item" data-id="' + m.id + '">' +
          '<div class="master-avatar">' + avatarHtml(m.avatar) + '</div>' +
          '<div class="mm-info"><div class="mm-name">' + escapeHtml(m.name) +
            (m.builtin ? '<span class="badge-builtin">内置</span>' : '') + '</div>' +
            '<div class="mm-desc">' + escapeHtml(m.desc || '') + '</div></div>' +
          '<div class="mm-actions">' +
            '<button class="btn btn-ghost" data-act="edit">编辑</button>' +
            (m.builtin ? '' : '<button class="btn btn-danger" data-act="del">删除</button>') +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    html += '<div class="modal-footer"><button class="btn btn-primary" id="mmAdd">＋ 新增大师</button></div>';
    el.masterModalBody.innerHTML = html;

    el.masterModalBody.querySelectorAll('.mm-item').forEach(function (item) {
      var id = item.getAttribute('data-id');
      var editBtn = item.querySelector('[data-act="edit"]');
      var delBtn = item.querySelector('[data-act="del"]');
      if (editBtn) editBtn.onclick = function () { openMasterEditor(id); };
      if (delBtn) delBtn.onclick = function () { deleteMaster(id); };
    });
    $('mmAdd').onclick = function () { openMasterEditor(null); };
    showModal(true);
  }

  function openMasterEditor(id) {
    var m = id ? getMaster(id) : null;
    state.editingMasterId = id;
    el.masterModalTitle.textContent = m ? ('编辑大师 · ' + m.name) : '新增大师';
    var data = m || {
      name: '', avatar: '🎓', desc: '', welcome: '', samples: [],
      systemPrompt: Masters.getDefaultTemplate(), builtin: false
    };
    var samplesText = (data.samples || []).join('\n');
    el.masterModalBody.innerHTML =
      '<div class="form-row"><label>大师名称 *</label>' +
        '<input type="text" id="fName" value="' + escapeHtml(data.name) + '" placeholder="如：查理·芒格" /></div>' +
      '<div class="form-row"><label>头像（Emoji 或图片链接）</label>' +
        '<input type="text" id="fAvatar" value="' + escapeHtml(data.avatar) + '" placeholder="🎓 或 https://..." /></div>' +
      '<div class="form-row"><label>一句话简介</label>' +
        '<input type="text" id="fDesc" value="' + escapeHtml(data.desc || '') + '" placeholder="如：价值投资合伙人" /></div>' +
      '<div class="form-row"><label>开场白</label>' +
        '<input type="text" id="fWelcome" value="' + escapeHtml(data.welcome || '') + '" placeholder="用户开启会话时的第一句问候" /></div>' +
      '<div class="form-row"><label>推荐提问（每行一条，最多 4 条）</label>' +
        '<textarea id="fSamples" style="min-height:80px" placeholder="如何判断护城河？">' + escapeHtml(samplesText) + '</textarea></div>' +
      '<div class="form-row"><label>角色指令 System Prompt * <span class="char-count" id="promptCount"></span></label>' +
        '<textarea id="fPrompt" placeholder="定义该大师的身份、投资理念、语言风格与禁忌">' + escapeHtml(data.systemPrompt) + '</textarea>' +
        '<div class="form-hint">提示：写清「你是谁 + 核心理念 + 回答风格 + 应避免什么 + 免责声明」，角色感会更强。</div></div>' +
      '<div class="modal-footer">' +
        (m && m.builtin ? '<button class="btn btn-ghost" id="fReset">恢复默认</button>' : '') +
        '<button class="btn btn-ghost" id="fCancel">返回</button>' +
        '<button class="btn btn-primary" id="fSave">保存</button>' +
      '</div>';

    var promptEl = $('fPrompt');
    var countEl = $('promptCount');
    function updCount() { countEl.textContent = promptEl.value.length + ' 字'; }
    promptEl.addEventListener('input', updCount); updCount();

    $('fSave').onclick = function () { saveMasterFromForm(id, m && m.builtin); };
    $('fCancel').onclick = function () { openMasterManage(); };
    if ($('fReset')) $('fReset').onclick = function () { resetBuiltinMaster(id); };
    showModal(true);
  }

  function saveMasterFromForm(id, isBuiltin) {
    var name = $('fName').value.trim();
    var prompt = $('fPrompt').value.trim();
    if (!name) { toast('请填写大师名称'); return; }
    if (!prompt) { toast('请填写角色指令'); return; }
    var samples = $('fSamples').value.split('\n').map(function (s) { return s.trim(); })
      .filter(Boolean).slice(0, 4);
    var payload = {
      name: name,
      avatar: $('fAvatar').value.trim() || '🎓',
      desc: $('fDesc').value.trim(),
      welcome: $('fWelcome').value.trim(),
      samples: samples,
      systemPrompt: prompt
    };
    if (id) {
      var m = getMaster(id);
      Object.assign(m, payload);
      // builtin 标记保留
    } else {
      var nm = Object.assign({ id: Store.uid('master'), builtin: false, modelId: null }, payload);
      state.masters.push(nm);
      state.currentMasterId = nm.id;
    }
    Store.saveMasters(state.masters);
    renderMasterList();
    renderCurrentMaster();
    if (currentConv()) renderChat();
    toast('已保存');
    openMasterManage();
  }

  function resetBuiltinMaster(id) {
    var def = Masters.getBuiltins().filter(function (b) { return b.id === id; })[0];
    if (!def) return;
    var m = getMaster(id);
    Object.assign(m, def);
    Store.saveMasters(state.masters);
    renderMasterList();
    renderCurrentMaster();
    toast('已恢复默认');
    openMasterEditor(id);
  }

  function deleteMaster(id) {
    var m = getMaster(id);
    if (m && m.builtin) { toast('内置大师不可删除'); return; }
    if (!confirm('确定删除大师「' + (m ? m.name : '') + '」吗？')) return;
    state.masters = state.masters.filter(function (x) { return x.id !== id; });
    if (state.currentMasterId === id) state.currentMasterId = state.masters[0].id;
    Store.saveMasters(state.masters);
    renderMasterList();
    renderCurrentMaster();
    openMasterManage();
  }

  function showModal(v) { el.masterModal.hidden = !v; }

  // ================= 事件绑定 =================
  function autoGrow() {
    el.inpMessage.style.height = 'auto';
    el.inpMessage.style.height = Math.min(el.inpMessage.scrollHeight, 160) + 'px';
  }

  function bindEvents() {
    $('btnNewChat').onclick = newChat;
    $('btnSend').onclick = send;
    $('btnSaveModel').onclick = saveModel;
    $('btnTestModel').onclick = testModel;
    $('btnManageMasters').onclick = openMasterManage;
    $('btnCloseMasterModal').onclick = function () { showModal(false); };
    el.masterModal.onclick = function (e) { if (e.target === el.masterModal) showModal(false); };

    $('btnToggleKey').onclick = function () {
      el.inpApiKey.type = el.inpApiKey.type === 'password' ? 'text' : 'password';
    };
    $('btnClearConvs').onclick = function () {
      if (!state.conversations.length) return;
      if (!confirm('确定清空全部会话吗？此操作不可恢复。')) return;
      state.conversations = [];
      Store.clearConversations();
      state.currentConvId = '';
      persistState();
      renderConvList();
      renderChat();
    };

    // 模型面板折叠
    $('modelPanelHeader').onclick = function () {
      this.classList.toggle('collapsed');
      $('modelPanelBody').classList.toggle('hidden');
    };

    el.inpMessage.addEventListener('input', autoGrow);
    el.inpMessage.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
