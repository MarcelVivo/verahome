// Real PostgreSQL (PGlite), including roles, SECURITY DEFINER and storage RLS.
// PGLITE_MODULE may point at a temporary install; no production credentials used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/document-privacy.sql'), 'utf8');
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table profiles(id uuid primary key, first_name text, last_name text, category text, status text, archived_at timestamptz);
    create table units(id uuid primary key, property_id uuid, archived_at timestamptz);
    create table tenancies(unit_id uuid, tenant_profile_id uuid, status text, archived_at timestamptz, start_date date, end_date date);
    create table ownerships(unit_id uuid, property_id uuid, owner_profile_id uuid, archived_at timestamptz, start_date date, end_date date);
    create table property_permissions(property_id uuid, profile_id uuid, permission text);
    create table document_files(id uuid primary key, property_id uuid, unit_id uuid, contact_profile_id uuid, is_private_admin boolean default false,
      title text, file_path text, mime_type text, size_bytes bigint, archived_at timestamptz, folder_id uuid, created_at timestamptz default now());
    create table document_shares(id uuid default gen_random_uuid() primary key, file_id uuid references document_files,
      profile_id uuid references profiles, created_by uuid, needs_confirmation boolean default false, confirmed_at timestamptz,
      created_at timestamptz default now(), unique(file_id, profile_id));
    create table property_documents(id uuid primary key, property_id uuid, visibility text, file_path text);
    create table property_document_access(property_document_id uuid, profile_id uuid);
    create table documents(id uuid primary key, owner_profile_id uuid, file_path text);
    create table storage.buckets(id text primary key, public boolean);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    insert into storage.buckets values ('document-vault', true), ('property-documents', true), ('documents', true), ('property-images', true);
    alter table document_files enable row level security;
    alter table document_shares enable row level security;
    alter table property_documents enable row level security;
    alter table storage.objects enable row level security;
    -- Simulate leftover broad policies. Restrictive guards must win over these.
    create policy old_file_read on document_files for select using (true);
    create policy old_share_read on document_shares for select using (true);
    create policy old_property_read on property_documents for select using (true);
    create policy old_storage_read on storage.objects for select using (true);
    grant usage on schema public, auth, storage to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public, storage to anon, authenticated;
  `);
  for(let n = 1; n <= 13; n++) await db.query(`insert into profiles values ($1,$2,'Test',$3,$4,$5)`,
    [id(n), 'Person '+n, [10,11].includes(n) ? 'admin' : 'mieter', n===7 ? 'blocked' : n===12 ? 'pending' : 'active', n===11 ? new Date().toISOString() : null]);
  await db.exec(`
    insert into units values ('${id(30)}','${id(20)}',null),('${id(31)}','${id(20)}',null);
    insert into tenancies values
      ('${id(30)}','${id(1)}','active',null,current_date-30,null),
      ('${id(31)}','${id(2)}','active',null,current_date-30,null),
      ('${id(30)}','${id(3)}','active',null,current_date+1,null),
      ('${id(30)}','${id(8)}','active',null,current_date-30,current_date-1),
      ('${id(30)}','${id(9)}','active',null,current_date+30,null);
    insert into ownerships values (null,'${id(20)}','${id(4)}',null,current_date-10,null),
      (null,'${id(20)}','${id(13)}',null,current_date+10,null);
    insert into property_permissions values ('${id(20)}','${id(5)}','hauswart');
    insert into document_files(id,property_id,unit_id,contact_profile_id,title,file_path,archived_at) values
      ('${id(101)}','${id(20)}','${id(30)}','${id(1)}','Personal','personal',null),
      ('${id(102)}','${id(20)}','${id(30)}',null,'Unshared','unshared',null),
      ('${id(103)}','${id(20)}','${id(30)}',null,'Archived','archived',now()),
      ('${id(104)}',null,null,'${id(1)}','Contact only','contact-only',null);
    insert into document_shares(file_id,profile_id) values
      ('${id(101)}','${id(1)}'),('${id(101)}','${id(7)}'),('${id(101)}','${id(11)}'),
      ('${id(101)}','${id(12)}'),('${id(103)}','${id(1)}');
    insert into property_documents values ('${id(201)}','${id(20)}','public','house-rules'),
      ('${id(202)}','${id(20)}','restricted','legacy-private');
    insert into property_document_access values ('${id(202)}','${id(1)}');
    insert into documents values ('${id(301)}','${id(1)}','old-contract');
    insert into storage.objects(bucket_id,name) select 'document-vault',file_path from document_files;
    insert into storage.objects(bucket_id,name) select 'property-documents',file_path from property_documents;
    insert into storage.objects(bucket_id,name) values ('documents','old-contract'),('document-vault','orphan'),('property-images','photo');
  `);
  // Establish that the fixture really leaks before applying the production SQL.
  await asUser(2, async () => assert.equal((await db.query('select * from document_files')).rows.length, 4));
  await db.exec(migration);
  await db.exec(migration); // reapplying must be safe
});
after(async () => { if(db) await db.close(); });
async function asUser(n, callback){
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)",[n ? id(n) : '']);
    await db.exec('set local role '+(n ? 'authenticated' : 'anon'));
    return await callback();
  } finally { await db.exec('rollback'); }
}
async function vaultIds(){ return (await db.query('select id from document_files order by id')).rows.map(r=>r.id); }
async function readableStorage(){ return (await db.query('select name from storage.objects order by name')).rows.map(r=>r.name); }
for(const [n,label] of [[2,'neighbour'],[3,'next tenant'],[4,'owner'],[5,'caretaker'],[6,'contractor'],[7,'blocked'],[8,'former tenant'],[9,'future tenant'],[11,'archived admin'],[12,'pending'],[13,'future owner'],[0,'anonymous']]){
  test(label+' cannot read personal metadata, list RPC or storage', async () => asUser(n, async () => {
    assert.deepEqual(await vaultIds(), []);
    assert.deepEqual((await db.query('select * from get_my_shared_documents()')).rows, []);
    assert.equal((await db.query('select can_access_document_file($1) as allowed',[id(101)])).rows[0].allowed,false);
    const storage = await readableStorage();
    for(const name of ['personal','unshared','archived','contact-only','legacy-private','old-contract','orphan']) assert.ok(!storage.includes(name),name);
  }));
}
test('explicit recipient sees only their file, not merely assigned or archived files', async () => asUser(1, async () => {
  assert.deepEqual(await vaultIds(), [id(101)]);
  const rows = (await db.query('select * from get_my_shared_documents()')).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].folder_path,'');
  assert.deepEqual(await readableStorage(), ['house-rules','legacy-private','old-contract','personal','photo']);
}));
test('active admin can inspect archive and exact active/blocked reader list', async () => asUser(10, async () => {
  assert.equal((await vaultIds()).length,4);
  const rows = (await db.query('select * from get_document_readers($1)',[id(101)])).rows;
  assert.deepEqual(rows.filter(r=>r.can_read).map(r=>r.profile_id).sort(),[id(1),id(10)]);
  assert.equal(rows.filter(r=>!r.can_read).length,3);
}));
test('only current property members see legacy shared house information', async () => {
  for(const n of [1,2,4,5]) await asUser(n,async()=> assert.ok((await readableStorage()).includes('house-rules')));
  for(const n of [0,3,6,7,8,9,11,12,13]) await asUser(n,async()=> assert.ok(!(await readableStorage()).includes('house-rules')));
});
test('non-admin cannot inspect other readers or revoke/replace/create grants', async () => {
  for(const query of [
    ['select * from get_document_readers($1)',[id(101)]],
    ['select revoke_document_reader($1,$2)',[id(101),id(1)]],
    ['select replace_document_readers($1,$2)',[id(102),[id(2)]]],
    ['select document_reader_allowed($1,$2)',[id(101),id(1)]],
    ['insert into document_shares(file_id,profile_id) values($1,$2)',[id(102),id(2)]]
  ]) await asUser(2, async()=> assert.rejects(db.query(...query)));
});
test('revocation denies table, listing and storage immediately',async()=>{
  await asUser(10,async()=>{
    await db.query('select revoke_document_reader($1,$2)',[id(101),id(1)]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(1)]);
    assert.deepEqual(await vaultIds(),[]);
    assert.deepEqual((await db.query('select * from get_my_shared_documents()')).rows,[]);
    assert.ok(!(await readableStorage()).includes('personal'));
  });
});
test('grant replacement is atomic, retains confirmations, rejects inactive recipients',async()=>{
  await asUser(10,async()=>{
    await db.query('select replace_document_readers($1,$2)',[id(101),[id(2),id(2)]]);
    const rows=(await db.query('select * from get_document_readers($1)',[id(101)])).rows;
    assert.deepEqual(rows.filter(r=>r.has_share).map(r=>r.profile_id),[id(2)]);
  });
  await db.exec('begin');
  try {
    await db.query('update document_shares set confirmed_at=$1 where file_id=$2 and profile_id=$3',['2026-01-01T12:00:00Z',id(101),id(1)]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(10)]);
    await db.exec('set local role authenticated');
    await db.query('select replace_document_readers($1,$2)',[id(101),[id(1),id(2)]]);
    const result=await db.query('select confirmed_at from document_shares where file_id=$1 and profile_id=$2',[id(101),id(1)]);
    assert.ok(result.rows[0].confirmed_at);
  } finally {await db.exec('rollback');}
  await asUser(10,async()=>assert.rejects(db.query('select replace_document_readers($1,$2)',[id(101),[id(7)]])));
  await asUser(1,async()=>assert.deepEqual(await vaultIds(),[id(101)]));
});
test('handover and filing changes do not transfer the previous tenant private file',async()=>{
  await db.exec('begin');
  try {
    await db.query('update tenancies set end_date=current_date-1 where tenant_profile_id=$1',[id(1)]);
    await db.query('update tenancies set start_date=current_date where tenant_profile_id=$1',[id(3)]);
    await db.query('update document_files set property_id=null,unit_id=null,is_private_admin=true where id=$1',[id(101)]);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(3)]);
    assert.deepEqual(await vaultIds(),[]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(1)]);
    assert.deepEqual(await vaultIds(),[id(101)]);
  } finally { await db.exec('rollback'); }
});
test('document buckets private, public property images preserved',async()=>{
  assert.deepEqual((await db.query('select id from storage.buckets where public order by id')).rows,[{id:'property-images'}]);
});
test('readiness requires an active admin and all restrictive guards',async()=>{
  for(const n of [1,7,10,11,0]) await asUser(n,async()=>{
    const row=(await db.query('select document_privacy_ready() as ready, is_admin() as admin, is_approved() as approved')).rows[0];
    assert.equal(row.ready,n===10); assert.equal(row.admin,n===10);
    assert.equal(row.approved,[1,10].includes(n));
  });
  await db.exec('begin');
  try {
    await db.exec('drop policy storage_documents_privacy_guard on storage.objects');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(10)]);
    await db.exec('set local role authenticated');
    assert.equal((await db.query('select document_privacy_ready() as ready')).rows[0].ready,false);
  } finally {await db.exec('rollback');}
});
test('bootstrap ends with the tested canonical SQL',()=>{
  const schema=fs.readFileSync(path.join(root,'supabase/schema.sql'),'utf8');
  assert.ok(schema.includes('-- BEGIN DOCUMENT PRIVACY (source: document-privacy.sql)\n'+migration+'-- END DOCUMENT PRIVACY'));
});
