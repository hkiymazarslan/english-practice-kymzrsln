"use client";
import { useState, useRef, useEffect } from "react";

const SCENARIOS = [
  { id: "cafe", emoji: "☕", label: "Café", sublabel: "Order drinks & food", color: "#c8a96e", role: "a friendly barista at a busy London café. Use British English (biscuit, till, cheers, etc)." },
  { id: "interview", emoji: "💼", label: "Job Interview", sublabel: "London tech company", color: "#7eb8c9", role: "a hiring manager at a London tech firm. Use British English (CV, holiday, brilliant, etc)." },
  { id: "travel", emoji: "✈️", label: "Airport", sublabel: "Heathrow check-in", color: "#9ec97e", role: "a British check-in staff member at Heathrow Airport. Use British English." },
  { id: "friend", emoji: "🗣️", label: "Casual Chat", sublabel: "Mate, weekend plans...", color: "#b8a0d8", role: "a friendly British mate. Use British slang (brilliant, cheers, fancy, reckon, mate)." },
  { id: "doctor", emoji: "🏥", label: "NHS Doctor", sublabel: "Describe symptoms", color: "#c97e7e", role: "a friendly NHS GP in London. Use British English and NHS terms." },
  { id: "shop", emoji: "🛍️", label: "Shopping", sublabel: "Clothes & returns", color: "#c9b87e", role: "a shop assistant in a British high street store. Use British English (trousers, queue, etc)." },
];

const buildSystem = (role: string) =>
  `You are ${role}\n\nRules:\n- Only British English\n- Max 2-3 short sentences per reply\n- If user makes a grammar or vocabulary mistake, add on a new line: CORRECTION: [warm friendly tip]\n- If no mistake, do not add CORRECTION line\n- Be warm and encouraging`;

const buildSummaryPrompt = (history: string) =>
  `Turkish B1-B2 learner practiced British English:\n\n${history}\n\nWrite a short friendly summary:\n\n## Session Summary\nOverall: [2 sentences]\n\n## Mistakes to Remember\n[each: mistake → correction — why: ...]\n\n## What You Did Well\n[2-3 things]\n\n## Focus Next Time\n[top 2 tips]`;

const parseMsg = (content: string) => {
  const lines = content.split("\n");
  const corrLine = lines.find(l => l.startsWith("CORRECTION:"));
  return {
    main: lines.filter(l => !l.startsWith("CORRECTION:")).join("\n").trim(),
    correction: corrLine ? corrLine.replace("CORRECTION:", "").trim() : null,
  };
};

const getBritishVoice = () => {
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => v.name.includes("UK") && v.name.includes("Female"))
    || voices.find(v => v.name.includes("UK"))
    || voices.find(v => v.lang === "en-GB")
    || voices.find(v => v.lang.startsWith("en"))
    || null;
};

