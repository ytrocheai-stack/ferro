import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertUnique, classifyChunk, isTokenSubsequence, prepareCorpus, safePath, sha256, verifyChecksums } from './prepare.ts';
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p,{recursive:true,force:true}))); });
async function fixture(noAuthors = false) {
  const root = await mkdtemp(path.join(os.tmpdir(),'hevy-corpus-')); temporary.push(root);
  await Promise.all(['rag','sources','documents'].map(p=>mkdir(path.join(root,p))));
  const xml = `<article><front><article-meta><contrib-group>${noAuthors?'':'<contrib contrib-type="author"><name-alternatives><name><surname>Doe</surname><given-names>Jane</given-names></name></name-alternatives></contrib>'}</contrib-group><abstract><p>Healthy adults participated.</p></abstract></article-meta></front><body><sec><title>Methods</title><p>Participants were adults.</p></sec></body></article>`;
  const files: Record<string,string> = {
    'sources/S1.xml':xml,
    'documents/S1.md':'Healthy adults participated.\n\nParticipants were adults.',
    'sources_science.json':JSON.stringify([{source_id:'S1',authors:[],title:'Study',url:'https://example.org',xml_path:'sources/S1.xml',text_path:'documents/S1.md',xml_sha256:sha256(xml),license_urls:['https://creativecommons.org/licenses/by/4.0/'],license_text:'CC BY',language:'en',collection:'core_candidate',review_status:'title_screened_not_individually_appraised',chunk_count:2}]),
    'rag/science_chunks.jsonl':[{chunk_id:'S1_1',source_id:'S1',text:'Healthy adults participated.',section:'Abstract',collection:'core_candidate'},{chunk_id:'S1_2',source_id:'S1',text:'Participants were adults.',section:'Methods',collection:'core_candidate'}].map(c=>JSON.stringify(c)).join('\n'),
  };
  await Promise.all(Object.entries(files).map(([p,t])=>writeFile(path.join(root,p),t)));
  await writeFile(path.join(root,'SHA256SUMS.txt'),Object.entries(files).map(([p,t])=>`${sha256(t)}  ${p}`).join('\n'));
  return {root,files,input:path.join(root,'rag/science_chunks.jsonl'),output:path.join(root,'output')};
}
describe('corpus preparation trust boundary', () => {
  it('recovers authors from nested XML names, preserves every chunk, and does not certify population from mentions',async()=>{
    const f=await fixture(); const {manifest,report}=await prepareCorpus(f.input,f.output);
    expect(report.recoveredAuthors).toBe(1); expect(manifest.sources[0].author).toBe('Jane Doe');
    expect(manifest.chunks).toHaveLength(2); expect(manifest.sources[0].populationReviewed).toBe(false);
    expect(manifest.sources[0].evidenceLevel).toBe(0);
    expect((await prepareCorpus(f.input,f.output)).manifest.corpusVersion).toBe(manifest.corpusVersion);
  });
  it('rejects tampering before extraction',async()=>{
    const f=await fixture();await writeFile(f.input,'tampered');
    await expect(prepareCorpus(f.input,f.output)).rejects.toThrow('Checksum mismatch');
  });
  it('rejects traversal including Windows traversal',async()=>{
    const f=await fixture();
    await expect(safePath(f.root,'../escape')).rejects.toThrow('Unsafe path');
    await expect(safePath(f.root,'..\\escape')).rejects.toThrow('Unsafe path');
    await writeFile(path.join(f.root,'SHA256SUMS.txt'),`${'0'.repeat(64)}  ../escape`);
    await expect(verifyChecksums(f.root)).rejects.toThrow('Unsafe path');
  });
  it('rejects duplicate ids and missing authors',async()=>{
    expect(()=>assertUnique(['a','a'],'chunk id')).toThrow('Duplicate');
    expect(()=>assertUnique(['a','a'],'source id')).toThrow('Duplicate');
    const f=await fixture(true);await expect(prepareCorpus(f.input,f.output)).rejects.toThrow('Missing authors');
  });
  it('rejects text altered with a correspondingly updated file checksum',async()=>{
    const f=await fixture();f.files['rag/science_chunks.jsonl']=f.files['rag/science_chunks.jsonl'].replace('Healthy adults participated.','Invented result.');
    await writeFile(f.input,f.files['rag/science_chunks.jsonl']);
    await writeFile(path.join(f.root,'SHA256SUMS.txt'),Object.entries(f.files).map(([p,t])=>`${sha256(t)}  ${p}`).join('\n'));
    await expect(prepareCorpus(f.input,f.output)).rejects.toThrow('Original extraction mismatch');
  });
  it('keeps administrative and flattened numeric table material out of evidence',()=>{
    expect(classifyChunk('Funding','Supported by a grant')).toBe('administrative');
    expect(classifyChunk('Results','Table 1 '+Array.from({length:20},(_,i)=>i).join(' '))).toBe('ambiguous-table');
    expect(classifyChunk('Methods','Adults followed a training protocol')).toBe('evidence');
  });
  it('permits removed PDF headers but rejects invented words and reordered text',()=>{
    expect(isTokenSubsequence('Alpha beta gamma','Alpha RUNNING HEADER beta gamma')).toBe(true);
    expect(isTokenSubsequence('Alpha invented gamma','Alpha beta gamma')).toBe(false);
    expect(isTokenSubsequence('gamma Alpha','Alpha beta gamma')).toBe(false);
  });
});
