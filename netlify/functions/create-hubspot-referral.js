exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
    
    // Create contact for the PROSPECT (the person being referred)
    const prospectData = {
      properties: {
        firstname: data.prospect_name.split(' ')[0] || data.prospect_name,
        lastname: data.prospect_name.split(' ').slice(1).join(' ') || '',
        email: data.prospect_email || 'noemail@referral.placeholder',
        phone: data.prospect_phone || '',
        building_type: data.building_type || '',
        contact_method: data.prospect_phone && data.prospect_phone.trim() ? 'Phone' : 'Email',
        referral_source: `${data.referrer_name} - ${data.referrer_phone} - ${data.referrer_email}`,
        quote_details: `REFERRAL PROGRAM - TIERED PAYMENT:
Up to $7k = $150 | $8k-$12k = $250 | $13k-$17k = $350 | $18k+ = $500
Split 50/50: Half at deposit, half at ground break

${data.additional_notes || 'No additional notes'}`
      }
    };

    // Create the prospect contact in HubSpot
    const prospectResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HUBSPOT_TOKEN}`
      },
      body: JSON.stringify(prospectData)
    });

    const prospectResult = await prospectResponse.json();

    if (!prospectResponse.ok) {
      console.error('HubSpot API error (prospect):', prospectResult);
      return {
        statusCode: prospectResponse.status,
        body: JSON.stringify({ error: 'Failed to create prospect contact', details: prospectResult })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        prospectId: prospectResult.id
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};
