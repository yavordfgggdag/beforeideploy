// Economics of "hosting included" catalogs. Max AI use unless noted; infra €1/month per paid customer (estimate).
const fx=0.92, vat=1.2, feeP=p=>0.05*p+0.46, net=p=>p/vat-feeP(p), CR=0.000025, INFRA=1, DOM=8.35;
const NL={free:0,personal:9,pro3:20,pro5:33,pro10:63,pro20:126}; const host=(t,m)=>NL[t]*fx*m;
const r=x=>(Math.round(x*100)/100).toFixed(2);
function row(name,price,months,tier,credits,domain){ const n=net(price), h=host(tier,months), ai=credits*CR*months, inf=INFRA*months, d=domain?DOM:0;
  const max=n-h-ai-inf-d, typ=n-h-0.4*ai-inf-d; return {name,price,tier,credits,net:r(n),host:r(h),ai:r(ai),margin_max:r(max),pct_max:(100*max/n).toFixed(0)+'%',margin_typ:r(typ),pct_typ:(100*typ/n).toFixed(0)+'%'}; }
// 1) can cutting credits alone fix the owner's mapping at current prices? credits=0
console.log('--- 1. текущи цени, искането съответствие, AI = 0 ---');
console.table([row('Flash м',9.99,1,'personal',0),row('High м',29.99,1,'pro3',0),row('Knight м',99.99,1,'pro5',0),row('Flash г',99.9,12,'pro3',0,1),row('High г',299.9,12,'pro5',0,1),row('Knight г',999.9,12,'pro20',0,1)]);
// 2) recommended V3 catalog
console.log('--- 2. препоръчан каталог V3 ---');
const v3=[row('Free',0.0001,1,'free',10000),row('Flash м',14.99,1,'personal',40000),row('High м',34.99,1,'pro3',100000),row('Knight м',99.99,1,'pro5',600000),
 row('Flash г (11×)',164.9,12,'personal',40000,1),row('High г (11×)',384.9,12,'pro3',100000,1),row('Knight г (11×)',1099.9,12,'pro5',600000,1)];
console.table(v3);
// 3) price needed for the owner's annual tiers with V3 credits at 10% max-use margin
const need=(costs)=>{ for(let p=1;p<5000;p+=0.5){ const n=net(p); if(n-costs>=0.10*n) return p; } };
console.log('--- 3. годишна цена за „+1 ниво“ (10% марж при макс. AI) ---');
for(const [n,t,c] of [['Flash г → Pro 3k','pro3',40000],['High г → Pro 5k','pro5',100000],['Knight г → Pro 20k','pro20',600000]]){ const costs=host(t,12)+c*CR*12+INFRA*12+DOM; console.log(n, '≈ €'+need(costs)); }
// 4) without Netlify agreement: hosting not included (client pays Netlify), current prices
console.log('--- 4. „Свързан хостинг“ (клиентът плаща Netlify), текущи цени ---');
console.table([row('Flash м',9.99,1,'free',100000),row('High м',29.99,1,'free',300000),row('Knight м',99.99,1,'free',1000000),row('Flash г',99.9,12,'free',100000,1),row('High г',299.9,12,'free',300000,1),row('Knight г',999.9,12,'free',1000000,1)]);
