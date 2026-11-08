/* Offline single-file runtime: browser-local data, business transactions and API adapter. */
(() => {
  const DATA = window.__OFFLINE_DATA__;
  const STORAGE_KEY = 'ujs.offlineLibrary.v1';
  const STAFF_KEY = 'ujs.offlineLibrary.staff';
  const emptyState = () => ({bookings: [], tickets: [], actions: [], disabled: {}});
  let state = emptyState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.bookings) && Array.isArray(saved.tickets) && Array.isArray(saved.actions)) {
      state = {...emptyState(), ...saved, disabled: saved.disabled || {}};
    }
  } catch {}
  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  };
  const fail = message => { throw new Error(message); };
  const uid = prefix => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return prefix + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 12);
  };
  const iso = ts => new Date(ts).toISOString();
  const time = value => {
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) fail('时间格式不正确，请重新选择。');
    return parsed;
  };
  const staffMode = () => {
    try { return sessionStorage.getItem(STAFF_KEY) === '1'; } catch { return false; }
  };
  const config = () => ({
    model_mode: 'rule_demo', model_configured: false, model: 'offline-rules', data_mode: 'offline',
    role: staffMode() ? 'staff_demo' : 'reader_demo', official_system_connected: false,
  });
  const book = id => DATA.books.find(item => item.id === id);
  const seat = id => DATA.seats.find(item => item.id === id);
  const seatNumber = id => seat(id)?.seat_number || (id.startsWith('UJS:') ? id.split(':').at(-1) : id.replace('DEMO-S', ''));
  const bookingResult = record => ({
    id: record.id, seat_id: record.seat_id, start_at: iso(record.start_ts), end_at: iso(record.end_ts),
    status: record.status, is_demo: true, seat_number: seatNumber(record.seat_id), zone: seat(record.seat_id)?.zone || '',
  });
  const ticketResult = record => ({...record, is_demo: true, officially_submitted: false, history: record.history.map(item => ({...item}))});

  function expire() {
    const now = Date.now();
    for (const record of state.bookings) {
      if (record.status === 'reserved' && Math.min(record.start_ts + 900000, record.end_ts) <= now) record.status = 'expired';
      if (record.status === 'checked_in' && record.end_ts <= now) record.status = 'completed';
    }
  }
  function windowTimes(startAt, endAt) {
    const start = time(startAt), end = time(endAt);
    if (start < Date.now() - 60000 || end <= start || end - start > 8 * 3600000) {
      fail('演示预约时段应从现在或未来开始，结束晚于开始，且不超过8小时。');
    }
    return [start, end];
  }
  function overlap(record, start, end) {
    return ['reserved', 'checked_in'].includes(record.status) && record.start_ts < end && record.end_ts > start;
  }
  function seatMap(startAt, endAt) {
    expire();
    const start = startAt == null ? Date.now() : time(startAt);
    const end = endAt == null ? start + 7200000 : time(endAt);
    if (startAt != null) windowTimes(startAt, endAt);
    const items = DATA.seats.map(item => {
      const record = state.bookings.find(booking => booking.seat_id === item.id && overlap(booking, start, end));
      return {...item, status: state.disabled[item.id] ? 'unavailable' : record?.status || 'available',
        my_booking_id: record?.id || null};
    });
    return {items, start_at: iso(start), end_at: iso(end), is_demo: true, inventory_source: 'library_files'};
  }
  function myServices() {
    expire();
    return {
      bookings: [...state.bookings].sort((a, b) => b.start_ts - a.start_ts).slice(0, 30).map(bookingResult),
      tickets: [...state.tickets].sort((a, b) => b.created_ts - a.created_ts).slice(0, 30).map(ticketResult),
    };
  }
  function overview() {
    expire();
    const now = Date.now();
    const inUse = new Set(state.bookings.filter(item => item.status === 'checked_in' && item.start_ts <= now && item.end_ts > now).map(item => item.seat_id));
    const hourly = {};
    for (const item of state.bookings) {
      const hour = new Date(item.start_ts + 8 * 3600000).getUTCHours();
      hourly[hour] = (hourly[hour] || 0) + 1;
    }
    return {
      books_total: DATA.books.length, seats_total: DATA.seats.length, in_use: inUse.size,
      reserved: state.bookings.filter(item => item.status === 'reserved').length,
      pending_tickets: state.tickets.filter(item => ['pending', 'processing'].includes(item.status)).length,
      total_tickets: state.tickets.length, utilization: Math.round(inUse.size / DATA.seats.length * 100),
      hourly_bookings: Object.entries(hourly).map(([hour, count]) => ({hour: Number(hour), count})).sort((a, b) => a.hour - b.hour),
      is_demo: true,
    };
  }
  function terms(text) {
    const result = new Set();
    for (const part of String(text).toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || []) {
      if (/^[a-z0-9]+$/.test(part) || part.length <= 2) result.add(part);
      else for (let index = 0; index < part.length - 1; index++) result.add(part.slice(index, index + 2));
    }
    return [...result];
  }
  function searchBooks(query, limit = 5, offset = 0) {
    const compact = String(query).replace(/^isbn(?:-1[03])?\s*[:：]?\s*/i, '').replace(/[\s\-‐‑–]/g, '').toUpperCase();
    if (/^(?:\d{13}|\d{9}[\dX])$/.test(compact)) {
      const matches = DATA.books.filter(item => String(item.isbn).replace(/-/g, '').toUpperCase() === compact);
      return {items: matches.slice(offset, offset + limit), total: matches.length, retrieval: 'isbn'};
    }
    const needles = terms(query).slice(0, 32);
    const scored = DATA.books.map(item => {
      const haystack = [item.title, item.author, item.summary, item.subjects, item.call_number, item.publisher, item.isbn].join(' ').toLowerCase();
      return [needles.filter(term => haystack.includes(term)).length, item];
    }).filter(pair => pair[0] > 0);
    scored.sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id));
    return {items: scored.slice(offset, offset + limit).map(pair => pair[1]), total: scored.length, retrieval: 'lexical_local',
      note: '候选结果按本地词项匹配排序；不是语义推荐或实时可借状态。'};
  }
  function locateBook(id) {
    const found = book(id);
    if (!found) fail('未查询到该书目，不能推断其位置。');
    const keys = ['id', 'title', 'author', 'isbn', 'publisher', 'floor', 'zone', 'shelf_id', 'call_number', 'availability', 'source', 'is_demo', 'reference'];
    return Object.fromEntries(keys.map(key => [key, found[key] ?? (key === 'availability' ? 'unknown' : null)]));
  }
  function searchSeats(args) {
    const result = seatMap(args.start_at, args.end_at);
    result.items = result.items.filter(item => item.status === 'available'
      && ['has_power', 'near_window', 'quiet_zone', 'floor'].every(key => args[key] == null || item[key] === (key === 'floor' ? Number(args[key]) : 1))
      && (!args.zone || item.zone.includes(args.zone))).slice(0, Math.min(args.limit || 5, 5));
    result.note = '空闲表示本站所选时段可预约。插座、靠窗与安静区域字段为空时，表示资料未提供。';
    return result;
  }
  function getBooking(id) {
    expire();
    const found = state.bookings.find(item => item.id === id);
    if (!found) fail('未查询到当前演示读者的该预约。');
    return bookingResult(found);
  }
  function getFeedback(id) {
    const found = state.tickets.find(item => item.id === id);
    if (!found) fail('未查询到当前演示读者的该反馈。');
    return ticketResult(found);
  }
  function prepareAction(kind, payload) {
    const preview = {...payload};
    if (kind === 'reserve') {
      windowTimes(payload.start_at, payload.end_at);
      const found = seat(payload.seat_id);
      if (!found || state.disabled[payload.seat_id]) fail('该座位不存在或已停用。');
      preview.seat_number = found.seat_number;
      preview.zone = found.zone;
    } else if (['cancel', 'check_in', 'release'].includes(kind)) {
      getBooking(payload.booking_id);
    } else if (kind === 'feedback') {
      if (!payload.category || !String(payload.location || '').trim() || !String(payload.description || '').trim()) fail('请完整填写问题类型、位置和描述。');
      preview.description = String(payload.description).slice(0, 1000);
    } else fail('未知操作。');
    const action = {action_id: uid(''), kind, payload: {...payload}, expires_ts: Date.now() + 300000, result: null};
    state.actions.push(action);
    save();
    return {action_id: action.action_id, kind, preview, requires_confirmation: true,
      expires_at: iso(action.expires_ts), is_demo: true, note: '仅生成待确认操作；尚未预约、签到或提交反馈。'};
  }
  function confirmAction(actionId) {
    const action = state.actions.find(item => item.action_id === actionId);
    if (!action) fail('待确认操作不存在。');
    if (action.result) return action.result;
    if (action.expires_ts <= Date.now()) fail('待确认操作已过期，请重新查询并生成操作。');
    expire();
    const args = action.payload;
    let result;
    if (action.kind === 'reserve') {
      const [start, end] = windowTimes(args.start_at, args.end_at);
      if (state.disabled[args.seat_id]) fail('该座位已停用，请重新选择。');
      if (state.bookings.some(item => item.seat_id === args.seat_id && overlap(item, start, end))) fail('该座位时段已被预约，请重新查询。');
      const record = {id: uid('BK-'), seat_id: args.seat_id, start_ts: start, end_ts: end, status: 'reserved'};
      state.bookings.push(record);
      result = bookingResult(record);
    } else if (action.kind === 'feedback') {
      const record = {id: uid('FB-'), category: args.category, location: args.location, description: String(args.description).slice(0, 1000),
        status: 'pending', created_ts: Date.now(), created_at: iso(Date.now()), updated_at: iso(Date.now()), reply: '',
        history: [{status: 'pending', actor: 'demo-reader', note: '读者提交反馈', created_at: iso(Date.now())}]};
      state.tickets.push(record);
      result = {id: record.id, status: 'pending', is_demo: true, officially_submitted: false};
    } else {
      const record = state.bookings.find(item => item.id === args.booking_id);
      if (!record || !['reserved', 'checked_in'].includes(record.status)) fail('该预约当前不可执行此操作。');
      if (action.kind === 'check_in') {
        if (record.status !== 'reserved' || Date.now() < record.start_ts - 900000) fail('演示签到仅允许开始前15分钟至开始后15分钟内操作。');
        record.status = 'checked_in';
      } else if (action.kind === 'cancel') {
        if (record.status !== 'reserved') fail('只有未签到的预约可以取消；使用中的座位请退座。');
        record.status = 'cancelled';
      } else if (action.kind === 'release') {
        if (record.status !== 'checked_in') fail('只有使用中的预约可以退座。');
        record.status = 'completed';
      } else fail('未知操作。');
      result = bookingResult(record);
    }
    action.result = result;
    save();
    return result;
  }
  function updateTicket(id, operation, reply = '', staff = false) {
    const record = state.tickets.find(item => item.id === id);
    if (!record) fail('未找到可处理的问题。');
    let status;
    if (staff) {
      status = record.status === 'pending' && operation === 'accept' ? 'processing' : record.status === 'processing' && operation === 'reply' && reply.trim() ? 'replied' : '';
    } else if (record.status === 'replied') {
      status = {confirm: 'closed', reopen: 'processing'}[operation];
    }
    if (!status) fail(staff ? '请按当前办理进度受理或填写处理回复。' : '当前反馈尚不可确认或重新处理。');
    record.status = status;
    if (staff && operation === 'reply') record.reply = String(reply).slice(0, 1000);
    record.updated_at = iso(Date.now());
    record.history.push({status, actor: staff ? 'demo-staff' : 'demo-reader',
      note: staff && operation === 'reply' ? record.reply : {accept: '馆员已受理', confirm: '读者确认已解决', reopen: '读者申请继续处理', reply: '更新进度'}[operation],
      created_at: iso(Date.now())});
    save();
    return ticketResult(record);
  }
  function callTool(name, args) {
    try {
      if (name === 'get_institution_profile') {
        const profile = DATA.institution_profiles.find(item => item.id === args.profile_id);
        if (!profile) fail('未收录该机构简介。');
        return {...profile};
      }
      if (name === 'search_books') return searchBooks(args.query, args.limit || 5, Math.max(0, Number(args.offset) || 0));
      if (name === 'locate_book') return locateBook(args.book_id);
      if (name === 'search_seats') return searchSeats(args);
      if (name === 'get_my_booking') return getBooking(args.booking_id);
      if (name === 'get_my_feedback') return getFeedback(args.ticket_id);
      if (name === 'prepare_booking') return prepareAction('reserve', args);
      if (name === 'prepare_booking_change') return prepareAction(args.operation, {booking_id: args.booking_id});
      if (name === 'prepare_feedback') return prepareAction('feedback', args);
      if (name === 'search_rules') {
        const rules = [
          {id: 'DEMO-R1', text: '演示预约单次最多8小时；以确认时冲突检查结果为准。'},
          {id: 'DEMO-R2', text: '演示签到允许开始前15分钟至开始后15分钟；未签到超时释放，使用到期自动结束。'},
          {id: 'DEMO-R3', text: '演示反馈仅写入原型数据库，不表示图书馆已受理；处理进度从数据库读取。'},
        ];
        const needles = terms(args.query);
        return {items: rules.map(rule => [needles.filter(term => terms(rule.text).includes(term)).length, rule])
          .filter(pair => pair[0] > 0).sort((a, b) => b[0] - a[0]).map(pair => pair[1]), is_demo: true, source: '自拟原型规则；不是江大规定'};
      }
      fail('工具不在允许列表中。');
    } catch (error) {
      return {error: error.message, executed: false};
    }
  }
  async function api(path, data) {
    await new Promise(resolve => setTimeout(resolve, 35));
    const url = new URL(path, 'https://offline.library.local');
    const route = url.pathname;
    if (route === '/api/bootstrap') return {config: config(), overview: overview(), books: {items: DATA.books}, seats: seatMap(), services: myServices()};
    if (route === '/api/services') return myServices();
    if (route === '/api/seats/map') return seatMap(url.searchParams.get('start_at'), url.searchParams.get('end_at'));
    if (route === '/api/books') return url.searchParams.get('q') ? searchBooks(url.searchParams.get('q'), 247) : {items: DATA.books};
    if (route === '/api/tool-preview') return callTool(data.name, data.arguments || {});
    if (route === '/api/actions/confirm') return confirmAction(data.action_id);
    if (route === '/api/tickets/update') return updateTicket(data.ticket_id, data.operation);
    if (route === '/api/chat') return window.offlineChat(data.message, data.session_id, data.character);
    if (route === '/api/staff/login') {
      if (data.username !== 'user1' || data.password !== '123456') fail('账号或密码不正确。');
      try { sessionStorage.setItem(STAFF_KEY, '1'); } catch {}
      return {ok: true};
    }
    if (route === '/api/staff/logout') {
      try { sessionStorage.removeItem(STAFF_KEY); } catch {}
      return {ok: true};
    }
    if (route === '/api/staff/tickets') {
      if (!staffMode()) fail('请进入馆员演示工作台。');
      return {items: [...state.tickets].sort((a, b) => b.created_ts - a.created_ts).slice(0, 60).map(ticketResult)};
    }
    if (route === '/api/staff/tickets/update') {
      if (!staffMode()) fail('请进入馆员演示工作台。');
      return updateTicket(data.ticket_id, data.operation, data.reply || '', true);
    }
    if (route === '/api/staff/seats/update') {
      if (!staffMode()) fail('请进入馆员演示工作台。');
      if (!seat(data.seat_id)) fail('座位不存在。');
      state.disabled[data.seat_id] = Boolean(data.disabled);
      save();
      return {id: data.seat_id, disabled: Boolean(data.disabled), is_demo: true};
    }
    fail('离线版不支持该请求。');
  }
  window.offlineLibrary = {DATA, config, overview, myServices, seatMap, callTool};
  window.__offlineApi = api;
})();
