const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const web = path.join(root, 'WeekNote', 'www');

test('every local stylesheet and script referenced by the phone page is included in the source package', () => {
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  const references = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(references.length >= 4);
  for (const reference of references) {
    assert.doesNotMatch(reference, /^(?:https?:|\/\/|data:)/, 'the offline page must use bundled program assets');
    const filename = path.resolve(web, reference);
    assert.ok(filename.startsWith(web + path.sep), `asset escapes the bundled web directory: ${reference}`);
    assert.ok(fs.statSync(filename).isFile(), `missing asset: ${reference}`);
  }
});

test('all shipped browser JavaScript parses without requiring npm dependencies', () => {
  const scripts = fs.readdirSync(web).filter((filename) => filename.endsWith('.js'));
  assert.ok(scripts.includes('app.js') && scripts.includes('native.js'));
  for (const filename of scripts) {
    const source = fs.readFileSync(path.join(web, filename), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename }), filename);
  }
});

test('the shared Xcode scheme refers to a real target and all app sources and resources are present', () => {
  const project = fs.readFileSync(path.join(root, 'WeekNote.xcodeproj', 'project.pbxproj'), 'utf8');
  const scheme = fs.readFileSync(path.join(root, 'WeekNote.xcodeproj', 'xcshareddata', 'xcschemes', 'WeekNote.xcscheme'), 'utf8');
  const identifier = scheme.match(/BlueprintIdentifier="([A-F0-9]{24})"/)?.[1];
  assert.ok(identifier, 'shared scheme must identify a target');
  assert.ok(project.includes(`"${identifier}" = {`));
  assert.match(scheme, /ReferencedContainer="container:WeekNote\.xcodeproj"/);
  for (const filename of ['WeekNoteApp.swift', 'NativeStore.swift', 'ReminderService.swift', 'WebHost.swift', 'Info.plist', 'PrivacyInfo.xcprivacy', 'www', 'Assets.xcassets']) {
    assert.ok(fs.existsSync(path.join(root, 'WeekNote', filename)), `missing app file or folder: ${filename}`);
    assert.ok(project.includes(`"path" = "${filename}"`), `app project omits ${filename}`);
  }
  // This checks source-package wiring only. It does not parse or compile Swift.
});

test('each app-icon asset exists and its PNG dimensions match its declared size and scale', () => {
  const directory = path.join(root, 'WeekNote', 'Assets.xcassets', 'AppIcon.appiconset');
  const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'Contents.json'), 'utf8'));
  assert.ok(catalog.images.some((image) => image.idiom === 'ios-marketing' && image.size === '1024x1024'));
  for (const image of catalog.images) {
    const bytes = fs.readFileSync(path.join(directory, image.filename));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', image.filename);
    const [width, height] = image.size.split('x').map(Number);
    const scale = Number.parseFloat(image.scale);
    assert.equal(bytes.readUInt32BE(16), width * scale, image.filename);
    assert.equal(bytes.readUInt32BE(20), height * scale, image.filename);
  }
});
