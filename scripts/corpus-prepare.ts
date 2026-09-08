import { prepareCorpus } from '../packages/corpus-pipeline/src/prepare.ts';
const args = process.argv.slice(2);
if (args.some((v,i) => i % 2 === 0 && !['--input','--output'].includes(v)) || args.length % 2) throw new Error('Usage: --input <Hevy_Corpus folder|science_chunks.jsonl> [--output <directory>]');
const input = args[args.indexOf('--input') + 1];
if (!args.includes('--input') || !input) throw new Error('--input is required');
const {report} = await prepareCorpus(input,args.includes('--output') ? args[args.indexOf('--output')+1] : undefined);
console.log(JSON.stringify({...report, populationReview: undefined, source: input},null,2));
