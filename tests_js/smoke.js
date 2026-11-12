const {JSDOM}=require("jsdom");const fs=require("fs");
const fx=JSON.parse(fs.readFileSync("/tmp/jsd/fixture.json"));
const dom=new JSDOM(`<!DOCTYPE html><body></body>`,{runScripts:"outside-only",pretendToBeVisual:true});
const w=dom.window; const errs=[];
w.confirm=()=>true; w.CSS={escape:(s)=>s.replace(/[^\w-]/g,"\\$&")};
w.addEventListener("error",e=>errs.push(e.message));
w.eval(fs.readFileSync(process.argv[2],"utf8"));
const calls=[];
const hass={states:{"switch.heater":{state:"on",attributes:{friendly_name:"Heater"}},"sensor.t":{state:"77",attributes:{}}},services:{notify:{pushover:{}}},
 callWS:async(m)=>{calls.push(m);if(m.type==="sentinel_controller/get")return fx;return {config:fx.config,status:fx.status}},
 connection:{subscribeMessage:async(cb)=>{setTimeout(()=>cb({status:fx.status}),5);return ()=>{}}}};
(async()=>{
 const el=w.document.createElement("sentinel-controller-card");el.setConfig({});w.document.body.appendChild(el);el.hass=hass;
 await new Promise(r=>setTimeout(r,50));
 const pages=["dashboard","sensors","channels","timers","illumination","feed","maintenance","level","logic","reminders","notify","system"];
 for(const p of pages){
   try{el.shadowRoot.querySelector(`[data-nav="${p}"]`).click();await new Promise(r=>setTimeout(r,5));
   const t=el.shadowRoot.querySelector(".main").textContent;if(t.length<20)errs.push("empty "+p);
   const op=el.shadowRoot.querySelector("[data-open]"); if(op){op.click();await new Promise(r=>setTimeout(r,5));}
   }catch(e){errs.push(p+": "+e.message)}
 }
 // edit: change channel 1 function type & save
 el.shadowRoot.querySelector('[data-nav="channels"]').click(); await new Promise(r=>setTimeout(r,5));
 el.shadowRoot.querySelector('[data-open="1"]').click(); await new Promise(r=>setTimeout(r,5));
 const s=el.shadowRoot.querySelector('select[data-bind="channels.0.fn.type"]'); s.value="timer"; s.dispatchEvent(new w.Event("change",{bubbles:true}));
 await new Promise(r=>setTimeout(r,5));
 const par=el.shadowRoot.querySelector('select[data-bind="channels.0.fn.param"]');
 if(!par) errs.push("no param select after type change"); 
 el.shadowRoot.querySelector('[data-act="save"]').click(); await new Promise(r=>setTimeout(r,20));
 const save=calls.find(c=>c.type==="sentinel_controller/save");
 if(!save||save.value[0].fn.type!=="timer"||save.value[0].fn.param!==1) errs.push("save payload wrong "+JSON.stringify(save&&save.value[0].fn));
 // live status push
 await new Promise(r=>setTimeout(r,20));
 console.log(errs.length?"ERRORS:\n"+errs.join("\n"):"SMOKE OK", calls.map(c=>c.type).join(","));
})();
