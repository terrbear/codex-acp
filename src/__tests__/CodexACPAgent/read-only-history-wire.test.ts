import {expect, it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import {createJsonStream} from '../../StdUtils';

it('registers exact history on the actual stdio entry without runtime mutation', async () => {
 const dir=await mkdtemp(join(tmpdir(),'history-wire-'));
 const fixture=join(dir,'app-server.mjs');const receipt=join(dir,'methods');
 const id='11111111-2222-4333-8444-555555555555';
 await writeFile(fixture,`#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);appendFileSync(process.env.TEST_HISTORY_METHODS,r.method+'\\n');
 if(r.id===undefined)return;
 let result;
 if(r.method==='initialize')result={userAgent:'fixture',codexHome:null};
 else if(r.method==='account/read')result={account:null,requiresOpenaiAuth:false};
 else if(r.method==='config/read')result={config:{},origins:{}};
 else if(r.method==='thread/read')result={thread:{id:r.params.threadId,historyMode:'legacy',turns:r.params.includeTurns?[{id:'prior',items:[{type:'userMessage',content:[{type:'text',text:'synthetic prior history'}]}]}]:[]}};
 else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Unexpected test method'}})+'\\n');return;}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
});
`,{mode:0o755});
 const child=spawn(process.execPath,['--import','tsx','src/index.ts'],{cwd:process.cwd(),env:{...process.env,CODEX_PATH:fixture,APP_SERVER_LOGS:'',TEST_HISTORY_METHODS:receipt},stdio:['pipe','pipe','pipe']});
 child.stderr.resume();
 const connection=acp.client().connect(createJsonStream(child.stdout,child.stdin));
 try{
  const init=await connection.agent.request('initialize',{protocolVersion:1,clientCapabilities:{}}) as any;
  expect(init.agentCapabilities._meta.readOnlyHistory).toEqual({version:1});
  const result=await connection.agent.request('_session/read_history',{sessionId:id}) as any;
  expect(result).toMatchObject({version:1,format:'codex-thread',writable:false,thread:{id,turns:[{id:'prior'}]}});
  await expect(connection.agent.request('_session/read_history',{sessionId:id,extra:true})).rejects.toBeDefined();
  const methods=(await readFile(receipt,'utf8')).trim().split('\n');
  expect(methods.filter(m=>m==='thread/read')).toHaveLength(2);
  expect(methods.filter(m=>!['initialize','initialized','account/read','config/read','thread/read'].includes(m))).toEqual([]);
 }finally{
  child.stdin.end();child.kill();
  await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',()=>resolve());});
  await rm(dir,{recursive:true,force:true});
 }
},15000);
