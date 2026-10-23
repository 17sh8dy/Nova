/* Nova homepage directory — add products here, not in the HTML. */
(() => {
  const categories = ['AI & Computing', 'Creative Tools', 'Gaming', 'Community & Engagement', 'Help & Support'];
  const products = [
    {name:'Atlas', category:categories[0], description:'Your AI assistant, built to help you get things done.', icon:'assets/brand/atlas.svg', url:'https://atlas-website.shadylabs.workers.dev/', status:'available'},
    {name:'NovaOS', category:categories[0], description:'A fresh way to experience your desktop. Your space, your workflow.', glyph:'◈', status:'soon'},
    {name:'NovaCut', category:categories[1], description:'Your vision, your timeline. Create and edit without the clutter.', icon:'assets/brand/novacut.svg', url:'https://nova-cut-site.shadylabs.workers.dev/', status:'available'},
    {name:'Replay.GG', category:categories[1], description:'Every great moment deserves a replay. Capture your best plays.', icon:'assets/brand/replay-gg.svg', url:'https://replay-gg-site.shadylabs.workers.dev/', status:'available'},
    {name:'NovaGames', category:categories[2], description:'Experience Nova’s games. New worlds, new adventures, and more to discover.', glyph:'✧', status:'soon'},
    {name:'Nova.Donate', category:categories[3], description:'Help shape what comes next. Support the projects you believe in.', glyph:'♡', status:'soon'},
    {name:'Nova.Review', category:categories[3], description:'Your voice matters. Share ideas, leave reviews, and help Nova grow.', glyph:'★', url:'https://nova-review.shadylabs.workers.dev/', status:'available'},
    {name:'Nova.Help', category:categories[4], description:'Guides, answers, and support for Nova products.', glyph:'?', url:'https://nova-help.shadylabs.workers.dev/', status:'available'}
  ];
  const grid=document.getElementById('nova-product-grid');
  const filters=document.getElementById('nova-category-filters');
  const input=document.getElementById('nova-product-search');
  const count=document.getElementById('nova-result-count');
  if(!grid||!filters||!input||!count)return;
  let selected='All';
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  for(const category of ['All',...categories]){
    const button=document.createElement('button');button.type='button';button.className='nova-filter';button.textContent=category;
    button.dataset.category=category;button.setAttribute('aria-pressed',String(category===selected));
    button.addEventListener('click',()=>{selected=category;render()});filters.append(button);
  }
  function render(){
    const query=input.value.trim().toLocaleLowerCase();
    const visible=products.filter(p=>(selected==='All'||p.category===selected)&&[p.name,p.category,p.description].join(' ').toLocaleLowerCase().includes(query));
    filters.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===selected)));
    count.textContent=`${visible.length} ${visible.length===1?'product':'products'}`;
    const card=p=>{
      const icon=p.icon?`<img src="${escape(p.icon)}" alt="" loading="lazy" width="42" height="42">`:`<span class="nova-product-glyph" aria-hidden="true">${escape(p.glyph)}</span>`;
      const available=p.status==='available';
      const contents=`<span class="nova-product-top"><span class="nova-product-icon">${icon}</span><span class="nova-product-status ${available?'is-available':''}">${available?'Available':'Coming soon'}</span></span><span class="nova-product-category">${escape(p.category)}</span><strong class="nova-product-name">${escape(p.name)}</strong><span class="nova-product-description">${escape(p.description)}</span><span class="nova-product-action">${available?'Visit website ↗':'On the horizon ✦'}</span>`;
      return available?`<a class="nova-product" href="${escape(p.url)}" rel="noopener noreferrer">${contents}</a>`:`<article class="nova-product nova-product--soon">${contents}</article>`;
    };
    const available=visible.filter(p=>p.status==='available');
    const upcoming=visible.filter(p=>p.status!=='available');
    grid.innerHTML=visible.length ?
      `${available.length?`<div class="nova-grid-section"><h3 class="nova-grid-heading">Available now <span>${available.length}</span></h3><div class="nova-grid-cards">${available.map(card).join('')}</div></div>`:''}${upcoming.length?`<div class="nova-grid-section nova-grid-section--upcoming"><h3 class="nova-grid-heading">On the horizon ✦ <span>${upcoming.length}</span></h3><div class="nova-grid-cards">${upcoming.map(card).join('')}</div></div>`:''}` :
      '<p class="nova-empty">No products match your search.</p>';
  }
  document.querySelectorAll('[data-nova-category]').forEach(link=>link.addEventListener('click',()=>{
    selected=link.dataset.novaCategory;
    input.value='';
    render();
  }));
  input.addEventListener('input',render);render();
})();
