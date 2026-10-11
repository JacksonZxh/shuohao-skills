import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(dir, '../../..');
const checks = [
 ['outline', 'baseline/outline.json', true],
 ['cast', 'baseline/cast.json', true],
 ['art', 'baseline/art.json', true],
 ['cast', 'variants/cast-edited.json', true],
 ['cast', 'variants/cast-reordered.json', true],
 ['cast', 'variants/cast-without-codes.json', true],
 ['cast', 'variants/cast-duplicate-code.json', true],
 ['cast', 'variants/cast-ambiguous-alias.json', true],
 ['cast', 'variants/cast-name-conflict.json', true],
 ['cast', 'variants/cast-invalid-importance.json', false],
 ['outline', 'variants/outline-dangling-reference.json', false],
 ['art', 'variants/art-invalid-variant.json', false],
 ['art', 'variants/art-new-valid-then-invalid.json', false],
];
let failed = 0;
for (const [kind, file, shouldPass] of checks) {
 const script = resolve(repo, `skills/novel-${kind === 'cast' ? 'characters' : kind}/scripts/novel-${kind === 'cast' ? 'characters' : kind}.mjs`);
 const args = [script, 'validate', resolve(dir,file)];
 if(kind === 'cast') args.push(resolve(dir,'story.txt'), '--lang','zh');
 if(kind === 'art') args.push('--cast',resolve(dir,'baseline/cast.json'));
 const result = spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8'});
 const ok = result.status === (shouldPass ? 0 : 1);
 console.log(`${ok ? 'PASS' : 'FAIL'} ${file}: expected CLI ${shouldPass ? 'accept' : 'reject'}, exit ${result.status}`);
 if(!ok) { failed++; console.error(result.stdout,result.stderr); }
}
const checksums = JSON.parse(readFileSync(resolve(dir,'checksums.json'),'utf8'));
for(const [file, hash] of Object.entries(checksums.files)) {
 if(createHash('sha256').update(readFileSync(resolve(dir,file))).digest('hex') !== hash) {
  failed++;console.error(`FAIL checksum ${file}`);
 }
}
console.log(`Fixture validation: ${checks.length} CLI expectations, ${Object.keys(checksums.files).length} checksums, ${failed} failures`);
process.exitCode = failed ? 1 : 0;
