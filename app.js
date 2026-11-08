import {hydrateIcons,icon} from './icons.js';
import {api,setRuntime,runtime,e,toast,tool,dialog,confirmation,showLocation,localInput,isoInput,dateTime,statuses} from './ui.js';
import * as views from './views.js';
import {createAssistant} from './assistant.js';
import {agentCharacters} from './characters.js';

const main=document.querySelector('#main');
const roleLink = document.querySelector('#role-link');
const CHARACTER_KEY = 'ujs.agentCharacter';

function savedCharacter() {
  try {
    const id = localStorage.getItem(CHARACTER_KEY);
    if (Object.hasOwn(agentCharacters, id)) return agentCharacters[id];
  } catch {}
  return agentCharacters.xiaoshu;
}

const state = {
  view: 'home', staff: false, config: {}, data: null, filters: {}, selectedSeat: null,
  seatRoom: '', seatNumberQuery: '', seatMapPitch: null, query: '', catalogPage: 1, catalogSource: '', catalog: null,
  servicesTab: 'bookings', staffTickets: {items: []}, character: savedCharacter(),
};
let assistant,refreshing=false;
const findBook=id=>(state.catalog||[]).find(b=>b.id===id)||state.data?.books.items.find(b=>b.id===id);
const pageLabel=()=>({home:'服务总览',books:'馆藏发现',seats:state.staff?'座位管理':'空间与选座',feedback:'事务反馈',services:'我的服务',admin:'管理总览','staff-tickets':'事务办理'}[state.view]);

const MAP_MAX_PITCH = 48;

function sizeRoomMap(viewport) {
  const map = viewport.querySelector('.room-map');
  const padding = parseFloat(getComputedStyle(map.parentElement).paddingLeft);
  const availableWidth = viewport.offsetWidth - 2 * padding - 3;
  const availableHeight = parseFloat(getComputedStyle(viewport).maxHeight) - 2 * padding - 3;
  const fit = Math.min(32, availableWidth / Number(map.dataset.columns), availableHeight / Number(map.dataset.rows));
  const pitch = Math.max(fit, state.seatMapPitch ?? fit);
  map.style.setProperty('--pitch', `${pitch}px`);
  map.dataset.pitch = pitch;
  map.dataset.fit = fit;
  map.classList.toggle('room-map--tiny', pitch < 12);
  viewport.classList.toggle('can-pan', viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight);
  main.querySelector('[data-map-zoom="fit"]').disabled = pitch <= fit + 0.1;
  main.querySelector('[data-map-zoom="out"]').disabled = pitch <= fit + 0.1;
  main.querySelector('[data-map-zoom="in"]').disabled = pitch >= MAP_MAX_PITCH;
}

function zoomRoomMap(action) {
  const viewport = main.querySelector('.room-map-viewport');
  const map = viewport.querySelector('.room-map');
  const pitch = Number(map.dataset.pitch);
  const fit = Number(map.dataset.fit);
  const view = viewport.getBoundingClientRect();
  const centerX = view.left + viewport.clientWidth / 2;
  const centerY = view.top + viewport.clientHeight / 2;
  const before = map.getBoundingClientRect();
  const x = (centerX - before.left) / before.width;
  const y = (centerY - before.top) / before.height;
  if (action === 'fit') state.seatMapPitch = null;
  if (action === 'in') state.seatMapPitch = Math.min(MAP_MAX_PITCH, Math.max(17, pitch * 1.55));
  if (action === 'out') state.seatMapPitch = Math.max(fit, pitch <= 17 ? fit : pitch / 1.55);
  sizeRoomMap(viewport);
  const after = map.getBoundingClientRect();
  viewport.scrollBy(after.left + x * after.width - centerX, after.top + y * after.height - centerY);
}

function locateSeatMatch() {
  const query = state.seatNumberQuery.trim().toUpperCase();
  const viewport = main.querySelector('.room-map-viewport');
  if (!query || !viewport) return;
  const buttons = [...viewport.querySelectorAll('.seat-button:enabled')];
  const target = buttons.find(button => button.textContent.trim().toUpperCase() === query) || buttons[0];
  if (!target) return;
  state.seatMapPitch = Math.max(28, Number(viewport.querySelector('.room-map').dataset.pitch));
  sizeRoomMap(viewport);
  const view = viewport.getBoundingClientRect();
  const seat = target.getBoundingClientRect();
  viewport.scrollBy(seat.left + seat.width / 2 - view.left - viewport.clientWidth / 2,
    seat.top + seat.height / 2 - view.top - viewport.clientHeight / 2);
}

