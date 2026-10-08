import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20261008051614_audit_storefront_filtered_search.sql',import.meta.url),'utf8');

async function fixture() {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;
    create table products(id uuid default gen_random_uuid(),sku text,name_th text,name_en text,brand text,
      group_name text,category_name_th text,tags text[] default '{}',feature_tags text[] default '{}',is_featured boolean default false);
    create view storefront_products with(security_invoker=true)as select * from products;
    grant select on products,storefront_products to anon,authenticated;`);
  const rows=[
    ['2020000001','กระดาษทรายกลมสักหลาด SA331 5" #180','DEERFOS SA331 Velcro Sanding Disc 5" P180','DEERFOS'],
    ['2020000992','กระดาษทรายกลมสักหลาด SA331 5" #1500','DEERFOS SA331 Velcro Sanding Disc 5" P1500','DEERFOS'],
    ['2020000003','กระดาษทรายกลมสักหลาด SA331VC 5" #1500',null,'DEERFOS'],
    ['2020000004','กระดาษทรายกลมสักหลาด SA331 7" #1500',null,'DEERFOS'],
    ['2020006681','กระดาษทรายกลมสักหลาด PS33 5" #180',null,'DEERFOS'],
    ['2020002620','ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 6นิ้วx10M. #320','Non-Woven Scotch Brite 6"x10M #320','JNAC'],
    ['2020002621','ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 7447 6"x10M. #320',null,'3M'],
    ['2020002622','ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 6"x10M. #7447',null,'JNAC'],
    ['2020002624','Non-Woven Scotch Brite Roll 6\"x10M. #320',null,'JNAC'],
    ['2020002623','ล้อขัดใยสังเคราะห์ สก๊อตไบร์ท 6" #320','Nonwoven Wheel 6" #320','JNAC'],
    ['2020000905','ผ้าทรายสายพาน PACO รุ่น Y966 10x330mm. #60','PACO Y966 Sanding Belt 10x330mm P60','PACO'],
  ];
  for(const row of rows)await db.query('insert into products(sku,name_th,name_en,brand)values($1,$2,$3,$4)',row);
  await db.exec(migration);
  return db;
}
const search=async(db,q)=>(await db.query('select sku from search_storefront_products($1,0,1000)',[q])).rows.map(row=>row.sku).sort();

test('kind/model/inch/grit facets ignore query order and preserve exact variant and model suffix',async()=>{
  const db=await fixture();try {
    for(const query of ['กระดาษทรายกลมสักหลาด SA331 5นิ้ว เบอร์1500','#1500 DEERFOS SA 331 ขนาด 5 inch','SA331 5" P1500','SA331 5 นิ้ว grit=1500']) {
      assert.deepEqual(await search(db,query),['2020000992'],query);
    }
    assert.deepEqual(await search(db,'SA331VC 5นิ้ว #1500'),['2020000003']);
    assert.deepEqual(await search(db,'MIRKA SA331 5นิ้ว #1500'),[]);
    assert.deepEqual(await search(db,'2020000992'),['2020000992']);
    assert.deepEqual(await search(db,'SKU: 2020000992 SA331'),['2020000992']);
    assert.deepEqual(await search(db,'SA331 5นิ้ว #180'),['2020000001']);
  }finally{await db.close();}
});

test('proven Scotchbrite aliases and word-order swaps find roll options without mixing wheel or numeric grit',async()=>{
  const db=await fixture();try {
    for(const query of ['มีใยขัดสก๊อตไบร์ท ม้วนไหมครับ','ม้วนใยสังเคราะห์ สก๊อตไบรท์','scotch brite roll','สก๊อตไบร์ทแบบม้วน 6นิ้ว x 10 เมตร เบอร์320']) {
      const skus=await search(db,query);
      assert.ok(skus.includes('2020002620'),query);assert.ok(skus.includes('2020002621'),query);assert.ok(skus.includes('2020002624'),query);assert.ok(!skus.includes('2020002623'),query);
    }
    assert.deepEqual(await search(db,'ม้วนสก๊อตไบรท์ รุ่น7447 6นิ้วx10M #320 =4 ม้วน'),['2020002621']);
    const facts=(await db.query('select storefront_search_facets($1,true) value',['7447 #320'])).rows[0].value;
    assert.deepEqual(facts.grits,['#320']);assert.deepEqual(facts.tokens,['7447']);
    assert.deepEqual(await search(db,'7447 #320'),['2020002621']);
    assert.deepEqual(await search(db,'3M ม้วนใยขัด #320'),['2020002621']);
  }finally{await db.close();}
});

test('belt tuple and single-letter catalog model remain distinct from grit and quantity',async()=>{
  const db=await fixture();try {
    for(const query of ['ผ้าทรายสายพาน PACO Y966 10 x 330 มม. เบอร์60','P60 10×330mm Y966 PACO','PACO รุ่น Y 966 10x330mm No.60']) {
      assert.deepEqual(await search(db,query),['2020000905'],query);
    }
    assert.deepEqual(await search(db,'Y966 10x330mm #600'),[]);
    assert.deepEqual(await search(db,'Y966 10x330นิ้ว #60'),[]);
    assert.deepEqual(await search(db,'มีไหมครับ'),[]);
    const facts=(await db.query('select storefront_search_facets($1,true) value',['Y966 10x330mm grit=60 =100 เส้น'])).rows[0].value;
    assert.deepEqual(facts.models,['y966']);assert.deepEqual(facts.sizes,['10x330mm']);assert.deepEqual(facts.grits,['#60']);
  }finally{await db.close();}
});

test('group ranges and metadata cannot supply a SKU grit, size, backing or model',async()=>{
  const db=await fixture();try {
    await db.query(`insert into products(sku,name_th,name_en,brand,group_name,category_name_th,tags,feature_tags)
      values($1,$2,$3,$4,$5,$6,$7,$8)`,[
      '2020003042','กระดาษทรายกลมหลังกาว MIRKA GOLD 5" #400','MIRKA GOLD PSA Link Roll Disc 5" #400','MIRKA',
      'finishing MIRKA GOLD 5" #80-#500','กระดาษทรายกลมสักหลาด SA331 7" #500',
      ['SA331','7นิ้ว','#500','สักหลาด'],['PS36','8นิ้ว','#80'],
    ]);
    for(const query of ['MIRKA GOLD 5" #500','2020003042 #500','MIRKA GOLD 7นิ้ว #400','MIRKA GOLD 5นิ้ว #400 สักหลาด','MIRKA SA331 #400','MIRKA PS36 #400']) {
      assert.deepEqual(await search(db,query),[],query);
    }
    assert.deepEqual(await search(db,'MIRKA GOLD 5นิ้ว #400 หลังกาว'),['2020003042']);
    assert.deepEqual(await search(db,'finishing 5นิ้ว #400'),['2020003042']);
  }finally{await db.close();}
});

test('same fixture improves semantic recall and reduces returned payload without changing limits or exact constraints',async()=>{
  const db=await fixture();try {
    await db.exec(`insert into products(sku,name_th,brand)select '90'||lpad(i::text,8,'0'),'กระดาษทรายกลมสักหลาด PS40 5" #80','DEERFOS' from generate_series(1,2500)i;`);
    const full=(await db.query('select * from storefront_products')).rows;
    const queries=[
      ['กระดาษทรายกลมสักหลาด SA331 5นิ้ว เบอร์1500','2020000992'],
      ['#1500 DEERFOS SA 331 ขนาด 5 inch','2020000992'],
      ['SA331 5" P1500','2020000992'],
      ['SA331 5 นิ้ว grit=1500','2020000992'],
      ['มีใยขัดสก๊อตไบร์ท ม้วนไหมครับ','2020002620'],
      ['ม้วนใยสังเคราะห์ สก๊อตไบรท์','2020002620'],
      ['scotch brite roll','2020002620'],
      ['สก๊อตไบร์ทแบบม้วน 6นิ้ว x 10 เมตร เบอร์320','2020002620'],
      ['ผ้าทรายสายพาน PACO Y966 10 x 330 มม. เบอร์60','2020000905'],
      ['P60 10×330mm Y966 PACO','2020000905'],
      ['PACO รุ่น Y 966 10x330mm No.60','2020000905'],
      ['SKU: 2020000992 SA331','2020000992'],
    ];
    let beforeRecall=0;let afterRecall=0;
    for(const [query,wanted]of queries) {
      const words=query.toLowerCase().split(/\s+/).filter(Boolean);
      const before=full.filter(p=>words.every(word=>[p.name_th,p.name_en,p.sku,p.brand,p.group_name,p.category_name_th,...p.tags,...p.feature_tags].filter(Boolean).join(' ').toLowerCase().includes(word)));
      if(before.some(p=>p.sku===wanted))beforeRecall++;
      if((await search(db,query)).includes(wanted))afterRecall++;
    }
    assert.equal(afterRecall,queries.length);
    assert.ok(beforeRecall<afterRecall);
    const durations=[];let selected;
    for(let i=0;i<5;i++){
      const start=performance.now();
      selected=(await db.query('select * from search_storefront_products($1,0,1000)',['SA331 5นิ้ว เบอร์1500'])).rows;
      durations.push(performance.now()-start);
    }
    assert.deepEqual(selected.map(p=>p.sku),['2020000992']);
    const beforeBytes=Buffer.byteLength(JSON.stringify(full));const afterBytes=Buffer.byteLength(JSON.stringify(selected));
    durations.sort((a,b)=>a-b);
    console.log(`Structured fixture recall ${beforeRecall}/${queries.length} -> ${afterRecall}/${queries.length}; payload ${full.length} -> ${selected.length} rows, ${beforeBytes} -> ${afterBytes} bytes; warm query median ${durations[2].toFixed(2)} ms (local PGlite only)`);
  }finally{await db.close();}
});
