// Isolated real-browser test of the production access panel. No external requests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const playwright=require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root=path.resolve(__dirname,'..');
(async()=>{
  let checks=0;
  for(const engine of ['chromium','webkit']){
    const browser=await playwright[engine].launch({headless:true});
    try {
      for(const width of [320,393,1440]){
        const page=await browser.newPage({viewport:{width,height:844}});
        await page.route('**/*',r=>r.abort());
        await page.setContent('<meta name="viewport" content="width=device-width"><div id="holder" class="document-access"></div>');
        await page.addStyleTag({content:fs.readFileSync(path.join(root,'public/css/document-access.css'),'utf8')});
        await page.addScriptTag({content:fs.readFileSync(path.join(root,'public/js/document-access.js'),'utf8')});
        await page.evaluate(()=>{
          window.fixture={ready:true,failed:false,revoked:false,calls:[],rows:[
            {profile_id:'admin',display_name:'Julia Verwaltung',reason:'Verwaltung',can_read:true,has_share:false},
            {profile_id:'tenant',display_name:'Persönlicher Kontakt mit einem sehr langen Namen <script>attack()</script>',reason:'Persönliche Freigabe',can_read:true,has_share:true},
            {profile_id:'blocked',display_name:'Gesperrter Kontakt',reason:'Persönliche Freigabe',can_read:false,has_share:true}
          ]};
          window.client={rpc(name,args){
            const f=window.fixture;f.calls.push({name,args});
            if(name==='document_privacy_ready')return Promise.resolve({data:f.ready,error:null});
            if(name==='get_document_readers')return {range:async(a,b)=>({data:f.rows.slice(a,b+1),error:f.failed ? {} : null})};
            if(name==='revoke_document_reader'){
              f.rows=f.rows.filter(r=>r.profile_id!==args.p_profile_id);f.revoked=true;return Promise.resolve({data:null,error:null});
            }
            throw Error(name);
          }};
          return VeraDocumentAccess.mount(document.getElementById('holder'),client,'file');
        });
        assert.equal(await page.getByRole('button',{name:'Freigabe entziehen'}).count(),2); checks++;
        assert.ok((await page.locator('#holder').innerText()).includes('derzeit gesperrt'));checks++;
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
        await page.getByRole('button',{name:'Freigabe entziehen'}).first().click();
        await page.waitForFunction(()=>window.fixture.revoked && !document.getElementById('holder').textContent.includes('sehr langen'));
        assert.equal(await page.getByRole('button',{name:'Freigabe entziehen'}).count(),1);checks++;
        await page.evaluate(()=>{fixture.failed=true;return VeraDocumentAccess.mount(document.getElementById('holder'),client,'file');});
        assert.ok((await page.locator('#holder').innerText()).includes('nicht bestätigt'));checks++;
        assert.equal(await page.getByRole('button').count(),0);checks++;
        await page.evaluate(()=>{fixture.ready=false;return VeraDocumentAccess.mount(document.getElementById('holder'),client,'file');});
        assert.ok((await page.locator('#holder').innerText()).includes('nicht bestätigt'));checks++;
        // Multiple pages: do not silently omit recipients beyond PostgREST row limits.
        await page.evaluate(()=>{
          fixture.ready=true;fixture.failed=false;
          fixture.rows=Array.from({length:501},(_,i)=>({profile_id:String(i),display_name:'Kontakt '+i,reason:'Persönliche Freigabe',can_read:true,has_share:false}));
          return VeraDocumentAccess.mount(document.getElementById('holder'),client,'file');
        });
        assert.equal(await page.locator('.document-reader-row').count(),501);checks++;
        await page.close();
      }
    } finally {await browser.close();}
  }
  console.log(checks+' browser checks passed (Chromium/WebKit, 320/393/1440px)');
})().catch(err=>{console.error(err);process.exitCode=1;});
