/* Homepage theme picker: opt-in, persistent, and independent of Nova Accounts. */
(() => {
  const control=document.querySelector('.nova-theme-control');
  if(!control)return;
  const toggle=control.querySelector('.nova-theme-toggle');
  const panel=control.querySelector('.nova-theme-panel');
  const choices=[...panel.querySelectorAll('[data-nova-theme]')];
  const storageKey='nova-homepage-theme-v3';
  let selected='default';
  try { if(localStorage.getItem(storageKey)==='aurora') selected='aurora'; } catch (_) {}
  function setTheme(value,save){
    selected=value==='aurora'?'aurora':'default';
    if(selected==='aurora') document.documentElement.setAttribute('data-theme','aurora');
    else document.documentElement.removeAttribute('data-theme');
    choices.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.novaTheme===selected)));
    if(save)try{localStorage.setItem(storageKey,selected)}catch(_){}
  }
  function close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false')}
  setTheme(selected,false);
  toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden))});
  choices.forEach(button=>button.addEventListener('click',()=>{setTheme(button.dataset.novaTheme,true);close();toggle.focus()}));
  document.addEventListener('pointerdown',event=>{if(!control.contains(event.target))close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();toggle.focus()}});
})();
