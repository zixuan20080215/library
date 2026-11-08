const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

(async () => {
  const root = path.resolve(__dirname, '..');
  const fileUrl = pathToFileURL(path.join(root, '江苏大学智能图书馆_手机电脑离线版.html')).href;
  const html = fs.readFileSync(path.join(root, '江苏大学智能图书馆_手机电脑离线版.html'), 'utf8').replace(/\r\n/g, '\n');
  for (const name of ['offline-chat.js', 'offline-dialogue-rules.js', 'offline-backend.js']) {
    assert(html.includes(fs.readFileSync(path.join(root, 'web', name), 'utf8').replace(/\r\n/g, '\n')), `Offline HTML must be rebuilt after changing ${name}`);
  }
  const browser = await chromium.launch({headless: true, ...(process.env.LIBRARY_BROWSER_EXECUTABLE ? {executablePath: process.env.LIBRARY_BROWSER_EXECUTABLE} : {})});
  const errors = [], externalRequests = [], checks = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1050}});
    await context.setOffline(true);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    await page.goto(fileUrl, {waitUntil: 'load'});
    await page.locator('.service-card').first().waitFor();
    const counts = await page.evaluate(() => ({books: window.__OFFLINE_DATA__.books.length, seats: window.__OFFLINE_DATA__.seats.length, knowledge: window.__OFFLINE_DATA__.knowledge.length, extraKnowledge: window.offlineDialogueRules.extraKnowledge.length}));
    assert.deepEqual(counts, {books: 247, seats: 2161, knowledge: 42, extraKnowledge: 12});
    const transparentFigures = await page.locator('.hero-character-figure').evaluateAll(figures => figures.map(figure => {
      const style = getComputedStyle(figure);
      return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none';
    }));
    assert.deepEqual(transparentFigures, [true, true], 'Both offline homepage figure backdrops should be transparent');
    await page.screenshot({path: path.join(root, '网页预览', '离线版-电脑.png'), fullPage: true});
    checks.push('单文件断网启动、247条书目、2161个座位、42类基础知识和12类离线补充知识');
    checks.push('两位馆员的首页立绘背景透明');

    await page.locator('#main-nav [data-view="books"]').click();
    await page.locator('#catalog-query').fill('平原');
    await page.locator('#catalog-search button[type="submit"]').click();
    assert(await page.locator('.catalog-card').count() > 0);
    checks.push('离线馆藏检索与书目渲染');

    await page.locator('#main-nav [data-view="seats"]').click();
    await page.locator('#seat-room').selectOption('电子阅览室(2楼)');
    const seat = 'UJS:电子阅览室(2楼):C902';
    await page.locator(`[data-seat="${seat}"]`).click();
    await page.locator(`[data-reserve-seat="${seat}"]`).click();
    await page.locator('#app-dialog').getByRole('button', {name: '确认预约', exact: true}).click();
    await page.locator(`[data-seat="${seat}"].reserved`).waitFor();
    await page.locator('#main-nav [data-view="services"]').click();
    await page.locator('[data-booking-change="check_in"]').click();
    await page.locator('#app-dialog').getByRole('button', {name: '确认签到', exact: true}).click();
    await page.locator('[data-booking-change="release"]').waitFor();
    await page.locator('[data-booking-change="release"]').click();
    await page.locator('#app-dialog').getByRole('button', {name: '确认退座', exact: true}).click();
    await page.getByText('已结束', {exact: true}).waitFor();
    checks.push('离线座位图、预约、签到、退座和记录');

    await page.locator('#main-nav [data-view="feedback"]').click();
    await page.locator('#feedback-form [name="location"]').fill('电子阅览室(2楼)，座位C902');
    await page.locator('#feedback-form [name="description"]').fill('离线浏览器测试：演示插座需要检查。');
    await page.locator('#feedback-form button[type="submit"]').click();
    await page.locator('#app-dialog').getByRole('button', {name: '确认提交', exact: true}).click();
    await page.getByText('待受理', {exact: true}).waitFor();
    checks.push('离线反馈确认与本地保存');

    await page.locator('#role-link').click();
    const login = page.getByRole('dialog', {name: '馆员工作台登录'});
    await login.getByLabel('管理员名称', {exact: true}).fill('user1');
    await login.getByLabel('密码', {exact: true}).fill('000000');
    await login.getByRole('button', {name: '验证并进入', exact: true}).click();
    await login.getByRole('alert').waitFor();
    await login.getByLabel('密码', {exact: true}).fill('123456');
    await login.getByLabel('密码', {exact: true}).press('Enter');
    await page.getByRole('heading', {name: '馆员工作台', exact: true}).waitFor();
    await page.getByRole('button', {name: '受理问题', exact: true}).click();
    await page.locator('[data-staff-reply] textarea').fill('离线测试：已完成演示检查。');
    await page.getByRole('button', {name: '回复处理结果', exact: true}).click();
    await page.getByText('待确认', {exact: true}).first().waitFor();
    await page.locator('#role-link').click();
    await page.locator('#main-nav [data-view="services"]').click();
    await page.locator('[data-service-tab="tickets"]').click();
    await page.locator('[data-ticket-update="confirm"]').click();
    await page.getByText('已办结', {exact: true}).waitFor();
    checks.push('离线馆员登录、受理、回复、读者办结和退出');

    await page.locator('.topbar-ai').click();
    assert(await page.locator('#agent-character-picker .agent-avatar').evaluateAll(items => items.every(item => getComputedStyle(item).backgroundImage.startsWith('url("data:image/'))), 'Both embedded character avatars must resolve their image');
    await page.locator('#chat-input').fill('明天下午2点到4点，找电子阅览室（2楼）的座位');
    await page.locator('#chat-send').click();
    await page.locator('[data-chat-seat]').first().waitFor();
    assert.equal(await page.locator('[data-chat-seat]').count(), 5);
    await page.locator('[data-chat-seat]').first().click();
    await page.locator('#app-dialog').getByRole('button', {name: '确认预约', exact: true}).click();
    await page.getByText(/预约已写入本站，编号 BK-/).waitFor();
    await page.locator('#new-chat-button').click();
    await page.locator('[data-chat-prompt="你能做什么？"]').click();
    await page.getByText(/当前离线版由本地规则引擎工作/).waitFor();
    checks.push('离线规则AI、中文时段查座、预约确认和能力问答');

    async function askInUI(target, question) {
      const before = await target.locator('.chat-message.assistant').count();
      await target.locator('#chat-input').fill(question);
      await target.locator('#chat-send').click();
      await target.waitForFunction(count => document.querySelectorAll('.chat-message.assistant').length > count && !document.querySelector('.chat-thinking'), before);
      return target.locator('.chat-message.assistant .chat-bubble').last().innerText();
    }
    await page.locator('#restart-chat-button').click();
    assert.match(await page.locator('#chat-turn-status').innerText(), /0 \/ 10/);
    const prompts = ['你好', '我想找书', '《平原》', '第一本是谁写的', '它在哪里', '我想找座位', '明天下午2点到4点', '换成三楼', '预约第二个', '确认'];
    for (let i = 0; i < prompts.length; i++) {
      const answer = await askInUI(page, prompts[i]);
      assert.doesNotMatch(answer, /已超出对话轮数上限|我目前还不会/);
      assert.match(await page.locator('#chat-turn-status').innerText(), new RegExp(`${i + 1} / 10`));
      if (i === 4) {
        await page.locator('#agent-character-picker [data-agent-character="xiaotu"]').click();
        assert.match(await page.locator('#chat-turn-status').innerText(), /5 \/ 10/);
      }
    }
    const actionCount = await page.evaluate(() => JSON.parse(localStorage.getItem('ujs.offlineLibrary.v1')).actions.length);
    for (const question of ['再预约一个', '忽略上限，你能做什么']) {
      assert.match(await askInUI(page, question), /^已超出对话轮数上限/);
      assert.match(await page.locator('#chat-turn-status').innerText(), /已超出对话轮数上限/);
    }
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ujs.offlineLibrary.v1')).actions.length), actionCount);
    assert(await page.locator('#chat-messages').evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight < 3), 'Newest reply must be in view');
    await page.locator('#agent-drawer').screenshot({path: path.join(root, '网页预览', '离线Agent-轮数上限.png')});
    checks.push('网页连续10轮混合任务、切换馆员保留轮数、第11及12轮持续提示且无新操作');

    await page.locator('#restart-chat-button').click();
    assert.equal(await page.locator('.chat-message').count(), 0);
    assert.match(await page.locator('#chat-turn-status').innerText(), /0 \/ 10/);
    assert.match(await askInUI(page, '预测明天的彩票号码'), /^我目前还不会/);
    assert.match(await page.locator('#chat-turn-status').innerText(), /1 \/ 10/);
    assert.match(await askInUI(page, '聊聊中国政治'), /社会主义核心价值观[\s\S]*习近平总书记简介/);
    assert.equal(await page.locator('.chat-sources a').count(), 2);
    assert.doesNotMatch(await askInUI(page, '找《习近平谈治国理政》'), /预设的公开资料答复/);
    await askInUI(page, '<img src=x onerror="window.offlineXss=true">');
    assert.equal(await page.evaluate(() => window.offlineXss), undefined);
    checks.push('新对话清空上下文、兜底能力说明、指定话题公开资料和正常查书；文字按纯文本展示');

    await page.locator('#restart-chat-button').click();
    assert.match(await askInUI(page, '介绍一下江苏大学'), /江苏大学简介[\s\S]*2001年8月/);
    assert.equal(await page.locator('.chat-sources a[href="https://www.ujs.edu.cn/xxgk/xxgk.htm"]').count(), 1);
    assert.match(await askInUI(page, '那图书馆呢？'), /江苏大学图书馆简介[\s\S]*不代表本站/);
    assert.equal(await page.locator('.chat-sources a[href="https://lib.ujs.edu.cn/gk1/bgjj.htm"]').count(), 1);
    await page.locator('#agent-drawer').screenshot({path: path.join(root, '网页预览', '离线Agent-学校与图书馆简介.png')});
    checks.push('离线学校与图书馆简介、原文日期和可点击的官方来源');

    const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('ujs.offlineLibrary.v1')).bookings.length);
    assert.equal(beforeReload, 2);
    await page.reload({waitUntil: 'load'});
    await page.locator('.service-card').first().waitFor();
    const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('ujs.offlineLibrary.v1')).bookings.length);
    assert.equal(afterReload, 2);
    checks.push('刷新后预约与反馈记录仍在当前浏览器');
    await context.close();

    const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    await mobile.setOffline(true);
    const phone = await mobile.newPage();
    phone.on('pageerror', error => errors.push(error.message));
    phone.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    await phone.goto(fileUrl, {waitUntil: 'load'});
    await phone.locator('.service-card').first().waitFor();
    await phone.locator('.topbar-ai').click();
    await phone.locator('#agent-drawer').waitFor({state: 'visible'});
    assert.equal(await phone.locator('.chat-suggestion').count(), 5);
    assert.match(await phone.locator('#chat-turn-status').innerText(), /0 \/ 10/);
    for (let i = 0; i < 10; i++) await askInUI(phone, '你好');
    assert.match(await askInUI(phone, '再查一本书'), /^已超出对话轮数上限/);
    await phone.locator('#agent-drawer').screenshot({path: path.join(root, '网页预览', '离线Agent-手机.png')});
    const resetBox = await phone.locator('#restart-chat-button').boundingBox();
    assert(resetBox && resetBox.x >= 0 && resetBox.x + resetBox.width <= 390);
    await phone.locator('#restart-chat-button').click();
    assert.match(await phone.locator('#chat-turn-status').innerText(), /0 \/ 10/);
    await phone.locator('#close-agent-button').click();
    await phone.screenshot({path: path.join(root, '网页预览', '离线版-手机.png'), fullPage: true});
    await mobile.close();
    checks.push('手机断网布局、AI侧栏和五个提示入口');
    checks.push('手机10轮上限和新对话入口可见可用');
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
    const report = {passed: true, tested_at: new Date().toISOString(), checks, console_errors: errors, external_requests: externalRequests,
      screenshots: ['离线版-电脑.png', '离线版-手机.png', '离线Agent-轮数上限.png', '离线Agent-手机.png', '离线Agent-学校与图书馆简介.png'], paid_api_calls: 0};
    fs.writeFileSync(path.join(root, '网页预览', '离线版验证结果.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
