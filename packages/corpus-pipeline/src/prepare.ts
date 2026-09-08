import { createHash } from 'node:crypto';
import { readFile, realpath, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function safePath(root: string, relative: string) {
  if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`Unsafe path: ${relative}`);
  const base = await realpath(root), target = await realpath(path.resolve(base, relative));
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path escapes root: ${relative}`);
  return target;
}
export async function verifyChecksums(root: string) {
  const entries = new Map<string, string>();
  for (const line of (await readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match || entries.has(match[2])) throw new Error('Invalid or duplicate checksum entry');
    const file = await safePath(root, match[2]);
    if (sha256(await readFile(file)) !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
    entries.set(match[2].replaceAll('\\', '/'), match[1]);
  }
  return entries;
}
export function isTokenSubsequence(chunk: string, page: string) {
  const words = page.trim().split(/\s+/); let cursor = 0;
  for (const word of chunk.trim().split(/\s+/)) {
    while (cursor < words.length && words[cursor] !== word) cursor++;
    if (cursor++ >= words.length) return false;
  }
  return true;
}
export function assertUnique(values: string[], label: string) {
  if (values.some(v => !v) || new Set(values).size !== values.length) throw new Error(`Duplicate or missing ${label}`);
}
export function classifyChunk(section: string, text: string): 'evidence' | 'administrative' | 'ambiguous-table' {
  if (/funding|author contributions?|conflict of interest|competing interests?|acknowledg|data availability|publisher.?s note|ethical approval|ethics statement|supplementary material|abbreviations/i.test(section)) return 'administrative';
  if (/\btable\s*\d+/i.test(text) && (text.match(/\b\d+(?:\.\d+)?\b/g)?.length ?? 0) >= 15) return 'ambiguous-table';
  return 'evidence';
}
const xmlScript = String.raw`
import json, sys, re, xml.etree.ElementTree as ET
out=[]
def txt(el): return re.sub(r'\s+', ' ', ' '.join(el.itertext())).strip() if el is not None else ''
for file in json.load(sys.stdin):
 if file is None:
  out.append(None); continue
 root=ET.parse(file).getroot(); meta=root.find('.//article-meta'); sections=[]
 authors=[]
 for c in meta.findall('.//contrib-group/contrib'):
  if c.get('contrib-type','author') != 'author': continue
  name=c.find('name')
  if name is None: name=c.find('name-alternatives/name')
  if name is None: name=c.find('string-name')
  author=' '.join(filter(None,[txt(name.find('given-names')),txt(name.find('surname'))])) if name is not None else txt(c.find('collab'))
  if author and author not in authors: authors.append(author)
 abstract=meta.find('abstract')
 if abstract is not None: sections.append(['Abstract',txt(abstract)])
 def walk(el,p):
  if el.tag=='sec': p=p+[txt(el.find('title')) or 'Untitled section']
  for child in el:
   if child.tag=='sec': walk(child,p)
   elif child.tag in ('p','table-wrap','fig','list','boxed-text'):
    content=txt(child)
    if content: sections.append([' / '.join(p) or 'Body',content])
 body=root.find('body')
 if body is not None: walk(body,[])
 grouped=[]
 for sec,content in sections:
  if grouped and grouped[-1][0]==sec: grouped[-1][1].append(content)
  else: grouped.append([sec,[content]])
 chunks=[]
 for sec,paras in grouped:
  words='\n\n'.join(paras).split()
  for start in range(0,len(words),450): chunks.append({'section':sec,'text':' '.join(words[start:start+500])})
 methods=[{'section':s,'excerpt':t} for s,t in sections if re.search(r'method|participant|eligibility|inclusion criteria|study selection',s,re.I)]
 out.append({'authors':authors,'chunks':chunks,'methods':methods,'sections':sections})
json.dump(out,sys.stdout,ensure_ascii=True)
`;
type RawSource = { source_id: string; authors: string[]; title: string; url: string; xml_path: string; text_path: string; xml_sha256: string; license_urls: string[]; license_text: string; language: string; doi?: string; year?: string; collection: string; review_status: string; chunk_count: number; retrieved_at: string; [key: string]: unknown };
type RawChunk = { chunk_id: string; source_id: string; text: string; section: string; collection: string; [key: string]: unknown };
type Extraction = { authors: string[]; chunks: {section:string;text:string}[]; methods: {section:string;excerpt:string}[]; sections: [string,string][] };
export async function prepareCorpus(input: string, output = '.cache/corpus/hevy') {
  const suppliedPath = await realpath(input);
  const suppliedStat = await stat(suppliedPath);
  const inputPath = suppliedStat.isDirectory() ? await realpath(path.join(suppliedPath, 'rag', 'science_chunks.jsonl')) : suppliedPath;
  const root = suppliedStat.isDirectory() ? suppliedPath : path.dirname(path.dirname(inputPath));
  if (path.basename(inputPath) !== 'science_chunks.jsonl' || path.basename(path.dirname(inputPath)) !== 'rag') throw new Error('La entrada debe ser rag/science_chunks.jsonl; core_science_chunks.jsonl y notas de creadores no se importan');
  const checksums = await verifyChecksums(root);
  const required = async (relative: string) => {
    if (!checksums.has(relative.replaceAll('\\', '/'))) throw new Error(`File not covered by checksum inventory: ${relative}`);
    return safePath(root, relative);
  };
  await required(path.relative(root, inputPath));
  const inventory: RawSource[] = JSON.parse(await readFile(await required('sources_science.json'), 'utf8'));
  assertUnique(inventory.map(s => s.source_id), 'source id');
  const rawChunks: RawChunk[] = (await readFile(inputPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assertUnique(rawChunks.map(c => c.chunk_id), 'chunk id');
  const selected = new Set(rawChunks.map(c => c.source_id));
  const rawSources = inventory.filter(s => selected.has(s.source_id));
  if (rawSources.length !== selected.size) throw new Error('Unknown chunk source');
  const xmlPaths = await Promise.all(rawSources.map(s => s.xml_path ? required(s.xml_path) : Promise.resolve(null)));
  const parsed = spawnSync(process.env.CORPUS_PYTHON ?? 'python', ['-c', xmlScript], {input:JSON.stringify(xmlPaths),encoding:'utf8',maxBuffer:64*1024*1024});
  if (parsed.status !== 0) throw new Error(`XML parsing failed: ${parsed.stderr || parsed.error}`);
  const extracted: Extraction[] = JSON.parse(parsed.stdout);
  let recoveredAuthors = 0;
  const reviews: Record<string, unknown>[] = [];
  const sources = await Promise.all(rawSources.map(async (s,i) => {
    const xmlHash = sha256(await readFile(xmlPaths[i] ?? await required(String(s.pdf_path))));
    if (xmlHash !== (s.xml_sha256 || s.pdf_sha256)) throw new Error(`XML source hash mismatch: ${s.source_id}`);
    const original = rawChunks.filter(c => c.source_id === s.source_id), ex = extracted[i] ?? {authors:s.authors,chunks:original,sections:[],methods:[]};
    if (original.length !== s.chunk_count || ex.chunks.length !== original.length || original.some((c,j) => c.text !== ex.chunks[j].text || c.section !== ex.chunks[j].section)) throw new Error(`Original extraction mismatch: ${s.source_id}`);
    const document = await readFile(await required(s.text_path),'utf8');
    const markdown = document.replace(/\s+/g,' ');
    if (!s.xml_path && original.some(c => !isTokenSubsequence(c.text, document.split('\f')[Number(c.page)-1] ?? ''))) throw new Error(`PDF page text mismatch: ${s.source_id}`);
    if (ex.sections.some(([,text]) => !markdown.includes(text.replace(/\s+/g,' ')))) throw new Error(`Markdown extraction mismatch: ${s.source_id}`);
    const authors = s.authors.filter(Boolean).length ? s.authors.filter(Boolean) : ex.authors;
    if (!s.authors.filter(Boolean).length && authors.length) recoveredAuthors++;
    if (!authors.length) throw new Error(`Missing authors: ${s.source_id}`);
    // Keep recommendation eligibility closed until a human reviews full methods and applicability.
    // Evidence excerpts are audit leads, never automatic population/quality certification.
    const evidence = ex.methods.filter(m => /participant|eligible|inclusion|healthy|adult|patients|aged|population/i.test(m.excerpt)).slice(0,3).map(m => ({section:m.section,excerpt:m.excerpt.slice(0,1800)}));
    reviews.push({sourceId:s.source_id,population:['unknown'],populationReviewed:false,reviewStatus:'methods_excerpts_collected_needs_individual_review',evidence,reason:evidence.length?'Methods evidence collected; age, health, training status and applicability not individually certified.':'No clear methods population evidence extracted; full source review required.'});
    return {id:s.source_id,author:authors.join('; '),title:s.title,url:s.url,license:s.license_urls.join('; ') || 'unknown',licenseText:s.license_text,language:s.language || 'unknown',approved:true,approvedAt:Date.UTC(2026,8,5),publishedAt:undefined,publicationDateStatus:'unknown_exact_date',publicationYear:s.year || null,evidenceLevel:0,doi:s.doi,reviewStatus:s.review_status,scientificReview:s.review_status,population:['unknown'],populationReviewed:false,collection:s.collection,sourceHash:xmlHash,provenance:{xmlPath:s.xml_path,textPath:s.text_path,original:s,authorsRecoveredFromXml:!s.authors.filter(Boolean).length}};
  }));
  const byId = new Map(sources.map(s => [s.id,s]));
  const chunks = rawChunks.map(c => ({id:c.chunk_id,sourceId:c.source_id,text:c.text,location:c.section,section:c.section,...(typeof c.page === 'number' ? {page:c.page} : {}),textHash:sha256(c.text),retrievalClass:classifyChunk(c.section,c.text),collection:c.collection || byId.get(c.source_id)!.collection,population:['unknown'],populationReviewed:false,provenance:{original:c}}));
  const provenance = {inputHash:sha256(await readFile(inputPath)),checksumInventoryHash:sha256(await readFile(path.join(root,'SHA256SUMS.txt'))),verifiedFileCount:checksums.size,approvalScope:'User authorized retrieval import of all scientific chunks; no individual scientific appraisal or unrestricted commercial-license approval.',creatorNotesIncluded:false};
  const payload = {status:'approved',schema:'hevy-corpus-v1',embeddingModel:{name:'nvidia/nemotron-3-embed-1b',dimension:2048,primaryDimension:512,evaluationDimension:1024},sources,chunks,provenance};
  const manifest = {corpusVersion:`sha256:${sha256(JSON.stringify(payload))}`,...payload};
  const report = {corpusVersion:manifest.corpusVersion,sources:sources.length,chunks:chunks.length,verifiedFiles:checksums.size,recoveredAuthors,populationReviewed:sources.filter(s=>s.populationReviewed).length,populationUnknown:sources.length,retrievalClasses:chunks.reduce<Record<string,number>>((a,c)=>(a[c.retrievalClass]=(a[c.retrievalClass]||0)+1,a),{}),populationReview:reviews};
  await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(path.join(output,'preparation-report.json'),JSON.stringify(report,null,2)+'\n');
  return {manifest,report};
}


