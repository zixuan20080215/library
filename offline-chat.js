/* Deterministic, ten-turn offline dialogue. Only business tools create confirmation cards. */
(() => {
  const core = () => window.offlineLibrary;
  const rules = window.offlineDialogueRules;
  const sessions = new Map();
  const STATUS = {reserved: '待签到', checked_in: '使用中', completed: '已完成', cancelled: '已取消', expired: '已过期',
    pending: '待受理', processing: '处理中', replied: '已回复', closed: '已办结'};
  const TIME_RE = /(?:(上午|早上|中午|下午|晚上|凌晨)\s*)?(\d{1,2})(?:\s*[:：]\s*(\d{1,2})|\s*[点时]\s*(半|\d{1,2})?\s*分?)/g;
  const hasAny = (text, words) => words.some(word => text.includes(word));
  const compact = text => text.toLowerCase().replace(/[\s，。！？!?~～、]/g, '');
  const number = value => {
    if (/^\d+$/.test(value)) return Number(value);
    if (value === '两') return 2;
    const digits = '零一二三四五六七八九';
    if (value.includes('十')) {
      const [tens, ones] = value.split('十');
      return (tens ? digits.indexOf(tens) : 1) * 10 + (ones ? digits.indexOf(ones) : 0);
    }
    return digits.indexOf(value);
  };
  const ordinal = text => {
    const match = text.match(/第\s*([一二三四五六七八九十\d]+)\s*(?:个|本|条|项)?|([一二三四五六七八九十\d]+)\s*(?:个|本|条|项)/);
    return match ? number(match[1] || match[2]) - 1 : null;
  };
  const uid = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  };
  const localDate = () => new Date(Date.now() + 8 * 3600000);
  const display = value => new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(value));
  const floorMatch = text => text.match(/(?<!\d)(\d{1,2}|[一二三四五六七八九十]+)\s*[楼层]/);
  const locationOf = text => {
    const roomNames = [...new Set(core().DATA.seats.map(item => item.zone.replace(/\(\d+楼\)$/, '')))];
    const room = roomNames.find(name => text.includes(name));
    const match = text.match(/(?:\d{1,2}|[一二三四五六七八九十]+)\s*[楼层][^，。；\n]{0,24}|(?:座位\s*)?[A-Z]\d{2,4}(?:号)?|\d{1,4}号(?:座位)?/i);
    return (room || '') + (match ? match[0].replace(/(?:的)?(?:插座|灯管|空调|网络|桌椅|太吵|漏水|坏了).*$/, '') : '');
  };

  // Dates and time slots can be supplied over several turns. Invalid changes never reuse old candidates.
  function parseTimes(text, context) {
    let normalized = text.replace(/今晚/g, '今天晚上').replace(/明晚/g, '明天晚上');
    normalized = normalized.replace(/[零一二三四五六七八九十两]+(?=\s*(?:点|时|个?小时))/g, value => String(number(value)));
    const matches = [...normalized.matchAll(TIME_RE)].slice(0, 2);
    const durationMatch = normalized.match(/(半|\d+(?:\.\d+)?)\s*个?小时/);
    const duration = durationMatch ? (durationMatch[1] === '半' ? 0.5 : Number(durationMatch[1])) : null;
    const dateChanged = /今天|明天|后天/.test(normalized);
    if (!matches.length && duration == null && !dateChanged) return false;
    const draft = {...context.timeDraft};
    if (dateChanged || !draft.day) {
      const day = localDate();
      day.setUTCDate(day.getUTCDate() + (normalized.includes('后天') ? 2 : normalized.includes('明天') ? 1 : 0));
      draft.day = day.toISOString().slice(0, 10);
    }
    const period = matches[0]?.[1] || normalized.match(/上午|早上|中午|下午|晚上|凌晨/)?.[0] || draft.period;
    const values = matches.map(match => {
      const meridiem = match[1] || period;
      let hour = Number(match[2]);
      const raw = match[3] || match[4] || '0';
      const minute = raw === '半' ? 30 : Number(raw);
      if (hour > 23 || minute > 59) throw new Error('时间格式不正确，请使用“明天下午2点到4点”。');
      if (['下午', '晚上'].includes(meridiem) && hour < 12) hour += 12;
      else if (meridiem === '中午' && hour < 6) hour += 12;
      else if (meridiem === '凌晨' && hour === 12) hour = 0;
      return hour * 60 + minute;
    });
    if (values.length === 2) { draft.start = values[0]; draft.end = values[1]; }
    else if (values.length === 1) {
      if (/^(?:那就|就|到|直到|结束|结束时间|结束改为|结束改成)\s*/.test(normalized) && draft.start != null) draft.end = values[0];
      else { draft.start = values[0]; delete draft.end; }
    }
    if (duration != null && draft.start != null) draft.end = draft.start + duration * 60;
    draft.period = period;
    context.timeDraft = draft;
    delete context.times;
    context.seats = [];
    if (draft.start == null || draft.end == null) return true;
    if (draft.end <= draft.start || draft.end >= 1440 || draft.end - draft.start > 480) {
      throw new Error('结束时间须晚于开始时间，单次不超过8小时；请给出同一天的有效起止时间，例如“明天14:00到16:00”。');
    }
    const toISO = minutes => `${draft.day}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00+08:00`;
    context.times = {start_at: toISO(draft.start), end_at: toISO(draft.end)};
    return true;
  }

  function updateSeatFilters(text, context) {
    const filters = {...context.seatFilters};
    const floor = floorMatch(text);
    if (/不限楼层|楼层不限|任何楼层/.test(text)) { delete filters.floor; delete filters.zone; }
    else if (floor) { filters.floor = number(floor[1]); delete filters.zone; }
    const rooms = [...new Set(core().DATA.seats.map(item => item.zone))];
    const room = rooms.map(name => name.replace(/\(\d+楼\)$/, '')).sort((a, b) => b.length - a.length)
      .find(name => text.toLowerCase().includes(name.toLowerCase()));
    if (room) {
      filters.zone = room;
      const actualFloors = [...new Set(core().DATA.seats.filter(item => item.zone.replace(/\(\d+楼\)$/, '') === room).map(item => item.floor))];
      if (floor && !actualFloors.includes(filters.floor)) {
        context.seats = [];
        throw new Error(`资料中的${room}位于${actualFloors.join('、')}楼，和你提供的楼层不一致。请确认楼层或阅览室后再查。`);
      }
      if (actualFloors.length === 1) filters.floor = actualFloors[0];
      else if (!actualFloors.includes(filters.floor)) delete filters.floor;
    }
    if (/不限阅览室|阅览室不限|换个阅览室/.test(text)) delete filters.zone;
    if (/不要求设施|去掉设施|设施不限|不挑设施|去掉这些条件/.test(text)) {
      for (const key of ['has_power', 'near_window', 'quiet_zone']) delete filters[key];
    }
    for (const [key, pattern] of [['has_power', '插座|电源|充电'], ['near_window', '靠窗|窗边'], ['quiet_zone', '安静|静音']]) {
      const negative = new RegExp(`(?:不要|不需要|不用|不要求|不限|去掉|取消|不一定|无所谓).{0,4}(?:${pattern})|(?:${pattern}).{0,4}(?:不限|无所谓|不要求|不需要)`);
      if (negative.test(text)) delete filters[key];
      else if (new RegExp(pattern).test(text)) filters[key] = true;
    }
    context.seatFilters = filters;
  }

  function matchKnowledge(text) {
    let best = null;
    for (const entry of [...rules.extraKnowledge, ...core().DATA.knowledge]) {
      const folded = text.toLowerCase();
      let score = Object.entries(entry.keywords).reduce((total, [keyword, weight]) => total + (folded.includes(keyword.toLowerCase()) ? weight : 0), 0);
      score += (entry.patterns || []).filter(pattern => new RegExp(pattern, 'i').test(folded)).length * 4;
      if (score >= (entry.threshold || 4) && (!best || score > best.score)) best = {score, entry};
    }
    return best?.entry || null;
  }

  function dynamicAnswer(kind) {
    if (kind === 'rooms') {
      const floors = new Map();
      for (const item of core().DATA.seats) {
        if (!floors.has(item.floor)) floors.set(item.floor, new Set());
        floors.get(item.floor).add(item.zone.replace(/\(\d+楼\)$/, ''));
      }
      return `本站收录 ${new Set(core().DATA.seats.map(item => item.zone)).size} 个阅览室。\n` + [...floors].sort((a, b) => a[0] - b[0]).map(([floor, names]) => `${floor}楼：${[...names].join('、')}`).join('\n') + '\n在“空间与选座”可查看座位布局；告诉我起止时段就能查询。';
    }
    if (kind === 'overview') {
      const data = core().overview();
      return `本站收录 ${data.books_total} 条书目和 ${data.seats_total} 个座位，提供查书、选座、反馈和馆员办理演示。当前浏览器有 ${data.reserved} 条待签到预约、${data.in_use} 条使用中预约和 ${data.pending_tickets} 条待处理反馈。`;
    }
    if (kind === 'my_records') {
      const data = core().myServices(), parts = [];
      for (const [label, items] of [['预约', data.bookings], ['反馈', data.tickets]]) {
        if (items.length) parts.push(`${label}记录 ${items.length} 条，最近列表中的一条为 ${items[0].id}，状态${STATUS[items[0].status] || items[0].status}`);
      }
      return parts.length ? parts.join('；') + '。打开“我的服务”可查看详情，也可以发给我 BK-/FB- 编号查询。' : '当前浏览器还没有预约或反馈记录。查询结果和确认卡不代表操作成功，确认后才会保存记录。';
    }
    return '';
  }

  function chat(message, sessionId, characterId) {
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw new Error('请输入1至4000字符的需求。');
    const now = Date.now();
    for (const [key, value] of sessions) if (now - value.updated >= 1800000) sessions.delete(key);
    if (sessionId && !sessions.has(sessionId)) throw new Error('演示会话已过期，请点击“开始新对话”。');
    const id = sessionId || uid();
    if (sessions.size >= 32 && !sessions.has(id)) sessions.delete(sessions.keys().next().value);
    const context = sessions.get(id) || {turns: 0};
    context.updated = now;
    sessions.set(id, context);
    const trace = [], pending = [];
    const reply = (answer, kind, extra = {}) => ({session_id: id, answer, response_kind: kind,
      tool_results: trace, pending_actions: pending, mode: 'rule_demo', turn_count: context.turns,
      max_turns: rules.maxTurns, limit_reached: kind === 'limit', official_system_connected: false,
      usage: {prompt_tokens: 0, completion_tokens: 0}, ...extra});
    // Enforce the cap here, before keywords, policy replies or any tool side effects.
    if (context.turns >= rules.maxTurns) return reply(rules.limitAnswer, 'limit');
    context.turns++;
    const call = (name, args) => {
      const result = core().callTool(name, args);
      trace.push({tool: name, result});
      if (result.requires_confirmation) pending.push(result);
      return result;
    };
    const text = message.trim().normalize('NFKC'), folded = text.toLowerCase(), clean = compact(text);
    const quoted = text.match(/《([^》]+)》/);
    const isbn = text.match(/(?<!\d)(?:97[89](?:[-\s]?\d){10}|\d(?:[-\s]?\d){8}[-\s]?[\dXx])(?!\d)/);
    const topics = Object.entries(core().DATA.topics).filter(([word]) => folded.includes(word)).map(([, topic]) => topic);
    if (/(?<![a-z])ai(?![a-z])/.test(folded)) topics.push('人工智能');
    const libraryQuery = Boolean(quoted || isbn || /(?:找|查|搜|推荐|想看|想读|想借).{0,24}(?:书|读物|小说)|(?:书籍|书目|读物).{0,8}(?:推荐|检索)/.test(text));
    const discussion = /评价|评论|争议|立场|怎么看|为什么|如何看待/.test(text.replace(/《[^》]*》/g, ''));
    if (rules.political.patterns.some(pattern => pattern.test(text)) && (!libraryQuery || discussion)) {
      return reply(rules.political.answer, 'political_reference', {sources: rules.political.sources});
    }
    if (!new RegExp(core().DATA.profile_exclusion, 'i').test(text)) {
      const profileId = core().DATA.profile_queries.find(entry => (!entry.exclude || !new RegExp(entry.exclude, 'i').test(text)) && entry.patterns.some(pattern => new RegExp(pattern, 'i').test(text)))?.id;
      if (profileId) {
        const record = call('get_institution_profile', {profile_id: profileId});
        context.intent = 'profile'; delete context.awaiting; delete context.lastPending;
        return reply(record.error || `${record.title}\n${record.content}\n\n${record.note}\n来源：${record.source_name}；原文更新：${record.source_updated_at}；核验：${record.verified_at}。`, 'profile');
      }
    }

    const characterName = characterId === 'xiaotu' ? '江小图' : characterId === 'xiaoshu' ? '江小书' : '本站的 AI 馆员';
    if (/^(?:你好呀?|您好|嗨|哈[喽啰]|hi|hello|在吗|早上好|下午好|晚上好)$/.test(clean)) return reply(`你好，我是${characterName}！你可以分几步告诉我查书、选座或反馈的需求，我会记住本次对话的条件。每次最多 10 轮。`, 'small_talk');
    if (/^(?:你是谁|你叫什么|你能做什么|你会什么|帮助|help|功能介绍|你能干嘛)$/.test(clean)) return reply(`我是${characterName}。当前离线版由本地规则引擎工作，可以帮你：\n${rules.capabilities}\n可以接着问“第一本在哪里”，也可以分次补充选座时间和反馈地点。`, 'small_talk');
    if (/^(?:谢谢(?:你|您)?|感谢|多谢|辛苦[了啦]|好的谢谢)$/.test(clean)) return reply('不客气！还可以继续查书、选座或看反馈进度，我会保留本次查询的上下文。', 'small_talk');
    if (/^(?:再见|拜拜|bye|byebye|下次见)$/.test(clean)) return reply('再见，祝你阅读和学习顺利！已确认的预约与反馈可在“我的服务”查看。', 'small_talk');
    if (/^(?:讲个笑话|讲笑话|来个笑话|说个笑话)$/.test(clean)) return reply('有本书不愿离开书架，因为它觉得自己的内容很“有分量”。也可以告诉我你喜欢哪类书。', 'small_talk');
    if (/^(?:你真聪明|你好聪明|你真厉害|你好厉害|真棒|太棒了)$/.test(clean)) return reply('谢谢鼓励！我会依据已有资料回答，资料缺失时也会说明。', 'small_talk');
    if (/^(?:现在|这是|目前)?(?:第几轮|聊了几轮|用了几轮|还剩几轮)/.test(clean)) return reply(`这条是本次对话第 ${context.turns} 轮，还能进行 ${rules.maxTurns - context.turns} 轮问答。点击“开始新对话”可以重新开始。`, 'knowledge');
    if (/^(?:确认|确认提交|提交|确认预约|好的确认|是的|好的|好|可以|嗯)$/.test(clean)) return reply(context.lastPending
      ? '请点击刚才确认卡上的“核对并确认”，再确认弹窗。文字回复不会自动提交；成功后可到“我的服务”查看。'
      : '请继续告诉我具体需求，例如书名、使用时段，或馆内问题与地点。', 'clarify');
    if (/^(?:算了|先不查了|不用了|取消这次查询|取消反馈|不要反馈了)$/.test(clean)) {
      context.intent = null; delete context.awaiting; delete context.feedbackDraft; delete context.lastPending;
      return reply('好的，停止当前对话任务。已确认的业务记录请到“我的服务”管理；还可以开始查书、选座或新的反馈。', 'clarify');
    }
    if (/(?:写|生成|代写).{0,12}(?:代码|论文|作文|文章|报告)|(?:帮我|给我)(?:订|点)外卖|天气|股票|彩票|算命|星座|翻译|求解|微积分|做饭|菜谱/.test(text) && !libraryQuery) return reply(rules.fallback, 'fallback');

    const bookingId = text.match(/(?<![A-Z0-9])BK-[0-9a-f]{6,32}(?![A-Z0-9])/i);
    const ticketId = text.match(/(?<![A-Z0-9])FB-[0-9a-f]{6,32}(?![A-Z0-9])/i);
    const operation = [['取消', 'cancel'], ['签到', 'check_in'], ['退座', 'release'], ['签退', 'release']].find(([word]) => text.includes(word))?.[1];
    const recordFollowup = context.lastRecord && /^(?:那|它|这条|刚才那条)?(?:现在)?(?:的)?(?:状态呢|状态|进度呢|进度|怎么样了)[?？。!！\s]*$/.test(text);
    let record = bookingId ? {id: 'BK-' + bookingId[0].slice(3).toLowerCase(), kind: 'booking'} : ticketId ? {id: 'FB-' + ticketId[0].slice(3).toLowerCase(), kind: 'feedback'} : recordFollowup ? context.lastRecord : null;
    if (!record && operation && !/怎么|如何|规则|流程|时间/.test(text) && /预约|刚才那条/.test(text)) {
      const bookings = core().myServices().bookings.filter(item => ['reserved', 'checked_in'].includes(item.status));
      if (bookings.length === 1) record = {id: bookings[0].id, kind: 'booking'};
      else return reply(bookings.length ? '有多条进行中的预约，请提供要操作的 BK- 编号，避免选错记录。' : '当前没有进行中的预约。请先查询座位并确认预约，或提供要查询的 BK- 编号。', 'records');
    }
    if (record) {
      context.lastRecord = record; context.intent = 'records'; delete context.awaiting;
      if (record.kind === 'booking' && operation) {
        const result = call('prepare_booking_change', {booking_id: record.id, operation});
        context.lastPending = result.action_id;
        return reply(result.error || '已生成预约操作确认卡，请核对编号与操作后确认。', 'records');
      }
      const result = call(record.kind === 'booking' ? 'get_my_booking' : 'get_my_feedback', record.kind === 'booking' ? {booking_id: record.id} : {ticket_id: record.id});
      return reply(result.error || `记录 ${record.id} 的当前状态为${STATUS[result.status] || result.status}。${result.reply ? `馆员回复：${result.reply}` : ''}`, 'records');
    }

    const entry = matchKnowledge(text);
    const explicitGuide = /怎么|如何|规则|流程|有哪些|多少|能借吗|可以借吗|最长|几小时|时长限制/.test(text);
    const feedbackWords = /坏了|损坏|故障|报修|反馈|反映|投诉|不能用|无法使用|失灵|漏水|不亮|连不上|太吵|噪音|卫生差|占座/;
    const isFeedback = feedbackWords.test(text) && !explicitGuide && !libraryQuery && (!entry || /坏了|损坏|故障|漏水|太吵|连不上|不亮|我想|我要|帮我|提交|整理/.test(text));
    const feedbackContinuation = context.intent === 'feedback' && !libraryQuery && (locationOf(text) || /问题是|现象是|内容改|地点改|位置改|改成|改为/.test(text));
    if (isFeedback || feedbackContinuation) {
      const fresh = context.intent !== 'feedback' || /新的反馈|另外一条|再反馈/.test(text);
      const draft = fresh ? {} : {...context.feedbackDraft};
      context.intent = 'feedback'; delete context.awaiting;
      const location = locationOf(text);
      if (location) draft.location = location;
      const meaningful = /坏了|损坏|故障|不能用|无法使用|失灵|漏水|不亮|连不上|太吵|噪音|卫生|异味|太冷|太热|占座|丢失|缺页|破损/.test(text);
      if (meaningful || /问题是|现象是|内容改/.test(text)) {
        draft.description = text.replace(/^(?:问题是|现象是|内容改成|内容改为|问题改成|问题改为)\s*/, '').slice(0, 1000);
        if (location && draft.description.includes(location)) draft.description = draft.description.replace(location, '').replace(/^(?:我想反馈|我要反馈|反馈|报修|在|的)+/, '').trim();
      }
      context.feedbackDraft = draft;
      if (!draft.location || !draft.description) {
        context.awaiting = 'feedback';
        return reply(!draft.location && !draft.description ? '可以，请告诉我具体问题和地点，例如“三楼北区插座坏了”，也可以分两次补充。' : !draft.location ? `已记下“${draft.description}”。请补充楼层、阅览室或座位号。` : `地点已记为“${draft.location}”。具体发生了什么问题？`, 'feedback_clarify');
      }
      const description = draft.description;
      const category = /吵|噪音|占座/.test(description) ? '秩序反馈' : /卫生|异味|漏水|太冷|太热/.test(description) ? '环境问题' : /书|缺页/.test(description) ? '图书问题' : /插座|灯|故障|坏|设备|打印|网络|连不上|桌椅/.test(description) ? '设备故障' : '其他';
      const result = call('prepare_feedback', {category, location: draft.location, description});
      context.lastPending = result.action_id;
      return reply(result.error || `已整理${category}反馈，地点为${draft.location}。核对下方确认卡后提交；也可以继续修改地点或问题描述。`, 'feedback_preview');
    }

    // Specific book actions outrank generic recommendations; unrelated questions never turn into searches.
    const genericBook = /^(?:我想|我要|帮我|请)?(?:找书|查书|看书|读书|推荐几本书|推荐书|推荐一本书)[。!！?？\s]*$/.test(text);
    const openQuestion = /吗|呢|是啥|是什么|为什么|怎么|如何|解释|介绍|讲解|教我|帮我写|？|\?/;
    const bareTopic = topics.length > 0 && text.length < 20 && !openQuestion.test(text);
    const bookFollowup = !libraryQuery && context.intent === 'books' && /第一|第二|第三|第[1-9一二三四五六七八九]|这本|那本|它|在哪|位置|索书号|谁写|作者|出版|简介|介绍|详情|换一批|还有吗|下一批|为什么推荐/.test(text);
    if (libraryQuery || genericBook || bareTopic || bookFollowup || (context.awaiting === 'book_query' && !entry && !/座位|反馈|报修|自习/.test(text) && !openQuestion.test(text) && text.length <= 30)) {
      context.intent = 'books';
      delete context.lastPending;
      if (genericBook) { context.awaiting = 'book_query'; return reply('想找什么书？告诉我《书名》、作者、ISBN 或主题，例如“人工智能”。我只从已收录书单中查找。', 'book_clarify'); }
      delete context.awaiting;
      if (bookFollowup && !/换一批|还有吗|下一批/.test(text)) {
        const index = ordinal(text) ?? context.selectedBook ?? 0;
        if (!context.books?.length || !context.books[index]) return reply('当前候选中没有这一本，请按结果卡的序号选择，或重新提供书名。', 'book_clarify');
        context.selectedBook = index;
        const item = context.books[index];
        if (/在哪|哪儿|位置|哪楼|几楼|书架|索书号/.test(text)) {
          call('locate_book', {book_id: item.id});
          return reply(`已查询《${item.title}》的位置。资料没有提供的楼层、书架、索书号及可借状态仍需向学校正式目录核实。`, 'book_detail');
        }
        if (/为什么|理由/.test(text)) return reply(`《${item.title}》来自已导入书单，与“${context.bookQuery}”有词项匹配。当前按书名、作者、主题等字段检索，不能保证难度合适，也没有阅读过全文。`, 'book_detail');
        return reply(`《${item.title}》\n作者：${item.author || '待补充'}\n出版社：${item.publisher || '待补充'}\nISBN：${item.isbn || '待补充'}\n${item.summary || '没有收录内容简介，不能根据书名编写章节摘要。'}\n可借状态请通过学校正式目录核实。`, 'book_detail');
      }
      if (bookFollowup) context.bookOffset = (context.bookOffset || 0) + 3;
      else {
        const author = text.match(/作者[:：]?\s*([^，。；?？\s]{2,20})/) || text.match(/(?:找|查|搜)([^，。；]{2,16}?)的书/);
        context.bookQuery = quoted?.[1] || isbn?.[0] || author?.[1] || [...new Set(topics)].join(' ') || text.replace(/^(?:我想|我要|请|帮我|给我|查找|推荐|搜索|找|查|搜)+/, '').replace(/(?:相关)?(?:书籍|读物|的书|书目)[?？。!！]*$/, '').trim();
        context.bookOffset = 0;
      }
      const result = call('search_books', {query: context.bookQuery || text, limit: 3, offset: context.bookOffset});
      context.books = result.items || []; context.selectedBook = 0;
      if (!context.books.length) return reply(context.bookOffset ? '这组查询没有更多候选了。可以换一个主题或书名；我不会把相同结果当成新的一批。' : '当前书单没有匹配结果，可以换书名、作者、ISBN 或主题。这不代表学校实际没有该书。', 'books');
      return reply(`找到 ${context.books.length} 条本地书目${context.bookOffset ? '，这是下一批候选' : ''}。可以继续问“第一本在哪里”“第二本是谁写的”或“换一批”。可借状态待核实。`, 'books');
    }

    const seatWords = /座位|选座|订座|约座|找座|自习|靠窗|窗边|插座|安静|阅览室/;
    const seatContinuation = context.intent === 'seats' && !explicitGuide && (!entry || ['seat_facilities', 'power_and_charging', 'exam_study', 'how_book_seat'].includes(entry.id)) && /\d+\s*[:：点时楼层]|[一二三四五六七八九十两]+[点楼层]|明天|后天|今天|第|刚才|一样|去掉|不要|不用|不限|改|换|约|选|小时|插座|充电|电源|靠窗|安静|推荐理由|为什么推荐/.test(text);
    const clockInput = [...text.matchAll(TIME_RE)].length > 0 || /[一二三四五六七八九十两]+点/.test(text);
    if ((seatWords.test(text) && !explicitGuide && (!entry || clockInput || /找|选|约|想|需要/.test(text))) || seatContinuation || (clockInput && !entry)) {
      const continued = context.intent === 'seats';
      context.intent = 'seats'; delete context.awaiting;
      if (!continued) { delete context.times; delete context.timeDraft; context.seatFilters = {}; context.seats = []; }
      const selected = ordinal(text);
      if (selected != null && /选|预约|订|约|就|^(?:第)?[一二三四五六七八九十\d]+个[。!！?？\s]*$/.test(text) && !clockInput) {
        if (!context.seats?.[selected] || !context.times) return reply('请先查询可用座位，再按当前候选的序号选择。现在没有这个序号的可预约结果。', 'seat_clarify');
        const result = call('prepare_booking', {seat_id: context.seats[selected].id, ...context.times});
        context.lastPending = result.action_id;
        return reply(result.error || `已为第 ${selected + 1} 个候选座位生成确认卡。请核对时段后确认预约。`, 'seat_preview');
      }
      if (/为什么|推荐理由/.test(text) && context.seats?.length) return reply('这些候选符合你提出的楼层或阅览室条件，且在当前浏览器所选时段内没有预约冲突。插座、靠窗和安静程度资料不全，我不会把未知设施当成已满足。', 'seats');
      delete context.lastPending;
      try { updateSeatFilters(text, context); parseTimes(text, context); }
      catch (error) { delete context.times; context.seats = []; return reply(error.message, 'seat_clarify'); }
      if (!context.times) {
        context.awaiting = 'seat_time';
        return reply(context.timeDraft?.start != null ? '已记下开始时间。请补充结束时间，例如“到下午4点”，或者说“用两个小时”。' : '已记下选座条件。请告诉我使用时段，例如“明天下午2点到4点”；也可以说“明天下午两点，用两个小时”。', 'seat_clarify');
      }
      const result = call('search_seats', {...context.times, ...context.seatFilters});
      context.seats = result.items || [];
      if (result.error) { delete context.times; return reply(result.error, 'seat_clarify'); }
      if (!context.seats.length) return reply(Object.keys(context.seatFilters).some(key => ['has_power', 'near_window', 'quiet_zone'].includes(key))
        ? '没有符合全部条件的结果。当前资料未完整提供插座、靠窗和安静属性，不能保证这些设施。可以说“去掉插座要求”或“设施不限”，我会保留时段重新查。'
        : '这个时段和区域没有匹配座位。可以换楼层、阅览室或时间，例如“改成三楼”或“改成后天”。', 'seats');
      return reply(`找到 ${context.seats.length} 个本站可预约候选，时段为 ${display(context.times.start_at)} 至 ${display(context.times.end_at)}。${context.seatFilters.zone || (context.seatFilters.floor ? context.seatFilters.floor + '楼' : '当前范围')}内的候选在本站该时段空闲。可说“预约第二个”，或继续修改楼层、时段。`, 'seats');
    }

    if (entry) {
      context.lastKnowledge = entry.id;
      return reply(rules.overrides[entry.id] || (entry.dynamic ? dynamicAnswer(entry.dynamic) : entry.answer), 'knowledge');
    }
    if (/^(?:继续|然后呢|接下来呢|还有呢|怎么办)$/.test(clean)) {
      const hint = context.intent === 'books' ? '可以问“第一本在哪里”“第二本是谁写的”，或说“换一批”。'
        : context.intent === 'seats' ? '可以补充起止时间、修改楼层，或在候选出现后说“预约第二个”。'
        : context.intent === 'feedback' ? '可以补充反馈地点与具体现象，再通过确认卡提交。'
        : '可以告诉我想查的书名、选座时段或馆内遇到的问题。';
      return reply(hint, 'clarify');
    }
    return reply(rules.fallback, 'fallback');
  }
  window.offlineChat = chat;
})();
