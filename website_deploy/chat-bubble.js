(function(){
if(document.getElementById('dimase-chat-bubble'))return;

var API=window.DIMASE_CHAT_API||'https://dimaseinc.org/agents/ask';
var autoSpeak=false;
var synth=window.speechSynthesis;

var style=document.createElement('style');
style.textContent='#dimase-chat-bubble{position:fixed;bottom:20px;right:20px;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}#dimase-chat-toggle{width:56px;height:56px;border-radius:50%;background:#0e0e16;border:2px solid #d4af37;color:#d4af37;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(212,175,55,.25);transition:transform .2s}#dimase-chat-toggle:hover{transform:scale(1.08)}#dimase-chat-panel{display:none;position:absolute;bottom:66px;right:0;width:360px;max-height:520px;background:#0e0e16;border:1px solid #1c1c2d;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.6);flex-direction:column;overflow:hidden}#dimase-chat-panel.open{display:flex}#dimase-chat-header{padding:12px 16px;background:#14141f;border-bottom:1px solid #1c1c2d;display:flex;justify-content:space-between;align-items:center}#dimase-chat-header span{color:#d4af37;font-size:13px;font-weight:600;letter-spacing:1px}.dchat-hdr-btns{display:flex;gap:6px;align-items:center}#dimase-chat-voice{background:none;border:1px solid #1c1c2d;color:#555570;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:.15s}#dimase-chat-voice:hover{border-color:#d4af37;color:#d4af37}#dimase-chat-voice.on{border-color:#d4af37;color:#d4af37;background:rgba(212,175,55,.1)}#dimase-chat-close{background:none;border:none;color:#555570;font-size:18px;cursor:pointer;width:30px;height:30px;display:flex;align-items:center;justify-content:center}#dimase-chat-messages{flex:1;overflow-y:auto;padding:12px;min-height:200px;max-height:380px;font-size:12px;line-height:1.7;color:#d0d0dd}.dcm{margin-bottom:10px;padding:8px 10px;border-radius:8px;max-width:90%;word-wrap:break-word;position:relative}.dcm.user{background:#14141f;margin-left:auto;color:#d0d0dd;text-align:right}.dcm.bot{background:rgba(212,175,55,.06);border:1px solid rgba(212,175,55,.12);color:#d0d0dd}.dcm .meta{font-size:9px;color:#555570;margin-top:4px;display:flex;justify-content:space-between;align-items:center}.dcm .speak-btn{background:none;border:none;color:#555570;cursor:pointer;font-size:13px;padding:2px 4px;transition:.15s;flex-shrink:0}.dcm .speak-btn:hover{color:#d4af37}.dcm .speak-btn.speaking{color:#d4af37;animation:spulse 1s infinite}@keyframes spulse{0%,100%{opacity:1}50%{opacity:.4}}#dimase-chat-input{display:flex;padding:10px;border-top:1px solid #1c1c2d;gap:8px}#dimase-chat-input input{flex:1;background:#07070b;border:1px solid #1c1c2d;color:#d0d0dd;padding:8px 10px;border-radius:6px;font-size:12px;outline:none}#dimase-chat-input input:focus{border-color:#d4af37}#dimase-chat-input button{background:none;border:1px solid #1c1c2d;color:#555570;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:12px;transition:.15s}#dimase-chat-input button:hover{border-color:#d4af37;color:#d4af37}#dimase-chat-mic{background:none;border:1px solid #1c1c2d;color:#555570;width:36px;border-radius:6px;cursor:pointer;font-size:14px;transition:.15s;display:flex;align-items:center;justify-content:center}#dimase-chat-mic:hover{border-color:#d4af37;color:#d4af37}#dimase-chat-mic.recording{border-color:#ff3355;color:#ff3355;background:rgba(255,51,85,.1);animation:spulse 1s infinite}';
document.head.appendChild(style);

var wrap=document.createElement('div');
wrap.id='dimase-chat-bubble';
wrap.innerHTML='<div id="dimase-chat-panel"><div id="dimase-chat-header"><span>DIMASE Intel</span><div class="dchat-hdr-btns"><button id="dimase-chat-voice" title="Auto-speak responses">\u{1F508}</button><button id="dimase-chat-close">&times;</button></div></div><div id="dimase-chat-messages"></div><div id="dimase-chat-input"><input type="text" placeholder="Ask anything\u2026"><button>Send</button><button id="dimase-chat-mic" title="Voice input">\u{1F3A4}</button></div></div><button id="dimase-chat-toggle">&#x26A1;</button>';
document.body.appendChild(wrap);

var panel=document.getElementById('dimase-chat-panel');
var toggle=document.getElementById('dimase-chat-toggle');
var closeBtn=document.getElementById('dimase-chat-close');
var msgs=document.getElementById('dimase-chat-messages');
var inp=wrap.querySelector('#dimase-chat-input input');
var btn=wrap.querySelector('#dimase-chat-input button');
var voiceBtn=document.getElementById('dimase-chat-voice');
var micBtn=document.getElementById('dimase-chat-mic');

toggle.onclick=function(){panel.classList.toggle('open');if(panel.classList.contains('open'))inp.focus()};
closeBtn.onclick=function(){panel.classList.remove('open')};

var voicesLoaded=false;
var cachedVoice=null;
function loadVoices(){
  if(!synth)return;
  var voices=synth.getVoices();
  if(voices.length>0){
    voicesLoaded=true;
    cachedVoice=voices.find(function(v){return v.lang.startsWith('en')&&v.name.toLowerCase().includes('natural')})||voices.find(function(v){return v.lang.startsWith('en-US')})||voices.find(function(v){return v.lang.startsWith('en')})||null;
  }
}
if(synth){loadVoices();if(synth.onvoiceschanged!==undefined)synth.onvoiceschanged=loadVoices}

function speak(text,btnEl){
  if(!synth){return}
  synth.cancel();
  var clean=text.replace(/\u2014 Intel Agent$/,'').trim();
  if(!clean)return;
  if(btnEl)btnEl.classList.add('speaking');
  var done=function(){if(btnEl)btnEl.classList.remove('speaking')};
  var utter=new SpeechSynthesisUtterance(clean);
  utter.rate=0.85;utter.pitch=1;
  if(!voicesLoaded)loadVoices();
  if(cachedVoice)utter.voice=cachedVoice;
  utter.onend=done;utter.onerror=done;
  setTimeout(function(){synth.speak(utter)},50);
}

voiceBtn.onclick=function(){
  autoSpeak=!autoSpeak;
  voiceBtn.classList.toggle('on',autoSpeak);
  voiceBtn.textContent=autoSpeak?'\u{1F50A}':'\u{1F508}';
  if(!autoSpeak&&synth){synth.cancel()}
};

var recognition=null;
var isRecording=false;
function stopRecording(){
  isRecording=false;micBtn.classList.remove('recording');
  try{if(recognition)recognition.abort()}catch(e){}
}
if(window.SpeechRecognition||window.webkitSpeechRecognition){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition=new SR();
  recognition.continuous=false;
  recognition.interimResults=false;
  recognition.lang='en-US';
  recognition.onresult=function(e){
    var t=e.results[0][0].transcript;
    stopRecording();
    inp.value=t;
    send();
  };
  recognition.onend=function(){stopRecording()};
  recognition.onerror=function(){stopRecording()};
}

micBtn.onclick=function(){
  if(!recognition){addMsg('Voice input not supported in this browser.','bot','');return}
  if(isRecording){stopRecording();return}
  isRecording=true;micBtn.classList.add('recording');
  try{recognition.start()}catch(e){stopRecording()}
};

function addMsg(text,type,meta,skipSpeak){
  var d=document.createElement('div');d.className='dcm '+type;
  var txt=document.createElement('span');txt.textContent=text;
  d.appendChild(txt);
  if(type==='bot'){
    var metaRow=document.createElement('div');metaRow.className='meta';
    var metaText=document.createElement('span');metaText.textContent=meta||'';
    var speakBtn=document.createElement('button');speakBtn.className='speak-btn';speakBtn.textContent='\u{1F50A}';speakBtn.title='Read aloud';
    speakBtn.onclick=function(){speak(text,speakBtn)};
    metaRow.appendChild(metaText);metaRow.appendChild(speakBtn);
    d.appendChild(metaRow);
    if(autoSpeak&&!skipSpeak)speak(text,speakBtn);
  } else if(meta){
    var m=document.createElement('div');m.className='meta';m.textContent=meta;d.appendChild(m);
  }
  msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;
}

function send(){
  var q=inp.value.trim();if(!q)return;
  var isA0=(/^\/a0\b/.test(q))||(/(agent\s*zero|\bdimase\b|\ba0\b)/i.test(q));
  var cleanQ=isA0?q.replace(/^\/a0\s*/,''):q;
  addMsg(q,'user');inp.value='';
  var payload={query:cleanQ};
  if(isA0)payload.useAgentZero=true;
  fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  .then(function(r){return r.json()})
  .then(function(d){var meta=d.model?d.model+' via '+d.provider:'';if(d.model==='agent-zero')meta='DiMase (AWS)';addMsg(d.response||d.error||'No response','bot',meta)})
  .catch(function(e){addMsg('Error: '+e.message,'bot')});
}

btn.onclick=send;
inp.onkeydown=function(e){if(e.key==='Enter')send()};

})();