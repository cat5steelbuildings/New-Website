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

    // Auto-priority: phone present = HOT lead, email-only = WARM
    const contactMethod = data.phone && data.phone.trim().length > 0 ? 'Phone' : 'Email';

    // If quote_details is provided (FREE GUIDE, Ask Us, etc.), use as-is.
    // Otherwise, generate the priority message for steel building quotes.
    let quoteDetails;
    if (data.quote_details) {
      quoteDetails = data.quote_details;
    } else {
      quoteDetails = `Priority: ${data.phone ? 'HOT - Call ASAP' : 'WARM - Email Quote'}\n\n${data.quoteJson || ''}`;
    }

    const contactData = {
      properties: {
        firstname: data.name.split(' ')[0] || data.name,
        lastname: data.name.split(' ').slice(1).join(' ') || '',
        email: data.email,
        phone: data.phone || '',
        city: data.location || '',
        zip: data.zip || '',
        contact_method: contactMethod,  // "Phone" or "Email"
        building_type: data.buildingType || '',
        building_size: data.building_size || data.buildingSize || '',
        roof_style: data.roofStyle || '',
        cat_5_wind_rating: data.cat5Wind || '',
        selected_upgrades: data.upgrades || '',
        quote_details: quoteDetails
      }
    };

    const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HUBSPOT_TOKEN}`
      },
      body: JSON.stringify(contactData)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('HubSpot API error:', result);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Failed to create contact', details: result })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, contactId: result.id })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};