function render() {
  if (!state.data) return;
  const previousMap = main.querySelector('.room-map-viewport');
  document.querySelector('#main-nav').innerHTML = views.navigation(state.view, state.staff);
  document.querySelector('#current-page-label').textContent = pageLabel();
  document.title = pageLabel() + ' · 江苏大学智能图书馆';
  const renderers = {home: views.home, books: views.books, seats: views.seats, feedback: views.feedback,
    services: views.services, admin: views.admin, 'staff-tickets': views.staffTickets};
  const previousScroll = previousMap && [previousMap.scrollLeft, previousMap.scrollTop];
  main.innerHTML = renderers[state.view](state);
  const viewport = main.querySelector('.room-map-viewport');
  if (viewport) {
    sizeRoomMap(viewport);
    if (previousMap?.dataset.room === viewport.dataset.room) viewport.scrollTo(...previousScroll);
  }
  document.querySelector('#sidebar').classList.remove('open');
}
async function loadSeats(){const params=new URLSearchParams({start_at:isoInput(state.start),end_at:isoInput(state.end)});state.seats=await api('/api/seats/map?'+params);}
async function refresh(){if(refreshing)return;refreshing=true;try{state.data=await api('/api/bootstrap');state.config={...runtime,...state.data.config};if(state.staff)state.staffTickets=await api('/api/staff/tickets');if(state.view==='seats')await loadSeats();render();}finally{refreshing=false;}}
async function navigate(view){const allowed=state.staff?['admin','staff-tickets','seats']:views.NAV.map(v=>v.id);if(!allowed.includes(view))return;state.view=view;history.replaceState(null,'','#'+view);if(view==='seats')await loadSeats();if(view==='services')state.data.services=await api('/api/services');if(state.staff&&(view==='admin'||view==='staff-tickets')){state.staffTickets=await api('/api/staff/tickets');state.data.overview=(await api('/api/bootstrap')).overview;}render();window.scrollTo({top:0,behavior:'instant'});}
function formTimes() {
  const start = document.querySelector('#seat-start')?.value;
  const end = document.querySelector('#seat-end')?.value;
  if (!start || !end) throw new Error('请先选择开始和结束时间。');
  if (new Date(isoInput(end)) <= new Date(isoInput(start))) throw new Error('结束时间需要晚于开始时间。');
  state.start = start;
  state.end = end;
  state.seatRoom = document.querySelector('#seat-room').value;
  state.seatNumberQuery = document.querySelector('#seat-number').value;
  state.filters = {
    has_power: document.querySelector('#filter-power')?.checked ?? false,
    quiet_zone: document.querySelector('#filter-quiet')?.checked ?? false,
    near_window: document.querySelector('#filter-window')?.checked ?? false,
  };
}

function showStaffLogin() {
  const {username, password} = runtime.staff_demo_login;
  const modal = dialog('馆员工作台登录', '输入管理员名称和密码后进入工作台。', `
    <form id="staff-login-form" method="post">
      <div class="staff-login-grid">
        <div class="staff-login-fields">
          <label class="field">管理员名称<input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" required></label>
          <label class="field">密码<input name="password" type="password" autocomplete="current-password" maxlength="64" required></label>
        </div>
        <aside class="staff-login-demo" aria-label="演示账号">
          <h3>${icon('shield', 16)}参赛演示账号</h3>
          <dl><div><dt>账号</dt><dd><code>${e(username)}</code></dd></div>
          <div><dt>密码</dt><dd><code>${e(password)}</code></dd></div></dl>
        </aside>
      </div>
      <p class="staff-login-error" role="alert" hidden></p>
      <div class="dialog-footer">
        <button class="btn" type="button" data-cancel-login>取消</button>
        <button class="btn btn-primary" type="submit">验证并进入</button>
      </div>
    </form>`);
  const form = modal.querySelector('#staff-login-form');
  const submit = form.querySelector('[type="submit"]');
  const errorMessage = form.querySelector('[role="alert"]');
  form.querySelector('[data-cancel-login]').onclick = () => modal.close();
  modal.addEventListener('close', () => form.reset(), {once: true});
  form.elements.username.focus();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    errorMessage.hidden = true;
    try {
      await api('/api/staff/login', {username: form.elements.username.value.trim(), password: form.elements.password.value});
      if (modal.open && form.isConnected) location.assign('/staff');
    } catch (error) {
      if (!modal.open || !form.isConnected) return;
      errorMessage.textContent = error.message;
      errorMessage.hidden = false;
      form.elements.password.focus();
      form.elements.password.select();
    } finally {
      submit.disabled = false;
    }
  });
}

