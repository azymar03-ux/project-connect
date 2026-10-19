"""Local disposable fresh25 / upgrade20->25 migration and checksum verification."""
import os,pathlib,subprocess,uuid,shutil,hashlib,json
from urllib.parse import urlsplit,urlunsplit,unquote
settings=dict(os.environ)
for line in pathlib.Path('.env').read_text().splitlines():
 if line and not line.startswith('#') and '=' in line:
  k,_,v=line.partition('=');settings.setdefault(k,v.strip('"\''))
p=urlsplit(settings['DATABASE_URL'])
assert p.hostname in ('localhost','127.0.0.1'),'Local validation only'
name='pc_migrations_'+uuid.uuid4().hex[:12];scratch=pathlib.Path('.arena')/name
role=unquote(p.username or '')
def run(args,**kwargs):return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,**kwargs)
def deploy(schema,db):
 env={**os.environ,'DATABASE_URL':urlunsplit((p.scheme,p.netloc,'/'+db,p.query,p.fragment))}
 output=run(['npx','prisma','migrate','deploy','--schema',str(schema)],env=env)
 assert 'successfully applied' in output or 'No pending migrations' in output
migrations=sorted(d for d in pathlib.Path('prisma/migrations').iterdir() if d.is_dir())
try:
 scratch.mkdir(parents=True);shutil.copy('prisma/schema.prisma',scratch/'schema.prisma');(scratch/'migrations').mkdir()
 shutil.copy('prisma/migrations/migration_lock.toml',scratch/'migrations/migration_lock.toml')
 for d in migrations[:20]:shutil.copytree(d,scratch/'migrations'/d.name)
 run(['sudo','-u','postgres','createdb','-O',role,name])
 deploy(scratch/'schema.prisma',name)
 assert run(['sudo','-u','postgres','psql','-d',name,'-Atc','SELECT count(*) FROM "_prisma_migrations"']).strip()=='20'
 run(['sudo','-u','postgres','psql','-d',name,'-c',"INSERT INTO \"AiUsage\"(id,\"identityHash\",\"userId\",\"reservedTokens\") VALUES('legacy-upgrade','legacy','legacy',14000)"])
 legacy_sql="SET session_replication_role=replica;INSERT INTO \"ProjectFile\"(id,\"projectId\",\"uploaderId\",name,mime,size,\"storageKey\") VALUES('legacy-file','p','u','a.txt','text/plain',12,'"+'a'*48+"');INSERT INTO \"PublicImage\"(id,\"storageKey\",kind,width,height,size) VALUES('legacy-image','"+'b'*48+"','avatar',256,256,34);"
 run(['sudo','-u','postgres','psql','-d',name,'-c',legacy_sql])
 deploy(pathlib.Path('prisma/schema.prisma'),name)
 assert run(['sudo','-u','postgres','psql','-d',name,'-Atc',"SELECT \"reservedMicroUsd\" FROM \"AiUsage\" WHERE id='legacy-upgrade'"]).strip()=='0'
 scan=run(['sudo','-u','postgres','psql','-d',name,'-Atc',"SELECT string_agg(status||':'||size||':'||coalesce(sha256,'none'),',' ORDER BY size) FROM \"StorageScan\""]).strip()
 assert scan=='pending:12:none,pending:34:none',scan
 print('PASS upgrade20->25 preserves legacy AI ledger and queues legacy file/image rows as unverified scan state')
 run(['sudo','-u','postgres','dropdb',name]);run(['sudo','-u','postgres','createdb','-O',role,name])
 for d in migrations[20:22]:shutil.copytree(d,scratch/'migrations'/d.name)
 deploy(scratch/'schema.prisma',name)
 legacy_export_sql="""SET session_replication_role=replica;INSERT INTO "AccountExportJob"(id,"userId","sessionHash",status,"artifactKey","artifactSize","expiresAt") VALUES('old-ready','u','hash','ready','artifact',123,now()+interval '1 day');INSERT INTO "StorageDeletion"("storageKey","dueAt") VALUES('artifact',now()+interval '1 day');INSERT INTO "AccountExportPin"("jobId","storageKey",size,path) VALUES('old-ready','legacy',12,'a.txt');"""
 run(['sudo','-u','postgres','psql','-d',name,'-c',legacy_export_sql])
 deploy(pathlib.Path('prisma/schema.prisma'),name)
 assert run(['sudo','-u','postgres','psql','-d',name,'-Atc',"SELECT status FROM \"AccountExportJob\" WHERE id='old-ready'"]).strip()=='expired'
 assert run(['sudo','-u','postgres','psql','-d',name,'-Atc','SELECT count(*) FROM "AccountExportPin"']).strip()=='0'
 assert run(['sudo','-u','postgres','psql','-d',name,'-Atc',"SELECT (\"dueAt\"<=now())::text FROM \"StorageDeletion\" WHERE \"storageKey\"='artifact'"]).strip()=='true'
 print('PASS upgrade22->25 expires legacy exports, removes incompatible pins, queues artifact cleanup')
 run(['sudo','-u','postgres','dropdb',name]);run(['sudo','-u','postgres','createdb','-O',role,name])
 deploy(pathlib.Path('prisma/schema.prisma'),name)
 rows=run(['sudo','-u','postgres','psql','-d',name,'-Atc','SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name']).strip().splitlines()
 assert len(rows)==25
 expected={d.name:hashlib.sha256((d/'migration.sql').read_bytes()).hexdigest() for d in migrations}
 for row in rows:
  migration,checksum=row.split('|');assert expected[migration]==checksum
 print('PASS fresh25 migrations and all SHA256 checksums match source')
finally:
 subprocess.run(['sudo','-u','postgres','dropdb','--if-exists',name],check=True,stdout=subprocess.DEVNULL)
 shutil.rmtree(scratch,ignore_errors=True)
 print('PASS scratch migration data/database removed')
