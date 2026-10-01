const fx=0.92, vat=1.2, fee=p=>0.05*p+0.46, net=p=>p/vat-fee(p);
const N={free:0, personal:9, pro3:20, pro5:33, pro20:126}; // USD/month (pro5 from Netlify changelog, pro20 & others from the owner's screenshot)
const ai={flash:2.5, high:7.5, knight:25}; const dom=8.35;
const plans={flash:[9.99,99.9], high:[29.99,299.9], knight:[99.99,999.9]};
const map={m:{flash:'personal',high:'pro3',knight:'pro5'}, y:{flash:'pro3',high:'pro5',knight:'pro20'}};
const r=x=>x.toFixed(2);
console.log('plan|period|price|net|AI max|netlify €|domain|остава|остава при 40% AI|break-even цена|цена за 25% марж');
for(const k of ['flash','high','knight']) for(const [per,i,months] of [['месец',0,1],['година',1,12]]){
  const P=plans[k][i], tier=map[per==='месец'?'m':'y'][k], host=N[tier]*fx*months, A=ai[k]*months, d=per==='година'?dom:0;
  const left=net(P)-A-host-d, left40=net(P)-0.4*A-host-d;
  const costs=A+host+d, be=(costs+0.46)/(1/vat-0.05), rec=(costs+0.46)/(1/vat-0.05-0.25/vat);
  console.log([k,per,P,r(net(P)),r(A),r(host)+' ('+tier+')',r(d),r(left),r(left40),r(be),r(rec)].join('|'));
}
