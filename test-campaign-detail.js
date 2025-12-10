const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function testCampaignDetail() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Create screenshots directory
  const screenshotsDir = path.join(__dirname, 'test-screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
  }

  try {
    console.log('\n========================================');
    console.log('STEP 1: LOGIN');
    console.log('========================================');

    await page.goto('http://localhost:3000/login');
    console.log('Current URL after login page load:', page.url());

    // Fill login form
    await page.fill('input[type="email"]', 'david.verborgh@gmail.com');
    await page.fill('input[type="password"]', 'Zeweetwel123123+');
    await page.click('button[type="submit"]');

    // Wait for navigation
    await page.waitForTimeout(2000);
    console.log('Current URL after login:', page.url());

    console.log('\n========================================');
    console.log('STEP 2: VERIFY CAMPAIGNS LIST PAGE');
    console.log('========================================');

    // Ensure we're on campaigns list
    if (!page.url().includes('/campaigns')) {
      console.log('Not on campaigns page, navigating...');
      await page.goto('http://localhost:3000/campaigns');
      await page.waitForTimeout(1000);
    }

    console.log('Current URL:', page.url());
    console.log('Expected URL: http://localhost:3000/campaigns');
    console.log('URL matches:', page.url() === 'http://localhost:3000/campaigns');

    // Take screenshot of campaigns list
    await page.screenshot({
      path: path.join(screenshotsDir, '1-campaigns-list.png'),
      fullPage: true
    });
    console.log('Screenshot saved: 1-campaigns-list.png');

    // Look for campaign cards
    const campaignCards = await page.locator('[data-testid*="campaign"], .campaign-card, article').count();
    console.log(`Found ${campaignCards} campaign card elements`);

    console.log('\n========================================');
    console.log('STEP 3: NAVIGATE TO CAMPAIGN DETAIL');
    console.log('========================================');

    // Look for Ironsworn campaign
    console.log('Looking for "Ironsworn" campaign...');

    // Try multiple strategies to find the campaign
    let clickSuccess = false;

    // Strategy 1: Look for text containing "Ironsworn"
    try {
      const ironswornElement = page.locator('text=Ironsworn').first();
      const count = await ironswornElement.count();
      console.log(`Found ${count} elements with "Ironsworn" text`);

      if (count > 0) {
        // Find the parent card/article element
        const card = ironswornElement.locator('..').locator('..').first();
        await card.click();
        clickSuccess = true;
        console.log('Clicked on Ironsworn campaign card');
      }
    } catch (e) {
      console.log('Strategy 1 failed:', e.message);
    }

    // Wait for navigation
    await page.waitForTimeout(2000);

    console.log('Current URL after click:', page.url());

    // If click didn't work, navigate directly
    if (!page.url().includes('abd6aae5-fbf2-42fd-9b9a-d736f99cf5e3')) {
      console.log('Click navigation failed, navigating directly...');
      await page.goto('http://localhost:3000/campaigns/abd6aae5-fbf2-42fd-9b9a-d736f99cf5e3');
      await page.waitForTimeout(2000);
      console.log('Current URL after direct navigation:', page.url());
    }

    console.log('\n========================================');
    console.log('STEP 4: VERIFY CAMPAIGN DETAIL PAGE');
    console.log('========================================');

    const expectedUrl = 'http://localhost:3000/campaigns/abd6aae5-fbf2-42fd-9b9a-d736f99cf5e3';
    console.log('Expected URL:', expectedUrl);
    console.log('Current URL:', page.url());
    console.log('URL matches:', page.url() === expectedUrl);

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Take screenshot of detail page
    await page.screenshot({
      path: path.join(screenshotsDir, '2-campaign-detail.png'),
      fullPage: true
    });
    console.log('Screenshot saved: 2-campaign-detail.png');

    // Check for specific panels
    console.log('\nChecking for panels:');

    // Sessions panel
    const sessionsPanel = await page.locator('text=/SESSIONS/i').count();
    console.log('- Sessions panel (SESSIONS header):', sessionsPanel > 0 ? '✓ FOUND' : '✗ NOT FOUND');

    // Generators panel
    const generatorsPanel = await page.locator('text=/GENERATORS/i').count();
    console.log('- Generators panel (GENERATORS header):', generatorsPanel > 0 ? '✓ FOUND' : '✗ NOT FOUND');

    // Sound Scapes panel
    const soundScapesPanel = await page.locator('text=/SOUND SCAPES/i').count();
    console.log('- Sound Scapes panel (SOUND SCAPES header):', soundScapesPanel > 0 ? '✓ FOUND' : '✗ NOT FOUND');

    // Resources tree
    const resourcesTree = await page.locator('text=/RESOURCES/i').count();
    console.log('- Resources tree:', resourcesTree > 0 ? '✓ FOUND' : '✗ NOT FOUND');

    // RAG button - multiple strategies
    console.log('\nLooking for RAG button:');
    const ragButtonSelectors = [
      'button[aria-label*="RAG"]',
      'button[title*="RAG"]',
      'button:has-text("?")',
      '[data-testid*="rag"]',
      'button.fixed', // Fixed position button
      '.fixed button' // Button inside fixed container
    ];

    let ragButtonFound = false;
    for (const selector of ragButtonSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`  - Found with selector "${selector}": ${count} elements`);
        ragButtonFound = true;
      }
    }

    if (!ragButtonFound) {
      console.log('  - RAG button NOT FOUND with any selector');
    }

    // Get all console logs
    console.log('\n========================================');
    console.log('CONSOLE ERRORS/WARNINGS:');
    console.log('========================================');

    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[${msg.type()}] ${msg.text()}`);
      }
    });

    console.log('\n========================================');
    console.log('STEP 5: TEST RAG BUTTON');
    console.log('========================================');

    // Scroll to bottom-right to ensure button is visible
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    // Try to find and click RAG button
    const ragButton = page.locator('button:has-text("?")').first();
    const ragButtonCount = await ragButton.count();

    console.log('RAG button count:', ragButtonCount);

    if (ragButtonCount > 0) {
      console.log('Clicking RAG button...');
      await ragButton.click();
      await page.waitForTimeout(1000);

      // Check if modal opened
      const modalSelectors = [
        '[role="dialog"]',
        '.modal',
        'text=/RAG.*Q&A/i'
      ];

      let modalFound = false;
      for (const selector of modalSelectors) {
        const count = await page.locator(selector).count();
        if (count > 0) {
          console.log(`Modal found with selector "${selector}"`);
          modalFound = true;
        }
      }

      if (modalFound) {
        console.log('✓ RAG modal opened successfully');
        await page.screenshot({
          path: path.join(screenshotsDir, '3-rag-modal-open.png'),
          fullPage: true
        });
        console.log('Screenshot saved: 3-rag-modal-open.png');
      } else {
        console.log('✗ RAG modal did NOT open');
      }
    } else {
      console.log('✗ RAG button not found, cannot test modal');
    }

    console.log('\n========================================');
    console.log('TEST COMPLETE');
    console.log('========================================');
    console.log(`Screenshots saved to: ${screenshotsDir}`);

    // Keep browser open for 5 seconds to review
    await page.waitForTimeout(5000);

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);

    // Take error screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, 'error.png'),
      fullPage: true
    });
  } finally {
    await browser.close();
  }
}

testCampaignDetail();
