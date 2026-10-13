"use client";
import {useEffect,useRef,useState} from "react";

export function DeploymentGuard({version}:{version:string}){
 const original=useRef(version);
 const [stale,setStale]=useState(false);
 useEffect(()=>{
  let active=true,running=false;
  const controller=new AbortController();
  async function check(){
   if(running||document.visibilityState!=="visible")return;
   running=true;
   try{
    const response=await fetch("/api/version",{cache:"no-store",signal:controller.signal});
    if(response.ok){const value=await response.json();if(active&&typeof value.version==="string"&&value.version!==original.current)setStale(true);}
   }catch{/* A temporary network failure is not evidence of a new release. */}
   finally{running=false;}
  }
  const changed=()=>void check();
  const failure=(event:PromiseRejectionEvent)=>{
   const message=String(event.reason?.message??event.reason??"");
   if(/Failed to find Server Action|Server Action.*not found/i.test(message))changed();
  };
  const timer=window.setInterval(changed,30000);
  window.addEventListener("focus",changed);
  document.addEventListener("visibilitychange",changed);
  window.addEventListener("warehouse-save-error",changed);
  window.addEventListener("unhandledrejection",failure);
  void check();
  return()=>{active=false;controller.abort();window.clearInterval(timer);window.removeEventListener("focus",changed);document.removeEventListener("visibilitychange",changed);window.removeEventListener("warehouse-save-error",changed);window.removeEventListener("unhandledrejection",failure);};
 },[]);
 useEffect(()=>{
  if(!stale)return;
  const stop=(event:Event)=>{if(!(event.target instanceof Element)||event.target.closest("[data-deployment-reload]"))return;event.preventDefault();event.stopImmediatePropagation();};
  document.addEventListener("submit",stop,true);document.addEventListener("click",stop,true);
  return()=>{document.removeEventListener("submit",stop,true);document.removeEventListener("click",stop,true);};
 },[stale]);
 if(!stale)return null;
 return <div role="alertdialog" aria-modal="true" aria-label="Доступна новая версия сайта" style={{position:"fixed",inset:0,zIndex:2147483647,background:"#0008",display:"grid",placeItems:"center"}}>
  <section style={{background:"white",color:"#17243b",padding:24,borderRadius:12,maxWidth:440,margin:16}}>
   <strong>Сайт обновлён</strong><p>Обновите страницу перед следующей операцией. Черновики форм сохранятся. Если сохранение было прервано, сначала проверьте результат — не отправляйте операцию повторно вслепую.</p>
   <button data-deployment-reload type="button" onClick={()=>window.location.reload()}>Обновить страницу</button>
  </section>
 </div>;
}
