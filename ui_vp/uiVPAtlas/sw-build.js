const fs = require('fs');
const path = require('path');

function incrementVersion(version, type = 'patch') {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}. Expected x.y.z format.`);
  }
  let [major, minor, patch] = parts;
  switch (type) {
    case 'major': major++; minor = 0; patch = 0; break;
    case 'minor': minor++; patch = 0; break;
    case 'patch': default: patch++; break;
  }
  return `${major}.${minor}.${patch}`;
}

function buildServiceWorker() {
  try {
    console.log('Reading manifest.json...');
    const manifestPath = path.join(__dirname, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('manifest.json not found');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.version) manifest.version = '0.0.0';

    const currentVersion = manifest.version;
    const incrementType = process.argv[2] || 'patch';
    const newVersion = incrementVersion(currentVersion, incrementType);
    console.log(`Version: ${currentVersion} -> ${newVersion} (${incrementType})`);

    manifest.version = newVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4));
    console.log('Updated manifest.json');

    const swTemplatePath = path.join(__dirname, 'sw_template.js');
    const swOutputPath = path.join(__dirname, 'sw.js');
    if (!fs.existsSync(swTemplatePath)) throw new Error('sw_template.js not found');

    let swContent = fs.readFileSync(swTemplatePath, 'utf8');
    swContent = swContent.replace(/__APP_VERSION__/g, newVersion);
    swContent = swContent.replace(/__BUILD_TIMESTAMP__/g, Date.now());
    fs.writeFileSync(swOutputPath, swContent);
    console.log('Generated sw.js');
    console.log(`Build complete: ${currentVersion} -> ${newVersion}`);

    return { previousVersion: currentVersion, newVersion };
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) buildServiceWorker();
module.exports = { buildServiceWorker, incrementVersion };
