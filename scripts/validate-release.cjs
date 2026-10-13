const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('release-please');
const { Node } = require('release-please/build/src/strategies/node');
const { DefaultVersioningStrategy } = require('release-please/build/src/versioning-strategies/default');
const { Version } = require('release-please/build/src/version');
const { TagName } = require('release-please/build/src/util/tag-name');
const { parseConventionalCommits } = require('release-please/build/src/commit');
const toml = require('@iarna/toml');
const YAML = require('yaml');
const repo = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');
const config = JSON.parse(read('release-please-config.json')).packages['.'];
const manifest = JSON.parse(read('.release-please-manifest.json'));
const logger = { info() {}, debug() {}, warn(message) { throw new Error(message); }, error(message) { throw new Error(message); } };
const github = {
  repository: { owner: 'Apheiro', repo: 'SymantecProxyApp' },
  async getFileContentsOnBranch(file) {
    const content = read(file);
    return { parsedContent: content, content: Buffer.from(content).toString('base64'), sha: 'fixture' };
  },
};
const strategy = () => new Node({
  github, targetBranch: 'main', path: '.', logger,
  includeComponentInTag: config['include-component-in-tag'],
  includeVInTag: config['include-v-in-tag'],
  changelogPath: config['changelog-path'],
  extraFiles: config['extra-files'],
  versioningStrategy: new DefaultVersioningStrategy({
    bumpMinorPreMajor: config['bump-minor-pre-major'],
    bumpPatchForMinorPreMajor: config['bump-patch-for-minor-pre-major'], logger,
  }),
});
const commits = message => parseConventionalCommits([{ sha: 'a'.repeat(40), message, files: ['src-tauri/src/ssh_client.rs'] }], logger);
async function candidate(message, previous = manifest['.']) {
  return strategy().buildReleasePullRequest(commits(message), { tag: new TagName(Version.parse(previous)), sha: 'b'.repeat(40), notes: '' });
}
(async () => {
  const cases = [
    ['fix(ssh): handle fragmented prompts', '0.1.0', '0.1.1'],
    ['perf(preview): reduce rendering overhead', '0.1.0', '0.1.1'],
    ['feat(backup): add a backup manager', '0.1.0', '0.2.0'],
    ['feat(ssh)!: change response format\n\nBREAKING CHANGE: callers must use the new format.', '0.1.0', '0.2.0'],
    ['fix(ssh): change response format\n\nBREAKING CHANGE: callers must migrate.', '1.2.3', '2.0.0'],
  ];
  for (const [message, previous, expected] of cases) {
    const result = await candidate(message, previous);
    assert.equal(result.version.toString(), expected);
    assert.match(result.body.toString(), new RegExp(`v${expected.replaceAll('.', '\\.')}`));
    console.log(`PASS ${message.split('\n')[0]}: ${previous} -> ${expected}`);
  }
  for (const type of ['ci', 'chore', 'docs', 'test', 'build', 'refactor', 'style']) {
    assert.equal(await candidate(`${type}: maintain tooling`), undefined);
  }
  console.log('PASS maintenance-only commits do not create a release PR');
  const result = await candidate('feat(backup): add a backup manager');
  const release = await strategy().buildRelease({
    headBranchName: result.headRefName, baseBranchName: 'main', number: 1,
    title: result.title.toString(), body: result.body.toString(),
    labels: ['autorelease: pending'], files: [], sha: 'c'.repeat(40),
  });
  assert.equal(release.tag.toString(), 'v0.2.0');
  console.log('PASS merged release PR produces an unprefixed v0.2.0 tag');
  const updated = {};
  for (const file of ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
    const update = result.updates.find(update => update.path === file);
    assert.ok(update, `Missing update for ${file}`);
    updated[file] = update.updater.updateContent(read(file), logger);
  }
  assert.equal(JSON.parse(updated['package.json']).version, '0.2.0');
  assert.equal(JSON.parse(updated['src-tauri/tauri.conf.json']).version, '0.2.0');
  assert.equal(toml.parse(updated['src-tauri/Cargo.toml']).package.version, '0.2.0');
  const oldLock = toml.parse(read('src-tauri/Cargo.lock'));
  const newLock = toml.parse(updated['src-tauri/Cargo.lock']);
  assert.equal(newLock.package.find(pkg => pkg.name === 'proxytools').version, '0.2.0');
  assert.deepEqual(newLock.package.filter(pkg => pkg.name !== 'proxytools'), oldLock.package.filter(pkg => pkg.name !== 'proxytools'));
  assert.equal(updated['src-tauri/Cargo.lock'], read('src-tauri/Cargo.lock').replace(/(name = "proxytools"\r?\nversion = ")0\.1\.0(")/, '$10.2.0$2'));
  assert.equal(updated['src-tauri/Cargo.toml'], read('src-tauri/Cargo.toml').replace('version = "0.1.0"', 'version = "0.2.0"'));
  console.log('PASS all app versions update, dependency versions and Cargo formatting remain unchanged');
  const releaseWorkflow = YAML.parse(read('.github/workflows/release-please.yml'));
  const buildWorkflow = YAML.parse(read('.github/workflows/build.yml'));
  assert.equal(releaseWorkflow.jobs.windows.uses, './.github/workflows/build.yml');
  assert.equal(releaseWorkflow.jobs.windows.if, "needs.release.outputs.release_created == 'true'");
  assert.ok(buildWorkflow.on.workflow_dispatch);
  assert.equal(buildWorkflow.on.workflow_call.inputs.release_tag.required, true);
  assert.equal(buildWorkflow.jobs.build.steps[0].with.ref, '${{ inputs.release_tag || github.ref }}');
  console.log('PASS reusable release build checks out tag and preserves manual dispatch');
  const Ajv = require('ajv');
  const ajv = new Ajv({ strict: false, validateFormats: false });
  for (const [file, schema] of [['release-please-config.json', 'config.json'], ['.release-please-manifest.json', 'manifest.json']]) {
    const validate = ajv.compile(require(`release-please/schemas/${schema}`));
    assert.ok(validate(JSON.parse(read(file))), JSON.stringify(validate.errors));
    console.log(`PASS schema: ${file}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