roleLink.addEventListener('click', async event => {
  event.preventDefault();
  if (!state.staff) {
    showStaffLogin();
    return;
  }
  try {
    await api('/api/staff/logout', {});
    location.assign('/');
  } catch (error) {
    toast(error.message);
  }
});

function showHelp(){dialog('欢迎使用智能图书馆','找书、选座、反馈，都从这里开始。',`<p>馆藏发现可按书名、作者、ISBN 或出版社检索。打开书目详情即可查看来源及馆藏信息。</p><p style="margin-top:12px">空间与选座：选择使用时间和条件，点击座位后核对并确认预约。</p><p style="margin-top:12px">事务反馈：填写具体情况与位置，提交后在“我的服务”跟踪办理进度。</p><p style="margin-top:12px">AI馆员：点击首页输入框、顶部按钮或右下角入口。当前${state.config.model_mode==='deepseek'?'已配置DeepSeek接口':'为规则演示，可使用提示中的示例问题'}。</p><p class="section-note">本项目为参赛原型，当前数据及流程不代表学校正式服务。</p>`,[{label:'开始体验',primary:true,action:node=>node.close()}]);}
function showConnectionHelp(){dialog('模型与数据接入','仅展示配置位置，不读取或展示密钥。',`<p>在 <strong>agent_backend/.env</strong> 中填写模型配置，保存后重启服务。</p><div class="detail-row"><span>模型Key</span><strong>DEEPSEEK_API_KEY</strong></div><div class="detail-row"><span>模型地址</span><strong>DEEPSEEK_BASE_URL</strong></div><div class="detail-row"><span>模型名称</span><strong>DEEPSEEK_MODEL</strong></div><div class="detail-row"><span>数据模式</span><strong>LIBRARY_DATA_MODE</strong></div><div class="detail-row"><span>本地数据库</span><strong>DATABASE_PATH</strong></div><div class="detail-row"><span>后续数据服务</span><strong>LIBRARY_API_BASE_URL</strong></div><p class="section-note">外部数据服务需按DATABASE_API.md适配后接入。当前网页不会收集API Key，配置文件也不会通过网页公开。</p>`,[{label:'知道了',primary:true,action:node=>node.close()}]);}
function showTicket(id){const ticket=[...state.data.services.tickets,...(state.staffTickets?.items||[])].find(t=>t.id===id);if(!ticket)return;dialog('问题办理记录',ticket.id,`<div class="detail-row"><span>问题类型</span><strong>${e(ticket.category)}</strong></div><div class="detail-row"><span>所在位置</span><strong>${e(ticket.location)}</strong></div><p style="margin-top:13px">${e(ticket.description)}</p><div class="timeline">${(ticket.history||[]).map(h=>`<div class="timeline-event"><strong>${e(statuses[h.status]||h.status)}</strong><p>${e(h.note)}</p><time>${dateTime(h.created_at)}</time></div>`).join('')}</div>`,[{label:'关闭',primary:true,action:node=>node.close()}]);}

function selectCharacter(id) {
  if (!Object.hasOwn(agentCharacters, id) || state.character.id === id) return;
  state.character = agentCharacters[id];
  try { localStorage.setItem(CHARACTER_KEY, id); } catch {}
  assistant?.setCharacter(state.character);
  const label = main.querySelector('#hero-active-character');
  if (label) label.textContent = state.character.name;
  for (const button of document.querySelectorAll('[data-agent-character]')) {
    button.setAttribute('aria-pressed', button.dataset.agentCharacter === id);
  }
}

