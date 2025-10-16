import express from 'express';
import sharp from 'sharp';
import fetch from 'node-fetch';
import { createCanvas, loadImage, registerFont } from 'canvas';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Helper function to download image as buffer
async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// Main composition endpoint
app.post('/api/compose', async (req, res) => {
  try {
    const {
      profile_photo_url,
      product_image_url,
      full_name,
      whatsapp_number,
      tc_logo_url,
      verified_badge_url
    } = req.body;

    // Validate required fields
    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    // Canvas dimensions
    const WIDTH = 1080;
    const HEIGHT = 1920;

    // Create canvas
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background - white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Load and draw product image (main content - top section)
    const productImg = await loadImage(await downloadImage(product_image_url));
    const productHeight = 1450; // Height for product section
    
    // Add 5% padding around product image
    const padding = WIDTH * 0.05; // 5% padding
    const productWidth = WIDTH - (padding * 2);
    const productDrawHeight = productHeight - (padding * 2);
    
    ctx.drawImage(productImg, padding, padding, productWidth, productDrawHeight);

    // Bottom section background - white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, productHeight, WIDTH, HEIGHT - productHeight);

    // "CONTACT ME" button area - slightly above bottom section
    const buttonY = productHeight - 100;
    const buttonHeight = 80;
    const buttonWidth = 400;
    const buttonX = (WIDTH - buttonWidth) / 2;

    // Draw button with rounded corners
    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 40);
    ctx.fill();

    // "CONTACT ME" text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTACT ME', WIDTH / 2, buttonY + buttonHeight / 2);

    // Profile photo - circular, centered horizontally
    const profileSize = 120;
    const profileX = (WIDTH - profileSize) / 2; // Center horizontally
    const profileY = productHeight + 100;

    const profileImg = await loadImage(await downloadImage(profile_photo_url));
    
    // Create circular clip for profile photo
    ctx.save();
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(profileImg, profileX, profileY, profileSize, profileSize);
    ctx.restore();

    // White border around profile photo
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2, 0, Math.PI * 2);
    ctx.stroke();

    // Name text - centered, blue color
    ctx.fillStyle = '#1e40af'; // Blue color
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(full_name.toUpperCase(), WIDTH / 2, profileY + 35);

    // WhatsApp number - centered, below name
    ctx.font = '28px Arial';
    ctx.fillText(whatsapp_number, WIDTH / 2, profileY + 75);

    // TC Logo - bottom right
    if (tc_logo_url) {
      const logoSize = 100;
      const logoX = WIDTH - logoSize - 60;
      const logoY = productHeight + 120;
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    // Verified badge - top left of profile picture
    if (verified_badge_url) {
      const badgeSize = 40;
      const badgeX = profileX - (badgeSize * 0.3); // Slightly overlapping left edge
      const badgeY = profileY - (badgeSize * 0.3); // Slightly overlapping top edge
      const verifiedBadge = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(verifiedBadge, badgeX, badgeY, badgeSize, badgeSize);
    }

    // Convert canvas to buffer
    const buffer = canvas.toBuffer('image/png');

    // Return image directly as binary
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.png"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error composing image:', error);
    res.status(500).json({ 
      error: 'Failed to compose image', 
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Image Compositor API' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Image Compositor API running on port ${PORT}`);
});
