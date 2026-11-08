import {icon} from './icons.js';
import {e, shortTitle, badge, statuses, dateTime, bookCover, bookTile, miniMap, heading, empty, seatLabel, seatRooms, bookDetailLabel} from './ui.js';
import {seatLayouts} from './seat-layouts.js';
import {agentCharacters} from './characters.js';

export const NAV=[{id:'home',label:'服务总览',icon:'home'},{id:'books',label:'馆藏发现',icon:'book'},{id:'seats',label:'空间与选座',icon:'seat'},{id:'feedback',label:'事务反馈',icon:'message'},{id:'services',label:'我的服务',icon:'clipboard'}];
export function navigation(view,staff){const entries=staff?[{id:'admin',label:'管理总览',icon:'dashboard'},{id:'staff-tickets',label:'事务办理',icon:'message'},{id:'seats',label:'座位管理',icon:'seat'}]:NAV;return entries.map(item=>`<button class="nav-item ${view===item.id?'active':''}" data-view="${item.id}" aria-label="${item.label}" title="${item.label}" ${view===item.id?'aria-current="page"':''}>${icon(item.icon)}<span>${item.label}</span>${item.id==='home'?'<span class="nav-badge">AI</span>':''}</button>`).join('');}
export function home(s) {
  const featured = s.data.books.items[0];
  const bookPrompt = featured ? `找《${shortTitle(featured)}》` : '帮我找一本书';
  const floor = s.data.seats.items.find(seat => seat.floor === 2)?.floor || s.data.seats.items[0]?.floor || 2;
  const seatPrompt = `明天14:00到16:00，找${floor}楼的座位`;
  const now = new Date();
  const date = new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long'}).format(now);
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now).map(part => [part.type, part.value]));
  const dateCode = `${dateParts.year}/${dateParts.month}/${dateParts.day}`;
  const roomTotal = new Set(s.data.seats.items.map(seat => seat.zone)).size;
  return `${heading('欢迎，江大读者','从这里开始，连接知识、空间与校园服务。',`<span class="date-pill">${icon('calendar')}${e(date)}</span>`)}
<section class="hero" aria-label="AI馆员主对话区">
  <img class="hero-column" src="/assets/archive-column.svg" alt="" aria-hidden="true" width="320" height="640">
  <div class="hero-masthead">
    <div class="hero-edition"><span class="hero-edition-number">09</span><div><span>RECHERCHE · 2026</span><strong>智慧图书馆</strong><small>BOOKS · SPACES · SERVICES</small></div></div>
    <span class="hero-french">Chercher dans le ciel</span>
    <div class="hero-masthead-date"><strong>${dateCode}</strong><span>INDEX 09 · UJS ARCHIVE</span></div>
  </div>
  <div class="hero-composition">
    <div class="hero-copy">
      <div class="hero-caption"><span class="hero-issue">N° 09</span>${icon('sparkles', 15)}BIBLIOTHÈQUE INTELLIGENTE</div>
      <h2><span>来图书馆，</span><em>从一句话开始</em></h2>
      <p class="hero-lead">找书、选座，或反馈馆内问题。<br>让每一次抵达，都有温柔的回应。</p>
      <form class="hero-search" id="hero-search">
        <label for="hero-query">${icon('message', 18)}<span>ÉCRIVEZ-MOI · 向 <strong id="hero-active-character">${e(s.character.name)}</strong> 提问</span></label>
        <div class="hero-search-row">
          <input id="hero-query" placeholder="今天，想读点什么？" maxlength="1000" required>
          <button class="btn btn-primary" type="submit">开始对话 ${icon('send', 17)}</button>
        </div>
      </form>
      <div class="hero-suggestions">
        <button class="suggestion-chip" data-prompt="${e(bookPrompt)}">${e(bookPrompt)}</button>
        <button class="suggestion-chip" data-prompt="${e(seatPrompt)}">按楼层找座</button>
        <button class="suggestion-chip" data-prompt="我想反馈馆内设施问题">反馈馆内设施问题</button>
      </div>
      <p class="hero-handnote">“把想读的书、想坐的位置，交给懂你的馆员。”</p>
    </div>
    <div class="hero-character-stage" role="group" aria-label="选择 AI 馆员">
      <svg class="hero-astrolabe" viewBox="0 0 420 420" aria-hidden="true" focusable="false">
        <defs><path id="archive-orbit" d="M210 210m-164 0a164 164 0 1 1 328 0a164 164 0 1 1-328 0"></path></defs>
        <circle cx="210" cy="210" r="164"></circle><circle cx="210" cy="210" r="128"></circle>
        <path d="M210 44L376 210L210 376L44 210Z M210 28V392M28 210H392"></path>
        <text><textPath href="#archive-orbit">01 LIRE · 02 CHERCHER · 03 RENCONTRER · BIBLIOTHÈQUE · </textPath></text>
      </svg>
      <p class="hero-character-title">CHOISIR VOTRE BIBLIOTHÉCAIRE <span>选择一位 AI 馆员</span></p>
      <div class="hero-character-grid">${Object.values(agentCharacters).map((character, index) => `
        <button type="button" class="hero-character hero-character--${character.id}" data-agent-character="${character.id}" aria-pressed="${s.character.id === character.id}">
          <span class="hero-character-figure"><img src="${character.illustration}" alt="" width="1024" height="1536"></span>
          <span class="hero-character-caption">
            <span class="hero-character-index">0${index + 1}</span>
            <span><strong>${e(character.name)}</strong><small>${e(character.title)}</small></span>
            <span class="hero-character-mark" aria-hidden="true">${icon('check', 13)}</span>
          </span>
        </button>`).join('')}</div>
    </div>
    <aside class="hero-ledger" aria-label="图书馆档案概览">
      <span class="hero-ledger-kicker">LIRE · TROUVER</span>
      <strong class="hero-ledger-character">阅</strong>
      <p>书中自有<br>万千宇宙。</p>
      <dl><div><dt>馆藏档案</dt><dd>${s.data.overview.books_total}</dd></div><div><dt>阅览座位</dt><dd>${s.data.overview.seats_total}</dd></div><div><dt>阅览空间</dt><dd>${String(roomTotal).padStart(2, '0')}</dd></div></dl>
      <span class="hero-barcode" aria-hidden="true"></span>
    </aside>
  </div>
  <span class="hero-stamp" aria-hidden="true">UJS<small>AI · 2026</small></span>
  <img class="hero-flourish" src="/assets/archive-flourish.svg" alt="" aria-hidden="true" width="420" height="74">
  <div class="hero-services"><div class="hero-services-caption"><span>SERVICES DU JOUR</span><strong>今日服务</strong></div><div class="service-grid"><button class="service-card" data-view="books"><span class="service-icon">${icon('book')}</span><div><h3>馆藏发现</h3><p>找到下一本值得阅读的书</p><span class="service-meta">${s.data.overview.books_total} 条档案</span></div><span class="card-chevron">${icon('arrow')}</span></button><button class="service-card" data-view="seats"><span class="service-icon teal">${icon('seat')}</span><div><h3>空间与选座</h3><p>抵达适合你的学习角落</p><span class="service-meta teal-text">${s.data.overview.seats_total} 个座位</span></div><span class="card-chevron">${icon('arrow')}</span></button><button class="service-card" data-view="feedback"><span class="service-icon amber">${icon('message')}</span><div><h3>事务反馈</h3><p>每一条建议，都有迹可循</p><span class="service-meta amber-text">一事一单 · 进度可查</span></div><span class="card-chevron">${icon('arrow')}</span></button></div></div>
</section>
<div class="home-lower"><section class="panel panel-padding"><div class="panel-header"><div><span class="panel-kicker">LECTURES · 01</span><h2>阅读，从这里出发</h2><p>查看导入书单中的图书</p></div><button class="btn-text" data-view="books">全部书目 ${icon('arrow')}</button></div><div class="books-row">${s.data.books.items.slice(0,3).map(bookTile).join('')}</div></section><section class="panel panel-padding space-panel"><div class="panel-header"><div><span class="panel-kicker">ESPACES · 02</span><h2>空间速览</h2><p>按楼层查看本站座位</p></div><span class="tag tag-green">空间服务</span></div>${miniMap(s.data.seats.items)}<button class="btn" data-view="seats">查看座位与预约 ${icon('arrow')}</button></section></div>
<div class="quick-notice">${icon('bell')}<span><strong>让服务多一点回应</strong> 预约记录与问题办理进度，都可以在“我的服务”查看。</span><button class="btn-text" data-view="services">查看记录 ${icon('arrow')}</button></div>`;}