document.addEventListener('click',async event=>{const node=event.target.closest('button,[data-view]');if(!node||node.disabled)return;try{
  if(node.dataset.agentCharacter){selectCharacter(node.dataset.agentCharacter);return;}
  if(node.hasAttribute('data-agent')){assistant?.open();return;}
  if(node.dataset.prompt){assistant?.open(node.dataset.prompt,true);return;}
  if(node.dataset.view){event.preventDefault();await navigate(node.dataset.view);return;}
  if(node.dataset.book){await showLocation(node.dataset.book,findBook);return;}
  if (node.hasAttribute('data-book-source')) {
    state.catalogSource = node.dataset.bookSource;
    state.catalogPage = 1;
    render();
    return;
  }
  if (node.hasAttribute('data-book-page')) {
    state.catalogPage = Number(node.dataset.bookPage);
    render();
    window.scrollTo({top: 0, behavior: 'instant'});
    return;
  }
  if (node.dataset.mapZoom) {
    zoomRoomMap(node.dataset.mapZoom);
    return;
  }
  if (node.dataset.seat) {
    const numbered = node.closest('.seat-grid--numbered');
    const scrollTop = numbered?.scrollTop;
    state.selectedSeat = node.dataset.seat;
    render();
    if (numbered) main.querySelector('.seat-grid--numbered').scrollTop = scrollTop;
    main.querySelector('.seat-button[aria-pressed="true"]')?.focus({preventScroll: true});
    return;
  }
  if(node.dataset.reserveSeat){formTimes();await loadSeats();const seat=state.seats.items.find(s=>s.id===node.dataset.reserveSeat);if(!seat||seat.status!=='available')throw new Error('该座位的状态已变化，请重新选择。');const action=await tool('prepare_booking',{seat_id:seat.id,start_at:state.seats.start_at,end_at:state.seats.end_at});confirmation(action,async()=>{state.selectedSeat=seat.id;await refresh();});return;}
  if(node.dataset.bookingChange){const action=await tool('prepare_booking_change',{booking_id:node.dataset.bookingId,operation:node.dataset.bookingChange});confirmation(action,refresh);return;}
  if(node.dataset.serviceTab){state.servicesTab=node.dataset.serviceTab;render();return;}
  if(node.hasAttribute('data-refresh')){await refresh();toast('记录已更新');return;}
  if(node.dataset.ticketDetail){showTicket(node.dataset.ticketDetail);return;}
  if(node.dataset.ticketUpdate){await api('/api/tickets/update',{ticket_id:node.dataset.ticketId,operation:node.dataset.ticketUpdate});await refresh();toast(node.dataset.ticketUpdate==='confirm'?'已确认办结':'已申请继续处理');return;}
  if(node.dataset.staffUpdate){await api('/api/staff/tickets/update',{ticket_id:node.dataset.ticketId,operation:node.dataset.staffUpdate});await refresh();toast('已受理，读者可查看处理进度');return;}
  if(node.dataset.disableSeat){await api('/api/staff/seats/update',{seat_id:node.dataset.disableSeat,disabled:node.dataset.disabled==='true'});await refresh();toast('座位状态已更新');return;}
  if(node.id==='connection-help'){showConnectionHelp();return;}
}catch(error){toast(error.message);}});

document.addEventListener('submit',async event=>{const form=event.target;if(!['hero-search','catalog-search','seat-search','feedback-form'].includes(form.id)&&!form.dataset.staffReply)return;event.preventDefault();const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;try{
  if(form.id==='hero-search'){assistant.open(document.querySelector('#hero-query').value,true);form.reset();}
  if (form.id === 'catalog-search') {
    state.query = document.querySelector('#catalog-query').value.trim();
    state.catalogPage = 1;
    state.catalog = state.config.data_mode === 'http' && state.query
      ? (await api('/api/books?q=' + encodeURIComponent(state.query))).items
      : null;
    render();
  }
  if(form.id==='seat-search'){formTimes();await loadSeats();render();locateSeatMatch();}
  if(form.id==='feedback-form'){const data=Object.fromEntries(new FormData(form));const action=await tool('prepare_feedback',data);confirmation(action,async()=>{state.servicesTab='tickets';await refresh();await navigate('services');});}
  if(form.dataset.staffReply){const data=new FormData(form);await api('/api/staff/tickets/update',{ticket_id:form.dataset.staffReply,operation:'reply',reply:data.get('reply')});await refresh();toast('处理结果已回复给读者');}
}catch(error){toast(error.message);}finally{if(submit)submit.disabled=false;}});
document.addEventListener('change', async event => {
  const field = event.target.id;
  if (!['seat-room', 'filter-power', 'filter-quiet', 'filter-window'].includes(field)) return;
  try {
    if (field === 'seat-room') {
      state.selectedSeat = null;
      state.seatMapPitch = null;
      document.querySelector('#seat-number').value = '';
    }
    formTimes();
    await loadSeats();
    render();
  } catch (error) {
    toast(error.message);
  }
});

