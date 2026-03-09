const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
  // iOS sizes
  'ios-20@1x': 20,
  'ios-20@2x': 40,
  'ios-20@3x': 60,
  'ios-29@1x': 29,
  'ios-29@2x': 58,
  'ios-29@3x': 87,
  'ios-40@1x': 40,
  'ios-40@2x': 80,
  'ios-40@3x': 120,
  'ios-60@2x': 120,
  'ios-60@3x': 180,
  'ios-76@1x': 76,
  'ios-76@2x': 152,
  'ios-83.5@2x': 167,
  'ios-1024@1x': 1024
};

const sourceIcon = 'assets/icon.png';

async function generateIcons() {
  console.log('Generating Android launcher icons and iOS app icons...');
  
  for (const [folder, size] of Object.entries(sizes)) {
    if (folder.startsWith('mipmap-')) {
      const outputDir = path.join('android', 'app', 'src', 'main', 'res', folder);
      
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
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
    } else if (folder.startsWith('ios-')) {
      const iosOutputDir = path.join('ios', 'optimizationtool', 'Images.xcassets', 'AppIcon.appiconset');
      
      // Ensure output directory exists
      if (!fs.existsSync(iosOutputDir)) {
        fs.mkdirSync(iosOutputDir, { recursive: true });
      }
      
      const parts = folder.split('-')[1].split('@');
      const dim = parts[0];
      const scale = parts[1];
      let filename;
      if (dim === '83.5') {
        filename = `Icon-83.5x83.5@${scale}.png`;
      } else if (dim === '1024') {
        filename = `Icon-1024x1024@${scale}.png`;
      } else {
        filename = `Icon-${dim}x${dim}@${scale}.png`;
      }
      
      await sharp(sourceIcon)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(path.join(iosOutputDir, filename));
      
      console.log(`✓ Created iOS icon ${filename} (${size}x${size})`);
    }
  }
  
  console.log('Done! Icons generated successfully.');
}

generateIcons().catch(console.error);
