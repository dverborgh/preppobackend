/**
 * Authentication Flow Test Script
 * Tests the Preppo application with real user credentials
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3000',
  credentials: {
    email: 'david.verborgh@gmail.com',
    password: 'Zeweetwel123123+'
  },
  campaignId: 'abd6aae5-fbf2-42fd-9b9a-d736f99cf5e3',
  screenshotDir: '/home/mrpluvid/preppo/backend/test-screenshots',
  timeout: 30000
};

// Ensure screenshot directory exists
if (!fs.existsSync(TEST_CONFIG.screenshotDir)) {
  fs.mkdirSync(TEST_CONFIG.screenshotDir, { recursive: true });
}

async function captureScreenshot(page, name) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}_${name}.png`;
  const filepath = path.join(TEST_CONFIG.screenshotDir, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`📸 Screenshot saved: ${filename}`);
  return filepath;
}

async function captureConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', error => {
    errors.push(`Page Error: ${error.message}`);
  });
  return errors;
}

async function test1_Login(browser) {
  console.log('\n🧪 TEST 1: Login Flow');
  console.log('═══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  captureConsoleErrors(page);

  try {
    // Navigate to login page
    console.log('→ Navigating to login page...');
    await page.goto(`${TEST_CONFIG.baseUrl}/login`, { waitUntil: 'networkidle' });
    await captureScreenshot(page, '01_login_page');

    // Fill in credentials
    console.log('→ Entering credentials...');
    await page.fill('input[type="email"]', TEST_CONFIG.credentials.email);
    await page.fill('input[type="password"]', TEST_CONFIG.credentials.password);
    await captureScreenshot(page, '02_credentials_filled');

    // Submit form
    console.log('→ Submitting login form...');
    await page.click('button[type="submit"]');

    // Wait for navigation
    await page.waitForURL('**/campaigns', { timeout: TEST_CONFIG.timeout });
    console.log('→ Redirected to campaigns page');

    await page.waitForTimeout(2000); // Wait for content to load
    await captureScreenshot(page, '03_campaigns_page');

    // Verify login success
    const url = page.url();
    const isOnCampaignsPage = url.includes('/campaigns');

    console.log(`✓ URL: ${url}`);
    console.log(`✓ On campaigns page: ${isOnCampaignsPage}`);

    await context.close();

    return {
      success: isOnCampaignsPage,
      errors: errors,
      message: isOnCampaignsPage ? 'Login successful' : 'Failed to redirect to campaigns'
    };

  } catch (error) {
    await captureScreenshot(page, '01_login_FAILED');
    await context.close();
    return {
      success: false,
      errors: [...errors, error.message],
      message: `Login failed: ${error.message}`
    };
  }
}

