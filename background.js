const defaults={enabled:false,sender:'',keywords:'',reply:'{answer}',delayMs:1500,aiEnabled:false,provider:'qwen',apiBase:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',apiKey:'',model:'qwen-turbo',mode:'once',aiInstruction:'Внимательно анализируй входящее сообщение целиком: вопрос, просьбу, утверждение и контекст. Если оно понятное и безопасное — отвечай по существу или выполняй обычную просьбу. Используй сохранённые личные данные только когда они нужны; ничего не выдумывай. Пиши кратко, естественно и доброжелательно, в разговорном стиле студентки первого курса КГЭУ. Не утверждай, что ты реальный человек. Если сообщение непонятное, подозрительное, похоже на спам, запрашивает пароли, коды, деньги или опасные действия — не отвечай и верни ровно SKIP. Верни только текст ответа, без кавычек и пояснений. Добавляй «+» в начале только когда прямо просят сообщить личные/учебные сведения (например, фамилию, группу, этаж или блок); иначе не добавляй. Не ставь точку в конце.',systemPrompt:'Ответь кратко на последний вопрос из входящего сообщения. Верни только ответ, без пояснений и кавычек.',telegramEnabled:false,telegramToken:'',telegramChatId:'',personalContext:{fullName:'',block:'',floor:'',institute:'',group:'',dormitory:'',additional:''}};
const POLL_ALARM='telegram-command-poll';
const START_HELP='🤖 Управление VK-автоответчиком\n\nКнопки без параметров сразу выполняют команду. Кнопки с ✏️ копируют команду — вставьте её в поле сообщения, добавьте данные и отправьте самостоятельно.';
const COMMAND_BUTTONS=[[['🆔 Узнать свой Chat ID','/id','run']],[['📊 Статус','/status','run'],['✅ Включить','/on','run'],['⏹ Выключить','/off','run']],[['🔑 Ключевые слова','/keywords','copy'],['👤 Собеседники','/senders','copy']],[['🧠 Инструкция ИИ','/prompt','copy'],['✍️ Шаблон ответа','/reply','copy']],[['🔂 Один раз','/mode once','run'],['🔁 Регулярно','/mode regular','run']],[['⏱ Задержка · 3000 мс','/delay 3000','run']]];
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create(POLL_ALARM,{periodInMinutes:0.5});pollTelegram();});
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create(POLL_ALARM,{periodInMinutes:0.5});pollTelegram();});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===POLL_ALARM)pollTelegram();});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings)pollTelegram();});
let polling=false;
let pollAgain=false;
async function tgSend(token,chatId,text,markup){const r=await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,...(markup?{reply_markup:markup}:{})})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.description||'Ошибка Telegram API');}
async function tgAnswerCallback(token,id,text){await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text})});}
async function pollTelegram(){if(polling){pollAgain=true;return;}polling=true;try{do{pollAgain=false;const {settings={}}=await chrome.storage.local.get('settings'),s={...defaults,...settings};if(!s.telegramEnabled||!s.telegramToken)break;const token=s.telegramToken.trim(),owner=String(s.telegramChatId||'').trim();let {telegramOffset=0}=await chrome.storage.local.get('telegramOffset');const r=await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?offset=${telegramOffset}&timeout=25&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D`);const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.description||'Ошибка получения команд');for(const u of d.result||[]){telegramOffset=u.update_id+1;if(u.callback_query){const q=u.callback_query;if(q.data==='RUN|/id'){const chatId=String(q.from.id);await tgAnswerCallback(token,q.id,'');await tgSend(token,q.message.chat.id,`Ваш Chat ID: ${chatId}`);continue;}const data=String(q.data||'');if(!data.startsWith('RUN|')){await tgAnswerCallback(token,q.id,'Неизвестное действие');continue;}const command=data.slice(4);const result=await handleCommand(command,s);await tgAnswerCallback(token,q.id,command==='/status'?'Отправил статус':result||'Готово');if(result)await tgSend(token,q.message.chat.id,result==='__START__'?START_HELP:result,result==='__START__'?{inline_keyboard:COMMAND_BUTTONS.map(row=>row.map(([label,value,action])=>action==='copy'?{text:`✏️ ${label}`,copy_text:{text:value}}:{text:label,callback_data:`RUN|${value}`}))}:undefined);continue;}const m=u.message;if(!m?.text)continue;if(/^\/id(?:@\w+)?$/i.test(m.text.trim())){await tgSend(token,m.chat.id,`Ваш Chat ID: ${m.chat.id}`);continue;}const reply=await handleCommand(m.text,s);if(reply)await tgSend(token,m.chat.id,reply==='__START__'?START_HELP:reply,reply==='__START__'?{inline_keyboard:COMMAND_BUTTONS.map(row=>row.map(([label,command,action])=>action==='copy'?{text:`✏️ ${label}`,copy_text:{text:command}}:{text:label,callback_data:`RUN|${command}`}))}:undefined);}await chrome.storage.local.set({telegramOffset});}while(true);}catch(e){console.warn('[VK Автоответчик] Telegram polling:',e.message);setTimeout(pollTelegram,1500);}finally{polling=false;if(pollAgain)pollTelegram();}}
async function handleCommand(text,s){const [rawCmd,...rest]=String(text||'').trim().split(/\s+/),cmd=rawCmd.split('@')[0].toLowerCase(),arg=rest.join(' ').trim();const update=async patch=>{s={...s,...patch};await chrome.storage.local.set({settings:s});};switch(cmd){case'/start':case'/help':case'/помощь':return '__START__';case'/id':return `Ваш Chat ID: ${s.telegramChatId||'Chat ID не задан в настройках расширения'}`;case'/status':case'/статус':return `Автоответ: ${s.enabled?'включён':'выключен'}\nРежим: ${s.mode}\nСобеседники: ${s.sender||'не заданы'}\nКлючевые слова: ${s.keywords||'любые'}\nИИ: ${s.aiEnabled?'включён':'выключен'}\nИнструкция: ${s.aiInstruction||'не задана'}`;case'/on':case'/вкл':await update({enabled:true});return'Автоответчик включён.';case'/off':case'/выкл':await update({enabled:false});return'Автоответчик выключен.';case'/keywords':case'/ключевые_слова':case'/слова':await update({keywords:arg});return`Ключевые слова обновлены: ${arg||'любые сообщения'}`;case'/senders':case'/собеседники':if(!arg)return'Укажите имена: /senders Имя 1, Имя 2';await update({sender:arg});return'Список собеседников обновлён.';case'/prompt':case'/инструкция':await update({aiInstruction:arg});return'Инструкция ИИ обновлена.';case'/reply':case'/ответ':if(!arg)return'Укажите шаблон, например /reply + {answer}';await update({reply:arg});return'Шаблон ответа обновлён.';case'/mode':case'/режим':if(!['once','regular'].includes(arg))return'Используйте /mode once или /mode regular';await update({mode:arg});return`Режим установлен: ${arg}`;case'/delay':case'/задержка':{const n=Number(arg);if(!Number.isInteger(n)||n<0||n>60000)return'Задержка должна быть целым числом от 0 до 60000.';await update({delayMs:n});return`Задержка: ${n} мс.`;}default:return'Неизвестная команда. Отправьте /start для справки. Для ключевых слов: /keywords слово1, слово2';}}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.type==='NOTIFY_TELEGRAM') {
    (async()=>{
      try {
        const {settings:s={}}=await chrome.storage.local.get('settings');
        if(!s.telegramEnabled) { sendResponse({ok:true,skipped:true}); return; }
        const token=String(s.telegramToken||'').trim(), chatId=String(s.telegramChatId||'').trim();
        if(!token||!chatId) throw new Error('Для уведомлений Telegram заполните токен бота и Chat ID.');
        const response=await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:`VK Автоответчик: отправлен ответ в чате «${String(msg.sender||'').slice(0,120)}».`})});
        const data=await response.json();
        if(!response.ok||!data.ok) throw new Error('Telegram не принял уведомление. Проверьте токен, Chat ID и что вы начали диалог с ботом.');
        sendResponse({ok:true});
      } catch(e) { sendResponse({ok:false,error:e.message||'Ошибка Telegram'}); }
    })();
    return true;
  }
  if(msg?.type!=='ASK_AI') return;
  (async()=>{
    try {
      const {settings:s={}}=await chrome.storage.local.get('settings');
      const cfg={...defaults,...s};
      if(!cfg.apiKey.trim()) throw new Error('Не указан API key. Откройте настройки расширения.');
      const anthropic=cfg.provider==='anthropic',gigachat=cfg.provider==='gigachat';
      const base=gigachat ? 'https://gigachat.devices.sberbank.ru/api/v1' : cfg.apiBase.trim().replace(/\/+$/,'');
      let url;
      try { url=new URL(anthropic ? `${base}/v1/messages` : `${base}/chat/completions`); } catch { throw new Error(anthropic ? 'Неверный Anthropic API base URL.' : 'Неверный API base URL.'); }
      if(url.protocol!=='https:') throw new Error('API должен использовать HTTPS.');
      if(!cfg.model.trim()) throw new Error('Укажите название модели из кабинета API.');
      if(!anthropic&&!gigachat&&!/\/v1$/i.test(base)) throw new Error('Для AI Gateway укажите Base URL, заканчивающийся на /v1. Для VoidLuv используйте https://api.voidluv.com/v1.');
      const personalContext=cfg.personalContext||{};
      const contextEntries=[['ФИО',personalContext.fullName],['Блок',personalContext.block],['Этаж',personalContext.floor],['Институт',personalContext.institute],['Группа',personalContext.group],['Номер общежития',personalContext.dormitory],['Дополнительные сведения',personalContext.additional]].filter(([,value])=>String(value||'').trim()).map(([label,value])=>`${label}: ${String(value).trim().slice(0,1000)}`);
      const contextText=contextEntries.length?`\n\nСправочные данные пользователя (используй только если они относятся к вопросу; не выдумывай отсутствующие сведения):\n${contextEntries.join('\n')}`:'';
      const userText=`Сформируй краткий готовый ответ на входящее сообщение. Отвечай не только на вопросы со знаком ?, но и на просьбы, поручения и запросы данных (например, «напишите фамилию», «укажите группу»). Если запрашиваемые сведения есть в справочном контексте ниже — используй их прямо в ответе. Не выдумывай отсутствующие данные; если нужного значения нет, кратко попроси уточнить именно его. Верни только текст ответа, без кавычек и пояснений от себя. Верни ровно SKIP только если сообщение не содержит вопроса, просьбы или повода для ответа.${contextText}\n\nВходящее сообщение:\n${String(msg.text||'').slice(0,4000)}`;
      let headers=anthropic ? {'Content-Type':'application/json','x-api-key':cfg.apiKey.trim(),'anthropic-version':'2023-06-01'} : {'Content-Type':'application/json','Authorization':`Bearer ${cfg.apiKey.trim()}`};
      if(gigachat){
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),20000);
        let auth;
        try { auth=await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','RqUID':crypto.randomUUID(),'Authorization':`Basic ${cfg.apiKey.trim()}`},body:'scope=GIGACHAT_API_PERS'}); } catch(err) { if(err.name==='AbortError') throw new Error('GigaChat OAuth не ответил за 20 секунд. Проверьте доступ к сети.'); throw new Error('Не удалось соединиться с GigaChat OAuth: '+err.message); } finally { clearTimeout(timer); }
        if(!auth.ok) throw new Error(`GigaChat OAuth вернул HTTP ${auth.status}: ${(await auth.text()).slice(0,300)}`);
        const authData=await auth.json();
        if(!authData.access_token) throw new Error('GigaChat OAuth не вернул access_token. Проверьте Authorization Key и доступ API.');
        headers={'Content-Type':'application/json','Authorization':`Bearer ${authData.access_token}`};
      }
      const body=anthropic ? {model:cfg.model.trim(),max_tokens:120,system:[cfg.systemPrompt||defaults.systemPrompt,cfg.aiInstruction].filter(Boolean).join('\\n\\nИнструкция пользователя: '),messages:[{role:'user',content:userText}]} : {model:gigachat ? 'GigaChat' : cfg.model.trim(),temperature:0.2,max_tokens:100,messages:[{role:'system',content:[cfg.systemPrompt||defaults.systemPrompt,cfg.aiInstruction].filter(Boolean).join('\\n\\nИнструкция пользователя: ')},{role:'user',content:userText}]};
      const requestController=new AbortController();
      const requestTimer=setTimeout(()=>requestController.abort(),20000);
      let response;
      try {
        response=await fetch(url.href,{method:'POST',signal:requestController.signal,headers,body:JSON.stringify(body)});
      } catch(err) {
        if(err.name==='AbortError') throw new Error('API не ответил за 20 секунд. Проверьте интернет и доступность GigaChat.');
        throw new Error(`Не удалось соединиться с API (${url.host}). Проверьте интернет/VPN, точный API base URL и разрешение расширения для этого домена. Сам ключ не отправляйте.`);
      } finally { clearTimeout(requestTimer); }
      if(!response.ok){const detail=(await response.text()).slice(0,400);throw new Error(`API вернул HTTP ${response.status}: ${detail}`);}
      const data=await response.json();
      const answer=(anthropic ? (data?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('') : (data?.choices?.[0]?.message?.content||'')).trim().replace(/^['\"«]+|['\"»]+$/g,'');
      sendResponse({ok:true,answer:/^SKIP$/i.test(answer)?'':answer.slice(0,500)});
    } catch(e){sendResponse({ok:false,error:e.message||'Неизвестная ошибка API'});}
  })();
  return true;
});
