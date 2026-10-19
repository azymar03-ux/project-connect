"""Destructive only to a uniquely named scratch database; never overwrites source.
Requires local sudo-as-postgres permission and pg_dump/pg_restore binaries.
Writes no row data or connection secrets to logs. Not a production restore plan.
"""
import os, pathlib, subprocess, uuid, json, shutil, hashlib, urllib.request, urllib.error, signal, secrets, tarfile
os.umask(0o077)
from urllib.parse import urlsplit, unquote, urlunsplit
settings=dict(os.environ)
if pathlib.Path('.env').exists():
    for line in pathlib.Path('.env').read_text().splitlines():
        if line and not line.startswith('#') and '=' in line:
            k,_,v=line.partition('=');settings.setdefault(k,v.strip('\"\''))
source = settings.get('DATABASE_URL')
if not source:
    for line in pathlib.Path('.env').read_text().splitlines():
        if line.startswith('DATABASE_URL='):
            source=line.partition('=')[2].strip('"\'')
parsed=urlsplit(source or '')
if parsed.hostname not in ('localhost','127.0.0.1'):
    raise SystemExit('Local validation only: source must be localhost or 127.0.0.1.')
name='pc_restore_check_'+uuid.uuid4().hex[:12]
backup=pathlib.Path('.arena') / (name+'.dump');backup.parent.mkdir(exist_ok=True)
files_restore=backup.parent/(name+'_files')
env={**os.environ,'PGPASSWORD':unquote(parsed.password or '')}
def run(args,**kwargs):return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,**kwargs).strip()
source_args=['-h',parsed.hostname,'-p',str(parsed.port or 5432),'-U',unquote(parsed.username or ''),'-d',parsed.path.lstrip('/')]
server=None
server_log=None
try:
    run(['pg_dump',*source_args,'-Fc','--no-owner','--no-acl','-f',str(backup)],env=env)
    # Exercise encryption, wrong-key rejection and authenticated corruption detection.
    password=secrets.token_urlsafe(48)+'\n'
    encrypted=backup.with_suffix('.gpg');decrypted=backup.with_suffix('.decrypted');corrupt=backup.with_suffix('.corrupt')
    gpg=['gpg','--batch','--yes','--pinentry-mode','loopback','--passphrase-fd','0']
    subprocess.run([*gpg,'--symmetric','--cipher-algo','AES256','--output',str(encrypted),str(backup)],input=password.encode(),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run([*gpg,'--decrypt','--output',str(decrypted),str(encrypted)],input=password.encode(),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if hashlib.sha256(backup.read_bytes()).digest()!=hashlib.sha256(decrypted.read_bytes()).digest():raise RuntimeError('Encrypted dump round-trip checksum mismatch')
    wrong=subprocess.run([*gpg,'--decrypt','--output',os.devnull,str(encrypted)],input=b'wrong-test-password\n',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if wrong.returncode==0:raise RuntimeError('Wrong backup password accepted')
    damaged=bytearray(encrypted.read_bytes());damaged[-1]^=1;corrupt.write_bytes(damaged)
    check=subprocess.run([*gpg,'--decrypt','--output',os.devnull,str(corrupt)],input=password.encode(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if check.returncode==0:raise RuntimeError('Corrupted encrypted backup accepted')
    print('PASS AES256 encrypted dump round-trip; wrong passphrase and tampering rejected (ephemeral local test key only)')
    backup.unlink();decrypted.replace(backup)
    run(['sudo','-u','postgres','createdb' ,'-O',unquote(parsed.username or ''),name])
    # Scratch dump may include sensitive sessions/outbox; drop DB and erase archive in finally.
    with backup.open('rb') as data:
        run(['sudo','-u','postgres','pg_restore','-d',name,'--exit-on-error','--single-transaction','--no-owner','--no-acl','--role',unquote(parsed.username or '')],stdin=data)
    tables=run(['psql',*source_args,'-Atc',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"],env=env).splitlines()
    for table in tables:
        sql=f'SELECT count(*) FROM "{table}"'
        expected=run(['psql',*source_args,'-Atc',sql],env=env)
        actual=run(['sudo','-u','postgres','psql','-d',name,'-Atc',sql])
        if expected!=actual:raise RuntimeError(f'Count mismatch for {table}; concurrent source writes require a repeat.')
        print(f'PASS {table}: restored row count matches source')
    print(f'PASS all {len(tables)} public tables: restored row counts match quiescent source')
    if settings.get('S3_BUCKET'):
        print('SKIP local file restore: S3 requires separately authorized bucket recovery.')
    else:
        root=pathlib.Path(settings.get('LOCAL_FILE_DIR','.private-files')).resolve()
        if root.exists():shutil.copytree(root,files_restore)
        else:files_restore.mkdir()
        sql='SELECT coalesce(json_agg(json_build_object(\'key\',"storageKey",\'size\',size)),\'[]\'::json) FROM (SELECT "storageKey",size FROM "ProjectFile" UNION ALL SELECT "storageKey",size FROM "PublicImage") objects'
        references=json.loads(run(['sudo','-u','postgres','psql','-d',name,'-Atc',sql]))
        for item in references:
            src=(root/item['key']).resolve();dst=(files_restore/item['key']).resolve()
            if not src.is_relative_to(root) or not dst.is_relative_to(files_restore.resolve()):raise RuntimeError('Unsafe file key in recovery metadata')
            if src.stat().st_size!=item['size'] or dst.stat().st_size!=item['size']:raise RuntimeError('Restored referenced file size mismatch')
            if hashlib.sha256(src.read_bytes()).digest()!=hashlib.sha256(dst.read_bytes()).digest():raise RuntimeError('Restored referenced file checksum mismatch')
        bundle=backup.with_suffix('.files.tar');encrypted_files=backup.with_suffix('.files.gpg');decrypted_files=backup.with_suffix('.files.decrypted')
        with tarfile.open(bundle,'w') as archive:
            for item in references:archive.add(files_restore/item['key'],arcname=item['key'],recursive=False)
        subprocess.run([*gpg,'--symmetric','--cipher-algo','AES256','--output',str(encrypted_files),str(bundle)],input=password.encode(),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run([*gpg,'--decrypt','--output',str(decrypted_files),str(encrypted_files)],input=password.encode(),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if hashlib.sha256(bundle.read_bytes()).digest()!=hashlib.sha256(decrypted_files.read_bytes()).digest():raise RuntimeError('Encrypted file bundle round-trip mismatch')
        shutil.rmtree(files_restore);files_restore.mkdir()
        with tarfile.open(decrypted_files,'r') as archive:
            for member in archive.getmembers():
                if not member.isfile() or not (files_restore/member.name).resolve().is_relative_to(files_restore.resolve()):raise RuntimeError('Unsafe recovery archive member')
            archive.extractall(files_restore,filter='data')
        print('PASS referenced file bundle AES256 encrypt/decrypt/extract; restored service uses decrypted DB and files')
        print(f'PASS isolated local file-copy recovery: {len(references)} referenced object sizes and SHA-256 checksums match restored DB metadata')
    fixture=json.loads(os.environ.get('PC_RESTORE_APP_FIXTURE','null'))
    if fixture:
        if not pathlib.Path('artifacts/api/main.js').exists():raise RuntimeError('Build API before restored-service validation')
        restored_url=urlunsplit((parsed.scheme,parsed.netloc,'/'+name,parsed.query,''))
        service_env={**settings,**os.environ,'DATABASE_URL':restored_url,'LOCAL_FILE_DIR':str(files_restore.resolve()),'API_PORT':'3005','NODE_ENV':'test','SMTP_URL':'','S3_BUCKET':'','OPENAI_API_KEY':'','GOOGLE_PLACES_ENABLED':'false','PC_RESTORE_APP_FIXTURE':''}
        server_log=backup.with_suffix('.service.log').open('w')
        server=subprocess.Popen(['node','artifacts/api/main.js'],env=service_env,stdout=server_log,stderr=server_log,start_new_session=True)
        subprocess.run(['node','scripts/wait-ready.mjs'],env={**service_env,'READY_URL':'http://localhost:3005/api/ready'},check=True,timeout=40,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        def get(path,auth=True):
            req=urllib.request.Request('http://localhost:3005/api/'+path,headers={'Cookie':'pc_session='+fixture['token']} if auth else {})
            with urllib.request.urlopen(req,timeout=10) as response:return response.read()
        if json.loads(get('me'))['id']!=fixture['userId']:raise RuntimeError('Restored session identity mismatch')
        for kind in ['file','image']:
            if hashlib.sha256(get(fixture[kind+'Path'])).hexdigest()!=fixture[kind+'Hash']:raise RuntimeError('Restored application download mismatch')
        try:
            get(fixture['filePath'],False)
            raise RuntimeError('Restored private file allowed anonymous access')
        except urllib.error.HTTPError as e:
            if e.code!=401:raise
        print('PASS restored built API: readiness, restored session identity, authenticated attachment and avatar SHA-256, anonymous private-file rejection')
    print('PASS local full-schema/data pg_dump + pg_restore into disposable database')
    print('Scope: local isolated restored DB/files/service only; NOT S3, encrypted off-site backup, RPO/RTO or disaster failover.')
finally:
    if server:
        os.killpg(server.pid,signal.SIGTERM)
        try:server.wait(timeout=10)
        except subprocess.TimeoutExpired:os.killpg(server.pid,signal.SIGKILL);server.wait()
    if server_log:server_log.close()
    backup.with_suffix(".service.log").unlink(missing_ok=True)
    subprocess.run(['sudo','-u','postgres','dropdb','--if-exists',name],check=True,capture_output=True)
    for suffix in ['.gpg','.decrypted','.corrupt','.files.tar','.files.gpg','.files.decrypted']:backup.with_suffix(suffix).unlink(missing_ok=True)
    backup.unlink(missing_ok=True)
    shutil.rmtree(files_restore,ignore_errors=True)
