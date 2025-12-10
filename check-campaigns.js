const axios = require('axios');

async function checkCampaigns() {
  try {
    // Login
    const loginRes = await axios.post('http://localhost:8000/api/auth/login', {
      email: 'david.verborgh@gmail.com',
      password: 'Zeweetwel123123+'
    });

    const token = loginRes.data.token;
    console.log('Login successful, token obtained');

    // Get campaigns
    const campaignsRes = await axios.get('http://localhost:8000/api/campaigns', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('\nCampaigns:');
    console.log(JSON.stringify(campaignsRes.data, null, 2));

    // Check for the specific campaign ID
    const targetId = 'abd6aae5-fbf2-42fd-9b9a-d736f99cf5e3';
    const campaigns = campaignsRes.data.data;
    const targetCampaign = campaigns.find(c => c.id === targetId);

    console.log(`\nLooking for campaign ID: ${targetId}`);
    if (targetCampaign) {
      console.log(`Found: ${targetCampaign.name}`);
    } else {
      console.log('NOT FOUND');
      console.log('\nAvailable campaign IDs:');
      campaigns.forEach(c => console.log(`- ${c.name}: ${c.id}`));
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

checkCampaigns();