const BOOK_PAGE_SIZE = 12;

function bookMatches(book, query) {
  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase();
  const text = normalize(query).trim();
  if (!text) return true;
  const isbn = text.replace(/^isbn(?:-1[03])?\s*[:：]?\s*/i, '').replace(/[\s\-‐‑–]/g, '');
  if (/^(?:\d{13}|\d{9}[\dx])$/.test(isbn)) {
    return normalize(book.isbn).replace(/-/g, '') === isbn;
  }
  const fields = [book.title, book.author, book.publisher, book.isbn, book.subjects].map(normalize);
  return text.split(/\s+/).every(term => fields.some(field => field.includes(term)));
}

function catalogCard(book) {
  return `<article class="catalog-card">
    ${bookCover(book)}
    <div class="catalog-card-body">
      <h3 title="${e(shortTitle(book))}">${e(shortTitle(book))}</h3>
      <p class="book-author">${e(book.author || '作者待补充')}</p>
      <p class="catalog-summary">${e(book.publisher || book.summary || '出版社待补充')}
        ${book.isbn ? `<br>ISBN ${e(book.isbn)}` : ''}
      </p>
      <div class="catalog-card-footer"><span class="tag">${e(book.is_demo ? '样例书目' : book.source)}</span>
        <button class="btn-text" data-book="${e(book.id)}">${icon('book', 15)}${bookDetailLabel(book)}</button>
      </div>
    </div>
  </article>`;
}

