// Run actual frontend functions without a browser; this does not verify layout.
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const html = fs.readFileSync(require('path').join(__dirname,'../src/strawannotate/web/index.html'),'utf8');
const script=html.split('<script>')[1].split('</script>')[0];
const elements = new Map();
const $ = id => {if(!elements.has(id))elements.set(id,{textContent:'',onclick:null,clientWidth:800,clientHeight:700,offsetLeft:20});return elements.get(id)};
const context=vm.createContext({$,TextEncoder,enc:new TextEncoder(),Math,Number,String,Map,Uint8Array,current:{width:1024,height:768,label:new Uint8Array([255,128,64,64,0]),valid:new Uint8Array([255,255,255,0,255])},reviewIndex:-1,zoom:1,allowEdit:()=>true,snapshot:()=>{},endEdit:()=>{},message:()=>{},setZoom:z=>{context.zoom=z;}});
for(const name of ['count','csvCell','addSummary','reviewTile']){
 const start=script.indexOf('function '+name+'(');assert(start>=0);
 // Functions are top-level; next function declaration or assignment marks boundary.
 const tail=script.slice(start);let depth=0,end=0,started=false;
 // Slice via next top-level function line for the multi-line added helpers.
 if(['addSummary','reviewTile'].includes(name))end=tail.indexOf('\n}\n')+2;
 else end=tail.indexOf('\n');
 vm.runInContext(tail.slice(0,end),context);
}
const fill=script.match(/\$\('fill-background'\)\.onclick=\(\)=>\{.*?\};/)[0];vm.runInContext(fill,context);
$('fill-background').onclick();
assert.deepEqual(Array.from(context.current.label),[255,128,0,64,0]);
assert.equal(vm.runInContext('count(current).coverage_pp',context),null);
assert.equal(vm.runInContext('count(current).coverage_lower_pp',context),25);
assert.equal(vm.runInContext('count(current).coverage_upper_pp',context),50);
vm.runInContext('reviewTile(1)',context);assert.equal(context.reviewIndex,0);
vm.runInContext('reviewTile(1)',context);assert.equal(context.reviewIndex,1);
assert.deepEqual(Array.from(context.current.label),[255,128,0,64,0]);
const files=new Map();context.files=files;
vm.runInContext("addSummary(files,[{sample_id:'a',original_file_name:'a.png',status:'completed',statistics:{coverage_pp:null,coverage_lower_pp:25,coverage_upper_pp:50},source:{video_id:'v1',frame_id:0,timestamp_sec:0}}])",context);
const csv=new TextDecoder().decode(files.get('summary.csv'));
assert(csv.includes('"v1","0","0"'));assert(csv.includes('"completed","","25","50"'));
assert(files.has('START_HERE.txt'));
console.log('PASS: safe fill, coverage interval, tile navigation, source zero preservation, summary export.');
