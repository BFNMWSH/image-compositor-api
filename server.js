import express from 'express';
import sharp from 'sharp';
import fetch from 'node-fetch';
import { createCanvas, loadImage, registerFont } from 'canvas';
import PDFDocument from 'pdfkit';
import ffmpeg from 'fluent-ffmpeg';
import { writeFile, unlink, mkdir, readFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ==== IMPORTANT: compute __dirname early so registerFont uses correct absolute paths ====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register all Poppins weights using absolute paths
registerFont(path.join(__dirname, 'fonts', 'Poppins-Regular.ttf'), { family: 'Poppins', weight: '400' });
registerFont(path.join(__dirname, 'fonts', 'Poppins-Medium.ttf'), { family: 'Poppins', weight: '500' });
registerFont(path.join(__dirname, 'fonts', 'Poppins-SemiBold.ttf'), { family: 'Poppins', weight: '600' });
registerFont(path.join(__dirname, 'fonts', 'Poppins-Bold.ttf'), { family: 'Poppins', weight: '700' });
registerFont(path.join(__dirname, 'fonts', 'Poppins-ExtraBold.ttf'), { family: 'Poppins', weight: '800' });

const app = express();
app.use(express.json({ limit: '50mb' }));

// Small helper: download image to buffer
async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url} (status ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

// Helper to draw rounded rect (works across node-canvas versions)
function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = typeof r === 'number' ? r : 0;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// --- /api/compose (image) ---
app.post('/api/compose', async (req, res) => {
  try {
    const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = req.body;

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    const WIDTH = 1080;
    const HEIGHT = 1920;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Product
    const topPadding = WIDTH * 0.03;
    const productHeight = 1700;
    const productImg = await loadImage(await downloadImage(product_image_url));
    const productWidth = WIDTH - topPadding * 2;
    const productDrawHeight = productHeight - topPadding * 2;
    ctx.drawImage(productImg, topPadding, topPadding, productWidth, productDrawHeight);

    // Contact button (rounded rect via helper)
    const buttonHeight = 100;
    const buttonWidth = 600;
    const buttonX = (WIDTH - buttonWidth) / 2;
    const buttonY = productHeight - buttonHeight / 2 - 40;

    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = '#1e40af';
    drawRoundedRect(ctx, buttonX, buttonY, buttonWidth, buttonHeight, 50);
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

    // Bottom section: profile circle
    const profilePaddingBottom = 25;
    const profilePaddingLeft = WIDTH * 0.05;
    const profileSize = 170;
    const profileX = profilePaddingLeft;
    const profileY = HEIGHT - profileSize - profilePaddingBottom;

    // Border
    const borderWidth = 8;
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2 + borderWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#4899d4';
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    // Profile image (crop to circle)
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

    // Verified badge
    if (verified_badge_url) {
      const badgeSize = 70;
      const badgeX = profileX - (badgeSize * 0.3);
      const badgeY = profileY - (badgeSize * 0.3);
      const badgeImg = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(badgeImg, badgeX, badgeY, badgeSize, badgeSize);
    }

    // TC Logo bottom-right
    const logoSize = 190;
    const logoX = WIDTH - logoSize - topPadding;
    const logoY = HEIGHT - logoSize;
    if (tc_logo_url) {
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    // Name / whatsapp / ref centered vertically between profile and logo
    const profileCenterY = profileY + profileSize / 2;
    const logoCenterY = logoY + logoSize / 2;
    const verticalCenterY = (profileCenterY + logoCenterY) / 2;

    ctx.textAlign = 'center';

    if (tc_ref_code) {
      ctx.fillStyle = '#1e40af';
      ctx.font = 'bold 36px Poppins';
      ctx.fillText(tc_ref_code, WIDTH / 2, verticalCenterY - 60);
    }

    ctx.fillStyle = '#1e40af';
    ctx.font = '800 40px Poppins';
    ctx.fillText(full_name.toUpperCase(), WIDTH / 2, verticalCenterY - 15);

    ctx.fillStyle = '#232424';
    ctx.font = '600 32px Poppins';
    ctx.fillText(whatsapp_number, WIDTH / 2, verticalCenterY + 35);

    // Send PNG
    const buffer = canvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.png"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error composing image:', error);
    res.status(500).json({ error: 'Failed to compose image', details: error.message });
  }
});

// --- /api/compose-pdf ---
app.post('/api/compose-pdf', async (req, res) => {
  try {
    const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = req.body;

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    // A4 points
    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;

    // Canvas (higher resolution)
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

    // contact button
    const buttonHeight = 90;
    const buttonWidth = 520;
    const buttonX = (CANVAS_WIDTH - buttonWidth) / 2;
    const buttonY = productHeight - buttonHeight / 2 - 30;

    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = '#1e40af';
    drawRoundedRect(ctx, buttonX, buttonY, buttonWidth, buttonHeight, 45);
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

    // bottom profile similar to image endpoint
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

    // name / whatsapp
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

    // Convert canvas to buffer and create PDF
    const imageBuffer = canvas.toBuffer('image/png');

    const doc = new PDFDocument({
      size: 'A4',
      margin: 0
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.pdf"`);

    doc.pipe(res);
    // PDFKit expects dimensions in points; we use A4 constants for width/height in points
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

// Helper to generate a single frame (animation)
async function generateFrame(frameNum, totalFrames, data, tempDir) {
  const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = data;

  const WIDTH = 1080;
  const HEIGHT = 1920;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Progress uses (frameNum + 1) so last frame reaches 1.0
  const progress = (frameNum + 1) / totalFrames;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const eased = easeOutCubic(progress);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Product fade/zoom
  const topPadding = WIDTH * 0.03;
  const productHeight = 1700;
  const productProgress = Math.min(progress * 2.5, 1);
  const productEased = easeOutCubic(productProgress);
  const productOpacity = productEased;
  const productZoom = 1 + (0.05 * (1 - productEased));
  ctx.globalAlpha = productOpacity;

  const productImg = await loadImage(await downloadImage(product_image_url));
  const productWidth = WIDTH - topPadding * 2;
  const productDrawHeight = productHeight - topPadding * 2;

  const zoomWidth = productWidth * productZoom;
  const zoomHeight = productDrawHeight * productZoom;
  const zoomOffsetX = (zoomWidth - productWidth) / 2;
  const zoomOffsetY = (zoomHeight - productDrawHeight) / 2;

  ctx.drawImage(productImg, topPadding - zoomOffsetX, topPadding - zoomOffsetY, zoomWidth, zoomHeight);
  ctx.globalAlpha = 1;

  // Button slide up
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

    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = '#1e40af';
    drawRoundedRect(ctx, buttonX, buttonY, buttonWidth, buttonHeight, 50);
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

  // Bottom section fade in
  const bottomProgress = Math.max(0, Math.min((progress - 0.5) * 2, 1));
  const bottomEased = easeOutCubic(bottomProgress);

  if (bottomProgress > 0) {
    ctx.globalAlpha = bottomEased;

    const profilePaddingBottom = 25;
    const profilePaddingLeft = WIDTH * 0.05;
    const profileSize = 170;
    const profileX = profilePaddingLeft;
    const profileY = HEIGHT - profileSize - profilePaddingBottom;

    // profile border
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
      const badgeX = profileX - (badgeSize * 0.3);
      const badgeY = profileY - (badgeSize * 0.3);
      const badgeImg = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(badgeImg, badgeX, badgeY, badgeSize, badgeSize);
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

// --- /api/compose-video ---
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
    const DURATION = 5; // seconds
    const totalFrames = FPS * DURATION;

    console.log(`Generating ${totalFrames} frames in ${tempDir}...`);

    for (let i = 0; i < totalFrames; i++) {
      await generateFrame(i, totalFrames, req.body, tempDir);
      if (i % 30 === 0) console.log(`Generated frame ${i}/${totalFrames}`);
    }

    console.log('All frames generated, creating video...');

    const outputPath = path.join(__dirname, `output_${Date.now()}.mp4`);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(tempDir, 'frame_%04d.png'))
        .inputOptions(['-start_number 0'])
        .inputFPS(FPS)
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-preset medium', '-crf 23'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', (err) => reject(err))
        .run();
    });

    console.log('Video created successfully!');

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.mp4"`);

    const videoBuffer = await readFile(outputPath);
    res.send(videoBuffer);

    // Cleanup (use rm with recursive)
    setTimeout(async () => {
      try {
        await rm(tempDir, { recursive: true, force: true });
        await unlink(outputPath);
        console.log('Cleanup completed');
      } catch (err) {
        console.error('Cleanup error:', err);
      }
    }, 5000);

  } catch (error) {
    console.error('Error composing video:', error);

    // Cleanup on error
    try {
      if (existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }

    res.status(500).json({ error: 'Failed to compose video', details: error.message });
  }
});