export function books(s) {
  const allBooks = s.data.books.items;
  const sources = [...new Set(allBooks.filter(book => !book.is_demo).map(book => book.source).filter(Boolean))];
  const results = s.catalog ?? allBooks.filter(book => bookMatches(book, s.query));
  const items = results.filter(book => !s.catalogSource || book.source === s.catalogSource);
  const pages = Math.max(1, Math.ceil(items.length / BOOK_PAGE_SIZE));
  const page = Math.min(s.catalogPage, pages);
  const visible = items.slice((page - 1) * BOOK_PAGE_SIZE, page * BOOK_PAGE_SIZE);
  return `${heading('馆藏发现', '从图书书单查找书名、作者、ISBN 和出版社。',
    `<button class="btn btn-soft" data-prompt="我想找书，请根据我的阅读目标帮我推荐">${icon('sparkles')}让AI帮我找</button>`)}
    <form class="search-toolbar" id="catalog-search">
      <label class="search-field">${icon('search')}<span class="sr-only">检索书目</span>
        <input id="catalog-query" placeholder="输入书名、作者、ISBN 或出版社" value="${e(s.query)}" maxlength="1000">
      </label>
      <button type="submit" class="btn btn-primary">检索书目</button>
    </form>
    ${sources.length ? `<div class="topic-filters">${['', ...sources].map(source =>
      `<button class="filter-chip ${s.catalogSource === source ? 'active' : ''}" data-book-source="${e(source)}">${e(source || '全部书单')}</button>`).join('')}</div>` : ''}
    <p class="result-caption">${items.length} 条${s.query ? '匹配记录' : '书目记录'}${items.length ? ` · 第 ${page} / ${pages} 页` : ''}</p>
    <div class="catalog-grid">${visible.length ? visible.map(catalogCard).join('') :
      empty('暂未找到匹配书目', '可更换书名、作者、ISBN 或出版社试试。')}</div>
    ${pages > 1 ? `<nav class="catalog-pages" aria-label="书目分页">
      <button class="btn" data-book-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} / ${pages} 页</span>
      <button class="btn" data-book-page="${page + 1}" ${page === pages ? 'disabled' : ''}>下一页</button>
    </nav>` : ''}`;
}

