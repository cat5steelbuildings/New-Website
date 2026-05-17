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
        contact_method: contactMethod,
        building_type: data.buildingType || '',
        building_size: data.building_size || data.buildingSize || '',
        roof_style: data.roofStyle || '',
        cat_5_wind_rating: data.cat5Wind || '',
        selected_upgrades: data.upgrades || '',
        quote_details: quoteDetails
      }
    };

    // Step 1: Try to CREATE the contact
    const createResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HUBSPOT_TOKEN}`
      },
      body: JSON.stringify(contactData)
    });

    // Success on first try - new contact created
    if (createResponse.ok) {
      const result = await createResponse.json();
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, contactId: result.id, action: 'created' })
      };
    }

    // Step 2: If 409 (contact already exists), UPDATE instead
    if (createResponse.status === 409) {
      console.log('Contact exists, updating instead:', data.email);

      // Look up the existing contact by email
      const searchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${HUBSPOT_TOKEN}`
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{
              propertyName: 'email',
              operator: 'EQ',
              value: data.email
            }]
          }],
          properties: ['email', 'firstname', 'lastname', 'quote_details'],
          limit: 1
        })
      });

      if (!searchResponse.ok) {
        const searchErr = await searchResponse.json();
        console.error('Search failed:', searchErr);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to look up existing contact', details: searchErr })
        };
      }

      const searchResult = await searchResponse.json();

      if (!searchResult.results || searchResult.results.length === 0) {
        // Conflict said duplicate but search returns none — odd edge case
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Contact exists but could not be located', email: data.email })
        };
      }

      const contactId = searchResult.results[0].id;
      const existingDetails = searchResult.results[0].properties.quote_details || '';

      // Append new submission to existing quote_details so we don't lose history
      const timestamp = new Date().toISOString();
      const appendedDetails = existingDetails
        ? `${existingDetails}\n\n--- New Submission ${timestamp} ---\n${quoteDetails}`
        : quoteDetails;

      // Build update payload (don't overwrite firstname/lastname if they were already set)
      const updateData = {
        properties: {
          ...contactData.properties,
          quote_details: appendedDetails
        }
      };

      // PATCH the contact
      const updateResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${HUBSPOT_TOKEN}`
        },
        body: JSON.stringify(updateData)
      });

      if (!updateResponse.ok) {
        const updateErr = await updateResponse.json();
        console.error('Update failed:', updateErr);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to update existing contact', details: updateErr })
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, contactId: contactId, action: 'updated' })
      };
    }

    // Step 3: Other errors — return as-is
    const errResult = await createResponse.json();
    console.error('HubSpot API error:', errResult);
    return {
      statusCode: createResponse.status,
      body: JSON.stringify({ error: 'Failed to create contact', details: errResult })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};
