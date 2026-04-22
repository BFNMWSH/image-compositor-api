import express from 'express';
import sharp from 'sharp';
import fetch from 'node-fetch';
import { createCanvas, loadImage, registerFont } from 'canvas';
import PDFDocument from 'pdfkit';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Register all Poppins weights
registerFont('./fonts/Poppins-Regular.ttf', { family: 'Poppins', weight: 'normal' });
registerFont('./fonts/Poppins-Medium.ttf', { family: 'Poppins', weight: '500' });
registerFont('./fonts/Poppins-SemiBold.ttf', { family: 'Poppins', weight: '600' });
registerFont('./fonts/Poppins-Bold.ttf', { family: 'Poppins', weight: 'bold' });
registerFont('./fonts/Poppins-ExtraBold.ttf', { family: 'Poppins', weight: '800' });

const app = express();
app.use(express.json({ limit: '50mb' }));

const IMGBB_API_KEY = 'ef3789f3838bf122f75299136740f622';

// Helper to download images
async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// Helper to upload a buffer to imgbb and return the hosted URL
async function uploadToImgbb(buffer, filename) {
  const base64 = buffer.toString('base64');
  const params = new URLSearchParams();
  params.append('key', IMGBB_API_KEY);
  params.append('image', base64);
  if (filename) params.append('name', filename);

  const response = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: params,
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`imgbb upload failed: ${JSON.stringify(data)}`);
  }

  return data.data.url;
}

app.post('/api/compose', async (req, res) => {
  try {
    const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = req.body;

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    const WIDTH = 1080;
    const HEIGHT = 1920;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // === PRODUCT SECTION with 3% padding ===
    const topPadding = WIDTH * 0.03;
    const productHeight = 1700;
    const productImg = await loadImage(await downloadImage(product_image_url));
    
    const productWidth = WIDTH - topPadding * 2;
    const productImgRatio = productImg.width / productImg.height;
    const productDrawHeight = productWidth / productImgRatio;
    const productDrawY = topPadding;
    ctx.drawImage(productImg, topPadding, productDrawY, productWidth, productDrawHeight);

    // === CONTACT BUTTON with shadow ===
    const buttonHeight = 100;
    const buttonWidth = 600;
    const buttonX = (WIDTH - buttonWidth) / 2;
    const buttonY = productHeight - buttonHeight / 2 - 40;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 50);
    ctx.fill();

    // Reset shadow for text
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 42px Poppins';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTACT ME', WIDTH / 2, buttonY + buttonHeight / 2);

    // === BOTTOM SECTION ===
    const profilePaddingBottom = 25;
    const profilePaddingLeft = WIDTH * 0.05;
    const profileSize = 170;
    const profileX = profilePaddingLeft;
    const profileY = HEIGHT - profileSize - profilePaddingBottom;

    // Draw profile border
    const borderWidth = 8;
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2 + borderWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#4899d4';
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    // Load profile image
    const profileImg = await loadImage(await downloadImage(profile_photo_url));
    ctx.save();
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Center and fill profile image
    const imgRatio = profileImg.width / profileImg.height;
    let drawWidth, drawHeight, drawX, drawY;
    if (imgRatio > 1) {
      drawHeight = profileSize;
      drawWidth = profileSize * imgRatio;
      drawX = profileX - (drawWidth - profileSize) / 2;
      drawY = profileY;
    } else {
      drawWidth = profileSize;
      drawHeight = profileSize / imgRatio;
      drawX = profileX;
      drawY = profileY - (drawHeight - profileSize) / 2;
    }
    ctx.drawImage(profileImg, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    // Verified badge (top-left corner of profile)
    if (verified_badge_url) {
      const badgeSize = 70;
      const badgeX = profileX - (badgeSize * 0.3);
      const badgeY = profileY - (badgeSize * 0.3);
      const badgeImg = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(badgeImg, badgeX, badgeY, badgeSize, badgeSize);
    }

    // TC Logo flush to bottom-right
    const logoSize = 190;
    const logoX = WIDTH - logoSize - topPadding;
    const logoY = HEIGHT - logoSize;
    if (tc_logo_url) {
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    // Full name & WhatsApp centered vertically between profile and logo
    const profileCenterY = profileY + profileSize / 2;
    const logoCenterY = logoY + logoSize / 2;
    const verticalCenterY = (profileCenterY + logoCenterY) / 2;

    ctx.textAlign = 'center';

    // TC Ref Code (if provided)
    if (tc_ref_code) {
      ctx.fillStyle = '#1e40af';
      ctx.font = 'bold 36px Poppins';
      ctx.fillText(tc_ref_code, WIDTH / 2, verticalCenterY - 60);
    }

    ctx.fillStyle = '#1e40af';
    ctx.font = '800 56px Poppins';
    ctx.fillText(full_name.toUpperCase(), WIDTH / 2, verticalCenterY - 15);

    ctx.fillStyle = '#232424';
    ctx.font = '600 32px Poppins';
    ctx.fillText(whatsapp_number, WIDTH / 2, verticalCenterY + 35);

    // Upload to imgbb and return JSON URL instead of raw binary
    const buffer = canvas.toBuffer('image/png');
    const filename = full_name.replace(/\s+/g, '_');
    const imageUrl = await uploadToImgbb(buffer, filename);

    res.status(200).json({
      success: true,
      url: imageUrl,
      message: 'Image generated successfully'
    });

  } catch (error) {
    console.error('Error composing image:', error);
    res.status(500).json({ success: false, error: 'Failed to compose image', details: error.message });
  }
});

