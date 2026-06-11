var VoiceLayer=function(y){"use strict";var f=(h=>(h.PERMISSION_DENIED="PERMISSION_DENIED",h.ALREADY_RECORDING="ALREADY_RECORDING",h.NOT_RECORDING="NOT_RECORDING",h.BROWSER_NOT_SUPPORTED="BROWSER_NOT_SUPPORTED",h.API_ERROR="API_ERROR",h.TIMEOUT="TIMEOUT",h.PLAYBACK_ERROR="PLAYBACK_ERROR",h.ELEMENT_NOT_FOUND="ELEMENT_NOT_FOUND",h.DROPDOWN_NOT_FOUND="DROPDOWN_NOT_FOUND",h))(f||{});class g extends Error{constructor(t,e,s){super(e),Object.setPrototypeOf(this,new.target.prototype),this.name="VoiceLayerError",this.code=t,this.originalError=s}}class U{constructor(){this.mediaRecorder=null,this.chunks=[],this.stream=null,this.isRecording=!1}async requestPermission(){if(typeof navigator>"u"||!navigator.mediaDevices||typeof navigator.mediaDevices.getUserMedia!="function")throw new g(f.BROWSER_NOT_SUPPORTED,"navigator.mediaDevices.getUserMedia is not available in this environment. VoiceLayer requires a secure context (HTTPS or localhost).");try{return this.stream=await navigator.mediaDevices.getUserMedia({audio:!0}),!0}catch(t){if(t instanceof DOMException&&t.name==="NotAllowedError")return!1;throw new g(f.PERMISSION_DENIED,`Failed to acquire microphone: ${t instanceof Error?t.message:String(t)}`,t)}}async startRecording(){if(!this.stream)throw new g(f.PERMISSION_DENIED,"No active media stream. Call requestPermission() and ensure it returns true before recording.");if(this.isRecording)throw new g(f.ALREADY_RECORDING,"Recording is already in progress. Call stopRecording() first.");if(typeof MediaRecorder>"u")throw new g(f.BROWSER_NOT_SUPPORTED,"MediaRecorder is not supported in this browser.");const t=U.pickMimeType();this.chunks=[];try{this.mediaRecorder=new MediaRecorder(this.stream,{mimeType:t})}catch(e){throw new g(f.BROWSER_NOT_SUPPORTED,`Could not create MediaRecorder with mimeType "${t}": ${e instanceof Error?e.message:String(e)}`,e)}this.mediaRecorder.addEventListener("dataavailable",e=>{e.data.size>0&&this.chunks.push(e.data)}),this.mediaRecorder.start(250),this.isRecording=!0}async stopRecording(){if(!this.isRecording||!this.mediaRecorder)throw new g(f.NOT_RECORDING,"No recording in progress. Call startRecording() first.");return new Promise((t,e)=>{if(!this.mediaRecorder){e(new g(f.NOT_RECORDING,"MediaRecorder was unexpectedly null."));return}this.mediaRecorder.addEventListener("stop",()=>{var o;const s=((o=this.mediaRecorder)==null?void 0:o.mimeType)??"audio/webm",i=new Blob(this.chunks,{type:s});this.chunks=[],this.isRecording=!1,t(i)},{once:!0}),this.mediaRecorder.addEventListener("error",s=>{this.isRecording=!1,e(new g(f.API_ERROR,`MediaRecorder error during stop: ${s.type}`,s))},{once:!0}),this.mediaRecorder.stop()})}destroy(){if(this.isRecording&&this.mediaRecorder)try{this.mediaRecorder.stop()}catch{}if(this.stream){for(const t of this.stream.getTracks())t.stop();this.stream=null}this.mediaRecorder=null,this.chunks=[],this.isRecording=!1}static pickMimeType(){const t=["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"];return typeof MediaRecorder>"u"?"":t.find(e=>MediaRecorder.isTypeSupported(e))??""}}const At="https://api.openai.com",J=1e4;class P{constructor(t,e="hi",s=At){this.apiKey=t,this.language=e,this.openaiBaseUrl=s}async transcribe(t){try{return await this._transcribeOnce(t)}catch(e){if(e instanceof g&&e.code===f.TIMEOUT||e instanceof g&&e.message.includes("HTTP 4"))throw e;return await new Promise(s=>setTimeout(s,600)),this._transcribeOnce(t)}}async _transcribeOnce(t){const e=new FormData,s=P.extFromMime(t.type);e.append("file",t,`audio.${s}`),e.append("model","whisper-1"),e.append("language",P.normaliseLanguage(this.language)),e.append("response_format","json");const i=new AbortController,o=setTimeout(()=>i.abort(),J);let n;try{n=await fetch(`${this.openaiBaseUrl}/v1/audio/transcriptions`,{method:"POST",headers:{Authorization:`Bearer ${this.apiKey}`},body:e,signal:i.signal})}catch(a){throw a instanceof DOMException&&a.name==="AbortError"?new g(f.TIMEOUT,`Whisper transcription timed out after ${J/1e3} s.`,a):new g(f.API_ERROR,`Network error contacting Whisper API: ${a instanceof Error?a.message:String(a)}`,a)}finally{clearTimeout(o)}if(!n.ok){let a="";try{a=await n.text()}catch{}throw new g(f.API_ERROR,`Whisper API returned HTTP ${n.status} ${n.statusText}. Body: ${a}`)}let r;try{r=await n.json()}catch(a){throw new g(f.API_ERROR,"Whisper API returned a non-JSON response body.",a)}if(typeof r.text!="string")throw new g(f.API_ERROR,`Unexpected Whisper response shape — "text" field missing. Got: ${JSON.stringify(r)}`);return r.text.trim()}static extFromMime(t){var i;const e={"audio/webm":"webm","audio/ogg":"ogg","audio/mp4":"mp4","audio/mpeg":"mp3","audio/wav":"wav","audio/flac":"flac"},s=((i=t.split(";")[0])==null?void 0:i.trim())??"";return e[s]??"webm"}static normaliseLanguage(t){var e;return((e=t.split("-")[0])==null?void 0:e.toLowerCase())??"en"}}const St="https://api.elevenlabs.io/v1/text-to-speech",Tt="https://api.openai.com/v1/audio/speech",Ct="9BWtsMINqrJLrRacOk9x";class ${constructor(t){this.config=t,this.currentAudio=null,this.currentUtterance=null}async speak(t){if(t.trim())switch(await this.stop(),this.config.provider){case"elevenlabs":return this.speakElevenLabs(t);case"openai":return this.speakOpenAI(t);case"browser":return this.speakBrowser(t);default:{const e=this.config.provider;throw new g(f.API_ERROR,`Unknown TTS provider: ${e}`)}}}async stop(){this.currentAudio&&(this.currentAudio.pause(),this.currentAudio.src="",this.currentAudio=null),this.currentUtterance&&typeof window<"u"&&window.speechSynthesis&&(window.speechSynthesis.cancel(),this.currentUtterance=null)}async speakElevenLabs(t){const{apiKey:e,voiceId:s=Ct,speed:i=1}=this.config;if(!e)throw new g(f.API_ERROR,"ElevenLabs TTS requires an apiKey in TTSConfig.");const o=`${St}/${encodeURIComponent(s)}`;let n;try{n=await fetch(o,{method:"POST",headers:{"xi-api-key":e,"Content-Type":"application/json",Accept:"audio/mpeg"},body:JSON.stringify({text:t,model_id:"eleven_multilingual_v2",voice_settings:{speed:Math.max(.25,Math.min(4,i)),stability:.5,similarity_boost:.75}})})}catch(a){throw new g(f.API_ERROR,`Network error contacting ElevenLabs: ${a instanceof Error?a.message:String(a)}`,a)}if(!n.ok){const a=await $.safeReadText(n);throw new g(f.API_ERROR,`ElevenLabs API returned HTTP ${n.status} ${n.statusText}. Body: ${a}`)}const r=await n.blob();return this.playAudioBlob(r)}async speakOpenAI(t){const{apiKey:e,speed:s=1}=this.config;if(!e)throw new g(f.API_ERROR,"OpenAI TTS requires an apiKey in TTSConfig.");let i;try{i=await fetch(Tt,{method:"POST",headers:{Authorization:`Bearer ${e}`,"Content-Type":"application/json"},body:JSON.stringify({model:"tts-1",input:t,voice:"alloy",speed:Math.max(.25,Math.min(4,s))})})}catch(n){throw new g(f.API_ERROR,`Network error contacting OpenAI TTS: ${n instanceof Error?n.message:String(n)}`,n)}if(!i.ok){const n=await $.safeReadText(i);throw new g(f.API_ERROR,`OpenAI TTS API returned HTTP ${i.status} ${i.statusText}. Body: ${n}`)}const o=await i.blob();return this.playAudioBlob(o)}speakBrowser(t){if(typeof window>"u"||!window.speechSynthesis)throw new g(f.BROWSER_NOT_SUPPORTED,'window.speechSynthesis is not available. Use provider "openai" or "elevenlabs" instead.');return new Promise((e,s)=>{const i=new SpeechSynthesisUtterance(t);this.config.language&&(i.lang=this.config.language),this.config.speed!==void 0&&(i.rate=Math.max(.1,Math.min(10,this.config.speed))),i.onend=()=>{this.currentUtterance=null,e()},i.onerror=o=>{this.currentUtterance=null,o.error==="interrupted"||o.error==="canceled"?e():s(new g(f.PLAYBACK_ERROR,`SpeechSynthesis error: ${o.error}`,o))},this.currentUtterance=i,window.speechSynthesis.speak(i)})}playAudioBlob(t){return new Promise((e,s)=>{const i=URL.createObjectURL(t),o=new Audio(i);this.currentAudio=o,o.onended=()=>{URL.revokeObjectURL(i),this.currentAudio=null,e()},o.onerror=()=>{var n,r;URL.revokeObjectURL(i),this.currentAudio=null,s(new g(f.PLAYBACK_ERROR,`Audio playback failed (MediaError code ${((n=o.error)==null?void 0:n.code)??"?"}): ${((r=o.error)==null?void 0:r.message)??"unknown"}`))},o.play().catch(n=>{URL.revokeObjectURL(i),this.currentAudio=null,s(new g(f.PLAYBACK_ERROR,`audio.play() was rejected — possible autoplay policy block: ${n instanceof Error?n.message:String(n)}`,n))})})}static async safeReadText(t){try{return await t.text()}catch{return"(could not read response body)"}}}const Rt=["button","a[href]",'input:not([type="hidden"])',"select","textarea",'[role="button"]','[role="link"]','[role="menuitem"]','[role="option"]','[role="tab"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="combobox"]','[role="searchbox"]','[role="spinbutton"]','[role="slider"]','[tabindex]:not([tabindex="-1"])',"[onclick]","[data-action]","[data-href]",'[class*="btn"]:not(script):not(style)','[class*="button"]:not(script):not(style)',"[data-toggle]","[data-target]","[aria-haspopup]","[aria-controls]"].join(", "),Lt=["[data-voice-data]",".stat",".count",".metric",".badge",".summary","[data-count]","[data-value]"].join(", "),Ot=/^[\d,.\s₹$€£¥]+$/,Y=/^(\d[\d,]*)\s+\w+$/,Mt=60,z=20,_t=3;class u{scan(t=document.body){var r,a;const e=this.scanFocusedContext();let s,i;if(e.length>0)s=e,i=this.scanFocusContext();else{const l=this.findInteractiveElements(t).map((m,v)=>this.elementToAction(m,v)),d=u.deduplicateActions(l);s=u.sortActions(d),i="page"}const o=this.scanHiddenInteractive(t);return{currentPage:(((a=(r=document.querySelector("h1"))==null?void 0:r.textContent)==null?void 0:a.trim())??document.title).slice(0,80),currentRoute:window.location.pathname+window.location.search,availableActions:s,visibleData:this.extractVisibleData(t),scannedAt:Date.now(),pageTitle:document.title,hiddenActions:o,focusContext:i,openModals:this.scanOpenModals(),activeDropdowns:this.scanActiveDropdowns(),toasts:this.scanToasts()}}scanFocusedContext(){const t=document.activeElement;if(!t||t===document.body||t===document.documentElement)return[];const e=u.findFocusContainer(t);if(!e)return[];const i=this.findInteractiveElements(e).map((o,n)=>this.elementToAction(o,n));return u.sortActions(u.deduplicateActions(i))}scanFocusContext(){const t=document.activeElement;if(!t||t===document.body)return"page";const e=u.findFocusContainer(t);if(!e)return"page";if(u.isDropdownLike(e))return"dropdown";const s=typeof e.className=="string"?e.className:"";return/\b(drawer|sheet)\b/i.test(s)?"drawer":"modal"}scanHiddenInteractive(t=document.body){const e=["dialog",'[role="dialog"]','[role="alertdialog"]','[aria-modal="true"]','[aria-hidden="true"]'].join(", "),i=Array.from(t.querySelectorAll(e)).filter(r=>!u.isVisible(r)&&!u.isSdkElement(r)),o=[];let n=1e3;for(const r of i){if(o.length>=20)break;const a=this.elementToAction(r,n++);o.push({...a,isVisible:!1})}return o}scanOpenModals(){const t=['[role="dialog"]','[role="alertdialog"]',".modal",".drawer",".sheet"].join(", "),e=Array.from(document.querySelectorAll(t)).filter(o=>u.isVisible(o)&&!u.isSdkElement(o)),s=[];let i=2e3;for(const o of e){const n=this.findInteractiveElements(o);for(const r of n){const a=this.elementToAction(r,i++);s.push({...a,context:"modal"})}}return u.deduplicateActions(s)}scanActiveDropdowns(){const e=Array.from(document.querySelectorAll('[role="menu"], [role="listbox"]')).filter(o=>u.isVisible(o)&&!u.isSdkElement(o)),s=[];let i=3e3;for(const o of e){const n=Array.from(o.querySelectorAll('[role="option"], [role="menuitem"], li')).filter(r=>u.isVisible(r)&&!u.isSdkElement(r));for(const r of n)s.push(this.elementToAction(r,i++))}return s}scanToasts(){const t=['[role="alert"]','[role="status"]',".toast",".snackbar"].join(", ");return Array.from(document.querySelectorAll(t)).filter(e=>u.isVisible(e)&&!u.isSdkElement(e)).map(e=>(e.textContent??"").trim().slice(0,100)).filter(e=>e.length>0)}findInteractiveElements(t){const e=Array.from(t.querySelectorAll(Rt));return typeof console<"u"&&window.__vlDebugScan&&(console.log("[VL-SCAN] querySelectorAll count:",e.length),e.slice(0,15).forEach((s,i)=>{const o=u.isSdkElement(s),n=u.isVisible(s),r=s.tagName.toLowerCase(),a=s.getAttribute("id")??"",c=typeof s.className=="string"?s.className:"";console.log(`[VL-SCAN] [${i}] <${r}#${a}.${c}> isSdk=${o} isVisible=${n}`)})),e.filter(s=>!(u.isSdkElement(s)||!u.isVisible(s)))}elementToAction(t,e){const s=t.tagName.toLowerCase(),i=(t.getAttribute("type")??"").toLowerCase(),o=t.getAttribute("role")??"",n=t.getAttribute("href")??"",r=u.detectContext(t),a=u.detectElementType(t,r);let c;s==="a"&&n&&!n.startsWith("#")?c="navigate":s==="select"||o==="listbox"||o==="combobox"?c="select":s==="input"||s==="textarea"?c=i==="submit"||i==="button"?"submit":"input":i==="submit"||s==="button"&&t.getAttribute("type")==="submit"?c="submit":c="click";const l=u.extractLabel(t);let d;if(typeof t.getBoundingClientRect=="function"){const v=t.getBoundingClientRect();(v.width>0||v.height>0)&&(d={top:v.top,left:v.left,width:v.width,height:v.height})}const m=u.extractValueInfo(t,s,i,o);return{id:`action_${e}`,label:l,type:c,elementType:a,context:r,isDisabled:u.isDisabledElement(t),selector:this.generateSelector(t),target:c==="navigate"?n:void 0,ariaLabel:t.getAttribute("aria-label")??void 0,isVisible:!0,boundingBox:d,...m}}static detectContext(t){let e=t.parentElement;for(;e&&e!==document.body;){const s=e.tagName.toLowerCase(),i=e.getAttribute("role")??"",o=typeof e.className=="string"?e.className:"";if(s==="nav"||i==="navigation")return"navbar";if(s==="footer"||i==="contentinfo")return"footer";if(s==="aside"||/\bsidebar\b/i.test(o))return"sidebar";if(s==="dialog"||i==="dialog"||i==="alertdialog"||/\b(modal|dialog|drawer|sheet)\b/i.test(o))return"modal";e=e.parentElement}if(typeof getComputedStyle=="function")try{if(getComputedStyle(t).position==="fixed")return"floating"}catch{}return"main"}static detectElementType(t,e){if(e==="navbar")return"nav-item";const s=t.tagName.toLowerCase(),i=(t.type??"").toLowerCase(),o=t.getAttribute("role")??"";if(o==="tab")return"tab";if(o==="searchbox")return"search";if(o==="listbox")return"select";if(o==="combobox")return"custom-select";if(t.hasAttribute("aria-haspopup"))return t.getAttribute("aria-haspopup")==="dialog"?"modal-trigger":"dropdown-trigger";const n=t.getAttribute("data-toggle")??"";return n==="dropdown"?"dropdown-trigger":n==="modal"?"modal-trigger":t.hasAttribute("aria-expanded")&&!t.hasAttribute("aria-haspopup")?"accordion":s==="input"?i==="submit"?"form-submit":i==="checkbox"?"checkbox":i==="radio"?"radio":i==="search"?"search":i==="date"||i==="datetime-local"||i==="time"||i==="month"||i==="week"||/date/i.test(t.getAttribute("aria-label")??"")?"date-input":"input":s==="button"&&t.getAttribute("type")==="submit"?"form-submit":s==="select"?"select":s==="textarea"?"input":s==="a"?"link":s==="button"||o==="button"?"button":"other"}static extractValueInfo(t,e,s,i){const o={},n=t.placeholder;if(n&&(o.placeholder=n),e==="input")if(s==="checkbox"||s==="radio")o.currentValue=String(t.checked);else{const r=t.value;r&&(o.currentValue=r)}else if(e==="textarea"){const r=t.value;r&&(o.currentValue=r)}else if(e==="select"){o.currentValue=t.value;const r=Array.from(t.querySelectorAll("option")).slice(0,10).map(a=>(a.textContent??"").trim()).filter(a=>a.length>0);r.length>0&&(o.options=r)}else if(i==="listbox"||i==="combobox"){const r=Array.from(t.querySelectorAll('[role="option"]')).slice(0,10).map(c=>(c.textContent??"").trim()).filter(c=>c.length>0);r.length>0&&(o.options=r);const a=t.querySelector("input");a&&(a.value&&(o.currentValue=a.value),!o.placeholder&&a.placeholder&&(o.placeholder=a.placeholder))}return o}static isDisabledElement(t){return t.hasAttribute("disabled")||t.getAttribute("aria-disabled")==="true"||t.classList.contains("disabled")}extractVisibleData(t){const e={},s=Array.from(t.querySelectorAll(Lt));for(const i of s){if(Object.keys(e).length>=z)break;if(!u.isVisible(i))continue;const o=(i.textContent??"").trim();if(!o)continue;const n=u.deriveDataKey(i),r=u.parseValue(o);r!==null&&(e[n]=r)}if(Object.keys(e).length<z){const i=Array.from(t.querySelectorAll("p, span, td, dd, strong, b"));for(const o of i){if(Object.keys(e).length>=z)break;if(!u.isVisible(o)||u.isSdkElement(o))continue;const n=(o.textContent??"").trim();if(n&&(Ot.test(n)||Y.test(n))){const r=u.deriveDataKey(o);r in e||(e[r]=u.parseValue(n)??n)}}}return e}generateSelector(t){const e=t.getAttribute("id");if(e&&/^[a-zA-Z][\w-]*$/.test(e))return`#${CSS.escape(e)}`;const s=t.getAttribute("data-testid");if(s)return`[data-testid="${CSS.escape(s)}"]`;const i=t.getAttribute("data-id");return i?`[data-id="${CSS.escape(i)}"]`:u.nthChildPath(t,_t)}static extractLabel(t){const e=[t.getAttribute("aria-label"),t.innerText,t.textContent,t.getAttribute("placeholder"),t.getAttribute("title"),t.getAttribute("alt"),t.getAttribute("id")];for(const s of e){const i=s==null?void 0:s.trim().replace(/\s+/g," ");if(i)return i.slice(0,Mt)}return t.tagName.toLowerCase()}static isSdkElement(t){let e=t;for(;e;){const s=e.className;if((typeof s=="string"?s:"").split(" ").some(o=>o.startsWith("voicelayer"))||e.id.startsWith("voicelayer"))return!0;e=e.parentElement}return!1}static isVisible(t){const e=t;if(e.hidden)return!1;let s=e;for(;s&&s!==document.body&&s!==document.documentElement;){const i=s.style;if(i.display==="none"||i.visibility==="hidden")return!1;if(typeof getComputedStyle=="function")try{const o=getComputedStyle(s);if(o.display==="none"||o.visibility==="hidden")return!1}catch{}s=s.parentElement}return!0}static deduplicateActions(t){const e=new Set;return t.filter(s=>e.has(s.selector)?!1:(e.add(s.selector),!0))}static sortActions(t){const e={navigate:0,click:1,submit:2,input:3,select:4};return[...t].sort((s,i)=>e[s.type]-e[i.type])}static nthChildPath(t,e){const s=[];let i=t;for(let o=0;o<e&&i;o++){const n=i.parentElement;if(!n)break;const a=Array.from(n.children).indexOf(i)+1;s.unshift(`${i.tagName.toLowerCase()}:nth-child(${a})`),i=n}if(i&&i!==t){const o=i.tagName.toLowerCase(),n=i.getAttribute("id");return`${n?`#${CSS.escape(n)}`:o} > ${s.join(" > ")}`}return s.join(" > ")||t.tagName.toLowerCase()}static deriveDataKey(t){var n,r,a,c;const e=t.getAttribute("data-voice-data");if(e)return e.toLowerCase().replace(/\s+/g,"_");const s=((n=t.closest("tr"))==null?void 0:n.querySelector("th"))??((r=t.closest("dl"))==null?void 0:r.querySelector("dt"))??t.previousElementSibling??((a=t.parentElement)==null?void 0:a.querySelector('label, .label, [class*="label"]')),i=(c=s==null?void 0:s.textContent)==null?void 0:c.trim();if(i&&i.length<40)return i.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");const o=(t.textContent??"").trim().slice(0,20);return o?o.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,""):t.tagName.toLowerCase()}static parseValue(t){if(!t)return null;const e=t.replace(/[₹$€£¥,\s]/g,""),s=Number(e);if(!Number.isNaN(s)&&e!=="")return s;const i=Y.exec(t);if(i!=null&&i[1]){const o=Number(i[1].replace(/,/g,""));if(!Number.isNaN(o))return o}return t.length<=100?t:null}static findFocusContainer(t){let e=t;for(;e&&e!==document.body;){if(u.isModalLike(e)||u.isDropdownLike(e))return e;e=e.parentElement}return null}static isModalLike(t){const e=t.tagName.toLowerCase(),s=t.getAttribute("role")??"",i=typeof t.className=="string"?t.className:"";return e==="dialog"||s==="dialog"||s==="alertdialog"||/\b(modal|dialog|overlay|backdrop|drawer|sheet|popup)\b/i.test(i)}static isDropdownLike(t){const e=t.getAttribute("role")??"",s=typeof t.className=="string"?t.className:"";return e==="listbox"||e==="menu"||/\b(dropdown|popover|menu|options)\b/i.test(s)}}const D=3e3;class L{constructor(t,e){this.scanner=t,this.routeDetector=e}buildMap(){const t=this.scanner.scan();return{...t,currentRoute:this.routeDetector.getCurrentRoute(),currentPage:L.derivePageName(t,this.routeDetector)}}toPromptString(t){var a;const e=["navbar","modal","main","sidebar","floating","unknown"],s=[];if(s.push(`=== PAGE: ${t.currentPage} (${t.currentRoute}) ===`),s.push(`FOCUS CONTEXT: ${t.focusContext}`),s.push(""),s.push("--- OPEN MODALS ---"),t.openModals.length>0)for(const c of t.openModals)s.push(`[${c.elementType}] "${c.label}" → ${c.selector}`);else s.push("none");if(s.push(""),s.push("--- ACTIVE DROPDOWNS ---"),t.activeDropdowns.length>0)for(const c of t.activeDropdowns){const l=(a=c.options)!=null&&a.length?` (options: ${c.options.slice(0,5).join(", ")})`:"";s.push(`[${c.elementType}] "${c.label}" → ${c.selector}${l}`)}else s.push("none");s.push(""),s.push("--- TOASTS ---"),s.push(t.toasts.length>0?t.toasts.join(" | "):"none"),s.push(""),s.push("--- MAIN ACTIONS ---");const i=L.groupByContext(t.availableActions);for(const c of e){const l=i.get(c);if(l!=null&&l.length){s.push(`[${c.toUpperCase()}]`);for(const d of l)s.push(L.formatAction(d))}}s.push("");const o=Object.entries(t.visibleData);if(o.length>0){s.push("--- VISIBLE DATA ---");for(const[c,l]of o)s.push(`${c}: ${l}`);s.push("")}let n=s.join(`
`);const r=i.get("footer");if(r!=null&&r.length){const c=["[FOOTER]",...r.map(l=>L.formatAction(l)),""].join(`
`);n.length+c.length<=D&&(n=n+c)}if(t.hiddenActions.length>0){const c=["--- HIDDEN ACTIONS (appear after interaction) ---",...t.hiddenActions.slice(0,5).map(l=>`[${l.elementType}] "${l.label}" → ${l.selector}`),""].join(`
`);if(n.length+c.length<=D)n+=`
`+c;else{const l=`
--- HIDDEN ACTIONS ---
${t.hiddenActions.length} hidden elements
`;n.length+l.length<=D&&(n+=l)}}return n.length>D&&(n=n.slice(0,D-3)+"..."),n}installAutoRescan(t,e){let s=null;const i=t.onChange(()=>{s!==null&&clearTimeout(s),s=setTimeout(()=>{s=null,e(this.buildMap())},150)});return()=>{i(),s!==null&&(clearTimeout(s),s=null)}}static derivePageName(t,e){return t.currentPage&&t.currentPage!==t.pageTitle?t.currentPage:t.pageTitle?t.pageTitle:e.getPageName()}static groupByContext(t){const e=new Map;for(const s of t){const i=e.get(s.context)??[];i.push(s),e.set(s.context,i)}return e}static formatAction(t){var n;const e=t.isDisabled?" (DISABLED)":"",s=t.currentValue?` [val:${t.currentValue}]`:"",i=(n=t.options)!=null&&n.length?` (${t.options.slice(0,5).join("/")})`:"",o=t.target?`navigate:${t.target}`:`${t.type}:${t.selector}`;return`  [${t.elementType}|${t.context}] "${t.label}" → ${o}${e}${s}${i}`}}const M=class M{constructor(){M.patchHistory()}getCurrentRoute(){return typeof window>"u"?"/":window.location.pathname+window.location.search}getPageName(){if(typeof document>"u")return"unknown";const t=document.title.trim();if(t)return t.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"").slice(0,30);const e=window.location.pathname.split("/").filter(Boolean);return(e[e.length-1]??"home").slice(0,30)}onRouteChange(t){const e=()=>t(this.getCurrentRoute());return window.addEventListener("popstate",e),window.addEventListener("hashchange",e),window.addEventListener("voicelayer:routechange",e),()=>{window.removeEventListener("popstate",e),window.removeEventListener("hashchange",e),window.removeEventListener("voicelayer:routechange",e)}}static patchHistory(){if(M.patched||typeof window>"u")return;M.patched=!0;const t=()=>{window.dispatchEvent(new Event("voicelayer:routechange"))},e=history.pushState.bind(history);history.pushState=function(...i){e(...i),t()};const s=history.replaceState.bind(history);history.replaceState=function(...i){s(...i),t()}}static _resetPatchForTests(){M.patched=!1}};M.patched=!1;let B=M;class O{buildSystemPrompt(){return`You are VoiceLayer, an AI voice assistant embedded inside a web application.
Your job is to understand what the user wants to do and map it to an available action on the current page.

RULES:
1. Only output valid JSON — no markdown, no explanation, no code fences.
2. The action must exist in the availableActions list. Never invent selectors or routes.
3. If the user's intent is unclear or confidence < 0.7, set action to "clarify" and ask a follow-up in speak.
4. The "speak" field must be in the SAME language the user spoke. If they spoke Hindi, respond in Hindi. If Hinglish, respond in Hinglish.
5. Keep "speak" concise — max 2 sentences.
6. For navigate actions, target must be a route path (e.g. "/orders/today").
7. For click/focus/filter actions, target must be the CSS selector from availableActions.
8. For speak_only, target is null.
9. Nav-item elements (context: "navbar" or "sidebar", elementType: "nav-item") are page navigation links — use action "click" with their selector to navigate between pages/sections.
10. Always prefer a matching nav-item over saying the functionality doesn't exist — the user may be asking to switch to a different page.

OUTPUT FORMAT (strict):
{
  "action": "navigate|click|fill_form|speak_only|clarify|filter|focus",
  "target": "/route-or-#selector or null",
  "data": null or { "selector": "value" },
  "speak": "Response in user's language",
  "confidence": 0.85
}`}buildUserMessage(t){const{pageMap:e,transcribedText:s,networkContext:i}=t,o=O.topActions(e.availableActions,s).map(r=>({id:r.id,label:r.label,type:r.type,elementType:r.elementType,context:r.context,selector:r.selector,target:r.target}));let n=`Current page: ${e.currentPage} (${e.currentRoute})

Available actions:
${JSON.stringify(o,null,2)}

Visible data on page:
${JSON.stringify(e.visibleData)}

User said: "${s}"`;return i&&i.length>0&&(n+=`

Recent API activity on this page:
${O.formatNetworkContext(i)}`),n}buildAgentSystemPrompt(){return`You are VoiceLayer, an AI agent embedded in a web application.
You are executing a multi-step task on behalf of the user. Each turn you see the CURRENT state of the page and decide the single best next action to take.

RULES:
1. Only output valid JSON — no markdown, no explanation, no code fences.
2. Pick exactly ONE action per turn from the availableActions list. Never invent selectors or routes.
3. When the user's goal is fully achieved, output action "done" with a confirmation in "speak".
4. If you're stuck and can't make progress, output action "speak_only" explaining what you found.
5. The "speak" field must be in the SAME language the user originally spoke.
6. Keep "speak" concise — max 1 sentence per intermediate step; 1-2 sentences for "done".
7. Do NOT repeat an action you've already taken in this session (see stepHistory).
8. Semantic matching: "subscription end ho chuka" → look for tabs/filters labelled "Inactive", "Expired", "Churned", "Lapsed". "last payment" → sort headers. "dhundho" → search box.
9. For fill_form actions, "data" must be { "selector": "value to type" }.
10. Confidence < 0.65 → prefer "speak_only" over a wrong click.

AVAILABLE ACTIONS:
  navigate   — go to a route path
  click      — click a button, tab, link, or nav item
  fill_form  — type into an input/search box
  filter     — apply a dropdown or select filter
  focus      — focus an element
  scroll     — scroll the page
  speak_only — just say something, no DOM action
  done       — task complete, speak confirmation

OUTPUT FORMAT (strict JSON):
{
  "action": "navigate|click|fill_form|filter|focus|scroll|speak_only|done",
  "target": "/route or CSS-selector or null",
  "data":   null or { "selector": "value" },
  "speak":  "Response in user's language",
  "confidence": 0.85
}`}buildAgentStepMessage(t,e,s){const{pageMap:i,networkContext:o}=e,n=O.topActions(i.availableActions,t).map(d=>({id:d.id,label:d.label,type:d.type,elementType:d.elementType,context:d.context,selector:d.selector,target:d.target})),r=e.conversationHistory??[],a=r.length===0?"":`
Prior conversation context:
`+r.map(d=>`  ${d.role==="user"?"User":"Assistant"}: ${d.content}`).join(`
`)+`
`,c=s.length===0?"None yet — this is the first step.":s.map(d=>`  Step ${d.stepNumber}: ${d.action} → ${d.target??"null"} [${d.outcome}] → now on "${d.pageAfter}"`).join(`
`);let l=`User's original request: "${t}"
${a}
Steps taken so far:
${c}

CURRENT PAGE: ${i.currentPage} (${i.currentRoute})

Available actions on this page:
${JSON.stringify(n,null,2)}

Visible data:
${JSON.stringify(i.visibleData)}

Decide the single best NEXT action to make progress toward the user's goal. If the goal is already achieved, use "done".`;return o&&o.length>0&&(l+=`

Recent API calls:
${O.formatNetworkContext(o)}`),l}static topActions(t,e,s=30){if(t.length<=s)return t;const i=new Set(e.toLowerCase().replace(/[^\w\sऀ-ॿ]/g," ").split(/\s+/).filter(a=>a.length>2)),o=t.filter(a=>a.context==="navbar"||a.context==="sidebar"||a.context==="modal"),n=t.filter(a=>a.context!=="navbar"&&a.context!=="sidebar"&&a.context!=="modal").map(a=>{const c=`${a.label??""} ${a.id??""} ${a.selector??""}`.toLowerCase();let l=0;for(const d of i)c.includes(d)&&l++;return(a.elementType==="tab"||a.elementType==="select"||a.elementType==="custom-select")&&(l+=2),a.elementType==="search"&&(l+=2),{action:a,score:l}}).sort((a,c)=>c.score-a.score),r=Math.max(0,s-o.length);return[...o,...n.slice(0,r).map(a=>a.action)]}static formatNetworkContext(t){return t.map(e=>{const s=e.status!==void 0?` → ${e.status}`:"";return`${e.method} ${e.url}${s}`}).join(`
`)}}const It=new Set(["navigate","click","fill_form","speak_only","clarify","filter","focus"]);class A{parse(t,e){const s=A.extractJSON(t);let i;try{i=JSON.parse(s)}catch(w){throw new g(f.API_ERROR,`Invalid JSON from AI: ${s.slice(0,120)}`,w)}const o=i.action,n=typeof o=="string"&&It.has(o)?o:"clarify",r=typeof i.speak=="string"&&i.speak.trim()?i.speak:"I didn't understand that. Could you try again?",a=i.confidence,c=typeof a=="number"?Math.max(0,Math.min(1,a)):.5,l=typeof i.target=="string"&&i.target!=="null"?i.target:null,d=i.data,m=d&&typeof d=="object"&&!Array.isArray(d)&&d!==null?d:null;let v=n,p=r;return n==="click"||n==="focus"||n==="filter"?l&&[...e.availableActions,...e.hiddenActions??[],...e.openModals??[]].some(x=>x.selector===l||x.target===l)||(v="clarify",p="I couldn't find that on this page."):n==="navigate"&&(l||(v="clarify",p="I couldn't find that on this page.")),{action:v,target:l,data:m,speak:p,confidence:c,rawResponse:t}}static extractJSON(t){const e=/```(?:json)?\s*([\s\S]*?)```/.exec(t);if(e!=null&&e[1])return e[1].trim();const s=t.indexOf("{"),i=t.lastIndexOf("}");if(s===-1||i===-1||s>=i)throw new g(f.API_ERROR,`No JSON object found in AI response: "${t.slice(0,120)}"`);return t.slice(s,i+1)}static clarifyFallback(t="I didn't understand that. Could you try again?"){return{action:"clarify",target:null,data:null,speak:t,confidence:0}}}const Q="https://api.anthropic.com",Nt="https://api.openai.com";class _{constructor(t,e="claude-sonnet-4-5",s={}){this.apiKey=t,this.model=e,this.promptBuilder=new O,this.responseParser=new A,this.anthropicBaseUrl=s.anthropicBaseUrl??Q,this.openaiBaseUrl=s.openaiBaseUrl??Nt}async understand(t){const e=this.promptBuilder.buildSystemPrompt(),s=this.promptBuilder.buildUserMessage(t),i=_.buildMessages(t,s);let o;try{o=await this.fetchClaude(e,i)}catch(n){throw n}try{return this.responseParser.parse(o,t.pageMap)}catch{return this.retryClaudeSimple(t,e)}}async understandWithOpenAI(t,e){const s=this.promptBuilder.buildSystemPrompt(),i=this.promptBuilder.buildUserMessage(t);let o;try{o=await this.fetchOpenAI(s,t,i,e)}catch(n){throw n}try{return this.responseParser.parse(o,t.pageMap)}catch{return this.retryOpenAISimple(t,s,e)}}async understandAgentStep(t,e,s){const i=this.promptBuilder.buildAgentSystemPrompt(),n=[{role:"user",content:this.promptBuilder.buildAgentStepMessage(t,e,s)}];let r;try{r=await this.fetchClaude(i,n)}catch(a){throw a}try{return this.responseParser.parse(r,e.pageMap)}catch{return A.clarifyFallback("Samajh nahi aaya, kya aap dobara bol sakte hain?")}}async fetchClaude(t,e){const s=new AbortController,i=setTimeout(()=>s.abort(),8e3),o={"content-type":"application/json","x-api-key":this.apiKey,"anthropic-version":"2023-06-01"};this.anthropicBaseUrl===Q&&(o["anthropic-dangerous-allow-browser"]="true");try{const n=await fetch(`${this.anthropicBaseUrl}/v1/messages`,{method:"POST",headers:o,body:JSON.stringify({model:this.model,max_tokens:512,system:t,messages:e,stream:!0}),signal:s.signal});if(!n.ok){const r=await n.text().catch(()=>"");throw new g(f.API_ERROR,`Claude returned ${n.status}: ${r.slice(0,200)}`)}if(!n.body)throw new g(f.API_ERROR,"Claude streaming response has no body");return await _.consumeAnthropicStream(n.body)}catch(n){throw n.name==="AbortError"?new g(f.TIMEOUT,"Claude intent resolution timed out"):n}finally{clearTimeout(i)}}static async consumeAnthropicStream(t){var l;const e=t.getReader(),s=new TextDecoder;let i="",o="",n=0,r=!1,a=!1,c=!1;try{for(;;){const{done:d,value:m}=await e.read();if(d)break;i+=s.decode(m,{stream:!0});const v=i.split(`
`);i=v.pop()??"";for(const p of v){if(!p.startsWith("data: "))continue;const w=p.slice(6).trim();if(w==="[DONE]")return o.trim();let E;try{E=JSON.parse(w)}catch{continue}if(E.type!=="content_block_delta"||((l=E.delta)==null?void 0:l.type)!=="text_delta")continue;const x=E.delta.text;o+=x;for(const T of x){if(a){a=!1;continue}if(T==="\\"&&r){a=!0;continue}if(T==='"'){r=!r;continue}r||(T==="{"?(n++,c=!0):T==="}"&&n--)}if(c&&n===0)return e.releaseLock(),t.cancel().catch(()=>{}),o.trim()}}}finally{try{e.releaseLock()}catch{}}return o.trim()}async retryClaudeSimple(t,e){try{const s=await this.fetchClaude(e,[{role:"user",content:"Just return a clarify action."}]);return this.responseParser.parse(s,t.pageMap)}catch{return A.clarifyFallback()}}async fetchOpenAI(t,e,s,i){var c;const o=e.conversationHistory??[],n=[{role:"system",content:t},...o.map(l=>({role:l.role,content:l.content})),{role:"user",content:s}],r=new AbortController,a=setTimeout(()=>r.abort(),8e3);try{const l=await fetch(`${this.openaiBaseUrl}/v1/chat/completions`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${i}`},body:JSON.stringify({model:"gpt-4o",max_tokens:512,response_format:{type:"json_object"},messages:n}),signal:r.signal});if(!l.ok){const m=await l.text().catch(()=>"");throw new g(f.API_ERROR,`OpenAI returned ${l.status}: ${m.slice(0,200)}`)}return((c=(await l.json()).choices[0])==null?void 0:c.message.content)??""}catch(l){throw l.name==="AbortError"?new g(f.TIMEOUT,"OpenAI intent resolution timed out"):l}finally{clearTimeout(a)}}async retryOpenAISimple(t,e,s){try{const i=await this.fetchOpenAI(e,{...t,conversationHistory:[]},"Just return a clarify action.",s);return this.responseParser.parse(i,t.pageMap)}catch{return A.clarifyFallback()}}static buildMessages(t,e){return[...(t.conversationHistory??[]).map(i=>({role:i.role,content:i.content})),{role:"user",content:e}]}}class F{constructor(t,e,s,i){this.interactor=t,this.filler=e,this.networkObserver=s,this.watcher=i}async execute(t){var e,s,i,o;this.emit("voicelayer:action:start",{intent:t}),this.networkObserver.startCapture();try{let n;switch(t.action){case"navigate":t.target&&this.interactor.navigate(t.target);break;case"click":case"filter":t.target&&(this.interactor.scroll(t.target),this.interactor.click(t.target));break;case"focus":t.target&&(this.interactor.scroll(t.target),this.interactor.focus(t.target));break;case"fill_form":t.data&&this.filler.fill(t.data);break;case"click_and_wait_modal":t.target&&(this.interactor.scroll(t.target),n=await this.interactor.clickAndWaitForModal(t.target).catch(()=>{}));break;case"open_dropdown":t.target&&this.interactor.openDropdown(t.target);break;case"select_option":{const c=((e=t.data)==null?void 0:e.value)??((s=t.data)==null?void 0:s.text)??"";t.target&&c&&await this.interactor.selectFromDropdown(t.target,c).catch(()=>{t.target&&c&&this.interactor.selectOption(t.target,c)});break}case"submit_form":t.target&&(this.interactor.scroll(t.target),this.interactor.click(t.target));break;case"close_modal":this.interactor.closeModal();break;case"tab":t.target&&(this.interactor.scroll(t.target),this.interactor.clickTab(t.target));break;case"accordion":t.target&&(this.interactor.scroll(t.target),this.interactor.clickAccordion(t.target));break;case"scroll":t.target?this.interactor.scroll(t.target):(i=t.data)!=null&&i.direction&&this.interactor.scrollBy(t.data.direction,t.data.amount!==void 0?Number(t.data.amount):void 0);break;case"key":(o=t.data)!=null&&o.key&&this.interactor.keyPress(t.data.key,t.target??void 0);break;case"speak_only":case"clarify":break}n===void 0&&F.shouldObserve(t.action)&&(n=await this.watcher.waitForChange(["modal_opened","toast","dropdown_opened","content_added"],1500).catch(()=>{}));const r=this.networkObserver.stopCapture(),a={success:!0,intent:t,domChange:n,networkEvents:r.length>0?r:void 0};return this.emit("voicelayer:action:success",a),a}catch(n){this.networkObserver.stopCapture();const r={success:!1,intent:t,error:n instanceof Error?n:new Error(String(n))};return this.emit("voicelayer:action:error",r),r}}static shouldObserve(t){return t==="click"||t==="navigate"||t==="filter"||t==="focus"||t==="open_dropdown"||t==="select_option"||t==="submit_form"||t==="tab"||t==="accordion"}emit(t,e){try{window.dispatchEvent(new CustomEvent(t,{detail:e,bubbles:!1}))}catch{}}}class Z{constructor(t){this.watcher=t,this.navigateStrategy="history"}setNavigateStrategy(t){this.navigateStrategy=t}click(t,e){const s=this.findElementWithFallback(t,e);this.fireClick(s)}focus(t){this.require(t).focus({preventScroll:!0})}hover(t){const e=this.require(t);e.dispatchEvent(new MouseEvent("mouseover",{bubbles:!0,cancelable:!0,view:window})),e.dispatchEvent(new MouseEvent("mouseenter",{bubbles:!1,cancelable:!1,view:window}))}keyPress(t,e){const s=e?this.require(e):document.activeElement??document.documentElement,i={key:t,code:t,bubbles:!0,cancelable:!0};s.dispatchEvent(new KeyboardEvent("keydown",i)),s.dispatchEvent(new KeyboardEvent("keyup",i))}navigate(t){if(!t)return;if(t.startsWith("http://")||t.startsWith("https://")||t.startsWith("//")){window.location.href=t;return}if(t.startsWith("#")){const s=document.querySelector(`a[href="${CSS.escape(t).replace(/^\\#/,"#")}"]`)??document.querySelector(`a[href="${t}"]`);if(s){this.fireClick(s);return}window.location.hash=t.slice(1);return}if(this.navigateStrategy==="hash"){const s=t.startsWith("/")?t:`/${t}`;window.location.hash=s;return}try{history.pushState(null,"",t),window.dispatchEvent(new Event("voicelayer:routechange"))}catch{window.location.href=t}}scroll(t){var e;(e=document.querySelector(t))==null||e.scrollIntoView({behavior:"smooth",block:"center"})}scrollBy(t,e=300){const s=t==="right"?e:t==="left"?-e:0,i=t==="down"?e:t==="up"?-e:0;window.scrollBy({left:s,top:i,behavior:"smooth"})}fillInput(t,e,s){const i=this.findElementWithFallback(t,s);i.focus({preventScroll:!0}),this.setNativeValue(i,e),i.dispatchEvent(new Event("input",{bubbles:!0})),i.dispatchEvent(new Event("change",{bubbles:!0}))}selectOption(t,e){const s=this.require(t),i=e.toLowerCase();let o=!1;for(const n of Array.from(s.options)){const r=(n.textContent??n.text??"").trim().toLowerCase();if(n.value.toLowerCase()===i||r===i){s.value=n.value,o=!0;break}}o||console.warn(`[VoiceLayer] DOMInteractor: no option matching "${e}" in <select>`),s.dispatchEvent(new Event("change",{bubbles:!0}))}async fillSearchAndSelect(t,e,s){const i=this.watcher.waitForChange(["dropdown_opened"],2e3).catch(()=>null);if(this.fillInput(t,e),await i,s){const a=document.querySelector(s);if(a){this.fireClick(a);return}}const o=e.toLowerCase(),r=Array.from(document.querySelectorAll('[role="option"], [role="menuitem"]')).find(a=>(a.textContent??"").trim().toLowerCase().includes(o));r&&this.fireClick(r)}checkCheckbox(t,e=!0){const s=this.require(t);s.checked=e,s.dispatchEvent(new Event("change",{bubbles:!0}))}setDateInput(t,e){const s=this.require(t);this.setNativeValue(s,e),s.dispatchEvent(new Event("input",{bubbles:!0})),s.dispatchEvent(new Event("change",{bubbles:!0}))}openDropdown(t){this.click(t)}async selectFromDropdown(t,e){const s=this.watcher.waitForChange(["dropdown_opened"],1500);this.click(t);let i=null;try{const a=await s;i=document.querySelector(a.selector)}catch{i=document.querySelector('[role="listbox"]')??document.querySelector('[role="menu"]')??null}if(!i)throw new g(f.DROPDOWN_NOT_FOUND,`No dropdown appeared after clicking "${t}"`);const o=e.toLowerCase(),r=Array.from(i.querySelectorAll('[role="option"], [role="menuitem"], li, option')).find(a=>(a.textContent??"").trim().toLowerCase()===o);if(!r)throw new g(f.ELEMENT_NOT_FOUND,`No option matching "${e}" found in dropdown`);this.fireClick(r)}waitForModal(t=2e3){return this.watcher.waitForChange(["modal_opened"],t)}closeModal(){const t=document.activeElement??document.documentElement,e={key:"Escape",code:"Escape",keyCode:27,bubbles:!0,cancelable:!0};t.dispatchEvent(new KeyboardEvent("keydown",e)),t.dispatchEvent(new KeyboardEvent("keyup",e))}async clickAndWaitForModal(t,e=2e3){const s=this.watcher.waitForChange(["modal_opened"],e);return this.click(t),s}clickTab(t){const e=this.require(t);this.fireClick(e)}clickAccordion(t){const e=this.require(t);this.fireClick(e)}require(t){const e=document.querySelector(t);if(!e)throw new g(f.ELEMENT_NOT_FOUND,`VoiceLayer: element not found for selector "${t}"`);return e}findElementWithFallback(t,e){const s=document.querySelector(t);if(s)return s;const i=t.replace(/:nth-child\(\d+\)/g,"").trim();if(i&&i!==t){const o=document.querySelector(i);if(o)return o}if(e){const o=CSS.escape(e),n=document.querySelector(`[aria-label="${o}"]`);if(n)return n;const a=Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]')).find(l=>(l.textContent??"").trim()===e);if(a)return a;const c=document.querySelector(`[data-voice-label="${o}"]`);if(c)return c}throw new g(f.ELEMENT_NOT_FOUND,`VoiceLayer: element not found for selector "${t}"${e?` (label: "${e}")`:""}`)}fireClick(t){const e={bubbles:!0,cancelable:!0,view:window};t.dispatchEvent(new MouseEvent("mousedown",e)),t.dispatchEvent(new MouseEvent("mouseup",e)),t.dispatchEvent(new MouseEvent("click",e))}setNativeValue(t,e){var o;const s=t.tagName.toLowerCase()==="textarea"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,i=(o=Object.getOwnPropertyDescriptor(s,"value"))==null?void 0:o.set;i?i.call(t,e):t.value=e}}const C=class C{constructor(t){this.interactor=t}fill(t){for(const[e,s]of Object.entries(t)){const i=document.querySelector(e);if(!i){console.warn(`[VoiceLayer] FormFiller: no element found for "${e}"`);continue}this.fillElement(i,e,s),this.highlight(i)}}clearHighlights(){document.querySelectorAll(`[${C.FILLED_ATTR}]`).forEach(t=>{t.removeAttribute(C.FILLED_ATTR),t.style.outline="",t.style.outlineOffset=""})}fillElement(t,e,s){const i=t.tagName.toLowerCase(),o=(t.type??"").toLowerCase();if(i==="select"){this.interactor.selectOption(e,s);return}if(o==="checkbox"){const n=["true","yes","1","on","checked"].includes(s.toLowerCase());this.interactor.checkCheckbox(e,n);return}if(o==="radio"){this.interactor.checkCheckbox(e,!0);return}if(o==="date"||o==="datetime-local"||o==="time"||o==="month"||o==="week"){this.interactor.setDateInput(e,s);return}this.interactor.fillInput(e,s)}highlight(t){t.setAttribute(C.FILLED_ATTR,""),t.style.outline=C.HIGHLIGHT_STYLE,t.style.outlineOffset="2px"}};C.FILLED_ATTR="data-voicelayer-filled",C.HIGHLIGHT_STYLE="2px solid #6C47FF";let V=C;class tt{constructor(){this.log=[],this.capturing=!1,this.installed=!1}install(){this.installed||typeof window>"u"||(this.installed=!0,this.patchFetch(),this.patchXHR(),this.patchHistory(),this.listenPopstate())}startCapture(){this.log=[],this.capturing=!0}stopCapture(){return this.capturing=!1,[...this.log]}getFullLog(){return[...this.log]}uninstall(){this.installed&&(this.originalFetch&&(window.fetch=this.originalFetch),this.originalXHROpen&&(XMLHttpRequest.prototype.open=this.originalXHROpen),this.originalXHRSend&&(XMLHttpRequest.prototype.send=this.originalXHRSend),this.originalPushState&&(history.pushState=this.originalPushState),this.originalReplaceState&&(history.replaceState=this.originalReplaceState),this.popstateHandler&&window.removeEventListener("popstate",this.popstateHandler),this.installed=!1)}patchFetch(){this.originalFetch=window.fetch;const t=this,e=this.originalFetch;window.fetch=async function(s,i){const o=Date.now(),n=await e.call(window,s,i);try{if(t.capturing){const r=typeof s=="string"?s:s instanceof URL?s.href:s.url,a=((i==null?void 0:i.method)??"GET").toUpperCase(),c=n.status,l=Date.now()-o;(n.headers.get("content-type")??"").includes("json")?n.clone().text().then(m=>{t.log.push({type:"fetch",method:a,url:r,status:c,durationMs:l,timestamp:Date.now(),responsePreview:m.slice(0,200)})}).catch(()=>{t.log.push({type:"fetch",method:a,url:r,status:c,durationMs:l,timestamp:Date.now()})}):t.log.push({type:"fetch",method:a,url:r,status:c,durationMs:l,timestamp:Date.now()})}}catch{}return n}}patchXHR(){if(typeof XMLHttpRequest>"u")return;this.originalXHROpen=XMLHttpRequest.prototype.open,this.originalXHRSend=XMLHttpRequest.prototype.send;const t=this,e=this.originalXHROpen,s=this.originalXHRSend,i=new WeakMap;XMLHttpRequest.prototype.open=function(o,n,...r){return i.set(this,{method:o.toUpperCase(),url:n.toString(),startTime:0}),e.apply(this,[o,n,...r])},XMLHttpRequest.prototype.send=function(o){const n=i.get(this);return n&&(n.startTime=Date.now(),this.addEventListener("load",function(){try{if(!t.capturing)return;const a=(this.getResponseHeader("content-type")??"").includes("json")?this.responseText.slice(0,200):void 0;t.log.push({type:"xhr",method:n.method,url:n.url,status:this.status,durationMs:Date.now()-n.startTime,timestamp:Date.now(),responsePreview:a||void 0})}catch{}})),s.apply(this,[o])}}patchHistory(){const t=this;this.originalPushState=history.pushState,history.pushState=function(...e){var s;t.originalPushState.apply(history,e);try{t.capturing&&t.log.push({type:"navigate",method:"PUSH",url:((s=e[2]??window.location.pathname)==null?void 0:s.toString())??"",timestamp:Date.now()})}catch{}},this.originalReplaceState=history.replaceState,history.replaceState=function(...e){var s;t.originalReplaceState.apply(history,e);try{t.capturing&&t.log.push({type:"navigate",method:"REPLACE",url:((s=e[2]??window.location.pathname)==null?void 0:s.toString())??"",timestamp:Date.now()})}catch{}}}listenPopstate(){const t=this;this.popstateHandler=()=>{try{t.capturing&&t.log.push({type:"navigate",method:"POPSTATE",url:window.location.pathname+window.location.search,timestamp:Date.now()})}catch{}},window.addEventListener("popstate",this.popstateHandler)}}const Pt=/\b(modal|dialog|overlay|backdrop|drawer|sheet|popup)\b/i,$t=/\b(toast|snackbar|notification|alert)\b/i,Dt=/\b(dropdown|popover|menu|options)\b/i;function j(h){const t=h.className;return typeof t=="string"?t:""}function W(h){const t=h.tagName.toLowerCase(),e=h.getAttribute("role")??"";return t==="dialog"||e==="dialog"||e==="alertdialog"||Pt.test(j(h))}function Ht(h){const t=h.getAttribute("role")??"";return t==="alert"||t==="status"||$t.test(j(h))}function et(h){const t=h.getAttribute("role")??"";return t==="listbox"||t==="menu"||Dt.test(j(h))}function Ut(h){return W(h)?"modal_opened":Ht(h)?"toast":et(h)?"dropdown_opened":"content_added"}function Bt(h){return W(h)?"modal_closed":"content_removed"}function I(h){const t=h.getAttribute("id");if(t)return`#${t}`;const e=h.getAttribute("role");if(e)return`[role="${e}"]`;const s=j(h).trim().split(/\s+/)[0],i=h.tagName.toLowerCase();return s?`${i}.${s}`:i}class st{constructor(){this.observer=null,this.listeners=[],this.installed=!1}install(){this.installed||typeof document>"u"||(this.installed=!0,this.observer=new MutationObserver(t=>{for(const e of t)this.handleMutation(e)}),this.observer.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["aria-hidden","open","class","style"]}))}onChange(t){return this.listeners.push(t),()=>{this.listeners=this.listeners.filter(e=>e!==t)}}waitForChange(t,e=2e3){return new Promise((s,i)=>{let o=!1;const n=setTimeout(()=>{o||(o=!0,r(),i(new Error(`waitForChange timed out after ${e}ms (waiting for: ${t.join(", ")})`)))},e),r=this.onChange(a=>{!o&&t.includes(a.type)&&(o=!0,clearTimeout(n),r(),s(a))})})}uninstall(){var t;(t=this.observer)==null||t.disconnect(),this.observer=null,this.installed=!1}handleMutation(t){if(t.type==="childList"){for(const e of Array.from(t.addedNodes)){if(e.nodeType!==Node.ELEMENT_NODE)continue;const s=e;this.emit({type:Ut(s),selector:I(s),textContent:(s.textContent??"").trim().slice(0,120),timestamp:Date.now()})}for(const e of Array.from(t.removedNodes)){if(e.nodeType!==Node.ELEMENT_NODE)continue;const s=e;this.emit({type:Bt(s),selector:I(s),textContent:(s.textContent??"").trim().slice(0,120),timestamp:Date.now()})}return}if(t.type==="attributes"){const e=t.target,s=t.attributeName??"";if(s==="aria-hidden"){const i=e.getAttribute("aria-hidden");i==="false"?this.emit({type:"modal_opened",selector:I(e),textContent:(e.textContent??"").trim().slice(0,120),timestamp:Date.now()}):i==="true"&&this.emit({type:"modal_closed",selector:I(e),textContent:"",timestamp:Date.now()});return}if(s==="open"){const o=e.hasAttribute("open")?et(e)?"dropdown_opened":"modal_opened":"modal_closed";this.emit({type:o,selector:I(e),textContent:(e.textContent??"").trim().slice(0,120),timestamp:Date.now()});return}if((s==="class"||s==="style")&&W(e)){const i=!e.hasAttribute("hidden")&&e.getAttribute("aria-hidden")!=="true";this.emit({type:i?"modal_opened":"modal_closed",selector:I(e),textContent:(e.textContent??"").trim().slice(0,120),timestamp:Date.now()})}}}emit(t){for(const e of this.listeners)try{e(t)}catch{}}}class it{constructor(t,e){this.ttsPlayer=t,this.config=e,this.host=null,this.shadow=null,this.indicator=null,this.domUnsub=null,this.debounceTimer=null,this.pendingEvent=null,this.hideTimer=null}install(t){return this.mountIndicator(),this.domUnsub=t.onChange(s=>{(s.type==="toast"&&this.config.announceToasts||(s.type==="modal_opened"||s.type==="modal_closed")&&this.config.announceModals)&&(this.pendingEvent=s,this.debounceTimer!==null&&clearTimeout(this.debounceTimer),this.debounceTimer=setTimeout(()=>{this.debounceTimer=null,this.pendingEvent&&(this.processEvent(this.pendingEvent),this.pendingEvent=null)},300))}),()=>this.uninstall()}silence(){this.ttsPlayer.stop().catch(()=>{}),this.hideIndicatorNow(),this.debounceTimer!==null&&(clearTimeout(this.debounceTimer),this.debounceTimer=null),this.pendingEvent=null}uninstall(){var t;this.silence(),this.domUnsub&&(this.domUnsub(),this.domUnsub=null),this.hideTimer!==null&&(clearTimeout(this.hideTimer),this.hideTimer=null),(t=this.host)==null||t.remove(),this.host=null,this.shadow=null,this.indicator=null}mountIndicator(){this.host||(this.host=document.createElement("div"),this.host.id="voicelayer-announcer-host",this.shadow=this.host.attachShadow({mode:"open"}),this.shadow.innerHTML=`
      <style>
        :host { all: initial; }
        .vl-toast-reader {
          position: fixed;
          top: 20px;
          right: 24px;
          z-index: 100000;
          background: rgba(15, 15, 15, 0.88);
          color: #fff;
          border-radius: 10px;
          padding: 10px 16px;
          font-size: 13px;
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 320px;
          opacity: 0;
          transform: translateY(-8px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          pointer-events: none;
          line-height: 1.45;
        }
        .vl-toast-reader--visible {
          opacity: 1;
          transform: translateY(0);
        }
      </style>
      <div class="vl-toast-reader" role="status" aria-live="polite"></div>
    `,this.indicator=this.shadow.querySelector(".vl-toast-reader"),document.body.appendChild(this.host))}processEvent(t){let e,s;if(t.type==="toast"){const i=t.textContent.trim().split(/\s+/);e=i.slice(0,15).join(" ")+(i.length>15?"…":""),s=`🔔 ${e}`}else t.type==="modal_opened"?(e="A dialog has appeared. Use voice to interact with it.",s="🗂️ Dialog opened"):(e="Dialog closed.",s="✅ Dialog closed");this.showIndicator(s),this.ttsPlayer.speak(e).catch(()=>{})}showIndicator(t){this.indicator&&(this.hideTimer!==null&&(clearTimeout(this.hideTimer),this.hideTimer=null),this.indicator.textContent=t,this.indicator.classList.add("vl-toast-reader--visible"),this.hideTimer=setTimeout(()=>{this.hideIndicatorNow(),this.hideTimer=null},3e3))}hideIndicatorNow(){var t;(t=this.indicator)==null||t.classList.remove("vl-toast-reader--visible")}}const ot={idle:`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>`,listening:`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <rect x="10" y="3" width="4" height="12" rx="2"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>`,processing:`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
    <circle cx="12" cy="12" r="9" stroke-dasharray="28 8" stroke-linecap="round"/>
  </svg>`,speaking:`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
    <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
  </svg>`,error:`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
  </svg>`};class H{constructor(t={}){this.uiConfig=t,this.button=null,this.badge=null,this.currentState="idle",this.hotkeyHandler=null,this.host=document.createElement("div"),this.host.id="voicelayer-talk-host",this.shadow=this.host.attachShadow({mode:"open"}),this.render(),document.body.appendChild(this.host),this.bindHotkey()}setState(t){if(this.currentState!==t&&(this.currentState=t,this.button)){this.button.setAttribute("data-state",t);const e=this.badge?this.badge.outerHTML:"";this.button.innerHTML=ot[t]+e,this.badge=this.shadow.querySelector(".vl-badge"),this.button.setAttribute("aria-label",H.ariaLabel(t))}}showContextBadge(t){this.badge&&(this.badge.textContent=t,this.badge.hidden=!1)}hideContextBadge(){this.badge&&(this.badge.hidden=!0)}setAriaLabel(t){var e;(e=this.button)==null||e.setAttribute("aria-label",t)}destroy(){this.unbindHotkey(),this.host.remove()}render(){var s,i;const t=this.uiConfig.position??"bottom-right",e=((s=this.uiConfig.theme)==null?void 0:s.primary)??"#6C47FF";this.shadow.innerHTML=`
      <style>
        :host { all: initial; }

        .vl-btn {
          position: fixed;
          ${H.positionCSS(t)}
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: ${e};
          border: none;
          cursor: pointer;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 24px rgba(108,71,255,0.4);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          outline: none;
        }

        .vl-btn:hover { transform: scale(1.08); }

        .vl-btn[data-state="listening"] {
          background: #E53935;
          animation: vl-pulse 1.2s ease-in-out infinite;
        }

        .vl-btn[data-state="processing"] {
          animation: vl-spin 0.8s linear infinite;
        }

        .vl-btn[data-state="speaking"] { background: #00B899; }

        .vl-btn[data-state="error"] { background: #FF6B35; }

        @keyframes vl-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(229,57,53,.5); }
          50%       { box-shadow: 0 0 0 14px rgba(229,57,53,0); }
        }

        @keyframes vl-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .vl-badge {
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
          background: #FF6B35;
          color: white;
          pointer-events: none;
          font-weight: 600;
          line-height: 1.3;
          font-family: system-ui, -apple-system, sans-serif;
        }
      </style>
      <button
        class="vl-btn"
        data-state="idle"
        aria-label="VoiceLayer: tap to speak"
        type="button"
      >${ot.idle}<span class="vl-badge" hidden></span></button>
    `,this.button=this.shadow.querySelector(".vl-btn"),this.badge=this.shadow.querySelector(".vl-badge"),(i=this.button)==null||i.addEventListener("click",()=>this.dispatch())}bindHotkey(){const e=(this.uiConfig.hotkey??"Alt+KeyV").split("+"),s=e[e.length-1],i=e.includes("Alt"),o=e.includes("Control")||e.includes("Ctrl"),n=e.includes("Meta")||e.includes("Command");this.hotkeyHandler=r=>{(r.code===s||r.key===s)&&(!i||r.altKey)&&(!o||r.ctrlKey)&&(!n||r.metaKey)&&(r.preventDefault(),this.dispatch())},document.addEventListener("keydown",this.hotkeyHandler)}unbindHotkey(){this.hotkeyHandler&&(document.removeEventListener("keydown",this.hotkeyHandler),this.hotkeyHandler=null)}dispatch(){window.dispatchEvent(new CustomEvent("voicelayer:tap",{detail:{state:this.currentState},bubbles:!1}))}static positionCSS(t){const e={"bottom-right":"bottom: 24px; right: 24px;","bottom-left":"bottom: 24px; left: 24px;","top-right":"top: 24px; right: 24px;","top-left":"top: 24px; left: 24px;"};return e[t]??e["bottom-right"]}static ariaLabel(t){return{idle:"VoiceLayer: tap to speak",listening:"VoiceLayer: listening...",processing:"VoiceLayer: processing your command",speaking:"VoiceLayer: speaking",error:"VoiceLayer: error — tap to retry"}[t]}}class K{constructor(t={},e=!1){this.panel=null,this.transcriptEl=null,this.responseEl=null,this.modalHintEl=null,this.networkHintEl=null,this.dismissTimer=null,this.escHandler=null,this.outsideHandler=null,this.debug=e,this.host=document.createElement("div"),this.host.id="voicelayer-overlay-host",this.shadow=this.host.attachShadow({mode:"open"}),this.render(t),document.body.appendChild(this.host),this.bindDismiss()}show(t,e=""){this.panel&&(this.panel.hidden=!1),this.transcriptEl&&(this.transcriptEl.textContent=t),this.responseEl&&(this.responseEl.textContent=e),this.clearHints(),this.cancelDismissTimer()}setTranscript(t){this.showPanel(),this.transcriptEl&&(this.transcriptEl.textContent=`"${t}"`),this.responseEl&&(this.responseEl.textContent=""),this.clearHints(),this.cancelDismissTimer()}setResponse(t,e=4e3){this.showPanel(),this.responseEl&&(this.responseEl.textContent=t),this.scheduleDismiss(e)}showModalContext(t){if(!this.modalHintEl)return;const e=t.length>80?t.slice(0,77)+"…":t;this.modalHintEl.textContent=`📋 Modal context: ${e}`,this.modalHintEl.hidden=!1}showActionResult(t){if(!this.debug||!this.networkHintEl||t.length===0)return;const e=t.slice(0,3).map(s=>{const i=s.status!=null?` → ${s.status}`:"",o=s.durationMs!=null?` (${s.durationMs}ms)`:"";return`${s.method} ${s.url}${i}${o}`});this.networkHintEl.textContent=e.join(`
`),this.networkHintEl.hidden=!1}hide(){this.cancelDismissTimer(),this.clearHints(),this.panel&&(this.panel.hidden=!0)}destroy(){this.hide(),this.cancelDismissTimer(),this.escHandler&&document.removeEventListener("keydown",this.escHandler),this.outsideHandler&&document.removeEventListener("click",this.outsideHandler,!0),this.host.remove()}showPanel(){this.panel&&(this.panel.hidden=!1)}clearHints(){this.modalHintEl&&(this.modalHintEl.hidden=!0,this.modalHintEl.textContent=""),this.networkHintEl&&(this.networkHintEl.hidden=!0,this.networkHintEl.textContent="")}scheduleDismiss(t){this.cancelDismissTimer(),this.dismissTimer=setTimeout(()=>this.hide(),t)}cancelDismissTimer(){this.dismissTimer!==null&&(clearTimeout(this.dismissTimer),this.dismissTimer=null)}render(t){var n,r,a;const e=((n=t.theme)==null?void 0:n.background)??"#1A1A2E",s=((r=t.theme)==null?void 0:r.text)??"#F0F0F0",i=((a=t.theme)==null?void 0:a.primary)??"#6C47FF",o=t.position??"bottom-right";this.shadow.innerHTML=`
      <style>
        :host { all: initial; font-family: system-ui, -apple-system, sans-serif; }

        .vl-panel {
          position: fixed;
          ${K.positionCSS(o)}
          width: 340px;
          max-width: calc(100vw - 48px);
          background: ${e};
          color: ${s};
          border-radius: 12px;
          padding: 16px 20px;
          z-index: 2147483646;
          box-shadow: 0 8px 48px rgba(0,0,0,0.5);
          animation: vl-in 0.2s ease;
          border: 1px solid rgba(255,255,255,0.08);
        }

        .vl-panel[hidden] { display: none; }

        .vl-transcript {
          font-size: 12px;
          opacity: 0.55;
          margin-bottom: 8px;
          font-style: italic;
          line-height: 1.4;
          min-height: 0;
        }

        .vl-response {
          font-size: 15px;
          line-height: 1.55;
          font-weight: 500;
        }

        .vl-accent {
          display: block;
          width: 28px;
          height: 3px;
          background: ${i};
          border-radius: 2px;
          margin-bottom: 10px;
        }

        .vl-modal-hint {
          margin-top: 10px;
          padding: 8px 10px;
          background: rgba(108, 71, 255, 0.15);
          border-left: 2px solid ${i};
          border-radius: 0 6px 6px 0;
          font-size: 12px;
          line-height: 1.4;
          color: rgba(240, 240, 240, 0.85);
        }
        .vl-modal-hint[hidden] { display: none; }

        .vl-network-hint {
          margin-top: 8px;
          font-size: 11px;
          color: rgba(240, 240, 240, 0.45);
          font-family: monospace;
          white-space: pre-line;
          line-height: 1.5;
        }
        .vl-network-hint[hidden] { display: none; }

        @keyframes vl-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      </style>
      <div class="vl-panel" role="status" aria-live="polite" hidden>
        <span class="vl-accent"></span>
        <div class="vl-transcript"></div>
        <div class="vl-response"></div>
        <div class="vl-modal-hint" hidden></div>
        <div class="vl-network-hint" hidden></div>
      </div>
    `,this.panel=this.shadow.querySelector(".vl-panel"),this.transcriptEl=this.shadow.querySelector(".vl-transcript"),this.responseEl=this.shadow.querySelector(".vl-response"),this.modalHintEl=this.shadow.querySelector(".vl-modal-hint"),this.networkHintEl=this.shadow.querySelector(".vl-network-hint")}bindDismiss(){this.escHandler=t=>{t.key==="Escape"&&this.panel&&!this.panel.hidden&&this.hide()},document.addEventListener("keydown",this.escHandler),this.outsideHandler=t=>{this.panel&&!this.panel.hidden&&!this.host.contains(t.target)&&this.hide()},document.addEventListener("click",this.outsideHandler,!0)}static positionCSS(t){const e={"bottom-right":"bottom: 100px; right: 24px;","bottom-left":"bottom: 100px; left: 24px;","top-right":"top: 100px; right: 24px;","top-left":"top: 100px; left: 24px;"};return e[t]??e["bottom-right"]}}class nt{detect(){return{framework:this.detectFramework(),routerType:this.detectRouterType(),hasSSR:this.detectSSR(),language:this.detectLanguage()}}suggestConfig(t){const e={};return t.language==="hi"&&(e.language="hi"),t.framework==="next"&&(e.rescanOnMutation=!0),e}detectFramework(){if(typeof window>"u")return"unknown";const t=window;if(t.__NEXT_DATA__)return"next";if(t.__REACT_DEVTOOLS_GLOBAL_HOOK__||document.querySelector("[data-reactroot]")||t.React)return"react";const e=document.querySelector("#app");return t.__VUE__||e!=null&&e.__vue__||e!=null&&e.__vue_app__?"vue":t.ng||document.querySelector("[ng-version]")?"angular":"vanilla"}detectRouterType(){if(typeof window>"u")return"unknown";const t=window;if(t.__NEXT_DATA__)return"next-router";if(window.location.hash.startsWith("#/"))return"hash";const e=document.querySelector("#app");return t.__VUE__||e!=null&&e.__vue__||e!=null&&e.__vue_app__?"vue-router":t.__REACT_DEVTOOLS_GLOBAL_HOOK__||t.React?"react-router":"history"}detectSSR(){if(typeof window>"u")return!0;const t=window;return!!(t.__NEXT_DATA__||t.__NUXT__)}detectLanguage(){var e;if(typeof document>"u")return"unknown";const t=((e=document.documentElement.lang)==null?void 0:e.toLowerCase())??"";if(t==="hi"||t.startsWith("hi-"))return"hi";try{const s=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let i=0,o=0,n=0,r;for(;(r=s.nextNode())!==null&&n<10;){const c=(r.textContent??"").trim();if(!(c.length<2)){n++;for(const l of c){const d=l.codePointAt(0)??0;i++,d>=2304&&d<=2431&&o++}}}if(i===0)return"unknown";const a=o/i;return a>.3?"hi":a>.05?"mixed":"en"}catch{return"unknown"}}}class rt{constructor(t=10){this.maxTurns=t,this.history=[]}buildRequest(t,e,s){return{transcribedText:t,pageMap:e,conversationHistory:this.history.length>0?[...this.history]:void 0,networkContext:s&&s.length>0?s:void 0}}addTurn(t,e){this.history.push({role:"user",content:t}),this.history.push({role:"assistant",content:e}),this.history.length>this.maxTurns*2&&(this.history=this.history.slice(-this.maxTurns*2))}reset(){this.history=[]}get turnCount(){return Math.floor(this.history.length/2)}getHistory(){return[...this.history]}}const Ft="vl_events_",Vt=1e3,jt=5e4,Kt=30*24*60*60*1e3;class qt{constructor(t){this.appId=t,this.buffer=[],this.storageKey=`${Ft}${t}`}push(t){this.buffer.push(t),this.buffer.length>Vt&&this.buffer.shift()}persist(){try{const t=this._load(),e=new Set(this.buffer.map(n=>n.id)),s=[...t.filter(n=>!e.has(n.id)),...this.buffer],i=Date.now()-Kt,o=s.filter(n=>n.ts>i).slice(-jt);localStorage.setItem(this.storageKey,JSON.stringify(o))}catch{}}getAllEvents(){const t=this._load(),e=new Set(this.buffer.map(i=>i.id));return[...t.filter(i=>!e.has(i.id)),...this.buffer].sort((i,o)=>i.ts-o.ts)}flush(){return[...this.buffer]}clear(){this.buffer=[];try{localStorage.removeItem(this.storageKey)}catch{}}_load(){try{const t=localStorage.getItem(this.storageKey);return t?JSON.parse(t):[]}catch{return[]}}}const zt=1e-4,at=.003,Wt=3e-4,Xt=45;class ct{compute(t,e){const s=Date.now(),i=t.filter(b=>b.type==="command"),o=t.filter(b=>b.type==="error"),n=new Set(t.map(b=>b.sessionId)).size,r=this._commandStats(i),a=this._timeSeries(i),c=this._topCommands(i),l=this._topFailures(i,o),d=i.filter(b=>b.source==="ai").length,m=i.filter(b=>b.source==="learned"||b.source==="local_extract").length,v=i.length?i.reduce((b,R)=>b+(R.totalMs??0),0)/i.length:0,p=i.reduce((b,R)=>b+(R.whisperMs??2e3)/1e3*zt,0),w=d*at,E=i.filter(b=>b.success).length*Xt*Wt,x=p+w+E,T=m*at;return{computed:s,period:{from:t.length?Math.min(...t.map(b=>b.ts)):s,to:s},totalCommands:i.length,successRate:r.successRate,avgLatencyMs:Math.round(v),learnedRatio:i.length?m/i.length:0,estimatedCostUSD:x,stats:r,timeSeries:a,topCommands:c,topFailures:l,learningStore:{totalMappings:(e==null?void 0:e.total)??0,confidentMappings:(e==null?void 0:e.confident)??0,commandsSavedFromAI:m,estimatedCostSaved:T},sessions:{total:n,avgCommandsPerSession:n?i.length/n:0}}}_commandStats(t){const e=t.length,s=t.filter(d=>d.success).length,i={ai:0,learned:0,local_extract:0},o={hi:0,en:0,mixed:0,unknown:0},n={},r={};let a=0,c=0,l=0;for(const d of t){d.source&&d.source in i&&i[d.source]++,d.lang&&d.lang in o&&o[d.lang]++,d.action&&(n[d.action]=(n[d.action]??0)+1);const m=d.route??"unknown";r[m]||(r[m]={total:0,success:0}),r[m].total++,d.success&&r[m].success++,a+=d.totalMs??0,c+=d.whisperMs??0,l+=d.aiMs??0}return{total:e,successRate:e?s/e:0,avgTotalMs:e?Math.round(a/e):0,avgWhisperMs:e?Math.round(c/e):0,avgAiMs:e?Math.round(l/e):0,bySource:i,byLang:o,byAction:n,byRoute:r}}_timeSeries(t){const e=Date.now()-6048e5,s=t.filter(n=>n.ts>e),i=60*60*1e3,o=new Map;for(const n of s){const r=Math.floor(n.ts/i)*i;o.has(r)||o.set(r,[]),o.get(r).push(n)}return Array.from(o.entries()).sort(([n],[r])=>n-r).map(([n,r])=>({ts:n,commands:r.length,successRate:r.length?r.filter(a=>a.success).length/r.length:0,avgMs:r.length?r.reduce((a,c)=>a+(c.totalMs??0),0)/r.length:0,aiCalls:r.filter(a=>a.source==="ai").length,learnedCalls:r.filter(a=>a.source==="learned"||a.source==="local_extract").length}))}_topCommands(t){const e=new Map;for(const s of t){const i=`${s.route??"unknown"}::${s.action??"unknown"}`;e.has(i)||e.set(i,{total:0,success:0});const o=e.get(i);o.total++,s.success&&o.success++}return Array.from(e.entries()).map(([s,i])=>{const[o,n]=s.split("::");return{route:o,action:n,count:i.total,successRate:i.total?i.success/i.total:0}}).sort((s,i)=>i.count-s.count).slice(0,10)}_topFailures(t,e){const s=new Map;for(const i of[...t.filter(o=>!o.success),...e]){const o=`${i.route??"unknown"}::${i.errorCode??"exec_failed"}`;s.set(o,(s.get(o)??0)+1)}return Array.from(s.entries()).map(([i,o])=>{const[n,r]=i.split("::");return{route:n,errorCode:r,count:o}}).sort((i,o)=>o.count-i.count).slice(0,10)}}let Gt=null;function Jt(){return Gt??(Gt=Math.random().toString(36).slice(2)+Date.now().toString(36))}function X(h){return h.replace(/\/\d+/g,"/:id").replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi,"/:uuid").replace(/\/[a-z0-9]{24,}/gi,"/:id")}class lt{constructor(t){this.config=t,this.pending=[],this.timer=null,this.queue=new qt(t.appId),this.computer=new ct}install(){if(!this.config.enabled)return;this._track({type:"session_start"});const t=this.config.flushIntervalMs??6e4;this.timer=window.setInterval(()=>this._flush(),t),window.addEventListener("beforeunload",()=>{this._flush(),this.config.endpoint&&this.pending.length&&(this._beacon(this.pending),this.pending=[])})}uninstall(){this.timer&&clearInterval(this.timer),this._flush()}trackCommand(t){this._track({type:"command",action:t.action,route:X(t.route),success:t.success,source:t.source,lang:t.lang,whisperMs:t.whisperMs,aiMs:t.aiMs,execMs:t.execMs,totalMs:t.totalMs})}trackPlan(t){this._track({type:"plan",route:X(t.route),planSteps:t.steps,planStepsCompleted:t.stepsCompleted,totalMs:t.totalMs,success:t.stepsCompleted===t.steps})}trackError(t){this._track({type:"error",route:X(t.route),errorCode:t.errorCode})}getInsights(t){return this.computer.compute(this.queue.getAllEvents(),t)}exportJSON(){return JSON.stringify(this.queue.getAllEvents(),null,2)}exportCSV(){const t=this.queue.getAllEvents(),e=["id","ts","type","action","route","success","source","lang","whisperMs","aiMs","execMs","totalMs","errorCode"],s=t.map(i=>e.map(o=>{const n=i[o];return n===void 0?"":String(n)}).join(","));return[e.join(","),...s].join(`
`)}_track(t){const e={id:Math.random().toString(36).slice(2)+Date.now().toString(36),appId:this.config.appId,sessionId:Jt(),ts:Date.now(),sdkVersion:this.config.sdkVersion??"0.2.0",...t};this.queue.push(e),this.config.endpoint&&this.pending.push(e)}_flush(){this.queue.persist(),this.config.endpoint&&this.pending.length&&(this._beacon([...this.pending]),this.pending=[])}_beacon(t){if(this.config.endpoint)try{const e=JSON.stringify({events:t});navigator.sendBeacon(this.config.endpoint,new Blob([e],{type:"application/json"}))||this.pending.unshift(...t)}catch{}}}class dt{constructor(t){this.getInsights=t,this.overlay=null,this.shortcutHandler=null}installShortcut(){this.shortcutHandler=t=>{t.ctrlKey&&t.shiftKey&&t.key==="V"&&(t.preventDefault(),this.isOpen()?this.close():this.open())},window.addEventListener("keydown",this.shortcutHandler)}open(){if(this.isOpen())return;const t=this.getInsights();this.overlay=document.createElement("div"),this.overlay.id="voicelayer-dashboard-overlay",Object.assign(this.overlay.style,{position:"fixed",inset:"0",zIndex:"2147483647",background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui, sans-serif"});const e=document.createElement("iframe");Object.assign(e.style,{width:"92vw",maxWidth:"1100px",height:"88vh",border:"none",borderRadius:"16px",boxShadow:"0 32px 80px rgba(0,0,0,0.5)"}),e.srcdoc=Yt,e.setAttribute("sandbox","allow-scripts"),e.onload=()=>{var s;(s=e.contentWindow)==null||s.postMessage({type:"vl-insights",data:t},"*")},this.overlay.addEventListener("click",s=>{s.target===this.overlay&&this.close()}),this.overlay.appendChild(e),document.body.appendChild(this.overlay)}close(){var t;(t=this.overlay)==null||t.remove(),this.overlay=null}isOpen(){return this.overlay!==null}uninstall(){this.close(),this.shortcutHandler&&window.removeEventListener("keydown",this.shortcutHandler)}}const Yt=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VoiceLayer Insights</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0f1117;
    --surface:  #1a1d27;
    --border:   #2a2d3a;
    --text:     #e8eaf0;
    --muted:    #7b7f93;
    --accent:   #6c63ff;
    --green:    #22c55e;
    --red:      #ef4444;
    --orange:   #f97316;
    --blue:     #3b82f6;
  }

  html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; font-size: 13px; }

  /* ── Layout ── */
  #app { display: flex; flex-direction: column; height: 100vh; }

  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 22px; border-bottom: 1px solid var(--border);
    background: var(--surface); flex-shrink: 0;
  }
  .logo { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
  .logo span { color: var(--accent); }
  .header-right { display: flex; gap: 10px; align-items: center; }
  .pill-badge { font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 10px; }
  .live { background: rgba(34,197,94,.15); color: var(--green); }
  .ts  { color: var(--muted); font-size: 11px; }
  .btn {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 600;
    cursor: pointer; transition: border-color .15s;
  }
  .btn:hover { border-color: var(--accent); }
  .btn-accent { background: var(--accent); border-color: var(--accent); color: #fff; }

  main { flex: 1; overflow-y: auto; padding: 18px 22px; }

  /* ── KPI row ── */
  .kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px; }
  .kpi {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 16px;
  }
  .kpi-label { font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); margin-bottom: 6px; }
  .kpi-value { font-size: 26px; font-weight: 700; letter-spacing: -.03em; line-height: 1; }
  .kpi-sub   { font-size: 10px; color: var(--muted); margin-top: 4px; }
  .kpi-green .kpi-value { color: var(--green); }
  .kpi-blue  .kpi-value { color: var(--blue);  }
  .kpi-orange.kpi-value { color: var(--orange); }

  /* ── Charts ── */
  .charts-row { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 18px; }
  .charts-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 18px; }

  .chart-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px;
  }
  .chart-title { font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); margin-bottom: 12px; }
  .chart-wrap { position: relative; }

  /* ── Tables ── */
  .tables-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
    color: var(--muted); padding: 6px 10px; text-align: left;
    border-bottom: 1px solid var(--border); }
  td { padding: 7px 10px; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,.04); }
  tr:last-child td { border-bottom: none; }
  .route { font-family: monospace; font-size: 11px; color: var(--blue); }
  .success-bar { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; width: 60px; }
  .success-fill { height: 100%; border-radius: 2px; }

  /* ── Latency breakdown ── */
  .latency-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-bottom: 18px; }
  .lat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 12px 14px; text-align: center;
  }
  .lat-label { font-size: 10px; color: var(--muted); text-transform: uppercase;
    letter-spacing: .05em; margin-bottom: 4px; }
  .lat-value { font-size: 22px; font-weight: 700; }
  .lat-sub   { font-size: 10px; color: var(--muted); }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .empty { color: var(--muted); font-size: 12px; padding: 12px 0; text-align: center; }

  .section-sep { border: none; border-top: 1px solid var(--border); margin: 0 0 18px 0; }
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="logo">Voice<span>Layer</span> Insights</div>
    <div class="header-right">
      <span class="pill-badge live">● LIVE</span>
      <span class="ts" id="computed-ts">—</span>
      <button class="btn" onclick="exportCSV()">Export CSV</button>
      <button class="btn" onclick="exportJSON()">Export JSON</button>
    </div>
  </header>

  <main id="main">
    <div class="empty" id="loading">Waiting for data…</div>
  </main>
</div>

<script>
let _insights = null

window.addEventListener('message', (e) => {
  if (e.data?.type === 'vl-insights') {
    _insights = e.data.data
    render(_insights)
  }
})

function fmt(n, decimals = 0) {
  if (n === undefined || n === null) return '—'
  return Number(n).toFixed(decimals)
}
function pct(n) { return (n * 100).toFixed(1) + '%' }
function ms(n)  { return n < 1000 ? n + 'ms' : (n/1000).toFixed(1) + 's' }
function usd(n) { return '$' + n.toFixed(4) }
function tsLabel(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function render(d) {
  document.getElementById('loading')?.remove()
  document.getElementById('computed-ts').textContent =
    'Updated ' + new Date(d.computed).toLocaleTimeString()

  const main = document.getElementById('main')
  main.innerHTML = ''

  // ── KPI row ──
  const learnedPct = pct(d.learnedRatio)
  main.insertAdjacentHTML('beforeend', \`
    <div class="kpi-row">
      <div class="kpi">
        <div class="kpi-label">Total Commands</div>
        <div class="kpi-value">\${d.totalCommands}</div>
        <div class="kpi-sub">\${d.sessions.total} sessions · \${fmt(d.sessions.avgCommandsPerSession,1)} avg/session</div>
      </div>
      <div class="kpi kpi-green">
        <div class="kpi-label">Success Rate</div>
        <div class="kpi-value">\${pct(d.successRate)}</div>
        <div class="kpi-sub">of commands executed</div>
      </div>
      <div class="kpi kpi-blue">
        <div class="kpi-label">Avg Latency</div>
        <div class="kpi-value">\${ms(d.avgLatencyMs)}</div>
        <div class="kpi-sub">voice-to-action total</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">AI-Free Rate</div>
        <div class="kpi-value" style="color:var(--accent)">\${learnedPct}</div>
        <div class="kpi-sub">\${d.learningStore.commandsSavedFromAI} commands skipped AI</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Est. Cost</div>
        <div class="kpi-value" style="color:var(--orange)">\${usd(d.estimatedCostUSD)}</div>
        <div class="kpi-sub">\${usd(d.learningStore.estimatedCostSaved)} saved by learning</div>
      </div>
    </div>
  \`)

  // ── Volume + Source ──
  const tsData = d.timeSeries.slice(-48)   // last 48 hours
  main.insertAdjacentHTML('beforeend', '<div class="charts-row"><div class="chart-card" id="vol-card"><div class="chart-title">Command Volume (48h)</div><div class="chart-wrap"><canvas id="vol-chart" height="130"></canvas></div></div><div class="chart-card" id="src-card"><div class="chart-title">Resolution Source</div><div class="chart-wrap"><canvas id="src-chart" height="130"></canvas></div></div></div>')

  new Chart(document.getElementById('vol-chart'), {
    type: 'bar',
    data: {
      labels: tsData.map(p => tsLabel(p.ts)),
      datasets: [
        { label: 'AI', data: tsData.map(p => p.aiCalls), backgroundColor: '#6c63ff', stack: 'a' },
        { label: 'Learned', data: tsData.map(p => p.learnedCalls), backgroundColor: '#22c55e', stack: 'a' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#7b7f93', boxWidth: 10, font: { size: 10 } } } },
      scales: {
        x: { stacked: true, ticks: { color: '#7b7f93', font: { size: 9 }, maxRotation: 0, maxTicksLimit: 8 }, grid: { color: '#2a2d3a' } },
        y: { stacked: true, ticks: { color: '#7b7f93', font: { size: 10 } }, grid: { color: '#2a2d3a' } }
      }
    }
  })

  const src = d.stats.bySource
  new Chart(document.getElementById('src-chart'), {
    type: 'doughnut',
    data: {
      labels: ['Claude AI', 'Learned', 'Local Extract'],
      datasets: [{ data: [src.ai, src.learned, src.local_extract], backgroundColor: ['#6c63ff','#22c55e','#3b82f6'], borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#7b7f93', boxWidth: 10, font: { size: 10 }, padding: 12 } }
      }
    }
  })

  // ── Language + Success rate + Latency breakdown ──
  main.insertAdjacentHTML('beforeend', '<div class="charts-row-3"><div class="chart-card"><div class="chart-title">Language Split</div><canvas id="lang-chart" height="120"></canvas></div><div class="chart-card"><div class="chart-title">Success Rate (48h)</div><canvas id="sr-chart" height="120"></canvas></div><div class="chart-card"><div class="chart-title">Action Types</div><canvas id="action-chart" height="120"></canvas></div></div>')

  const lang = d.stats.byLang
  new Chart(document.getElementById('lang-chart'), {
    type: 'doughnut',
    data: {
      labels: ['Hindi', 'English', 'Mixed', 'Unknown'],
      datasets: [{ data: [lang.hi, lang.en, lang.mixed, lang.unknown], backgroundColor: ['#f97316','#3b82f6','#a855f7','#7b7f93'], borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: { legend: { position: 'bottom', labels: { color: '#7b7f93', boxWidth: 10, font: { size: 10 }, padding: 10 } } }
    }
  })

  new Chart(document.getElementById('sr-chart'), {
    type: 'line',
    data: {
      labels: tsData.map(p => tsLabel(p.ts)),
      datasets: [{ label: 'Success %', data: tsData.map(p => (p.successRate * 100).toFixed(1)),
        borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', tension: 0.4, fill: true, pointRadius: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#7b7f93', font: { size: 9 }, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: '#2a2d3a' } },
        y: { min: 0, max: 100, ticks: { color: '#7b7f93', font: { size: 10 } }, grid: { color: '#2a2d3a' } }
      }
    }
  })

  const actions = d.stats.byAction
  const aKeys   = Object.keys(actions).sort((a,b) => actions[b]-actions[a]).slice(0,7)
  new Chart(document.getElementById('action-chart'), {
    type: 'bar',
    data: {
      labels: aKeys,
      datasets: [{ data: aKeys.map(k => actions[k]), backgroundColor: '#6c63ff', borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#7b7f93', font: { size: 10 } }, grid: { color: '#2a2d3a' } },
        y: { ticks: { color: '#7b7f93', font: { size: 10 } }, grid: { display: false } }
      }
    }
  })

  // ── Latency breakdown ──
  main.insertAdjacentHTML('beforeend', \`
    <div class="latency-row">
      <div class="lat-card">
        <div class="lat-label">Whisper (Speech → Text)</div>
        <div class="lat-value" style="color:var(--blue)">\${ms(d.stats.avgWhisperMs)}</div>
        <div class="lat-sub">avg transcription time</div>
      </div>
      <div class="lat-card">
        <div class="lat-label">Claude (Intent)</div>
        <div class="lat-value" style="color:var(--accent)">\${ms(d.stats.avgAiMs)}</div>
        <div class="lat-sub">avg AI response time</div>
      </div>
      <div class="lat-card">
        <div class="lat-label">Total Voice → Action</div>
        <div class="lat-value" style="color:var(--green)">\${ms(d.stats.avgTotalMs)}</div>
        <div class="lat-sub">end-to-end</div>
      </div>
    </div>
  \`)

  // ── Top commands + Top failures ──
  main.insertAdjacentHTML('beforeend', '<div class="tables-row"><div class="chart-card" id="top-cmd-card"><div class="chart-title">Top Commands</div></div><div class="chart-card" id="top-fail-card"><div class="chart-title">Top Failures</div></div></div>')

  const cmdCard  = document.getElementById('top-cmd-card')
  const failCard = document.getElementById('top-fail-card')

  if (d.topCommands.length === 0) {
    cmdCard.insertAdjacentHTML('beforeend', '<div class="empty">No commands yet</div>')
  } else {
    const rows = d.topCommands.map(c => {
      const sr  = (c.successRate * 100).toFixed(0)
      const col = c.successRate > .8 ? '#22c55e' : c.successRate > .5 ? '#f97316' : '#ef4444'
      return \`<tr>
        <td class="route">\${c.route}</td>
        <td style="color:var(--muted)">\${c.action}</td>
        <td>\${c.count}</td>
        <td><div style="display:flex;align-items:center;gap:6px"><div class="success-bar"><div class="success-fill" style="width:\${sr}%;background:\${col}"></div></div><span style="font-size:10px;color:\${col}">\${sr}%</span></div></td>
      </tr>\`
    }).join('')
    cmdCard.insertAdjacentHTML('beforeend',
      '<table><thead><tr><th>Route</th><th>Action</th><th>Count</th><th>Success</th></tr></thead><tbody>' + rows + '</tbody></table>')
  }

  if (d.topFailures.length === 0) {
    failCard.insertAdjacentHTML('beforeend', '<div class="empty">No failures 🎉</div>')
  } else {
    const rows = d.topFailures.map(f => \`<tr>
      <td class="route">\${f.route}</td>
      <td style="color:var(--red);font-family:monospace;font-size:11px">\${f.errorCode}</td>
      <td style="color:var(--red);font-weight:700">\${f.count}</td>
    </tr>\`).join('')
    failCard.insertAdjacentHTML('beforeend',
      '<table><thead><tr><th>Route</th><th>Error</th><th>Count</th></tr></thead><tbody>' + rows + '</tbody></table>')
  }

  // ── Learning store ──
  const ls = d.learningStore
  main.insertAdjacentHTML('beforeend', \`
    <div class="chart-card" style="margin-bottom:18px">
      <div class="chart-title">Learning Store</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding-top:4px">
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">TOTAL MAPPINGS</div><div style="font-size:22px;font-weight:700">\${ls.totalMappings}</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">CONFIDENT (≥3 uses)</div><div style="font-size:22px;font-weight:700;color:var(--green)">\${ls.confidentMappings}</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">AI CALLS SAVED</div><div style="font-size:22px;font-weight:700;color:var(--accent)">\${ls.commandsSavedFromAI}</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">COST SAVED</div><div style="font-size:22px;font-weight:700;color:var(--orange)">\${usd(ls.estimatedCostSaved)}</div></div>
      </div>
      <div style="margin-top:12px">
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;background:var(--accent);border-radius:3px;width:\${ls.totalMappings ? Math.min(100,(ls.confidentMappings/ls.totalMappings)*100) : 0}%;transition:width .6s ease"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">\${ls.totalMappings ? ((ls.confidentMappings/ls.totalMappings)*100).toFixed(0) : 0}% of mappings are confident — target 80%</div>
      </div>
    </div>
  \`)
}

function exportCSV() {
  window.parent.postMessage({ type: 'vl-export', format: 'csv' }, '*')
}
function exportJSON() {
  window.parent.postMessage({ type: 'vl-export', format: 'json' }, '*')
}
<\/script>
</body>
</html>`,Qt=.2,Zt=.04,te="vl_learning_store",ht=500,ee=60;class se{constructor(t){this.entries=[],this.appId=t,this.load()}findMatch(t,e){if(this.entries.length===0)return null;const s=this.normalize(t);let i=1/0,o=null;for(const n of this.entries){const r=this.levenshtein(s,n.transcript),a=Math.max(s.length,n.transcript.length);if(a===0)continue;const c=r/a,d=e===n.startRoute?c-Zt:c;d<i&&(i=d,o=n)}return i<=Qt&&o?(o.hitCount++,o.lastUsed=Date.now(),this.persist(),o):null}store(t,e,s,i,o,n="learned"){const r=this.normalize(t),a=this.entries.find(c=>this.levenshtein(c.transcript,r)/Math.max(c.transcript.length,r.length)<.05);if(a){a.steps=e,a.speak=s,a.confidence=o,a.lastUsed=Date.now(),a.hitCount++,this.persist();return}this.entries.push({id:Math.random().toString(36).slice(2),transcript:r,originalTranscript:t,steps:e,speak:s,startRoute:i,hitCount:0,lastUsed:Date.now(),source:n,confidence:o}),this.prune(),this.persist()}bulkStore(t,e,s,i,o){for(const n of t)n.trim().length<4||this.store(n,e,s,i,o,"variant")}validateSteps(t){for(const e of t)if(e.target&&!e.target.startsWith("/"))try{if(!document.querySelector(e.target))return!1}catch{return!1}return!0}export(){return[...this.entries]}merge(t){const e=new Set(this.entries.map(s=>s.id));for(const s of t)!e.has(s.id)&&this.entries.length<ht&&this.entries.push(s);this.persist()}get size(){return this.entries.length}normalize(t){return t.toLowerCase().replace(/[^\w\sऀ-ॿ]/g," ").replace(/\b(please|kya|aap|mujhe|mujhe|toh|hai|hain|na|ji|ok|okay)\b/g,"").replace(/\s+/g," ").trim()}levenshtein(t,e){if(t===e)return 0;if(t.length===0)return e.length;if(e.length===0)return t.length;t.length>e.length&&([t,e]=[e,t]);let s=Array.from({length:t.length+1},(i,o)=>o);for(let i=1;i<=e.length;i++){const o=[i];for(let n=1;n<=t.length;n++){const r=t[n-1]===e[i-1]?0:1;o[n]=Math.min(s[n]+1,o[n-1]+1,s[n-1]+r)}s=o}return s[t.length]}prune(){const t=Date.now()-ee*864e5;this.entries=this.entries.filter(e=>e.lastUsed>t).sort((e,s)=>s.hitCount*10+s.lastUsed/1e10-(e.hitCount*10+e.lastUsed/1e10)).slice(0,ht)}storageKey(){return`${te}_${this.appId}`}persist(){try{localStorage.setItem(this.storageKey(),JSON.stringify(this.entries))}catch{}}load(){try{const t=localStorage.getItem(this.storageKey());t&&(this.entries=JSON.parse(t))}catch{this.entries=[]}}}class ie{constructor(t){this.opts=t,this.useOpenAI=!t.anthropicKey&&!!t.openaiKey,this.model=t.model??(this.useOpenAI?"gpt-4o-mini":"claude-haiku-4-5-20251001")}seedAsync(t,e,s,i,o,n){this.generate(t,i).then(r=>{n.bulkStore(r,e,s,i,o)}).catch(()=>{})}async generate(t,e){const s=`You are a multilingual NLP assistant. Your job is to generate transcript variants for voice commands in Hindi, English, and Hinglish (Hindi-English mix).

RULES:
1. Output ONLY a valid JSON array of strings — no explanation, no markdown.
2. Generate exactly 12 variants.
3. Each variant must convey the SAME intent as the original but phrased differently.
4. Cover all three registers: pure Hindi, pure English, and Hinglish mix.
5. Vary length: some short (3-4 words), some long (8-10 words).
6. Include natural spoken variations: with/without subject pronouns, different verb forms.
7. NEVER change the core subject noun (subscription ≠ meal plan ≠ order). Keep the specific entity.
8. Do NOT include the original transcript itself in the output.

OUTPUT FORMAT: ["variant 1", "variant 2", ...]`,i=`Original voice command: "${t}"
Page route: ${e}

Generate 12 variants:`,o=this.useOpenAI?await this.callOpenAI(s,i):await this.callAnthropic(s,i);try{const n=JSON.parse(o);if(Array.isArray(n))return n.filter(r=>typeof r=="string"&&r.trim().length>3)}catch{}return[]}async callAnthropic(t,e){var n;const s={"content-type":"application/json","x-api-key":this.opts.anthropicKey,"anthropic-version":"2023-06-01"};this.opts.anthropicBase==="https://api.anthropic.com"&&(s["anthropic-dangerous-allow-browser"]="true");const i=await fetch(`${this.opts.anthropicBase}/v1/messages`,{method:"POST",headers:s,body:JSON.stringify({model:this.model,max_tokens:512,system:t,messages:[{role:"user",content:e}]})});return i.ok?((n=(await i.json()).content.find(r=>r.type==="text"))==null?void 0:n.text)??"[]":"[]"}async callOpenAI(t,e){var o,n;const s=await fetch(`${this.opts.openaiBase}/v1/chat/completions`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${this.opts.openaiKey}`},body:JSON.stringify({model:this.model,max_tokens:512,messages:[{role:"system",content:t},{role:"user",content:e}]})});return s.ok?((n=(o=(await s.json()).choices[0])==null?void 0:o.message)==null?void 0:n.content)??"[]":"[]"}}const S=class S{constructor(t){this.config=t,this.transcriber=null,this.intentEngine=null,this.currentPageMap=null,this.isListening=!1,this.micGranted=!1,this.recognition=null,this.variantGenerator=null,this.mapCache=new Map,this.mapCacheDirty=!0}openDashboard(){var t;(t=this.dashboard)==null||t.open()}closeDashboard(){var t;(t=this.dashboard)==null||t.close()}static isLocalDevHost(){if(typeof window>"u")return!1;const{hostname:t,protocol:e}=window.location;return e!=="http:"?!1:t==="localhost"||t==="127.0.0.1"||t==="[::1]"||t.endsWith(".localhost")}resolveDevProxyUrls(){return S.isLocalDevHost()?{anthropicProxyUrl:this.config.anthropicProxyUrl??(this.config.anthropicKey?"/api/anthropic":void 0),openaiProxyUrl:this.config.openaiProxyUrl??(this.config.openaiKey?"/api/openai":void 0)}:{anthropicProxyUrl:this.config.anthropicProxyUrl,openaiProxyUrl:this.config.openaiProxyUrl}}async init(){var ft,gt,mt,yt,bt,vt,wt,kt,xt,Et;const t=((ft=this.config.analytics)==null?void 0:ft.enabled)!==!1,e={appId:((gt=this.config.analytics)==null?void 0:gt.appId)??window.location.hostname,enabled:t,endpoint:(mt=this.config.analytics)==null?void 0:mt.endpoint,sdkVersion:"0.2.0"};this.analytics=new lt(e),this.analytics.install(),this.dashboard=new dt(()=>this.analytics.getInsights()),this.config.debug&&this.dashboard.installShortcut(),window.addEventListener("message",k=>{var N;((N=k.data)==null?void 0:N.type)==="vl-export"&&(k.data.format==="csv"&&this._downloadFile("voicelayer-events.csv",this.analytics.exportCSV(),"text/csv"),k.data.format==="json"&&this._downloadFile("voicelayer-events.json",this.analytics.exportJSON(),"application/json"))});const s=((yt=this.config.analytics)==null?void 0:yt.appId)??window.location.hostname;this.learningStore=new se(s),this.conversationManager=new rt(10);const i=this.config.anthropicProxyUrl??"https://api.anthropic.com",o=this.config.openaiProxyUrl??"https://api.openai.com";(this.config.anthropicKey||this.config.openaiKey)&&(this.variantGenerator=new ie({anthropicKey:this.config.anthropicKey,openaiKey:this.config.openaiKey,anthropicBase:i,openaiBase:o}));const n=new nt,r=n.detect(),a=n.suggestConfig(r);this.config={...a,...this.config},this.config.debug&&console.log("[VoiceLayer] App profile:",r),this.networkObserver=new tt,this.networkObserver.install(),this.domWatcher=new st,this.domWatcher.install(),this.domWatcher.onChange(()=>{this.mapCacheDirty=!0});const c=new u;this.routeDetector=new B,this.intentMapper=new L(c,this.routeDetector);const l=new Z(this.domWatcher);r.routerType==="hash"&&l.setNavigateStrategy("hash");const d=new V(l);this.actionExecutor=new F(l,d,this.networkObserver,this.domWatcher);const m=this.config.aiProvider==="openai"||!this.config.anthropicKey&&!!this.config.openaiKey,{anthropicProxyUrl:v,openaiProxyUrl:p}=this.resolveDevProxyUrls(),w={anthropicBaseUrl:v,openaiBaseUrl:p};m&&this.config.openaiKey?this.intentEngine=new _(this.config.openaiKey,void 0,w):this.config.anthropicKey&&(this.intentEngine=new _(this.config.anthropicKey,void 0,w)),this.audioCapture=new U;const E=this.config.language==="hi";if(!!this.config.openaiKey&&(E||this.config.stt!=="webspeech")){const k=this.config.language==="auto"||!this.config.language?"en":this.config.language;this.transcriber=new P(this.config.openaiKey,k,p)}const T=this.resolveTTSProvider(),b=this.resolveTTSApiKey(T);this.ttsPlayer=new $({provider:T,apiKey:b,voiceId:(bt=this.config.tts)==null?void 0:bt.voiceId,speed:(vt=this.config.tts)==null?void 0:vt.speed});const R={position:((wt=this.config.ui)==null?void 0:wt.buttonPosition)??"bottom-right",theme:(kt=this.config.ui)!=null&&kt.buttonColor?{primary:this.config.ui.buttonColor}:void 0};this.talkButton=new H(R),this.overlay=new K(R,this.config.debug??!1);const ut=this.config.announceToasts!==!1,pt=this.config.announceModals!==!1;if(this.announcer=new it(this.ttsPlayer,{announceToasts:ut,announceModals:pt}),(ut||pt)&&this.announcer.install(this.domWatcher),this.transcriber)try{this.micGranted=await this.audioCapture.requestPermission(),!this.micGranted&&this.config.debug&&console.warn("[VoiceLayer] Microphone permission denied — will use WebSpeech fallback")}catch(k){this.config.debug&&console.warn("[VoiceLayer] Could not request mic permission:",k),this.micGranted=!1}if(this.currentPageMap=this.intentMapper.buildMap(),this.config.rescanOnMutation!==!1&&(this.unsubscribeRescan=this.intentMapper.installAutoRescan(this.domWatcher,k=>{this.currentPageMap=k,k.openModals.length>0?this.talkButton.showContextBadge("Modal open"):k.activeDropdowns.length>0?this.talkButton.showContextBadge("Dropdown open"):this.talkButton.hideContextBadge()})),this.tapHandler=()=>{this.handleTalkPress().catch(k=>{this.config.debug&&console.error("[VoiceLayer] handleTalkPress error:",k)})},window.addEventListener("voicelayer:tap",this.tapHandler),this.spaceHandler=k=>{if(k.code!=="Space"||k.metaKey||k.ctrlKey||k.altKey)return;const N=document.activeElement;if(N){const G=N.tagName.toLowerCase();if(G==="input"||G==="textarea"||G==="select"||N.isContentEditable)return}k.preventDefault(),this.handleTalkPress().catch(()=>{})},document.addEventListener("keydown",this.spaceHandler),this.unsubscribeRoute=this.routeDetector.onRouteChange(()=>{this.currentPageMap=this.intentMapper.buildMap(),this.config.debug&&console.log("[VoiceLayer] Route change → map rebuilt")}),r.framework==="next"){const k=(xt=window.next)==null?void 0:xt.router;(Et=k==null?void 0:k.events)==null||Et.on("routeChangeComplete",()=>{this.currentPageMap=this.intentMapper.buildMap(),this.config.debug&&console.log("[VoiceLayer] Next.js routeChangeComplete → map rebuilt")})}this.config.debug&&(console.log("[VoiceLayer] Ready"),console.log("[VoiceLayer] Page map:",this.currentPageMap))}destroy(){var t,e,s,i,o,n,r,a,c,l,d,m;(t=this.unsubscribeRescan)==null||t.call(this),(e=this.unsubscribeRoute)==null||e.call(this),this.tapHandler&&(window.removeEventListener("voicelayer:tap",this.tapHandler),this.tapHandler=void 0),this.spaceHandler&&(document.removeEventListener("keydown",this.spaceHandler),this.spaceHandler=void 0),this.autoStopTimer!==void 0&&(clearTimeout(this.autoStopTimer),this.autoStopTimer=void 0),(s=this.recognition)==null||s.stop(),this.recognition=null,(i=this.analytics)==null||i.uninstall(),(o=this.dashboard)==null||o.uninstall(),(n=this.audioCapture)==null||n.destroy(),(r=this.ttsPlayer)==null||r.stop().catch(()=>{}),(a=this.domWatcher)==null||a.uninstall(),(c=this.networkObserver)==null||c.uninstall(),(l=this.announcer)==null||l.uninstall(),(d=this.talkButton)==null||d.destroy(),(m=this.overlay)==null||m.destroy()}static autoInit(){var r;const t=document.currentScript;if(!t)return;const e=(r=t.dataset.proxyUrl)==null?void 0:r.replace(/\/$/,""),s=t.dataset.anthropicProxyUrl??(e?`${e}/anthropic`:void 0),i=t.dataset.openaiProxyUrl??(e?`${e}/openai`:void 0),o={anthropicKey:t.dataset.anthropicKey,openaiKey:t.dataset.openaiKey,elevenLabsKey:t.dataset.elevenLabsKey,anthropicProxyUrl:s,openaiProxyUrl:i,tts:{provider:t.dataset.ttsProvider??"browser",voiceId:t.dataset.voiceId},language:t.dataset.language??"auto",aiProvider:t.dataset.aiProvider??void 0,debug:t.dataset.debug==="true",announceToasts:t.dataset.announceToasts!=="false",announceModals:t.dataset.announceModals!=="false",analytics:{enabled:t.dataset.analyticsEnabled!=="false",appId:t.dataset.appId,endpoint:t.dataset.analyticsEndpoint}},n=new S(o);n.init().catch(a=>{console.error("[VoiceLayer] autoInit failed:",a)}),window.voicelayer=n}async handleTalkPress(){var t;this.isListening?this.transcriber&&this.micGranted?await this.stopAndProcess():(t=this.recognition)==null||t.stop():await this.startListening()}async startListening(){if(this.isListening=!0,this.announcer.silence(),this.talkButton.setState("listening"),this.talkButton.setAriaLabel("VoiceLayer: listening..."),this.overlay.show("🎤 Listening…"),this.transcriber&&this.micGranted){try{await this.audioCapture.startRecording()}catch(t){this.isListening=!1,this.talkButton.setState("error"),this.overlay.show("⚠️ Mic error",t instanceof Error?t.message:"Recording failed."),setTimeout(()=>{this.talkButton.setState("idle"),this.overlay.hide()},2500);return}this.autoStopTimer=window.setTimeout(()=>{this.stopAndProcess().catch(()=>{})},1e4)}else this.startWebSpeech()}async stopAndProcess(){this.autoStopTimer!==void 0&&(clearTimeout(this.autoStopTimer),this.autoStopTimer=void 0),this.isListening=!1,this.talkButton.setState("processing"),this.overlay.show("💭 Transcribing…");let t;try{const e=await this.audioCapture.stopRecording();if(e.size<1e3){this.overlay.show("Didn't catch that.","Please try again."),setTimeout(()=>{this.talkButton.setState("idle"),this.overlay.hide()},2e3);return}t=await this.transcriber.transcribe(e)}catch(e){const s=e instanceof Error?e.message:"Transcription failed.";this.config.debug&&console.error("[VoiceLayer] STT error:",e),this.talkButton.setState("error"),this.overlay.show("⚠️ Error",s),setTimeout(()=>{this.talkButton.setState("idle"),this.overlay.hide()},3e3);return}this.overlay.setTranscript(`"${t}"`),await this.processIntent(t)}buildMapCached(){const t=window.location.pathname+window.location.hash;if(!this.mapCacheDirty&&this.mapCache.has(t)){const s=this.mapCache.get(t);return this.mapCache.delete(t),this.mapCache.set(t,s),s}const e=this.intentMapper.buildMap();if(this.mapCache.size>=S.MAP_CACHE_MAX){const s=this.mapCache.keys().next().value;s&&this.mapCache.delete(s)}return this.mapCache.set(t,e),this.mapCacheDirty=!1,this.currentPageMap=e,e}waitForDOMSettle(t=300,e=2500){return new Promise(s=>{let i;const o=setTimeout(()=>{r(),clearTimeout(i),s()},e),n=()=>{clearTimeout(i),i=window.setTimeout(()=>{clearTimeout(o),r(),s()},t)},r=this.domWatcher.onChange(()=>n());n()})}async runAgentLoop(t){var c,l;const e=[];let s=0,i=0,o=this.intentMapper.buildMap().currentRoute,n=A.clarifyFallback("Kuch samajh nahi aaya."),r=!1;const a=new Set(["done","speak_only","clarify"]);for(let d=0;d<S.MAX_AGENT_STEPS;d++){const m=this.buildMapCached();this.currentPageMap=m,o=m.currentRoute;const v={transcribedText:t,pageMap:m,language:this.config.language,networkContext:this.networkObserver.getFullLog().slice(-10),conversationHistory:this.conversationManager.getHistory()};this.config.debug&&console.log(`[VoiceLayer] Agent step ${d+1}/${S.MAX_AGENT_STEPS}`,m.currentPage);let p;const w=Date.now();try{this.intentEngine?p=await this.intentEngine.understandAgentStep(t,v,e):p=A.clarifyFallback("No AI provider configured.")}catch(b){const R=b instanceof Error?b.message:"AI request failed.";this.config.debug&&console.error("[VoiceLayer] Agent AI error:",b),this.analytics.trackError({route:o,errorCode:"AI_ERROR"}),p=A.clarifyFallback(R),n=p;break}if(s+=Date.now()-w,n=p,this.config.debug&&console.log(`[VoiceLayer] Agent step ${d+1} intent:`,p),a.has(p.action)){r=p.action==="done";break}const E=Date.now();let x={success:!1,intent:p};try{x=await this.actionExecutor.execute(p),r=x.success}catch(b){this.config.debug&&console.warn("[VoiceLayer] Agent exec warning:",b)}i+=Date.now()-E,((c=x.domChange)==null?void 0:c.type)==="modal_opened"&&x.domChange.textContent&&this.overlay.showModalContext(x.domChange.textContent),this.config.debug&&((l=x.networkEvents)!=null&&l.length)&&this.overlay.showActionResult(x.networkEvents),e.push({stepNumber:d+1,action:p.action,target:p.target,outcome:x.success?"success":"failed",pageAfter:this.intentMapper.buildMap().currentPage}),["navigate","click","submit_form","select_option"].includes(p.action)&&await this.waitForDOMSettle(300,2500),d===S.MAX_AGENT_STEPS-1&&this.config.debug&&console.log("[VoiceLayer] Agent reached max steps")}return{finalIntent:n,totalAiMs:s,totalExecMs:i,lastRoute:o,success:r,stepHistory:e}}async processIntent(t){var v;const e=Date.now();if(!this.intentEngine){const p=A.clarifyFallback("No AI provider configured. Please set anthropicKey or openaiKey.");this.overlay.setResponse(p.speak),await this.ttsPlayer.speak(p.speak).catch(()=>{}),this.talkButton.setState("idle"),this.overlay.hide();return}const s=window.location.pathname+window.location.hash,i=this.learningStore.findMatch(t,s);if(i&&this.learningStore.validateSteps(i.steps)){this.config.debug&&console.log(`[VoiceLayer] LearningStore HIT (${i.source}):`,i.originalTranscript);let p=!0;for(const w of i.steps){const E={action:w.action,target:w.target,data:w.data,speak:i.speak,confidence:i.confidence};try{if(!(await this.actionExecutor.execute(E)).success){p=!1;break}["navigate","click","submit_form","select_option"].includes(w.action)&&await this.waitForDOMSettle(300,2e3)}catch{p=!1;break}}if(p){const w=Date.now()-e;this.analytics.trackCommand({action:((v=i.steps[0])==null?void 0:v.action)??"speak_only",route:s,success:!0,source:"learned",lang:this.config.language==="hi"?"hi":this.config.language==="en"?"en":"unknown",whisperMs:0,aiMs:0,execMs:w,totalMs:w}),this.talkButton.setState("speaking"),this.overlay.setResponse(i.speak),await this.ttsPlayer.speak(i.speak).catch(()=>{}),this.conversationManager.addTurn(t,i.speak),this.talkButton.setState("idle"),this.talkButton.setAriaLabel("VoiceLayer: tap to speak"),this.overlay.hide();return}this.config.debug&&console.log("[VoiceLayer] LearningStore replay failed, falling through to agent loop")}this.buildMapCached();let o;try{o=await this.runAgentLoop(t)}catch(p){const w=p instanceof Error?p.message:"Agent loop failed.";this.config.debug&&console.error("[VoiceLayer] Agent error:",p),this.analytics.trackError({route:s,errorCode:"AGENT_ERROR"}),this.talkButton.setState("error"),this.overlay.show("⚠️ Error",w),setTimeout(()=>{this.talkButton.setState("idle"),this.overlay.hide()},3e3);return}const{finalIntent:n,totalAiMs:r,totalExecMs:a,lastRoute:c,success:l,stepHistory:d}=o,m=Date.now()-e;if(l&&d.length>0&&this.variantGenerator){const p=d.map(w=>({action:w.action,target:w.target,data:null}));this.learningStore.store(t,p,n.speak,s,n.confidence),this.variantGenerator.seedAsync(t,p,n.speak,s,n.confidence,this.learningStore)}this.analytics.trackCommand({action:n.action??"speak_only",route:c,success:l,source:"ai",lang:this.config.language==="hi"?"hi":this.config.language==="en"?"en":"unknown",whisperMs:this.transcriber?Math.max(0,m-r-a):0,aiMs:r,execMs:a,totalMs:m}),this.talkButton.setState("speaking"),this.talkButton.setAriaLabel("VoiceLayer: speaking"),this.overlay.setResponse(n.speak);try{await this.ttsPlayer.speak(n.speak)}catch{}this.conversationManager.addTurn(t,n.speak),this.talkButton.setState("idle"),this.talkButton.setAriaLabel("VoiceLayer: tap to speak"),this.overlay.hide()}startWebSpeech(){const t=window,e=t.SpeechRecognition??t.webkitSpeechRecognition;if(!e){this.isListening=!1,this.talkButton.setState("error"),this.overlay.show("⚠️ Not supported","Speech recognition requires Chrome."),setTimeout(()=>{this.talkButton.setState("idle"),this.overlay.hide()},2500);return}const s=new e;this.recognition=s,s.continuous=!1,s.interimResults=!0;const i={hi:"hi-IN",en:"en-US",auto:"en-IN"};s.lang=i[this.config.language??"auto"]??"en-IN",this.config.language==="hi"&&this.overlay.show("🎙 Hindi mode","Browser mic accuracy is limited. Speak clearly and slowly, ya OpenAI key add karein better results ke liye."),s.onresult=o=>{const r=Array.from({length:o.results.length},(a,c)=>o.results[c][0].transcript).join("");this.overlay.setTranscript(`"${r}"`),o.results[o.results.length-1].isFinal&&(this.isListening=!1,this.autoStopTimer!==void 0&&(clearTimeout(this.autoStopTimer),this.autoStopTimer=void 0),this.talkButton.setState("processing"),this.processIntent(r).catch(a=>{this.config.debug&&console.error("[VoiceLayer]",a)}))},s.onerror=o=>{this.isListening=!1,this.autoStopTimer!==void 0&&(clearTimeout(this.autoStopTimer),this.autoStopTimer=void 0);const n=o.error==="no-speech"?"No speech detected.":o.error==="not-allowed"?"Microphone access denied.":`Recognition error: ${o.error}`;this.talkButton.setState("error"),this.overlay.show("⚠️ Error",n),setTimeout(()=>{this.talkButton.setState("idle"),this.overlay.hide()},2500)},s.onend=()=>{this.isListening&&(this.isListening=!1,this.talkButton.setState("idle"),this.overlay.hide())},s.start(),this.autoStopTimer=window.setTimeout(()=>{s.stop()},1e4)}_downloadFile(t,e,s){const i=document.createElement("a");i.href=URL.createObjectURL(new Blob([e],{type:s})),i.download=t,i.click(),setTimeout(()=>URL.revokeObjectURL(i.href),1e3)}resolveTTSProvider(){var t;return(t=this.config.tts)!=null&&t.provider?this.config.tts.provider:this.config.elevenLabsKey?"elevenlabs":this.config.openaiKey?"openai":"browser"}resolveTTSApiKey(t){if(t==="elevenlabs")return this.config.elevenLabsKey;if(t==="openai")return this.config.openaiKey}};S.MAP_CACHE_MAX=10,S.MAX_AGENT_STEPS=4;let q=S;if(typeof window<"u"){const h=document.currentScript;(h!=null&&h.dataset.anthropicKey||h!=null&&h.dataset.openaiKey||h!=null&&h.dataset.proxyUrl)&&q.autoInit()}const oe={stt:{provider:"webspeech",languages:["en-IN","hi-IN","en-US"]},tts:{provider:"webspeech",language:"en-IN"},ui:{position:"bottom-right",hotkey:"Alt+KeyV",theme:{primary:"#6C47FF",background:"#1A1A2E",text:"#F0F0F0"}}};return y.ActionExecutor=F,y.AnalyticsEngine=lt,y.AnnouncerBar=it,y.AppDetector=nt,y.AudioCapture=U,y.ConversationManager=rt,y.DOMInteractor=Z,y.DOMScanner=u,y.DOMWatcher=st,y.ErrorCode=f,y.FormFiller=V,y.FounderDashboard=dt,y.InsightComputer=ct,y.IntentEngine=_,y.IntentMapper=L,y.NetworkObserver=tt,y.PromptBuilder=O,y.ResponseParser=A,y.RouteDetector=B,y.TTSPlayer=$,y.TalkButton=H,y.Transcriber=P,y.VoiceLayer=q,y.VoiceLayerError=g,y.VoiceOverlay=K,y.defaults=oe,Object.defineProperty(y,Symbol.toStringTag,{value:"Module"}),y}({});
//# sourceMappingURL=voicelayer.iife.js.map
