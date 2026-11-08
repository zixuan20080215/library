import {icon} from './icons.js';
export const e = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const shortTitle = book => book.title.replace(/^(演示书目：|导入示例：)/,'');
export const statuses={available:'空闲',reserved:'已预约',checked_in:'使用中',cancelled:'已取消',completed:'已结束',expired:'已超时',pending:'待受理',processing:'处理中',replied:'待确认',closed:'已办结',unavailable:'已停用'};
export function badge(status){const color=['checked_in','closed','available'].includes(status)?'green':['pending','reserved','replied'].includes(status)?'orange':'blue';return `<span class="tag tag-${color}">${e(statuses[status]||status)}</span>`;}
export function dateTime(value){if(!value)return '未记录';const d=new Date(value);return Number.isNaN(d.getTime())?e(value):new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);}
export function localInput(value=new Date()){const d=new Date(value);return new Date(d.getTime()+8*3600000).toISOString().slice(0,16);}
export function isoInput(value){return value+':00+08:00';}
export function empty(title,description,action=''){return `<div class="empty-state"><span class="empty-icon">${icon('book',26)}</span><h3>${e(title)}</h3><p>${e(description)}</p>${action}</div>`;}
export function bookCover(book) {
  const colors = ['#355b76', '#b19772', '#557e7a', '#6e7390', '#65809b', '#99806d'];
  const index = (Number(book.id.match(/\d+$/)?.[0]) || 1) - 1;
  return `<div class="book-art"><div class="book-cover" style="--cover:${colors[index % colors.length]}">
    <span class="book-cover-category">${book.is_demo ? '阅读样例' : '图书书单'}</span>
    <span class="book-cover-title">${e(shortTitle(book))}</span>
    <span class="book-cover-bottom">${e(book.is_demo ? '智能图书馆' : book.publisher)}</span>
  </div></div>`;
}
export function bookTile(book) {
  return `<button class="book-tile" data-book="${e(book.id)}" aria-label="查看${e(shortTitle(book))}的书目信息">
    ${bookCover(book)}<h3>${e(shortTitle(book))}</h3>
    <p class="book-author">${e(book.author || '作者待补充')}</p>
    <span class="book-topic">${e(book.publisher || (book.subjects || '').split('|').slice(0, 2).join(' / '))}</span>
  </button>`;
}
export function seatLabel(seat) {
  const id = seat.seat_id || seat.id;
  if (seat.seat_number) return seat.seat_number;
  if (id.startsWith('DEMO-S')) return id.slice(6);
  return id.startsWith('UJS:') ? id.split(':').at(-1) : id;
}
export function seatRooms(items) {
  const rooms = new Map();
  for (const seat of items) {
    if (!rooms.has(seat.zone)) rooms.set(seat.zone, []);
    rooms.get(seat.zone).push(seat);
  }
  return rooms;
}
export function miniMap(items) {
  const floors = new Map();
  for (const seat of items) {
    if (!floors.has(seat.floor)) floors.set(seat.floor, {total: 0, available: 0});
    const count = floors.get(seat.floor);
    count.total++;
    if (seat.status === 'available') count.available++;
  }
  return `<div class="mini-map">
    <div class="mini-map-top"><span>${seatRooms(items).size} 个阅览室</span><span>未来两小时</span></div>
    <div class="floor-counts">${[...floors].map(([floor, count]) => `<div>
      <span>${e(floor)} 楼</span><strong>${count.available}<small> / ${count.total}</small></strong>
    </div>`).join('')}</div>
    <div class="mini-map-bottom"><span class="space-caption">本站可预约</span>
      <span class="availability-count">${items.filter(seat => seat.status === 'available').length}<small>/ ${items.length} 席</small></span>
    </div>
  </div>`;
}
export const bookDetailLabel = book => book.zone || book.floor != null || book.shelf_id ? '馆内位置' : '查看书目';
export function heading(title,subtitle,extra=''){return `<div class="page-heading"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${extra}</div>`;}
export let runtime={};
export function setRuntime(config){runtime=config;}
export async function api(path, data){const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'X-Demo-Token':runtime.api_token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});let result;try{result=await response.json();}catch{throw new Error('服务响应异常，请确认启动的是图书馆应用服务。');}if(!response.ok||result.error)throw new Error(result.error||'暂时无法完成操作，请重试。');return result;}
let toastTimer;
export function toast(text){const node=document.querySelector('#toast');node.textContent=text;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,3800);}
export function dialog(title, subtitle, content, buttons = []) {
  const node = document.querySelector('#app-dialog');
  const footer = buttons.length ? `<div class="dialog-footer">${buttons.map((button, index) =>
    `<button class="btn ${button.primary ? 'btn-primary' : ''}" data-modal-button="${index}">${e(button.label)}</button>`).join('')}</div>` : '';
  node.innerHTML = `<button class="icon-button dialog-close" data-close-dialog aria-label="关闭对话框">${icon('close')}</button>
    <div class="dialog-heading"><h2 id="app-dialog-title">${e(title)}</h2><p id="app-dialog-subtitle">${e(subtitle)}</p></div>
    <div class="dialog-content">${content}</div>${footer}`;
  node.querySelector('[data-close-dialog]').onclick = () => node.close();
  buttons.forEach((button, index) => {
    node.querySelector(`[data-modal-button="${index}"]`).onclick = async event => {
      const control = event.currentTarget;
      control.disabled = true;
      try { await button.action(node); }
      catch (error) { toast(error.message); }
      finally { control.disabled = false; }
    };
  });
  if (!node.open) node.showModal();
  return node;
}
export function tool(name,args){return api('/api/tool-preview',{name,arguments:args});}
function detailRow(label, value) {
  return `<div class="detail-row"><span>${e(label)}</span><strong>${e(value)}</strong></div>`;
}
export async function showLocation(id, findBook) {
  const result = await tool('locate_book', {book_id: id});
  const book = {...findBook?.(id), ...result};
  const hasLocation = bookDetailLabel(book) === '馆内位置';
  const bibliography = [
    ['作者', book.author || '待补充'], ['ISBN', book.isbn || '待补充'],
    ['出版社', book.publisher || '待补充'], ['资料来源', book.source || '导入书目'],
  ];
  const holdings = hasLocation ? [
    ['所在楼层', book.floor == null ? '待确认' : `${book.floor}楼`],
    ['馆藏区域', book.zone || '待确认'], ['书架标识', book.shelf_id || '待确认'],
    ['索书号', book.call_number || '待确认'],
  ] : [['馆藏位置', '待确认']];
  const availability = {available: '可借', unavailable: '不可借', on_loan: '借出'};
  const content = [...bibliography, ...holdings, ['可借状态', availability[book.availability] || '待确认']]
    .map(([label, value]) => detailRow(label, value)).join('');
  dialog(shortTitle(book), hasLocation ? '书目信息与馆内位置' : '书目信息', content,
    [{label: '知道了', primary: true, action: node => node.close()}]);
}
export function confirmation(action, onDone) {
  const labels = {reserve:'确认预约', check_in:'确认签到', cancel:'确认取消', release:'确认退座', feedback:'确认提交'};
  const preview = action.preview || {};
  const names = {seat_id:'座位编号', seat_number:'座位编号', zone:'阅览室', start_at:'开始时间', end_at:'结束时间',
    booking_id:'预约编号', category:'问题类型', location:'所在位置', description:'问题描述'};
  const content = Object.entries(preview)
    .filter(([key]) => key !== 'seat_id' || !preview.seat_number)
    .map(([key, value]) => detailRow(names[key] || key, key.endsWith('_at') ? dateTime(value) : value)).join('');
  return dialog(labels[action.kind] || '确认操作', '请核对信息，确认后写入本站。', content, [
    {label: '再想一下', action: node => node.close()},
    {label: labels[action.kind] || '确认', primary: true, action: async node => {
      const result = await api('/api/actions/confirm', {action_id: action.action_id});
      node.close();
      toast(result.id ? `操作已完成，编号 ${result.id}` : '操作已完成');
      await onDone?.(result);
    }},
  ]);
}
