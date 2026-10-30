/* eslint-disable no-console */
// Keep the dt-algosdk version in the docs in step with package.json, and check it
// before a release.
//
// Usage:
//   node scripts/ci/dtalgosdk-release.js update        rewrite the docs for the package.json version
//   node scripts/ci/dtalgosdk-release.js check [tag]   fail if the docs, package-lock.json or the tag disagree
//
// `update` and `check <tag>` need the built bundle (npm run build) for its SRI hash.
// `check` without a tag skips the hash: between releases the README keeps the
// published bundle's hash, while src changes on the branch change the build.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));

const DOCS = ['README.md', 'DTALGOSDK.md'];
const FORMAT = '<algosdk version>-dt.<dt-algorand release>.<x.y.z>';
const VERSION_FORMAT = /^\d+\.\d+\.\d+-dt\.\d+\.\d+\.\d+\.\d+$/;
// dt-algosdk@3.9.0-dt.2.0.0.1 in install snippets and CDN URLs, and the
// dt-algosdk-3.9.0-dt.2.0.0.1.tgz name of a packed tarball
const versionRef = /dt-algosdk([@-])(\d+\.\d+\.\d+-dt(?:\.\d+)+)/g;
const integrityRef = /integrity="(sha384-[^"]*)"/g;

const [mode, tag] = process.argv.slice(2);
const pkg = readJson('package.json');
const { version } = pkg;

function bundleSri() {
  const bundle = path.join(root, 'dist', 'browser', 'algosdk.min.js');
  if (!fs.existsSync(bundle)) {
    console.error(`${bundle} is missing: run npm run build first`);
    process.exit(1);
  }
  const hash = crypto
    .createHash('sha384')
    .update(fs.readFileSync(bundle))
    .digest('base64');
  return `sha384-${hash}`;
}

if (mode === 'update') {
  if (!VERSION_FORMAT.test(version)) {
    console.error(`version ${version} is not ${FORMAT}`);
    process.exit(1);
  }
  const sri = bundleSri();
  for (const file of DOCS) {
    const text = read(file);
    const updated = text
      .replace(versionRef, (_, sep) => `dt-algosdk${sep}${version}`)
      .replace(integrityRef, `integrity="${sri}"`);
    fs.writeFileSync(path.join(root, file), updated);
    console.log(`${file}: ${text === updated ? 'unchanged' : 'updated'}`);
  }
  console.log(`version ${version}, ${sri}`);
} else if (mode === 'check') {
  const errors = [];
  const lock = readJson('package-lock.json');
  if (pkg.name !== 'dt-algosdk')
    errors.push(`package.json name is ${pkg.name}`);
  if (!VERSION_FORMAT.test(version))
    errors.push(`version ${version} is not ${FORMAT}`);
  if (lock.version !== version || lock.packages[''].version !== version)
    errors.push(`package-lock.json version ${lock.version} is not ${version}`);
  if (tag && tag !== `v${version}`)
    errors.push(`tag ${tag} is not v${version}`);
  const sri = tag ? bundleSri() : undefined;
  for (const file of DOCS) {
    const text = read(file);
    for (const [ref, , found] of text.matchAll(versionRef))
      if (found !== version) errors.push(`${file}: ${ref} is not ${version}`);
    if (sri)
      for (const [, found] of text.matchAll(integrityRef))
        if (found !== sri)
          errors.push(`${file}: integrity ${found} is not the bundle's ${sri}`);
  }
  if (errors.length) {
    errors.forEach((e) => console.error(e));
    console.error(
      'Run `node scripts/ci/dtalgosdk-release.js update` after `npm run build`'
    );
    process.exit(1);
  }
  console.log(
    `dt-algosdk ${version} is consistent${sri ? ` (${sri})` : ''}${tag ? ` with ${tag}` : ''}`
  );
} else {
  console.error('Usage: dtalgosdk-release.js update | check [tag]');
  process.exit(1);
}