function seatButton(seat, selected, filters, position = '', dimmed = false) {
  const number = e(seatLabel(seat));
  const active = seat.id === selected;
  const label = `座位 ${number}，${e(statuses[seat.status])}`;
  return `<button class="seat-button ${e(seat.status)} ${active ? 'selected' : ''} ${dimmed || !matches(seat, filters) ? 'filtered-out' : ''}"
    data-seat="${e(seat.id)}" aria-label="${label}" aria-pressed="${active}" ${position ? `style="${position}" title="${label}"` : ''} ${dimmed ? 'disabled' : ''}>
    ${position ? '' : icon('seat', 14)}<span>${number}</span>${seat.has_power ? '<i class="power-indicator"></i>' : ''}
  </button>`;
}

const mapFixtures = {
  table: ['阅览桌', '<path d="M4 6h16v9H4zM6 15v4m12-4v4M4 11h16M10 8.5h4m-4 5h4"/>'],
  bookshelf: ['书架', '<path d="M3 19l2-14 4 1-2 13zm7-14h5v14h-5zm5 0h5v14h-5zM12 8v2m5-2v2"/>'],
  entrance: ['入口', '<path d="M10 4h10v16H10m-7-8h12m-3-3 3 3-3 3"/>'],
  fixture: ['馆内设施', '<path d="M5 6a7 2 0 0 1 14 0v12a7 2 0 0 1-14 0Zm0 0a7 2 0 0 0 14 0"/>'],
  outline: ['截图格位', ''],
};

