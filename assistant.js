import {icon} from './icons.js';
import {api, tool, e, shortTitle, dateTime, confirmation, toast, showLocation, runtime, seatLabel, bookDetailLabel, statuses} from './ui.js';
import {agentCharacters, characterAvatar} from './characters.js';

export function createAssistant({refresh, findBook, exampleBook, initialCharacter}) {
  const drawer=document.querySelector('#agent-drawer'),backdrop=document.querySelector('#agent-backdrop');
  const messages=document.querySelector('#chat-messages'),input=document.querySelector('#chat-input'),send=document.querySelector('#chat-send');
  const profile = document.querySelector('#agent-profile');
  const picker = document.querySelector('#agent-character-picker');
  let character = initialCharacter;
  let sessionId=null,busy=false,previousFocus=null;
  const offline = runtime.data_mode === 'offline';
  const sessionBar = document.querySelector('#chat-session-bar');
  const turnStatus = document.querySelector('#chat-turn-status');
  let turnCount = 0;
  function updateTurns(result = {}) {
    if (!offline) return;
    turnCount = result.turn_count ?? turnCount;
    const max = result.max_turns || 10;
    sessionBar.hidden = false;
    sessionBar.classList.toggle('chat-session-bar--full', turnCount >= max);
    turnStatus.textContent = result.limit_reached ? `已超出对话轮数上限 · ${max} 轮` : `本次对话 ${turnCount} / ${max} 轮${turnCount >= max ? ' · 已用完' : ''}`;
  }
  const actions=new Map(),seats=new Map();
  const mode=document.querySelector('#agent-mode-label');
  mode.innerHTML=`<span class="status-dot"></span>${runtime.model_mode==='deepseek'?'DeepSeek已配置 · 基于查询结果回答':'规则演示 · 查询本站资料'}`;
  picker.innerHTML = `<span class="agent-picker-label">切换馆员</span>${Object.values(agentCharacters).map(item =>
    `<button class="agent-character-chip" type="button" data-agent-character="${item.id}" aria-pressed="${item.id === character.id}">${characterAvatar(item)}${e(item.name)}</button>`).join('')}`;

  function setCharacter(next) {
    character = next;
    profile.innerHTML = `${characterAvatar(character)}<div class="agent-profile-copy">
      <strong>${e(character.name)}</strong><span>AI 馆员 · ${e(character.title)}</span></div>`;
    if (messages.querySelector('.chat-welcome')) welcome();
  }

  function welcome() {
    const bookPrompt = exampleBook ? `找《${shortTitle(exampleBook)}》` : '我想查找一本书';
    messages.innerHTML = `<div class="chat-welcome">
      <div class="chat-welcome-card chat-welcome-card--${character.id}">
        <div class="chat-welcome-copy">
          <span class="chat-welcome-kicker">${icon('sparkles', 14)}江大的 AI 馆员</span>
          <h2>你好，我是${e(character.name)}</h2>
          <p>${e(character.greeting)}</p>
        </div>
        <img class="chat-mascot" src="${character.illustration}" width="1024" height="1536" loading="lazy"
          alt="${e(character.description)}">
      </div>
      <div class="chat-suggestions">
        <button class="chat-suggestion" data-chat-prompt="${e(bookPrompt)}">${icon('book')}${e(bookPrompt)}</button>
        <button class="chat-suggestion" data-chat-prompt="明天下午2点到4点，帮我找座位">${icon('seat')}明天下午，帮我找座位</button>
        <button class="chat-suggestion" data-chat-prompt="我想反馈馆内设施问题">${icon('message')}帮我整理一条馆内问题反馈</button>
        <button class="chat-suggestion" data-chat-prompt="签到和退座有哪些规则？">${icon('sparkles')}签到与退座规则</button>
        <button class="chat-suggestion" data-chat-prompt="你能做什么？">${icon('message')}看看馆员会回答什么</button>
      </div>
    </div>`;
  }
  function open(prompt='',submit=false){previousFocus=document.activeElement;drawer.hidden=false;backdrop.hidden=false;document.body.classList.add('no-scroll');document.querySelector('#sidebar').classList.remove('open');if(prompt)input.value=prompt;input.focus();if(prompt&&submit)ask(prompt);}
  function close(){drawer.hidden=true;backdrop.hidden=true;document.body.classList.remove('no-scroll');previousFocus?.focus?.();}
  function scroll(){messages.scrollTo({top:messages.scrollHeight,behavior:'instant'});}
  function addMessage(text, role = 'assistant', cards = '', messageCharacter = character) {
    messages.querySelector('.chat-welcome')?.remove();
    const node = document.createElement('div');
    const speaker = role === 'user' ? '你' : `${characterAvatar(messageCharacter)}${e(messageCharacter.name)}`;
    node.className = `chat-message ${role}`;
    node.innerHTML = `<div class="chat-message-label">${speaker}</div><div class="chat-bubble">${e(text)}</div>${cards}`;
    messages.append(node);
    scroll();
    return node;
  }
  function cardResults(result) {
    const cards = [];
    const sources = [...(result.sources || [])];
    for (const item of result.tool_results || []) {
      if (item.tool === 'get_institution_profile' && !item.result.error) sources.push({title: item.result.source_name, url: item.result.source_url});
    }
    if (sources.length) {
      const links = sources.filter(source => /^https:\/\/(?:www\.moe\.gov\.cn|www\.court\.gov\.cn|www\.ujs\.edu\.cn|lib\.ujs\.edu\.cn)\//.test(source.url));
      cards.push(`<div class="chat-result chat-sources"><h3>公开资料来源</h3><p>正文已内置；打开来源链接需要联网。</p>${links.map(source => `<a href="${e(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.title)}</a>`).join('')}</div>`);
    }
    for (const {tool: name, result: record} of result.tool_results || []) {
      if (record.error) {
        cards.push(`<div class="chat-result"><p>${e(record.error)}</p></div>`);
        continue;
      }
      if (name === 'search_books') {
        for (const book of record.items || []) {
          cards.push(`<div class="chat-result">
            <span class="tag">${e(book.is_demo ? '样例书目' : book.source)}</span>
            <h3>${e(shortTitle(book))}</h3><p>${e(book.author || '作者待补充')}</p>
            <p>${e(book.publisher || book.summary)}${book.isbn ? ` · ISBN ${e(book.isbn)}` : ''}</p>
            <button class="btn btn-soft" data-chat-book="${e(book.id)}">${icon('book',13)}${bookDetailLabel(book)}</button>
          </div>`);
        }
      } else if (name === 'locate_book') {
        cards.push(`<div class="chat-result"><h3>${e(record.title)}</h3>
          <p>${e(record.zone || '馆藏位置待确认')}</p>${record.call_number ? `<p>索书号 ${e(record.call_number)}</p>` : ''}</div>`);
      } else if (name === 'search_seats') {
        for (const seat of record.items || []) {
          const key = crypto.randomUUID();
          seats.set(key, {seat_id: seat.id, start_at: record.start_at, end_at: record.end_at});
          cards.push(`<div class="chat-result"><span class="tag">本站可预约</span>
            <h3>${e(seat.zone)} · 座位 ${e(seatLabel(seat))}</h3>
            <p>${seat.has_power ? '配有插座　' : ''}${seat.quiet_zone ? '安静区域　' : ''}${seat.near_window ? '靠窗位置' : ''}</p>
            <p>${dateTime(record.start_at)} — ${dateTime(record.end_at)}</p>
            <button class="btn btn-soft" data-chat-seat="${key}">选择这个座位</button></div>`);
        }
      } else if (name === 'search_rules') {
        for (const rule of record.items || []) cards.push(`<div class="chat-result"><h3>本站演示规则</h3><p>${e(rule.text)}</p></div>`);
      } else if (name === 'get_my_booking' || name === 'get_my_feedback') {
        cards.push(`<div class="chat-result"><h3>记录 ${e(record.id)}</h3>
          <p>当前状态 ${e(statuses[record.status] || record.status)}</p>${record.reply ? `<p>${e(record.reply)}</p>` : ''}</div>`);
      }
    }
    for (const action of result.pending_actions || []) {
      actions.set(action.action_id, action);
      cards.push(actionCard(action));
    }
    return cards.join('');
  }
  function actionCard(action){const p=action.preview||{};return `<div class="chat-result chat-action-preview"><span class="tag tag-blue">待确认</span><h3>${action.kind==='feedback'?'问题反馈':'预约与座位操作'}</h3><p>${e(p.seat_number ? [p.zone, '座位 ' + p.seat_number].filter(Boolean).join(' · ') : p.seat_id || p.booking_id || p.location || '')}</p>${p.start_at?`<p>${dateTime(p.start_at)} — ${dateTime(p.end_at)}</p>`:''}${p.description?`<p>${e(p.description)}</p>`:''}<button class="btn btn-primary" data-chat-confirm="${e(action.action_id)}">核对并确认</button></div>`;}
  async function ask(text) {
    if (busy) return;
    const value = text.trim();
    if (!value) return;
    const responder = character;
    input.value = '';
    addMessage(value, 'user');
    busy = true;
    send.disabled = true;
    const thinking = document.createElement('div');
    thinking.className = 'chat-thinking';
    thinking.innerHTML = '<i></i><i></i><i></i>';
    thinking.setAttribute('aria-label', '正在查询');
    messages.append(thinking);
    scroll();
    try {
      const result = await api('/api/chat', {message: value, ...(sessionId ? {session_id: sessionId} : {}), ...(offline ? {character: responder.id} : {})});
      sessionId = result.session_id;
      updateTurns(result);
      thinking.remove();
      addMessage(result.answer, 'assistant', cardResults(result), responder);
    } catch (error) {
      thinking.remove();
      addMessage(error.message + ' 可以新建对话或稍后重试。', 'assistant', '', responder);
    } finally {
      busy = false;
      send.disabled = false;
      if (!drawer.hidden) input.focus();
      scroll();
    }
  }
  document.querySelector('#chat-form').addEventListener('submit',event=>{event.preventDefault();ask(input.value);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();ask(input.value);}});
  document.querySelector('#close-agent-button').onclick=close;backdrop.onclick=close;
  function newChat() {
    if (busy) { toast('请等待当前查询完成。'); return; }
    sessionId = null; turnCount = 0; actions.clear(); seats.clear(); input.value = '';
    updateTurns(); welcome(); input.focus();
  }
  document.querySelector('#new-chat-button').onclick = newChat;
  document.querySelector('#restart-chat-button').onclick = newChat;
  drawer.addEventListener('keydown',event=>{if(event.key==='Escape')close();if(event.key==='Tab'){const nodes=[...drawer.querySelectorAll('button:not([disabled]),textarea')].filter(n=>n.offsetParent!==null);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  messages.addEventListener('click',async event=>{const node=event.target.closest('button');if(!node)return;try{if(node.dataset.chatPrompt){ask(node.dataset.chatPrompt);return;}if(node.dataset.chatBook){await showLocation(node.dataset.chatBook,findBook);return;}if(node.dataset.chatSeat){const args=seats.get(node.dataset.chatSeat);const action=await tool('prepare_booking',args);actions.set(action.action_id,action);confirmation(action,async receipt=>{addMessage(`预约已写入本站，编号 ${receipt.id}。可在“我的服务”查询当前状态。`);await refresh();});return;}if(node.dataset.chatConfirm){const action=actions.get(node.dataset.chatConfirm);if(action)confirmation(action,async receipt=>{node.disabled=true;node.textContent='已确认';addMessage(`操作已完成，记录编号 ${receipt.id}。`);await refresh();});}}catch(error){toast(error.message);}});
  setCharacter(initialCharacter);
  welcome();
  updateTurns();
  return {open, close, ask, setCharacter};
}
