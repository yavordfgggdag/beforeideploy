const fx=0.92, vat=1.2, fee=p=>0.05*p+0.46, net=p=>p/vat-fee(p), CR=0.000025, INFRA=1, DOM=8.35;
const NL={free:0,personal:9,pro3:20,pro5:33,pro20:126};
const hostEur=t=>NL[t]*fx; const grossOf=e=>(e+0.46)/(1/vat-0.05); // price incl. VAT that nets e after VAT+fee
const r=x=>(Math.round(x*100)/100).toFixed(2), pct=(a,b)=>(100*a/b).toFixed(0)+'%';
const M={flash:{p:14.99,t:'personal',c:40000,s:1},high:{p:29.99,t:'pro3',c:100000,s:3},knight:{p:99.99,t:'pro5',c:800000,s:10}};
const rows=[];
for(const [k,v] of Object.entries(M)){
  const n=net(v.p), ai=v.c*CR, mx=n-hostEur(v.t)-ai-INFRA, ty=n-hostEur(v.t)-0.4*ai-INFRA;
  rows.push({план:k+' месечно',цена:v.p,netlify:v.t,кредити:v.c,'марж макс':r(mx)+' ('+pct(mx,n)+')','марж тип.':r(ty)+' ('+pct(ty,n)+')'});
  // annual rule: our part ×10 + hosting pass-through ×12 (+ domain at cost)
  const hostGross=grossOf(hostEur(v.t)); const ours=v.p-hostGross; let ap=Math.ceil((ours*10+hostGross*12+grossOf(DOM)-0.46)*1)-0.1;
  const an=net(ap), aai=ai*12, amx=an-hostEur(v.t)*12-aai-INFRA*12-DOM, aty=an-hostEur(v.t)*12-0.4*aai-INFRA*12-DOM;
  rows.push({план:k+' годишно',цена:r(ap),netlify:v.t,кредити:v.c,'марж макс':r(amx)+' ('+pct(amx,an)+')','марж тип.':r(aty)+' ('+pct(aty,an)+')'});
}
// Flash kept at 9.99 with client's own Netlify Free
{ const p=9.99,n=net(p),ai=60000*CR,mx=n-ai-INFRA,ty=n-0.4*ai-INFRA; rows.push({план:'flash месечно (ако остане 9,99; Netlify Free на клиента)',цена:p,netlify:'free',кредити:60000,'марж макс':r(mx)+' ('+pct(mx,n)+')','марж тип.':r(ty)+' ('+pct(ty,n)+')'}); }
console.table(rows);
console.log('пакети:'); for(const [c,p] of [[100000,4.99],[500000,19.99],[1000000,39.99]]){const n=net(p),m=n-c*CR; console.log(c,p,'марж',r(m),pct(m,n));}
console.log('хостинг надграждане +1 ниво (себестойност+15%, бруто):', ['personal→pro3','pro3→pro5','pro5→pro20'].map(s=>{const [a,b]=s.split('→');return s+' '+r(grossOf((hostEur(b)-hostEur(a))*1.15))+' €/мес'}).join(' · '));