let mapDrag;
main.addEventListener('pointerdown', event => {
  const viewport = event.target.closest('.room-map-viewport.can-pan');
  if (!viewport || event.pointerType !== 'mouse' || event.button !== 0) return;
  const bounds = viewport.getBoundingClientRect();
  if (event.clientX - bounds.left >= viewport.clientWidth || event.clientY - bounds.top >= viewport.clientHeight) return;
  mapDrag = {viewport, id: event.pointerId, x: event.clientX, y: event.clientY,
    left: viewport.scrollLeft, top: viewport.scrollTop, active: false};
});
document.addEventListener('pointermove', event => {
  if (!mapDrag || event.pointerId !== mapDrag.id || !mapDrag.viewport.isConnected) return;
  const {viewport, left, top, x, y} = mapDrag;
  const dx = event.clientX - x;
  const dy = event.clientY - y;
  if (!mapDrag.active) {
    if (Math.hypot(dx, dy) < 5) return;
    mapDrag.active = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  }
  viewport.scrollTo(left - dx, top - dy);
});
function finishMapDrag(event) {
  if (mapDrag?.id !== event.pointerId) return;
  mapDrag.viewport.classList.remove('is-panning');
  mapDrag = null;
}
document.addEventListener('pointerup', finishMapDrag);
document.addEventListener('pointercancel', finishMapDrag);
window.addEventListener('resize', () => {
  const viewport = main.querySelector('.room-map-viewport');
  if (viewport) sizeRoomMap(viewport);
});
document.querySelector('#help-button').onclick=showHelp;
document.querySelector('#menu-button').onclick=()=>document.querySelector('#sidebar').classList.toggle('open');
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();assistant?.open();}if(event.key==='Escape')document.querySelector('#sidebar').classList.remove('open');});

async function init() {
  try {
    const config = JSON.parse(document.querySelector('#runtime-config').textContent);
    setRuntime(config);
    state.config = config;
    state.staff = config.role === 'staff_demo';
    if (state.staff) {
      document.querySelector('.nav-caption').textContent = '馆员服务';
      document.querySelector('#identity-label').textContent = '馆员演示';
      roleLink.href = '/';
      roleLink.setAttribute('aria-label', '退出并返回读者页');
      roleLink.innerHTML = icon('book') + '<span>退出并返回读者页</span>' + icon('external', 13);
      state.view = 'admin';
    }
    const start = new Date(Date.now() + 5 * 60000);
    state.start = localInput(start);
    state.end = localInput(new Date(start.getTime() + 2 * 3600000));
    await refresh();
    state.seats = state.data.seats;
    assistant = createAssistant({refresh, findBook, exampleBook: state.data.books.items[0], initialCharacter: state.character});
    const hash = location.hash.slice(1);
    if (hash) await navigate(hash);
    else render();
    hydrateIcons();
    const url = new URL(location.href);
    if (!state.staff && url.searchParams.has('staff_login')) {
      url.searchParams.delete('staff_login');
      history.replaceState(null, '', url);
      showStaffLogin();
    }
  } catch (error) {
    main.innerHTML = `<section class="error-panel"><h2>暂时无法连接图书馆服务</h2><p>请通过项目文件夹中的“启动智能图书馆.cmd”启动，再访问终端显示的本地地址。</p><code>python -X utf8 agent_backend\\server.py</code><p>${e(error.message)}</p></section>`;
    hydrateIcons();
  }
}
init();
