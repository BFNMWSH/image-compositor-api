import express from 'express';
import sharp from 'sharp';
import fetch from 'node-fetch';
import { createCanvas, loadImage, registerFont } from 'canvas';
import PDFDocument from 'pdfkit';

// Register all Poppins weights
registerFont('./fonts/Poppins-Regular.ttf', { family: 'Poppins', weight: 'normal' });
registerFont('./fonts/Poppins-Medium.ttf', { family: 'Poppins', weight: '500' });
registerFont('./fonts/Poppins-SemiBold.ttf', { family: 'Poppins', weight: '600' });
registerFont('./fonts/Poppins-Bold.ttf', { family: 'Poppins', weight: 'bold' });
registerFont('./fonts/Poppins-ExtraBold.ttf', { family: 'Poppins', weight: '800' });

const app = express();
app.use(express.json({ limit: '50mb' }));

// Helper to download images
async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

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

    // Background white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // === PRODUCT SECTION with 3% padding ===
    const topPadding = WIDTH * 0.03;
    const productHeight = 1700;
    const productImg = await loadImage(await downloadImage(product_image_url));

    const productWidth = WIDTH - topPadding * 2;
    const productDrawHeight = productHeight - topPadding * 2;
    ctx.drawImage(productImg, topPadding, topPadding, productWidth, productDrawHeight);

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
    const profilePaddingBottom = 25; // bottom padding for profile
    const profilePaddingLeft = WIDTH * 0.05; // 3% left padding
    const profileSize = 170;
    const profileX = profilePaddingLeft; // bottom-left corner with left padding
    const profileY = HEIGHT - profileSize - profilePaddingBottom;

    // Draw profile border
    const borderWidth = 8;
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2 + borderWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#4899d4'; // light baby blue
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
      const badgeSize = 50;
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
    ctx.font = '800 40px Poppins'; // ExtraBold for name
    ctx.fillText(full_name.toUpperCase(), WIDTH / 2, verticalCenterY - 15);

    ctx.fillStyle = '#232424';
    ctx.font = '600 32px Poppins'; // SemiBold for WhatsApp number
    ctx.fillText(whatsapp_number, WIDTH / 2, verticalCenterY + 35);

    // Return final image
    const buffer = canvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.png"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error composing image:', error);
    res.status(500).json({ error: 'Failed to compose image', details: error.message });
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

    // A4 dimensions (595 x 842 points)
    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;
    
    // Canvas dimensions (higher res for quality)
    const CANVAS_WIDTH = 1240;
    const CANVAS_HEIGHT = 1754;
    
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // === PRODUCT SECTION with 3% padding ===
    const topPadding = CANVAS_WIDTH * 0.03;
    const productHeight = 1500;
    const productImg = await loadImage(await downloadImage(product_image_url));

    const productWidth = CANVAS_WIDTH - topPadding * 2;
    const productDrawHeight = productHeight - topPadding * 2;
    ctx.drawImage(productImg, topPadding, topPadding, productWidth, productDrawHeight);

    // === CONTACT BUTTON with shadow ===
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

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 38px Poppins';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTACT ME', CANVAS_WIDTH / 2, buttonY + buttonHeight / 2);

    // === BOTTOM SECTION ===
    const profilePaddingBottom = 22;
    const profilePaddingLeft = CANVAS_WIDTH * 0.05;
    const profileSize = 150;
    const profileX = profilePaddingLeft;
    const profileY = CANVAS_HEIGHT - profileSize - profilePaddingBottom;

    // Draw profile border
    const borderWidth = 7;
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

    // Verified badge
    if (verified_badge_url) {
      const badgeSize = 45;
      const badgeX = profileX - (badgeSize * 0.3);
      const badgeY = profileY - (badgeSize * 0.3);
      const badgeImg = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(badgeImg, badgeX, badgeY, badgeSize, badgeSize);
    }

    // TC Logo flush to bottom-right
    const logoSize = 165;
    const logoX = CANVAS_WIDTH - logoSize - topPadding;
    const logoY = CANVAS_HEIGHT - logoSize;
    if (tc_logo_url) {
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    // Full name & WhatsApp centered vertically
    const profileCenterY = profileY + profileSize / 2;
    const logoCenterY = logoY + logoSize / 2;
    const verticalCenterY = (profileCenterY + logoCenterY) / 2;

    ctx.textAlign = 'center';
   
    if (tc_ref_code) {
    ctx.fillStyle = '#1e40af';
    ctx.font = 'bold 32px Poppins';  // ← Slightly smaller for A4
    ctx.fillText(tc_ref_code, CANVAS_WIDTH / 2, verticalCenterY - 55);
    }
    
    ctx.fillStyle = '#1e40af';
    ctx.font = '800 36px Poppins';
    ctx.fillText(full_name.toUpperCase(), CANVAS_WIDTH / 2, verticalCenterY - 13);

    ctx.fillStyle = '#232424';
    ctx.font = '600 28px Poppins';
    ctx.fillText(whatsapp_number, CANVAS_WIDTH / 2, verticalCenterY + 30);

    // Convert canvas to buffer
    const imageBuffer = canvas.toBuffer('image/png');

    // Create PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.pdf"`);

    doc.pipe(res);
    doc.image(imageBuffer, 0, 0, {
      width: A4_WIDTH,
      height: A4_HEIGHT
    });
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