// PDF ENDPOINT
app.post('/api/compose-pdf', async (req, res) => {
  try {
    const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = req.body;

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;
    const CANVAS_WIDTH = 1240;
    const CANVAS_HEIGHT = 1754;
    
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const topPadding = CANVAS_WIDTH * 0.03;
    const productHeight = 1500;
    const productImg = await loadImage(await downloadImage(product_image_url));

    const productWidth = CANVAS_WIDTH - topPadding * 2;
    const productDrawHeight = productHeight - topPadding * 2;
    ctx.drawImage(productImg, topPadding, topPadding, productWidth, productDrawHeight);

    const buttonHeight = 90;
    const buttonWidth = 520;
    const buttonX = (CANVAS_WIDTH - buttonWidth) / 2;
    const buttonY = productHeight - buttonHeight / 2 - 30;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 45);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 38px Poppins';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTACT ME', CANVAS_WIDTH / 2, buttonY + buttonHeight / 2);

    const profilePaddingBottom = 22;
    const profilePaddingLeft = CANVAS_WIDTH * 0.05;
    const profileSize = 150;
    const profileX = profilePaddingLeft;
    const profileY = CANVAS_HEIGHT - profileSize - profilePaddingBottom;

    const borderWidth = 7;
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2 + borderWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#4899d4';
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    const profileImg = await loadImage(await downloadImage(profile_photo_url));
    ctx.save();
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const imgRatio = profileImg.width / profileImg.height;
    let drawWidth, drawHeight, drawX, drawY;
    if (imgRatio > 1) {
      drawHeight = profileSize;
      drawWidth = profileSize * imgRatio;
      drawX = profileX - (drawWidth - profileSize) / 2;
      drawY = profileY;
    } else {
      drawWidth = profileSize;
      drawHeight = profileSize / imgRatio;
      drawX = profileX;
      drawY = profileY - (drawHeight - profileSize) / 2;
    }
    ctx.drawImage(profileImg, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    if (verified_badge_url) {
      const badgeSize = 45;
      const badgeX = profileX - (badgeSize * 0.3);
      const badgeY = profileY - (badgeSize * 0.3);
      const badgeImg = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(badgeImg, badgeX, badgeY, badgeSize, badgeSize);
    }

    const logoSize = 165;
    const logoX = CANVAS_WIDTH - logoSize - topPadding;
    const logoY = CANVAS_HEIGHT - logoSize;
    if (tc_logo_url) {
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    const profileCenterY = profileY + profileSize / 2;
    const logoCenterY = logoY + logoSize / 2;
    const verticalCenterY = (profileCenterY + logoCenterY) / 2;

    ctx.textAlign = 'center';
   
    if (tc_ref_code) {
      ctx.fillStyle = '#1e40af';
      ctx.font = 'bold 32px Poppins';
      ctx.fillText(tc_ref_code, CANVAS_WIDTH / 2, verticalCenterY - 55);
    }
    
    ctx.fillStyle = '#1e40af';
    ctx.font = '800 36px Poppins';
    ctx.fillText(full_name.toUpperCase(), CANVAS_WIDTH / 2, verticalCenterY - 13);

    ctx.fillStyle = '#232424';
    ctx.font = '600 28px Poppins';
    ctx.fillText(whatsapp_number, CANVAS_WIDTH / 2, verticalCenterY + 30);

    const imageBuffer = canvas.toBuffer('image/png');

    const doc = new PDFDocument({ size: 'A4', margin: 0 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.pdf"`);

    doc.pipe(res);
    doc.image(imageBuffer, 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });
    doc.end();

  } catch (error) {
    console.error('Error composing PDF:', error);
    res.status(500).json({ error: 'Failed to compose PDF', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Image Compositor API' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Image Compositor API running on port ${PORT}`);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to generate a single frame with animation progress
async function generateFrame(frameNum, totalFrames, data, tempDir) {
  const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = data;
  
  const WIDTH = 1080;
  const HEIGHT = 1920;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const progress = frameNum / totalFrames;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const eased = easeOutCubic(progress);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const topPadding = WIDTH * 0.03;
  const productHeight = 1700;
  
  const productProgress = Math.min(progress * 2.5, 1);
  const productEased = easeOutCubic(productProgress);
  const productZoom = 1 + (0.05 * (1 - productEased));
  
  ctx.globalAlpha = productEased;
  
  const productImg = await loadImage(await downloadImage(product_image_url));
  const productWidth = WIDTH - topPadding * 2;
  const productDrawHeight = productHeight - topPadding * 2;
  
  const zoomWidth = productWidth * productZoom;
  const zoomHeight = productDrawHeight * productZoom;
  const zoomOffsetX = (zoomWidth - productWidth) / 2;
  const zoomOffsetY = (zoomHeight - productDrawHeight) / 2;
  
  ctx.drawImage(productImg, topPadding - zoomOffsetX, topPadding - zoomOffsetY, zoomWidth, zoomHeight);
  ctx.globalAlpha = 1;

  const buttonProgress = Math.max(0, Math.min((progress - 0.3) * 2.5, 1));
  const buttonEased = easeOutCubic(buttonProgress);
  
  const buttonHeight = 100;
  const buttonWidth = 600;
  const buttonX = (WIDTH - buttonWidth) / 2;
  const buttonYFinal = productHeight - buttonHeight / 2 - 80;
  const buttonYStart = buttonYFinal + 100;
  const buttonY = buttonYStart + (buttonYFinal - buttonYStart) * buttonEased;

  if (buttonProgress > 0) {
    ctx.globalAlpha = buttonEased;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 50);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 42px Poppins';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTACT ME', WIDTH / 2, buttonY + buttonHeight / 2);
    ctx.globalAlpha = 1;
  }

  const bottomProgress = Math.max(0, Math.min((progress - 0.5) * 2, 1));
  const bottomEased = easeOutCubic(bottomProgress);

  if (bottomProgress > 0) {
    ctx.globalAlpha = bottomEased;
    
    const profilePaddingBottom = 25;
    const profilePaddingLeft = WIDTH * 0.05;
    const profileSize = 170;
    const profileX = profilePaddingLeft;
    const profileY = HEIGHT - profileSize - profilePaddingBottom;

    const borderWidth = 8;
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2 + borderWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#4899d4';
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    const profileImg = await loadImage(await downloadImage(profile_photo_url));
    ctx.save();
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const imgRatio = profileImg.width / profileImg.height;
    let drawWidth, drawHeight, drawX, drawY;
    if (imgRatio > 1) {
      drawHeight = profileSize;
      drawWidth = profileSize * imgRatio;
      drawX = profileX - (drawWidth - profileSize) / 2;
      drawY = profileY;
    } else {
      drawWidth = profileSize;
      drawHeight = profileSize / imgRatio;
      drawX = profileX;
      drawY = profileY - (drawHeight - profileSize) / 2;
    }
    ctx.drawImage(profileImg, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    if (verified_badge_url) {
      const badgeSize = 50;
      const badgeImg = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(badgeImg, profileX - (badgeSize * 0.3), profileY - (badgeSize * 0.3), badgeSize, badgeSize);
    }

    const logoSize = 190;
    const logoX = WIDTH - logoSize - topPadding;
    const logoY = HEIGHT - logoSize;
    if (tc_logo_url) {
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    const profileCenterY = profileY + profileSize / 2;
    const logoCenterY = logoY + logoSize / 2;
    const verticalCenterY = (profileCenterY + logoCenterY) / 2;

    ctx.textAlign = 'center';

    if (tc_ref_code) {
      const refProgress = Math.max(0, Math.min((progress - 0.55) * 3, 1));
      ctx.globalAlpha = easeOutCubic(refProgress) * bottomEased;
      ctx.fillStyle = '#1e40af';
      ctx.font = 'bold 36px Poppins';
      ctx.fillText(tc_ref_code, WIDTH / 2, verticalCenterY - 80);
    }

    const nameProgress = Math.max(0, Math.min((progress - 0.6) * 3, 1));
    ctx.globalAlpha = easeOutCubic(nameProgress) * bottomEased;
    ctx.fillStyle = '#1e40af';
    ctx.font = '800 40px Poppins';
    ctx.fillText(full_name.toUpperCase(), WIDTH / 2, verticalCenterY - 5);

    const whatsappProgress = Math.max(0, Math.min((progress - 0.65) * 3, 1));
    ctx.globalAlpha = easeOutCubic(whatsappProgress) * bottomEased;
    ctx.fillStyle = '#232424';
    ctx.font = '600 32px Poppins';
    ctx.fillText(whatsapp_number, WIDTH / 2, verticalCenterY + 45);
    
    ctx.globalAlpha = 1;
  }

  const buffer = canvas.toBuffer('image/png');
  const framePath = path.join(tempDir, `frame_${String(frameNum).padStart(4, '0')}.png`);
  await writeFile(framePath, buffer);
  
  return framePath;
}

// VIDEO ENDPOINT
app.post('/api/compose-video', async (req, res) => {
  const tempDir = path.join(__dirname, 'temp_frames_' + Date.now());
  
  try {
    const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = req.body;

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    await mkdir(tempDir, { recursive: true });

    const FPS = 30;
    const DURATION = 5;
    const totalFrames = FPS * DURATION;

    console.log(`Generating ${totalFrames} frames...`);

    for (let i = 0; i < totalFrames; i++) {
      await generateFrame(i, totalFrames, req.body, tempDir);
      if (i % 30 === 0) console.log(`Generated frame ${i}/${totalFrames}`);
    }

    console.log('All frames generated, creating video...');

    const outputPath = path.join(__dirname, `output_${Date.now()}.mp4`);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(tempDir, 'frame_%04d.png'))
        .inputFPS(FPS)
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-preset medium', '-crf 23'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    console.log('Video created successfully!');

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.mp4"`);
    
    const videoBuffer = await promisify(require('fs').readFile)(outputPath);
    res.send(videoBuffer);

    setTimeout(async () => {
      try {
        const files = await promisify(require('fs').readdir)(tempDir);
        for (const file of files) {
          await unlink(path.join(tempDir, file));
        }
        await promisify(require('fs').rmdir)(tempDir);
        await unlink(outputPath);
        console.log('Cleanup completed');
      } catch (err) {
        console.error('Cleanup error:', err);
      }
    }, 5000);

  } catch (error) {
    console.error('Error composing video:', error);
    
    try {
      if (existsSync(tempDir)) {
        const files = await promisify(require('fs').readdir)(tempDir);
        for (const file of files) {
          await unlink(path.join(tempDir, file));
        }
        await promisify(require('fs').rmdir)(tempDir);
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
    
    res.status(500).json({ error: 'Failed to compose video', details: error.message });
  }
});