function fixtureGlyph(kind) {
  const [, path] = mapFixtures[kind];
  return path ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>` : '';
}

function roomMap(room, layout, roomItems, items, s) {
  const byNumber = new Map(roomItems.map(seat => [seatLabel(seat), seat]));
  const visible = new Set(items.map(seat => seat.id));
  const mapped = new Set();
  const position = (col, row) => `grid-column:${col + 1};grid-row:${row + 1}`;
  const seatCells = layout.seats.flatMap(([row, ...cells]) => cells.map(([col, number]) => {
    const seat = byNumber.get(number);
    if (!seat) return '';
    mapped.add(seat.id);
    return seatButton(seat, s.selectedSeat, s.filters, position(col, row), !visible.has(seat.id));
  })).join('');
  const kinds = new Set();
  const fixtures = layout.fixtures.flatMap(([row, ...cells]) => cells.map(([col, kind]) => {
    kinds.add(kind);
    return `<span class="map-fixture map-fixture--${kind}" style="${position(col, row)}" title="${mapFixtures[kind][0]}" aria-hidden="true">${fixtureGlyph(kind)}</span>`;
  })).join('');
  const unplaced = items.filter(seat => !mapped.has(seat.id));
  return `<div class="room-map-toolbar">
    <div class="room-map-key" aria-label="地图图例">${Object.keys(mapFixtures).filter(kind => kinds.has(kind)).map(kind =>
      `<span><i class="map-fixture map-fixture--${kind}" aria-hidden="true">${fixtureGlyph(kind)}</i>${mapFixtures[kind][0]}</span>`).join('')}</div>
    <div class="map-zoom" role="group" aria-label="座位图缩放">
      <button type="button" data-map-zoom="fit">全览</button>
      <button type="button" data-map-zoom="out" aria-label="缩小">−</button>
      <button type="button" data-map-zoom="in" aria-label="放大">+</button>
    </div>
  </div>
  <p id="room-map-help" class="room-map-help">放大查看座位号，拖动或滚动查看其他位置。${s.seatNumberQuery.trim() ? ` 匹配 ${items.length} 席。` : ''}</p>
  <div class="room-map-viewport" data-room="${e(room)}" role="region" aria-label="${e(room)}座位平面图" aria-describedby="room-map-help" tabindex="0">
    <div class="room-map-surface">
      <div class="seat-grid room-map${s.seatNumberQuery.trim() ? ' room-map--filtered' : ''}" data-columns="${layout.columns}" data-rows="${layout.rows}"
        style="--columns:${layout.columns};--rows:${layout.rows}">${fixtures}${seatCells}</div>
    </div>
  </div>
  ${unplaced.length ? `<p class="section-note">以下座位在平面图中待定位。</p><div class="seat-grid seat-grid--numbered">${unplaced.map(seat => seatButton(seat, s.selectedSeat, s.filters)).join('')}</div>` : ''}
  ${layout.notes?.map(note => `<p class="map-source-note">${e(note)}</p>`).join('') || ''}`;
}

export function seats(s) {
  const rooms = seatRooms(s.seats.items);
  const room = rooms.has(s.seatRoom) ? s.seatRoom : rooms.keys().next().value;
  const roomItems = rooms.get(room) || [];
  const query = s.seatNumberQuery.trim().toUpperCase();
  const items = roomItems.filter(seat => seatLabel(seat).toUpperCase().includes(query));
  const selected = items.find(seat => seat.id === s.selectedSeat);
  const available = items.filter(seat => seat.status === 'available' && matches(seat, s.filters)).length;
  const knownFacilities = roomItems.some(seat => [seat.has_power, seat.quiet_zone, seat.near_window].some(value => value != null));
  const campus = s.seats.inventory_source === 'library_files';
  const layout = campus && Object.hasOwn(seatLayouts, room) ? seatLayouts[room] : null;
  const prompt = room ? `明天14:00到16:00，找${room}的座位` : '帮我找一个座位';
  return `${heading(s.staff ? '座位管理' : '空间与选座',
    s.staff ? '查看各阅览室的本站预约状态。' : '选择阅览室和时段，在平面图上查看和预约座位。',
    `<button class="btn btn-soft" data-prompt="${e(prompt)}">${icon('sparkles')}智能选座</button>`)}
    <form class="panel seat-controls" id="seat-search">
      <div class="seat-room-fields">
        <label class="field">阅览室<select id="seat-room">${[...rooms].map(([name, list]) =>
          `<option value="${e(name)}" ${name === room ? 'selected' : ''}>${e(name)} · ${list.length} 席</option>`).join('')}</select></label>
        <label class="field">查找座位号<input type="search" id="seat-number" value="${e(s.seatNumberQuery)}"
          placeholder="可选，例如 1 或 C902" maxlength="20"></label>
      </div>
      <div class="time-fields">
        <label class="field">开始时间<input type="datetime-local" id="seat-start" value="${e(s.start)}" required></label>
        <label class="field">结束时间<input type="datetime-local" id="seat-end" value="${e(s.end)}" required></label>
        <button class="btn btn-primary" type="submit">${icon('search')}查询座位</button>
      </div>
      ${knownFacilities ? `<div class="seat-options">
        <label class="check-label"><input id="filter-power" type="checkbox" ${s.filters.has_power ? 'checked' : ''}>${icon('plug',14)}需要插座</label>
        <label class="check-label"><input id="filter-quiet" type="checkbox" ${s.filters.quiet_zone ? 'checked' : ''}>${icon('quiet',14)}安静区域</label>
        <label class="check-label"><input id="filter-window" type="checkbox" ${s.filters.near_window ? 'checked' : ''}>${icon('window',14)}靠窗位置</label>
      </div>` : ''}
    </form>
    <div class="seat-layout${layout ? ' seat-layout--mapped' : ''}">
      <section class="panel seat-map-panel">
        <div class="panel-header"><div><h2>${e(room || '阅览室座位')}</h2>
          <p>共 ${roomItems.length} 席 · ${layout ? '阅览室平面图' : '按时段查看座位'}</p>
        </div><span class="tag tag-blue">${available} 席可选</span></div>
        <div class="seat-legend">${['available', 'reserved', 'checked_in', 'unavailable'].map(status =>
          `<span><i class="${status}"></i>${statuses[status]}</span>`).join('')}</div>
        ${layout ? roomMap(room, layout, roomItems, items, s) : `<div class="floor-canvas"><div class="seat-grid seat-grid--numbered">
          ${items.length ? items.map(seat => seatButton(seat, s.selectedSeat, s.filters)).join('') :
            '<p class="seat-empty">该阅览室没有匹配的座位号。</p>'}
        </div></div>`}
        <p class="section-note">${s.staff ? '停用座位会暂停本站新预约，已有记录仍可查看。' :
          layout ? '布局按图书馆截图重绘，座位可用性以本站预约记录为准。' : '空闲表示本站所选时段可预约。'}</p>
      </section>
      <aside class="panel seat-selection"><h3>${selected ? '座位详情' : '选择一个座位'}</h3>
        ${selected ? selection(selected, s) :
          `<div class="selection-empty">${icon('seat',38)}选择座位即可查看详情与可用时段。</div>`}
      </aside>
    </div>`;
}

export function matches(seat, filters) {
  return Object.entries(filters).every(([key, required]) => !required || Boolean(seat[key]));
}

export function selection(seat, s) {
  const amenities = [
    seat.has_power && ['plug', '配有插座'],
    seat.near_window && ['window', '靠窗位置'],
    seat.quiet_zone && ['quiet', '安静区域'],
  ].filter(Boolean);
  const details = amenities.map(([symbol, label]) => `<span>${icon(symbol,13)}${label}</span>`).join('');
  let action = '<p class="section-note">这个时段暂不可预约，可以选择其他位置。</p>';
  if (s.staff) {
    action = `<button class="btn ${seat.disabled ? 'btn-primary' : ''}" data-disable-seat="${e(seat.id)}"
      data-disabled="${!seat.disabled}">${seat.disabled ? '恢复可预约' : '临时停用'}</button>`;
  } else if (seat.status === 'available') {
    action = `<button class="btn btn-primary" data-reserve-seat="${e(seat.id)}">预约这个座位</button>`;
  }
  return `<div class="selected-seat-identity"><span>${icon('seat',24)}</span>
    <div><strong>座位 ${e(seatLabel(seat))}</strong><p>${e(seat.zone)}</p></div>
    </div>${badge(seat.status)}
    ${details ? `<div class="amenities">${details}</div>` : '<p class="section-note">座位设施资料待补充</p>'}
    <div class="selection-time">${icon('calendar',14)} ${dateTime(s.seats.start_at)}
      <br>${icon('clock',14)} 至 ${dateTime(s.seats.end_at)}</div>${action}`;
}

export function feedback(s){return `${heading('事务反馈','把问题说清楚，让每一次反馈都有回应。',`<button class="btn btn-soft" data-prompt="我想反馈馆内设施问题，请帮我整理">${icon('sparkles')}让AI帮我整理</button>`)}<div class="two-column"><section class="panel panel-padding"><div class="panel-header"><div><h2>你遇到了什么问题？</h2><p>填写位置和具体情况，方便馆员了解与处理。</p></div><span class="tag tag-blue">读者反馈</span></div><form class="feedback-form" id="feedback-form"><div class="form-row"><label class="field">问题类型<select name="category" required>${['设备故障','环境问题','秩序反馈','图书问题','服务建议','其他'].map(t=>`<option>${t}</option>`).join('')}</select></label><label class="field">所在位置<input name="location" placeholder="例如：社科阅览室A区(3楼)，座位2" maxlength="200" required></label></div><label class="field">具体情况<textarea name="description" placeholder="请描述你遇到的情况，或想提出的建议…" maxlength="1000" required></textarea><span class="form-hint">请勿填写账号密码等无关信息，问题描述不超过1000字。</span></label><div class="form-footer"><p>提交前会展示确认信息，提交后可查询办理进度。</p><button class="btn btn-primary" type="submit">核对并提交 ${icon('arrow')}</button></div></form></section><aside class="panel panel-padding process-guide"><h2>每一步，都看得见</h2>${[['提交反馈','描述问题，补齐地点与情况。'],['馆员受理','馆员查看后开始处理。'],['回复处理结果','你可以查看处理说明。'],['确认与办结','确认已解决，或申请继续处理。']].map(([title,desc],i)=>`<div class="process-step"><span class="process-step-icon">${i+1}</span><div><strong>${title}</strong><p>${desc}</p></div></div>`).join('')}<button class="btn btn-soft" data-view="services">${icon('clipboard')}查看我的反馈</button><p class="section-note">当前为原型内流转，不代表学校已受理。</p></aside></div>`;}

export function services(s){const tab=s.servicesTab||'bookings';const records=tab==='bookings'?s.data.services.bookings:s.data.services.tickets;return `${heading('我的服务','预约记录与问题进度，随时都能找到。',`<button class="btn" data-refresh>${icon('refresh')}刷新记录</button>`)}<div class="service-tabs"><button class="service-tab ${tab==='bookings'?'active':''}" data-service-tab="bookings">我的预约 <small>(${s.data.services.bookings.length})</small></button><button class="service-tab ${tab==='tickets'?'active':''}" data-service-tab="tickets">我的反馈 <small>(${s.data.services.tickets.length})</small></button></div><div class="record-list">${records.length?records.map(record=>tab==='bookings'?bookingCard(record):ticketCard(record)).join(''):empty(tab==='bookings'?'还没有预约记录':'还没有反馈记录',tab==='bookings'?'选一个适合自己的位置，开始专注学习。':'有问题或建议时，可以在事务反馈页面提交。',`<button class="btn btn-primary" data-view="${tab==='bookings'?'seats':'feedback'}">${tab==='bookings'?'去选座':'提交反馈'}</button>`)}</div>`;}
export function bookingCard(b){return `<article class="record-card"><div class="record-head"><div><h3>${icon('seat',17)} ${e(b.zone || "阅览室")} · 座位 ${e(seatLabel(b))}</h3><p class="record-id">预约编号 ${e(b.id)}</p></div>${badge(b.status)}</div><div class="record-body">${icon('calendar',14)} ${dateTime(b.start_at)} — ${dateTime(b.end_at)}<br>签到与超时按演示规则执行。</div><div class="record-footer">${b.status==='reserved'?`<button class="btn btn-primary btn-small" data-booking-change="check_in" data-booking-id="${e(b.id)}">签到使用</button><button class="btn btn-small" data-booking-change="cancel" data-booking-id="${e(b.id)}">取消预约</button>`:b.status==='checked_in'?`<button class="btn btn-primary btn-small" data-booking-change="release" data-booking-id="${e(b.id)}">结束使用并退座</button>`:''}</div></article>`;}
export function ticketCard(t,staff=false){return `<article class="record-card"><div class="record-head"><div><h3>${e(t.category)} <span class="muted">/</span> ${e(t.location)}</h3><p class="record-id">问题编号 ${e(t.id)} · ${dateTime(t.created_at)}</p></div>${badge(t.status)}</div><p class="record-body">${e(t.description)}</p>${t.reply?`<div class="reply-box"><strong>馆员回复</strong>${e(t.reply)}</div>`:''}<div class="record-footer"><button class="btn btn-small" data-ticket-detail="${e(t.id)}">查看办理记录</button>${!staff&&t.status==='replied'?`<button class="btn btn-primary btn-small" data-ticket-update="confirm" data-ticket-id="${e(t.id)}">确认已解决</button><button class="btn btn-small" data-ticket-update="reopen" data-ticket-id="${e(t.id)}">仍需处理</button>`:''}${staff&&t.status==='pending'?`<button class="btn btn-primary btn-small" data-staff-update="accept" data-ticket-id="${e(t.id)}">受理问题</button>`:''}</div>${staff&&t.status==='processing'?`<form class="staff-action" data-staff-reply="${e(t.id)}"><label class="sr-only" for="reply-${e(t.id)}">处理说明</label><textarea id="reply-${e(t.id)}" name="reply" placeholder="填写处理情况与结果，回复读者…" maxlength="1000" required></textarea><button type="submit" class="btn btn-primary btn-small">回复处理结果</button></form>`:''}</article>`;}

export function admin(s){const o=s.data.overview;const tickets=s.staffTickets?.items||[];return `${heading('馆员工作台','从空间使用到事务办理，了解服务的每一步。',`<button class="btn" data-refresh>${icon('refresh')}刷新数据</button>`)}<div class="stats-grid">${[['座位总数',o.seats_total,'seat','已录入的阅览室座位'],['正在使用',o.in_use,'clock','按实际签到状态计数'],['待办问题',o.pending_tickets,'message','待受理与处理中'],['当前使用率',o.utilization+'%','chart','使用中座位 / 全部座位']].map(([label,value,i,desc])=>`<section class="stat-card"><div class="stat-label">${label}${icon(i)}</div><div class="stat-value">${e(value)}</div><p class="stat-caption">${desc}</p></section>`).join('')}</div><div class="two-column"><section class="panel panel-padding"><div class="panel-header"><div><h2>近期事务</h2><p>问题在原型内流转，进度同步给读者。</p></div><button class="btn-text" data-view="staff-tickets">全部事务 ${icon('arrow')}</button></div><div class="record-list admin-tickets-list">${tickets.length?tickets.slice(0,3).map(t=>ticketCard(t,true)).join(''):empty('暂时没有待办问题','读者提交反馈后，会出现在这里。')}</div></section><div><section class="panel panel-padding"><h2>服务接入状态</h2><div class="connection-row"><span>智能助手</span><strong>${s.config.model_mode==='deepseek'?'DeepSeek已配置':'规则演示'}</strong></div><div class="connection-row"><span>业务数据</span><strong>${s.config.data_mode==='demo'?'本地资料与预约记录':'外部数据接口'}</strong></div><div class="connection-row"><span>身份与权限</span><strong>本地演示身份</strong></div><p class="connection-help">模型与数据接口已独立预留。配置说明仅在馆员工作台查看，读者页面不接触密钥。</p><button class="btn btn-soft" style="margin-top:14px" id="connection-help">${icon('settings')}查看接入说明</button></section><section class="panel panel-padding" style="margin-top:20px"><h3>预约时段分布</h3><p class="section-note">基于本地已有预约记录，不代表真实馆内情况。</p>${o.hourly_bookings.length?`<div class="admin-chart">${o.hourly_bookings.map(h=>`<div class="chart-bar" style="height:${Math.max(5,h.count/Math.max(...o.hourly_bookings.map(x=>x.count))*100)}%" title="${h.hour}时开始：${h.count}条"><span>${h.hour}时</span></div>`).join('')}</div>`:`<div class="empty-state" style="padding:25px 0"><p>尚无预约记录</p></div>`}</section></div></div>`;}
export function staffTickets(s){const items=s.staffTickets?.items||[];return `${heading('事务办理','受理、回复与办结，让读者知道问题走到了哪一步。',`<button class="btn" data-refresh>${icon('refresh')}刷新记录</button>`)}<div class="record-list">${items.length?items.map(t=>ticketCard(t,true)).join(''):empty('暂无读者反馈','可在读者页面提交一条演示问题，体验完整办理流程。')}</div>`;}
