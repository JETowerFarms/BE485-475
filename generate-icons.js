const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

const sourceIcon = 'assets/icon.png';

async function generateIcons() {
  console.log('Generating Android launcher icons...');
  
  for (const [folder, size] of Object.entries(sizes)) {
    const outputDir = path.join('android', 'app', 'src', 'main', 'res', folder);
    
    // Generate ic_launcher.png
    await sharp(sourceIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'ic_launcher.png'));
    
    // Generate ic_launcher_round.png
    await sharp(sourceIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, 'ic_launcher_round.png'));
    
    console.log(`✓ Created ${folder} icons (${size}x${size})`);
  }
  
  console.log('Done! Icons generated successfully.');
}

generateIcons().catch(console.error);
