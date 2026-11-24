(() => {
  if (window.__simpleVkAutoReplyLoaded) return;
  window.__simpleVkAutoReplyLoaded = true;

  const defaults = { enabled: false, sender: "Заур Сергалиев", keywords: "", telegramEnabled: false, reply: "{answer}", delayMs: 1500, aiEnabled: false, provider: "gigachat", apiBase: "https://gigachat.devices.sberbank.ru/api/v1", apiKey: "", model: "GigaChat", mode: "once", aiInstruction: "Ответь кратко на последнее входящее сообщение. Верни только ответ, без пояснений и кавычек.", systemPrompt: "Ответь кратко на последнее входящее сообщение. Верни только ответ, без пояснений и кавычек." };
  let settings = { ...defaults };
  let busy = false;
  let route = location.href;
  let lastChatKey = "";
  let chatGeneration = 0;
  let lastSentAt = 0;
  let lastSentText = "";
  let lastIncomingSender = "";
  let lastIncomingChat = "";
  let lastSpeaker = "unknown";
  let lastBotReplyKey = "";
  let observerReady = false;
  let initialLoadTimer = 0;
  const seen = new Set();
  const pending = new Set();
  const sent = new Set();
  const sentReplies = new Set();

  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const isChat = () => /\/(im|messenger)(\/|$|\?)/i.test(location.pathname);
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }
  function inputBox() {
    const els = [...document.querySelectorAll('[contenteditable="true"], textarea')].filter(visible);
    return els.find(e => {
      const r=e.getBoundingClientRect();
      return r.bottom > innerHeight * .55 && (e.tagName === 'TEXTAREA' || e.getAttribute('role') === 'textbox' || e.getAttribute('data-placeholder'));
    }) || null;
  }
  function headerText() {
    const selectors = ['[data-testid*="conversation-header"]','[class*="ConversationHeader"]','[class*="ChatHeader"]','header'];
    for (const sel of selectors) {
      const el = [...document.querySelectorAll(sel)].find(visible);
      const t = norm(el?.innerText);
      if (t && t.length < 250) return t;
    }
    return '';
  }
  function msgNodes() {
    const selectors = '[data-testid*="message" i], [class*="Message__root"], [class*="ConvoHistory__message"], .im-mess';
    return [...document.querySelectorAll(selectors)].filter(el => {
      if (!visible(el) || el.closest('[contenteditable="true"]')) return false;
      const r=el.getBoundingClientRect();
      const box=inputBox();
      if (box && r.left < box.getBoundingClientRect().left - 80) return false;
      return true;
    });
  }
  function messageDirection(el) {
    let foundIncoming=false;
    for (let n=el, i=0; n && i<12; n=n.parentElement,i++) {
      const c = typeof n.className === 'string' ? n.className.toLowerCase() : '';
      const testId = (n.getAttribute('data-testid') || '').toLowerCase();
      const aria = (n.getAttribute('aria-label') || '').toLowerCase();
      const out = n.getAttribute('data-is-out') === 'true' || n.getAttribute('data-out') === '1' || /(^|[\s_-])(out|outgoing|sent)([\s_-]|$)/.test(c) || /im-mess--out|message_out|outgoing|sent-message/.test(c+' '+testId) || /исходящ/.test(aria);
      const incoming = n.getAttribute('data-is-out') === 'false' || n.getAttribute('data-out') === '0' || /(^|[\s_-])(in|incoming|received)([\s_-]|$)/.test(c) || /im-mess--in|message_in|incoming|received-message/.test(c+' '+testId) || /входящ/.test(aria);
      // Исходящий маркер на любом предке всегда имеет приоритет над входящим.
      if (out) return 'outgoing';
      if (incoming) foundIncoming=true;
    }
    return foundIncoming ? 'incoming' : 'unknown';
  }
  function resolveSenderFromMessage(el) {
    const explicit = norm(el.getAttribute('data-sender') || el.getAttribute('data-author') || '');
    if (explicit && explicit.length < 120) return explicit.toLocaleLowerCase('ru');
    const root=el.closest('[data-testid*="message" i], [class*="Message__root"], [class*="ConvoHistory__message"], .im-mess')||el;
    const selectors=['[data-testid*="sender" i]','[class*="sender" i]','[class*="author" i]','a[href*="/id"]'];
    for(const sel of selectors){for(const node of root.querySelectorAll(sel)){const name=norm(node.innerText||node.getAttribute('aria-label')||node.getAttribute('title')||'').toLocaleLowerCase('ru');if(name&&name.length<120)return name;}}
    return '';
  }
  function lastQuestion(text) {
    const parts = (text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    const q = parts.filter(s => s.includes('?'));
    const selected = q.length ? q[q.length - 1] : parts[parts.length - 1];
    return (selected || text).replace(/\?+\s*$/, '').trim();
  }
  async function askAI(message) {
    if (!settings.aiEnabled) return lastQuestion(message);
    const result=await chrome.runtime.sendMessage({type:'ASK_AI',text:message});
    if (!result?.ok) throw new Error(result?.error||'ИИ API не ответил');
    return result.answer||'';
  }
  function fillTemplate(template, answer) {
    return (template || defaults.reply).replace(/\{answer\}/gi, answer).replace(/\{lastQuestion\}/gi, answer).replace(/\{message\}/gi, answer);
  }
  function setValue(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter ? setter.call(el,text) : el.value=text;
      el.dispatchEvent(new Event('input',{bubbles:true}));
    } else {
      const sel=getSelection(), range=document.createRange();
      range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
      if (!document.execCommand('insertText',false,text)) {
        el.textContent=text;
        el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
      }
    }
  }
  function showStatus(text) {
    const badge=document.createElement('div');
    badge.textContent=text;
    Object.assign(badge.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',maxWidth:'420px',padding:'12px 16px',background:'#174f2b',color:'#fff',borderRadius:'8px',font:'14px Segoe UI,Arial,sans-serif',boxShadow:'0 4px 16px #0005'});
    document.body.appendChild(badge);setTimeout(()=>badge.remove(),6000);
  }
  function markCurrentSeen() {
    msgNodes().forEach(el => {
      const t=norm(el.innerText);
      if(t) seen.add(`${location.pathname+location.search}|${t}`);
    });
    observerReady=true;
  }
  async function inspect(el) {
    if (!observerReady || !settings.enabled || !isChat() || !el.isConnected) return;
    const direction=messageDirection(el);
    const chatId=location.pathname+location.search;
    const text=norm(el.innerText);
    if (!text || text.length < 2 || text.length > 2000) return;
    const normalizedText=text.toLocaleLowerCase('ru');
    const messageKey=`${chatId}|${text}`;
    if(direction==='outgoing') {
      lastSpeaker='self';
      // Даже если VK пришлёт повторный DOM-узел отправленного ответа, не обрабатываем его.
      if(text&&lastBotReplyKey&&normalizedText.includes(lastBotReplyKey))return;
      return;
    }
    // VK иногда не выставляет направление сообщения. Текст нашего ответа всё равно однозначно исключаем.
    if ([...sentReplies].some(reply=>reply && (normalizedText===reply || normalizedText.includes(reply)))) {
      lastSpeaker='self';
      return;
    }
    const senders=String(settings.sender||'').split(/[\n,;]+/).map(norm).filter(Boolean).map(x=>x.toLocaleLowerCase('ru'));
    const explicitSender=resolveSenderFromMessage(el);
    if(explicitSender) { lastIncomingSender=explicitSender; lastIncomingChat=chatId; }
    const senderContext=explicitSender || (lastIncomingChat===chatId ? lastIncomingSender : '');
    // Не используем заголовок чата как автора: он показывает владельца аккаунта, а не автора строки.
    if(!senderContext || !senders.length || !senders.some(name=>senderContext.includes(name))) return;
    // Строго чередуем ходы: если последним уже писал собеседник, второго ответа подряд не отправляем.
    // После собственного сообщения/старта диалога разрешаем один ход собеседника.
    if(lastSpeaker==='peer') return;
    lastSpeaker='peer';
    const keywords=String(settings.keywords||'').split(/[\\n,;]+/).map(norm).filter(Boolean).map(x=>x.toLocaleLowerCase('ru'));
    if (keywords.length && !keywords.some(word=>text.toLocaleLowerCase('ru').includes(word))) { seen.add(messageKey); return; }
    const sender=senders.find(name=>senderContext.includes(name));
    if (seen.has(messageKey) || pending.has(messageKey) || sent.has(messageKey)) return;
    if (busy) { showStatus('Новое сообщение поставлено в очередь: предыдущее ещё обрабатывается.'); setTimeout(()=>inspect(el),700); return; }
    seen.add(messageKey);
    pending.add(messageKey);
    const thisChatGeneration=chatGeneration;
    if (seen.size > 500) { seen.clear(); sent.clear(); }
    if (lastSentText && Date.now()-lastSentAt<120000) sentReplies.add(lastSentText.toLocaleLowerCase('ru'));
    busy=true;
    let prepared=false;
    try {
      const box=inputBox();
      if (!box) { showStatus('Входящее сообщение распознано, но поле ответа не найдено — ничего не отправлено.'); return; }
      showStatus(`Обнаружено новое входящее сообщение от «${sender}». Готовлю ответ…`);
      const answer=await askAI(text);
      if (thisChatGeneration!==chatGeneration || !isChat() || !senders.some(name=>headerText().toLocaleLowerCase('ru').includes(name))) { showStatus('Ответ отменён: активный чат изменился.'); return; }
      if (!answer) { showStatus('Ответ не отправлен: текст ответа пуст.'); return; }
      const response=fillTemplate(settings.reply, answer);
      if (!response.trim()) { showStatus('Ответ не отправлен: шаблон сообщения пуст.'); return; }
      // Never overwrite text the user already has in the composer.
      const existing=norm(box.tagName==='TEXTAREA'?box.value:box.innerText);
      if (existing) { showStatus('Ответ не отправлен: поле ввода уже содержит ваш текст.'); return; }
      setValue(box,response);
      const delay=Math.max(0,Math.min(60000,Number(settings.delayMs)||0));
      await new Promise(r=>setTimeout(r,delay));
      if (!settings.enabled || !box.isConnected || !isChat() || !senders.some(name=>headerText().toLocaleLowerCase('ru').includes(name))) { box.focus(); showStatus('Отправка отменена: автоответчик выключен или активный чат изменился.'); return; }
      const current=norm(box.tagName==='TEXTAREA' ? box.value : box.innerText);
      if (current !== norm(response)) { showStatus('Отправка отменена: текст в поле ответа изменился.'); return; }
      if (thisChatGeneration!==chatGeneration || sent.has(messageKey) || Date.now()-lastSentAt<2500 && lastSentText===norm(response)) { showStatus('Отправка отменена: защита от повтора.'); return; }
      // Проверяем наличие кнопки отправки и фиксируем попытку до события, чтобы исключить дубли.
      const sendButton=[...document.querySelectorAll('button,[role="button"]')].find(b=>visible(b) && /отправить|send/i.test(`${b.getAttribute('aria-label')||''} ${b.getAttribute('title')||''} ${b.innerText||''}`));
      if (!sendButton) { showStatus('Ответ подготовлен, но кнопка отправки VK не найдена — сообщение не отправлено.'); return; }
      sent.add(messageKey); sentReplies.add(norm(response).toLocaleLowerCase('ru')); lastBotReplyKey=norm(response).toLocaleLowerCase('ru'); lastSpeaker='self'; lastIncomingSender='';lastIncomingChat=''; lastSentAt=Date.now(); lastSentText=norm(response);
      prepared=true;
      // Не отправляем synthetic Enter: используем видимую кнопку VK.
      sendButton.click();
      showStatus(`Ответ отправлен собеседнику «${sender}».`);
      // In one-shot mode, disable after this send; regular mode continues only for new messages from the filtered chat.
      chrome.runtime.sendMessage({type:'NOTIFY_TELEGRAM',sender:headerText()}).then(result=>{if(result&&!result.ok){console.warn('[VK Автоответчик] Telegram:',result.error);showStatus(`Telegram: уведомление не доставлено (${result.error}).`);}}).catch(err=>{console.warn('[VK Автоответчик] Telegram:',err);showStatus('Telegram: не удалось отправить уведомление.');});
      if (settings.mode !== 'regular') {
        settings.enabled=false;
        await chrome.storage.local.set({settings});
        showStatus('Одноразовый ответ отправлен. Автоответчик выключен.');
      } else {
        showStatus('Ответ отправлен. Ожидаю новое сообщение от заданного собеседника.');
      }
    } catch (err) {
      console.error('[VK Автоответчик]',err);
      const badge=document.createElement('div');
      badge.textContent=`Автоответчик: ${err.message}`;
      Object.assign(badge.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',maxWidth:'420px',padding:'12px 16px',background:'#8b1e1e',color:'#fff',borderRadius:'8px',font:'14px Segoe UI,Arial,sans-serif',boxShadow:'0 4px 16px #0005'});
      document.body.appendChild(badge);setTimeout(()=>badge.remove(),8000);
    } finally { pending.delete(messageKey); busy=false; }
    if (!prepared) return;
  }
  const observer=new MutationObserver(mutations=>{
    if (!isChat()) return;
    if (location.href!==route) {
      route=location.href; chatGeneration++; lastChatKey=headerText(); observerReady=false; lastIncomingSender=''; lastIncomingChat=''; lastSpeaker='unknown';
      // Блокируем обработку до завершения рендеринга истории нового маршрута.
      clearTimeout(initialLoadTimer);
      initialLoadTimer=setTimeout(markCurrentSeen,900);
      return;
    }
    const h=headerText();
    if (h && lastChatKey && h!==lastChatKey) {
      lastChatKey=h; chatGeneration++; observerReady=false; lastIncomingSender=''; lastIncomingChat=''; lastSpeaker='unknown';
      // Не считаем историю нового чата свежими входящими сообщениями.
      clearTimeout(initialLoadTimer);
      initialLoadTimer=setTimeout(markCurrentSeen,900);
      return;
    }
    if (h) lastChatKey=h;
    let addedMessage=false;
    for (const m of mutations) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      const selector='[data-testid*="message" i], [class*="Message__root"], [class*="ConvoHistory__message"], .im-mess';
      const nodes=[...(n.matches?.(selector)?[n]:[]),...(n.querySelectorAll?.(selector)||[])];
      if(nodes.length) addedMessage=true;
      nodes.forEach(inspect);
    }
    // Пока VK дорисовывает историю асинхронно, ждём паузу без новых сообщений.
    if (!observerReady && addedMessage) {
      clearTimeout(initialLoadTimer);
      initialLoadTimer=setTimeout(markCurrentSeen,1200);
    }
  });
  chrome.storage.local.get('settings').then(({settings:s})=>{
    settings={...defaults,...s};
    lastChatKey=headerText();
    observer.observe(document.body,{childList:true,subtree:true});
    // Сначала даём VK отрисовать историю; только последующие DOM-добавления считаются новыми.
    initialLoadTimer=setTimeout(markCurrentSeen,900);
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes.settings) settings={...defaults,...changes.settings.newValue};
  });
})();
