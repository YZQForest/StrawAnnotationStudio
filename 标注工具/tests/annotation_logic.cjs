// Exercise real frontend algorithms without executing DOM boot code.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const script=fs.readFileSync(path.join(__dirname,'../src/strawannotate/web/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../src/strawannotate/web/index.html'),'utf8');
const elements=new Map();
const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'6',clientWidth:800,clientHeight:700,offsetLeft:20});return elements.get(id);};
const c=vm.createContext({$,TextEncoder,enc:new TextEncoder(),Math,Number,String,Map,Set,Uint8Array,current:{width:16,height:12,label:new Uint8Array(192),valid:new Uint8Array(192).fill(255)},selectedClass:'255',reviewIndex:-1,zoom:1,allowEdit:()=>true,snapshot:()=>{},endEdit:()=>{},message:()=>{},setZoom:z=>c.zoom=z});
for(const name of ['count','csvCell','addSummary','reviewTile','parseCSV','write','stamp','stroke']){
 const start=script.indexOf('function '+name+'(');assert(start>=0,name);
 const tail=script.slice(start),end=tail.indexOf('\n}')+2;assert(end>1,name);vm.runInContext(tail.slice(0,end),c);
}
vm.runInContext('stamp([5.5,5.5])',c);
for(let y=0;y<12;y++)for(let x=0;x<16;x++)assert.equal(c.current.label[y*16+x],(x-5)**2+(y-5)**2<=9?255:0);
$('brush-number').value='1';
vm.runInContext('stamp([0.01,0.01])',c);assert.equal(c.current.label[0],255);
c.current.label=new Uint8Array([255,128,64,64,0]);c.current.valid=new Uint8Array([255,255,255,0,255]);
assert.equal(vm.runInContext('count(current).coverage_pp',c),null);
assert.equal(vm.runInContext('count(current).coverage_lower_pp',c),25);
assert.equal(vm.runInContext('count(current).coverage_upper_pp',c),75);
const files=new Map();c.files=files;
vm.runInContext(`addSummary(files,[{sample_id:'a',original_file_name:'a.png',status:'completed',statistics:{coverage_pp:null,coverage_lower_pp:25,coverage_upper_pp:50},source:{video_id:'v1',frame_id:0,timestamp_sec:0}}])`,c);
const csv=new TextDecoder().decode(files.get('summary.csv'));assert(csv.includes('"v1","0","0"'));assert(csv.includes('"completed","","25","50"'));
assert.equal(vm.runInContext(`parseCSV('a,b\\r\\n"x,y",0\\r\\n')[0].a`,c),'x,y');
assert.throws(()=>vm.runInContext(`parseCSV('a,a\\nx,y')`,c),/重复/);
assert.throws(()=>vm.runInContext(`parseCSV('a,b\\n"x,y')`,c),/未闭合/);
for(const id of [...script.matchAll(/\$\("([^"\n]+)"\)/g)].map(m=>m[1]))assert(html.includes(`id="${id}"`),'Missing UI element '+id);
assert(!/fillPolygon|commitPolygon|legacyMask|data-tool/.test(script));
console.log('PASS: integer brush footprint, coverage bounds, zero provenance, CSV escaping, UI bindings and removed drawing modes.');