async function test2_NavigateToCampaign(browser) {
  console.log('\n🧪 TEST 2: Navigate to Campaign');
  console.log('═══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  captureConsoleErrors(page);

  try {
    // Login first
    await page.goto(`${TEST_CONFIG.baseUrl}/login`);
    await page.fill('input[type="email"]', TEST_CONFIG.credentials.email);
    await page.fill('input[type="password"]', TEST_CONFIG.credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/campaigns', { timeout: TEST_CONFIG.timeout });

    console.log('→ Looking for Ironsworn campaign...');
    await page.waitForTimeout(2000);

    // Try to find and click the campaign
    const campaignLink = await page.locator(`a[href*="${TEST_CONFIG.campaignId}"]`).first();
    const campaignExists = await campaignLink.count() > 0;

    if (!campaignExists) {
      console.log('⚠️  Campaign link not found, trying direct navigation...');
      await page.goto(`${TEST_CONFIG.baseUrl}/campaigns/${TEST_CONFIG.campaignId}`);
    } else {
      console.log('→ Clicking campaign link...');
      await campaignLink.click();
    }

    await page.waitForTimeout(3000);
    await captureScreenshot(page, '04_campaign_detail_page');

    // Capture page structure
    const pageTitle = await page.title();
    const url = page.url();

    console.log(`✓ Page Title: ${pageTitle}`);
    console.log(`✓ URL: ${url}`);

    // Check for key panels
    const sessionsPanel = await page.locator('text=Sessions').count();
    const generatorsPanel = await page.locator('text=Generators').count();
    const resourcesPanel = await page.locator('text=Resources').count();

    console.log(`✓ Sessions Panel: ${sessionsPanel > 0 ? 'Found' : 'Not Found'}`);
    console.log(`✓ Generators Panel: ${generatorsPanel > 0 ? 'Found' : 'Not Found'}`);
    console.log(`✓ Resources Panel: ${resourcesPanel > 0 ? 'Found' : 'Not Found'}`);

    await context.close();

    return {
      success: url.includes(TEST_CONFIG.campaignId),
      errors: errors,
      message: 'Campaign page loaded successfully',
      details: {
        sessionsPanel: sessionsPanel > 0,
        generatorsPanel: generatorsPanel > 0,
        resourcesPanel: resourcesPanel > 0
      }
    };

  } catch (error) {
    await captureScreenshot(page, '04_campaign_FAILED');
    await context.close();
    return {
      success: false,
      errors: [...errors, error.message],
      message: `Campaign navigation failed: ${error.message}`
    };
  }
}

async function test3_CreateSessionModal(browser) {
  console.log('\n🧪 TEST 3: Create Session Modal');
  console.log('═══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  captureConsoleErrors(page);

  try {
    // Login and navigate to campaign
    await page.goto(`${TEST_CONFIG.baseUrl}/login`);
    await page.fill('input[type="email"]', TEST_CONFIG.credentials.email);
    await page.fill('input[type="password"]', TEST_CONFIG.credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/campaigns');
    await page.goto(`${TEST_CONFIG.baseUrl}/campaigns/${TEST_CONFIG.campaignId}`);
    await page.waitForTimeout(3000);

    console.log('→ Looking for Create Session button...');

    // Try multiple selectors for the create session button
    const buttonSelectors = [
      'button:has-text("Create First Session")',
      'button:has-text("Create Session")',
      'button:has-text("New Session")',
      '[data-testid="create-session-button"]',
      'button[aria-label*="session"]'
    ];

    let buttonFound = false;
    let buttonSelector = null;

    for (const selector of buttonSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        buttonSelector = selector;
        buttonFound = true;
        console.log(`✓ Found button with selector: ${selector}`);
        break;
      }
    }

    await captureScreenshot(page, '05_before_modal_click');

    if (buttonFound) {
      console.log('→ Clicking Create Session button...');
      await page.click(buttonSelector);
      await page.waitForTimeout(1000);

      await captureScreenshot(page, '06_after_modal_click');

      // Check if modal appeared
      const modalVisible = await page.locator('[role="dialog"]').count() > 0 ||
                          await page.locator('.modal').count() > 0 ||
                          await page.locator('[data-testid="modal"]').count() > 0;

      console.log(`✓ Modal Visible: ${modalVisible}`);

      await context.close();

      return {
        success: modalVisible,
        errors: errors,
        message: modalVisible ? 'Modal opened successfully' : 'Modal did not open'
      };
    } else {
      console.log('⚠️  Create Session button not found');
      await context.close();

      return {
        success: false,
        errors: errors,
        message: 'Create Session button not found on page'
      };
    }

  } catch (error) {
    await captureScreenshot(page, '06_modal_FAILED');
    await context.close();
    return {
      success: false,
      errors: [...errors, error.message],
      message: `Modal test failed: ${error.message}`
    };
  }
}

async function test4_RAGHelpButton(browser) {
  console.log('\n🧪 TEST 4: RAG Q&A Help Button');
  console.log('═══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  captureConsoleErrors(page);

  try {
    // Login and navigate to campaign
    await page.goto(`${TEST_CONFIG.baseUrl}/login`);
    await page.fill('input[type="email"]', TEST_CONFIG.credentials.email);
    await page.fill('input[type="password"]', TEST_CONFIG.credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/campaigns');
    await page.goto(`${TEST_CONFIG.baseUrl}/campaigns/${TEST_CONFIG.campaignId}`);
    await page.waitForTimeout(3000);

    console.log('→ Looking for RAG Help button (? icon)...');

    // Try multiple selectors for the help button
    const helpSelectors = [
      'button[aria-label*="help"]',
      'button[aria-label*="question"]',
      'button[aria-label*="RAG"]',
      'button:has-text("?")',
      '[data-testid="rag-help-button"]',
      'button.help-button'
    ];

    let helpButtonFound = false;
    let helpSelector = null;

    for (const selector of helpSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        helpSelector = selector;
        helpButtonFound = true;
        console.log(`✓ Found help button with selector: ${selector}`);
        break;
      }
    }

    await captureScreenshot(page, '07_before_rag_click');

    if (helpButtonFound) {
      console.log('→ Clicking RAG Help button...');
      await page.click(helpSelector);
      await page.waitForTimeout(1000);

      await captureScreenshot(page, '08_after_rag_click');

      // Check if modal appeared
      const modalVisible = await page.locator('[role="dialog"]').count() > 0;
      const hasQueryInput = await page.locator('textarea, input[type="text"]').count() > 0;

      console.log(`✓ Modal Visible: ${modalVisible}`);
      console.log(`✓ Query Input Present: ${hasQueryInput}`);

      await context.close();

      return {
        success: modalVisible && hasQueryInput,
        errors: errors,
        message: modalVisible ? 'RAG modal opened successfully' : 'RAG modal did not open',
        details: {
          modalVisible,
          hasQueryInput
        }
      };
    } else {
      console.log('⚠️  RAG Help button not found');

      // Try to find what buttons ARE on the page
      const allButtons = await page.locator('button').all();
      console.log(`→ Found ${allButtons.length} buttons on page`);

      for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
        const text = await allButtons[i].textContent();
        const ariaLabel = await allButtons[i].getAttribute('aria-label');
        console.log(`  Button ${i + 1}: "${text}" (aria-label: "${ariaLabel}")`);
      }

      await context.close();

      return {
        success: false,
        errors: errors,
        message: 'RAG Help button not found on page'
      };
    }

  } catch (error) {
    await captureScreenshot(page, '08_rag_FAILED');
    await context.close();
    return {
      success: false,
      errors: [...errors, error.message],
      message: `RAG button test failed: ${error.message}`
    };
  }
}

async function test5_Generators(browser) {
  console.log('\n🧪 TEST 5: Generators Panel');
  console.log('═══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  captureConsoleErrors(page);

  try {
    // Login and navigate to campaign
    await page.goto(`${TEST_CONFIG.baseUrl}/login`);
    await page.fill('input[type="email"]', TEST_CONFIG.credentials.email);
    await page.fill('input[type="password"]', TEST_CONFIG.credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/campaigns');
    await page.goto(`${TEST_CONFIG.baseUrl}/campaigns/${TEST_CONFIG.campaignId}`);
    await page.waitForTimeout(3000);

    console.log('→ Looking for Generators panel...');

    const generatorsHeading = await page.locator('text=Generators').count();
    console.log(`✓ Generators Heading: ${generatorsHeading > 0 ? 'Found' : 'Not Found'}`);

    // Look for generator items
    const generatorItems = await page.locator('[data-testid*="generator"], .generator-item, button:has-text("Roll")').count();
    console.log(`✓ Generator Items Found: ${generatorItems}`);

    await captureScreenshot(page, '09_generators_panel');

    if (generatorItems > 0) {
      console.log('→ Attempting to click first generator...');
      await page.locator('[data-testid*="generator"], .generator-item').first().click();
      await page.waitForTimeout(1000);

      await captureScreenshot(page, '10_generator_clicked');
    }

    await context.close();

    return {
      success: generatorsHeading > 0,
      errors: errors,
      message: `Found ${generatorItems} generators`,
      details: {
        generatorCount: generatorItems
      }
    };

  } catch (error) {
    await captureScreenshot(page, '09_generators_FAILED');
    await context.close();
    return {
      success: false,
      errors: [...errors, error.message],
      message: `Generators test failed: ${error.message}`
    };
  }
}

async function test6_ResourceUpload(browser) {
  console.log('\n🧪 TEST 6: Resource Upload');
  console.log('═══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  captureConsoleErrors(page);

  try {
    // Login and navigate to campaign
    await page.goto(`${TEST_CONFIG.baseUrl}/login`);
    await page.fill('input[type="email"]', TEST_CONFIG.credentials.email);
    await page.fill('input[type="password"]', TEST_CONFIG.credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/campaigns');
    await page.goto(`${TEST_CONFIG.baseUrl}/campaigns/${TEST_CONFIG.campaignId}`);
    await page.waitForTimeout(3000);

    console.log('→ Looking for Resources panel...');

    const resourcesHeading = await page.locator('text=Resources').count();
    console.log(`✓ Resources Heading: ${resourcesHeading > 0 ? 'Found' : 'Not Found'}`);

    // Look for upload button
    const uploadSelectors = [
      'button:has-text("Upload")',
      'button:has-text("Add Resource")',
      'input[type="file"]',
      '[data-testid="upload-button"]'
    ];

    let uploadButtonFound = false;
    let uploadSelector = null;

    for (const selector of uploadSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        uploadSelector = selector;
        uploadButtonFound = true;
        console.log(`✓ Found upload control with selector: ${selector}`);
        break;
      }
    }

    await captureScreenshot(page, '11_resources_panel');

    if (uploadButtonFound && !uploadSelector.includes('input[type="file"]')) {
      console.log('→ Clicking upload button...');
      await page.click(uploadSelector);
      await page.waitForTimeout(1000);

      await captureScreenshot(page, '12_upload_modal');
    }

    await context.close();

    return {
      success: resourcesHeading > 0,
      errors: errors,
      message: uploadButtonFound ? 'Upload button found' : 'Upload button not found',
      details: {
        uploadButtonFound
      }
    };

  } catch (error) {
    await captureScreenshot(page, '11_resources_FAILED');
    await context.close();
    return {
      success: false,
      errors: [...errors, error.message],
      message: `Resource upload test failed: ${error.message}`
    };
  }
}

async function generateReport(results) {
  const timestamp = new Date().toISOString();
  const reportPath = `/home/mrpluvid/preppo/docs/test_reports/${timestamp.split('T')[0]}_authentication_flow.md`;

  let report = `# Test Report: Authentication Flow Testing
**Date**: ${timestamp}
**Tester**: App Flaw Finder Agent
**Test Duration**: ${Date.now() - startTime}ms

## Feature Under Test
Authentication flow and campaign detail page functionality with real user credentials

## Test Environment
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- Browser: Chromium (headed mode)
- User: ${TEST_CONFIG.credentials.email}
- Campaign ID: ${TEST_CONFIG.campaignId}

## Test Results Summary
- Total Tests: ${results.length}
- Passed: ${results.filter(r => r.success).length}
- Failed: ${results.filter(r => !r.success).length}
- Severity: ${results.some(r => !r.success) ? 'High' : 'Low'}

## Detailed Test Results

`;

  results.forEach((result, index) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    report += `### Test ${index + 1}: ${result.name} - ${status}\n\n`;
    report += `**Message**: ${result.message}\n\n`;

    if (result.details) {
      report += `**Details**:\n`;
      for (const [key, value] of Object.entries(result.details)) {
        report += `- ${key}: ${value}\n`;
      }
      report += '\n';
    }

    if (result.errors.length > 0) {
      report += `**Errors**:\n`;
      result.errors.forEach(err => {
        report += `- ${err}\n`;
      });
      report += '\n';
    }

    report += '---\n\n';
  });

  report += `## Screenshots
All screenshots saved to: ${TEST_CONFIG.screenshotDir}

## Recommendations
`;

  const failedTests = results.filter(r => !r.success);
  if (failedTests.length > 0) {
    report += `\n### Critical Issues Found\n`;
    failedTests.forEach((test, index) => {
      report += `${index + 1}. **${test.name}**: ${test.message}\n`;
    });
  } else {
    report += `\nAll tests passed successfully. Application is functioning as expected.\n`;
  }

  // Ensure directory exists
  const reportDir = path.dirname(reportPath);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(reportPath, report);
  console.log(`\n📄 Report saved to: ${reportPath}`);

  return reportPath;
}

// Main test execution
let startTime;

(async () => {
  console.log('🚀 Starting Authentication Flow Tests');
  console.log('=====================================\n');

  startTime = Date.now();

  const browser = await chromium.launch({
    headless: false,
    slowMo: 500 // Slow down by 500ms for visibility
  });

  const results = [];

  // Run all tests
  results.push({ name: 'Login', ...await test1_Login(browser) });
  results.push({ name: 'Navigate to Campaign', ...await test2_NavigateToCampaign(browser) });
  results.push({ name: 'Create Session Modal', ...await test3_CreateSessionModal(browser) });
  results.push({ name: 'RAG Q&A Help Button', ...await test4_RAGHelpButton(browser) });
  results.push({ name: 'Generators Panel', ...await test5_Generators(browser) });
  results.push({ name: 'Resource Upload', ...await test6_ResourceUpload(browser) });

  await browser.close();

  // Generate report
  const reportPath = await generateReport(results);

  console.log('\n✨ Testing Complete!');
  console.log(`Report: ${reportPath}`);
  console.log(`Screenshots: ${TEST_CONFIG.screenshotDir}`);

  // Exit with appropriate code
  const failedCount = results.filter(r => !r.success).length;
  process.exit(failedCount > 0 ? 1 : 0);
})();
