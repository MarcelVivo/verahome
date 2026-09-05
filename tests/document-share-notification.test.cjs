const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.env.TYPESCRIPT_MODULE || 'typescript');
const source = fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared/document-share.ts'),'utf8');
const compiled = ts.transpileModule(source.replace(/^import .*;$/m,''), {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}, reportDiagnostics:true
});
assert.equal((compiled.diagnostics || []).length,0);
function fixture(options={}){
  const sent=[];
  const caller={auth:{getUser:async()=>options.unauthenticated ? {error:{}} : {data:{user:{id:'admin'}}}}};
  const admin={from(table){
    let single=false;
    const query={select(){return query;},eq(){return query;},in(){return query;},is(){return query;},
      single(){single=true;return query;},maybeSingle(){single=true;return query;},
      then(resolve,reject){
        let result;
        if(table==='profiles' && single) result={data:{category:options.category||'admin',status:options.status||'active',archived_at:options.archived||null}};
        else if(table==='profiles') result={data:[{id:'recipient',first_name:'<img src=x>',email:'fixture@example.invalid'}]};
        else if(table==='document_files') result={data:options.noFiles ? [] : [{id:'file'}]};
        else if(table==='portal_settings') result=options.settingsError ? {error:{}} : {data:{value:{mode:options.testMode ? 'test' : 'live'}}};
        else if(table==='document_shares') result={data:options.noGrant ? [] : [{file_id:'file'}]};
        else throw new Error('Unexpected table '+table);
        return Promise.resolve(result).then(resolve,reject);
      }};
    return query;
  }};
  let count=0;
  const sandbox={exports:{},Request,Response,Uint8Array,Deno:{env:{get:()=>''}},
    createClient:()=>++count===1 ? caller : admin,
    fetch:async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(init.body));return {ok:true};}};
  vm.runInNewContext(compiled.outputText,sandbox);
  return {sent,run:(body={fileIds:['file'],profileIds:['recipient']})=>sandbox.exports.handleDocumentShare(new Request('https://fixture.test',{method:'POST',body:JSON.stringify(body)}))};
}
test('notification contains only portal link, no attachment, title, signed URL or storage download',async()=>{
  const f=fixture();assert.equal((await f.run()).status,200);assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].attachments,undefined);
  assert.ok(f.sent[0].html.includes('https://www.verahome.ch/portal/documents.html'));
  assert.ok(!f.sent[0].html.includes('<img src=x>'));
  assert.ok(!source.includes('.download('));
});
for(const options of [{unauthenticated:true},{category:'mieter'},{status:'blocked'},{archived:'2026-01-01'},{noFiles:true}]){
  test('reject unauthorized notification '+JSON.stringify(options),async()=>{
    const f=fixture(options);assert.ok((await f.run()).status>=400);assert.equal(f.sent.length,0);
  });
}
for(const options of [{noGrant:true},{testMode:true},{settingsError:true}]){
  test('no outgoing notification '+JSON.stringify(options),async()=>{const f=fixture(options);await f.run();assert.equal(f.sent.length,0);});
}
test('external recipients rejected without sending or exposing files',async()=>{
  const f=fixture();assert.equal((await f.run({fileIds:['file'],profileIds:[],externalEmails:['external@example.invalid']})).status,400);
  assert.equal(f.sent.length,0);
});