export default function Home() {
  const [screen, setScreen] = useState<"setup"|"home"|"chat"|"summary">("setup");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [scenario, setScenario] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number|null>(null);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => {
    window.speechSynthesis?.onvoiceschanged && (window.speechSynthesis.onvoiceschanged = () => {});
    window.speechSynthesis?.getVoices();
  }, []);

  const speak = (text: string) => {
    window.speechSynthesis.cancel();
    const clean = text.split("\n").filter(l => !l.startsWith("CORRECTION:")).join(" ").trim();
    if (!clean) return;
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(clean);
      const v = getBritishVoice();
      if (v) u.voice = v;
      u.lang = "en-GB"; u.rate = 0.88; u.pitch = 1.05;
      u.onstart = () => setIsSpeaking(true);
      u.onend = () => setIsSpeaking(false);
      u.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(u);
    }, 200);
  };

  const callClaude = async (msgs: any[], system?: string) => {
    const body: any = { model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: msgs };
    if (system) body.system = system;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gemini-key": anthropicKey },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || data?.error || "API error");
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error("Empty response");
    return text;
  };

  const startRecording = async () => {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await transcribeAndSend(blob, mimeType);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (e: any) {
      setError("Mikrofon izni gerekli: " + e.message);
    }
  };

  const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false); };

  const transcribeAndSend = async (blob: Blob, mimeType: string) => {
    if (!openaiKey) { setError("Sesli giriş için OpenAI key gerekli."); return; }
    setLoading(true);
    try {
      const ext = mimeType.includes("webm") ? "webm" : "mp4";
      const fd = new FormData();
      fd.append("file", blob, `rec.${ext}`);
      fd.append("model", "whisper-1");
      fd.append("language", "en");
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "x-openai-key": openaiKey },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Whisper error");
      const transcript = data.text?.trim();
      if (!transcript) { setError("Ses algılanamadı."); setLoading(false); return; }
      await sendMessage(transcript);
    } catch (e: any) { setError(e.message); setLoading(false); }
  };

  const sendMessage = async (text: string) => {
    if (!text?.trim()) return;
    setError("");
    window.speechSynthesis.cancel();
    const next = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setLoading(true);
    try {
      const reply = await callClaude(next, buildSystem(scenario.role));
      setMessages(p => [...p, { role: "assistant", content: reply }]);
      speak(reply);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const startChat = async (sc: any) => {
    setScenario(sc); setMessages([]); setError(""); setSummary(""); setExpandedIdx(null);
    setScreen("chat"); setLoading(true);
    try {
      const text = await callClaude([{ role: "user", content: "Hello!" }], buildSystem(sc.role));
      setMessages([{ role: "assistant", content: text }]);
      speak(text);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const endSession = async () => {
    window.speechSynthesis.cancel();
    setScreen("summary"); setSummaryLoading(true);
    const hist = messages.map(m => `${m.role === "user" ? "Learner" : "AI"}: ${m.content}`).join("\n\n");
    try {
      const text = await callClaude([{ role: "user", content: buildSummaryPrompt(hist) }]);
      setSummary(text);
    } catch { setSummary("Great session! Keep practising. 🇬🇧"); }
    setSummaryLoading(false);
  };

  const C = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Playfair+Display:wght@600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0} body{font-family:'DM Sans',sans-serif;background:#0d1b2e}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{opacity:.3;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes rip{0%{transform:scale(1);opacity:.5}100%{transform:scale(2.8);opacity:0}}
    .sc:hover{transform:translateY(-3px)} .sc{transition:all .2s;cursor:pointer}
    input:focus{outline:none} ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
  `;

  if (screen === "setup") return (
    <><style>{C}</style>
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#0d1b2e,#1a2f4a)",display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 20px 80px"}}>
      <div style={{width:"100%",maxWidth:460}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:48,marginBottom:12}}>🇬🇧</div>
          <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,color:"#fff",marginBottom:8}}>British English Practice</h1>
          <p style={{color:"#8aaccc",fontSize:14}}>API anahtarlarını gir, başla!</p>
        </div>
        {[
          {label:"🔑 Gemini API Key", hint:"aistudio.google.com → Get API Key", val:anthropicKey, set:setAnthropicKey, ph:"AIza..."},
          {label:"🎤 OpenAI Key (ses için)", hint:"platform.openai.com → API Keys · $5 ücretsiz kredi", val:openaiKey, set:setOpenaiKey, ph:"sk-..."},
        ].map(f => (
          <div key={f.ph} style={{background:"rgba(255,255,255,.06)",borderRadius:14,padding:16,marginBottom:12,border:"1px solid rgba(255,255,255,.1)"}}>
            <div style={{color:"#fff",fontWeight:600,fontSize:14,marginBottom:3}}>{f.label}</div>
            <div style={{color:"#7a90aa",fontSize:12,marginBottom:8}}>{f.hint}</div>
            <input type="password" placeholder={f.ph} value={f.val} onChange={e=>f.set(e.target.value)}
              style={{width:"100%",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,padding:"10px 14px",color:"#fff",fontSize:14}}/>
          </div>
        ))}
        {error && <div style={{color:"#e07070",textAlign:"center",marginBottom:12,fontSize:13}}>{error}</div>}
        <button onClick={()=>{if(!anthropicKey.trim()){setError("Gemini key gerekli!");return;}setError("");setScreen("home");}}
          style={{width:"100%",background:"#2d5a8e",border:"none",borderRadius:12,padding:14,color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer"}}>Başla →</button>
      </div>
    </div></>
  );

  if (screen === "home") return (
    <><style>{C}</style>
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#0d1b2e,#1a2f4a)",padding:"40px 20px 80px",display:"flex",flexDirection:"column",alignItems:"center"}}>
      <div style={{width:"100%",maxWidth:520}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:40,marginBottom:10}}>🇬🇧</div>
          <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:26,color:"#fff",marginBottom:6}}>Senaryo Seç</h1>
          <p style={{color:"#8aaccc",fontSize:13}}>🎤 Sesli konuş · 🔊 British accent · 👆 Balona bas → metni gör</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {SCENARIOS.map((sc,i)=>(
            <div key={sc.id} className="sc" onClick={()=>startChat(sc)}
              style={{background:"rgba(255,255,255,.04)",borderTop:`2px solid ${sc.color}`,border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:16,animation:`fadeUp ${.3+i*.06}s ease`}}>
              <div style={{fontSize:24,marginBottom:8}}>{sc.emoji}</div>
              <div style={{color:"#fff",fontWeight:600,fontSize:14,marginBottom:2}}>{sc.label}</div>
              <div style={{color:"#7a90aa",fontSize:11}}>{sc.sublabel}</div>
            </div>
          ))}
        </div>
        <div style={{textAlign:"center",marginTop:24}}>
          <button onClick={()=>setScreen("setup")} style={{background:"none",border:"none",color:"#5a7a99",cursor:"pointer",fontSize:13}}>⚙️ API Ayarları</button>
        </div>
      </div>
    </div></>
  );

  if (screen === "chat") return (
    <><style>{C}</style>
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"#f2f4f8"}}>
      <div style={{background:"linear-gradient(135deg,#0d1b2e,#1a2f4a)",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <button onClick={()=>{window.speechSynthesis.cancel();setScreen("home");}} style={{background:"none",border:"none",color:"#7eb8c9",cursor:"pointer",fontSize:20}}>←</button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:16}}>{scenario?.emoji}</div>
          <div style={{color:"#fff",fontSize:13,fontWeight:600}}>{scenario?.label}</div>
          <div style={{fontSize:10,color:isSpeaking?"#9ec97e":isRecording?"#e74c3c":"#5a7a99"}}>
            {isSpeaking?"🔊 Speaking...":isRecording?"🎤 Recording...":"👆 Tap to read"}
          </div>
        </div>
        <button onClick={endSession} style={{background:"rgba(220,60,60,.1)",border:"1px solid rgba(220,60,60,.25)",color:"#e07070",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:11,fontWeight:600}}>End</button>
      </div>

      {error&&<div style={{background:"#fef2f2",borderBottom:"1px solid #fca5a5",padding:"7px 14px",fontSize:12,color:"#dc2626",display:"flex",justifyContent:"space-between"}}>
        <span>{error}</span><button onClick={()=>setError("")} style={{background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontSize:16}}>×</button>
      </div>}

      <div style={{flex:1,overflowY:"auto",padding:14}}>
        {messages.map((msg,idx)=>{
          const isUser=msg.role==="user";
          const {main,correction}=parseMsg(msg.content);
          const expanded=expandedIdx===idx;
          const isLatestAI=!isUser&&idx===messages.length-1;
          return(
            <div key={idx} style={{display:"flex",flexDirection:"column",alignItems:isUser?"flex-end":"flex-start",marginBottom:14,animation:"fadeUp .25s ease"}}>
              {!isUser&&<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:4}}><span style={{fontSize:12}}>{scenario?.emoji}</span><span style={{fontSize:10,color:"#999"}}>{scenario?.label}</span></div>}
              <div onClick={()=>setExpandedIdx(expanded?null:idx)} style={{maxWidth:"82%",padding:"10px 14px",cursor:"pointer",
                borderRadius:isUser?"18px 18px 4px 18px":"18px 18px 18px 4px",
                background:isUser?"linear-gradient(135deg,#2d5a8e,#1a3d6b)":isSpeaking&&isLatestAI?"#f0fff4":"#fff",
                border:isUser?"none":`1px solid ${isSpeaking&&isLatestAI?"#9ec97e":"#eee"}`,
                boxShadow:isUser?"0 2px 10px rgba(45,90,142,.3)":"0 1px 4px rgba(0,0,0,.08)"}}>
                {expanded
                  ?<span style={{fontSize:15,color:isUser?"#fff":"#111",lineHeight:1.6}}>{main}</span>
                  :<span style={{fontSize:isUser?15:24,color:isUser?"#fff":"#111"}}>{isUser?main:(isSpeaking&&isLatestAI?"🔊":"💬")}</span>}
              </div>
              {!isUser&&!expanded&&<div style={{fontSize:10,color:"#bbb",marginTop:2,paddingLeft:4}}>tap to read</div>}
              {expanded&&correction&&<div style={{marginTop:6,background:"#fffbea",borderLeft:"3px solid #e6c233",borderRadius:10,padding:"8px 12px",maxWidth:"82%",fontSize:13,color:"#7a5c00",lineHeight:1.55}}>✏️ {correction}</div>}
            </div>
          );
        })}
        {loading&&<div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0"}}>
          <span style={{fontSize:14}}>{scenario?.emoji}</span>
          {[0,1,2].map(d=><div key={d} style={{width:7,height:7,borderRadius:"50%",background:"#aaa",animation:`pulse 1.2s ease ${d*.2}s infinite`}}/>)}
        </div>}
        <div ref={bottomRef}/>
      </div>

      <div style={{background:"#fff",borderTop:"1px solid #e0e4ea",padding:"12px 14px 24px",flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
        <div style={{position:"relative"}}>
          {isRecording&&<div style={{position:"absolute",inset:-8,borderRadius:"50%",background:"rgba(220,60,60,.2)",animation:"rip 1s ease infinite"}}/>}
          <button onClick={isRecording?stopRecording:startRecording} disabled={loading||isSpeaking}
            style={{width:64,height:64,borderRadius:"50%",border:"none",cursor:loading||isSpeaking?"not-allowed":"pointer",fontSize:26,
              background:isRecording?"linear-gradient(135deg,#c0392b,#e74c3c)":loading||isSpeaking?"#b0bec5":"linear-gradient(135deg,#2d5a8e,#1a3d6b)",
              boxShadow:isRecording?"0 0 0 3px rgba(220,60,60,.25)":"0 4px 14px rgba(45,90,142,.35)"}}>
            {isRecording?"⏹":isSpeaking?"🔊":"🎤"}
          </button>
        </div>
        <div style={{fontSize:11,color:isRecording?"#e74c3c":"#aaa",textAlign:"center"}}>
          {isRecording?"Kaydediliyor... durdurmak için bas":isSpeaking?"Konuşuyor...":"Konuşmak için bas"}
        </div>
        {isSpeaking&&<button onClick={()=>{window.speechSynthesis.cancel();setIsSpeaking(false);}} style={{background:"rgba(220,60,60,.08)",border:"1px solid rgba(220,60,60,.25)",borderRadius:20,padding:"4px 12px",color:"#e07070",fontSize:12,cursor:"pointer"}}>⏹ Durdur</button>}
      </div>
    </div></>
  );

  return (
    <><style>{C}</style>
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#0d1b2e,#1a2f4a)",padding:"28px 16px 80px",display:"flex",flexDirection:"column",alignItems:"center"}}>
      <div style={{width:"100%",maxWidth:540}}>
        <div style={{textAlign:"center",marginBottom:22}}>
          <div style={{fontSize:32,marginBottom:8}}>📋</div>
          <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:"#fff",marginBottom:4}}>Session Review</h1>
          <p style={{color:"#7a90aa",fontSize:13}}>{scenario?.emoji} {scenario?.label}</p>
        </div>
        {summaryLoading
          ?<div style={{textAlign:"center",padding:"50px 0"}}><div style={{width:34,height:34,border:"3px solid rgba(126,184,201,.2)",borderTop:"3px solid #7eb8c9",borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 12px"}}/><p style={{color:"#7a90aa",fontSize:13}}>Analysing...</p></div>
          :<div style={{background:"#fff",borderRadius:14,padding:"20px 18px"}}><pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit",fontSize:13,color:"#333",lineHeight:1.7}}>{summary}</pre></div>
        }
        {!summaryLoading&&<div style={{display:"flex",gap:10,marginTop:16,justifyContent:"center"}}>
          <button onClick={()=>startChat(scenario)} style={{background:"#2d5a8e",border:"none",borderRadius:12,padding:"10px 20px",color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}>Try Again ↩</button>
          <button onClick={()=>setScreen("home")} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.15)",borderRadius:12,padding:"10px 20px",color:"#7eb8c9",fontWeight:600,fontSize:13,cursor:"pointer"}}>New Scenario</button>
        </div>}
      </div>
    </div></>
  );
}
